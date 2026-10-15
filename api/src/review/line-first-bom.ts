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
//
// Totals follow the existing rule: rows in "attention" (no size, or no support) stay out of the
// main total and are summed on their own line; "found" and "needs review" rows are in it.
import type { CatalogLookup } from '../catalog/lookup.js';
import type { GradeRule } from './grades.js';
import { familyOf } from './grades.js';
import type { ShapeFamily } from '../db/types.js';

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
  member: string;
  sheet_id: string | null;
  build_state: BuiltPiece['build_state'];
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
  in_main_total: boolean;
}

export interface LineFirstBomTotal {
  rows: number;
  pieces: number;
  pieces_without_length: number;
  pieces_without_weight: number;
  length_mm: number;
  weight_kg: number;
}

export interface LineFirstBom {
  rows: LineFirstBomRow[];
  totals: LineFirstBomTotal;
  attention: LineFirstBomTotal;
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
  };
}

function add(t: LineFirstBomTotal, r: LineFirstBomRow): void {
  t.rows += 1;
  t.pieces += r.qty;
  if (r.length_mm === null) t.pieces_without_length += r.qty;
  else t.length_mm += r.length_mm * r.qty;
  if (r.weight_kg === null) t.pieces_without_weight += r.qty;
  else t.weight_kg += r.weight_kg;
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
      member: p.member_id,
      sheet_id: p.sheet_id,
      build_state: p.build_state,
      size_state: p.size_state,
      support_state: p.support_state,
      piece_index: p.piece_index,
      in_main_total: p.build_state !== 'attention',
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
  const byCat = new Map<string | null, LineFirstBomTotal>();
  for (const r of rows) {
    if (r.in_main_total) {
      add(totals, r);
      const t = byCat.get(r.category) ?? emptyTotal();
      add(t, r);
      byCat.set(r.category, t);
    } else add(attention, r);
  }
  const by_category = [...byCat.entries()]
    .map(([category, t]) => ({ category, ...t }))
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''));
  return { rows, totals, attention, by_category };
}
