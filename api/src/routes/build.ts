// Line-first build (Phase 11): per-page setup, Build, page build state and the BOM.
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/role         { role (null = skip), who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/crop         { box, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/scale        { scale_text | ratio, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/tos          { tos_mm, raw?, source, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/pen-class    { pen_class, source, who }
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
import type { Database, SheetsTable } from '../db/types.js';
import { XLSX_MIME } from '../excel/index.js';
import { loadGrades } from '../review/grades.js';
import { lineFirstBom } from '../review/line-first-bom.js';
import { counted, effectiveState, loadPieces, toBuiltPiece } from '../review/line-first-pieces.js';
import { logCountAction } from '../review/count-log.js';
import { feetAndInches } from '../review/answer-key.js';
import { parseScaleExact } from '../scale/index.js';
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

/** Why the page cannot be built yet; empty when it can. Same rules as the worker. With
 * `allowSystem` a value only has to be there (auto mode and the review UI's build). */
export function setupReasons(s: Sheet, allowSystem = false): string[] {
  const out: string[] = [];
  if (s.build_role !== 'column_plan' && s.build_role !== 'framing')
    out.push('page role not set (column plan or framing)');
  if (allowSystem) {
    if (s.crop_region === null) out.push('no crop');
    if (s.build_scale_ratio === null) out.push('no scale');
    if (s.build_role === 'framing' && !s.pen_class) out.push('no beam pen class');
    return out;
  }
  if (s.crop_region === null || !s.crop_confirmed_by) out.push('crop not confirmed');
  if (s.build_scale_ratio === null || !s.scale_confirmed_by) out.push('scale not confirmed');
  if (s.build_role === 'framing') {
    if (!s.tos_confirmed_by) out.push('T.O.S. not confirmed');
    if (!s.pen_class || !s.pen_class_confirmed_by) out.push('beam pen class not confirmed');
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

  /** Set sheet columns and log the change as one sheet_edits row and one count_actions row, in
   * one transaction; the page is then "Requesting Build" until it is built again. */
  async function confirm(
    sheet: Sheet,
    field: string,
    before: unknown,
    after: unknown,
    set: Record<string, unknown>,
    editor: string,
    action: 'setup' | 'pick_pen' = 'setup',
  ): Promise<void> {
    await db()
      .transaction()
      .execute(async (trx) => {
        await trx
          .updateTable('sheets')
          .set({ ...set, setup_changed_at: new Date() } as never)
          .where('id', '=', sheet.id)
          .execute();
        await logCountAction(trx, {
          projectId: sheet.project_id,
          sheetId: sheet.id,
          action,
          who: editor,
          detail: { field },
        });
        await trx
          .insertInto('sheet_edits')
          .values({
            sheet_id: sheet.id,
            field_name: field,
            original_value: JSON.stringify(before ?? null),
            corrected_value: JSON.stringify(after ?? null),
            editor,
          })
          .execute();
      });
  }

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { role: 'column_plan' | 'framing' | null; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/role',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['role', 'who'],
          additionalProperties: false,
          properties: { role: { enum: ['column_plan', 'framing', null] }, who },
        },
      },
    },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = who_(request.body.who);
      await confirm(
        s,
        'build_role',
        s.build_role,
        request.body.role,
        {
          build_role: request.body.role,
          role_confirmed_by: editor,
          role_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, role: request.body.role };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { box: { x0: number; y0: number; x1: number; y1: number }; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/crop',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['box', 'who'],
          additionalProperties: false,
          properties: {
            box: {
              type: 'object',
              required: ['x0', 'y0', 'x1', 'y1'],
              additionalProperties: false,
              properties: {
                x0: { type: 'number' },
                y0: { type: 'number' },
                x1: { type: 'number' },
                y1: { type: 'number' },
              },
            },
            who,
          },
        },
      },
    },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = who_(request.body.who);
      const b = request.body.box;
      if (!(b.x1 > b.x0 && b.y1 > b.y0))
        throw new HttpError(400, { error: 'the crop box needs x1 > x0 and y1 > y0' });
      const w = s.width_pt === null ? null : Number(s.width_pt);
      const h = s.height_pt === null ? null : Number(s.height_pt);
      const rotated = s.rotation === 90 || s.rotation === 270;
      const [dw, dh] = rotated ? [h, w] : [w, h];
      if (dw !== null && dh !== null && (b.x0 < 0 || b.y0 < 0 || b.x1 > dw + 1 || b.y1 > dh + 1))
        throw new HttpError(400, { error: 'the crop box is outside the page' });
      await confirm(
        s,
        'crop_region',
        s.crop_region,
        b,
        {
          crop_region: JSON.stringify(b),
          crop_confirmed_by: editor,
          crop_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, crop: b };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { scale_text?: string; ratio?: number; who: string };
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
            who,
          },
        },
      },
    },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
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
        'build_scale',
        {
          ratio: s.build_scale_ratio === null ? null : Number(s.build_scale_ratio),
          text: s.build_scale_text,
        },
        { ratio, text },
        {
          build_scale_ratio: ratio,
          build_scale_text: text,
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
    Body: { tos_mm: number; raw?: string | null; source: 'read' | 'typed'; who: string };
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
            who,
          },
        },
      },
    },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = who_(request.body.who);
      const { tos_mm, source } = request.body;
      const raw = request.body.raw ?? null;
      await confirm(
        s,
        'tos',
        {
          tos_mm: s.tos_mm === null ? null : Number(s.tos_mm),
          raw: s.tos_raw,
          source: s.tos_source,
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
    Body: { pen_class: string; source: 'suggested' | 'person'; who: string };
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
            who,
          },
        },
      },
    },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = who_(request.body.who);
      const { pen_class, source } = request.body;
      if (!PEN_CLASS_RE.test(pen_class))
        throw new HttpError(400, { error: "a pen class is 'width bucket|colour|solid or dash'" });
      await confirm(
        s,
        'pen_class',
        s.pen_class,
        pen_class,
        {
          pen_class,
          pen_class_source: source,
          pen_class_confirmed_by: editor,
          pen_class_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, pen_class, source };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { x: number; y: number; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/pick-pen',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['x', 'y', 'who'],
          additionalProperties: false,
          properties: { x: { type: 'number' }, y: { type: 'number' }, who },
        },
      },
    },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = who_(request.body.who);
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
      await confirm(
        s,
        'pen_class',
        s.pen_class,
        hit.pen_class,
        {
          pen_class: hit.pen_class,
          pen_class_source: 'person',
          pen_class_confirmed_by: editor,
          pen_class_confirmed_at: new Date(),
        },
        editor,
        'pick_pen',
      );
      return { ok: true, pen_class: hit.pen_class, distance_pt: hit.distance_pt };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: { sheet_id: string | null; who: string };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/column-plan',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['sheet_id', 'who'],
          additionalProperties: false,
          properties: { sheet_id: { anyOf: [uuid, { type: 'null' }] }, who },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const s = await loadSheet(projectId, request.params.sheetId);
      const editor = who_(request.body.who);
      const plan = request.body.sheet_id;
      if (plan !== null) {
        if (plan === s.id) throw new HttpError(400, { error: 'a page is not its own column plan' });
        await loadSheet(projectId, plan);
      }
      await confirm(
        s,
        'column_plan_sheet_id',
        s.column_plan_sheet_id,
        plan,
        {
          column_plan_sheet_id: plan,
          column_plan_confirmed_by: editor,
          column_plan_confirmed_at: new Date(),
        },
        editor,
      );
      return { ok: true, column_plan_sheet_id: plan };
    },
  );

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build',
    { schema: { params: sheetParams } },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const last = await db()
        .selectFrom('build_runs')
        .selectAll()
        .where('sheet_id', '=', s.id)
        .orderBy('started_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      const states = await db()
        .selectFrom('members')
        .select(['build_state', sql<number>`count(*)::int`.as('n')])
        .where('sheet_id', '=', s.id)
        .where('build_run_id', 'is not', null)
        .groupBy('build_state')
        .execute();
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
        build_status: s.build_status,
        built_at: s.built_at,
        registration: s.registration,
        last_run: last
          ? {
              id: last.id,
              status: last.status,
              requested_by: last.requested_by,
              started_at: last.started_at,
              finished_at: last.finished_at,
              counts: last.counts,
              notes: last.notes,
              error: last.error,
              rules_version: last.rules_version,
            }
          : null,
        pieces: Object.fromEntries(states.map((r) => [r.build_state ?? 'none', Number(r.n)])),
      };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: {
      who: string;
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
            column_plan_sheet_id: uuid,
            no_column_plan: { type: 'boolean' },
            allow_system_values: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const s = await loadSheet(projectId, request.params.sheetId);
      const editor = who_(request.body.who);
      const inputs: Record<string, unknown> = {};
      if (request.body.column_plan_sheet_id)
        inputs.column_plan_sheet_id = request.body.column_plan_sheet_id;
      if (request.body.no_column_plan) inputs.no_column_plan = true;
      const allowSystem = request.body.allow_system_values === true;
      if (allowSystem) inputs.allow_system_values = true;
      if (!inputs.column_plan_sheet_id && !inputs.no_column_plan) {
        // the page's own choice (a person's or auto mode's), as the worker reads it
        if (s.column_plan_sheet_id) inputs.column_plan_sheet_id = s.column_plan_sheet_id;
        else if (s.column_plan_confirmed_by) inputs.no_column_plan = true;
      }
      const reasons = setupReasons(s, allowSystem);
      if (s.build_role === 'framing' && reasons.length === 0 && !inputs.no_column_plan) {
        const plans = await db()
          .selectFrom('sheets')
          .select('id')
          .where('project_id', '=', projectId)
          .where('build_role', '=', 'column_plan')
          .where('build_status', '=', 'built')
          .execute();
        const named = inputs.column_plan_sheet_id as string | undefined;
        if (named && !plans.some((p) => p.id === named))
          reasons.push('the named column plan page is not built');
        else if (!named && plans.length !== 1 && allowSystem) inputs.no_column_plan = true;
        else if (!named && plans.length === 0)
          reasons.push('build the column plan page first, or say the job has none');
        else if (!named && plans.length > 1)
          reasons.push('several column plan pages are built: name one');
      }
      const file = await db()
        .selectFrom('project_files')
        .select('scan_status')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!file || file.scan_status !== 'done') reasons.push('the PDF scan is not finished');
      if (reasons.length > 0) {
        const run = await db()
          .insertInto('build_runs')
          .values({
            project_id: projectId,
            sheet_id: s.id,
            requested_by: editor,
            status: 'refused',
            inputs: JSON.stringify(inputs),
            error: reasons.join('; '),
            finished_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        throw new HttpError(409, {
          error: 'the page is not ready to build',
          reasons,
          build_run_id: run.id,
        });
      }
      const open = await db()
        .selectFrom('build_runs')
        .select(['id', 'job_id'])
        .where('sheet_id', '=', s.id)
        .where('status', 'in', ['pending', 'running'])
        .executeTakeFirst();
      if (open)
        throw new HttpError(409, {
          error: 'this page is already being built',
          build_run_id: open.id,
        });
      const out = await db()
        .transaction()
        .execute(async (trx) => {
          const run = await trx
            .insertInto('build_runs')
            .values({
              project_id: projectId,
              sheet_id: s.id,
              requested_by: editor,
              mode: 'person',
              inputs: JSON.stringify(inputs),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await logCountAction(trx, {
            projectId,
            sheetId: s.id,
            action: 'rebuild',
            who: editor,
            detail: { build_run_id: run.id },
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
          return { build_run_id: run.id, job_id: job.id };
        });
      return reply.status(202).send({ ...out, status: 'pending' });
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

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/line-first/bom.xlsx',
    { schema: { params: projectParams } },
    async (request, reply) => {
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
