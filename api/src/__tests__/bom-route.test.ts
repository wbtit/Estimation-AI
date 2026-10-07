import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadCatalogFile } from '../catalog/load-file.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { memberToInsertRow } from '../members/rows.js';
import { loadSyntheticMembers, SYNTHETIC_CATALOG_CSV } from '../synthetic/fixture.js';
import { makeMember } from '../synthetic/member-factory.js';
import {
  deleteEdition,
  deleteProject,
  insertProject,
  loadWorkbook,
  uniqueLabel,
} from './helpers.js';

const app = buildApp();
const edition = uniqueLabel('TEST-EDITION');
let projectId: string;
let badProjectId: string;

beforeAll(async () => {
  const db = getDb();
  const loaded = await loadCatalogFile(SYNTHETIC_CATALOG_CSV, {
    columns: { name: 'shape', family: 'family', weight: 'weight_kg_per_m', weightUnit: 'kg/m' },
  });
  await importCatalog(db, edition, loaded.shapes);

  projectId = await insertProject(db);
  const { members } = loadSyntheticMembers();
  await db
    .insertInto('members')
    .values(members.map((m) => memberToInsertRow(projectId, m, { origin: 'seed' })))
    .execute();

  badProjectId = await insertProject(db);
  await db
    .insertInto('members')
    .values({
      ...memberToInsertRow(badProjectId, makeMember({ member_id: 'bad-bbox' }), { origin: 'seed' }),
      source_bbox: '{"not":"a bbox"}',
    })
    .execute();
});

afterAll(async () => {
  await app.close();
  await deleteProject(getDb(), projectId);
  await deleteProject(getDb(), badProjectId);
  await deleteEdition(getDb(), edition);
  await closeDatabaseConnection();
});

describe('GET /api/projects/:projectId/bom (real database)', () => {
  it('runs validation and the BOM for the project members', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/bom?edition=${edition}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schema_version).toBe(0);
    expect(body.catalog_edition).toBe(edition);
    expect(body.project.project_id).toBe(projectId);
    expect(body.validation.counts).toEqual({ green: 6, amber: 4, red: 4 });
    expect(body.bom.totals).toEqual({
      members: 14,
      members_included: 10,
      pieces_included: 13,
      total_length_mm: 73000,
      total_weight_kg: 1405,
    });
    expect(body.bom.excluded_red).toEqual({
      members: 4,
      pieces: 4,
      members_weighed: 1,
      total_length_mm: 6000,
      total_weight_kg: 60,
    });
    const b4 = body.validation.results.find((r: { member_id: string }) => r.member_id === 'B4');
    expect(b4.issues[0].code).toBe('MISSING_PROFILE');
  });

  it('is read-only: calling it does not change any member row', async () => {
    const snapshot = () =>
      getDb()
        .selectFrom('members')
        .selectAll()
        .where('project_id', '=', projectId)
        .orderBy('member_id')
        .execute();
    const before = await snapshot();
    await app.inject({ method: 'GET', url: `/api/projects/${projectId}/bom?edition=${edition}` });
    expect(await snapshot()).toEqual(before);
  });

  it('returns 404 for an unknown project and for an unknown catalog edition', async () => {
    const unknownProject = await app.inject({
      method: 'GET',
      url: `/api/projects/${randomUUID()}/bom?edition=${edition}`,
    });
    expect(unknownProject.statusCode).toBe(404);
    expect(unknownProject.json().error).toBe('project not found');

    const unknownEdition = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/bom?edition=${uniqueLabel('NO-SUCH')}`,
    });
    expect(unknownEdition.statusCode).toBe(404);
    expect(unknownEdition.json().error).toMatch(/catalog edition .* not found/);
  });

  it('returns 400 for a malformed project id or a missing edition', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/not-a-uuid/bom?edition=${edition}` }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/bom` })).statusCode,
    ).toBe(400);
  });

  it('returns 422 naming the member when a stored row violates the contract', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${badProjectId}/bom?edition=${edition}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/stored member "bad-bbox" violates contract v0/);
  });
});

describe('GET /api/projects/:projectId/bom.xlsx (real database)', () => {
  it('returns an xlsx workbook with the BOM and Summary sheets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/bom.xlsx?edition=${edition}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe(`attachment; filename="bom-${projectId}.xlsx"`);

    const wb = await loadWorkbook(res.rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['BOM', 'Summary']);
    expect(wb.getWorksheet('BOM')?.rowCount).toBe(17);
  });

  it('shares the 404 and 400 behaviour', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${randomUUID()}/bom.xlsx?edition=${edition}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/bom.xlsx` })).statusCode,
    ).toBe(400);
  });
});
