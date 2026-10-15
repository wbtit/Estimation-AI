// Line-first build (Phase 11): per-page setup, Build, page build state and the BOM.
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/role       { role, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/crop       { box, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/scale      { scale_text | ratio, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/tos        { tos_mm, raw?, source, who }
//   POST /api/projects/:projectId/sheets/:sheetId/build-setup/pen-class  { pen_class, source, who }
//   GET  /api/projects/:projectId/sheets/:sheetId/build                  page build state
//   POST /api/projects/:projectId/sheets/:sheetId/build                  { who, column_plan_sheet_id?, no_column_plan? }
//   GET  /api/projects/:projectId/line-first/bom[.xlsx]                  Steel Genie columns
//
// Every confirmation stores who and when on the sheet and an append-only sheet_edits row (before and
// after). Build refuses (409, with the reasons, and a refused build_runs row) until the page is set
// up: the same rules as the worker's build_sheet job (worker/src/build/job.py, setup_reasons).
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely, type Selectable } from 'kysely';
import ExcelJS from 'exceljs';
import { defaultCatalogLookup } from '../catalog/lookup.js';
import { getDb } from '../db/client.js';
import type { Database, SheetsTable } from '../db/types.js';
import { XLSX_MIME } from '../excel/index.js';
import { loadGrades } from '../review/grades.js';
import { lineFirstBom, type BuiltPiece } from '../review/line-first-bom.js';
import { parseScaleExact } from '../scale/index.js';
import { HttpError } from './http-error.js';
import { loadMemberViews } from './members.js';

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

/** Why the page cannot be built yet; empty when it can. Same rules as the worker. */
export function setupReasons(s: Sheet): string[] {
  const out: string[] = [];
  if (s.build_role !== 'column_plan' && s.build_role !== 'framing')
    out.push('page role not set (column plan or framing)');
  if (s.crop_region === null || !s.crop_confirmed_by) out.push('crop not confirmed');
  if (s.build_scale_ratio === null || !s.scale_confirmed_by) out.push('scale not confirmed');
  if (s.build_role === 'framing') {
    if (!s.tos_confirmed_by) out.push('T.O.S. not confirmed');
    if (!s.pen_class || !s.pen_class_confirmed_by) out.push('beam pen class not confirmed');
  }
  return out;
}

/**
 * Colour state of a built piece after a person's edits: a size a person gave makes an undefined
 * piece sized ('person'); the support part is the build's (worker/src/build/pieces.py rules).
 */
export function effectiveState(
  sizeState: string | null,
  supportState: string | null,
  profile: string | null,
): { size_state: string | null; build_state: BuiltPiece['build_state'] } {
  const size = profile && sizeState === 'undefined' ? 'person' : sizeState;
  if (size === 'undefined' || supportState === 'none')
    return { size_state: size, build_state: 'attention' };
  if (size === 'inferred' || supportState === 'one')
    return { size_state: size, build_state: 'needs_review' };
  return { size_state: size, build_state: 'found' };
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

  /** Set sheet columns and log the change as one sheet_edits row, in one transaction. */
  async function confirm(
    sheet: Sheet,
    field: string,
    before: unknown,
    after: unknown,
    set: Record<string, unknown>,
    editor: string,
  ): Promise<void> {
    await db()
      .transaction()
      .execute(async (trx) => {
        await trx
          .updateTable('sheets')
          .set(set as never)
          .where('id', '=', sheet.id)
          .execute();
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

  app.post<{ Params: { projectId: string; sheetId: string }; Body: { role: string; who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/build-setup/role',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['role', 'who'],
          additionalProperties: false,
          properties: { role: { enum: ['column_plan', 'framing'] }, who },
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
    Body: { who: string; column_plan_sheet_id?: string; no_column_plan?: boolean };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/build',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: { who, column_plan_sheet_id: uuid, no_column_plan: { type: 'boolean' } },
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
      const reasons = setupReasons(s);
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
              inputs: JSON.stringify(inputs),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
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
    const rows = await db()
      .selectFrom('members')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('build_run_id', 'is not', null)
      .execute();
    const views = rows.length
      ? await loadMemberViews(db(), projectId, { memberIds: rows.map((r) => r.id) })
      : [];
    const viewOf = new Map(views.map((v) => [v.id, v]));
    const num = (v: string | null) => (v === null ? null : Number(v));
    const pieces: BuiltPiece[] = [];
    for (const r of rows) {
      const v = viewOf.get(r.id);
      if (!v || v.deleted || v.not_member !== null || v.existing || v.merged_into !== null)
        continue;
      const xyz = (x: string | null, y: string | null, z: string | null) => {
        const a = [num(x), num(y), num(z)];
        return a.every((n): n is number => n !== null) ? (a as [number, number, number]) : null;
      };
      pieces.push({
        id: r.id,
        member_id: r.member_id,
        sheet_id: r.sheet_id,
        type: v.type,
        kind: v.kind.name ?? r.kind,
        tag: v.tag.text || null,
        quantity: v.quantity,
        profile: v.profile,
        profile_raw: v.profile_raw,
        start: xyz(r.start_x_mm, r.start_y_mm, r.start_z_mm),
        end: xyz(r.end_x_mm, r.end_y_mm, r.end_z_mm),
        ...effectiveState(r.size_state, r.support_state, v.profile),
        support_state: r.support_state,
        piece_index: r.piece_index,
      });
    }
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
        'Length (mm)',
        'Grade',
        'Weight (kg)',
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
          r.length_mm,
          r.grade,
          r.weight_kg,
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
        Math.round(b.totals.length_mm),
        null,
        Math.round(b.totals.weight_kg * 100) / 100,
      ]);
      ws.addRow([
        'ATTENTION (not in the total)',
        null,
        null,
        b.attention.pieces,
        null,
        null,
        Math.round(b.attention.length_mm),
        null,
        Math.round(b.attention.weight_kg * 100) / 100,
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
