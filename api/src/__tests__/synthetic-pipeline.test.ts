// End-to-end (no database): synthetic fixture -> catalog -> validate -> BOM.
// Every expected number below was worked out by hand from fixtures/synthetic, not copied from output:
//   TEST-001 = 10 kg/m, TEST-002 = 25 kg/m, TEST-003 = 40 kg/m.
import { describe, expect, it } from 'vitest';
import { generateBom } from '../bom/index.js';
import { loadCatalogFile } from '../catalog/load-file.js';
import { loadSyntheticMembers, SYNTHETIC_CATALOG_CSV } from '../synthetic/fixture.js';
import { validateMembers, type CatalogIndex, type IssueCode } from '../validator/index.js';

async function setup() {
  const { shapes, errors } = await loadCatalogFile(SYNTHETIC_CATALOG_CSV, {
    columns: { name: 'shape', family: 'family', weight: 'weight_kg_per_m', weightUnit: 'kg/m' },
  });
  expect(errors).toEqual([]);
  const catalog: CatalogIndex = new Map(
    shapes.map((s) => [
      s.shape_name,
      { shape_name: s.shape_name, weight_kg_per_m: s.weight_kg_per_m },
    ]),
  );
  const { members } = loadSyntheticMembers();
  const validation = validateMembers(members, catalog);
  return { members, validation, bom: generateBom(members, catalog, validation) };
}

const EXPECTED_ISSUES: Record<string, IssueCode[]> = {
  C1: [],
  C2: [],
  B1: [],
  B2: [], // sloped: 3000 mm horizontal, 4000 mm rise
  B3: ['MISSING_MATERIAL', 'MISSING_GRADE'],
  B4: ['MISSING_PROFILE'],
  B5: ['PROFILE_NOT_IN_CATALOG'],
  B6: ['MISSING_END_ELEVATION'],
  B7: ['UNSUPPORTED_MEMBER'],
  B8: [], // Cyrillic grid labels
  B9: ['DUPLICATE_MEMBER'],
  B10: ['DUPLICATE_MEMBER'],
  B11: [],
  B12: ['LENGTH_UNAVAILABLE'],
};

describe('synthetic pipeline', () => {
  it('flags exactly the intended issues on each synthetic member', async () => {
    const { validation } = await setup();
    const actual = Object.fromEntries(
      validation.results.map((r) => [r.member_id, r.issues.map((i) => i.code)]),
    );
    expect(actual).toEqual(EXPECTED_ISSUES);
  });

  it('assigns the expected statuses', async () => {
    const { validation } = await setup();
    const byStatus = (color: string) =>
      validation.results
        .filter((r) => r.status === color)
        .map((r) => r.member_id)
        .sort();
    expect(byStatus('green')).toEqual(['B1', 'B11', 'B2', 'B8', 'C1', 'C2']);
    expect(byStatus('amber')).toEqual(['B10', 'B3', 'B7', 'B9']);
    expect(byStatus('red')).toEqual(['B12', 'B4', 'B5', 'B6']);
    expect(validation.counts).toEqual({ green: 6, amber: 4, red: 4 });
  });

  it('keeps the Cyrillic grid labels exact', async () => {
    const { members } = await setup();
    const b8 = members.find((m) => m.member_id === 'B8');
    expect(b8?.start.grid_x?.codePointAt(0)).toBe(0x410);
    expect(b8?.end.grid_x?.codePointAt(0)).toBe(0x412);
  });

  it('computes the expected BOM totals (hand-calculated)', async () => {
    const { bom } = await setup();
    expect(bom.totals).toEqual({
      members: 14,
      members_included: 11,
      members_excluded: 3, // B4 (no profile), B5 (not in catalog), B12 (no length)
      pieces_included: 14,
      total_length_mm: 79000,
      total_weight_kg: 1465,
    });
    expect(bom.lines.filter((l) => !l.included_in_totals).map((l) => l.member_id)).toEqual([
      'B12',
      'B4',
      'B5',
    ]);
  });

  it('computes the expected per-member weights (hand-calculated)', async () => {
    const { bom } = await setup();
    const weight = (id: string) => bom.lines.find((l) => l.member_id === id)?.total_weight_kg;
    expect(weight('C1')).toBe(160); // 4 m x 40 kg/m
    expect(weight('B1')).toBe(60); // 6 m x 10 kg/m
    expect(weight('B2')).toBe(125); // 5 m (3-4-5 slope) x 25 kg/m
    expect(weight('B11')).toBe(600); // 6 m x 25 kg/m x 4
    expect(weight('B4')).toBeNull();
  });

  it('groups by profile and by type (hand-calculated)', async () => {
    const { bom } = await setup();
    expect(bom.by_profile).toEqual([
      {
        key: 'TEST-001',
        member_count: 7,
        piece_count: 7,
        total_length_mm: 42000,
        total_weight_kg: 420,
      },
      {
        key: 'TEST-002',
        member_count: 2,
        piece_count: 5,
        total_length_mm: 29000,
        total_weight_kg: 725,
      },
      {
        key: 'TEST-003',
        member_count: 2,
        piece_count: 2,
        total_length_mm: 8000,
        total_weight_kg: 320,
      },
    ]);
    expect(bom.by_type).toEqual([
      {
        key: 'beam',
        member_count: 9,
        piece_count: 12,
        total_length_mm: 71000,
        total_weight_kg: 1145,
      },
      {
        key: 'column',
        member_count: 2,
        piece_count: 2,
        total_length_mm: 8000,
        total_weight_kg: 320,
      },
    ]);
  });
});
