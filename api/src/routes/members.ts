// Members of the review screen (effective values with colors) and the link job for a view.
//   GET  /api/projects/:projectId/members[?sheet_id=&view_id=&include_deleted=true]
//   POST /api/projects/:projectId/views/:viewId/classes     enqueue classes_view (stroke classes + a suggestion)
//   POST /api/projects/:projectId/views/:viewId/link        enqueue link_view (the sheet must be included; scale and classes are flags)
//   GET  /api/projects/:projectId/views/:viewId/link-status  latest link job of the view
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database } from '../db/types.js';
import { loadMemberViews } from '../review/member-views.js';
import { loadSheetInclusions } from '../review/takeoff-sheets.js';
import { HttpError } from './http-error.js';

export interface MemberRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const viewParams = {
  type: 'object',
  required: ['projectId', 'viewId'],
  properties: { projectId: uuid, viewId: uuid },
} as const;
const listQuery = {
  type: 'object',
  properties: {
    sheet_id: uuid,
    view_id: uuid,
    include_deleted: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

export const memberRoutes: FastifyPluginAsync<MemberRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { sheet_id?: string; view_id?: string; include_deleted?: boolean };
  }>(
    '/api/projects/:projectId/members',
    { schema: { params: projectParams, querystring: listQuery } },
    async (request) => {
      const { projectId } = request.params;
      const project = await db()
        .selectFrom('projects')
        .select('id')
        .where('id', '=', projectId)
        .executeTakeFirst();
      if (!project) throw new HttpError(404, { error: 'project not found' });
      const all = await loadMemberViews(db(), projectId, {
        sheetId: request.query.sheet_id,
        viewId: request.query.view_id,
      });
      const members = request.query.include_deleted
        ? all
        : all.filter((m) => !m.deleted && m.not_member === null);
      const counts = { green: 0, amber: 0, red: 0, unlinked: 0 };
      for (const m of members) counts[m.status.color] += 1;
      return { count: members.length, colors: counts, members };
    },
  );

  async function loadView(projectId: string, viewId: string) {
    const view = await db()
      .selectFrom('sheet_views as v')
      .innerJoin('sheets as s', 's.id', 'v.sheet_id')
      .select(['v.id', 'v.sheet_id', 's.project_id'])
      .where('v.id', '=', viewId)
      .where('s.project_id', '=', projectId)
      .executeTakeFirst();
    if (!view) throw new HttpError(404, { error: 'view not found' });
    return view;
  }

  app.post<{ Params: { projectId: string; viewId: string } }>(
    '/api/projects/:projectId/views/:viewId/link',
    { schema: { params: viewParams } },
    async (request, reply) => {
      const { projectId, viewId } = request.params;
      const view = await loadView(projectId, viewId);
      const inclusion = (await loadSheetInclusions(db(), projectId)).find(
        (s) => s.sheet_id === view.sheet_id,
      );
      if (inclusion && !inclusion.included) {
        throw new HttpError(409, {
          error:
            inclusion.decision === 'exclude'
              ? 'this sheet is excluded from the takeoff; include it first'
              : `this sheet is excluded by default (page type guess: ${inclusion.page_type ?? 'unknown'}); include it first`,
        });
      }
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
        .where('type', '=', 'link_view')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql<boolean>`payload->>'view_id' = ${viewId}`)
        .executeTakeFirst();
      if (open)
        throw new HttpError(409, {
          error: 'members are already being found for this view',
          job_id: open.id,
        });
      const job = await db()
        .insertInto('jobs')
        .values({ type: 'link_view', payload: JSON.stringify({ view_id: viewId }) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.status(202).send({ job_id: job.id, status: 'pending' });
    },
  );

  /** Tabulate the stroke classes of a view and suggest the member class (a suggestion only). */
  app.post<{ Params: { projectId: string; viewId: string } }>(
    '/api/projects/:projectId/views/:viewId/classes',
    { schema: { params: viewParams } },
    async (request, reply) => {
      const { projectId, viewId } = request.params;
      await loadView(projectId, viewId);
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
        .where('type', '=', 'classes_view')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql<boolean>`payload->>'view_id' = ${viewId}`)
        .executeTakeFirst();
      if (open) return reply.status(202).send({ job_id: open.id, status: 'pending' });
      const job = await db()
        .insertInto('jobs')
        .values({ type: 'classes_view', payload: JSON.stringify({ view_id: viewId }) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return reply.status(202).send({ job_id: job.id, status: 'pending' });
    },
  );

  app.get<{ Params: { projectId: string; viewId: string } }>(
    '/api/projects/:projectId/views/:viewId/classes-status',
    { schema: { params: viewParams } },
    async (request) => {
      const { projectId, viewId } = request.params;
      await loadView(projectId, viewId);
      const job = await db()
        .selectFrom('jobs')
        .select(['id', 'status', 'result', 'error', 'created_at'])
        .where('type', '=', 'classes_view')
        .where(sql<boolean>`payload->>'view_id' = ${viewId}`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return { job: job ?? null };
    },
  );

  app.get<{ Params: { projectId: string; viewId: string } }>(
    '/api/projects/:projectId/views/:viewId/link-status',
    { schema: { params: viewParams } },
    async (request) => {
      const { projectId, viewId } = request.params;
      await loadView(projectId, viewId);
      const job = await db()
        .selectFrom('jobs')
        .select(['id', 'status', 'result', 'error', 'created_at'])
        .where('type', '=', 'link_view')
        .where(sql<boolean>`payload->>'view_id' = ${viewId}`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return { job: job ?? null };
    },
  );
};
