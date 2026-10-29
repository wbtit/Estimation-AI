// The review UI's routes (Phase 11b, docs/PHASE11B_PLAN.md section 3). Line-first only.
//   POST /api/projects/:projectId/auto-build                       start auto mode (once per project)
//   GET  /api/projects/:projectId/processing                       scan, pipeline and auto mode progress
//   GET  /api/projects/:projectId/pages                            the page cards (badge, setup, counts)
//   GET  /api/projects/:projectId/sheets/:sheetId/line-first       pieces and grid lines of a page
//   POST /api/projects/:projectId/sheets/:sheetId/view             { who } a person opened the page (log)
//   POST /api/projects/:projectId/sheets/:sheetId/save-page        { who } "Save page"
//   POST /api/projects/:projectId/sheets/:sheetId/line-first/pieces { who, kind, a, b?, profile_text? } draw
//   POST /api/projects/:projectId/line-first/pieces/edit           { who, member_ids, profile_text?, kind?, studs?, camber?, ignored? }
//   POST /api/projects/:projectId/line-first/pieces/delete         { who, member_ids }
//   POST /api/projects/:projectId/line-first/pieces/:memberId/ends { who, a, b? } move the ends
//   GET  /api/catalog/sections?q=&limit=                           AISC search (the default edition)
//   GET  /api/projects/:projectId/report[.xlsx]                    SYSTEM VERSION vs SAVED FINAL
//   GET  /api/projects/:projectId/answer-key.json                  the saved final as an answer key
// Member edits are member_edits rows grouped by one action id (multi-select = one action), so the
// existing undo (POST /undo) works on them; every action is also a count_actions row with time.
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely, type Selectable } from 'kysely';
import ExcelJS from 'exceljs';
import { defaultCatalogEdition, defaultCatalogLookup } from '../catalog/lookup.js';
import { getDb } from '../db/client.js';
import type { Database, SheetsTable, SnapshotPiece } from '../db/types.js';
import { XLSX_MIME } from '../excel/index.js';
import { recordAction, type EditEntry } from '../review/actions.js';
import { answerKey } from '../review/answer-key.js';
import { logCountAction } from '../review/count-log.js';
import { loadGrades } from '../review/grades.js';
import { loadKinds, typeOfKind } from '../review/kinds.js';
import { lineFirstBom } from '../review/line-first-bom.js';
import {
  counted,
  loadPieces,
  planMm,
  toBuiltPiece,
  type PagePt,
  type PieceView,
} from '../review/line-first-pieces.js';
import { deleteEntries, kindValue, patchEntries } from '../review/member-ops.js';
import { combineBadges, pageBadge, systemValues } from '../review/page-badge.js';
import {
  asSheet,
  loadViews,
  pickView,
  viewAt,
  viewJson,
  viewsOf,
  type LoadedView,
} from '../review/build-views.js';
import { parseProfile } from '../review/profile.js';
import { systemReport, type SetupValues } from '../review/system-report.js';
import { takeTagNumbers } from '../review/tag-counter.js';
import { HttpError } from './http-error.js';
import { loadMemberViews } from './members.js';
import { ftIn, setupReasons } from './build.js';

export interface ReviewUiRouteOptions {
  db?: Kysely<Database>;
}

const uuid = { type: 'string', format: 'uuid' } as const;
const who = { type: 'string', minLength: 1, maxLength: 100 } as const;
const point = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
} as const;
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
const whoBody = {
  type: 'object',
  required: ['who'],
  additionalProperties: false,
  properties: { who },
} as const;

/** Member edit actions counted as "pending" (since the last save) and undoable. */
const EDIT_ACTIONS = ['edit', 'delete', 'add', 'ignore', 'approve'] as const;
const NOT_EDITS = ['view', 'save'] as const;

type Sheet = Selectable<SheetsTable>;
const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

function trimWho(value: string): string {
  const w = value.trim();
  if (w === '') throw new HttpError(400, { error: 'who must not be blank' });
  return w;
}

/** The setup values of a sheet as the report compares them. */
export function setupOf(s: Sheet): SetupValues {
  const c = s.crop_region as { x0: number; y0: number; x1: number; y1: number } | null;
  return {
    role: s.build_role,
    crop: c ? { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 } : null,
    pen_class: s.pen_class,
    scale_ratio: num(s.build_scale_ratio),
    tos_mm: num(s.tos_mm),
    column_plan: s.column_plan_sheet_id,
  };
}

/** The setup values stored in a snapshot (the SYSTEM VERSION). */
export function snapshotSetupOf(setup: Record<string, unknown>): SetupValues {
  const v = (k: string) => (setup[k] as { value?: unknown; value_mm?: unknown } | undefined) ?? {};
  const role = v('role').value as string | null | undefined;
  return {
    role: role === 'skip' || role === undefined ? null : role,
    crop: (v('crop').value as SetupValues['crop']) ?? null,
    pen_class: (v('pen_class').value as string | null) ?? null,
    scale_ratio: (v('scale').value as number | null) ?? null,
    tos_mm: (v('tos').value_mm as number | null) ?? null,
    column_plan: (v('column_plan').value as string | null) ?? null,
  };
}

export const reviewUiRoutes: FastifyPluginAsync<ReviewUiRouteOptions> = async (app, options) => {
  const db = () => options.db ?? getDb();

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    return reply.send(err);
  });

  async function loadProject(projectId: string) {
    const p = await db()
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', projectId)
      .executeTakeFirst();
    if (!p) throw new HttpError(404, { error: 'project not found' });
    return p;
  }

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

  // ---- auto mode and processing -------------------------------------------------------------------
  app.post<{ Params: { projectId: string }; Body: { crossing_rule?: 'family' | 'direction' } }>(
    '/api/projects/:projectId/auto-build',
    {
      schema: {
        params: projectParams,
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: { crossing_rule: { enum: ['family', 'direction'] } },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      await loadProject(projectId);
      const file = await db()
        .selectFrom('project_files')
        .select('scan_status')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      if (!file || file.scan_status !== 'done')
        throw new HttpError(409, { error: 'the PDF scan is not finished' });
      const done = await db()
        .selectFrom('auto_builds')
        .select('id')
        .where('project_id', '=', projectId)
        .where('status', 'in', ['pending', 'running', 'done'])
        .executeTakeFirst();
      if (done) throw new HttpError(409, { error: 'auto mode already ran or is running' });
      const out = await db()
        .transaction()
        .execute(async (trx) => {
          const auto = await trx
            .insertInto('auto_builds')
            .values({ project_id: projectId })
            .returning('id')
            .executeTakeFirstOrThrow();
          const job = await trx
            .insertInto('jobs')
            .values({
              type: 'auto_build',
              payload: JSON.stringify({
                project_id: projectId,
                auto_build_id: auto.id,
                crossing_rule: request.body?.crossing_rule ?? 'family',
              }),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await trx
            .updateTable('auto_builds')
            .set({ job_id: job.id })
            .where('id', '=', auto.id)
            .execute();
          return { auto_build_id: auto.id, job_id: job.id };
        });
      return reply.status(202).send({ ...out, status: 'pending' });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/processing',
    { schema: { params: projectParams } },
    async (request) => {
      const { projectId } = request.params;
      const project = await loadProject(projectId);
      const file = await db()
        .selectFrom('project_files')
        .select(['scan_status', 'scan_error', 'page_count', 'pages_scanned'])
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      const pipeline = await db()
        .selectFrom('jobs')
        .select(['status', 'error'])
        .where('type', '=', 'auto_run')
        .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      const queued = await db()
        .selectFrom('jobs')
        .select(['status', 'error'])
        .where('type', '=', 'auto_build')
        .where(sql<boolean>`payload->>'project_id' = ${projectId}`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      const auto = await db()
        .selectFrom('auto_builds')
        .selectAll()
        .where('project_id', '=', projectId)
        .orderBy('started_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return {
        project_status: project.status,
        scan: file
          ? {
              status: file.scan_status,
              error: file.scan_error,
              pages: file.page_count,
              pages_done: file.pages_scanned,
            }
          : null,
        pipeline: pipeline ? { status: pipeline.status, error: pipeline.error } : null,
        auto_build: auto
          ? {
              status: auto.status,
              pages: auto.pages_total,
              pages_done: auto.pages_done,
              error: auto.error,
              counts: auto.counts,
            }
          : queued
            ? {
                status: queued.status === 'failed' ? 'failed' : 'pending',
                pages: 0,
                pages_done: 0,
                error: queued.error,
                counts: {},
              }
            : null,
      };
    },
  );

  // ---- pages -------------------------------------------------------------------------------------
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/pages',
    { schema: { params: projectParams } },
    async (request) => {
      const { projectId } = request.params;
      await loadProject(projectId);
      const sheets = await db()
        .selectFrom('sheets')
        .selectAll()
        .where('project_id', '=', projectId)
        .orderBy('page_index')
        .execute();
      const runs = await db()
        .selectFrom('build_runs')
        .select(['sheet_id', 'view_id', 'status', 'started_at', 'error', 'notes', 'mode', 'counts'])
        .where('project_id', '=', projectId)
        .orderBy('started_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const viewsBy = await loadViews(
        db(),
        sheets.map((s) => s.id),
      );
      const log = await db()
        .selectFrom('count_actions')
        .select(['sheet_id', 'action', 'created_at', 'detail'])
        .where('project_id', '=', projectId)
        .where('sheet_id', 'is not', null)
        .where('action', 'not in', [...NOT_EDITS, 'setup', 'pick_pen', 'rebuild', 'role'])
        .orderBy('created_at')
        .execute();
      // view adds, deletes and box changes not undone count as pending edits too
      const viewChanges = await db()
        .selectFrom('view_undo')
        .select(['sheet_id', 'created_at'])
        .where('project_id', '=', projectId)
        .where('undone_at', 'is', null)
        .execute();
      const pieces = await loadPieces(db(), projectId);
      const piecesOf = new Map<string, PieceView[]>();
      for (const p of pieces)
        if (p.sheet_id) piecesOf.set(p.sheet_id, [...(piecesOf.get(p.sheet_id) ?? []), p]);
      return {
        pages: sheets.map((page) => {
          const views = viewsBy.get(page.id) ?? [];
          const first = pickView(views);
          const s = first ? asSheet(page, first) : page;
          const own = log.filter((l) => l.sheet_id === s.id);
          const lastEdit = own.length ? own[own.length - 1]!.created_at : null;
          const since = s.reviewed_at ? new Date(s.reviewed_at as Date).getTime() : -Infinity;
          const recent = own.filter((l) => new Date(l.created_at).getTime() > since);
          const isViewUndo = (l: { detail: unknown }) =>
            Boolean((l.detail as { view_change?: string } | null)?.view_change);
          const pending =
            Math.max(
              0,
              recent.filter((l) => (EDIT_ACTIONS as readonly string[]).includes(l.action)).length -
                recent.filter((l) => l.action === 'undo' && !isViewUndo(l)).length,
            ) +
            viewChanges.filter(
              (c) =>
                c.sheet_id === s.id && new Date(c.created_at as unknown as Date).getTime() > since,
            ).length;
          const firstViewId = first?.row.id;
          const runOf = (v: LoadedView) =>
            runs.find((r) => r.sheet_id === page.id && (r.view_id ?? firstViewId) === v.row.id) ??
            null;
          const ps = (piecesOf.get(s.id) ?? []).filter(counted);
          // approved members are confirmed: they are not counted as found, review or attention
          const stateCounts = (list: PieceView[]) => {
            const byState = (st: string) =>
              list.filter((p) => !p.approved && p.build_state === st).length;
            return {
              approved: list.filter((p) => p.approved).length,
              pieces: list.length,
              beams: list.filter(
                (p) => p.type !== 'column' && p.type !== 'brace' && p.type !== 'joist',
              ).length,
              columns: list.filter((p) => p.type === 'column').length,
              braces: list.filter((p) => p.type === 'brace').length,
              found: byState('found'),
              needs_review: byState('needs_review'),
              attention: byState('attention'),
            };
          };
          const several = views.length > 1;
          const perView = views.map((v) => {
            const vs = asSheet(page, v);
            const run = runOf(v);
            const sys = systemValues(vs);
            const badge = pageBadge({
              role: vs.build_role,
              built_at: vs.built_at,
              setup_changed_at: vs.setup_changed_at,
              reviewed_at: page.reviewed_at,
              last_edit_at: lastEdit,
              last_run: run ? { status: run.status, started_at: run.started_at } : null,
              system_values: sys,
              scale_missing: vs.build_scale_ratio === null,
            });
            const reasons =
              run && (run.status === 'refused' || run.status === 'failed')
                ? (run.error ?? '').split('; ').filter((x) => x !== '')
                : setupReasons(vs, true);
            const counts = (run?.counts ?? {}) as Record<string, unknown>;
            return {
              v,
              run,
              sys,
              badge,
              reasons,
              json: {
                ...viewJson(v),
                badge,
                reasons,
                notes: run?.notes ?? [],
                system_values: sys,
                deselections_unmatched:
                  typeof counts.deselections_unmatched === 'number'
                    ? counts.deselections_unmatched
                    : 0,
                counts: stateCounts(
                  ps.filter((p) => (p.build_view_id ?? firstViewId) === v.row.id),
                ),
              },
            };
          });
          const firstRun = perView[0]?.run ?? null;
          const sys = [...new Set(perView.flatMap((x) => x.sys))];
          return {
            id: s.id,
            page_index: s.page_index,
            page_number: s.page_index + 1,
            sheet_number: s.sheet_number,
            title: s.title,
            page_type: s.page_type_guess,
            page_kind: s.page_kind,
            width_pt: num(s.width_pt),
            height_pt: num(s.height_pt),
            rotation: s.rotation,
            thumbnail_url: s.thumbnail_path
              ? `/api/projects/${projectId}/sheets/${s.id}/thumbnail`
              : null,
            badge: combineBadges(perView.map((x) => x.badge)),
            reasons: perView.flatMap((x) =>
              several ? x.reasons.map((m) => `${x.v.row.name}: ${m}`) : x.reasons,
            ),
            notes: firstRun?.notes ?? [],
            system_values: sys,
            setup: {
              role: s.build_role,
              crop: s.crop_region,
              pen_class: s.pen_class,
              pen_class_source: s.pen_class_source,
              scale_ratio: num(s.build_scale_ratio),
              scale_text: s.build_scale_text,
              tos_mm: num(s.tos_mm),
              tos_raw: s.tos_raw,
              column_plan_sheet_id: s.column_plan_sheet_id,
            },
            views: perView.map((x) => x.json),
            /** The page's own crop from before views (View 1's "Reset box to page crop"). */
            page_crop: page.crop_region,
            scales_found: s.scales,
            built_at: s.built_at,
            reviewed_by: s.reviewed_by,
            reviewed_at: s.reviewed_at,
            pending_edits: pending,
            counts: stateCounts(ps),
          };
        }),
      };
    },
  );

  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/line-first',
    { schema: { params: sheetParams } },
    async (request) => {
      const { projectId, sheetId } = request.params;
      const page = await loadSheet(projectId, sheetId);
      const views = await viewsOf(db(), page.id);
      const first = pickView(views);
      const s = first ? asSheet(page, first) : page;
      // the grid lines of each view's latest finished build
      const done = await db()
        .selectFrom('build_runs')
        .select(['id', 'view_id', 'counts'])
        .where('sheet_id', '=', s.id)
        .where('status', '=', 'done')
        .orderBy('finished_at', 'desc')
        .execute();
      const latest = views
        .map((v) => done.find((r) => (r.view_id ?? first?.row.id) === v.row.id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined);
      const grid = latest.length
        ? await db()
            .selectFrom('grid_lines')
            .select(['label', 'family', 'x0', 'y0', 'x1', 'y1', 'bubble'])
            .where(
              'build_run_id',
              'in',
              latest.map((r) => r.id),
            )
            .orderBy('label')
            .execute()
        : [];
      const pieces = await loadPieces(db(), projectId, { sheetId });
      return {
        sheet_id: s.id,
        crop: s.crop_region,
        pen_class: s.pen_class,
        pens: first ? first.pens.map((p) => p.pen_class) : [],
        tos_mm: num(s.tos_mm),
        scale_ratio: num(s.build_scale_ratio),
        views: views.map((v) => {
          const run = done.find((r) => (r.view_id ?? first?.row.id) === v.row.id);
          const c = (run?.counts ?? {}) as Record<string, unknown>;
          return {
            ...viewJson(v),
            deselections_unmatched:
              typeof c.deselections_unmatched === 'number' ? c.deselections_unmatched : 0,
          };
        }),
        grid_lines: grid.map((g) => ({
          label: g.label,
          family: g.family,
          a: [Number(g.x0), Number(g.y0)],
          b: [Number(g.x1), Number(g.y1)],
          bubble: g.bubble,
        })),
        pieces: pieces.filter((p) => !p.deleted).map(({ start: _s, end: _e, ...rest }) => rest),
      };
    },
  );

  app.post<{ Params: { projectId: string; sheetId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/view',
    { schema: { params: sheetParams, body: whoBody } },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      await logCountAction(db(), {
        projectId: s.project_id,
        sheetId: s.id,
        action: 'view',
        who: trimWho(request.body.who),
      });
      return { ok: true };
    },
  );

  app.post<{ Params: { projectId: string; sheetId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/save-page',
    { schema: { params: sheetParams, body: whoBody } },
    async (request) => {
      const s = await loadSheet(request.params.projectId, request.params.sheetId);
      const editor = trimWho(request.body.who);
      const now = new Date();
      const views = await viewsOf(db(), s.id);
      // per view: the values still system values; the view column of each is
      // <value>_confirmed_by / _at (role, box for the crop, scale, tos, column_plan); a system pen
      // is confirmed on its view_pens row
      const COL: Record<string, string> = {
        role: 'role',
        crop: 'box',
        scale: 'scale',
        tos: 'tos',
        column_plan: 'column_plan',
      };
      const perView = views.map((v) => ({ v, values: systemValues(asSheet(s, v)) }));
      const confirmed = [...new Set(perView.flatMap((x) => x.values))];
      await db()
        .transaction()
        .execute(async (trx) => {
          await trx
            .updateTable('sheets')
            .set({ reviewed_by: editor, reviewed_at: now })
            .where('id', '=', s.id)
            .execute();
          for (const { v, values } of perView) {
            const set: Record<string, unknown> = {};
            for (const x of values)
              if (COL[x]) {
                set[`${COL[x]}_confirmed_by`] = editor;
                set[`${COL[x]}_confirmed_at`] = now;
              }
            if (Object.keys(set).length)
              await trx
                .updateTable('build_views')
                .set(set as never)
                .where('id', '=', v.row.id)
                .execute();
            if (values.includes('pen_class'))
              await trx
                .updateTable('view_pens')
                .set({ confirmed_by: editor, confirmed_at: now })
                .where('view_id', '=', v.row.id)
                .where('confirmed_by', 'is', null)
                .execute();
          }
          await trx
            .insertInto('sheet_edits')
            .values({
              sheet_id: s.id,
              field_name: 'save_page',
              original_value: JSON.stringify({ reviewed_by: s.reviewed_by }),
              corrected_value: JSON.stringify({ reviewed_by: editor, confirmed }),
              editor,
            })
            .execute();
          await logCountAction(trx, {
            projectId: s.project_id,
            sheetId: s.id,
            action: 'save',
            who: editor,
            detail: { confirmed },
          });
        });
      return { ok: true, reviewed_by: editor, reviewed_at: now, confirmed };
    },
  );

  // ---- pieces ------------------------------------------------------------------------------------
  async function piecesOrThrow(projectId: string, ids: string[]): Promise<PieceView[]> {
    const ps = await loadPieces(db(), projectId, { memberIds: ids });
    if (ps.length !== new Set(ids).size)
      throw new HttpError(404, { error: 'a piece was not found (or is not a built piece)' });
    return ps;
  }

  async function apply(
    projectId: string,
    editor: string,
    entries: EditEntry[],
    action: 'edit' | 'delete' | 'add' | 'ignore' | 'approve',
    sheetId: string | null,
    detail: Record<string, unknown>,
  ): Promise<string | null> {
    if (entries.length === 0) return null;
    return db()
      .transaction()
      .execute(async (trx) => {
        const actionId = await recordAction(trx, editor, entries);
        await logCountAction(trx, {
          projectId,
          sheetId,
          memberId: entries.length === 1 ? entries[0]!.memberId : null,
          action,
          who: editor,
          editActionId: actionId,
          detail,
        });
        return actionId;
      });
  }

  app.post<{
    Params: { projectId: string };
    Body: {
      who: string;
      member_ids: string[];
      profile_text?: string | null;
      kind?: string;
      studs?: number | null;
      camber?: string | null;
      ignored?: boolean;
      approved?: boolean;
    };
  }>(
    '/api/projects/:projectId/line-first/pieces/edit',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'member_ids'],
          additionalProperties: false,
          properties: {
            who,
            member_ids: { type: 'array', items: uuid, minItems: 1, maxItems: 2000 },
            profile_text: { type: ['string', 'null'], maxLength: 80 },
            kind: { type: 'string', minLength: 1, maxLength: 80 },
            studs: { type: ['integer', 'null'], minimum: 0, maximum: 999 },
            camber: { type: ['string', 'null'], maxLength: 40 },
            ignored: { type: 'boolean' },
            approved: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const b = request.body;
      const editor = trimWho(b.who);
      const pieces = await piecesOrThrow(projectId, b.member_ids);
      const views = new Map(
        (await loadMemberViews(db(), projectId, { memberIds: b.member_ids })).map((v) => [v.id, v]),
      );
      const kinds = b.kind !== undefined ? await loadKinds(db()) : null;
      const info = b.kind !== undefined ? kinds!.get(b.kind) : undefined;
      if (b.kind !== undefined && !info)
        throw new HttpError(400, { error: `"${b.kind}" is not a kind of the list` });
      const entries: EditEntry[] = [];
      const push = (id: string, field: string, before: unknown, after: unknown) => {
        if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
          entries.push({ memberId: id, field, before, after, status: 'edited' });
      };
      for (const p of pieces) {
        const m = views.get(p.id)!;
        if (b.profile_text !== undefined)
          entries.push(...patchEntries(m, null, { profile_text: b.profile_text }));
        if (info && (m.kind.name !== info.kind || m.kind.source !== 'person')) {
          push(p.id, 'kind', kindValue(m), info.kind);
          push(p.id, 'type', m.type, typeOfKind(info, m.type as never));
          if (m.tag.prefix !== info.prefix || m.tag.number === null) {
            const n = await takeTagNumbers(db(), projectId, p.sheet_id, info.prefix);
            push(
              p.id,
              'tag',
              { prefix: m.tag.prefix, number: m.tag.number },
              {
                prefix: info.prefix,
                number: n,
              },
            );
          }
        }
        if (b.studs !== undefined) push(p.id, 'studs', p.studs, b.studs);
        if (b.camber !== undefined)
          push(p.id, 'camber_raw', p.camber_raw, b.camber?.trim() || null);
        if (b.ignored !== undefined) push(p.id, 'ignored', p.ignored, b.ignored);
        // a deleted piece is not approved (it is not on the page)
        if (b.approved !== undefined && !p.deleted) push(p.id, 'approved', p.approved, b.approved);
      }
      const only = (f: string) => entries.length > 0 && entries.every((e) => e.field === f);
      const actionId = await apply(
        projectId,
        editor,
        entries,
        only('ignored') ? 'ignore' : only('approved') ? 'approve' : 'edit',
        pieces[0]?.sheet_id ?? null,
        {
          members: pieces.length,
          changed: new Set(entries.map((e) => e.memberId)).size,
          fields: [...new Set(entries.map((e) => e.field))],
          ...(b.approved !== undefined && { approved: b.approved }),
        },
      );
      return {
        action_id: actionId,
        changed: entries.length > 0,
        pieces: await loadPieces(db(), projectId, { memberIds: b.member_ids }),
      };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string; member_ids: string[] } }>(
    '/api/projects/:projectId/line-first/pieces/delete',
    {
      schema: {
        params: projectParams,
        body: {
          type: 'object',
          required: ['who', 'member_ids'],
          additionalProperties: false,
          properties: {
            who,
            member_ids: { type: 'array', items: uuid, minItems: 1, maxItems: 2000 },
          },
        },
      },
    },
    async (request) => {
      const { projectId } = request.params;
      const editor = trimWho(request.body.who);
      const pieces = await piecesOrThrow(projectId, request.body.member_ids);
      const views = await loadMemberViews(db(), projectId, { memberIds: request.body.member_ids });
      const entries = views.flatMap((v) => deleteEntries(v));
      const actionId = await apply(
        projectId,
        editor,
        entries,
        'delete',
        pieces[0]?.sheet_id ?? null,
        {
          members: pieces.length,
        },
      );
      return { action_id: actionId, deleted: entries.length };
    },
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; a: PagePt; b?: PagePt | null };
  }>(
    '/api/projects/:projectId/line-first/pieces/:memberId/ends',
    {
      schema: {
        params: memberParams,
        body: {
          type: 'object',
          required: ['who', 'a'],
          additionalProperties: false,
          properties: { who, a: point, b: { anyOf: [point, { type: 'null' }] } },
        },
      },
    },
    async (request) => {
      const { projectId, memberId } = request.params;
      const editor = trimWho(request.body.who);
      const [p] = await piecesOrThrow(projectId, [memberId]);
      const piece = p!;
      const b = request.body.b ?? null;
      if ((piece.b === null) !== (b === null))
        throw new HttpError(400, { error: 'a beam needs two ends, a column one point' });
      const after = { a: request.body.a, b };
      const actionId = await apply(
        projectId,
        editor,
        [
          {
            memberId,
            field: 'page_ends',
            before: { a: piece.a, b: piece.b },
            after,
            status: 'edited',
          },
        ],
        'edit',
        piece.sheet_id,
        { fields: ['page_ends'] },
      );
      const [now] = await loadPieces(db(), projectId, { memberIds: [memberId] });
      return { action_id: actionId, piece: now };
    },
  );

  app.post<{
    Params: { projectId: string; sheetId: string };
    Body: {
      who: string;
      kind: string;
      a: PagePt;
      b?: PagePt | null;
      profile_text?: string | null;
      view_id?: string;
    };
  }>(
    '/api/projects/:projectId/sheets/:sheetId/line-first/pieces',
    {
      schema: {
        params: sheetParams,
        body: {
          type: 'object',
          required: ['who', 'kind', 'a'],
          additionalProperties: false,
          properties: {
            who,
            kind: { type: 'string', minLength: 1, maxLength: 80 },
            a: point,
            b: { anyOf: [point, { type: 'null' }] },
            profile_text: { type: ['string', 'null'], maxLength: 80 },
            view_id: uuid,
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId, sheetId } = request.params;
      const page = await loadSheet(projectId, sheetId);
      const views = await viewsOf(db(), page.id);
      // the view the piece is drawn in: the one named, else the smallest view box holding it
      const view = request.body.view_id
        ? pickView(views, request.body.view_id)
        : viewAt(views, request.body.a[0], request.body.a[1]);
      if (!view) throw new HttpError(404, { error: 'view not found on this page' });
      const s = asSheet(page, view);
      const firstView = pickView(views)!;
      const body = request.body;
      const editor = trimWho(body.who);
      const info = (await loadKinds(db())).get(body.kind);
      if (!info) throw new HttpError(400, { error: `"${body.kind}" is not a kind of the list` });
      const type = typeOfKind(info, 'beam');
      const column = type === 'column';
      const b = body.b ?? null;
      if (column !== (b === null))
        throw new HttpError(400, { error: 'a column is one point, any other piece two ends' });
      const ratio = num(s.build_scale_ratio);
      if (ratio === null) throw new HttpError(409, { error: 'set the scale of the page first' });
      const text = body.profile_text?.trim() || null;
      const parsed = text ? parseProfile(text) : null;
      const tos = num(s.tos_mm);
      const pa = planMm(body.a, ratio);
      const pb = b ? planMm(b, ratio) : pa;
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const out = await db()
        .transaction()
        .execute(async (trx) => {
          // a drawn piece belongs to the page's latest finished build, or to a person's run
          const runs = await trx
            .selectFrom('build_runs')
            .select(['id', 'view_id'])
            .where('sheet_id', '=', s.id)
            .where('status', '=', 'done')
            .orderBy('finished_at', 'desc')
            .execute();
          let run: { id: string } | undefined = runs.find(
            (r) => (r.view_id ?? firstView.row.id) === view.row.id,
          );
          if (!run)
            run = await trx
              .insertInto('build_runs')
              .values({
                project_id: projectId,
                sheet_id: s.id,
                view_id: view.row.id,
                requested_by: editor,
                mode: 'person',
                status: 'done',
                finished_at: new Date(),
                notes: sql`ARRAY['drawn_by_person']::text[]` as never,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
          const number = await takeTagNumbers(trx, projectId, s.id, info.prefix);
          const sizeState = parsed ? 'sized' : 'undefined';
          const row = await trx
            .insertInto('members')
            .values({
              project_id: projectId,
              sheet_id: s.id,
              member_id: `LF-P-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
              origin: 'manual',
              type,
              kind: info.kind,
              kind_evidence: JSON.stringify({ source: 'person' }),
              quantity: 1,
              profile_raw: text,
              profile: parsed?.canonical ?? null,
              tag_prefix: info.prefix,
              tag_number: number,
              build_run_id: run.id,
              build_view_id: view.row.position === 1 ? null : view.row.id,
              page_x0: r2(body.a[0]),
              page_y0: r2(body.a[1]),
              page_x1: b ? r2(b[0]) : null,
              page_y1: b ? r2(b[1]) : null,
              size_state: sizeState,
              build_state: parsed ? 'found' : 'attention',
              start_x_mm: r1(pa[0]),
              start_y_mm: r1(pa[1]),
              start_z_mm: column ? null : tos,
              end_x_mm: r1(pb[0]),
              end_y_mm: r1(pb[1]),
              end_z_mm: column ? null : tos,
              start_elevation_mm: column ? null : tos,
              end_elevation_mm: column ? null : tos,
              start_resolution_method: 'manual',
              end_resolution_method: 'manual',
              length_source: column ? 'manual' : 'plan_geometry',
              plan_sheet_id: s.id,
              plan_start_x_mm: r1(pa[0]),
              plan_start_y_mm: r1(pa[1]),
              plan_end_x_mm: r1(pb[0]),
              plan_end_y_mm: r1(pb[1]),
              plan_scale_ratio: ratio,
              plan_method: 'manual',
              source_bbox: JSON.stringify({
                x0: Math.min(body.a[0], b ? b[0] : body.a[0]) - (column ? 6 : 0),
                y0: Math.min(body.a[1], b ? b[1] : body.a[1]) - (column ? 6 : 0),
                x1: Math.max(body.a[0], b ? b[0] : body.a[0]) + (column ? 6 : 0),
                y1: Math.max(body.a[1], b ? b[1] : body.a[1]) + (column ? 6 : 0),
              }),
              field_sources: '{}',
              field_confidence: '{}',
              review_status: 'edited',
              added_by: editor,
              added_at: new Date(),
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow();
          const actionId = await recordAction(trx, editor, [
            {
              memberId: row.id,
              field: '__created__',
              before: null,
              after: {
                type,
                kind: info.kind,
                profile_raw: text,
                profile: parsed?.canonical ?? null,
              },
              status: 'edited',
            },
          ]);
          await logCountAction(trx, {
            projectId,
            sheetId: s.id,
            memberId: row.id,
            action: 'add',
            who: editor,
            editActionId: actionId,
            detail: { kind: info.kind },
          });
          return row.id;
        });
      const [piece] = await loadPieces(db(), projectId, { memberIds: [out] });
      return reply.status(201).send(piece);
    },
  );

  // ---- catalog search ----------------------------------------------------------------------------
  app.get<{ Querystring: { q?: string; limit?: number } }>(
    '/api/catalog/sections',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 40 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request) => {
      const edition = await defaultCatalogEdition(db());
      if (edition === null) return { edition: null, sections: [] };
      const q = (request.query.q ?? '').toUpperCase().replace(/\s+/g, '');
      let query = db()
        .selectFrom('catalog_shapes')
        .select(['shape_name', 'family', 'weight_lb_per_ft'])
        .where('edition', '=', edition);
      if (q !== '')
        query = query.where(
          sql<boolean>`upper(replace(shape_name, ' ', '')) LIKE ${`${q.replace(/[%_]/g, '')}%`}`,
        );
      const rows = await query
        .orderBy('family')
        .orderBy(sql`length(shape_name)`)
        .orderBy('shape_name')
        .limit(request.query.limit ?? 30)
        .execute();
      return {
        edition,
        sections: rows.map((r) => ({
          name: r.shape_name,
          type: r.family,
          lb_per_ft: r.weight_lb_per_ft === null ? null : Number(r.weight_lb_per_ft),
        })),
      };
    },
  );

  // ---- report and answer key ---------------------------------------------------------------------
  async function report(projectId: string) {
    await loadProject(projectId);
    const auto = await db()
      .selectFrom('auto_builds')
      .select(['id', 'finished_at'])
      .where('project_id', '=', projectId)
      .where('status', '=', 'done')
      .orderBy('started_at')
      .limit(1)
      .executeTakeFirst();
    if (!auto) throw new HttpError(409, { error: 'no system version: auto mode has not run' });
    const autoSnaps = await db()
      .selectFrom('build_snapshots')
      .selectAll()
      .where('auto_build_id', '=', auto.id)
      .execute();
    // session preparation: auto mode only suggests, so a page's system version is the snapshot of
    // its first person Build frozen before any edit, unless auto mode built the page
    const personSnaps = await db()
      .selectFrom('build_snapshots')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('mode', '=', 'person')
      .where('before_user_edit', '=', true)
      .orderBy('created_at')
      .execute();
    const bySheet = new Map(autoSnaps.map((sn) => [sn.sheet_id, sn]));
    const firstPerson = new Set<string>();
    for (const sn of personSnaps) {
      const have = bySheet.get(sn.sheet_id);
      if (firstPerson.has(sn.sheet_id) || (have && have.setup.built === true)) continue;
      bySheet.set(sn.sheet_id, sn);
      firstPerson.add(sn.sheet_id);
    }
    const snaps = [...bySheet.values()];
    const rawSheets = await db()
      .selectFrom('sheets')
      .selectAll()
      .where('project_id', '=', projectId)
      .execute();
    const viewsBy = await loadViews(
      db(),
      rawSheets.map((s) => s.id),
    );
    // the final setup of a page is its first view's (the report compares per page)
    const sheets = new Map(
      rawSheets.map((s) => {
        const first = pickView(viewsBy.get(s.id) ?? []);
        return [s.id, first ? asSheet(s, first) : s];
      }),
    );
    const pages = snaps
      .map((sn) => {
        const s = sheets.get(sn.sheet_id);
        return s
          ? {
              sheet_id: s.id,
              page_index: s.page_index,
              sheet_number: s.sheet_number,
              system: sn.pieces as SnapshotPiece[],
              system_setup: snapshotSetupOf(sn.setup),
              final_setup: setupOf(s),
              reviewed_by: s.reviewed_by,
              reviewed_at: s.reviewed_at ? new Date(s.reviewed_at as Date).toISOString() : null,
            }
          : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => a.page_index - b.page_index);
    const final = await loadPieces(db(), projectId);
    const log = await db()
      .selectFrom('count_actions')
      .select(['sheet_id', 'created_at'])
      .where('project_id', '=', projectId)
      .where('created_at', '>=', auto.finished_at ?? new Date(0))
      .orderBy('created_at')
      .execute();
    return { auto_build_id: auto.id, ...systemReport(pages, final, log) };
  }

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/report',
    { schema: { params: projectParams } },
    async (request) => report(request.params.projectId),
  );

  app.get<{ Params: { projectId: string }; Querystring: { who?: string } }>(
    '/api/projects/:projectId/report.xlsx',
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
        detail: { file: 'report.xlsx' },
      }).catch(() => undefined);
      const r = await report(request.params.projectId);
      const wb = new ExcelJS.Workbook();
      const pages = wb.addWorksheet('Pages');
      const head = [
        'Page',
        'Sheet',
        'System pieces',
        'Final pieces',
        'Kept unchanged',
        'Confirmed unchanged by person',
        'Size changed',
        'Length changed',
        'Deleted by person',
        'Ignored',
        'Removed by rebuild',
        'Added by person',
        'Added by rebuild',
        'Setup changed',
        'Minutes',
        'Saved by',
      ];
      pages.addRow(head);
      for (const p of r.pages)
        pages.addRow([
          p.page_index + 1,
          p.sheet_number,
          p.system_pieces,
          p.final_pieces,
          p.kept_unchanged,
          p.confirmed_unchanged,
          p.size_changed,
          p.length_changed,
          p.deleted_by_person,
          p.ignored,
          p.removed_by_rebuild,
          p.added_by_person,
          p.added_by_rebuild,
          p.setup_changed.join(', '),
          p.minutes,
          p.reviewed_by,
        ]);
      const t = r.total;
      pages.addRow([
        'Total',
        null,
        t.system_pieces,
        t.final_pieces,
        t.kept_unchanged,
        t.confirmed_unchanged,
        t.size_changed,
        t.length_changed,
        t.deleted_by_person,
        t.ignored,
        t.removed_by_rebuild,
        t.added_by_person,
        t.added_by_rebuild,
        t.pages_with_setup_changes,
        t.minutes,
        t.pages_reviewed,
      ]);
      const sizes = wb.addWorksheet('Sizes');
      sizes.addRow(['Size', 'System count', 'System length', 'Final count', 'Final length']);
      for (const s of r.sizes)
        sizes.addRow([
          s.size,
          s.system_count,
          ftIn(s.system_length_mm),
          s.final_count,
          ftIn(s.final_length_mm),
        ]);
      const setup = wb.addWorksheet('Setup');
      setup.addRow(['Page', 'Sheet', 'Value', 'System', 'Final']);
      for (const p of r.pages)
        for (const k of p.setup_changed)
          setup.addRow([
            p.page_index + 1,
            p.sheet_number,
            k,
            JSON.stringify(p.setup[k].system),
            JSON.stringify(p.setup[k].final),
          ]);
      const buf = await wb.xlsx.writeBuffer();
      return reply
        .header('content-type', XLSX_MIME)
        .header(
          'content-disposition',
          `attachment; filename="report-${request.params.projectId}.xlsx"`,
        )
        .send(Buffer.from(buf));
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/answer-key.json',
    { schema: { params: projectParams } },
    async (request, reply) => {
      const { projectId } = request.params;
      await loadProject(projectId);
      const pieces = (await loadPieces(db(), projectId)).filter(counted).map(toBuiltPiece);
      const bom = lineFirstBom(
        pieces,
        await defaultCatalogLookup(db()),
        await loadGrades(db(), projectId),
      );
      const sheets = new Map(
        (
          await db()
            .selectFrom('sheets')
            .select(['id', 'sheet_number', 'page_index'])
            .where('project_id', '=', projectId)
            .execute()
        ).map((s) => [s.id, { sheet_number: s.sheet_number, page_index: s.page_index }]),
      );
      return reply
        .header('content-disposition', `attachment; filename="answer-key-${projectId}.json"`)
        .send(answerKey(bom, sheets));
    },
  );
};
