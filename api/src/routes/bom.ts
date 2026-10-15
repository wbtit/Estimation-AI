// Runs validate + BOM for one project's members against one catalog edition.
//   GET /api/projects/:projectId/bom?edition=<label>        JSON: validation + BOM
//   GET /api/projects/:projectId/bom.xlsx?edition=<label>   Excel workbook
// Read-only: results are computed on request and never stored.
import type { Kysely } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { generateBom, type Bom } from '../bom/index.js';
import { loadCatalogIndex } from '../catalog/store.js';
import { SCHEMA_VERSION, type Member } from '../contract/index.js';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { buildBomWorkbook, XLSX_MIME } from '../excel/index.js';
import { HttpError } from './http-error.js';
import { rowToMember } from '../members/rows.js';
import { validateMembers, type CatalogIndex, type ValidationReport } from '../validator/index.js';

export interface BomRouteOptions {
  db?: Kysely<Database>;
}

interface ProjectRef {
  project_id: string;
  name: string;
  number: string | null;
}

interface Computation {
  project: ProjectRef;
  catalog_edition: string;
  validation: ValidationReport;
  bom: Bom;
}

async function compute(
  db: Kysely<Database>,
  projectId: string,
  edition: string,
): Promise<Computation> {
  const project = await db
    .selectFrom('projects')
    .select(['id', 'name', 'number'])
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!project) throw new HttpError(404, { error: 'project not found' });

  const catalog: CatalogIndex | null = await loadCatalogIndex(db, edition);
  if (!catalog) throw new HttpError(404, { error: `catalog edition "${edition}" not found` });

  const rows = await db
    .selectFrom('members')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('build_run_id', 'is', null) // the line-first build has its own BOM (routes/build.ts)
    .execute();
  const members: Member[] = rows.map((row) => {
    try {
      return rowToMember(row);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new HttpError(422, {
          error: `stored member "${row.member_id}" violates contract v${SCHEMA_VERSION}`,
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      throw err;
    }
  });

  const validation = validateMembers(members, catalog);
  return {
    project: { project_id: project.id, name: project.name, number: project.number },
    catalog_edition: edition,
    validation,
    bom: generateBom(members, catalog, validation),
  };
}

const routeSchema = {
  params: {
    type: 'object',
    required: ['projectId'],
    properties: { projectId: { type: 'string', format: 'uuid' } },
  },
  querystring: {
    type: 'object',
    required: ['edition'],
    properties: { edition: { type: 'string', minLength: 1 } },
    additionalProperties: false,
  },
} as const;

type RouteGeneric = { Params: { projectId: string }; Querystring: { edition: string } };

export const bomRoutes: FastifyPluginAsync<BomRouteOptions> = async (app, options) => {
  // Resolved per request so building the app never touches the database.
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.get<RouteGeneric>(
    '/api/projects/:projectId/bom',
    { schema: routeSchema },
    async (request) => {
      const result = await compute(db(), request.params.projectId, request.query.edition);
      return { schema_version: SCHEMA_VERSION, ...result };
    },
  );

  app.get<RouteGeneric>(
    '/api/projects/:projectId/bom.xlsx',
    { schema: routeSchema },
    async (request, reply) => {
      const result = await compute(db(), request.params.projectId, request.query.edition);
      const workbook = await buildBomWorkbook({ ...result, schema_version: SCHEMA_VERSION });
      return reply
        .header('content-type', XLSX_MIME)
        .header(
          'content-disposition',
          `attachment; filename="bom-${request.params.projectId}.xlsx"`,
        )
        .send(workbook);
    },
  );
};
