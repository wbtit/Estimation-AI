// Human actions on members. Every action is saved to member_edits (before, after, who, when),
// grouped by an action id; the stored (extracted) row is never changed.
//   POST  /api/projects/:projectId/members                    add a member by hand (column by point, or on a line)
//   PATCH /api/projects/:projectId/members/:memberId          profile text, mark, level, type, quantity
//   POST  /api/projects/:projectId/members/:memberId/link     { rank } or { line }
//   POST  /api/projects/:projectId/members/:memberId/confirm  "looks right"
//   POST  /api/projects/:projectId/members/:memberId/delete
//   POST  /api/projects/:projectId/members/:memberId/mark-ref { legend_row_id } or { status }
//   POST  /api/projects/:projectId/undo                       undo the last action of this person
//   GET   /api/projects/:projectId/legend?mark=               legend rows
//   GET   /api/projects/:projectId/views/:viewId/lines        structural lines of a view (click targets)
//   GET   /api/projects/:projectId/corrections.jsonl          all corrections as JSON lines
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, ViewBox } from '../db/types.js';
import { planXY } from '../review/geometry.js';
import { recordAction } from '../review/actions.js';
import type { Line, MemberView } from '../review/members.js';
import {
  applyEntries,
  confirmEntries,
  deleteEntries,
  linkEntries,
  markRefEntries,
  OpError,
  patchEntries,
  undoLastAction,
  type LegendChoice,
} from '../review/member-ops.js';
import { parseProfile } from '../review/profile.js';
import { parseLengthMm } from '../units/parse.js';
import { correctionLines } from '../review/corrections.js';
import { loadMemberViews } from './members.js';
import { HttpError } from './http-error.js';

export interface MemberActionOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const pointPair = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } as const;
const lineSchema = {
  type: 'object',
  required: ['p', 'q'],
  additionalProperties: false,
  properties: { p: pointPair, q: pointPair },
} as const;
const memberParams = {
  type: 'object',
  required: ['projectId', 'memberId'],
  properties: { projectId: uuid, memberId: uuid },
} as const;
const whoOnly = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: { who: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;
const patchBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    profile_text: { type: ['string', 'null'], maxLength: 80 },
    mark: { type: ['string', 'null'], maxLength: 40 },
    level: { type: ['string', 'null'], maxLength: 60 },
    type: { enum: ['column', 'beam', 'brace', 'joist', 'other'] },
    quantity: { type: 'integer', minimum: 1, maximum: 999 },
  },
} as const;
const linkBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    rank: { type: 'integer', minimum: 1, maximum: 3 },
    line: lineSchema,
  },
} as const;
const markRefBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    legend_row_id: uuid,
    status: { enum: ['linked', 'no_legend_row', 'ambiguous'] },
  },
} as const;
const legendQuery = {
  type: 'object',
  properties: { mark: { type: 'string', maxLength: 40 } },
  additionalProperties: false,
} as const;
const viewParams = {
  type: 'object',
  required: ['projectId', 'viewId'],
  properties: { projectId: uuid, viewId: uuid },
} as const;

const createBody = {
  type: 'object',
  required: ['view_id', 'type', 'point', 'who'],
  additionalProperties: false,
  properties: {
    view_id: uuid,
    type: { enum: ['column', 'beam', 'brace', 'joist', 'other'] },
    mark: { type: ['string', 'null'], maxLength: 40 },
    profile_text: { type: ['string', 'null'], maxLength: 80 },
    point: {
      type: 'object',
      required: ['x', 'y'],
      additionalProperties: false,
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    base_elevation: { type: ['string', 'null'], maxLength: 40 },
    top_elevation: { type: ['string', 'null'], maxLength: 40 },
    line: lineSchema,
    who: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;

interface CreateBody {
  view_id: string;
  type: 'column' | 'beam' | 'brace' | 'joist' | 'other';
  mark?: string | null;
  profile_text?: string | null;
  point: { x: number; y: number };
  base_elevation?: string | null;
  top_elevation?: string | null;
  line?: Line;
  who: string;
}

export const memberActionRoutes: FastifyPluginAsync<MemberActionOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  app.post<{ Params: { projectId: string }; Body: CreateBody }>(
    '/api/projects/:projectId/members',
    { schema: { params: projectParams, body: createBody } },
    async (request, reply) => {
      const { projectId } = request.params;
      const b = request.body;
      const who = b.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const view = await db()
        .selectFrom('sheet_views as v')
        .innerJoin('sheets as s', 's.id', 'v.sheet_id')
        .select(['v.id', 'v.sheet_id', 'v.box', 'v.scale_ratio', 'v.scale_confirmed'])
        .where('v.id', '=', b.view_id)
        .where('s.project_id', '=', projectId)
        .executeTakeFirst();
      if (!view) throw new HttpError(404, { error: 'view not found' });
      const box = view.box as ViewBox;
      if (b.point.x < box.x0 || b.point.x > box.x1 || b.point.y < box.y0 || b.point.y > box.y1) {
        throw new HttpError(400, { error: 'the point is outside the view' });
      }
      if (b.type !== 'column' && !b.line) {
        throw new HttpError(400, { error: 'click the line the new member lies on' });
      }
      const profileText = b.profile_text?.trim() || null;
      const parsed = profileText ? parseProfile(profileText) : null;
      const parseElev = (text: string | null | undefined, label: string): number | null => {
        if (text === undefined || text === null || text.trim() === '') return null;
        const mm = parseLengthMm(text);
        if (mm === null)
          throw new HttpError(400, { error: `${label} is not a length (use 12'-6", 3000 mm)` });
        return mm;
      };
      const base = parseElev(b.base_elevation, 'base elevation');
      const top = parseElev(b.top_elevation, 'top elevation');
      const ratio =
        view.scale_confirmed && view.scale_ratio !== null ? Number(view.scale_ratio) : null;
      const [px, py] = ratio ? planXY(box, ratio, b.point) : [null, null];
      const lineEnds =
        b.line && ratio
          ? [
              planXY(box, ratio, { x: b.line.p[0], y: b.line.p[1] }),
              planXY(box, ratio, { x: b.line.q[0], y: b.line.q[1] }),
            ]
          : null;
      const round1 = (v: number | null | undefined) =>
        v === null || v === undefined ? null : Math.round(v * 10) / 10;
      const memberId = `M-${randomUUID().slice(0, 12)}`;
      const summary = {
        type: b.type,
        mark: b.mark?.trim() || null,
        profile_raw: profileText,
        profile: parsed?.canonical ?? null,
      };

      const id = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .insertInto('members')
            .values({
              project_id: projectId,
              sheet_id: view.sheet_id,
              view_id: view.id,
              plan_sheet_id: view.sheet_id,
              member_id: memberId,
              origin: 'manual',
              type: b.type,
              mark: summary.mark,
              profile_raw: profileText,
              profile: summary.profile,
              start_elevation_mm: base,
              end_elevation_mm: top,
              quantity: 1,
              plan_start_x_mm: round1(lineEnds ? lineEnds[0][0] : px),
              plan_start_y_mm: round1(lineEnds ? lineEnds[0][1] : (py as number | null)),
              plan_end_x_mm: round1(lineEnds?.[1][0]),
              plan_end_y_mm: round1(lineEnds?.[1][1]),
              plan_bbox: b.line
                ? JSON.stringify({
                    x0: Math.min(b.line.p[0], b.line.q[0]),
                    y0: Math.min(b.line.p[1], b.line.q[1]),
                    x1: Math.max(b.line.p[0], b.line.q[0]),
                    y1: Math.max(b.line.p[1], b.line.q[1]),
                  })
                : null,
              plan_scale_ratio: ratio,
              plan_method: 'manual',
              length_source: b.type === 'column' ? 'manual' : 'plan_geometry',
              source_bbox: JSON.stringify({
                x0: b.point.x - 6,
                y0: b.point.y - 6,
                x1: b.point.x + 6,
                y1: b.point.y + 6,
              }),
              field_sources: '{}',
              field_confidence: '{}',
              review_status: 'edited',
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow();
          await recordAction(trx, who, [
            {
              memberId: row.id,
              field: '__created__',
              before: null,
              after: summary,
              status: 'edited',
            },
            ...(b.line
              ? [
                  {
                    memberId: row.id,
                    field: 'link',
                    before: { reset: true },
                    after: { line: b.line, rank: null },
                    status: 'edited' as const,
                  },
                ]
              : []),
          ]);
          return row.id;
        });
      const [created] = await loadMemberViews(db(), projectId, { memberIds: [id] });
      return reply.status(201).send(created);
    },
  );

  async function stateOf(projectId: string, memberPk: string): Promise<MemberView> {
    const [m] = await loadMemberViews(db(), projectId, { memberIds: [memberPk] });
    if (!m) throw new HttpError(404, { error: 'member not found' });
    return m;
  }

  /** The member-level override of a field (latest edit), or null when there is none. */
  async function memberOverride(memberPk: string, field: string): Promise<unknown> {
    const row = await db()
      .selectFrom('member_edits')
      .select('corrected_value')
      .where('member_id', '=', memberPk)
      .where('field_name', '=', field)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? row.corrected_value : null;
  }

  async function act(
    projectId: string,
    memberPk: string,
    who: string,
    build: (
      m: MemberView,
    ) => Promise<ReturnType<typeof patchEntries>> | ReturnType<typeof patchEntries>,
  ) {
    const name = who.trim();
    if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
    const before = await stateOf(projectId, memberPk);
    try {
      const entries = await build(before);
      const actionId = await applyEntries(db(), name, entries);
      return {
        action_id: actionId,
        changed: entries.length > 0,
        member: await stateOf(projectId, memberPk),
      };
    } catch (err) {
      if (err instanceof OpError) throw new HttpError(err.status, { error: err.message });
      throw err;
    }
  }

  app.patch<{
    Params: { projectId: string; memberId: string };
    Body: {
      who: string;
      profile_text?: string | null;
      mark?: string | null;
      level?: string | null;
      type?: string;
      quantity?: number;
    };
  }>(
    '/api/projects/:projectId/members/:memberId',
    { schema: { params: memberParams, body: patchBody } },
    async (request) => {
      const { projectId, memberId } = request.params;
      return act(projectId, memberId, request.body.who, async (m) =>
        patchEntries(m, (await memberOverride(memberId, 'level')) as string | null, request.body),
      );
    },
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; rank?: number; line?: Line };
  }>(
    '/api/projects/:projectId/members/:memberId/link',
    { schema: { params: memberParams, body: linkBody } },
    async (request) => {
      const { projectId, memberId } = request.params;
      const { rank, line } = request.body;
      return act(projectId, memberId, request.body.who, (m) => linkEntries(m, { rank, line }));
    },
  );

  app.post<{ Params: { projectId: string; memberId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/members/:memberId/confirm',
    { schema: { params: memberParams, body: whoOnly } },
    async (request) =>
      act(request.params.projectId, request.params.memberId, request.body.who, confirmEntries),
  );

  app.post<{ Params: { projectId: string; memberId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/members/:memberId/delete',
    { schema: { params: memberParams, body: whoOnly } },
    async (request) =>
      act(request.params.projectId, request.params.memberId, request.body.who, deleteEntries),
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; legend_row_id?: string; status?: LegendChoice['status'] };
  }>(
    '/api/projects/:projectId/members/:memberId/mark-ref',
    { schema: { params: memberParams, body: markRefBody } },
    async (request) => {
      const { projectId, memberId } = request.params;
      const { legend_row_id, status } = request.body;
      return act(projectId, memberId, request.body.who, async (m) => {
        if (legend_row_id) {
          const row = await db()
            .selectFrom('legend_rows')
            .select(['id', 'mark', 'designation_raw', 'profile'])
            .where('id', '=', legend_row_id)
            .where('project_id', '=', projectId)
            .executeTakeFirst();
          if (!row) throw new OpError(404, 'legend row not found');
          return markRefEntries(m, { status: 'linked', row });
        }
        if (!status) throw new OpError(400, 'give a legend row or a status');
        return markRefEntries(m, { status });
      });
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/undo',
    { schema: { params: projectParams, body: whoOnly } },
    async (request) => {
      const { projectId } = request.params;
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const result = await undoLastAction(db(), projectId, who, async (id) => {
        const [m] = await loadMemberViews(db(), projectId, { memberIds: [id] });
        return m ?? null;
      });
      if (!result.undone) throw new HttpError(409, { error: 'nothing to undo' });
      return result;
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { mark?: string } }>(
    '/api/projects/:projectId/legend',
    { schema: { params: projectParams, querystring: legendQuery } },
    async (request) => {
      let q = db()
        .selectFrom('legend_rows as l')
        .innerJoin('sheets as s', 's.id', 'l.sheet_id')
        .select([
          'l.id',
          'l.mark',
          'l.designation_raw',
          'l.profile',
          'l.remarks_raw',
          's.page_index',
        ])
        .where('l.project_id', '=', request.params.projectId);
      if (request.query.mark) q = q.where('l.mark', '=', request.query.mark);
      const rows = await q.orderBy('l.mark').orderBy('s.page_index').execute();
      return {
        rows: rows.map((r) => ({
          id: r.id,
          mark: r.mark,
          designation_raw: r.designation_raw,
          profile: r.profile,
          remarks_raw: r.remarks_raw,
          page_number: r.page_index + 1,
        })),
      };
    },
  );

  app.get<{ Params: { projectId: string; viewId: string } }>(
    '/api/projects/:projectId/views/:viewId/lines',
    { schema: { params: viewParams } },
    async (request) => {
      const row = await db()
        .selectFrom('sheet_views as v')
        .innerJoin('sheets as s', 's.id', 'v.sheet_id')
        .select(['v.structural_lines', 'v.structural_classes'])
        .where('v.id', '=', request.params.viewId)
        .where('s.project_id', '=', request.params.projectId)
        .executeTakeFirst();
      if (!row) throw new HttpError(404, { error: 'view not found' });
      return { classes: row.structural_classes, lines: row.structural_lines ?? [] };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/corrections.jsonl',
    { schema: { params: projectParams } },
    async (request, reply) => {
      const lines = await correctionLines(db(), request.params.projectId);
      return reply
        .header('content-type', 'application/x-ndjson')
        .header('content-disposition', 'attachment; filename="corrections.jsonl"')
        .send(lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
    },
  );
};
