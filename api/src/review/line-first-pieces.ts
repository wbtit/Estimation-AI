// Built pieces of the line-first build (Phase 11b) with their effective values: what the review UI
// shows, the BOM sums and the system-vs-final report compares. Edits are member_edits rows like any
// other member (the latest row of a field wins; an undo appends the inverse row), so the existing
// undo works on them. Effective values come from loadMemberViews (size, type, kind, tag, quantity,
// deleted) plus the line-first fields kept here:
//   studs, camber_raw   the size label's extras, as a person typed them
//   ignored             on the page, grey, out of the BOM
//   page_ends           { a: [x, y], b: [x, y] | null } a person moved an end (displayed page points)
// Length = support-to-support: the 3D distance of the stored plan end points (both ends at the page
// T.O.S., so with no T.O.S. it is the plan length), or after a moved end the page distance x the
// build scale (pt x 25.4/72 x ratio). Deterministic.
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { loadMemberViews } from '../routes/members.js';
import type { BuiltPiece } from './line-first-bom.js';

export const MM_PER_PT = 25.4 / 72;

export type PagePt = [number, number];

export interface PieceView {
  id: string;
  member_id: string;
  sheet_id: string | null;
  type: string;
  kind: string | null;
  tag: string | null;
  quantity: number;
  profile: string | null;
  profile_raw: string | null;
  studs: number | null;
  camber_raw: string | null;
  ignored: boolean;
  deleted: boolean;
  /** Drawn by a person in the review UI. */
  added: boolean;
  /** Any edit row (a person touched it; a rebuild keeps it as it is). */
  edited: boolean;
  /** Displayed page points; b is null for a column. */
  a: PagePt | null;
  b: PagePt | null;
  ends_moved: boolean;
  length_mm: number | null;
  /** Elevation of both ends (the page T.O.S. when the piece was built), mm. */
  elevation_mm: number | null;
  build_state: BuiltPiece['build_state'];
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
  scale_ratio: number | null;
  evidence: unknown;
  build_run_id: string | null;
  /** Plan frame end points in mm (x right, y up), z = elevation or 0. */
  start: [number, number, number] | null;
  end: [number, number, number] | null;
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

/** Plan frame point in mm of a displayed page point (x right, y up), as the worker writes it. */
export function planMm(p: PagePt, ratio: number): [number, number] {
  const k = MM_PER_PT * ratio;
  return [p[0] * k, -p[1] * k];
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

function isPt(v: unknown): v is PagePt {
  return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && isFinite(x));
}

/** The latest value of each line-first field from a member's edits (oldest first). */
export function lineFirstEdits(
  rows: readonly { field_name: string; corrected_value: unknown }[],
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const r of rows)
    if (['studs', 'camber_raw', 'ignored', 'page_ends'].includes(r.field_name))
      out.set(r.field_name, r.corrected_value);
  return out;
}

export async function loadPieces(
  db: Kysely<Database>,
  projectId: string,
  filter: { sheetId?: string; memberIds?: string[] } = {},
): Promise<PieceView[]> {
  let q = db
    .selectFrom('members')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('build_run_id', 'is not', null);
  if (filter.sheetId) q = q.where('sheet_id', '=', filter.sheetId);
  if (filter.memberIds) {
    if (filter.memberIds.length === 0) return [];
    q = q.where('id', 'in', filter.memberIds);
  }
  const rows = await q.orderBy('member_id').execute();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const views = new Map(
    (await loadMemberViews(db, projectId, { memberIds: ids })).map((v) => [v.id, v]),
  );
  const edits = await db
    .selectFrom('member_edits')
    .select(['member_id', 'field_name', 'corrected_value'])
    .where('member_id', 'in', ids)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const editsOf = new Map<string, { field_name: string; corrected_value: unknown }[]>();
  for (const e of edits) editsOf.set(e.member_id, [...(editsOf.get(e.member_id) ?? []), e]);
  const out: PieceView[] = [];
  for (const r of rows) {
    const v = views.get(r.id);
    if (!v) continue;
    const own = editsOf.get(r.id) ?? [];
    const lf = lineFirstEdits(own);
    const ratio = num(r.plan_scale_ratio);
    const elevation = num(r.start_elevation_mm);
    const z = elevation ?? 0;
    const stored: [PagePt | null, PagePt | null] = [
      r.page_x0 === null ? null : [Number(r.page_x0), Number(r.page_y0)],
      r.page_x1 === null ? null : [Number(r.page_x1), Number(r.page_y1)],
    ];
    const moved = lf.get('page_ends') as { a?: unknown; b?: unknown } | null | undefined;
    const endsMoved = !!moved && isPt(moved.a);
    const a = endsMoved ? (moved.a as PagePt) : stored[0];
    const b = endsMoved ? (isPt(moved.b) ? moved.b : null) : stored[1];
    let start: [number, number, number] | null = null;
    let end: [number, number, number] | null = null;
    if (endsMoved && ratio !== null && a) {
      const pa = planMm(a, ratio);
      const pb = b ? planMm(b, ratio) : pa;
      start = [pa[0], pa[1], z];
      end = [pb[0], pb[1], z];
    } else {
      const sx = num(r.start_x_mm);
      const sy = num(r.start_y_mm);
      const ex = num(r.end_x_mm);
      const ey = num(r.end_y_mm);
      if (sx !== null && sy !== null) start = [sx, sy, num(r.start_z_mm) ?? z];
      if (ex !== null && ey !== null) end = [ex, ey, num(r.end_z_mm) ?? z];
    }
    const length =
      v.type !== 'column' && start && end
        ? Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
        : null;
    const studs = lf.has('studs') ? (lf.get('studs') as number | null) : r.studs;
    const camber = lf.has('camber_raw') ? (lf.get('camber_raw') as string | null) : r.camber_raw;
    out.push({
      id: r.id,
      member_id: r.member_id,
      sheet_id: r.sheet_id,
      type: v.type,
      kind: v.kind.name ?? r.kind,
      tag: v.tag.text || null,
      quantity: v.quantity,
      profile: v.profile,
      profile_raw: v.profile_raw,
      studs: studs ?? null,
      camber_raw: camber ?? null,
      ignored: lf.has('ignored') ? lf.get('ignored') === true : r.ignored,
      deleted: v.deleted,
      added: r.added_by !== null,
      edited: own.length > 0,
      a,
      b,
      ends_moved: endsMoved,
      length_mm: length && length > 0 ? Math.round(length * 10) / 10 : null,
      elevation_mm: elevation,
      ...effectiveState(r.size_state, r.support_state, v.profile),
      support_state: r.support_state,
      piece_index: r.piece_index,
      scale_ratio: ratio,
      evidence: r.label_evidence,
      build_run_id: r.build_run_id,
      start,
      end,
    });
  }
  return out;
}

/** Pieces that count: not deleted, not ignored. */
export function counted(p: PieceView): boolean {
  return !p.deleted && !p.ignored;
}

/** The BOM's input for a piece (lineFirstBom). */
export function toBuiltPiece(p: PieceView): BuiltPiece {
  return {
    id: p.id,
    member_id: p.member_id,
    sheet_id: p.sheet_id,
    type: p.type,
    kind: p.kind,
    tag: p.tag,
    quantity: p.quantity,
    profile: p.profile,
    profile_raw: p.profile_raw,
    start: p.type === 'column' ? null : p.start,
    end: p.type === 'column' ? null : p.end,
    build_state: p.build_state,
    size_state: p.size_state,
    support_state: p.support_state,
    piece_index: p.piece_index,
  };
}
