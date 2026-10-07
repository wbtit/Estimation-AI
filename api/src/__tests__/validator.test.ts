import { describe, expect, it } from 'vitest';
import type { Member } from '../contract/index.js';
import { makeMember, type MemberOverrides } from '../synthetic/member-factory.js';
import { ISSUE_CODES, validateMembers, type IssueCode } from '../validator/index.js';
import { catalogOf } from './helpers.js';

const catalog = catalogOf({ 'TEST-001': 10, 'TEST-002': 25, 'TEST-ZERO': 0, 'TEST-NEGATIVE': -3 });

const column = makeMember({
  member_id: 'c1',
  type: 'column',
  start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
  end: { elevation_mm: 4000, resolved_xyz_mm: [0, 0, 4000] },
});

/** A beam that is valid except for what the test overrides; supported by column c1. */
function beam(overrides: Partial<MemberOverrides> = {}): Member {
  return makeMember({ member_id: 'b1', supported_by: ['c1'], ...overrides });
}

function codesFor(members: Member[], id: string, options = {}): IssueCode[] {
  const result = validateMembers(members, catalog, options).results.find((r) => r.member_id === id);
  return (result?.issues ?? []).map((i) => i.code);
}

describe('validator: a valid member', () => {
  it('is green with no issues', () => {
    const report = validateMembers([column, beam()], catalog);
    expect(report.results.map((r) => [r.member_id, r.status, r.issues])).toEqual([
      ['b1', 'green', []],
      ['c1', 'green', []],
    ]);
    expect(report.counts).toEqual({ green: 2, amber: 0, red: 0 });
  });
});

describe('validator: material and grade are never defaulted', () => {
  it('flags missing material (amber)', () => {
    const r = validateMembers([column, beam({ material: null })], catalog).results[0];
    expect(r?.issues.map((i) => [i.code, i.severity, i.field])).toEqual([
      ['MISSING_MATERIAL', 'amber', 'material'],
    ]);
    expect(r?.status).toBe('amber');
  });

  it('flags missing grade (amber)', () => {
    expect(codesFor([column, beam({ grade: null })], 'b1')).toEqual(['MISSING_GRADE']);
  });

  it('treats a blank string as missing, and does not fix it', () => {
    const blank = beam({ material: '   ', grade: '' });
    expect(codesFor([column, blank], 'b1')).toEqual(['MISSING_MATERIAL', 'MISSING_GRADE']);
    expect(blank.material).toBe('   ');
  });
});

describe('validator: profile', () => {
  it('flags a missing profile (red) and quotes the raw drawing text', () => {
    const report = validateMembers(
      [column, beam({ profile: null, profile_raw: 'TEST-??' })],
      catalog,
    );
    const issue = report.results[0]?.issues[0];
    expect(issue).toMatchObject({ code: 'MISSING_PROFILE', severity: 'red', field: 'profile' });
    expect(issue?.message).toContain('TEST-??');
    expect(report.results[0]?.status).toBe('red');
  });

  it('flags a profile that is not in the catalog (red)', () => {
    expect(codesFor([column, beam({ profile: 'TEST-404' })], 'b1')).toEqual([
      'PROFILE_NOT_IN_CATALOG',
    ]);
  });

  it('matches catalog names exactly: no case folding or trimming', () => {
    expect(codesFor([column, beam({ profile: 'test-001' })], 'b1')).toEqual([
      'PROFILE_NOT_IN_CATALOG',
    ]);
  });

  it.each(['TEST-ZERO', 'TEST-NEGATIVE'])('flags a non-positive catalog weight (%s)', (profile) => {
    expect(codesFor([column, beam({ profile })], 'b1')).toEqual(['NON_POSITIVE_WEIGHT']);
  });

  it('flags a NaN catalog weight as non-positive', () => {
    const nan = new Map([['TEST-NAN', { shape_name: 'TEST-NAN', weight_kg_per_m: Number.NaN }]]);
    const report = validateMembers([column, beam({ profile: 'TEST-NAN' })], nan);
    expect(report.results[0]?.issues.map((i) => i.code)).toEqual(['NON_POSITIVE_WEIGHT']);
  });
});

describe('validator: end elevations (members can slope)', () => {
  it('flags a missing start elevation (red)', () => {
    expect(codesFor([column, beam({ start: { elevation_mm: null } })], 'b1')).toEqual([
      'MISSING_START_ELEVATION',
    ]);
  });

  it('flags a missing end elevation (red)', () => {
    expect(codesFor([column, beam({ end: { elevation_mm: null } })], 'b1')).toEqual([
      'MISSING_END_ELEVATION',
    ]);
  });

  it('flags both when both are missing', () => {
    const m = beam({ start: { elevation_mm: null }, end: { elevation_mm: null } });
    expect(codesFor([column, m], 'b1')).toEqual([
      'MISSING_START_ELEVATION',
      'MISSING_END_ELEVATION',
    ]);
  });

  it('treats elevation 0 as a real value, not as missing', () => {
    const m = beam({
      start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
      end: { elevation_mm: 0, resolved_xyz_mm: [6000, 0, 0] },
    });
    expect(codesFor([column, m], 'b1')).toEqual([]);
  });

  it('accepts a sloped member whose end elevations differ', () => {
    const sloped = beam({
      start: { elevation_mm: 4000, resolved_xyz_mm: [0, 0, 4000] },
      end: { elevation_mm: 4500, resolved_xyz_mm: [6000, 0, 4500] },
    });
    expect(codesFor([column, sloped], 'b1')).toEqual([]);
  });
});

describe('validator: length', () => {
  it('flags an unavailable length when an end point is unresolved (red)', () => {
    expect(codesFor([column, beam({ end: { resolved_xyz_mm: null } })], 'b1')).toEqual([
      'LENGTH_UNAVAILABLE',
    ]);
  });

  it('flags a zero length (red)', () => {
    const m = beam({ end: { resolved_xyz_mm: [0, 0, 4000] } });
    expect(codesFor([column, m], 'b1')).toEqual(['NON_POSITIVE_LENGTH']);
  });
});

describe('validator: unsupported member', () => {
  it('flags a beam with no supported_by (amber)', () => {
    const report = validateMembers([column, beam({ supported_by: [] })], catalog);
    expect(report.results[0]?.issues.map((i) => [i.code, i.severity])).toEqual([
      ['UNSUPPORTED_MEMBER', 'amber'],
    ]);
  });

  it('exempts columns by default, and flags them when the exemption is removed', () => {
    expect(codesFor([column], 'c1')).toEqual([]);
    expect(codesFor([column], 'c1', { supportExemptTypes: [] })).toEqual(['UNSUPPORTED_MEMBER']);
  });

  it('flags a reference to an unknown member, and the member is unsupported when no valid ref remains', () => {
    expect(codesFor([column, beam({ supported_by: ['ghost'] })], 'b1')).toEqual([
      'SUPPORT_REF_NOT_FOUND',
      'UNSUPPORTED_MEMBER',
    ]);
  });

  it('keeps a member supported when at least one reference is valid, but still reports the bad one', () => {
    expect(codesFor([column, beam({ supported_by: ['c1', 'ghost'] })], 'b1')).toEqual([
      'SUPPORT_REF_NOT_FOUND',
    ]);
  });

  it('does not accept a member supporting itself', () => {
    expect(codesFor([column, beam({ supported_by: ['b1'] })], 'b1')).toEqual([
      'SUPPORT_REF_NOT_FOUND',
      'UNSUPPORTED_MEMBER',
    ]);
  });

  it('still checks references on exempt columns', () => {
    const c = makeMember({ ...column, supported_by: ['ghost'] });
    expect(codesFor([c], 'c1')).toEqual(['SUPPORT_REF_NOT_FOUND']);
  });
});

describe('validator: duplicates', () => {
  const second = (overrides: Partial<MemberOverrides> = {}) =>
    beam({ member_id: 'b2', ...overrides });

  it('flags every member of a duplicate group (amber) and names the others', () => {
    const report = validateMembers([column, beam(), second()], catalog);
    const b1 = report.results.find((r) => r.member_id === 'b1');
    expect(b1?.issues).toEqual([
      {
        code: 'DUPLICATE_MEMBER',
        severity: 'amber',
        field: null,
        message: 'same type, profile and end points as: b2',
      },
    ]);
    expect(codesFor([column, beam(), second()], 'b2')).toEqual(['DUPLICATE_MEMBER']);
  });

  it('treats a member with its ends swapped as the same member', () => {
    const swapped = second({
      start: { resolved_xyz_mm: [6000, 0, 4000] },
      end: { resolved_xyz_mm: [0, 0, 4000] },
    });
    expect(codesFor([column, beam(), swapped], 'b2')).toEqual(['DUPLICATE_MEMBER']);
  });

  it('does not flag members that differ in profile, type or end points', () => {
    expect(codesFor([column, beam(), second({ profile: 'TEST-002' })], 'b1')).toEqual([]);
    expect(codesFor([column, beam(), second({ type: 'brace' })], 'b1')).toEqual([]);
    expect(
      codesFor([column, beam(), second({ end: { resolved_xyz_mm: [6000, 1, 4000] } })], 'b1'),
    ).toEqual([]);
  });

  it('does not compare members that have no profile or no resolved end points', () => {
    const a = beam({ profile: null });
    const b = second({ profile: null });
    expect(codesFor([column, a, b], 'b1')).toEqual(['MISSING_PROFILE']);
    const c = beam({ start: { resolved_xyz_mm: null } });
    const d = second({ start: { resolved_xyz_mm: null } });
    expect(codesFor([column, c, d], 'b1')).toEqual(['LENGTH_UNAVAILABLE']);
  });
});

describe('validator: non-Latin grid labels are allowed', () => {
  it('passes Cyrillic labels, including look-alikes of Latin letters, without changing them', () => {
    const cyrillic = beam({
      start: { grid_x: '\u0410', grid_y: '1' }, // Cyrillic \u0410
      end: { grid_x: '\u0412', grid_y: '\u0431' }, // Cyrillic \u0412 and \u0431
    });
    const before = structuredClone(cyrillic);
    expect(codesFor([column, cyrillic], 'b1')).toEqual([]);
    expect(cyrillic).toEqual(before);
    expect(cyrillic.start.grid_x).not.toBe('A');
  });
});

describe('validator: report behaviour', () => {
  it('status is the worst severity and issues are counted', () => {
    const worst = beam({ material: null, profile: null });
    const report = validateMembers([column, worst], catalog);
    expect(report.results[0]?.status).toBe('red');
    expect(report.results[0]?.issues.map((i) => i.severity)).toEqual(['red', 'amber']);
    expect(report.issue_counts.MISSING_PROFILE).toBe(1);
    expect(report.issue_counts.MISSING_MATERIAL).toBe(1);
    expect(Object.keys(report.issue_counts)).toEqual([...ISSUE_CODES]);
    expect(report.counts).toEqual({ green: 1, amber: 0, red: 1 });
  });

  it('never mutates its input', () => {
    const members = [column, beam({ material: null, supported_by: ['ghost'] })];
    const before = structuredClone(members);
    validateMembers(members, catalog);
    expect(members).toEqual(before);
  });

  it('gives the same report whatever the input order', () => {
    const members = [
      column,
      beam(),
      beam({ member_id: 'b2' }),
      beam({ member_id: 'b3', grade: null }),
    ];
    const forward = validateMembers(members, catalog);
    const reversed = validateMembers([...members].reverse(), catalog);
    expect(reversed).toEqual(forward);
    expect(forward.results.map((r) => r.member_id)).toEqual(['b1', 'b2', 'b3', 'c1']);
  });

  it('rejects input with a repeated member_id', () => {
    expect(() => validateMembers([beam(), beam()], catalog)).toThrow(/duplicate member_id/);
  });
});

describe('validator: a column must have a base elevation', () => {
  /** Column from z=0 to z=4000, valid unless overridden. Columns are exempt from "unsupported". */
  function col(overrides: Partial<MemberOverrides> = {}): Member {
    return makeMember({
      member_id: 'c9',
      type: 'column',
      start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
      end: { elevation_mm: 4000, resolved_xyz_mm: [0, 0, 4000] },
      ...overrides,
    });
  }

  it('accepts a complete column and still exempts it from the unsupported check', () => {
    expect(codesFor([col()], 'c9')).toEqual([]);
  });

  it('flags a column whose base (lower end) has no elevation, as red', () => {
    const report = validateMembers(
      [col({ start: { elevation_mm: null, resolved_xyz_mm: [0, 0, 0] } })],
      catalog,
    );
    const issues = report.results[0]?.issues ?? [];
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ['MISSING_START_ELEVATION', 'red'],
      ['COLUMN_BASE_ELEVATION_MISSING', 'red'],
    ]);
    expect(report.results[0]?.status).toBe('red');
  });

  it('does not flag the base when only the top elevation is missing', () => {
    expect(
      codesFor([col({ end: { elevation_mm: null, resolved_xyz_mm: [0, 0, 4000] } })], 'c9'),
    ).toEqual(['MISSING_END_ELEVATION']);
  });

  it('finds the base by position, not by which end is called start (column drawn top-down)', () => {
    const topDown = (startElev: number | null, endElev: number | null) =>
      col({
        start: { elevation_mm: startElev, resolved_xyz_mm: [0, 0, 4000] },
        end: { elevation_mm: endElev, resolved_xyz_mm: [0, 0, 0] },
      });
    expect(codesFor([topDown(4000, null)], 'c9')).toEqual([
      'MISSING_END_ELEVATION',
      'COLUMN_BASE_ELEVATION_MISSING',
    ]);
    expect(codesFor([topDown(null, 0)], 'c9')).toEqual(['MISSING_START_ELEVATION']);
  });

  it('with unresolved end points, uses the lower elevation when both exist', () => {
    const unresolved = col({ start: { resolved_xyz_mm: null }, end: { resolved_xyz_mm: null } });
    expect(codesFor([unresolved], 'c9')).toEqual(['LENGTH_UNAVAILABLE']);
  });

  it('with unresolved end points and a missing elevation, the base is unknown', () => {
    const c = col({
      start: { resolved_xyz_mm: null },
      end: { elevation_mm: null, resolved_xyz_mm: null },
    });
    expect(codesFor([c], 'c9')).toEqual([
      'MISSING_END_ELEVATION',
      'COLUMN_BASE_ELEVATION_MISSING',
      'LENGTH_UNAVAILABLE',
    ]);
  });

  it('applies to columns only', () => {
    const b = beam({ start: { elevation_mm: null } });
    expect(codesFor([column, b], 'b1')).toEqual(['MISSING_START_ELEVATION']);
  });

  it('still checks that a column is not left unsupported when the exemption is removed', () => {
    expect(codesFor([col()], 'c9', { supportExemptTypes: [] })).toEqual(['UNSUPPORTED_MEMBER']);
  });
});
