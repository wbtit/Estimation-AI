// Work sessions (migration 027): who works on a project now, for attributable training data and the
// timed comparison.
//   GET  /api/projects/:projectId/session                 { session | null } (the open one)
//   POST /api/projects/:projectId/session/start           { actor: owner | estimator, who }
//   POST /api/projects/:projectId/session/end             { who }
//   GET  /api/projects/:projectId/sessions                every session of the project
//   POST /api/projects/:projectId/sheets/:sheetId/page-event   { kind: active | leave, who }
//   GET  /api/sessions/:sessionId/timing                  time per page (JSON)
//   GET  /api/sessions/:sessionId/timing.csv              the same as CSV (ids and times only)
// Start and end are logged as count_actions 'session'. Every action row written while a session is
// open carries its actor and id (the database trigger); with no open session the actor is 'owner'.
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { logCountAction } from '../review/count-log.js';
import { sessionPageTimes, timingCsv, type SessionRow } from '../review/session-timing.js';
import { HttpError } from './http-error.js';

export interface SessionRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const ACTORS = ['owner', 'estimator'] as const;
type Actor = (typeof ACTORS)[number];

export const sessionRoutes: FastifyPluginAsync<SessionRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadProject(projectId: string) {
    const p = await db()
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    return p;
  }

  const openSession = (projectId: string) =>
    db()
      .selectFrom('work_sessions')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

  const view = (s: Awaited<ReturnType<typeof openSession>>) =>
    s
      ? {
          id: s.id,
          short_id: s.id.slice(0, 8),
          actor: s.actor,
          started_at: new Date(s.started_at).toISOString(),
          ended_at: s.ended_at ? new Date(s.ended_at).toISOString() : null,
        }
      : null;

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/session',
    { schema: { params: projectParams } },
    async (request) => {
      await loadProject(request.params.projectId);
      return { session: view(await openSession(request.params.projectId)) };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/sessions',
    { schema: { params: projectParams } },
    async (request) => {
      await loadProject(request.params.projectId);
      const rows = await db()
        .selectFrom('work_sessions')
        .selectAll()
        .where('project_id', '=', request.params.projectId)
        .orderBy('started_at')
        .execute();
      return { sessions: rows.map((r) => view(r)) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { actor: Actor; who: string } }>(
    '/api/projects/:projectId/session/start',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['actor', 'who'],
          additionalProperties: false,
          properties: { actor: { enum: ACTORS }, who },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      await loadProject(projectId);
      if (await openSession(projectId)) {
        throw new HttpError(409, { error: 'a session is already open on this project' });
      }
      const editor = request.body.who.trim();
      const row = await db()
        .transaction()
        .execute(async (trx) => {
          const s = await trx
            .insertInto('work_sessions')
            .values({ project_id: projectId, actor: request.body.actor, started_by: editor })
            .returningAll()
            .executeTakeFirstOrThrow();
          await logCountAction(trx, {
            projectId,
            action: 'session',
            who: editor,
            detail: { change: 'start', session_id: s.id, actor: s.actor },
          });
          return s;
        });
      return { session: view(row) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/session/end',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      await loadProject(projectId);
      const open = await openSession(projectId);
      if (!open) throw new HttpError(409, { error: 'no open session on this project' });
      const editor = request.body.who.trim();
      const row = await db()
        .transaction()
        .execute(async (trx) => {
          // logged while the session is still open, so the end row carries the session
          await logCountAction(trx, {
            projectId,
            action: 'session',
            who: editor,
            detail: { change: 'end', session_id: open.id, actor: open.actor },
          });
          return trx
            .updateTable('work_sessions')
            .set({ ended_at: new Date(), ended_by: editor })
            .where('id', '=', open.id)
            .returningAll()
            .executeTakeFirstOrThrow();
        });
      return { session: view(row) };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { kind: 'active' | 'leave'; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/page-event',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'sheetId'],
          properties: { projectId: uuid, sheetId: uuid },
        },
        body: {
          type: 'object',
          required: ['kind', 'who'],
          additionalProperties: false,
          properties: { kind: { enum: ['active', 'leave'] }, who },
        },
      },
    },
    async (request, reply) => {
      const { projectId, sheetId } = request.params;
      const s = await db()
        .selectFrom('sheets')
        .select('id')
        .where('id', '=', sheetId)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!s) throw new HttpError(404, { error: 'sheet not found' });
      await db()
        .insertInto('page_events')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          kind: request.body.kind,
          who: request.body.who.trim(),
        })
        .execute();
      return reply.status(204).send();
    },
  );

  async function timing(sessionId: string) {
    const s = await db()
      .selectFrom('work_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (!s) throw new HttpError(404, { error: 'session not found' });
    const actions = await db()
      .selectFrom('count_actions')
      .select(['sheet_id', 'created_at as at', 'action as kind'])
      .where('session_id', '=', s.id)
      .execute();
    const pings = await db()
      .selectFrom('page_events')
      .select(['sheet_id', 'created_at as at', 'kind'])
      .where('session_id', '=', s.id)
      .execute();
    const rows: SessionRow[] = [...actions, ...pings];
    const pages = sessionPageTimes(rows);
    const index = new Map(
      (
        await db()
          .selectFrom('sheets')
          .select(['id', 'page_index'])
          .where('project_id', '=', s.project_id)
          .execute()
      ).map((r) => [r.id, r.page_index]),
    );
    return {
      session: s,
      pages: pages.map((p) => ({ ...p, page_index: index.get(p.sheet_id) ?? -1 })),
    };
  }

  const sessionParams = {
    type: 'object',
    required: ['sessionId'],
    properties: { sessionId: uuid },
  } as const;

  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/timing',
    { schema: { params: sessionParams } },
    async (request) => {
      const t = await timing(request.params.sessionId);
      return { session: view(t.session), project_id: t.session.project_id, pages: t.pages };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/timing.csv',
    { schema: { params: sessionParams } },
    async (request, reply) => {
      const t = await timing(request.params.sessionId);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="session-${t.session.id.slice(0, 8)}-timing.csv"`,
        )
        .send(timingCsv(t.session, t.pages));
    },
  );
};
