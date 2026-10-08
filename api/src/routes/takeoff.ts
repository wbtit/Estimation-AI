// Takeoff table of a project: effective members grouped by level, mark and profile.
//   GET /api/projects/:projectId/takeoff        JSON rows, totals per level, overall total, excluded (red) line
//   GET /api/projects/:projectId/takeoff.xlsx   the same as an Excel workbook (no weights, no prices)
// Read-only: computed on request from the stored members and their edits.
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { buildTakeoffWorkbook } from '../excel/takeoff.js';
import { XLSX_MIME } from '../excel/index.js';
import { buildTakeoff } from '../review/takeoff.js';
import { loadSheetInclusions } from '../review/takeoff-sheets.js';
import { HttpError } from './http-error.js';
import { loadMemberViews } from './members.js';

export interface TakeoffRouteOptions {
  db?: Kysely<Database>;
}

const params = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: { type: 'string', format: 'uuid' } },
} as const;

export const takeoffRoutes: FastifyPluginAsync<TakeoffRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function compute(projectId: string) {
    const project = await db()
      .selectFrom('projects')
      .select(['id', 'name', 'number'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) throw new HttpError(404, { error: 'project not found' });
    const inclusions = await loadSheetInclusions(db(), projectId);
    const included = new Set(inclusions.filter((s) => s.included).map((s) => s.sheet_id));
    const all = await loadMemberViews(db(), projectId);
    // members of sheets that are not for takeoff stay stored but are not counted
    const members = all.filter((m) => m.sheet_id !== null && included.has(m.sheet_id));
    const pageOf = new Map(inclusions.map((s) => [s.sheet_id, s.page_number] as const));
    const held = new Map<string, number>();
    for (const m of all) {
      if (m.deleted || !m.sheet_id || included.has(m.sheet_id)) continue;
      held.set(m.sheet_id, (held.get(m.sheet_id) ?? 0) + 1);
    }
    return {
      project: { project_id: project.id, name: project.name, number: project.number },
      takeoff: {
        ...buildTakeoff(members, pageOf),
        sheets: inclusions.map((s) => ({ ...s, members_not_counted: held.get(s.sheet_id) ?? 0 })),
      },
    };
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/takeoff',
    { schema: { params } },
    async (request) => {
      const { project, takeoff } = await compute(request.params.projectId);
      return { project, ...takeoff };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/takeoff.xlsx',
    { schema: { params } },
    async (request, reply) => {
      const input = await compute(request.params.projectId);
      const workbook = await buildTakeoffWorkbook(input);
      return reply
        .header('content-type', XLSX_MIME)
        .header(
          'content-disposition',
          `attachment; filename="takeoff-${request.params.projectId}.xlsx"`,
        )
        .send(workbook);
    },
  );
};
