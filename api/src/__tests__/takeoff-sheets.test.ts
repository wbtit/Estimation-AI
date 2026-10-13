import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { decisionOf, inclusionOf, suggestionOf } from '../review/takeoff-sheets.js';
import { deleteProject, insertProject, insertSheet, loadWorkbook } from './helpers.js';

describe('the decision of a sheet', () => {
  it('is undecided until a person decides; every vector sheet is in by default (a flag)', () => {
    for (const t of ['framing_plan', 'foundation_plan', 'elevation', 'detail', 'other', null]) {
      expect(inclusionOf(t, null)).toMatchObject({
        decision: 'undecided',
        included: true,
        by_default: true,
        not_vector: false,
        likely_not_framing: t !== 'framing_plan',
      });
    }
    expect(suggestionOf('framing_plan')).toBe('include');
    expect(suggestionOf('detail')).toBe('exclude');
  });

  it('a raster or unknown page is out by default, with a flag', () => {
    for (const kind of ['scanned', 'unknown', null]) {
      expect(inclusionOf('framing_plan', null, null, null, kind)).toMatchObject({
        included: false,
        not_vector: true,
        likely_not_framing: false,
        by_default: true,
      });
    }
    // a person can still include it
    expect(inclusionOf('framing_plan', 'include', 'a', 't', 'scanned').included).toBe(true);
  });

  it('a person decision wins in both directions, whatever the guess says', () => {
    expect(inclusionOf('detail', 'include', 'alice', 't')).toEqual({
      decision: 'include',
      included: true,
      by_default: false,
      not_vector: false,
      likely_not_framing: true,
      suggestion: 'exclude',
      decided_by: 'alice',
      decided_at: 't',
    });
    expect(inclusionOf('framing_plan', 'exclude')).toMatchObject({
      decision: 'exclude',
      included: false,
    });
    expect(decisionOf('maybe')).toBe('undecided');
    expect(decisionOf(null)).toBe('undecided');
  });
});

describe('sheet decision routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let plan: string;
  let detail: string;
  let third: string;
  const box = JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 });

  const addBeam = async (sheet: string) => {
    const view = await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheet,
        box,
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
        structural_classes: ['1.5-2.5|black|solid'],
        classes_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: view.id,
        type: 'beam',
        profile_text: 'W12x26',
        point: { x: 300, y: 300 },
        line: { p: [200, 300], q: [600, 300] },
        who: 'alice',
      },
    });
    expect(res.statusCode).toBe(201);
    return view.id;
  };
  const takeoff = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })).json();
  const decide = (sheet: string, value: string | null, editor = 'alice') =>
    app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/sheets/${sheet}/takeoff`,
      payload: { value, editor },
    });
  const undo = (sheet: string, editor = 'alice') =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sheets/${sheet}/takeoff/undo`,
      payload: { editor },
    });
  const sheetJson = async (sheet: string) =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets/${sheet}` })).json();

  let planView: string;
  let detailView: string;
  beforeAll(async () => {
    projectId = await insertProject(db);
    const size = { width_pt: 1200, height_pt: 800 };
    plan = await insertSheet(db, projectId, {
      page_index: 0,
      page_type_guess: 'framing_plan',
      ...size,
    });
    detail = await insertSheet(db, projectId, {
      page_index: 1,
      page_type_guess: 'detail',
      ...size,
    });
    third = await insertSheet(db, projectId, { page_index: 2, page_type_guess: 'other', ...size });
    planView = await addBeam(plan);
    detailView = await addBeam(detail);
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('every sheet starts undecided and every vector sheet is in the totals by default', async () => {
    const t = await takeoff();
    expect(t.totals.pieces).toBe(2); // the framing plan and the detail sheet
    expect(t.undecided_sheets).toEqual({ count: 3, pages: [1, 2, 3] });
    expect(t.sheets.map((s: { decision: string }) => s.decision)).toEqual([
      'undecided',
      'undecided',
      'undecided',
    ]);
    expect(t.sheets[0]).toMatchObject({ suggestion: 'include', members_not_counted: 0 });
    expect(t.sheets[1]).toMatchObject({ suggestion: 'exclude', members_not_counted: 0 });
    expect((await sheetJson(plan)).takeoff).toMatchObject({
      decision: 'undecided',
      suggestion: 'include',
      likely_not_framing: false,
    });
    expect((await sheetJson(detail)).takeoff).toMatchObject({
      included: true,
      likely_not_framing: true,
    });
  });

  it('the link job is allowed on a sheet included by default and refused once a person excludes it', async () => {
    const url = `/api/projects/${projectId}/views/${planView}/link`;
    const detailUrl = `/api/projects/${projectId}/views/${detailView}/link`;
    for (const u of [url, detailUrl]) {
      const byDefault = await app.inject({ method: 'POST', url: u });
      expect(byDefault.json().error).toContain('scan is not finished'); // the sheet check passed
    }
    await decide(plan, 'exclude');
    const excluded = await app.inject({ method: 'POST', url });
    expect(excluded.statusCode).toBe(409);
    expect(excluded.json().error).toContain('excluded');
    await decide(plan, null);
  });

  it('a decision stores who and when; a person can take a sheet out of the totals', async () => {
    expect((await decide(plan, 'include', 'bob')).statusCode).toBe(200);
    let t = await takeoff();
    expect(t.totals.pieces).toBe(2);
    expect(t.undecided_sheets.count).toBe(2);
    const row = t.sheets.find((s: { page_number: number }) => s.page_number === 1);
    expect(row).toMatchObject({ decision: 'include', decided_by: 'bob', members_not_counted: 0 });
    expect(typeof row.decided_at).toBe('string');
    expect((await decide(detail, 'exclude', 'bob')).statusCode).toBe(200);
    t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(
      t.sheets.find((s: { page_number: number }) => s.page_number === 2).members_not_counted,
    ).toBe(1);
    await undo(detail, 'bob');
    expect((await takeoff()).totals.pieces).toBe(2);
  });

  it('the link job is allowed on a detail sheet a person included', async () => {
    await decide(detail, 'include');
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/views/${detailView}/link`,
    });
    // the sheet decision passes; this test project has no scanned PDF, which is the next check
    expect(res.json().error).toContain('scan is not finished');
    expect((await takeoff()).totals.pieces).toBe(2);
  });

  it('undo goes back one decision at a time, with who and when kept in the history', async () => {
    // decisions of the detail sheet so far: include
    expect((await undo(detail, 'carol')).statusCode).toBe(200);
    expect((await sheetJson(detail)).takeoff.decision).toBe('undecided');
    expect((await takeoff()).totals.pieces).toBe(2); // undecided again: in by default
    expect((await decide(detail, 'exclude')).statusCode).toBe(200);
    expect((await decide(detail, 'include')).statusCode).toBe(200);
    expect((await undo(detail)).statusCode).toBe(200); // back to exclude
    expect((await sheetJson(detail)).takeoff.decision).toBe('exclude');
    expect((await undo(detail)).statusCode).toBe(200); // back past the exclude: undecided
    expect((await sheetJson(detail)).takeoff.decision).toBe('undecided');
    expect((await undo(detail)).statusCode).toBe(409); // nothing left to undo
    const history = await db
      .selectFrom('sheet_edits')
      .select(['editor', 'corrected_value', 'reason'])
      .where('sheet_id', '=', detail)
      .where('field_name', '=', 'takeoff')
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    expect(history.length).toBe(8); // nothing was deleted
    expect(history.some((h) => h.editor === 'carol' && h.reason?.startsWith('undo:'))).toBe(true);
  });

  it('the Excel lists the undecided sheets and who decided the others', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    const wb = await loadWorkbook(res.rawPayload);
    const ws = wb.getWorksheet('Sheets')!;
    const rows: unknown[][] = [];
    ws.eachRow(
      (r, n) => n > 1 && rows.push([r.getCell(1).value, r.getCell(4).value, r.getCell(5).value]),
    );
    expect(rows[0]).toEqual([1, 'in the takeoff', 'bob']);
    expect(rows[1][1]).toBe('UNDECIDED (in the totals by default)');
    const sum = wb.getWorksheet('Summary')!;
    const cells: string[] = [];
    sum.eachRow((r) => cells.push(String(r.getCell(1).value)));
    expect(cells).toContain('2 sheets undecided');
    expect(third).toBeTruthy();
  });

  it('rejects an unknown value and a blank name', async () => {
    expect((await decide(plan, 'maybe')).statusCode).toBe(400);
    expect((await decide(plan, 'include', '  ')).statusCode).toBe(400);
  });
});
