// Members of the review screen (effective values with colors) and the link job for a view.
//   GET  /api/projects/:projectId/members[?sheet_id=&view_id=&include_deleted=true]
//   POST /api/projects/:projectId/views/:viewId/classes     enqueue classes_view (stroke classes + a suggestion)
//   POST /api/projects/:projectId/views/:viewId/link        enqueue link_view (the sheet must be included; scale and classes are flags)
//   GET  /api/projects/:projectId/views/:viewId/link-status  latest link job of the view
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, ViewBox } from '../db/types.js';
import { annotateSharedLines } from '../review/shared-line.js';
import { memberView, type EditRow, type ViewContext } from '../review/members.js';
import { loadSheetInclusions } from '../review/takeoff-sheets.js';
import { loadSheetOverrides } from '../review/overrides.js';
import { loadKinds } from '../review/kinds.js';
import { defaultCatalogLookup } from '../catalog/lookup.js';
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

export async function loadMemberViews(
  db: Kysely<Database>,
  projectId: string,
  filter: { sheetId?: string; viewId?: string; memberIds?: string[] } = {},
) {
  let q = db.selectFrom('members').selectAll().where('project_id', '=', projectId);
  if (filter.sheetId) q = q.where('sheet_id', '=', filter.sheetId);
  if (filter.viewId) q = q.where('view_id', '=', filter.viewId);
  if (filter.memberIds) q = q.where('id', 'in', filter.memberIds);
  const requested = await q.orderBy('created_at').orderBy('id').execute();
  if (requested.length === 0) return [];
  // shared lines are decided against every member of the sheet, so a single member is loaded with
  // its sheet's other members and only the requested ones are returned
  let rows = requested;
  const wanted = new Set(requested.map((r) => r.id));
  const sheetOf = [
    ...new Set(requested.map((r) => r.sheet_id).filter((s): s is string => s !== null)),
  ];
  if (sheetOf.length > 0 && (filter.memberIds || filter.viewId)) {
    const siblings = await db
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('sheet_id', 'in', sheetOf)
      .where('id', 'not in', [...wanted])
      .execute();
    rows = [...requested, ...siblings].sort(
      (a, b) => +a.created_at - +b.created_at || a.id.localeCompare(b.id),
    );
  }
  const edits = await db
    .selectFrom('member_edits')
    .select(['member_id', 'field_name', 'corrected_value', 'created_at'])
    .where(
      'member_id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const editsOf = new Map<string, EditRow[]>();
  for (const e of edits) {
    const list = editsOf.get(e.member_id) ?? [];
    list.push(e);
    editsOf.set(e.member_id, list);
  }
  const viewIds = [...new Set(rows.map((r) => r.view_id).filter((v): v is string => v !== null))];
  const views = viewIds.length
    ? await db.selectFrom('sheet_views').selectAll().where('id', 'in', viewIds).execute()
    : [];
  const ctx = new Map<string, ViewContext>(
    views.map((v) => [
      v.id,
      {
        id: v.id,
        box: v.box as ViewBox,
        scaleRatio: v.scale_ratio === null ? null : Number(v.scale_ratio),
        scaleConfirmed: v.scale_confirmed,
      },
    ]),
  );
  const sheetIds = [...new Set(rows.map((r) => r.sheet_id).filter((s): s is string => s !== null))];
  const sheets = sheetIds.length
    ? await db
        .selectFrom('sheets')
        .select(['id', 'level_guess'])
        .where('id', 'in', sheetIds)
        .execute()
    : [];
  const overrides = await loadSheetOverrides(db, sheetIds);
  const levelOf = new Map(
    sheets.map((s) => [s.id, overrides.get(s.id)?.level ?? s.level_guess ?? null] as const),
  );
  const lookups = { kinds: await loadKinds(db), catalog: await defaultCatalogLookup(db) };
  const out = rows.map((r) =>
    memberView(
      r,
      editsOf.get(r.id) ?? [],
      r.view_id ? (ctx.get(r.view_id) ?? null) : null,
      r.sheet_id ? (levelOf.get(r.sheet_id) ?? null) : null,
      lookups,
    ),
  );
  return annotateSharedLines(out).filter((m) => wanted.has(m.id));
}

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
