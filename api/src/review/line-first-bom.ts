// BOM of the line-first build (Phase 11), in Steel Genie's columns: Main, Category, Piecemark, Qty,
// Section Type, Section, Length, Grade, Weight. One row per built piece. Deterministic.
//
//   Main         1 for every row in v1 (every built member is a main member; owner decision).
//   Category     the member kind (member_kinds), e.g. Beams, Column.
//   Piecemark    the piece's tag (prefix + running number).
//   Qty          the piece's quantity (x N when a person marked it typical).
//   Section Type the catalog's type column of the section (W, HSS, ...); null when not in the
//                catalog.
//   Section      the size: the effective profile (a person's edit wins over the label).
//   Length       support-to-support length in mm (3D distance of the resolved end points; the
//                ends sit at the page T.O.S.); null for a column (no elevations) or no geometry.
//   Grade        the grade a person set for the shape family; null ("not set") otherwise.
//   Weight       Qty x Length (m) x catalog kg/m; null when length or catalog weight is missing.
//                Also in lb (weight_lb, kg / 0.45359237) with the catalog lb/ft (unit_w_lb_ft): the
//                review UI and the Excel export show lb and ft-in (Phase 11b owner decision).
//
// Totals follow the existing rule: rows in "attention" (no size, or no support) stay out of the
// main total and are summed on their own line; "found" and "needs review" rows are in it.
import type { CatalogLookup } from '../catalog/lookup.js';
import type { GradeRule } from './grades.js';
import { familyOf } from './grades.js';
import type { ShapeFamily } from '../db/types.js';

export const KG_PER_LB = 0.45359237;

export interface BuiltPiece {
  id: string;
  member_id: string;
  sheet_id: string | null;
  type: string;
  kind: string | null;
  tag: string | null;
  quantity: number;
  profile: string | null;
  profile_raw: string | null;
  start: [number, number, number] | null;
  end: [number, number, number] | null;
  build_state: 'found' | 'needs_review' | 'attention' | null;
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
  /** A person confirmed it (Approve); optional for callers that do not know. */
  approved?: boolean;
  /** Phase 12b: a duplicate column (counted once, on the page built first). */
  duplicate_of?: string | null;
  /** Phase 12b: a kind outside the steel totals (Joist). */
  excluded_kind?: boolean;
}

export interface LineFirstBomRow {
  main: 1;
  category: string | null;
  piecemark: string | null;
  qty: number;
  section_type: string | null;
  section: string | null;
  length_mm: number | null;
  grade: string | null;
  weight_kg: number | null;
  weight_lb: number | null;
  unit_w_lb_ft: number | null;
  member: string;
  /** The piece's row id (the review UI selects pieces by it). */
  piece_id: string;
  sheet_id: string | null;
  approved: boolean;
  build_state: BuiltPiece['build_state'];
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
  in_main_total: boolean;
  /** Phase 12b: a duplicate column or a kind outside the steel totals: in neither total. */
  duplicate_of: string | null;
  excluded: boolean;
}

export interface LineFirstBomTotal {
  rows: number;
  pieces: number;
  pieces_without_length: number;
  pieces_without_weight: number;
  length_mm: number;
  weight_kg: number;
  weight_lb: number;
}

export interface LineFirstBom {
  rows: LineFirstBomRow[];
  totals: LineFirstBomTotal;
  attention: LineFirstBomTotal;
  /** Phase 12b: duplicate columns and kinds outside the steel totals (Joist), shown apart. */
  excluded: LineFirstBomTotal;
  by_category: (LineFirstBomTotal & { category: string | null })[];
}

function lengthMm(p: BuiltPiece): number | null {
  if (!p.start || !p.end) return null;
  const d = Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1], p.end[2] - p.start[2]);
  return d > 0 ? d : null;
}

function emptyTotal(): LineFirstBomTotal {
  return {
    rows: 0,
    pieces: 0,
    pieces_without_length: 0,
    pieces_without_weight: 0,
    length_mm: 0,
    weight_kg: 0,
    weight_lb: 0,
  };
}

function add(t: LineFirstBomTotal, r: LineFirstBomRow): void {
  t.rows += 1;
  t.pieces += r.qty;
  if (r.length_mm === null) t.pieces_without_length += r.qty;
  else t.length_mm += r.length_mm * r.qty;
  if (r.weight_kg === null) t.pieces_without_weight += r.qty;
  else {
    t.weight_kg += r.weight_kg;
    t.weight_lb += r.weight_lb ?? 0;
  }
}

export function lineFirstBom(
  pieces: readonly BuiltPiece[],
  catalog: CatalogLookup | null,
  grades: Map<ShapeFamily, GradeRule>,
): LineFirstBom {
  const rows = pieces.map((p): LineFirstBomRow => {
    const length = lengthMm(p);
    const hit = catalog?.find(p.profile ?? p.profile_raw) ?? null;
    const shape = hit && hit.found ? hit.shape : null;
    const family = familyOf({ type: p.type, profile: p.profile });
    const weight =
      length !== null && shape !== null
        ? p.quantity * (length / 1000) * shape.weight_kg_per_m
        : null;
    return {
      main: 1,
      category: p.kind,
      piecemark: p.tag,
      qty: p.quantity,
      section_type: shape?.family ?? null,
      section: shape?.shape_name ?? p.profile ?? p.profile_raw,
      length_mm: length === null ? null : Math.round(length * 10) / 10,
      grade: family ? (grades.get(family)?.grade ?? null) : null,
      weight_kg: weight === null ? null : Math.round(weight * 100) / 100,
      weight_lb: weight === null ? null : Math.round((weight / KG_PER_LB) * 100) / 100,
      unit_w_lb_ft:
        shape === null
          ? null
          : (shape.weight_lb_per_ft ??
            Math.round(((shape.weight_kg_per_m * 0.3048) / KG_PER_LB) * 1000) / 1000),
      member: p.member_id,
      piece_id: p.id,
      sheet_id: p.sheet_id,
      approved: p.approved === true,
      build_state: p.build_state,
      size_state: p.size_state,
      support_state: p.support_state,
      piece_index: p.piece_index,
      in_main_total: p.build_state !== 'attention' && !p.duplicate_of && !p.excluded_kind,
      duplicate_of: p.duplicate_of ?? null,
      excluded: Boolean(p.duplicate_of) || p.excluded_kind === true,
    };
  });
  rows.sort(
    (a, b) =>
      (a.category ?? '').localeCompare(b.category ?? '') ||
      (a.section ?? '').localeCompare(b.section ?? '') ||
      (a.piecemark ?? '').localeCompare(b.piecemark ?? '', undefined, { numeric: true }) ||
      a.member.localeCompare(b.member),
  );
  const totals = emptyTotal();
  const attention = emptyTotal();
  const excluded = emptyTotal();
  const byCat = new Map<string | null, LineFirstBomTotal>();
  for (const r of rows) {
    if (r.excluded) add(excluded, r);
    else if (r.in_main_total) {
      add(totals, r);
      const t = byCat.get(r.category) ?? emptyTotal();
      add(t, r);
      byCat.set(r.category, t);
    } else add(attention, r);
  }
  const by_category = [...byCat.entries()]
    .map(([category, t]) => ({ category, ...t }))
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''));
  return { rows, totals, attention, excluded, by_category };
}
