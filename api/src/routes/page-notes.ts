// Page notes (migration 040): one plain-text note per page.
//   GET /api/projects/:projectId/sheets/:sheetId/notes    { note, version, updated_by, updated_at }
//                                                         (version 0 = no note yet)
//   PUT /api/projects/:projectId/sheets/:sheetId/notes    { who, note, base_version, force? }
//        Saves when base_version is the version the person opened (or force). If the note changed
//        since, answers 409 { error: 'changed', current } and saves nothing: the person decides
//        (keep mine = save again with force, or load theirs). Last save wins; not in the BOM or the
//        report.
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { HttpError } from './http-error.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const params = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
export const MAX_NOTE = 20000;

export const pageNotesRoutes: FastifyPluginAsync<{ db?: Kysely<Database> }> = async (
  app,
  options,
) => {
  const db = () => options.db ?? getDb();
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function sheet(projectId: string, sheetId: string) {
    const s = await db()
      .selectFrom('sheets')
      .select('id')
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!s) throw new HttpError(404, { error: 'page not found' });
  }
  const view = (
    r: { note: string; version: number; updated_by: string; updated_at: Date | string } | undefined,
  ) =>
    r
      ? { note: r.note, version: r.version, updated_by: r.updated_by, updated_at: r.updated_at }
      : { note: '', version: 0, updated_by: null, updated_at: null };
  const current = (sheetId: string) =>
    db()
      .selectFrom('sheet_notes')
      .select(['note', 'version', 'updated_by', 'updated_at'])
      .where('sheet_id', '=', sheetId)
      .executeTakeFirst();

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/notes',
    { schema: { params } },
    async (request) => {
      await sheet(request.params.projectId, request.params.sheetId);
      return view(await current(request.params.sheetId));
    },
  );

  app.put<{
    Params: { projectId: string; sheetId: string };
    Body: { who: string; note: string; base_version: number; force?: boolean };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/notes',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['who', 'note', 'base_version'],
          additionalProperties: false,
          properties: {
            who: { type: 'string', minLength: 1, maxLength: 100 },
            note: { type: 'string', maxLength: MAX_NOTE },
            base_version: { type: 'integer', minimum: 0 },
            force: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { projectId, sheetId } = request.params;
      await sheet(projectId, sheetId);
      const who = request.body.who.trim();
      if (!who) throw new HttpError(400, { error: 'who must not be blank' });
      const { note, base_version: base, force } = request.body;
      const saved = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .selectFrom('sheet_notes')
            .select(['version'])
            .where('sheet_id', '=', sheetId)
            .forUpdate()
            .executeTakeFirst();
          if (!row) {
            // nobody has saved a note yet: ON CONFLICT covers two first saves at once
            const ins = await trx
              .insertInto('sheet_notes')
              .values({ sheet_id: sheetId, project_id: projectId, note, updated_by: who })
              .onConflict((oc) => oc.column('sheet_id').doNothing())
              .returning(['note', 'version', 'updated_by', 'updated_at'])
              .executeTakeFirst();
            return ins ?? null;
          }
          if (!force && row.version !== base) return null;
          return await trx
            .updateTable('sheet_notes')
            .set({ note, version: row.version + 1, updated_by: who, updated_at: new Date() })
            .where('sheet_id', '=', sheetId)
            .returning(['note', 'version', 'updated_by', 'updated_at'])
            .executeTakeFirstOrThrow();
        });
      if (!saved) {
        throw new HttpError(409, { error: 'changed', current: view(await current(sheetId)) });
      }
      return view(saved);
    },
  );
};
