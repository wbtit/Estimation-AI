import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { inclusionOf } from '../review/takeoff-sheets.js';
import { deleteProject, insertProject, insertSheet, loadWorkbook } from './helpers.js';

describe('which sheets are in the takeoff', () => {
  it('only framing plans by default; a person switch wins both ways', () => {
    expect(inclusionOf('framing_plan', null)).toEqual({ included: true, source: 'default' });
    for (const t of [
      'foundation_plan',
      'elevation',
      'detail',
      'schedule_legend',
      'general_notes',
      'other',
      null,
    ]) {
      expect(inclusionOf(t, null)).toEqual({ included: false, source: 'default' });
    }
    expect(inclusionOf('detail', 'include')).toEqual({ included: true, source: 'person' });
    expect(inclusionOf('framing_plan', 'exclude')).toEqual({ included: false, source: 'person' });
  });
});

describe('sheet inclusion routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let plan: string;
  let detail: string;
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
  const patch = (sheet: string, value: string | null) =>
    app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/sheets/${sheet}/takeoff`,
      payload: { value, editor: 'alice' },
    });

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
    await addBeam(plan);
    detailView = await addBeam(detail);
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('the takeoff ignores a detail sheet, lists included and excluded sheets, and keeps its members stored', async () => {
    const t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    const by = new Map(t.sheets.map((s: { page_number: number }) => [s.page_number, s]));
    expect(by.get(1)).toMatchObject({
      included: true,
      source: 'default',
      page_type: 'framing_plan',
    });
    expect(by.get(2)).toMatchObject({ included: false, source: 'default', members_not_counted: 1 });
  });

  it('the link job is refused for a sheet that is not for takeoff, until a person includes it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/views/${detailView}/link`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('not for takeoff');
  });

  it('switching a sheet to include puts it in the takeoff; clearing restores the default', async () => {
    expect((await patch(detail, 'include')).statusCode).toBe(200);
    let t = await takeoff();
    expect(t.totals.pieces).toBe(2);
    expect(t.sheets.find((s: { page_number: number }) => s.page_number === 2)).toMatchObject({
      included: true,
      source: 'person',
    });
    const sheets = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets` })
    ).json().sheets;
    expect(sheets[1].takeoff).toMatchObject({ included: true, override: 'include' });
    expect((await patch(detail, null)).statusCode).toBe(200);
    t = await takeoff();
    expect(t.totals.pieces).toBe(1);
  });

  it('a framing plan can be switched out, and the xlsx has a Sheets list', async () => {
    await patch(plan, 'exclude');
    expect((await takeoff()).totals.pieces).toBe(0);
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    const ws = (await loadWorkbook(res.rawPayload)).getWorksheet('Sheets')!;
    expect(ws.getRow(2).getCell(4).value).toBe('No');
    expect(ws.getRow(2).getCell(5).value).toBe('person');
    expect((await patch(plan, null)).statusCode).toBe(200);
  });

  it('rejects an unknown value', async () => {
    expect((await patch(plan, 'maybe')).statusCode).toBe(400);
  });
});
