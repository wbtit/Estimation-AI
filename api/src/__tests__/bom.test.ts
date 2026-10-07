import { describe, expect, it } from 'vitest';
import { generateBom } from '../bom/index.js';
import type { Member } from '../contract/index.js';
import { memberLengthMm } from '../members/geometry.js';
import { makeMember, type MemberOverrides } from '../synthetic/member-factory.js';
import { validateMembers } from '../validator/index.js';
import { catalogOf } from './helpers.js';

const catalog = catalogOf({ 'TEST-001': 10, 'TEST-002': 25 });

const column = makeMember({
  member_id: 'c1',
  type: 'column',
  profile: 'TEST-002',
  start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
  end: { elevation_mm: 4000, resolved_xyz_mm: [0, 0, 4000] },
});

function beam(id: string, overrides: Partial<MemberOverrides> = {}): Member {
  return makeMember({ member_id: id, supported_by: ['c1'], ...overrides });
}

function bomOf(members: Member[]) {
  return generateBom(members, catalog, validateMembers(members, catalog));
}

describe('member length', () => {
  it('is the distance between the resolved end points', () => {
    expect(memberLengthMm(beam('b1'))).toBe(6000);
  });

  it('uses the 3D distance for a sloped member (3-4-5 triangle)', () => {
    const sloped = beam('b1', {
      start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
      end: { elevation_mm: 4000, resolved_xyz_mm: [3000, 0, 4000] },
    });
    expect(memberLengthMm(sloped)).toBe(5000);
  });

  it('is null, not an estimate, when an end point is unresolved', () => {
    expect(memberLengthMm(beam('b1', { end: { resolved_xyz_mm: null } }))).toBeNull();
  });
});

describe('generateBom', () => {
  it('computes weight as length (m) x catalog kg/m', () => {
    const line = bomOf([column, beam('b1')]).lines.find((l) => l.member_id === 'b1');
    expect(line).toMatchObject({
      unit_length_mm: 6000,
      weight_kg_per_m: 10,
      unit_weight_kg: 60,
      total_length_mm: 6000,
      total_weight_kg: 60,
      included_in_totals: true,
      status: 'green',
      issue_codes: [],
    });
  });

  it('weighs a sloped member by its true length', () => {
    const sloped = beam('b1', {
      profile: 'TEST-002',
      start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
      end: { elevation_mm: 4000, resolved_xyz_mm: [3000, 0, 4000] },
    });
    const line = bomOf([column, sloped]).lines.find((l) => l.member_id === 'b1');
    expect(line?.unit_length_mm).toBe(5000);
    expect(line?.unit_weight_kg).toBe(125);
  });

  it('multiplies length and weight by quantity, leaving the unit values alone', () => {
    const line = bomOf([column, beam('b1', { quantity: 4 })]).lines.find(
      (l) => l.member_id === 'b1',
    );
    expect(line).toMatchObject({
      unit_weight_kg: 60,
      total_weight_kg: 240,
      total_length_mm: 24000,
    });
  });

  it('keeps members that cannot be weighed in the BOM, flagged, and reports them as excluded (red)', () => {
    const noProfile = beam('b2', { profile: null });
    const unknownProfile = beam('b3', { profile: 'TEST-404' });
    const noLength = beam('b4', { end: { resolved_xyz_mm: null } });
    const bom = bomOf([column, beam('b1'), noProfile, unknownProfile, noLength]);

    for (const id of ['b2', 'b3', 'b4']) {
      const line = bom.lines.find((l) => l.member_id === id);
      expect(line, id).toMatchObject({
        included_in_totals: false,
        unit_weight_kg: null,
        total_weight_kg: null,
        status: 'red',
      });
    }
    expect(bom.lines.find((l) => l.member_id === 'b2')?.issue_codes).toEqual(['MISSING_PROFILE']);
    expect(bom.totals).toEqual({
      members: 5,
      members_included: 2,
      pieces_included: 2,
      total_length_mm: 10000,
      total_weight_kg: 160,
    });
    expect(bom.excluded_red).toEqual({
      members: 3,
      pieces: 3,
      members_weighed: 0,
      total_length_mm: 0,
      total_weight_kg: 0,
    });
  });

  it('keeps a RED member out of the main total even when it can be weighed, and reports it apart', () => {
    const redButWeighable = beam('b2', {
      quantity: 2,
      start: { resolved_xyz_mm: [0, 3000, 4000] },
      end: { elevation_mm: null, resolved_xyz_mm: [6000, 3000, 4000] },
    });
    const bom = bomOf([column, beam('b1'), redButWeighable]);

    const line = bom.lines.find((l) => l.member_id === 'b2');
    expect(line).toMatchObject({
      status: 'red',
      issue_codes: ['MISSING_END_ELEVATION'],
      included_in_totals: false,
      unit_weight_kg: 60, // still computed and shown on its line
      total_weight_kg: 120,
    });
    expect(bom.totals).toEqual({
      members: 3,
      members_included: 2,
      pieces_included: 2,
      total_length_mm: 10000,
      total_weight_kg: 160,
    });
    expect(bom.excluded_red).toEqual({
      members: 1,
      pieces: 2,
      members_weighed: 1,
      total_length_mm: 12000,
      total_weight_kg: 120,
    });
    expect(bom.by_profile.map((g) => g.key)).toEqual(['TEST-001', 'TEST-002']);
    expect(bom.by_profile[0]).toMatchObject({ member_count: 1, total_weight_kg: 60 });
  });

  it('keeps AMBER members in the main total', () => {
    const amber = beam('b2', { material: null, supported_by: [] });
    const bom = bomOf([column, beam('b1'), amber]);
    expect(bom.lines.find((l) => l.member_id === 'b2')).toMatchObject({
      status: 'amber',
      included_in_totals: true,
    });
    expect(bom.totals.members_included).toBe(3);
    expect(bom.totals.total_weight_kg).toBe(220);
    expect(bom.excluded_red.members).toBe(0);
  });

  it('still includes a computable member that has a non-weight problem, and carries its status', () => {
    const noGrade = beam('b1', { grade: null });
    const line = bomOf([column, noGrade]).lines.find((l) => l.member_id === 'b1');
    expect(line).toMatchObject({
      included_in_totals: true,
      status: 'amber',
      issue_codes: ['MISSING_GRADE'],
    });
  });

  it('groups included members by profile and by type', () => {
    const bom = bomOf([
      column,
      beam('b1'),
      beam('b2', { quantity: 2 }),
      beam('b3', { profile: 'TEST-002' }),
    ]);
    expect(bom.by_profile).toEqual([
      {
        key: 'TEST-001',
        member_count: 2,
        piece_count: 3,
        total_length_mm: 18000,
        total_weight_kg: 180,
      },
      {
        key: 'TEST-002',
        member_count: 2,
        piece_count: 2,
        total_length_mm: 10000,
        total_weight_kg: 250,
      },
    ]);
    expect(bom.by_type).toEqual([
      {
        key: 'beam',
        member_count: 3,
        piece_count: 4,
        total_length_mm: 24000,
        total_weight_kg: 330,
      },
      {
        key: 'column',
        member_count: 1,
        piece_count: 1,
        total_length_mm: 4000,
        total_weight_kg: 100,
      },
    ]);
  });

  it('is deterministic: same output for any input order and on repeated runs', () => {
    const members = [
      column,
      beam('b1'),
      beam('b2', { quantity: 3 }),
      beam('b3', { profile: null }),
    ];
    const forward = bomOf(members);
    expect(bomOf([...members].reverse())).toEqual(forward);
    expect(JSON.stringify(bomOf(members))).toBe(JSON.stringify(forward));
    expect(forward.lines.map((l) => l.member_id)).toEqual(['b1', 'b2', 'b3', 'c1']);
  });

  it('never mutates the members, and stores no computed values on them', () => {
    const members = [column, beam('b1')];
    const before = structuredClone(members);
    bomOf(members);
    expect(members).toEqual(before);
    for (const m of members) {
      expect(Object.keys(m)).not.toEqual(expect.arrayContaining(['length_mm']));
      expect(Object.keys(m)).not.toEqual(expect.arrayContaining(['weight_kg']));
    }
  });

  it('fails loudly if a member has no validation result', () => {
    const members = [column, beam('b1')];
    const validation = validateMembers([column], catalog);
    expect(() => generateBom(members, catalog, validation)).toThrow(
      /no validation result for member b1/,
    );
  });

  it('has no pricing fields', () => {
    const line = bomOf([column, beam('b1')]).lines[0] as unknown as Record<string, unknown>;
    expect(Object.keys(line).filter((k) => /cost|price|rate/i.test(k))).toEqual([]);
  });
});

describe('column base elevation', () => {
  it('is the elevation of the lower end, by position', async () => {
    const { columnBaseElevationMm } = await import('../members/geometry.js');
    const c = makeMember({
      member_id: 'c',
      type: 'column',
      start: { elevation_mm: 4000, resolved_xyz_mm: [0, 0, 4000] },
      end: { elevation_mm: 100, resolved_xyz_mm: [0, 0, 0] },
    });
    expect(columnBaseElevationMm(c)).toBe(100);
  });

  it('treats an elevation of 0 as a real base elevation', async () => {
    const { columnBaseElevationMm } = await import('../members/geometry.js');
    const c = makeMember({
      member_id: 'c',
      type: 'column',
      start: { elevation_mm: 0, resolved_xyz_mm: [0, 0, 0] },
      end: { elevation_mm: 4000, resolved_xyz_mm: [0, 0, 4000] },
    });
    expect(columnBaseElevationMm(c)).toBe(0);
  });
});
