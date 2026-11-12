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
import { loadLabels, resolveProfile } from '../review/profile-link.js';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely, type Selectable } from 'kysely';
import ExcelJS from 'exceljs';
import { defaultCatalogEdition, defaultCatalogLookup } from '../catalog/lookup.js';
import { getDb } from '../db/client.js';
import type { Database, SheetsTable, SnapshotPiece } from '../db/types.js';
import { XLSX_MIME } from '../excel/index.js';
import {
  exampleName,
  findSimilar,
  SYMBOL_FAMILIES,
  TAKEN_PT,
  symbolAt,
  type StoredSymbol,
} from '../review/find-similar.js';
import { recordAction, type EditEntry } from '../review/actions.js';
import {
  SNAP_RADIUS_PT,
  SNAP_SOURCES,
  UNKNOWN_SQUARE,
  unknownSquares,
} from '../review/column-snap.js';
import {
  markerRotation,
  orientationFromRotation,
  glyphCentre,
  periodOf,
  probeBox,
  readOrientation,
  refineCentre,
  rotated,
  type LineRow,
} from '../review/orientation.js';
import { answerKey } from '../review/answer-key.js';
import { logCountAction } from '../review/count-log.js';
import { loadGrades } from '../review/grades.js';
import { angleGradeOf } from '../review/perimeter-angle.js';
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
import { buildWarnings, combineBadges, pageBadge, systemValues } from '../review/page-badge.js';
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
import {
  findSimilarMemberIds,
  firstSnapshotPerView,
  proposedPiece,
  systemPiecesOfSheet,
  type MemberRow,
  type PersonSnap,
} from '../review/person-system-version.js';
import {
  atStrictness,
  imageJob,
  STRICTNESS_DEFAULT,
  STRICTNESS_MAX,
  STRICTNESS_MIN,
  withoutUnticked,
  type ImageRun,
  type Match,
} from '../review/image-similar.js';
import { findSimilarImage } from '../review/settings.js';
import { takeTagNumbers } from '../review/tag-counter.js';
import { projectDuplicateTags, renumberPreview, renumberTags } from '../review/renumber-tags.js';
import { HttpError } from './http-error.js';
import { loadMemberViews } from '../review/member-views.js';
import { firstId, ftIn, setupReasons } from './build.js';

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

/** The members row of a piece a person drew (or accepted from Find similar). */
export function drawnValues(p: {
  projectId: string;
  sheetId: string;
  runId: string;
  viewId: string | null;
  editor: string;
  kind: string;
  prefix: string;
  number: number;
  type: string;
  text: string | null;
  profile: string | null;
  a: PagePt;
  b: PagePt | null;
  ratio: number;
  tos: number | null;
  symbol: string | null;
  symbolSource: 'drawn' | 'find_similar' | null;
  /** Phase 0 profile from callout: where the profile came from (profile-link.ts) */
  profileSource?: 'label' | 'typical' | 'example' | 'person' | null;
  profileLabelId?: string | null;
  profileLink?: Record<string, unknown> | null;
  rotation: number | null;
  realIn: [number, number] | null;
  /** Phase 0: the column's web direction (see orientation.ts) and how it was read */
  orientation?: {
    deg: number | null;
    state: 'clear' | 'unsure' | 'manual' | 'none';
    source: 'click' | 'match' | 'manual' | 'backfill';
  } | null;
}) {
  const column = p.type === 'column';
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const pa = planMm(p.a, p.ratio);
  const pb = p.b ? planMm(p.b, p.ratio) : pa;
  const b = p.b;
  return {
    project_id: p.projectId,
    sheet_id: p.sheetId,
    member_id: `LF-P-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    origin: 'manual',
    type: p.type,
    kind: p.kind,
    kind_evidence: JSON.stringify({ source: 'person' }),
    quantity: 1,
    profile_raw: p.text,
    profile: p.profile,
    profile_source: p.profileSource ?? null,
    profile_label_id: p.profileLabelId ?? null,
    profile_link: p.profileLink ? JSON.stringify(p.profileLink) : null,
    tag_prefix: p.prefix,
    tag_number: p.number,
    build_run_id: p.runId,
    build_view_id: p.viewId,
    page_x0: r2(p.a[0]),
    page_y0: r2(p.a[1]),
    page_x1: b ? r2(b[0]) : null,
    page_y1: b ? r2(b[1]) : null,
    size_state: p.profile ? 'sized' : 'undefined',
    build_state: p.profile ? 'found' : 'attention',
    start_x_mm: r1(pa[0]),
    start_y_mm: r1(pa[1]),
    start_z_mm: column ? null : p.tos,
    end_x_mm: r1(pb[0]),
    end_y_mm: r1(pb[1]),
    end_z_mm: column ? null : p.tos,
    start_elevation_mm: column ? null : p.tos,
    end_elevation_mm: column ? null : p.tos,
    start_resolution_method: 'manual',
    end_resolution_method: 'manual',
    length_source: column ? 'manual' : 'plan_geometry',
    plan_sheet_id: p.sheetId,
    plan_start_x_mm: r1(pa[0]),
    plan_start_y_mm: r1(pa[1]),
    plan_end_x_mm: r1(pb[0]),
    plan_end_y_mm: r1(pb[1]),
    plan_scale_ratio: p.ratio,
    plan_method: 'manual',
    source_bbox: JSON.stringify({
      x0: Math.min(p.a[0], b ? b[0] : p.a[0]) - (column ? 6 : 0),
      y0: Math.min(p.a[1], b ? b[1] : p.a[1]) - (column ? 6 : 0),
      x1: Math.max(p.a[0], b ? b[0] : p.a[0]) + (column ? 6 : 0),
      y1: Math.max(p.a[1], b ? b[1] : p.a[1]) + (column ? 6 : 0),
    }),
    field_sources: '{}',
    field_confidence: '{}',
    review_status: 'edited',
    added_by: p.editor,
    added_at: new Date(),
    rotation_deg: p.rotation,
    orientation_deg: p.orientation?.deg ?? null,
    orientation_state: p.orientation ? p.orientation.state : null,
    orientation_source: p.orientation ? p.orientation.source : null,
    symbol: p.symbol,
    symbol_source: p.symbolSource,
    symbol_real_in: p.realIn ? JSON.stringify(p.realIn) : null,
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
      // Phase 14f: pages whose lines (Pick beam, snapping) are extracted
      const withLines = new Set(
        sheets.length
          ? (
              await db()
                .selectFrom('sheet_lines')
                .select('sheet_id')
                .where(
                  'sheet_id',
                  'in',
                  sheets.map((x) => x.id),
                )
                .execute()
            ).map((r) => r.sheet_id)
          : [],
      );
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
                // Phase 14f: built without column supports (shown on the card and badge)
                warnings: buildWarnings(run ?? null),
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
            // Phase 14a: the page card's name: the main view title, else the title-block name
            view_title: s.view_title ?? null,
            title_block_name: s.title_block_name ?? null,
            // migration 030: a person's page name wins over the names read on the page
            name: s.name_override ?? s.view_title ?? s.title_block_name ?? null,
            name_source: s.name_override
              ? 'person'
              : s.view_title
                ? 'view_title'
                : s.title_block_name
                  ? 'title_block'
                  : null,
            sheet_number_source: s.sheet_number_source ?? null,
            page_type: s.page_type_guess,
            page_kind: s.page_kind,
            // the text step failed on this page: "page N: <step>: <reason>" (worker, per page)
            text_problem:
              s.review_reasons
                .find((r) => r.startsWith('text_read_failed: '))
                ?.slice('text_read_failed: '.length) ?? null,
            lines_ready: withLines.has(s.id),
            // Phase 0 profile from callout: the labels were read (null: not yet) and the page's
            // text lines (0: no text layer, e.g. outlined text)
            labels_read: s.labels_read_at !== null,
            labels_text_lines: s.labels_text_lines,
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
            warnings: perView.flatMap((x) =>
              buildWarnings(x.run ?? null).map((w) => (several ? `${x.v.row.name}: ${w}` : w)),
            ),
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
      const dupes = await projectDuplicateTags(db(), projectId);
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
        // Phase 14f: a tag another member of the scope also has is shown red on the canvas
        pieces: pieces
          .filter((p) => !p.deleted)
          .map(({ start: _s, end: _e, ...rest }) => ({
            ...rest,
            duplicate_tag: dupes.has(rest.id),
          })),
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
      // Phase 0-column-capture: set the web direction, or turn the markers clockwise by rotate_deg
      orientation_deg?: number;
      rotate_deg?: number;
      // Phase 0 count rule: true = count this column (it starts at this level), false = do not, null =
      // the page's default (columns count on column / foundation plans only)
      count_column?: boolean | null;
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
            // Phase 0-column-capture: set the web direction (degrees ccw from +X), or turn the markers
            // clockwise by rotate_deg (R = 90, Shift+R = 15), within each symbol's symmetry
            orientation_deg: { type: 'number', minimum: 0, maximum: 180 },
            rotate_deg: { type: 'number', minimum: -180, maximum: 180 },
            count_column: { type: ['boolean', 'null'] },
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
        if (
          (b.orientation_deg !== undefined || b.rotate_deg !== undefined) &&
          p.type === 'column'
        ) {
          const family = p.symbol ?? 'w_shape';
          const period = periodOf(family);
          if (period !== null) {
            const cur = p.orientation_deg ?? orientationFromRotation(p.rotation_deg ?? 0);
            const next =
              b.orientation_deg !== undefined
                ? b.orientation_deg % period
                : rotated(cur, family, b.rotate_deg as number);
            push(
              p.id,
              'orientation',
              p.orientation_state === null
                ? null
                : {
                    deg: p.orientation_deg,
                    state: p.orientation_state,
                    source: p.orientation_source,
                  },
              { deg: next, state: 'manual', source: 'manual' },
            );
          }
        }
        if (b.count_column !== undefined && p.type === 'column')
          push(p.id, 'column_count', p.count_column, b.count_column);
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
          ...(b.rotate_deg !== undefined && { rotate_deg: b.rotate_deg }),
          ...(b.count_column !== undefined && { count_column: b.count_column }),
          ...(b.orientation_deg !== undefined && { orientation_deg: b.orientation_deg }),
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

  // ---- Phase 14f: Renumber tags (project level, one recorded action) ---------------------------
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/tags/renumber',
    { schema: { params: projectParams } },
    async (request) => {
      await loadProject(request.params.projectId);
      return renumberPreview(db(), request.params.projectId);
    },
  );

  app.post<{ Params: { projectId: string }; Body: { who: string } }>(
    '/api/projects/:projectId/tags/renumber',
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
      return renumberTags(db(), projectId, trimWho(request.body.who));
    },
  );

  app.post<{
    Params: { projectId: string; memberId: string };
    Body: { who: string; a: PagePt; b?: PagePt | null; nudges?: number };
  }>(
    '/api/projects/:projectId/line-first/pieces/:memberId/ends',
    {
      schema: {
        params: memberParams,
        body: {
          type: 'object',
          required: ['who', 'a'],
          additionalProperties: false,
          properties: {
            who,
            a: point,
            b: { anyOf: [point, { type: 'null' }] },
            // Phase 0-14g: arrow-key nudges this move sums up (logged)
            nudges: { type: 'integer', minimum: 1, maximum: 1000 },
          },
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
        request.body.nudges
          ? { fields: ['page_ends'], nudges: request.body.nudges }
          : { fields: ['page_ends'] },
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
      symbol?: string;
      rotation_deg?: number;
      real_in?: [number, number];
      snap?: { source: string; distance?: number; snapped: boolean; refined_in?: number };
      // Phase 0-column-capture: the orientation read at the click (web direction, ccw from +X, displayed
      // frame) with its state, and the click-to-marker time in ms (logged)
      orientation_deg?: number | null;
      orientation_state?: 'clear' | 'unsure' | 'none';
      timing?: { click_to_marker_ms?: number };
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
            // Phase 14b: the palette symbol of a drawn column and its rotation
            symbol: { enum: [...SYMBOL_FAMILIES] },
            rotation_deg: { type: 'number', minimum: -360, maximum: 360 },
            // Phase 0-14g: the snapped symbol's real size [short, long] in inches (the marker's
            // size when the column has no section) and how the click was snapped (logged)
            real_in: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { type: 'number', exclusiveMinimum: 0 },
            },
            orientation_deg: { type: ['number', 'null'], minimum: 0, maximum: 180 },
            orientation_state: { enum: ['clear', 'unsure', 'none'] },
            timing: {
              type: 'object',
              additionalProperties: false,
              properties: { click_to_marker_ms: { type: 'number', minimum: 0, maximum: 600000 } },
            },
            snap: {
              type: 'object',
              required: ['source', 'snapped'],
              additionalProperties: false,
              properties: {
                source: { enum: [...SNAP_SOURCES] },
                distance: { type: 'number', minimum: 0 },
                // Phase 0: the centre was refined to the symbol's own centre by this many real inches
                refined_in: { type: 'number', minimum: 0 },
                snapped: { type: 'boolean' },
              },
            },
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
      // Phase 0 profile from callout: the profile sent with a placed column is the palette's
      // DEFAULT (source example, amber): the column's own label (green), else the view's TYP
      // label (amber), replaces it. Only a profile typed on the member afterwards (the member
      // panel, a separate edit) is the person's and is never replaced.
      const fromLabel = column
        ? resolveProfile(body.a, await loadLabels(db(), s.id, view.row.id), {
            profile: parsed?.canonical ?? null,
            raw: text,
          })
        : null;
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
          const row = await trx
            .insertInto('members')
            .values(
              drawnValues({
                projectId,
                sheetId: s.id,
                runId: run.id,
                viewId: view.row.position === 1 ? null : view.row.id,
                editor,
                kind: info.kind,
                prefix: info.prefix,
                number,
                type,
                text: fromLabel?.profile_raw ?? text,
                profile: fromLabel?.profile ?? parsed?.canonical ?? null,
                profileSource: fromLabel?.source ?? (parsed ? 'example' : null),
                profileLabelId: fromLabel?.label_id ?? null,
                profileLink: fromLabel?.link ?? null,
                a: body.a,
                b,
                ratio,
                tos,
                symbol: column ? (body.symbol ?? null) : null,
                symbolSource: column && body.symbol ? 'drawn' : null,
                rotation:
                  column && body.orientation_deg != null
                    ? markerRotation(body.orientation_deg)
                    : column
                      ? (body.rotation_deg ?? null)
                      : null,
                realIn: column ? (body.real_in ?? null) : null,
                orientation:
                  column && body.orientation_deg !== undefined
                    ? {
                        deg: body.orientation_deg,
                        state: body.orientation_state ?? 'unsure',
                        source: 'click',
                      }
                    : null,
              }) as never,
            )
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
            // Phase 0-14g: per placement, click-to-symbol distance, snapped or not, the source
            detail: {
              kind: info.kind,
              ...(column && body.snap ? { snap: body.snap } : {}),
              ...(column && body.orientation_deg !== undefined
                ? {
                    orientation: {
                      deg: body.orientation_deg,
                      state: body.orientation_state ?? 'unsure',
                    },
                  }
                : {}),
              ...(body.timing?.click_to_marker_ms !== undefined
                ? { click_to_marker_ms: body.timing.click_to_marker_ms }
                : {}),
            },
          });
          return row.id;
        });
      const [piece] = await loadPieces(db(), projectId, { memberIds: [out] });
      return reply.status(201).send(piece);
    },
  );

  // ---- Phase 0-14g: the page's column candidates for the Draw column snap -------------------------
  // GET /api/projects/:projectId/sheets/:sheetId/column-symbols
  //   { snap_radius_pt, build_run_id, symbols[] }  the latest Build's stored symbols that Find
  //   similar can use as an example (a known family or a solid shape), and THE snap radius.
  app.get<{ Params: { projectId: string; sheetId: string } }>(
    '/api/projects/:projectId/sheets/:sheetId/column-symbols',
    { schema: { params: sheetParams } },
    async (request) => {
      const { projectId, sheetId } = request.params;
      await loadSheet(projectId, sheetId);
      const row = await db()
        .selectFrom('page_symbols')
        .select(['build_run_id', 'symbols'])
        .where('sheet_id', '=', sheetId)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      const all = (row?.symbols ?? []) as StoredSymbol[];
      const square = unknownSquares(all);
      const symbols = all
        .map((s, i) => ({ s, sq: square[i]! }))
        .filter(({ s, sq }) => s.family !== 'unknown' || !!s.solid || sq)
        .map(({ s, sq }) => ({
          centre: s.centre,
          box: s.box,
          rotation_deg: s.rotation_deg,
          real_in: s.real_in,
          family: s.family,
          solid: s.solid ?? null,
          // Phase 0-column-capture: an unknown 45 degree square is a capture target (a plate / pier)
          square45: sq,
        }));
      return {
        snap_radius_pt: SNAP_RADIUS_PT,
        square_margin_in: UNKNOWN_SQUARE.click_margin_in,
        build_run_id: row?.build_run_id ?? null,
        symbols,
      };
    },
  );

  // ---- Phase 14b: Find similar ------------------------------------------------------------------
  // POST /api/projects/:projectId/line-first/pieces/:memberId/find-similar
  //   { who, accept?, run_id?, strictness?, unticked? }
  // From a column (drawn or found), the page's stored candidate symbols (page_symbols of its
  // Build) with the same family and real size that are not a column yet, and (Phase 14d/14e,
  // FIND_SIMILAR_IMAGE, on by default) the image matches with their scores. Without accept: a
  // preview (every match with its source and score). With accept: one undoable action creating
  // the matches at the strictness (image score >= it; vector matches always) minus the unticked
  // ones, logged as 'find_similar' with the strictness and the untick list (training data).
  app.post<{
    Params: { projectId: string; memberId: string };
    Body: {
      who: string;
      accept?: boolean;
      run_id?: string;
      strictness?: number;
      unticked?: [number, number][];
      // Phase 0-14g: false = leave the column where it is (Shift placement, nudged)
      snap?: boolean;
      // Phase 0-column-capture: the capture box the person shows [x0, y0, x1, y1] (page points); the
      // search uses exactly it. Absent: the default tight box (identical to main / 14g)
      box?: [number, number, number, number];
      timing?: { find_similar_ms?: number };
    };
  }>(
    '/api/projects/:projectId/line-first/pieces/:memberId/find-similar',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'memberId'],
          properties: { projectId: uuid, memberId: uuid },
        },
        body: {
          type: 'object',
          required: ['who'],
          additionalProperties: false,
          properties: {
            who,
            accept: { type: 'boolean' },
            run_id: uuid,
            snap: { type: 'boolean' },
            box: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number' } },
            timing: {
              type: 'object',
              additionalProperties: false,
              properties: { find_similar_ms: { type: 'number', minimum: 0, maximum: 600000 } },
            },
            strictness: { type: 'number', minimum: STRICTNESS_MIN, maximum: STRICTNESS_MAX },
            unticked: {
              type: 'array',
              maxItems: 5000,
              items: {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { projectId, memberId } = request.params;
      const editor = trimWho(request.body.who);
      const [piece] = await loadPieces(db(), projectId, { memberIds: [memberId] });
      if (!piece || piece.deleted) throw new HttpError(404, { error: 'piece not found' });
      if (piece.type !== 'column' || !piece.a || !piece.sheet_id)
        throw new HttpError(400, { error: 'find similar starts from a column' });
      const sheetId = piece.sheet_id;
      const rows = await db()
        .selectFrom('page_symbols')
        .select(['build_run_id', 'symbols', 'ratio'])
        .where('sheet_id', '=', sheetId)
        .orderBy('created_at', 'desc')
        .execute();
      // Phase 0 column capture: Find similar works on ANY built page. A column plan stores its
      // column symbols (the example may then be a stored symbol); a framing build, a roof plan or
      // a page built without them stores none, and the example is then main's ink read of the
      // drawing: nothing is rebuilt and no beam is touched.
      const stored = rows.find((r) => r.build_run_id === piece.build_run_id) ?? rows[0] ?? null;
      const symbols = (stored?.symbols ?? []) as StoredSymbol[];
      const pageRow = await loadSheet(projectId, sheetId);
      if (pageRow.page_kind !== 'vector')
        throw new HttpError(409, {
          error: 'this page is a scan: Find similar needs a vector page',
          code: 'raster_page',
        });
      if (
        num(piece.scale_ratio) === null &&
        num(pageRow.build_scale_ratio) === null &&
        num(stored?.ratio) === null
      )
        throw new HttpError(409, {
          error: 'the page has no scale yet: set the page scale, then click Find similar again',
          code: 'no_scale',
        });
      let searchRun: string | null = stored?.build_run_id ?? piece.build_run_id;
      if (!searchRun) {
        const last = await db()
          .selectFrom('build_runs')
          .select('id')
          .where('sheet_id', '=', sheetId)
          .where('status', '=', 'done')
          .orderBy('finished_at', 'desc')
          .executeTakeFirst();
        searchRun = last?.id ?? null;
      }
      if (!searchRun)
        throw new HttpError(409, {
          error: 'the page has no Build yet: press Build on it first',
          code: 'no_build',
        });
      const columns = (await loadPieces(db(), projectId, { sheetId }))
        .filter((p) => p.type === 'column' && !p.deleted && p.a)
        .map((p) => p.a as [number, number]);
      const noSymbol = () =>
        new HttpError(409, {
          error: 'click closer to the column symbol',
          code: 'click_closer',
        });
      // Phase 14d: with FIND_SIMILAR_IMAGE on, the worker's image search (vector + image matches)
      // runs as a job; the preview returns its id and Accept creates exactly the previewed points
      let example: {
        family: string;
        name: string;
        real_in: [number, number];
        source: 'vector' | 'ink';
        box: [number, number, number, number] | null;
        centre: [number, number] | null;
        angle: number;
        rect: [number, number][] | null;
      };
      let matches: Match[];
      let image: ImageRun | null = null;
      // Phase 0-14g: how the example was found and where the column ended up (preview only)
      let snapInfo: {
        source: 'symbol' | 'ink';
        distance: number;
        moved: boolean;
        centre: [number, number];
      } | null = null;
      let angles: number[] = [];
      let warning: string | null = null;
      if (findSimilarImage()) {
        const job = await imageJob({
          projectId,
          sheetId,
          memberId,
          click: piece.a,
          buildRunId: searchRun,
          runId: request.body.accept ? request.body.run_id : undefined,
          box: request.body.box ?? null,
        });
        const r = job.result;
        if (!r.example) throw noSymbol();
        example = {
          family: r.example.family,
          name:
            r.example.family === 'unknown'
              ? r.example.solid
                ? `solid_${r.example.solid}`
                : 'drawn_symbol'
              : r.example.family,
          real_in: r.example.real_in,
          source: r.example.source,
          box: r.example.box,
          centre: r.example.centre,
          angle: r.example.angle ?? 0,
          rect: r.example.rect ?? null,
        };
        angles = r.angles ?? [];
        warning = r.warning ?? null;
        // Phase 0-14g: an example read from ink moves the column onto the ink's centre (a stored
        // symbol was snapped by the screen; Shift / nudged placements send snap:false)
        let taken = columns;
        if (r.snap) {
          let moved = false;
          if (
            request.body.snap !== false &&
            !request.body.accept &&
            r.snap.source === 'ink' &&
            r.snap.distance > 0.5
          ) {
            await apply(
              projectId,
              editor,
              [
                {
                  memberId,
                  field: 'page_ends',
                  before: { a: piece.a, b: null },
                  after: { a: r.snap.centre, b: null },
                  status: 'edited',
                },
              ],
              'edit',
              sheetId,
              {
                fields: ['page_ends'],
                snap: {
                  source: 'ink',
                  distance: r.snap.distance,
                  from: piece.a,
                  to: r.snap.centre,
                },
              },
            );
            if (!piece.symbol_real_in)
              await db()
                .updateTable('members')
                .set({ symbol_real_in: JSON.stringify(r.example.real_in) } as never)
                .where('id', '=', memberId)
                .where('symbol_real_in', 'is', null)
                .execute();
            taken = columns.filter((c) => c[0] !== piece.a![0] || c[1] !== piece.a![1]);
            taken.push(r.snap.centre);
            moved = true;
          }
          snapInfo = { ...r.snap, moved };
        }
        const family = (SYMBOL_FAMILIES as readonly string[]).includes(r.example.family)
          ? r.example.family
          : (piece.symbol ?? null);
        matches = r.combined
          .filter(
            (c) =>
              !taken.some((p) => Math.hypot(p[0] - c.centre[0], p[1] - c.centre[1]) <= TAKEN_PT),
          )
          .map((c) => ({
            centre: c.centre,
            symbol: family,
            rotation_deg: ((((piece.rotation_deg ?? 0) + c.rotation) % 180) + 180) % 180,
            real_in: r.example!.real_in,
            source: c.source,
            score: c.score,
          }));
        image = {
          run_id: job.id,
          runtime_s: r.runtime_s,
          vector: r.vector,
          image: r.image,
          cache: r.cache ?? null,
          settings: r.settings,
        };
      } else {
        const ex = symbolAt(
          piece.a,
          symbols,
          num(piece.scale_ratio) ?? num(pageRow.build_scale_ratio) ?? num(stored?.ratio) ?? 1,
        );
        if (!ex) throw noSymbol();
        if (unknownSquares(symbols)[symbols.indexOf(ex)]) ex.square45 = true;
        const [bx0, by0, bx1, by1] = ex.box;
        example = {
          family: ex.family,
          name: exampleName(ex),
          real_in: ex.real_in,
          source: 'vector',
          box: ex.box,
          centre: ex.centre,
          angle: 0,
          rect: [
            [bx0, by0],
            [bx1, by0],
            [bx1, by1],
            [bx0, by1],
          ],
        };
        matches = findSimilar(ex, symbols, columns).map((m) => ({
          centre: m.centre,
          // a solid shape has no family: the matches take the drawn column's symbol
          symbol: m.family === 'unknown' ? (piece.symbol ?? null) : m.family,
          rotation_deg: m.rotation_deg,
          real_in: m.real_in,
          source: 'vector' as const,
          score: null,
        }));
      }
      // Phase 0-column-capture: every match gets its OWN orientation, read from its own lines in a box
      // of the example's size (never the example's angle plus a template turn, which stays only as the
      // amber fallback). The example's family is the palette family the person chose.
      const oriFamily = (SYMBOL_FAMILIES as readonly string[]).includes(example.family)
        ? example.family
        : (piece.symbol ?? 'w_shape');
      const t0 = Date.now();
      let refinedCount = 0;
      const oriRatio =
        num(piece.scale_ratio) ?? num((await loadSheet(projectId, sheetId)).build_scale_ratio);
      if (periodOf(oriFamily) !== null && matches.length > 0 && oriRatio !== null) {
        const lrow = await db()
          .selectFrom('sheet_lines')
          .select('lines')
          .where('sheet_id', '=', sheetId)
          .executeTakeFirst();
        const lines = (lrow ? (lrow.lines as unknown as LineRow[]) : []) as LineRow[];
        const exBox = example.box;
        const hw = exBox ? (exBox[2] - exBox[0]) / 2 : 5;
        const hh = exBox ? (exBox[3] - exBox[1]) / 2 : 5;
        // a stored symbol of a known family gives the size; a plate / pier / ink read does not
        const sizeIn = (SYMBOL_FAMILIES as readonly string[]).includes(example.family)
          ? [Math.min(...example.real_in), Math.max(...example.real_in)]
          : null;
        for (const m of matches) {
          const rd = readOrientation({
            lines,
            // a family-sized window around the match (or the example's size when that is larger)
            box: probeBox(m.centre, oriRatio, hw, hh),
            family: oriFamily,
            ratio: oriRatio,
            sizeIn,
          });
          if (rd.deg !== null && lines.length > 0) {
            // the match's centre refined to its own symbol's centre when 2.5 to 5 in off (never snapped
            // to a grid, never when the reading is not clear)
            const rf =
              rd.state === 'clear' ? refineCentre(m.centre, glyphCentre(rd), oriRatio) : null;
            if (rf?.moved) {
              m.centre = rf.centre;
              refinedCount += 1;
            }
            m.orientation_deg = rd.deg;
            m.orientation_state = rd.state === 'none' ? 'unsure' : rd.state;
            m.rotation_deg = markerRotation(rd.deg);
          } else {
            // no reading: the example's rotation turned like the template turned (the legacy value,
            // kept as is) and its orientation derived from it, amber
            const period = periodOf(oriFamily) as number;
            m.orientation_deg =
              Math.round((orientationFromRotation(m.rotation_deg) % period) * 10) / 10;
            m.orientation_state = 'unsure';
          }
        }
      }
      const orientMs = Date.now() - t0;
      const preview = {
        example: {
          family: example.name,
          real_in: example.real_in,
          // Phase 0-14g: the box that is the example (page points), always shown on the screen
          source: example.source,
          box: example.box,
          centre: example.centre,
          angle: example.angle,
          rect: example.rect,
        },
        snap: snapInfo,
        angles,
        warning,
        // Phase 0: false = no column symbols are stored for this page; the example is the ink read
        symbols_stored: stored !== null,
        count: matches.length,
        points: matches.map((m) => m.centre),
        sources: matches.map((m) => m.source),
        // Phase 14e: every match with its score (null: a vector match), filtered by the slider
        matches: matches.map((m) => ({
          centre: m.centre,
          source: m.source,
          score: m.score,
          orientation_deg: m.orientation_deg ?? null,
          orientation_state: m.orientation_state ?? null,
        })),
        orientation_ms: orientMs,
        refined: refinedCount,
        strictness_default: STRICTNESS_DEFAULT,
        image: image !== null,
        run_id: image?.run_id ?? null,
        runtime_s: image?.runtime_s ?? null,
        cache: image?.cache ?? null,
      };
      if (!request.body.accept) return { ...preview, accepted: false };
      const strictness = request.body.strictness ?? STRICTNESS_DEFAULT;
      const unticked = request.body.unticked ?? [];
      const shown = atStrictness(matches, strictness);
      const chosen = withoutUnticked(shown, unticked);
      if (chosen.length === 0) return { ...preview, accepted: false, count: 0 };
      const sheet = await loadSheet(projectId, sheetId);
      const info = (await loadKinds(db())).get(piece.kind ?? 'Column');
      if (!info) throw new HttpError(400, { error: 'the column kind is not in the list' });
      const ratio = num(piece.scale_ratio) ?? num(sheet.build_scale_ratio);
      if (ratio === null) throw new HttpError(409, { error: 'set the scale of the page first' });
      const runId = piece.build_run_id;
      if (!runId) throw new HttpError(409, { error: 'the column has no build' });
      // Phase 0 profile from callout: a match takes the profile of ITS OWN label (green), else the
      // view's TYP label (amber), else the example's profile (amber): never just the example's
      const labelRows = await loadLabels(
        db(),
        sheetId,
        piece.build_view_id ?? firstId(await viewsOf(db(), sheetId)) ?? null,
      );
      const sources: Record<string, number> = {};
      const created = await db()
        .transaction()
        .execute(async (trx) => {
          const ids: string[] = [];
          for (const m of chosen) {
            const got = resolveProfile(m.centre, labelRows, {
              profile: piece.profile,
              raw: piece.profile_raw,
            });
            sources[got.source ?? 'none'] = (sources[got.source ?? 'none'] ?? 0) + 1;
            const number = await takeTagNumbers(trx, projectId, sheetId, info.prefix);
            const row = await trx
              .insertInto('members')
              .values(
                drawnValues({
                  projectId,
                  sheetId,
                  runId,
                  viewId: piece.build_view_id,
                  editor,
                  kind: info.kind,
                  prefix: info.prefix,
                  number,
                  type: 'column',
                  text: got.profile_raw ?? piece.profile_raw,
                  profile: got.profile ?? piece.profile,
                  profileSource: got.source,
                  profileLabelId: got.label_id,
                  profileLink: got.link,
                  a: m.centre,
                  b: null,
                  ratio,
                  tos: null,
                  symbol: m.symbol,
                  symbolSource: 'find_similar',
                  rotation: m.rotation_deg,
                  realIn: m.real_in,
                  orientation:
                    m.orientation_deg === undefined
                      ? null
                      : {
                          deg: m.orientation_deg,
                          state: m.orientation_state ?? 'unsure',
                          source: 'match',
                        },
                }) as never,
              )
              .returning('id')
              .executeTakeFirstOrThrow();
            ids.push(row.id);
          }
          const actionId = await recordAction(
            trx,
            editor,
            ids.map((id) => ({
              memberId: id,
              field: '__created__',
              before: null,
              after: { type: 'column', kind: info.kind, profile: piece.profile },
              status: 'edited' as const,
            })),
          );
          await logCountAction(trx, {
            projectId,
            sheetId,
            memberId,
            action: 'find_similar',
            who: editor,
            editActionId: actionId,
            detail: {
              example_member_id: memberId,
              created: ids.length,
              family: example.family,
              real_in: example.real_in,
              snap: snapInfo,
              member_ids: ids,
              profile_sources: sources,
              // Phase 0-column-capture: how many matches were read clear / unsure, the capture box
              // when a person changed it, and the time of the search that was previewed (ms)
              refined: refinedCount,
              orientation: {
                clear: chosen.filter((m) => m.orientation_state === 'clear').length,
                unsure: chosen.filter((m) => m.orientation_state !== 'clear').length,
              },
              ...(request.body.box ? { box: request.body.box } : {}),
              ...(request.body.timing?.find_similar_ms !== undefined
                ? { find_similar_ms: request.body.timing.find_similar_ms }
                : {}),
              // Phase 14d: the settings in force (image search on / off, its job and runtime)
              image: image ?? false,
              sources: chosen.map((m) => m.source),
              // Phase 14e: what the person saw and changed (training data)
              strictness,
              shown: shown.length,
              found: matches.length,
              unticked: shown
                .filter((m) => !chosen.includes(m))
                .map((m) => ({ centre: m.centre, source: m.source, score: m.score })),
            },
          });
          return { actionId, ids };
        });
      return {
        ...preview,
        accepted: true,
        count: created.ids.length,
        strictness,
        action_id: created.actionId,
        pieces: await loadPieces(db(), projectId, { memberIds: created.ids }),
      };
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
    // auto mode's version, when it ran (a project may never have run it: the click-first flow)
    const auto = await db()
      .selectFrom('auto_builds')
      .select(['id', 'finished_at'])
      .where('project_id', '=', projectId)
      .where('status', '=', 'done')
      .orderBy('started_at')
      .limit(1)
      .executeTakeFirst();
    const autoSnaps = auto
      ? await db()
          .selectFrom('build_snapshots')
          .selectAll()
          .where('auto_build_id', '=', auto.id)
          .execute()
      : [];
    const personSnaps = await db()
      .selectFrom('build_snapshots')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('mode', '=', 'person')
      .orderBy('created_at')
      .execute();
    if (!auto && personSnaps.length === 0)
      throw new HttpError(409, {
        error: 'no system version yet: build a page first (the first Build is the system version)',
      });
    type VersionSnap = {
      sheet_id: string;
      pieces: SnapshotPiece[];
      setup: Record<string, unknown>;
    };
    const bySheet = new Map<string, VersionSnap>(autoSnaps.map((sn) => [sn.sheet_id, sn]));
    // a page auto mode built keeps auto mode's version. Every other page: what the system produced
    // in the person's builds (the first Build of each view) and the Find similar matches it
    // proposed (review/person-system-version.ts), before any person's edit
    const needing = new Map<string, PersonSnap[]>();
    for (const sn of personSnaps) {
      if (bySheet.get(sn.sheet_id)?.setup.built === true) continue;
      needing.set(sn.sheet_id, [...(needing.get(sn.sheet_id) ?? []), sn]);
    }
    if (needing.size > 0) {
      const sheetIds = [...needing.keys()];
      const memberRows = await db()
        .selectFrom('members')
        .select([
          'id',
          'member_id',
          'sheet_id',
          'origin',
          'type',
          'kind',
          'tag_prefix',
          'tag_number',
          'profile',
          'profile_raw',
          'page_x0',
          'page_y0',
          'page_x1',
          'page_y1',
          'build_state',
          'size_state',
          'support_state',
          'piece_index',
        ])
        .where('project_id', '=', projectId)
        .where('sheet_id', 'in', sheetIds)
        .execute();
      const originOf = new Map(memberRows.map((m) => [m.member_id, m.origin as string]));
      const byUuid = new Map(memberRows.map((m) => [m.id, m]));
      const similar = findSimilarMemberIds(
        await db()
          .selectFrom('count_actions')
          .select(['sheet_id', 'detail'])
          .where('project_id', '=', projectId)
          .where('action', '=', 'find_similar')
          .orderBy('created_at')
          .execute(),
      );
      for (const [sheetId, snaps] of needing) {
        const firsts = firstSnapshotPerView(snaps);
        const pieces = systemPiecesOfSheet(firsts, originOf);
        const have = new Set(pieces.map((p) => p.member_id));
        for (const id of similar.get(sheetId) ?? []) {
          const m = byUuid.get(id);
          if (m && !have.has(m.member_id)) pieces.push(proposedPiece(m as MemberRow));
        }
        bySheet.set(sheetId, { sheet_id: sheetId, pieces, setup: firsts[0]!.setup });
      }
    }
    const snaps = [...bySheet.values()];
    const since = auto?.finished_at ?? personSnaps[0]?.created_at ?? new Date(0);
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
      .where('created_at', '>=', since)
      .orderBy('created_at')
      .execute();
    return {
      auto_build_id: auto?.id ?? null,
      system_source: auto ? 'auto' : 'person',
      ...systemReport(pages, final, log),
    };
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
        'Manual items (angles, bent plates)',
        'Approved despite warning',
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
          p.manual_items,
          p.approved_despite_warning,
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
        t.manual_items,
        t.approved_despite_warning,
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
      const project = await loadProject(projectId);
      const pieces = (await loadPieces(db(), projectId)).filter(counted).map(toBuiltPiece);
      const bom = lineFirstBom(
        pieces,
        await defaultCatalogLookup(db()),
        await loadGrades(db(), projectId),
        angleGradeOf(project),
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
