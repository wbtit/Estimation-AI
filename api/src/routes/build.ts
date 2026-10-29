// Line-first build (Phase 11): per-page setup, Build, page build state and the BOM.
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/role         { role (null = skip), who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/crop         { box, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/scale        { scale_text | ratio, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/tos          { tos_mm, raw?, source, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/pen-class    { pen_class, source, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/no-beams     { who } beam pen = none
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/pick-pen     { x, y, who }  click a line
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/column-plan  { sheet_id | null, who }
//   GET  /api/projects/:projectId/sheets/:sheetId/build                    page build state
//   POST /api/projects/:projectId/sheets/:sheetId/build                    { who, column_plan_sheet_id?, no_column_plan?, allow_system_values? }
//   GET  /api/projects/:projectId/line-first/bom[.xlsx]                    Steel Genie columns
//
// Every setup change stores who and when on the sheet (the value is then a person's value), marks
// the page "Requesting Build" (setup_changed_at), writes an append-only sheet_edits row (before and
// after) and logs a count_actions row. Build refuses (409, with the reasons, and a refused build_runs
// row) until the page is set up: the same rules as the worker's build_sheet job
// (worker/src/build/job.py, setup_reasons); with allow_system_values (the review UI's build) a value
// only has to be there, as in auto mode.
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely, type Selectable } from 'kysely';
import ExcelJS from 'exceljs';
import { defaultCatalogLookup } from '../catalog/lookup.js';
import { getDb } from '../db/client.js';
import type { Transaction } from 'kysely';
import type { Database, SheetsTable } from '../db/types.js';
import {
  asSheet,
  NAME_OF_ROLE,
  pickView,
  SKIP_NAME,
  viewJson,
  viewsOf,
  type Box,
  type LoadedView,
} from '../review/build-views.js';
import { XLSX_MIME } from '../excel/index.js';
import { loadGrades } from '../review/grades.js';
import { lineFirstBom } from '../review/line-first-bom.js';
import { counted, effectiveState, loadPieces, toBuiltPiece } from '../review/line-first-pieces.js';
import { logCountAction } from '../review/count-log.js';
import { feetAndInches } from '../review/answer-key.js';
import { parseScaleExact } from '../scale/index.js';
import { boxSnapshot, recordViewUndo } from '../review/view-undo.js';
import { HttpError } from './http-error.js';

export { effectiveState };

export interface BuildRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const sheetParams = {
  type: 'object',
  required: ['projectId', 'sheetId'],
  properties: { projectId: uuid, sheetId: uuid },
} as const;
const projectParams = {
  type: 'object',
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;

/** A pen class key as the line classes are written: width bucket | colour | solid or dash. */
export const PEN_CLASS_RE =
  /^(<0\.1|0\.1-0\.25|0\.25-0\.5|0\.5-1|1-1\.5|1\.5-2\.5|>2\.5)\|(black|grey|red|green|blue|other|none)\|(solid|dash)$/;

type Sheet = Selectable<SheetsTable>;

export const boxSchema = {
  type: 'object',
  required: ['x0', 'y0', 'x1', 'y1'],
  additionalProperties: false,
  properties: {
    x0: { type: 'number' },
    y0: { type: 'number' },
    x1: { type: 'number' },
    y1: { type: 'number' },
  },
} as const;

/** A box on the page: x1 > x0, y1 > y0, inside the displayed page (1 pt slack). */
export function checkBox(s: Sheet, b: Box, what: string): void {
  if (!(b.x1 > b.x0 && b.y1 > b.y0))
    throw new HttpError(400, { error: `the ${what} needs x1 > x0 and y1 > y0` });
  const w = s.width_pt === null ? null : Number(s.width_pt);
  const h = s.height_pt === null ? null : Number(s.height_pt);
  const rotated = s.rotation === 90 || s.rotation === 270;
  const [dw, dh] = rotated ? [h, w] : [w, h];
  if (dw !== null && dh !== null && (b.x0 < 0 || b.y0 < 0 || b.x1 > dw + 1 || b.y1 > dh + 1))
    throw new HttpError(400, { error: `the ${what} is outside the page` });
}

/** The id of the first view (runs and pieces with no view id belong to it). */
export const firstId = (views: LoadedView[]): string | undefined => pickView(views)?.row.id;

/** "No beams": a person set the beam pen to none (no pen class, source person, confirmed). */
export function noBeams(
  s: Pick<Sheet, 'pen_class' | 'pen_class_source' | 'pen_class_confirmed_by'>,
): boolean {
  return !s.pen_class && s.pen_class_source === 'person' && !!s.pen_class_confirmed_by;
}

/** Why the page cannot be built yet; empty when it can. Same rules as the worker. With
 * `allowSystem` a value only has to be there (auto mode and the review UI's build). */
export function setupReasons(s: Sheet, allowSystem = false): string[] {
  const out: string[] = [];
  if (s.build_role !== 'column_plan' && s.build_role !== 'framing')
    out.push('page role not set (column plan or framing)');
  if (allowSystem) {
    if (s.crop_region === null) out.push('no crop');
    if (s.build_scale_ratio === null) out.push('no scale');
    if (s.build_role === 'framing' && !s.pen_class && !noBeams(s)) out.push('no beam pen class');
    return out;
  }
  if (s.crop_region === null || !s.crop_confirmed_by) out.push('crop not confirmed');
  if (s.build_scale_ratio === null || !s.scale_confirmed_by) out.push('scale not confirmed');
  if (s.build_role === 'framing') {
    if (!s.tos_confirmed_by) out.push('T.O.S. not confirmed');
    if ((!s.pen_class && !noBeams(s)) || !s.pen_class_confirmed_by)
      out.push('beam pen class not confirmed');
  }
  return out;
}

function who_(value: string): string {
  const w = value.trim();
  if (w === '') throw new HttpError(400, { error: 'who must not be blank' });
  return w;
}

export const buildRoutes: FastifyPluginAsync<BuildRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadSheet(projectId: string, sheetId: string): Promise<Sheet> {
    const s = await db()
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!s) throw new HttpError(404, { error: 'sheet not found' });
    return s;
  }

  /** The sheet and the view a setup change is for (the first view unless one is named). */
  async function target(
    projectId: string,
    sheetId: string,
    viewId?: string | null,
  ): Promise<{ s: Sheet; v: LoadedView; views: LoadedView[] }> {
    const s = await loadSheet(projectId, sheetId);
    const views = await viewsOf(db(), s.id);
    const v = pickView(views, viewId);
    if (!v) throw new HttpError(404, { error: 'view not found on this page' });
    return { s, v, views };
  }

  /** Set view columns and log the change as one sheet_edits row and one count_actions row, in one
   * transaction; the view is then "Requesting Build" until it is built again. `more` runs in the
   * same transaction (pens). Field names of views after the first carry the view's position. */
  async function confirm(
    sheet: Sheet,
    view: LoadedView,
    field: string,
    before: unknown,
    after: unknown,
    set: Record<string, unknown>,
    editor: string,
    action: 'setup' | 'pick_pen' = 'setup',
    more?: (trx: Transaction<Database>) => Promise<void>,
  ): Promise<void> {
    await db()
      .transaction()
      .execute(async (trx) => {
        if (more) await more(trx);
        await trx
          .updateTable('build_views')
          .set({ ...set, setup_changed_at: new Date() } as never)
          .where('id', '=', view.row.id)
          .execute();
        await logCountAction(trx, {
          projectId: sheet.project_id,
          sheetId: sheet.id,
          action,
          who: editor,
          detail: { field, view_id: view.row.id },
        });
        await trx
          .insertInto('sheet_edits')
          .values({
            sheet_id: sheet.id,
            field_name: view.row.position === 1 ? field : `view${view.row.position}.${field}`,
            original_value: JSON.stringify(before ?? null),
            corrected_value: JSON.stringify(after ?? null),
            editor,
          })
          .execute();
      });
  }

  /** Replace the beam pens of a view with one pen (or none). */
  const replacePens =
    (
      v: LoadedView,
      pen: { pen_class: string; source: 'suggested' | 'person' } | null,
      by: string,
    ) =>
    async (trx: Transaction<Database>) => {
      await trx.deleteFrom('view_pens').where('view_id', '=', v.row.id).execute();
      if (pen)
        await trx
          .insertInto('view_pens')
          .values({
            view_id: v.row.id,
            position: 1,
            pen_class: pen.pen_class,
            source: pen.source,
            confirmed_by: by,
            confirmed_at: new Date(),
          })
          .execute();
    };

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: {
      role?: 'column_plan' | 'framing' | null;
      role_name?: string;
      view_id?: string;
      who: string;
    };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/role',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            role: { enum: ['column_plan', 'framing', null] },
            role_name: { type: 'string', minLength: 1, maxLength: 60 },
            view_id: uuid,
            who,
          },
        },
      },
    },
    async (request) => {
      const b = request.body;
      const { s, v } = await target(request.params.projectId, request.params.sheetId, b.view_id);
      const editor = who_(b.who);
      if ((b.role === undefined) === (b.role_name === undefined))
        throw new HttpError(400, { error: 'give role or role_name' });
      const name =
        b.role_name !== undefined ? b.role_name : b.role ? NAME_OF_ROLE[b.role]! : SKIP_NAME;
      const known = await db()
        .selectFrom('role_names')
        .select(['name', 'behaviour'])
        .where('name', '=', name)
        .executeTakeFirst();
      if (!known) throw new HttpError(400, { error: 'that role name is not in the list' });
      await confirm(
        s,
        v,
        'build_role',
        v.row.role_name,
        name,
        { role_name: name, role_confirmed_by: editor, role_confirmed_at: new Date() },
        editor,
      );
      const role = known.behaviour === 'none' ? null : known.behaviour;
      return { ok: true, role, role_name: name, behaviour: known.behaviour };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { box: Box; view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/crop',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['box', 'who'],
          additionalProperties: false,
          properties: { box: boxSchema, view_id: uuid, who },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      const b = request.body.box;
      checkBox(s, b, 'crop box');
      await confirm(
        s,
        v,
        'crop_region',
        v.row.box,
        b,
        { box: JSON.stringify(b), box_confirmed_by: editor, box_confirmed_at: new Date() },
        editor,
        'setup',
        // a box change is on the person's Undo stack (Phase 11c polish round)
        (trx) =>
          recordViewUndo(trx, {
            projectId: s.project_id,
            sheetId: s.id,
            viewId: v.row.id,
            kind: 'box',
            who: editor,
            snapshot: boxSnapshot(v.row as unknown as Record<string, unknown>),
          }),
      );
      return { ok: true, crop: b };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { scale_text?: string; ratio?: number; view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/scale',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            scale_text: { type: 'string', minLength: 1, maxLength: 100 },
            ratio: { type: 'number', exclusiveMinimum: 0 },
            view_id: uuid,
            who,
          },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      let ratio = request.body.ratio ?? null;
      const text = request.body.scale_text ?? null;
      if (text !== null) {
        const parsed = parseScaleExact(text);
        if (!parsed || parsed.ratio === null)
          throw new HttpError(400, { error: 'the scale text is not a readable scale' });
        if (ratio !== null && Math.abs(parsed.ratio - ratio) > 1e-9)
          throw new HttpError(400, { error: 'scale_text and ratio disagree' });
        ratio = parsed.ratio;
      }
      if (ratio === null) throw new HttpError(400, { error: 'give scale_text or ratio' });
      await confirm(
        s,
        v,
        'build_scale',
        {
          ratio: v.row.scale_ratio === null ? null : Number(v.row.scale_ratio),
          text: v.row.scale_text,
        },
        { ratio, text },
        {
          scale_ratio: ratio,
          scale_text: text,
          scale_confirmed_by: editor,
          scale_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, ratio, scale_text: text };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: {
      tos_mm: number;
      raw?: string | null;
      source: 'read' | 'typed';
      view_id?: string;
      who: string;
    };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/tos',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['tos_mm', 'source', 'who'],
          additionalProperties: false,
          properties: {
            tos_mm: { type: 'number', minimum: -1e6, maximum: 1e6 },
            raw: { type: ['string', 'null'], maxLength: 200 },
            source: { enum: ['read', 'typed'] },
            view_id: uuid,
            who,
          },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      const { tos_mm, source } = request.body;
      const raw = request.body.raw ?? null;
      await confirm(
        s,
        v,
        'tos',
        {
          tos_mm: v.row.tos_mm === null ? null : Number(v.row.tos_mm),
          raw: v.row.tos_raw,
          source: v.row.tos_source,
        },
        { tos_mm, raw, source },
        {
          tos_mm,
          tos_raw: raw,
          tos_source: source,
          tos_confirmed_by: editor,
          tos_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, tos_mm, raw, source };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { pen_class: string; source: 'suggested' | 'person'; view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/pen-class',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['pen_class', 'source', 'who'],
          additionalProperties: false,
          properties: {
            pen_class: { type: 'string', maxLength: 40 },
            source: { enum: ['suggested', 'person'] },
            view_id: uuid,
            who,
          },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      const { pen_class, source } = request.body;
      if (!PEN_CLASS_RE.test(pen_class))
        throw new HttpError(400, { error: "a pen class is 'width bucket|colour|solid or dash'" });
      await confirm(
        s,
        v,
        'pen_class',
        v.pens.map((p) => p.pen_class),
        [pen_class],
        { no_beams_by: null, no_beams_at: null },
        editor,
        'setup',
        replacePens(v, { pen_class, source }, editor),
      );
      return { ok: true, pen_class, source };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { x: number; y: number; mode?: 'replace' | 'add'; view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/pick-pen',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['x', 'y', 'who'],
          additionalProperties: false,
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            mode: { enum: ['replace', 'add'] },
            view_id: uuid,
            who,
          },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      const mode = request.body.mode ?? 'replace';
      const lines = await db()
        .selectFrom('sheet_lines')
        .select(['classes', 'lines'])
        .where('sheet_id', '=', s.id)
        .executeTakeFirst();
      if (!lines) throw new HttpError(409, { error: 'the lines of this page are not ready yet' });
      const hit = nearestClass(
        lines.classes as string[],
        lines.lines as number[][],
        request.body.x,
        request.body.y,
      );
      if (!hit) throw new HttpError(404, { error: 'no line there: click on a beam line' });
      if (!PEN_CLASS_RE.test(hit.pen_class))
        throw new HttpError(400, { error: 'that line has no usable pen class' });
      const before = v.pens.map((p) => p.pen_class);
      const has = before.includes(hit.pen_class);
      const after = mode === 'add' ? (has ? before : [...before, hit.pen_class]) : [hit.pen_class];
      const add = async (trx: Transaction<Database>) => {
        if (has) return;
        await trx
          .insertInto('view_pens')
          .values({
            view_id: v.row.id,
            position: Math.max(0, ...v.pens.map((p) => p.position)) + 1,
            pen_class: hit.pen_class,
            source: 'person',
            confirmed_by: editor,
            confirmed_at: new Date(),
          })
          .execute();
      };
      await confirm(
        s,
        v,
        'pen_class',
        before,
        after,
        { no_beams_by: null, no_beams_at: null },
        editor,
        'pick_pen',
        mode === 'add'
          ? add
          : replacePens(v, { pen_class: hit.pen_class, source: 'person' }, editor),
      );
      return {
        ok: true,
        pen_class: hit.pen_class,
        pens: after,
        mode,
        distance_pt: hit.distance_pt,
      };
    },
  );

  // Remove one beam pen of a view (an added pen picked by mistake); the first pen moves up.
  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { pen_class: string; view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/remove-pen',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['pen_class', 'who'],
          additionalProperties: false,
          properties: { pen_class: { type: 'string', maxLength: 40 }, view_id: uuid, who },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      const before = v.pens.map((p) => p.pen_class);
      if (!before.includes(request.body.pen_class))
        throw new HttpError(404, { error: 'that pen is not a pen of this view' });
      const after = before.filter((p) => p !== request.body.pen_class);
      await confirm(s, v, 'pen_class', before, after, {}, editor, 'setup', async (trx) => {
        await trx.deleteFrom('view_pens').where('view_id', '=', v.row.id).execute();
        let i = 0;
        for (const p of v.pens.filter((x) => x.pen_class !== request.body.pen_class))
          await trx
            .insertInto('view_pens')
            .values({
              view_id: v.row.id,
              position: ++i,
              pen_class: p.pen_class,
              source: p.source,
              confirmed_by: p.confirmed_by,
              confirmed_at: p.confirmed_at,
            })
            .execute();
      });
      return { ok: true, pens: after };
    },
  );

  // "No beams" (a column plan or a page with no beams to take off): the next build makes no beam
  // pieces, so untouched beams of the view go; edited ones stay, as with any rebuild.
  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/no-beams',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { view_id: uuid, who },
        },
      },
    },
    async (request) => {
      const { s, v } = await target(
        request.params.projectId,
        request.params.sheetId,
        request.body.view_id,
      );
      const editor = who_(request.body.who);
      await confirm(
        s,
        v,
        'pen_class',
        v.pens.map((p) => p.pen_class),
        null,
        { no_beams_by: editor, no_beams_at: new Date() },
        editor,
        'setup',
        replacePens(v, null, editor),
      );
      return { ok: true, pen_class: null };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { sheet_id?: string | null; plan_view_id?: string | null; view_id?: string; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/column-plan',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            sheet_id: { anyOf: [uuid, { type: 'null' }] },
            plan_view_id: { anyOf: [uuid, { type: 'null' }] },
            view_id: uuid,
            who,
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const b = request.body;
      const { s, v } = await target(projectId, request.params.sheetId, b.view_id);
      const editor = who_(b.who);
      if ((b.sheet_id === undefined) === (b.plan_view_id === undefined))
        throw new HttpError(400, { error: 'give sheet_id or plan_view_id' });
      let planView: string | null = null;
      let planSheet: string | null = null;
      if (b.plan_view_id) {
        const p = await db()
          .selectFrom('build_views as v')
          .innerJoin('sheets as s', 's.id', 'v.sheet_id')
          .select(['v.id', 'v.sheet_id'])
          .where('v.id', '=', b.plan_view_id)
          .where('s.project_id', '=', projectId)
          .executeTakeFirst();
        if (!p) throw new HttpError(404, { error: 'column plan view not found' });
        planView = p.id;
        planSheet = p.sheet_id;
      } else if (b.sheet_id) {
        if (b.sheet_id === s.id && v.row.position === 1)
          throw new HttpError(400, { error: 'a page is not its own column plan' });
        await loadSheet(projectId, b.sheet_id);
        planView = pickView(await viewsOf(db(), b.sheet_id))?.row.id ?? null;
        planSheet = b.sheet_id;
      }
      if (planView === v.row.id)
        throw new HttpError(400, { error: 'a view is not its own column plan' });
      await confirm(
        s,
        v,
        'column_plan_sheet_id',
        v.plan_sheet_id,
        planSheet,
        {
          column_plan_view_id: planView,
          column_plan_confirmed_by: editor,
          column_plan_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, column_plan_sheet_id: planSheet, column_plan_view_id: planView };
    },
  );

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build',
    { schema: { params: sheetParams } },
    async (request) => {
      const { s: page, v, views } = await target(request.params.projectId, request.params.sheetId);
      const s = asSheet(page, v);
      const runs = await db()
        .selectFrom('build_runs')
        .selectAll()
        .where('sheet_id', '=', s.id)
        .orderBy('started_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const runOf = (x: LoadedView) =>
        runs.find((r) => (r.view_id ?? firstId(views)) === x.row.id) ?? null;
      const last = runs[0];
      const states = await db()
        .selectFrom('members')
        .select(['build_state', sql<number>`count(*)::int`.as('n')])
        .where('sheet_id', '=', s.id)
        .where('build_run_id', 'is not', null)
        .groupBy('build_state')
        .execute();
      const runJson = (r: (typeof runs)[number]) => ({
        id: r.id,
        view_id: r.view_id ?? firstId(views),
        status: r.status,
        requested_by: r.requested_by,
        started_at: r.started_at,
        finished_at: r.finished_at,
        counts: r.counts,
        notes: r.notes,
        error: r.error,
        rules_version: r.rules_version,
      });
      return {
        sheet_id: s.id,
        setup: {
          role: s.build_role,
          crop: s.crop_region,
          crop_confirmed: s.crop_confirmed_by
            ? { by: s.crop_confirmed_by, at: s.crop_confirmed_at }
            : null,
          scale: {
            ratio: s.build_scale_ratio === null ? null : Number(s.build_scale_ratio),
            text: s.build_scale_text,
          },
          scale_confirmed: s.scale_confirmed_by
            ? { by: s.scale_confirmed_by, at: s.scale_confirmed_at }
            : null,
          tos: {
            mm: s.tos_mm === null ? null : Number(s.tos_mm),
            raw: s.tos_raw,
            source: s.tos_source,
          },
          tos_confirmed: s.tos_confirmed_by
            ? { by: s.tos_confirmed_by, at: s.tos_confirmed_at }
            : null,
          pen_class: s.pen_class,
          pen_class_source: s.pen_class_source,
          pen_class_confirmed: s.pen_class_confirmed_by
            ? { by: s.pen_class_confirmed_by, at: s.pen_class_confirmed_at }
            : null,
        },
        missing: setupReasons(s),
        build_status: page.build_status,
        built_at: s.built_at,
        registration: s.registration,
        last_run: last ? runJson(last) : null,
        views: views.map((x) => {
          const r = runOf(x);
          return {
            ...viewJson(x),
            missing: setupReasons(asSheet(page, x)),
            last_run: r ? runJson(r) : null,
          };
        }),
        pieces: Object.fromEntries(states.map((r) => [r.build_state ?? 'none', Number(r.n)])),
      };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: {
      who: string;
      view_id?: string;
      column_plan_sheet_id?: string;
      no_column_plan?: boolean;
      allow_system_values?: boolean;
    };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            who,
            view_id: uuid,
            column_plan_sheet_id: uuid,
            no_column_plan: { type: 'boolean' },
            allow_system_values: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const body = request.body;
      const { s: page, views } = await target(projectId, request.params.sheetId);
      const editor = who_(body.who);
      const allowSystem = body.allow_system_values === true;
      let chosen: LoadedView[];
      if (body.view_id) {
        const one = pickView(views, body.view_id);
        if (!one) throw new HttpError(404, { error: 'view not found on this page' });
        chosen = [one];
      } else {
        // the page's Build: every view that builds (column plan or framing), else the first view
        chosen = views.filter((x) => x.behaviour === 'column_plan' || x.behaviour === 'framing');
        if (chosen.length === 0) chosen = [pickView(views)!];
      }
      const namedPlanView = body.column_plan_sheet_id
        ? (pickView(await viewsOf(db(), body.column_plan_sheet_id))?.row.id ?? null)
        : null;
      const plans = await db()
        .selectFrom('build_views as v')
        .innerJoin('sheets as s', 's.id', 'v.sheet_id')
        .innerJoin('role_names as r', 'r.name', 'v.role_name')
        .select(['v.id', 'v.sheet_id'])
        .where('s.project_id', '=', projectId)
        .where('r.behaviour', '=', 'column_plan')
        .where('v.built_at', 'is not', null)
        .execute();
      const file = await db()
        .selectFrom('project_files')
        .select('scan_status')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      const runsOpen = await db()
        .selectFrom('build_runs')
        .select(['id', 'view_id'])
        .where('sheet_id', '=', page.id)
        .where('status', 'in', ['pending', 'running'])
        .execute();
      const prepared = chosen.map((v) => {
        const s = asSheet(page, v);
        const inputs: Record<string, unknown> = { view_id: v.row.id };
        if (body.column_plan_sheet_id) {
          inputs.column_plan_sheet_id = body.column_plan_sheet_id;
          if (namedPlanView) inputs.column_plan_view_id = namedPlanView;
        }
        if (body.no_column_plan) inputs.no_column_plan = true;
        if (allowSystem) inputs.allow_system_values = true;
        if (!inputs.column_plan_sheet_id && !inputs.no_column_plan) {
          // the view's own choice (a person's or auto mode's), as the worker reads it
          if (v.row.column_plan_view_id) {
            inputs.column_plan_view_id = v.row.column_plan_view_id;
            inputs.column_plan_sheet_id = v.plan_sheet_id;
          } else if (v.row.column_plan_confirmed_by) inputs.no_column_plan = true;
        }
        const reasons = setupReasons(s, allowSystem);
        if (s.build_role === 'framing' && reasons.length === 0 && !inputs.no_column_plan) {
          const others = plans.filter((p) => p.id !== v.row.id);
          const named = inputs.column_plan_view_id as string | undefined;
          if (named && !others.some((p) => p.id === named))
            reasons.push('the named column plan page is not built');
          else if (!named && others.length !== 1 && allowSystem) inputs.no_column_plan = true;
          else if (!named && others.length === 0)
            reasons.push('build the column plan page first, or say the job has none');
          else if (!named && others.length > 1)
            reasons.push('several column plan pages are built: name one');
        }
        if (!file || file.scan_status !== 'done') reasons.push('the PDF scan is not finished');
        return { v, inputs, reasons };
      });
      const refused: { view_id: string; reasons: string[]; build_run_id: string }[] = [];
      for (const x of prepared.filter((p) => p.reasons.length > 0)) {
        const run = await db()
          .insertInto('build_runs')
          .values({
            project_id: projectId,
            sheet_id: page.id,
            view_id: x.v.row.id,
            requested_by: editor,
            status: 'refused',
            inputs: JSON.stringify(x.inputs),
            error: x.reasons.join('; '),
            finished_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        refused.push({ view_id: x.v.row.id, reasons: x.reasons, build_run_id: run.id });
      }
      const ready = prepared.filter((p) => p.reasons.length === 0);
      const several = views.length > 1;
      if (ready.length === 0) {
        throw new HttpError(409, {
          error: 'the page is not ready to build',
          reasons: refused.flatMap((r) =>
            several
              ? r.reasons.map((m) => `${pickView(views, r.view_id)!.row.name}: ${m}`)
              : r.reasons,
          ),
          build_run_id: refused[0]!.build_run_id,
          refused,
        });
      }
      const busy = ready.filter((x) =>
        runsOpen.some((r) => (r.view_id ?? firstId(views)) === x.v.row.id),
      );
      if (busy.length > 0) {
        const open = runsOpen.find((r) => (r.view_id ?? firstId(views)) === busy[0]!.v.row.id)!;
        throw new HttpError(409, {
          error: 'this page is already being built',
          build_run_id: open.id,
        });
      }
      const queued = await db()
        .transaction()
        .execute(async (trx) => {
          const out: { build_run_id: string; job_id: string; view_id: string }[] = [];
          for (const x of ready) {
            const run = await trx
              .insertInto('build_runs')
              .values({
                project_id: projectId,
                sheet_id: page.id,
                view_id: x.v.row.id,
                requested_by: editor,
                mode: 'person',
                inputs: JSON.stringify(x.inputs),
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await logCountAction(trx, {
              projectId,
              sheetId: page.id,
              action: 'rebuild',
              who: editor,
              detail: { build_run_id: run.id, view_id: x.v.row.id },
            });
            const job = await trx
              .insertInto('jobs')
              .values({ type: 'build_sheet', payload: JSON.stringify({ build_run_id: run.id }) })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .updateTable('build_runs')
              .set({ job_id: job.id })
              .where('id', '=', run.id)
              .execute();
            out.push({ build_run_id: run.id, job_id: job.id, view_id: x.v.row.id });
          }
          return out;
        });
      return reply.status(202).send({
        build_run_id: queued[0]!.build_run_id,
        job_id: queued[0]!.job_id,
        runs: queued,
        refused,
        status: 'pending',
      });
    },
  );

  async function bom(projectId: string) {
    const project = await db()
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!project) throw new HttpError(404, { error: 'project not found' });
    const pieces = (await loadPieces(db(), projectId)).filter(counted).map(toBuiltPiece);
    const catalog = await defaultCatalogLookup(db());
    return lineFirstBom(pieces, catalog, await loadGrades(db(), projectId));
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/line-first/bom',
    { schema: { params: projectParams } },
    async (request) => bom(request.params.projectId),
  );

  app.get<{ Params: { projectId: string }; Querystring: { who?: string } }>(
    '/api/projects/:projectId/line-first/bom.xlsx',
    {
      schema: {
        params: projectParams,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { who: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      // session preparation: a download is logged (actor and session from the open session)
      await logCountAction(db(), {
        projectId: request.params.projectId,
        action: 'export',
        who: request.query.who?.trim() || 'unknown',
        detail: { file: 'bom.xlsx' },
      }).catch(() => undefined);
      const b = await bom(request.params.projectId);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('BOM');
      ws.addRow(['DRAFT: line-first build, not reviewed']);
      ws.addRow([
        'Main',
        'Category',
        'Piecemark',
        'Qty',
        'Section Type',
        'Section',
        'Length',
        'Grade',
        'Weight (lb)',
        'State',
      ]);
      for (const r of b.rows)
        ws.addRow([
          r.main,
          r.category,
          r.piecemark,
          r.qty,
          r.section_type,
          r.section,
          r.length_mm === null ? null : ftIn(r.length_mm),
          r.grade,
          r.weight_lb,
          r.build_state,
        ]);
      ws.addRow([]);
      ws.addRow([
        'TOTAL (found and needs review)',
        null,
        null,
        b.totals.pieces,
        null,
        null,
        ftIn(b.totals.length_mm),
        null,
        Math.round(b.totals.weight_lb),
      ]);
      ws.addRow([
        'ATTENTION (not in the total)',
        null,
        null,
        b.attention.pieces,
        null,
        null,
        ftIn(b.attention.length_mm),
        null,
        Math.round(b.attention.weight_lb),
      ]);
      const buf = await wb.xlsx.writeBuffer();
      return reply
        .header('content-type', XLSX_MIME)
        .header(
          'content-disposition',
          `attachment; filename="bom-line-first-DRAFT-${request.params.projectId}.xlsx"`,
        )
        .send(Buffer.from(buf));
    },
  );
};

/** Feet-inches text to 1/16": 3810 -> 12'-6". */
export function ftIn(mm: number): string {
  const { ft, inch } = feetAndInches(mm);
  const whole = Math.floor(inch);
  let frac = Math.round((inch - whole) * 16);
  let d = 16;
  while (frac > 0 && frac % 2 === 0) {
    frac /= 2;
    d /= 2;
  }
  const inchText = frac === 0 ? `${whole}` : whole === 0 ? `${frac}/${d}` : `${whole} ${frac}/${d}`;
  return `${ft}'-${inchText}"`;
}

/** The pen class of the extracted line nearest to a page point (within PICK_PEN_MAX_PT); ties go
 * to the longer line. Rows are sheet_lines rows [x0, y0, x1, y1, class index, width, ...]. */
export const PICK_PEN_MAX_PT = 12;
export function nearestClass(
  classes: readonly string[],
  rows: readonly number[][],
  x: number,
  y: number,
): { pen_class: string; distance_pt: number } | null {
  let best: { d: number; len: number; cls: string } | null = null;
  for (const r of rows) {
    const [x0, y0, x1, y1, ci] = r as [number, number, number, number, number];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
    if (d > PICK_PEN_MAX_PT) continue;
    const cls = classes[ci];
    if (cls === undefined) continue;
    const len = Math.sqrt(len2);
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && len > best.len))
      best = { d, len, cls };
  }
  return best ? { pen_class: best.cls, distance_pt: Math.round(best.d * 100) / 100 } : null;
}
