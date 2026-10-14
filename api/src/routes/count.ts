// The counting copilot (Phase 8): the system suggests, the estimator confirms with clicks, every
// count keeps evidence. Everything a person does here is an undoable edit (member_edits) and a row of
// the action log (count_actions).
//   GET  /api/projects/:projectId/count                              settings (count mode, radii)
//   PUT  /api/projects/:projectId/count                              change them (a log row)
//   POST /api/projects/:projectId/sheets/:sheetId/lines/prepare      ask the worker for the sheet's lines (any class)
//   GET  /api/projects/:projectId/sheets/:sheetId/lines              the lines (snap targets, drawn client side)
//   POST /api/projects/:projectId/count/click                        a click with a kind: a new confirmed piece
//   POST /api/projects/:projectId/members/:memberId/count-decision   accept / reject / reset a suggestion
//   GET  /api/projects/:projectId/count-actions                      the action log (+ time per page and person)
//   POST /api/projects/:projectId/measure                            preview a two-click measurement (nothing saved)
//   POST /api/projects/:projectId/measurements                       save one
//   GET  /api/projects/:projectId/measurements?sheet_id=             saved ones
//   POST /api/projects/:projectId/members/:memberId/attach-measurement   a measured length becomes the piece's length
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { getDb } from '../db/client.js';
import type { Database, ViewBox } from '../db/types.js';
import { planXY } from '../review/geometry.js';
import { recordAction } from '../review/actions.js';
import { logCountAction, pageTimes } from '../review/count-log.js';
import { loadKinds, typeOfKind } from '../review/kinds.js';
import { nextTagNumber } from '../review/member-ops.js';
import { parseJoist } from '../review/joist.js';
import { parseProfile } from '../review/profile.js';
import { measureTwoClicks, scaleViewFor, DEFAULT_MEASURE_SNAP_PT } from '../review/measure.js';
import { fillSize } from '../review/size-fill.js';
import { nearestLine, type LineRow } from '../review/snap.js';
import type { MemberView } from '../review/members.js';
import { loadMemberViews } from './members.js';
import { HttpError } from './http-error.js';

export interface CountRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
const memberParams = {
  type: 'object',
  required: ['projectId', 'memberId'],
  properties: { projectId: uuid, memberId: uuid },
} as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const pointSchema = {
  type: 'object',
  required: ['x', 'y'],
  additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
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

  async function settings(projectId: string) {
    const p = await db()
      .selectFrom('projects')
      .select(['id', 'count_mode', 'snap_radius_pt', 'label_radius_pt'])
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    return {
      count_mode: p.count_mode,
      snap_radius_pt: Number(p.snap_radius_pt),
      label_radius_pt: Number(p.label_radius_pt),
    };
  }

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
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/count',
    { schema: { params: projectParams } },
    async (request) => settings(request.params.projectId),
  );

  app.put<{
    Params: { projectId: string };
    Body: {
      who: string;
      count_mode?: boolean;
      snap_radius_pt?: number;
      label_radius_pt?: number;
    };
  }>(
    '/api/projects/:projectId/count',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            who,
            count_mode: { type: 'boolean' },
            snap_radius_pt: { type: 'number', exclusiveMinimum: 0, maximum: 200 },
            label_radius_pt: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const b = request.body;
      const name = b.who.trim();
      if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
      const before = await settings(projectId);
      const set: Record<string, unknown> = {};
      if (b.count_mode !== undefined) set.count_mode = b.count_mode;
      if (b.snap_radius_pt !== undefined) set.snap_radius_pt = b.snap_radius_pt;
      if (b.label_radius_pt !== undefined) set.label_radius_pt = b.label_radius_pt;
      if (Object.keys(set).length > 0) {
        await db().updateTable('projects').set(set).where('id', '=', projectId).execute();
        await logCountAction(db(), {
          projectId,
          action: 'mode',
          who: name,
          detail: { before, change: set },
        });
      }
      return settings(projectId);
    },
  );

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

  // ---- a click makes a piece -------------------------------------------------------------------
  interface ClickBody {
    who: string;
    sheet_id: string;
    kind: string;
    x: number;
    y: number;
    radius?: number;
    label_radius?: number;
  }
  app.post<{ Params: { projectId: string }; Body: ClickBody }>(
    '/api/projects/:projectId/count/click',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'sheet_id', 'kind', 'x', 'y'],
          additionalProperties: false,
          properties: {
            who,
            sheet_id: uuid,
            kind: { type: 'string', minLength: 1, maxLength: 80 },
            x: { type: 'number' },
            y: { type: 'number' },
            radius: { type: 'number', exclusiveMinimum: 0, maximum: 200 },
            label_radius: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const b = request.body;
      const name = b.who.trim();
      if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
      const cfg = await settings(projectId);
      const sheet = await sheetOf(projectId, b.sheet_id);
      const w = sheet.width_pt === null ? null : Number(sheet.width_pt);
      const h = sheet.height_pt === null ? null : Number(sheet.height_pt);
      if (w !== null && h !== null && (b.x < 0 || b.x > w || b.y < 0 || b.y > h)) {
        throw new HttpError(400, { error: 'the click is outside the page' });
      }
      const kinds = await loadKinds(db());
      const kindInfo = kinds.get(b.kind);
      if (!kindInfo) throw new HttpError(400, { error: `"${b.kind}" is not a kind of the list` });
      const radius = b.radius ?? cfg.snap_radius_pt;
      const labelRadius = b.label_radius ?? cfg.label_radius_pt;
      const clickedAt = new Date();

      // snap: the nearest extracted line of ANY class; a click is never dropped
      const lines = await loadLines(b.sheet_id);
      let snappedLine: {
        id: number;
        p: [number, number];
        q: [number, number];
        class: string | null;
        version: string | null;
      } | null = null;
      let snapDistance: number | null = null;
      if (lines) {
        const hit = nearestLine(lines.lines as LineRow[], b.x, b.y, radius);
        if (hit) {
          const l = lines.lines[hit.index] as number[];
          snappedLine = {
            id: hit.index,
            p: [l[0] as number, l[1] as number],
            q: [l[2] as number, l[3] as number],
            class: lines.classes[l[4] as number] ?? null,
            version: lines.version,
          };
          snapDistance = Math.round(hit.distance * 10) / 10;
        }
      }

      const sheetMembers = await loadMemberViews(db(), projectId, { sheetId: b.sheet_id });
      const size = fillSize(
        { x: b.x, y: b.y },
        snappedLine ? { p: snappedLine.p, q: snappedLine.q } : null,
        sheetMembers,
        labelRadius,
      );
      const parsed = size.profile_text ? parseProfile(size.profile_text) : null;
      const type = typeOfKind(kindInfo, 'beam');
      const prefix = kindInfo.prefix;
      const number = nextTagNumber(sheetMembers, prefix);
      const view = await db()
        .selectFrom('sheet_views')
        .select(['id', 'box', 'scale_ratio', 'scale_confirmed'])
        .where('sheet_id', '=', b.sheet_id)
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirst();
      const ratio =
        view && view.scale_confirmed && view.scale_ratio !== null ? Number(view.scale_ratio) : null;
      const round1 = (v: number) => Math.round(v * 10) / 10;
      const [px, py] =
        view && ratio ? planXY(view.box as ViewBox, ratio, { x: b.x, y: b.y }) : [null, null];
      const memberId = `M-${randomUUID().slice(0, 12)}`;
      const summary = {
        type,
        kind: b.kind,
        profile_raw: size.profile_text,
        profile: parsed?.canonical ?? null,
        size_source: size.source,
      };

      const id = await db()
        .transaction()
        .execute(async (trx) => {
          const row = await trx
            .insertInto('members')
            .values({
              project_id: projectId,
              sheet_id: b.sheet_id,
              view_id: view?.id ?? null,
              plan_sheet_id: b.sheet_id,
              member_id: memberId,
              origin: 'manual',
              type:
                type === 'joist' && size.profile_text && parseJoist(size.profile_text)
                  ? 'joist'
                  : type,
              profile_raw: size.profile_text,
              profile: parsed?.canonical ?? null,
              kind: b.kind,
              kind_source: 'person',
              kind_confirmed: true,
              tag_prefix: prefix,
              tag_number: number,
              quantity: 1,
              plan_start_x_mm: px === null ? null : round1(px),
              plan_start_y_mm: py === null ? null : round1(py as number),
              plan_scale_ratio: ratio,
              plan_method: 'manual',
              length_source: 'plan_geometry',
              source_bbox: JSON.stringify({
                x0: b.x - 6,
                y0: b.y - 6,
                x1: b.x + 6,
                y1: b.y + 6,
              }),
              field_sources: '{}',
              field_confidence: '{}',
              review_status: 'edited',
              count_state: 'confirmed',
              count_source: 'human_click',
              click_x: b.x,
              click_y: b.y,
              click_at: clickedAt,
              snapped: snappedLine !== null,
              snapped_line: snappedLine ? JSON.stringify(snappedLine) : null,
              snapped_distance_pt: snapDistance,
              size_source: size.source,
              size_evidence: size.evidence ? JSON.stringify(size.evidence) : null,
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow();
          const editActionId = await recordAction(trx, name, [
            {
              memberId: row.id,
              field: '__created__',
              before: null,
              after: summary,
              status: 'edited',
            },
            ...(snappedLine
              ? [
                  {
                    memberId: row.id,
                    field: 'link',
                    before: { reset: true },
                    after: { line: { p: snappedLine.p, q: snappedLine.q }, rank: null },
                    status: 'edited' as const,
                  },
                ]
              : []),
          ]);
          await logCountAction(trx, {
            projectId,
            sheetId: b.sheet_id,
            memberId: row.id,
            action: 'create',
            who: name,
            editActionId,
            detail: {
              kind: b.kind,
              click: { x: b.x, y: b.y },
              snapped: snappedLine !== null,
              snapped_line_id: snappedLine?.id ?? null,
              snap_distance_pt: snapDistance,
              size_source: size.source,
              size: size.profile_text,
              tag: `${prefix}${number}`,
              lines_ready: lines !== null,
            },
          });
          return row.id;
        });
      const [created] = await loadMemberViews(db(), projectId, { memberIds: [id] });
      return reply.status(201).send({
        member: created,
        snap: {
          snapped: snappedLine !== null,
          line: snappedLine,
          distance_pt: snapDistance,
          radius_pt: radius,
          lines_ready: lines !== null,
        },
        size,
      });
    },
  );

  // ---- accept / reject / reset a suggestion ----------------------------------------------------
  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; decision: 'accept' | 'reject' | 'reset' };
  }>(
    '/api/projects/:projectId/members/:memberId/count-decision',
    {
      schema: {
        params: memberParams,
        body: {
          type: 'object',
          required: ['who', 'decision'],
          additionalProperties: false,
          properties: { who, decision: { enum: ['accept', 'reject', 'reset'] } },
        },
      },
    },
    async (request) => {
      const { projectId, memberId } = request.params;
      const name = request.body.who.trim();
      if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
      const [m] = await loadMemberViews(db(), projectId, { memberIds: [memberId] });
      if (!m) throw new HttpError(404, { error: 'member not found' });
      if (m.count.source === 'human_click') {
        throw new HttpError(409, {
          error: 'a clicked piece is not a suggestion: delete it instead',
        });
      }
      const target =
        request.body.decision === 'accept'
          ? { state: 'confirmed' as const, source: 'suggestion_accepted' as const }
          : request.body.decision === 'reject'
            ? { state: 'rejected' as const, source: null }
            : { state: 'suggested' as const, source: null };
      const entries = [];
      if (m.count.state !== target.state) {
        entries.push({
          memberId: m.id,
          field: 'count_state',
          before: m.count.state,
          after: target.state,
          status: 'edited' as const,
        });
      }
      if (m.count.source !== target.source) {
        entries.push({
          memberId: m.id,
          field: 'count_source',
          before: m.count.source,
          after: target.source,
          status: 'edited' as const,
        });
      }
      let editActionId: string | null = null;
      if (entries.length > 0) {
        editActionId = await recordAction(db(), name, entries);
        await logCountAction(db(), {
          projectId,
          sheetId: m.sheet_id,
          memberId: m.id,
          action:
            request.body.decision === 'accept'
              ? 'accept'
              : request.body.decision === 'reject'
                ? 'reject'
                : 'edit',
          who: name,
          editActionId,
          detail: { decision: request.body.decision, tag: m.tag.text, size: m.profile_raw },
        });
      }
      const [after] = await loadMemberViews(db(), projectId, { memberIds: [memberId] });
      return { action_id: editActionId, changed: entries.length > 0, member: after };
    },
  );

  // ---- the action log --------------------------------------------------------------------------
  app.get<{
    Params: { projectId: string };
    Querystring: { sheet_id?: string; who?: string; limit?: number };
  }>(
    '/api/projects/:projectId/count-actions',
    {
      schema: {
        params: projectParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sheet_id: uuid,
            who: { type: 'string', maxLength: 100 },
            limit: { type: 'integer', minimum: 1, maximum: 5000 },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      await settings(projectId);
      let q = db().selectFrom('count_actions').selectAll().where('project_id', '=', projectId);
      if (request.query.sheet_id) q = q.where('sheet_id', '=', request.query.sheet_id);
      if (request.query.who) q = q.where('who', '=', request.query.who);
      const rows = await q
        .orderBy('created_at')
        .orderBy('id')
        .limit(request.query.limit ?? 1000)
        .execute();
      return {
        actions: rows.map((r) => ({
          id: Number(r.id),
          action: r.action,
          who: r.who,
          sheet_id: r.sheet_id,
          member_id: r.member_id,
          edit_action_id: r.edit_action_id,
          detail: r.detail,
          at: new Date(r.created_at as unknown as string).toISOString(),
        })),
        time_per_page: pageTimes(rows),
      };
    },
  );

  // ---- measure (Part C) ------------------------------------------------------------------------
  async function viewsOf(sheetId: string) {
    const rows = await db()
      .selectFrom('sheet_views')
      .select(['id', 'box', 'scale_ratio', 'scale_confirmed'])
      .where('sheet_id', '=', sheetId)
      .orderBy('created_at')
      .execute();
    return rows.map((v) => ({
      id: v.id,
      box: v.box as ViewBox,
      scale_ratio: v.scale_ratio === null ? null : Number(v.scale_ratio),
      scale_confirmed: v.scale_confirmed,
    }));
  }

  interface MeasureBody {
    who?: string;
    sheet_id: string;
    a: { x: number; y: number };
    b: { x: number; y: number };
    view_id?: string;
    radius?: number;
  }
  const measureBody = (needWho: boolean) =>
    ({
      type: 'object',
      required: needWho ? ['who', 'sheet_id', 'a', 'b'] : ['sheet_id', 'a', 'b'],
      additionalProperties: false,
      properties: {
        who,
        sheet_id: uuid,
        a: pointSchema,
        b: pointSchema,
        view_id: uuid,
        radius: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
      },
    }) as const;

  async function measure(projectId: string, b: MeasureBody) {
    await sheetOf(projectId, b.sheet_id);
    const view = scaleViewFor(await viewsOf(b.sheet_id), b.a, b.b, b.view_id);
    if (!view) {
      throw new HttpError(409, {
        error: 'this page has no confirmed scale for these points: confirm the scale first',
      });
    }
    const lines = await loadLines(b.sheet_id);
    const m = measureTwoClicks(
      (lines?.lines ?? []) as LineRow[],
      b.a,
      b.b,
      view,
      b.radius ?? DEFAULT_MEASURE_SNAP_PT,
    );
    return { ...m, lines_ready: lines !== null };
  }

  app.post<{ Params: { projectId: string }; Body: MeasureBody }>(
    '/api/projects/:projectId/measure',
    { schema: { params: projectParams, body: measureBody(false) } },
    async (request) => measure(request.params.projectId, request.body),
  );

  app.post<{ Params: { projectId: string }; Body: MeasureBody }>(
    '/api/projects/:projectId/measurements',
    { schema: { params: projectParams, body: measureBody(true) } },
    async (request, reply) => {
      const { projectId } = request.params;
      const name = (request.body.who ?? '').trim();
      if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
      const m = await measure(projectId, request.body);
      const row = await db()
        .insertInto('measurements')
        .values({
          project_id: projectId,
          sheet_id: request.body.sheet_id,
          a: JSON.stringify(request.body.a),
          b: JSON.stringify(request.body.b),
          a_snap: m.a_snap ? JSON.stringify(m.a_snap) : null,
          b_snap: m.b_snap ? JSON.stringify(m.b_snap) : null,
          scale_ratio: m.scale_ratio,
          length_mm: m.length_mm,
          created_by: name,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();
      await logCountAction(db(), {
        projectId,
        sheetId: request.body.sheet_id,
        action: 'measure',
        who: name,
        detail: { measurement_id: row.id, length_mm: m.length_mm, scale_ratio: m.scale_ratio },
      });
      return reply.status(201).send({ id: row.id, ...m });
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { sheet_id?: string } }>(
    '/api/projects/:projectId/measurements',
    {
      schema: {
        params: projectParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { sheet_id: uuid },
        },
      },
    },
    async (request) => {
      let q = db()
        .selectFrom('measurements')
        .selectAll()
        .where('project_id', '=', request.params.projectId);
      if (request.query.sheet_id) q = q.where('sheet_id', '=', request.query.sheet_id);
      const rows = await q.orderBy('created_at').execute();
      return {
        measurements: rows.map((r) => ({
          id: r.id,
          sheet_id: r.sheet_id,
          a: r.a,
          b: r.b,
          a_snap: r.a_snap,
          b_snap: r.b_snap,
          scale_ratio: Number(r.scale_ratio),
          length_mm: Number(r.length_mm),
          created_by: r.created_by,
          member_id: r.member_id,
          at: new Date(r.created_at as unknown as string).toISOString(),
        })),
      };
    },
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; measurement_id: string };
  }>(
    '/api/projects/:projectId/members/:memberId/attach-measurement',
    {
      schema: {
        params: memberParams,
        body: {
          type: 'object',
          required: ['who', 'measurement_id'],
          additionalProperties: false,
          properties: { who, measurement_id: uuid },
        },
      },
    },
    async (request) => {
      const { projectId, memberId } = request.params;
      const name = request.body.who.trim();
      if (name === '') throw new HttpError(400, { error: 'who must not be blank' });
      const [m] = await loadMemberViews(db(), projectId, { memberIds: [memberId] });
      if (!m) throw new HttpError(404, { error: 'member not found' });
      if (m.type === 'column') {
        throw new HttpError(400, {
          error: 'a column takes its length from its elevations, not from a plan measurement',
        });
      }
      const meas = await db()
        .selectFrom('measurements')
        .selectAll()
        .where('id', '=', request.body.measurement_id)
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!meas) throw new HttpError(404, { error: 'measurement not found' });
      const mm = Number(meas.length_mm);
      const typed = m.length_source === 'manual' || m.length_source === 'measured_manual';
      const entries = [
        {
          memberId: m.id,
          field: 'length_mm',
          before: typed ? m.length_mm : null,
          after: mm,
          status: 'edited' as const,
        },
        {
          memberId: m.id,
          field: 'length_measurement',
          before: m.length_measurement,
          after: meas.id,
          status: 'edited' as const,
        },
      ];
      const editActionId = await recordAction(db(), name, entries);
      await db()
        .updateTable('measurements')
        .set({ member_id: m.id })
        .where('id', '=', meas.id)
        .execute();
      await logCountAction(db(), {
        projectId,
        sheetId: m.sheet_id,
        memberId: m.id,
        action: 'attach_length',
        who: name,
        editActionId,
        detail: { measurement_id: meas.id, length_mm: mm },
      });
      const [after] = await loadMemberViews(db(), projectId, { memberIds: [memberId] });
      return { action_id: editActionId, member: after as MemberView };
    },
  );
};
