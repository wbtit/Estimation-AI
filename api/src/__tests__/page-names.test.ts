// Migration 030: a person corrects the page name and the sheet number. The names read on the page
// stay; the page shows the person's name; a person's sheet number is written with source 'person';
// every change is an append-only sheet_edits row (shown value before and after, who).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'names tester';
let projectId: string;
let otherProjectId: string;
let sheetId: string;

const patch = (body: object, sid = sheetId, pid = projectId) =>
  app.inject({
    method: 'PATCH',
    url: `/api/projects/${pid}/sheets/${sid}/names`,
    payload: body,
  });
const pageOf = async () => {
  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/pages` });
  return res.json().pages.find((p: { id: string }) => p.id === sheetId);
};
const edits = () =>
  db
    .selectFrom('sheet_edits')
    .select(['field_name', 'original_value', 'corrected_value', 'editor'])
    .where('sheet_id', '=', sheetId)
    .orderBy('created_at')
    .execute();

beforeAll(async () => {
  projectId = await insertProject(db);
  otherProjectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, { page_index: 0, sheet_number: 'S-100' });
  await db
    .updateTable('sheets')
    .set({ view_title: 'GENERAL SHEET NOTES:', sheet_number_source: 'title_block_region' })
    .where('id', '=', sheetId)
    .execute();
});

afterAll(async () => {
  await app.close();
  await deleteProject(db, projectId);
  await deleteProject(db, otherProjectId);
  await closeDatabaseConnection();
});

describe('page name and sheet number override', () => {
  it('the page shows the name read on the page until a person names it', async () => {
    const p = await pageOf();
    expect([p.name, p.name_source, p.sheet_number]).toEqual([
      'GENERAL SHEET NOTES:',
      'view_title',
      'S-100',
    ]);
  });

  it('a person names the page and corrects the sheet number; the read values stay', async () => {
    const res = await patch({ name: '  Foundation plan ', sheet_number: 'S-101', who: WHO });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Foundation plan', sheet_number: 'S-101' });
    const p = await pageOf();
    expect([p.name, p.name_source, p.sheet_number, p.sheet_number_source]).toEqual([
      'Foundation plan',
      'person',
      'S-101',
      'person',
    ]);
    const s = await db
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .executeTakeFirstOrThrow();
    expect(s.view_title).toBe('GENERAL SHEET NOTES:'); // the read name is never overwritten
    expect([s.name_confirmed_by, s.sheet_number_confirmed_by]).toEqual([WHO, WHO]);
    expect(await edits()).toEqual([
      {
        field_name: 'page_name',
        original_value: 'GENERAL SHEET NOTES:',
        corrected_value: 'Foundation plan',
        editor: WHO,
      },
      {
        field_name: 'sheet_number',
        original_value: 'S-100',
        corrected_value: 'S-101',
        editor: WHO,
      },
    ]);
  });

  it('a blank or null name goes back to the name read on the page', async () => {
    expect((await patch({ name: '   ', who: WHO })).statusCode).toBe(200);
    const p = await pageOf();
    expect([p.name, p.name_source, p.sheet_number]).toEqual([
      'GENERAL SHEET NOTES:',
      'view_title',
      'S-101',
    ]);
    expect((await edits()).at(-1)).toMatchObject({
      field_name: 'page_name',
      original_value: 'Foundation plan',
      corrected_value: 'GENERAL SHEET NOTES:',
    });
    expect((await patch({ name: null, who: WHO })).statusCode).toBe(200);
  });

  it('refuses a blank sheet number, an empty body, a blank who and another project', async () => {
    const n = (await edits()).length;
    expect((await patch({ sheet_number: '  ', who: WHO })).statusCode).toBe(400);
    expect((await patch({ who: WHO })).statusCode).toBe(400);
    expect((await patch({ name: 'x', who: '  ' })).statusCode).toBe(400);
    expect((await patch({ name: 'x', who: WHO }, sheetId, otherProjectId)).statusCode).toBe(404);
    expect((await edits()).length).toBe(n);
  });
});
