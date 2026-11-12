// Phase 0 cover details: the project details routes (SYNTHETIC rows, test database).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

describe('project details (test database)', () => {
  let projectId: string;
  let sheetId: string;
  const get = () =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}/project-details` });
  const send = (method: 'POST' | 'PUT', path: string, payload: object) =>
    app.inject({ method, url: `/api/projects/${projectId}/project-details${path}`, payload });
  const field = async (f: string) =>
    (
      (await get()).json().fields as { field: string; value: string | null; edited: boolean }[]
    ).find((x) => x.field === f)!;
  const readRows = async (name: string) => {
    await db.deleteFrom('project_details').where('project_id', '=', projectId).execute();
    await db
      .insertInto('project_details')
      .values([
        {
          project_id: projectId,
          field: 'project_name',
          value: name,
          page_index: 0,
          box: JSON.stringify([60, 80, 300, 95]),
          rule: 'same_line',
          confidence: 'high',
          flags: [],
          alternatives: JSON.stringify([
            { value: 'Other Name', page_index: 2, rule: 'x', confidence: 'low', box: [1, 2, 3, 4] },
          ]),
          agreement: JSON.stringify({
            state: 'agree',
            agree: ['repeated_title_block_x5'],
            differ: [],
          }),
        },
        {
          project_id: projectId,
          field: 'owner',
          value: 'Acme Holdings LLC',
          page_index: 0,
          box: JSON.stringify([60, 110, 200, 125]),
          rule: 'below',
          confidence: 'medium',
          flags: [],
          alternatives: '[]',
          agreement: null,
        },
      ] as never)
      .execute();
  };

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 1, width_pt: 792, height_pt: 612 });
  });
  afterAll(async () => {
    await db.deleteFrom('jobs').where('type', '=', 'read_details').execute();
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('before a read: every field is empty and the status says not read', async () => {
    const res = (await get()).json();
    expect(res.status).toBe('not_read');
    expect(res.fields.length).toBeGreaterThanOrEqual(15);
    expect(res.fields.every((f: { value: string | null }) => f.value === null)).toBe(true);
    expect(res.index.summary).toEqual({ rows: 0, matched: 0, percent: null });
  });

  it('a read shows the value with its source page, box, rule and confidence', async () => {
    await readRows('Riverside Warehouse');
    await db
      .insertInto('project_detail_reads')
      .values({
        project_id: projectId,
        cover_pages: [0],
        no_text_pages: [],
        pages: 5,
        seconds: '0.4',
      } as never)
      .execute();
    const res = (await get()).json();
    expect(res.status).toBe('read');
    const f = res.fields.find((x: { field: string }) => x.field === 'project_name');
    expect(f).toMatchObject({
      value: 'Riverside Warehouse',
      rule: 'same_line',
      confidence: 'high',
      page_index: 0,
      box: [60, 80, 300, 95],
      edited: false,
    });
    expect(f.alternatives).toHaveLength(1);
    expect(res.read).toMatchObject({ cover_pages: [0], pages: 5, seconds: 0.4 });
  });

  it('an edit wins, survives a re-read, and Undo puts the read value back', async () => {
    const put = await send('PUT', '/owner', { value: 'Acme Co', who: WHO });
    expect(put.statusCode).toBe(200);
    expect(await field('owner')).toMatchObject({
      value: 'Acme Co',
      edited: true,
      read_value: 'Acme Holdings LLC',
    });
    await readRows('Riverside Warehouse'); // a re-read replaces the machine values only
    expect(await field('owner')).toMatchObject({ value: 'Acme Co', edited: true });
    const un = await send('POST', '/undo', { who: WHO });
    expect(un.json()).toMatchObject({ field: 'owner', kind: 'edit' });
    expect(await field('owner')).toMatchObject({ value: 'Acme Holdings LLC', edited: false });
    expect((await send('POST', '/undo', { who: WHO })).statusCode).toBe(409);
    // clearing is an edit too; picking an alternative is logged as such
    await send('PUT', '/owner', { value: null, who: WHO });
    expect((await field('owner')).value).toBeNull();
    await send('PUT', '/project_name', { value: 'Other Name', who: WHO, from_alternative: true });
    const kinds = await db
      .selectFrom('project_detail_edits')
      .select(['field', 'kind', 'before', 'after'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .execute();
    expect(kinds.map((k) => k.kind)).toEqual(['edit', 'undo', 'edit', 'use_alternative']);
    expect(kinds[3]!.before).toEqual({ value: 'Riverside Warehouse' });
  });

  it('Use as project name: one logged click, the project is only changed by it, Undo restores', async () => {
    const before = (await get()).json().project;
    const res = await send('POST', '/project_name/use-as-project', { who: WHO });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ value: 'Other Name', previous: before.name });
    expect((await get()).json().project.name).toBe('Other Name');
    await send('POST', '/undo', { who: WHO });
    expect((await get()).json().project.name).toBe(before.name);
    expect((await send('POST', '/owner/use-as-project', { who: WHO })).statusCode).toBe(400);
    expect((await send('POST', '/project_number/use-as-project', { who: WHO })).statusCode).toBe(
      409,
    );
  });

  it('the index check: rows matched, flags with a jump target', async () => {
    await db
      .insertInto('drawing_index_rows')
      .values([
        {
          project_id: projectId,
          page_index: 0,
          number: 'S101',
          title: 'FOUNDATION PLAN',
          box: '[1,2,3,4]',
          rule: 'same_line',
          match: 'exact',
          matched_page: 1,
          matched_sheet_id: sheetId,
        },
        {
          project_id: projectId,
          page_index: 0,
          number: 'S999',
          title: 'MISSING',
          box: '[1,2,3,4]',
          rule: 'same_line',
          match: 'none',
        },
      ] as never)
      .execute();
    await db
      .insertInto('drawing_index_flags')
      .values([
        {
          project_id: projectId,
          kind: 'name_mismatch',
          page_index: 1,
          sheet_id: sheetId,
          index_page: 0,
          number: 'S101',
          title: 'FOUNDATION PLAN',
          detail: '{"index":"A","page":"B"}',
        },
        {
          project_id: projectId,
          kind: 'missing_from_pdf',
          page_index: null,
          sheet_id: null,
          index_page: 0,
          number: 'S999',
          title: 'MISSING',
          detail: '{}',
        },
      ] as never)
      .execute();
    const idx = (await get()).json().index;
    expect(idx.summary).toEqual({ rows: 2, matched: 1, percent: 50 });
    expect(idx.flags.find((f: { kind: string }) => f.kind === 'name_mismatch').page_index).toBe(1);
    expect(idx.flags.find((f: { kind: string }) => f.kind === 'missing_from_pdf').page_index).toBe(
      0,
    ); // the index page
  });

  it('a cover with no text is said so, and a read is queued once', async () => {
    await db.deleteFrom('project_details').where('project_id', '=', projectId).execute();
    await db
      .updateTable('project_detail_reads')
      .set({ no_text_pages: [0] } as never)
      .where('project_id', '=', projectId)
      .execute();
    expect((await get()).json().status).toBe('no_text');
    const a = await send('POST', '/read', { who: WHO });
    const b = await send('POST', '/read', { who: WHO });
    expect([a.statusCode, a.json().queued, b.json().queued]).toEqual([202, true, false]);
  });
});
