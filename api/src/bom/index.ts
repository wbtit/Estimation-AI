// Deterministic BOM generator. Length and weight are computed here from the resolved end points
// and the catalog weight per metre; they are never stored. No pricing in this phase.
//
// A member is "included" in the totals when both its length and its catalog weight could be
// computed and are positive. Members that cannot be weighed stay in the BOM, flagged, and are
// counted as excluded so nothing is hidden. Included members can still be amber or red for other
// reasons (for example a missing grade); their status is carried on the line.
import type { MemberType, StatusColor, Member } from '../contract/index.js';
import { memberLengthMm } from '../members/geometry.js';
import {
  compareIds,
  type CatalogIndex,
  type IssueCode,
  type ValidationReport,
} from '../validator/index.js';

export interface BomLine {
  member_id: string;
  mark: string | null;
  type: MemberType;
  profile: string | null;
  material: string | null;
  grade: string | null;
  quantity: number;
  unit_length_mm: number | null;
  weight_kg_per_m: number | null;
  unit_weight_kg: number | null;
  total_length_mm: number | null;
  total_weight_kg: number | null;
  status: StatusColor;
  issue_codes: IssueCode[];
  included_in_totals: boolean;
}

export interface BomGroup {
  key: string;
  member_count: number;
  piece_count: number;
  total_length_mm: number;
  total_weight_kg: number;
}

export interface BomTotals {
  members: number;
  members_included: number;
  members_excluded: number;
  pieces_included: number;
  total_length_mm: number;
  total_weight_kg: number;
}

export interface Bom {
  lines: BomLine[];
  totals: BomTotals;
  by_profile: BomGroup[];
  by_type: BomGroup[];
}

function group(lines: BomLine[], keyOf: (line: BomLine) => string): BomGroup[] {
  const map = new Map<string, BomGroup>();
  for (const l of lines) {
    const key = keyOf(l);
    const g = map.get(key) ?? {
      key,
      member_count: 0,
      piece_count: 0,
      total_length_mm: 0,
      total_weight_kg: 0,
    };
    g.member_count += 1;
    g.piece_count += l.quantity;
    g.total_length_mm += l.total_length_mm ?? 0;
    g.total_weight_kg += l.total_weight_kg ?? 0;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => compareIds(a.key, b.key));
}

export function generateBom(
  members: readonly Member[],
  catalog: CatalogIndex,
  validation: ValidationReport,
): Bom {
  const byId = new Map(validation.results.map((r) => [r.member_id, r]));
  const sorted = [...members].sort((a, b) => compareIds(a.member_id, b.member_id));

  const lines: BomLine[] = sorted.map((m) => {
    const result = byId.get(m.member_id);
    if (!result) throw new Error(`no validation result for member ${m.member_id}`);

    const length = memberLengthMm(m);
    const weightPerM = m.profile ? (catalog.get(m.profile)?.weight_kg_per_m ?? null) : null;
    const unitWeight =
      length !== null && length > 0 && weightPerM !== null && weightPerM > 0
        ? (length / 1000) * weightPerM
        : null;
    const included = unitWeight !== null;

    return {
      member_id: m.member_id,
      mark: m.mark,
      type: m.type,
      profile: m.profile,
      material: m.material,
      grade: m.grade,
      quantity: m.quantity,
      unit_length_mm: length,
      weight_kg_per_m: weightPerM,
      unit_weight_kg: unitWeight,
      total_length_mm: length === null ? null : length * m.quantity,
      total_weight_kg: unitWeight === null ? null : unitWeight * m.quantity,
      status: result.status,
      issue_codes: result.issues.map((i) => i.code),
      included_in_totals: included,
    };
  });

  const includedLines = lines.filter((l) => l.included_in_totals);
  const totals: BomTotals = {
    members: lines.length,
    members_included: includedLines.length,
    members_excluded: lines.length - includedLines.length,
    pieces_included: includedLines.reduce((s, l) => s + l.quantity, 0),
    total_length_mm: includedLines.reduce((s, l) => s + (l.total_length_mm ?? 0), 0),
    total_weight_kg: includedLines.reduce((s, l) => s + (l.total_weight_kg ?? 0), 0),
  };

  return {
    lines,
    totals,
    by_profile: group(includedLines, (l) => l.profile ?? ''),
    by_type: group(includedLines, (l) => l.type),
  };
}
