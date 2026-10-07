// Deterministic BOM generator. Length and weight are computed here from the resolved end points
// and the catalog weight per metre; they are never stored. No pricing in this phase.
//
// Totals policy:
//  * GREEN and AMBER members that can be weighed are counted in the main totals.
//  * RED members are never counted in the main totals. They stay on their BOM lines (with a
//    length and weight when those can still be computed) and are reported separately on the
//    `excluded_red` line, so nothing is hidden.
import type { Member, MemberType, StatusColor } from '../contract/index.js';
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
  /** True for green/amber members that could be weighed. Red members are always false. */
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
  pieces_included: number;
  total_length_mm: number;
  total_weight_kg: number;
}

/** Red members, reported apart from the totals. Length and weight cover `members_weighed` only. */
export interface BomExcludedRed {
  members: number;
  pieces: number;
  members_weighed: number;
  total_length_mm: number;
  total_weight_kg: number;
}

export interface Bom {
  lines: BomLine[];
  totals: BomTotals;
  excluded_red: BomExcludedRed;
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
      included_in_totals: unitWeight !== null && result.status !== 'red',
    };
  });

  const included = lines.filter((l) => l.included_in_totals);
  const red = lines.filter((l) => l.status === 'red');
  const redWeighed = red.filter((l) => l.total_weight_kg !== null);

  return {
    lines,
    totals: {
      members: lines.length,
      members_included: included.length,
      pieces_included: included.reduce((s, l) => s + l.quantity, 0),
      total_length_mm: included.reduce((s, l) => s + (l.total_length_mm ?? 0), 0),
      total_weight_kg: included.reduce((s, l) => s + (l.total_weight_kg ?? 0), 0),
    },
    excluded_red: {
      members: red.length,
      pieces: red.reduce((s, l) => s + l.quantity, 0),
      members_weighed: redWeighed.length,
      total_length_mm: redWeighed.reduce((s, l) => s + (l.total_length_mm ?? 0), 0),
      total_weight_kg: redWeighed.reduce((s, l) => s + (l.total_weight_kg ?? 0), 0),
    },
    by_profile: group(included, (l) => l.profile ?? ''),
    by_type: group(included, (l) => l.type),
  };
}
