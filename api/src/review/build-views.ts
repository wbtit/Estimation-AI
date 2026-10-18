// Build views (Phase 11c, docs/PHASE11C_PLAN.md): a page has one or more views; each view holds the
// setup the build reads (box, role, scale, T.O.S., beam pens, exclusions, deselections, column plan
// link). The setup rules of a page (setupReasons, systemValues, setupOf) are written for a sheet row,
// so a view is read through `asSheet`: the sheet row with its setup columns replaced by the view's
// values. The first view of a page therefore behaves exactly as the page did before views.
import type { Kysely, Selectable, Transaction } from 'kysely';
import type {
  BuildViewsTable,
  Database,
  RoleBehaviour,
  SheetsTable,
  ViewPensTable,
} from '../db/types.js';

type Db = Kysely<Database> | Transaction<Database>;
type Sheet = Selectable<SheetsTable>;
export type ViewRow = Selectable<BuildViewsTable>;
export type PenRow = Selectable<ViewPensTable>;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ExclusionView {
  id: string;
  box: Box;
  status: 'suggested' | 'accepted';
  rule: string | null;
}

export interface LoadedView {
  row: ViewRow;
  behaviour: RoleBehaviour | null; // null: no role yet
  pens: PenRow[]; // by position
  plan_sheet_id: string | null; // the sheet of the linked column-plan view
  exclusions: ExclusionView[];
  deselections: { id: string; line: [number, number, number, number] }[];
}

/** Built-in names a page role maps to (the old role values and auto mode). */
export const NAME_OF_ROLE: Record<string, string> = {
  column_plan: 'Column plan',
  framing: 'Framing plan',
};
export const SKIP_NAME = 'Other';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The views of the given sheets with pens, behaviour, exclusions and deselections, by position. */
export async function loadViews(db: Db, sheetIds: string[]): Promise<Map<string, LoadedView[]>> {
  const out = new Map<string, LoadedView[]>();
  if (sheetIds.length === 0) return out;
  const rows = await db
    .selectFrom('build_views as v')
    .leftJoin('role_names as r', 'r.name', 'v.role_name')
    .leftJoin('build_views as p', 'p.id', 'v.column_plan_view_id')
    .selectAll('v')
    .select(['r.behaviour as behaviour', 'p.sheet_id as plan_sheet_id'])
    .where('v.sheet_id', 'in', sheetIds)
    .orderBy('v.sheet_id')
    .orderBy('v.position')
    .execute();
  const ids = rows.map((r) => r.id);
  const pens = ids.length
    ? await db
        .selectFrom('view_pens')
        .selectAll()
        .where('view_id', 'in', ids)
        .orderBy('position')
        .execute()
    : [];
  const exc = ids.length
    ? await db
        .selectFrom('view_exclusions')
        .select(['id', 'view_id', 'box', 'status', 'rule'])
        .where('view_id', 'in', ids)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  const des = ids.length
    ? await db
        .selectFrom('view_deselections')
        .select(['id', 'view_id', 'x0', 'y0', 'x1', 'y1'])
        .where('view_id', 'in', ids)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  for (const r of rows) {
    const { behaviour, plan_sheet_id, ...row } = r;
    const v: LoadedView = {
      row: row as ViewRow,
      behaviour: (behaviour as RoleBehaviour | null) ?? null,
      pens: pens.filter((p) => p.view_id === r.id),
      plan_sheet_id: plan_sheet_id ?? null,
      exclusions: exc
        .filter((e) => e.view_id === r.id)
        .map((e) => ({ id: e.id, box: e.box as Box, status: e.status, rule: e.rule })),
      deselections: des
        .filter((d) => d.view_id === r.id)
        .map((d) => ({
          id: d.id,
          line: [Number(d.x0), Number(d.y0), Number(d.x1), Number(d.y1)],
        })),
    };
    out.set(r.sheet_id, [...(out.get(r.sheet_id) ?? []), v]);
  }
  return out;
}

/** The views of one sheet (at least the first view: the sheets trigger makes it). */
export async function viewsOf(db: Db, sheetId: string): Promise<LoadedView[]> {
  return (await loadViews(db, [sheetId])).get(sheetId) ?? [];
}

/** The sheet row as the setup rules read it, with the view's values in the setup columns. */
export function asSheet(s: Sheet, v: LoadedView): Sheet {
  const r = v.row;
  const pen = v.pens[0] ?? null;
  const role = v.behaviour === 'column_plan' || v.behaviour === 'framing' ? v.behaviour : null;
  return {
    ...s,
    build_role: role,
    role_confirmed_by: r.role_confirmed_by,
    role_confirmed_at: r.role_confirmed_at,
    crop_region: r.box,
    crop_confirmed_by: r.box_confirmed_by,
    crop_confirmed_at: r.box_confirmed_at,
    build_scale_ratio: r.scale_ratio,
    build_scale_text: r.scale_text,
    scale_confirmed_by: r.scale_confirmed_by,
    scale_confirmed_at: r.scale_confirmed_at,
    tos_mm: r.tos_mm,
    tos_raw: r.tos_raw,
    tos_source: r.tos_source,
    tos_confirmed_by: r.tos_confirmed_by,
    tos_confirmed_at: r.tos_confirmed_at,
    pen_class: pen?.pen_class ?? null,
    pen_class_source: pen ? pen.source : r.no_beams_by ? 'person' : null,
    pen_class_confirmed_by: pen ? pen.confirmed_by : r.no_beams_by,
    pen_class_confirmed_at: pen ? pen.confirmed_at : r.no_beams_at,
    column_plan_sheet_id: v.plan_sheet_id,
    column_plan_confirmed_by: r.column_plan_confirmed_by,
    column_plan_confirmed_at: r.column_plan_confirmed_at,
    setup_changed_at: r.setup_changed_at,
    built_at: r.built_at,
    registration: r.registration,
  };
}

/** The view a body names (it must belong to the sheet), or the first view. */
export function pickView(views: LoadedView[], viewId?: string | null): LoadedView | null {
  if (viewId) return views.find((v) => v.row.id === viewId) ?? null;
  return views.find((v) => v.row.position === 1) ?? views[0] ?? null;
}

/** A view as the review UI shows it. */
export function viewJson(v: LoadedView) {
  const r = v.row;
  return {
    id: r.id,
    position: r.position,
    name: r.name,
    box: r.box as Box | null,
    role_name: r.role_name,
    behaviour: v.behaviour,
    scale_ratio: num(r.scale_ratio),
    scale_text: r.scale_text,
    tos_mm: num(r.tos_mm),
    tos_raw: r.tos_raw,
    pens: v.pens.map((p) => ({ pen_class: p.pen_class, position: p.position, source: p.source })),
    no_beams: r.no_beams_by !== null,
    column_plan_view_id: r.column_plan_view_id,
    column_plan_sheet_id: v.plan_sheet_id,
    exclusions: v.exclusions,
    deselections: v.deselections,
    setup_changed_at: r.setup_changed_at,
    built_at: r.built_at,
  };
}

/** Is a page point inside a box? */
export function inBox(b: Box | null, x: number, y: number): boolean {
  return b !== null && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/** The view a page point belongs to: the smallest view box holding it, else the first view. */
export function viewAt(views: LoadedView[], x: number, y: number): LoadedView | null {
  const holding = views
    .filter((v) => inBox(v.row.box as Box | null, x, y))
    .sort(
      (a, b) => area(a.row.box as Box) - area(b.row.box as Box) || a.row.position - b.row.position,
    );
  return holding[0] ?? pickView(views);
}

const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
