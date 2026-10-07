// Deterministic member validator (docs/SPEC.md section 6).
//
// Pure: it never changes its input and never "fixes" data. Every failure becomes an issue with a
// code, a severity (amber or red) and a reason. A member's status is its worst severity, or
// green when it has no issues. Results are sorted by member_id so the order of the input does
// not matter. Severity mapping and the column-support exemption are documented assumptions
// (docs/OPEN_QUESTIONS.md, items 4 and 5).
import type { Member, MemberType, StatusColor } from '../contract/index.js';
import { columnBaseElevationMm, memberLengthMm } from '../members/geometry.js';

export type Severity = 'amber' | 'red';

export const ISSUE_CODES = [
  'MISSING_PROFILE',
  'PROFILE_NOT_IN_CATALOG',
  'NON_POSITIVE_WEIGHT',
  'MISSING_MATERIAL',
  'MISSING_GRADE',
  'MISSING_START_ELEVATION',
  'MISSING_END_ELEVATION',
  'COLUMN_BASE_ELEVATION_MISSING',
  'LENGTH_UNAVAILABLE',
  'NON_POSITIVE_LENGTH',
  'UNSUPPORTED_MEMBER',
  'SUPPORT_REF_NOT_FOUND',
  'DUPLICATE_MEMBER',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  code: IssueCode;
  severity: Severity;
  field: string | null;
  message: string;
}

export interface MemberValidation {
  member_id: string;
  status: StatusColor;
  issues: Issue[];
}

export interface ValidationReport {
  results: MemberValidation[];
  counts: Record<StatusColor, number>;
  issue_counts: Record<IssueCode, number>;
}

export interface CatalogEntry {
  shape_name: string;
  weight_kg_per_m: number;
}
export type CatalogIndex = ReadonlyMap<string, CatalogEntry>;

export interface ValidatorOptions {
  /** Member types that bear on foundations rather than on other members. Default: ['column']. */
  supportExemptTypes?: readonly MemberType[];
}

const SEVERITY: Record<IssueCode, Severity> = {
  MISSING_PROFILE: 'red',
  PROFILE_NOT_IN_CATALOG: 'red',
  NON_POSITIVE_WEIGHT: 'red',
  MISSING_START_ELEVATION: 'red',
  MISSING_END_ELEVATION: 'red',
  COLUMN_BASE_ELEVATION_MISSING: 'red',
  LENGTH_UNAVAILABLE: 'red',
  NON_POSITIVE_LENGTH: 'red',
  MISSING_MATERIAL: 'amber',
  MISSING_GRADE: 'amber',
  UNSUPPORTED_MEMBER: 'amber',
  SUPPORT_REF_NOT_FOUND: 'amber',
  DUPLICATE_MEMBER: 'amber',
};

/** Code-unit string order: independent of locale and platform. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

function issue(code: IssueCode, field: string | null, message: string): Issue {
  return { code, severity: SEVERITY[code], field, message };
}

/** Key identifying "same type, profile and end points" (either direction); null if not comparable. */
function duplicateKey(member: Member): string | null {
  const a = member.start.resolved_xyz_mm;
  const b = member.end.resolved_xyz_mm;
  if (!a || !b || isBlank(member.profile)) return null;
  const [first, second] = [JSON.stringify(a), JSON.stringify(b)].sort(compareIds);
  return JSON.stringify([member.type, member.profile, first, second]);
}

export function validateMembers(
  members: readonly Member[],
  catalog: CatalogIndex,
  options: ValidatorOptions = {},
): ValidationReport {
  const exempt = new Set<MemberType>(options.supportExemptTypes ?? ['column']);
  const sorted = [...members].sort((x, y) => compareIds(x.member_id, y.member_id));

  const ids = new Set<string>();
  for (const m of sorted) {
    if (ids.has(m.member_id)) throw new Error(`duplicate member_id in input: ${m.member_id}`);
    ids.add(m.member_id);
  }

  const groups = new Map<string, string[]>();
  for (const m of sorted) {
    const key = duplicateKey(m);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), m.member_id]);
  }

  const results: MemberValidation[] = sorted.map((m) => {
    const issues: Issue[] = [];

    if (isBlank(m.profile)) {
      const raw = isBlank(m.profile_raw) ? 'no raw text' : `raw text "${m.profile_raw}"`;
      issues.push(issue('MISSING_PROFILE', 'profile', `profile is unresolved (${raw})`));
    } else {
      const entry = catalog.get(m.profile as string);
      if (!entry) {
        issues.push(
          issue(
            'PROFILE_NOT_IN_CATALOG',
            'profile',
            `profile "${m.profile}" is not in the catalog`,
          ),
        );
      } else if (!(entry.weight_kg_per_m > 0)) {
        issues.push(
          issue(
            'NON_POSITIVE_WEIGHT',
            'profile',
            `catalog weight for "${m.profile}" is not positive (${entry.weight_kg_per_m} kg/m)`,
          ),
        );
      }
    }

    if (isBlank(m.material)) {
      issues.push(issue('MISSING_MATERIAL', 'material', 'material is missing (never defaulted)'));
    }
    if (isBlank(m.grade)) {
      issues.push(issue('MISSING_GRADE', 'grade', 'grade is missing (never defaulted)'));
    }

    // Elevation 0 is a valid value; only null/undefined means missing.
    if (m.start.elevation_mm == null) {
      issues.push(
        issue('MISSING_START_ELEVATION', 'start.elevation_mm', 'start elevation is missing'),
      );
    }
    if (m.end.elevation_mm == null) {
      issues.push(issue('MISSING_END_ELEVATION', 'end.elevation_mm', 'end elevation is missing'));
    }

    // Columns are exempt from the unsupported check, but their base elevation must be known.
    if (m.type === 'column' && columnBaseElevationMm(m) === null) {
      issues.push(
        issue(
          'COLUMN_BASE_ELEVATION_MISSING',
          null,
          'column base elevation cannot be determined (the lower end has no elevation)',
        ),
      );
    }

    const length = memberLengthMm(m);
    if (length === null) {
      issues.push(
        issue('LENGTH_UNAVAILABLE', null, 'length cannot be computed: an end point is unresolved'),
      );
    } else if (!(length > 0)) {
      issues.push(issue('NON_POSITIVE_LENGTH', null, `length is not positive (${length} mm)`));
    }

    const validRefs = m.supported_by.filter((id) => ids.has(id) && id !== m.member_id);
    const badRefs = m.supported_by.filter((id) => !ids.has(id) || id === m.member_id);
    if (badRefs.length > 0) {
      issues.push(
        issue(
          'SUPPORT_REF_NOT_FOUND',
          'supported_by',
          `supported_by references unknown or self member ids: ${badRefs.join(', ')}`,
        ),
      );
    }
    if (validRefs.length === 0 && !exempt.has(m.type)) {
      issues.push(issue('UNSUPPORTED_MEMBER', 'supported_by', 'no valid supporting member'));
    }

    const key = duplicateKey(m);
    const group = key === null ? [] : (groups.get(key) ?? []);
    if (group.length > 1) {
      const others = group.filter((id) => id !== m.member_id);
      issues.push(
        issue(
          'DUPLICATE_MEMBER',
          null,
          `same type, profile and end points as: ${others.join(', ')}`,
        ),
      );
    }

    const status: StatusColor = issues.some((i) => i.severity === 'red')
      ? 'red'
      : issues.length > 0
        ? 'amber'
        : 'green';
    return { member_id: m.member_id, status, issues };
  });

  const counts: Record<StatusColor, number> = { green: 0, amber: 0, red: 0 };
  const issueCounts = Object.fromEntries(ISSUE_CODES.map((c) => [c, 0])) as Record<
    IssueCode,
    number
  >;
  for (const r of results) {
    counts[r.status] += 1;
    for (const i of r.issues) issueCounts[i.code] += 1;
  }
  return { results, counts, issue_counts: issueCounts };
}
