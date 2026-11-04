import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { JOBS_CHANNEL } from '../review/image-similar.js';
import { HttpError } from './http-error.js';

export interface CountRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;

/** The sheet's lines, parsed once and kept while the stored version is the same. */
const lineCache = new Map<string, { version: string; classes: string[]; lines: number[][] }>();
const LINE_CACHE_MAX = 6;

export const countRoutes: FastifyPluginAsync<CountRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function sheetOf(projectId: string, sheetId: string) {
    const s = await db()
      .selectFrom('sheets')
      .select(['id', 'page_index', 'width_pt', 'height_pt'])
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!s) throw new HttpError(404, { error: 'sheet not found' });
    return s;
  }

  async function loadLines(sheetId: string) {
    const head = await db()
      .selectFrom('sheet_lines')
      .select(['version', 'n_lines'])
      .where('sheet_id', '=', sheetId)
      .executeTakeFirst();
    if (!head) return null;
    const hit = lineCache.get(sheetId);
    if (hit && hit.version === head.version) return hit;
    const row = await db()
      .selectFrom('sheet_lines')
      .select(['version', 'classes', 'lines'])
      .where('sheet_id', '=', sheetId)
      .executeTakeFirstOrThrow();
    const entry = { version: row.version, classes: row.classes, lines: row.lines };
    lineCache.set(sheetId, entry);
    while (lineCache.size > LINE_CACHE_MAX) {
      lineCache.delete(lineCache.keys().next().value as string);
    }
    return entry;
  }

  // ---- settings -------------------------------------------------------------------------------

  // ---- the lines of a sheet (snap targets) -----------------------------------------------------
  app.post<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/lines/prepare',
    { schema: { params: sheetParams } },
    async (request, reply) => {
      const { projectId, sheetId } = request.params;
      await sheetOf(projectId, sheetId);
      const have = await db()
        .selectFrom('sheet_lines')
        .select(['version', 'n_lines'])
        .where('sheet_id', '=', sheetId)
        .executeTakeFirst();
      if (have) return { status: 'ready', n_lines: have.n_lines, version: have.version };
      const file = await db()
        .selectFrom('project_files')
        .select('scan_status')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!file || file.scan_status !== 'done') {
        throw new HttpError(409, { error: 'the PDF scan is not finished' });
      }
      const open = await db()
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'sheet_lines')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
        .executeTakeFirst();
      if (open) return reply.status(202).send({ status: 'queued', job_id: open.id });
      const job = await db()
        .insertInto('jobs')
        .values({ type: 'sheet_lines', payload: JSON.stringify({ sheet_id: sheetId }) })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Phase 14f: wake the worker at once (a person waits for the lines)
      await sql`SELECT pg_notify(${JOBS_CHANNEL}, ${job.id})`.execute(db());
      return reply.status(202).send({ status: 'queued', job_id: job.id });
    },
  );

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/lines',
    { schema: { params: sheetParams } },
    async (request) => {
      const { projectId, sheetId } = request.params;
      await sheetOf(projectId, sheetId);
      const l = await loadLines(sheetId);
      if (!l) throw new HttpError(404, { error: 'the lines of this sheet are not extracted yet' });
      return { version: l.version, classes: l.classes, n_lines: l.lines.length, lines: l.lines };
    },
  );
};
