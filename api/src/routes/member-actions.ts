// Human actions on members. Every action is saved to member_edits (before, after, who, when),
// grouped by an action id; the stored (extracted) row is never changed.
//   POST  /api/projects/:projectId/members                    add a member by hand (column by point, or on a line)
//   PATCH /api/projects/:projectId/members/:memberId          profile text, mark, level, type, quantity
//   POST  /api/projects/:projectId/members/:memberId/link     { rank } or { line }
//   POST  /api/projects/:projectId/members/:memberId/confirm  "looks right"
//   POST  /api/projects/:projectId/members/:memberId/delete
//   POST  /api/projects/:projectId/members/:memberId/mark-ref { legend_row_id } or { status }
//   POST  /api/projects/:projectId/members/:memberId/shared-line { resolution: separate|merge, keep? }
//   POST  /api/projects/:projectId/members/:memberId/existing   { value: true|false }  existing steel (listed, not counted)
//   POST  /api/projects/:projectId/members/:memberId/not-member { reason: existing|misc_steel|detail|other|null }
//   POST  /api/projects/:projectId/undo                       undo the last action of this person
//                                                             (a piece edit or a view change)
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
import { logCountAction } from '../review/count-log.js';
import type { CountActionName } from '../db/types.js';
import type { Line, MemberView } from '../review/members.js';
import {
  applyEntries,
  confirmEntries,
  deleteEntries,
  linkEntries,
  markRefEntries,
  NOT_MEMBER_REASONS,
  existingEntries,
  notMemberEntries,
  type NotMemberReason,
  sharedLineEntries,
  OpError,
  patchEntries,
  kindEntries,
  sameTagMembers,
  lastUndoableAction,
  undoLastAction,
  redoLastUndo,
  type LegendChoice,
} from '../review/member-ops.js';
import { parseJoist } from '../review/joist.js';
import { parseProfile } from '../review/profile.js';
import { parseLengthMm } from '../units/parse.js';
import { loadKinds } from '../review/kinds.js';
import { tagPool } from '../review/tag-scope.js';
import { correctionLines } from '../review/corrections.js';
import { loadMemberViews } from './members.js';
import { lastViewChange, undoViewChange } from '../review/view-undo.js';
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
    tag_text: { type: ['string', 'null'], maxLength: 12 },
    length: { type: ['string', 'null'], maxLength: 40 },
    /** Apply the profile text to every piece with the same tag (mark) on the sheet; one action. */
    all_same_tag: { type: 'boolean' },
  },
} as const;
const kindBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    kind: { type: ['string', 'null'], maxLength: 80 },
    confirm: { type: 'boolean' },
    all_same_tag: { type: 'boolean' },
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
const notMemberBody = {
  type: 'object',
  required: ['who', 'reason'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    reason: { anyOf: [{ enum: [...NOT_MEMBER_REASONS] }, { type: 'null' }] },
  },
} as const;
const existingBody = {
  type: 'object',
  required: ['who', 'value'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    value: { type: 'boolean' },
  },
} as const;
const sharedLineBody = {
  type: 'object',
  required: ['who', 'resolution'],
  additionalProperties: false,
  properties: {
    who: { type: 'string', minLength: 1, maxLength: 100 },
    resolution: { enum: ['separate', 'merge'] },
    keep: uuid,
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
      // a joist designation makes a joist (never matched to the AISC catalog)
      const type: CreateBody['type'] =
        b.type !== 'column' && profileText && parseJoist(profileText) ? 'joist' : b.type;
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
        type,
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
              type,
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
    action: CountActionName = 'edit',
  ) {
    const name = who.trim();
    if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
    const before = await stateOf(projectId, memberPk);
    try {
      const entries = await build(before);
      const actionId = await applyEntries(db(), name, entries);
      if (actionId) {
        await logCountAction(db(), {
          projectId,
          sheetId: before.sheet_id,
          memberId: memberPk,
          action,
          who: name,
          editActionId: actionId,
          detail: { fields: [...new Set(entries.map((e) => e.field))] },
        });
      }
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
      tag_text?: string | null;
      length?: string | null;
      all_same_tag?: boolean;
    };
  }>(
    '/api/projects/:projectId/members/:memberId',
    { schema: { params: memberParams, body: patchBody } },
    async (request) => {
      const { projectId, memberId } = request.params;
      const { all_same_tag: allSameTag, ...patch } = request.body;
      return act(projectId, memberId, request.body.who, async (m) => {
        const own = patchEntries(
          m,
          (await memberOverride(memberId, 'level')) as string | null,
          patch,
        );
        if (patch.tag_text && patch.tag_text.trim() !== '') {
          const wanted = patch.tag_text.trim().toUpperCase();
          const clash = (await tagPoolOf(projectId, m)).find(
            (o) =>
              o.id !== m.id &&
              !o.deleted &&
              o.count.state !== 'rejected' &&
              o.tag.text.toUpperCase() === wanted,
          );
          if (clash) throw new OpError(409, `the tag ${wanted} is already used on this sheet`);
        }
        if (!allSameTag) return own;
        if (patch.profile_text === undefined)
          throw new OpError(
            400,
            'only the size (profile text) can be applied to all pieces with this tag',
          );
        const others = sameTagMembers(m, await sheetMembersOf(projectId, m));
        const rest = others.flatMap((o) =>
          patchEntries(o, null, { profile_text: patch.profile_text }),
        );
        return [...own, ...rest];
      });
    },
  );

  /** The members a tag of this one must not collide with (the job or the sheet, by the project's setting). */
  async function tagPoolOf(projectId: string, m: MemberView): Promise<MemberView[]> {
    return tagPool(db(), projectId, await sheetMembersOf(projectId, m));
  }

  /** Every member of the sheet of this one, with effective values. */
  async function sheetMembersOf(projectId: string, m: MemberView): Promise<MemberView[]> {
    return m.sheet_id ? loadMemberViews(db(), projectId, { sheetId: m.sheet_id }) : [m];
  }

  app.get('/api/member-kinds', async () => ({
    kinds: [...(await loadKinds(db())).values()].map((k) => ({
      kind: k.kind,
      scope: k.scope,
      symbol_group: k.symbol_group,
      prefix: k.prefix,
      provisional: k.provisional,
      sort: k.sort,
    })),
  }));

  /** What was changed on this member, by whom and when, with the value before (nothing is hidden). */
  app.get<{ Params: { projectId: string; memberId: string } }>(
    '/api/projects/:projectId/members/:memberId/history',
    { schema: { params: memberParams } },
    async (request) => {
      await stateOf(request.params.projectId, request.params.memberId);
      const rows = await db()
        .selectFrom('member_edits')
        .select([
          'field_name',
          'original_value',
          'corrected_value',
          'reviewer',
          'created_at',
          'action_id',
          'undo_of_action_id',
        ])
        .where('member_id', '=', request.params.memberId)
        .where('field_name', '!=', '__created__')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      return {
        edits: rows.map((r) => ({
          field: r.field_name,
          before: r.original_value,
          after: r.corrected_value,
          who: r.reviewer,
          at: new Date(r.created_at as unknown as string).toISOString(),
          action_id: r.action_id,
          is_undo: r.undo_of_action_id !== null,
        })),
      };
    },
  );

  /** How many other pieces share this piece's tag: shown before the "apply to all" click. */
  app.get<{ Params: { projectId: string; memberId: string } }>(
    '/api/projects/:projectId/members/:memberId/same-tag',
    { schema: { params: memberParams } },
    async (request) => {
      const m = await stateOf(request.params.projectId, request.params.memberId);
      const others = sameTagMembers(m, await sheetMembersOf(request.params.projectId, m));
      return {
        basis: m.mark !== null ? 'mark' : 'profile text',
        count: others.length,
        member_ids: others.map((o) => o.id),
      };
    },
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; kind?: string | null; confirm?: boolean; all_same_tag?: boolean };
  }>(
    '/api/projects/:projectId/members/:memberId/kind',
    { schema: { params: memberParams, body: kindBody } },
    async (request) => {
      const { projectId, memberId } = request.params;
      const { kind, confirm, all_same_tag: allSameTag } = request.body;
      if (kind === undefined && !confirm)
        throw new HttpError(400, { error: 'give a kind (or null) or confirm' });
      return act(projectId, memberId, request.body.who, async (m) => {
        const sheet = await sheetMembersOf(projectId, m);
        const targets = [m, ...(allSameTag ? sameTagMembers(m, sheet) : [])];
        return kindEntries(targets, await tagPoolOf(projectId, m), await loadKinds(db()), {
          kind,
          confirm,
        });
      });
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
      act(
        request.params.projectId,
        request.params.memberId,
        request.body.who,
        deleteEntries,
        'delete',
      ),
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

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; value: boolean };
  }>(
    '/api/projects/:projectId/members/:memberId/existing',
    { schema: { params: memberParams, body: existingBody } },
    async (request) =>
      act(request.params.projectId, request.params.memberId, request.body.who, (m) =>
        existingEntries(m, request.body.value),
      ),
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; reason: NotMemberReason | null };
  }>(
    '/api/projects/:projectId/members/:memberId/not-member',
    { schema: { params: memberParams, body: notMemberBody } },
    async (request) =>
      act(request.params.projectId, request.params.memberId, request.body.who, (m) =>
        notMemberEntries(m, request.body.reason),
      ),
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; resolution: 'separate' | 'merge'; keep?: string };
  }>(
    '/api/projects/:projectId/members/:memberId/shared-line',
    { schema: { params: memberParams, body: sharedLineBody } },
    async (request) => {
      const { projectId, memberId } = request.params;
      const { resolution, keep } = request.body;
      return act(projectId, memberId, request.body.who, async (m) => {
        const all = m.sheet_id
          ? await loadMemberViews(db(), projectId, { sheetId: m.sheet_id })
          : [m];
        return sharedLineEntries(
          m,
          all,
          resolution === 'merge' ? { resolution, keep } : { resolution },
        );
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
      // the latest of a piece edit and a view change (add, delete, box) is undone
      const view = await lastViewChange(db(), projectId, who);
      if (view) {
        const member = await lastUndoableAction(db(), projectId, who);
        if (!member || new Date(view.created_at as unknown as Date) >= new Date(member.at))
          return { undone: null, rows: 0, view: await undoViewChange(db(), view, who) };
      }
      const result = await undoLastAction(db(), projectId, who, async (id) => {
        const [m] = await loadMemberViews(db(), projectId, { memberIds: [id] });
        return m ?? null;
      });
      if (!result.undone) throw new HttpError(409, { error: 'nothing to undo' });
      await logUndoRedo(projectId, who, 'undo', result.undone, result.undone);
      return result;
    },
  );

  /** Log an undo or redo with the sheet and member of the action it touched. */
  async function logUndoRedo(
    projectId: string,
    who: string,
    action: 'undo' | 'redo',
    editActionId: string,
    touched: string,
  ) {
    const row = await db()
      .selectFrom('member_edits as e')
      .innerJoin('members as m', 'm.id', 'e.member_id')
      .select(['m.id as member_id', 'm.sheet_id'])
      .where('e.action_id', '=', touched)
      .orderBy('e.id')
      .executeTakeFirst();
    await logCountAction(db(), {
      projectId,
      sheetId: row?.sheet_id ?? null,
      memberId: row?.member_id ?? null,
      action,
      who,
      editActionId,
      detail: { of_action: touched },
    });
  }

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/redo',
    { schema: { params: projectParams, body: whoOnly } },
    async (request) => {
      const { projectId } = request.params;
      const who = request.body.who.trim();
      if (who === '') throw new HttpError(400, { error: 'who must not be blank' });
      const result = await redoLastUndo(db(), projectId, who);
      if (!result.redone) throw new HttpError(409, { error: 'nothing to redo' });
      await logUndoRedo(projectId, who, 'redo', result.redone, result.undone_action as string);
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
          'l.source',
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
          bbox: ((r.source ?? {}) as { bbox?: unknown }).bbox ?? null,
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
