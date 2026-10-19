// SYSTEM VERSION vs SAVED FINAL (Phase 11b, docs/PHASE11B_PLAN.md section 5; rules fixed before any
// review). Pure functions: the routes load the snapshots, the current pieces, the sheets and the log.
//
// Matching, per page: first the same member id; then, among the pieces left, the same kind and
//   beams: directions within MATCH_ANGLE_DEG, the other piece's middle within MATCH_OFFSET_PT of the
//   line, and an overlap of at least MATCH_OVERLAP of the shorter piece;
//   columns: centres within MATCH_OFFSET_PT;
// the closest pair (distance between middles) is matched first.
// Classes of a system piece: kept unchanged / confirmed unchanged by person (a person approved it
// and its size and length are the system's) / size changed / length changed (more than 1 inch; a
// piece can be both) / deleted by person / ignored / removed by rebuild (no final match). Final
// pieces with no system match: added by person (drawn) or added by rebuild (a later build); ones a
// person deleted again are counted apart.
// Minutes per page: the project log in time order; each gap to the next action counts for that
// action's page when both are on the same page, capped at IDLE_SECONDS.
import type { PieceView, PagePt } from './line-first-pieces.js';
import type { SnapshotPiece } from '../db/types.js';

export const MATCH_ANGLE_DEG = 5;
export const MATCH_OFFSET_PT = 6;
export const MATCH_OVERLAP = 0.5;
export const LENGTH_TOLERANCE_MM = 25.4;
export const IDLE_SECONDS = 300;

export type SystemClass =
  | 'kept_unchanged'
  | 'confirmed_unchanged'
  | 'size_changed'
  | 'length_changed'
  | 'size_and_length_changed'
  | 'deleted_by_person'
  | 'ignored'
  | 'removed_by_rebuild';

export interface SetupValues {
  role: string | null;
  crop: { x0: number; y0: number; x1: number; y1: number } | null;
  pen_class: string | null;
  scale_ratio: number | null;
  tos_mm: number | null;
  column_plan: string | null;
}

export interface PageInput {
  sheet_id: string;
  page_index: number;
  sheet_number: string | null;
  system: SnapshotPiece[];
  system_setup: SetupValues;
  final_setup: SetupValues;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface PageReport {
  sheet_id: string;
  page_index: number;
  sheet_number: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  system_pieces: number;
  final_pieces: number;
  kept_unchanged: number;
  confirmed_unchanged: number;
  size_changed: number;
  length_changed: number;
  deleted_by_person: number;
  ignored: number;
  removed_by_rebuild: number;
  added_by_person: number;
  added_by_rebuild: number;
  added_then_deleted: number;
  setup_changed: (keyof SetupValues)[];
  setup: { [K in keyof SetupValues]: { system: SetupValues[K]; final: SetupValues[K] } };
  minutes: number;
}

export interface SizeRow {
  size: string;
  system_count: number;
  system_length_mm: number;
  final_count: number;
  final_length_mm: number;
}

export interface SystemReport {
  pages: PageReport[];
  total: Omit<
    PageReport,
    | 'sheet_id'
    | 'page_index'
    | 'sheet_number'
    | 'setup'
    | 'setup_changed'
    | 'reviewed_by'
    | 'reviewed_at'
  > & { pages_with_setup_changes: number; pages_reviewed: number };
  sizes: SizeRow[];
}

type Seg = { a: PagePt; b: PagePt | null; kind: string | null };

function mid(s: Seg): PagePt {
  return s.b ? [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2] : s.a;
}

function angleOf(a: PagePt, b: PagePt): number {
  return ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 180) % 180;
}

/** Whether two pieces are the same piece by geometry (see the header). */
export function sameGeometry(s: Seg, f: Seg): boolean {
  if ((s.kind ?? '') !== (f.kind ?? '')) return false;
  if (!s.b || !f.b) {
    if (s.b || f.b) return false;
    return Math.hypot(s.a[0] - f.a[0], s.a[1] - f.a[1]) <= MATCH_OFFSET_PT;
  }
  const d = Math.abs(angleOf(s.a, s.b) - angleOf(f.a, f.b));
  if (Math.min(d, 180 - d) > MATCH_ANGLE_DEG) return false;
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  if (len === 0) return false;
  const ux = (s.b[0] - s.a[0]) / len;
  const uy = (s.b[1] - s.a[1]) / len;
  const m = mid(f);
  const off = Math.abs((m[0] - s.a[0]) * uy - (m[1] - s.a[1]) * ux);
  if (off > MATCH_OFFSET_PT) return false;
  const t0 = (f.a[0] - s.a[0]) * ux + (f.a[1] - s.a[1]) * uy;
  const t1 = (f.b[0] - s.a[0]) * ux + (f.b[1] - s.a[1]) * uy;
  const shared = Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
  const fLen = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  return shared >= MATCH_OVERLAP * Math.min(len, fLen);
}

export function sizeKey(profile: string | null | undefined): string | null {
  return profile ? profile.toUpperCase().replace(/\s+/g, '') : null;
}

function segOfSystem(p: SnapshotPiece): Seg | null {
  if (!p.page) return null;
  const [x0, y0, x1, y1] = p.page;
  const column = p.type === 'column';
  return { a: [x0, y0], b: column ? null : [x1, y1], kind: p.kind };
}

function segOfFinal(p: PieceView): Seg | null {
  return p.a ? { a: p.a, b: p.b, kind: p.kind } : null;
}

/** Pairs (system index, final index) by the matching rule. */
export function matchPieces(
  system: readonly SnapshotPiece[],
  final: readonly PieceView[],
): Map<number, number> {
  const out = new Map<number, number>();
  const usedF = new Set<number>();
  const byId = new Map(final.map((f, j) => [f.member_id, j]));
  system.forEach((s, i) => {
    const j = byId.get(s.member_id);
    if (j !== undefined) {
      out.set(i, j);
      usedF.add(j);
    }
  });
  const pairs: { i: number; j: number; d: number }[] = [];
  system.forEach((s, i) => {
    if (out.has(i)) return;
    const ss = segOfSystem(s);
    if (!ss) return;
    final.forEach((f, j) => {
      if (usedF.has(j)) return;
      const fs = segOfFinal(f);
      if (!fs || !sameGeometry(ss, fs)) return;
      const a = mid(ss);
      const b = mid(fs);
      pairs.push({ i, j, d: Math.hypot(a[0] - b[0], a[1] - b[1]) });
    });
  });
  pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);
  for (const p of pairs) {
    if (out.has(p.i) || usedF.has(p.j)) continue;
    out.set(p.i, p.j);
    usedF.add(p.j);
  }
  return out;
}

export function classify(s: SnapshotPiece, f: PieceView | undefined): SystemClass {
  if (!f) return 'removed_by_rebuild';
  if (f.deleted) return 'deleted_by_person';
  if (f.ignored) return 'ignored';
  const size = sizeKey(s.profile) !== sizeKey(f.profile);
  let length = false;
  if (s.type !== 'column') {
    if ((s.length_mm === null) !== (f.length_mm === null)) length = true;
    else if (s.length_mm !== null && f.length_mm !== null)
      length = Math.abs(s.length_mm - f.length_mm) > LENGTH_TOLERANCE_MM;
  }
  if (size && length) return 'size_and_length_changed';
  if (size) return 'size_changed';
  if (length) return 'length_changed';
  return f.approved ? 'confirmed_unchanged' : 'kept_unchanged';
}

function setupChanged(a: SetupValues, b: SetupValues): (keyof SetupValues)[] {
  const out: (keyof SetupValues)[] = [];
  if ((a.role ?? 'skip') !== (b.role ?? 'skip')) out.push('role');
  const ca = a.crop;
  const cb = b.crop;
  if (
    (ca === null) !== (cb === null) ||
    (ca && cb && (['x0', 'y0', 'x1', 'y1'] as const).some((k) => Math.abs(ca[k] - cb[k]) > 0.5))
  )
    out.push('crop');
  if ((a.pen_class ?? null) !== (b.pen_class ?? null)) out.push('pen_class');
  const numDiff = (x: number | null, y: number | null, tol: number) =>
    (x === null) !== (y === null) || (x !== null && y !== null && Math.abs(x - y) > tol);
  if (numDiff(a.scale_ratio, b.scale_ratio, 1e-6)) out.push('scale_ratio');
  if (numDiff(a.tos_mm, b.tos_mm, 0.5)) out.push('tos_mm');
  if ((a.column_plan ?? null) !== (b.column_plan ?? null)) out.push('column_plan');
  return out;
}

/** Active minutes per sheet from the log (see the header). */
export function minutesPerSheet(
  rows: readonly { sheet_id: string | null; created_at: Date | string }[],
): Map<string, number> {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (!cur.sheet_id || cur.sheet_id !== prev.sheet_id) continue;
    const gap = (new Date(cur.created_at).getTime() - new Date(prev.created_at).getTime()) / 1000;
    out.set(cur.sheet_id, (out.get(cur.sheet_id) ?? 0) + Math.min(Math.max(gap, 0), IDLE_SECONDS));
  }
  for (const [k, v] of out) out.set(k, Math.round((v / 60) * 10) / 10);
  return out;
}

export function systemReport(
  pages: readonly PageInput[],
  finalPieces: readonly PieceView[],
  log: readonly { sheet_id: string | null; created_at: Date | string }[],
): SystemReport {
  const minutes = minutesPerSheet(log);
  const finalOf = new Map<string, PieceView[]>();
  for (const p of finalPieces)
    if (p.sheet_id) finalOf.set(p.sheet_id, [...(finalOf.get(p.sheet_id) ?? []), p]);
  const sizes = new Map<string, SizeRow>();
  const sizeRow = (k: string) => {
    const r = sizes.get(k) ?? {
      size: k,
      system_count: 0,
      system_length_mm: 0,
      final_count: 0,
      final_length_mm: 0,
    };
    sizes.set(k, r);
    return r;
  };
  const out: PageReport[] = [];
  for (const pg of pages) {
    const final = finalOf.get(pg.sheet_id) ?? [];
    const match = matchPieces(pg.system, final);
    const r: PageReport = {
      sheet_id: pg.sheet_id,
      page_index: pg.page_index,
      sheet_number: pg.sheet_number,
      reviewed_by: pg.reviewed_by,
      reviewed_at: pg.reviewed_at,
      system_pieces: pg.system.length,
      final_pieces: final.filter((f) => !f.deleted && !f.ignored).length,
      kept_unchanged: 0,
      confirmed_unchanged: 0,
      size_changed: 0,
      length_changed: 0,
      deleted_by_person: 0,
      ignored: 0,
      removed_by_rebuild: 0,
      added_by_person: 0,
      added_by_rebuild: 0,
      added_then_deleted: 0,
      setup_changed: setupChanged(pg.system_setup, pg.final_setup),
      setup: Object.fromEntries(
        (Object.keys(pg.system_setup) as (keyof SetupValues)[]).map((k) => [
          k,
          { system: pg.system_setup[k], final: pg.final_setup[k] },
        ]),
      ) as PageReport['setup'],
      minutes: minutes.get(pg.sheet_id) ?? 0,
    };
    pg.system.forEach((s, i) => {
      const j = match.get(i);
      const c = classify(s, j === undefined ? undefined : final[j]);
      if (c === 'size_and_length_changed') {
        r.size_changed += 1;
        r.length_changed += 1;
      } else r[c] += 1;
      const k = sizeKey(s.profile);
      if (k) {
        const row = sizeRow(k);
        row.system_count += 1;
        row.system_length_mm += s.length_mm ?? 0;
      }
    });
    const matchedF = new Set(match.values());
    final.forEach((f, j) => {
      if (!matchedF.has(j)) {
        if (f.deleted) r.added_then_deleted += 1;
        else if (!f.ignored) r[f.added ? 'added_by_person' : 'added_by_rebuild'] += 1;
      }
      if (f.deleted || f.ignored) return;
      const k = sizeKey(f.profile);
      if (k) {
        const row = sizeRow(k);
        row.final_count += f.quantity;
        row.final_length_mm += (f.length_mm ?? 0) * f.quantity;
      }
    });
    out.push(r);
  }
  const sum = (k: keyof PageReport) =>
    out.reduce((a, p) => a + (typeof p[k] === 'number' ? (p[k] as number) : 0), 0);
  const total = {
    system_pieces: sum('system_pieces'),
    final_pieces: sum('final_pieces'),
    kept_unchanged: sum('kept_unchanged'),
    confirmed_unchanged: sum('confirmed_unchanged'),
    size_changed: sum('size_changed'),
    length_changed: sum('length_changed'),
    deleted_by_person: sum('deleted_by_person'),
    ignored: sum('ignored'),
    removed_by_rebuild: sum('removed_by_rebuild'),
    added_by_person: sum('added_by_person'),
    added_by_rebuild: sum('added_by_rebuild'),
    added_then_deleted: sum('added_then_deleted'),
    minutes: Math.round(sum('minutes') * 10) / 10,
    pages_with_setup_changes: out.filter((p) => p.setup_changed.length > 0).length,
    pages_reviewed: out.filter((p) => p.reviewed_at !== null).length,
  };
  const sizeRows = [...sizes.values()]
    .map((s) => ({
      ...s,
      system_length_mm: Math.round(s.system_length_mm),
      final_length_mm: Math.round(s.final_length_mm),
    }))
    .sort((a, b) => a.size.localeCompare(b.size));
  return { pages: out, total, sizes: sizeRows };
}
