import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
let projectId: string;
let planSheet: string;
let notesSheet: string;

async function line(sheet: string, key: string, y: number, x: number, text: string) {
  await db
    .insertInto('text_items')
    .values({
      sheet_id: sheet,
      item_key: key,
      x0: x,
      y0: y,
      x1: x + 100,
      y1: y + 8,
      orientation: 'horizontal',
      text,
      methods: ['pdf_text'],
      confidence: 1,
      font_id: 'pdf_text',
      level: 'line',
      angle_deg: 0,
    })
    .execute();
}

beforeAll(async () => {
  projectId = await insertProject(db);
  planSheet = await insertSheet(db, projectId, { page_index: 0, width_pt: 1200, height_pt: 800 });
  notesSheet = await insertSheet(db, projectId, { page_index: 1, kind: 'notes' });
  await db
    .updateTable('sheets')
    .set({
      page_type_guess: 'framing_plan',
      page_type_reason: 'title match framing',
      level_guess: 'Second floor',
    })
    .where('id', '=', planSheet)
    .execute();
  await db
    .updateTable('sheets')
    .set({ page_type_guess: 'general_notes', page_type_reason: 'title match notes' })
    .where('id', '=', notesSheet)
    .execute();
  await line(notesSheet, 'n2', 200, 50, 'SHOP PAINT PRIMER ON ALL STEEL');
  await line(notesSheet, 'n1', 100, 50, 'STRUCTURAL STEEL SHALL BE A992');
  await line(planSheet, 'p1', 100, 50, 'W12x26');
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

const url = (sheet: string, tail: string) => `/api/projects/${projectId}/sheets/${sheet}/${tail}`;

describe('page type and level', () => {
  it('lists the guess, its reason and the effective value', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets` });
    const plan = res.json().sheets.find((s: { id: string }) => s.id === planSheet);
    expect(plan.page_type).toEqual({
      effective: 'framing_plan',
      guess: 'framing_plan',
      reason: 'title match framing',
      overridden: false,
    });
    expect(plan.level).toEqual({
      effective: 'Second floor',
      guess: 'Second floor',
      overridden: false,
    });
  });

  it('an override is an audited sheet_edits row; the guess is never overwritten', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'page-type'),
      payload: { value: 'foundation_plan', editor: 'alice', reason: 'title is misleading' },
    });
    expect(res.json()).toMatchObject({
      before: 'framing_plan',
      after: 'foundation_plan',
      overridden: true,
    });
    const got = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets/${planSheet}` })
    ).json();
    expect(got.page_type).toMatchObject({
      effective: 'foundation_plan',
      guess: 'framing_plan',
      overridden: true,
    });
    const row = await db
      .selectFrom('sheets')
      .select('page_type_guess')
      .where('id', '=', planSheet)
      .executeTakeFirstOrThrow();
    expect(row.page_type_guess).toBe('framing_plan');
    const edit = await db
      .selectFrom('sheet_edits')
      .selectAll()
      .where('sheet_id', '=', planSheet)
      .where('field_name', '=', 'page_type')
      .executeTakeFirstOrThrow();
    expect([edit.original_value, edit.corrected_value, edit.editor, edit.reason]).toEqual([
      'framing_plan',
      'foundation_plan',
      'alice',
      'title is misleading',
    ]);
    const cleared = await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'page-type'),
      payload: { value: null, editor: 'alice' },
    });
    expect(cleared.json()).toMatchObject({
      before: 'foundation_plan',
      after: 'framing_plan',
      overridden: false,
    });
    const again = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets/${planSheet}` })
    ).json();
    expect(again.page_type).toMatchObject({ effective: 'framing_plan', overridden: false });
  });

  it('rejects unknown page types, blank levels and unknown sheets', async () => {
    const bad = await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'page-type'),
      payload: { value: 'garage', editor: 'a' },
    });
    expect(bad.statusCode).toBe(400);
    const blank = await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'level'),
      payload: { value: '  ', editor: 'a' },
    });
    expect(blank.statusCode).toBe(400);
    const none = await app.inject({
      method: 'PATCH',
      url: url('00000000-0000-4000-8000-000000000000', 'level'),
      payload: { value: 'Roof', editor: 'a' },
    });
    expect(none.statusCode).toBe(404);
  });

  it('level override and clearing', async () => {
    const set = await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'level'),
      payload: { value: 'Level 2', editor: 'bob' },
    });
    expect(set.json()).toMatchObject({ before: 'Second floor', after: 'Level 2' });
    const sheet = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets/${planSheet}` })
    ).json();
    expect(sheet.level).toEqual({ effective: 'Level 2', guess: 'Second floor', overridden: true });
    await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'level'),
      payload: { value: null, editor: 'bob' },
    });
    const back = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets/${planSheet}` })
    ).json();
    expect(back.level).toMatchObject({ effective: 'Second floor', overridden: false });
  });
});

describe('notes', () => {
  it('returns the lines of general-notes pages in reading order, and nothing from other pages', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/notes` });
    const sheets = res.json().sheets;
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ sheet_id: notesSheet, page_number: 2 });
    expect(sheets[0].lines.map((l: { text: string }) => l.text)).toEqual([
      'STRUCTURAL STEEL SHALL BE A992',
      'SHOP PAINT PRIMER ON ALL STEEL',
    ]);
  });

  it('a page overridden to general notes joins the notes', async () => {
    await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'page-type'),
      payload: { value: 'general_notes', editor: 'a' },
    });
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/notes` });
    expect(res.json().sheets.map((s: { page_number: number }) => s.page_number)).toEqual([1, 2]);
    await app.inject({
      method: 'PATCH',
      url: url(planSheet, 'page-type'),
      payload: { value: null, editor: 'a' },
    });
  });
});

describe('rescan', () => {
  it('queues one scan job and refuses a second while it is open', async () => {
    const empty = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/rescan` });
    expect(empty.statusCode).toBe(404); // no PDF yet
    await db
      .insertInto('project_files')
      .values({
        project_id: projectId,
        original_filename: 'x.pdf',
        stored_path: 'x/y.pdf',
        sha256: '0'.repeat(64),
        size_bytes: 1,
      })
      .execute();
    const first = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/rescan` });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/rescan` });
    expect([second.statusCode, second.json().job_id]).toEqual([409, first.json().job_id]);
    await db.deleteFrom('jobs').where('id', '=', first.json().job_id).execute();
  });
});
