import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contractDocumentSchema,
  contractDocumentSchemaV0,
  convertContractV0ToV1,
  endpointSchema,
  memberSchema,
  projectSchema,
  sheetSchema,
  SCHEMA_VERSION,
} from '../contract/index.js';
import { contractJsonSchemaText, contractJsonSchemaTextV0 } from '../contract/json-schema.js';
import { loadSyntheticMembers } from '../synthetic/fixture.js';
import { makeEndpoint, makeMember } from '../synthetic/member-factory.js';

const CYRILLIC_A = '\u0410'; // looks like Latin A

const project = {
  schema_version: 1,
  project_id: 'project-001',
  name: 'synthetic-001',
  number: null,
  status: 'draft',
  design_standard: 'AISC',
  unit_system: 'mm',
  location: null,
  grids: [{ axis: 'x', label: CYRILLIC_A, position_mm: 0 }],
  levels: [{ name: 'L1', elevation_mm: 4000 }],
  drawing_issue: null,
};

const sheet = {
  sheet_id: 'sheet-001',
  sheet_number: null,
  title: null,
  kind: 'plan',
  page_index: 0,
  scale: { parsed: null, override: null, source: null },
  tos_notes: null,
  crop_region: null,
  build_status: 'not_built',
  built_at: null,
};

describe('contract schema v1', () => {
  it('is version 1; a version 0 project is not a valid v1 project', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(projectSchema.safeParse({ ...project, schema_version: 1 }).success).toBe(true);
    expect(projectSchema.safeParse({ ...project, schema_version: 0 }).success).toBe(false);
  });

  it('adds only optional member fields: a member without them is still valid', () => {
    const m = makeMember({ member_id: 'm-1' });
    expect(memberSchema.safeParse(m).success).toBe(true);
    expect(
      memberSchema.safeParse({
        ...m,
        kind: 'Beams',
        kind_source: 'keyword',
        kind_confirmed: false,
        tag_prefix: 'XX',
        tag_number: 3,
      }).success,
    ).toBe(true);
    expect(memberSchema.safeParse({ ...m, kind_source: 'guess' }).success).toBe(false);
    expect(memberSchema.safeParse({ ...m, tag_number: 0 }).success).toBe(false);
  });

  it('converts a version 0 document and rejects what is not one', () => {
    const v0 = {
      ...project,
      schema_version: 0,
      sheets: [sheet],
      members: [makeMember({ member_id: 'm-1' })],
    };
    expect(contractDocumentSchemaV0.safeParse(v0).success).toBe(true);
    const v1 = convertContractV0ToV1(v0);
    expect(v1.schema_version).toBe(1);
    expect(v1.members).toEqual(v0.members); // nothing else changed, no kind invented
    expect(v1.members[0]).not.toHaveProperty('kind');
    expect(() => convertContractV0ToV1({ ...v0, schema_version: 1 })).toThrow();
    expect(() => convertContractV0ToV1({ ...v0, members: [{ member_id: 'x' }] })).toThrow();
  });

  it('accepts a valid member', () => {
    expect(memberSchema.safeParse(makeMember({ member_id: 'm-1' })).success).toBe(true);
  });

  it('accepts a member with unknown (null) values: they are stored, not defaulted', () => {
    const m = makeMember({
      member_id: 'm-1',
      profile: null,
      material: null,
      grade: null,
      start: { elevation_mm: null, resolved_xyz_mm: null },
    });
    expect(memberSchema.safeParse(m).success).toBe(true);
  });

  it('rejects unknown keys (strict objects)', () => {
    expect(memberSchema.safeParse({ ...makeMember({ member_id: 'm-1' }), extra: 1 }).success).toBe(
      false,
    );
    expect(endpointSchema.safeParse({ ...makeEndpoint(), extra: 1 }).success).toBe(false);
  });

  it('requires every key to be present: material cannot be silently omitted', () => {
    const withoutMaterial: Record<string, unknown> = { ...makeMember({ member_id: 'm-1' }) };
    delete withoutMaterial.material;
    expect(memberSchema.safeParse(withoutMaterial).success).toBe(false);
  });

  it.each([
    ['quantity 0', { quantity: 0 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['negative studs', { studs: -1 }],
    ['unknown type', { type: 'girder' }],
    ['empty member_id', { member_id: '' }],
    ['confidence above 1', { confidence: { overall: 1.2, fields: {} } }],
    ['unknown review status', { review: { status: 'done', edits: [] } }],
  ])('rejects %s', (_label, patch) => {
    const bad = { ...makeMember({ member_id: 'm-1' }), ...patch };
    expect(memberSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-numeric elevation', () => {
    const bad = makeMember({ member_id: 'm-1' });
    (bad.start as unknown as Record<string, unknown>).elevation_mm = '4000';
    expect(memberSchema.safeParse(bad).success).toBe(false);
  });

  it('keeps grid labels exact: Cyrillic look-alikes are preserved and stay distinct from Latin', () => {
    const parsed = memberSchema.parse(
      makeMember({ member_id: 'm-1', start: { grid_x: CYRILLIC_A }, end: { grid_x: 'A' } }),
    );
    expect(parsed.start.grid_x).toBe(CYRILLIC_A);
    expect(parsed.start.grid_x?.codePointAt(0)).toBe(0x410);
    expect(parsed.start.grid_x).not.toBe(parsed.end.grid_x);
    expect(projectSchema.parse(project).grids[0]?.label).toBe(CYRILLIC_A);
  });

  it('does not trim identifiers', () => {
    const parsed = memberSchema.parse(makeMember({ member_id: ' m-1 ' }));
    expect(parsed.member_id).toBe(' m-1 ');
  });

  it('validates project, sheet and the full document', () => {
    expect(projectSchema.safeParse(project).success).toBe(true);
    expect(projectSchema.safeParse({ ...project, unit_system: 'in' }).success).toBe(false);
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
    expect(sheetSchema.safeParse({ ...sheet, kind: 'elevation' }).success).toBe(false);
    const doc = { ...project, sheets: [sheet], members: [makeMember({ member_id: 'm-1' })] };
    expect(contractDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts every synthetic fixture member', () => {
    const { members } = loadSyntheticMembers();
    expect(members).toHaveLength(14);
    for (const m of members) expect(memberSchema.safeParse(m).success, m.member_id).toBe(true);
  });
});

describe('JSON Schema', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schema');

  it('the committed files match the Zod contract (run `make schema` after changing it)', () => {
    expect(fs.readFileSync(path.join(dir, 'contract.v1.schema.json'), 'utf8')).toBe(
      contractJsonSchemaText(),
    );
    expect(fs.readFileSync(path.join(dir, 'contract.v0.schema.json'), 'utf8')).toBe(
      contractJsonSchemaTextV0(),
    );
  });

  it('describes a strict v1 document', () => {
    const schema = JSON.parse(contractJsonSchemaText()) as Record<string, unknown> & {
      properties: Record<string, { const?: unknown }>;
    };
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schema_version?.const).toBe(1);
    expect(schema.properties.unit_system?.const).toBe('mm');
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['sheets', 'members']));
  });
});
