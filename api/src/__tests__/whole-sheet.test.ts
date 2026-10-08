import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import {
  singleSheetScale,
  wholeSheetBox,
  WHOLE_SHEET_BORDER_FRACTION,
  WHOLE_SHEET_TITLE_STRIP_FRACTION,
} from '../review/geometry.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

describe('whole-sheet box and the sheet scale', () => {
  it('uses a fixed margin: border on every side and a title strip on the right', () => {
    const b = wholeSheetBox(2000, 1000);
    expect(b.x0).toBeCloseTo(2000 * WHOLE_SHEET_BORDER_FRACTION, 1);
    expect(b.y0).toBeCloseTo(1000 * WHOLE_SHEET_BORDER_FRACTION, 1);
    expect(b.x1).toBeCloseTo(2000 * (1 - WHOLE_SHEET_TITLE_STRIP_FRACTION), 1);
    expect(b.y1).toBeCloseTo(1000 * (1 - WHOLE_SHEET_BORDER_FRACTION), 1);
  });

  it('a single scale is offered; none, several and NTS are not', () => {
    const one = { raw: '1/8" = 1\'-0"', kind: 'ratio', ratio: 96, count: 3 };
    expect(singleSheetScale([one])).toEqual({ raw: one.raw, ratio: 96 });
    expect(singleSheetScale([])).toBeNull();
    expect(singleSheetScale([one, { ...one, raw: '1" = 20\'', ratio: 240 }])).toBeNull();
    expect(singleSheetScale([{ raw: 'NTS', kind: 'nts', ratio: null, count: 1 }])).toBeNull();
  });
});

describe('whole-sheet view route', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let oneScale: string;
  let twoScales: string;
  let noScale: string;
  const scale = (raw: string, ratio: number) => ({ raw, kind: 'ratio' as const, ratio, count: 1 });

  beforeAll(async () => {
    projectId = await insertProject(db);
    const size = { width_pt: 2448, height_pt: 1584 };
    oneScale = await insertSheet(db, projectId, {
      page_index: 0,
      scales: [scale('1/2" = 1\'-0"', 24)],
      ...size,
    });
    twoScales = await insertSheet(db, projectId, {
      page_index: 1,
      scales: [scale('1/2" = 1\'-0"', 24), scale('1/8" = 1\'-0"', 96)],
      ...size,
    });
    noScale = await insertSheet(db, projectId, { page_index: 2, ...size });
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  const create = (sheet: string, body: object) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sheets/${sheet}/views`,
      payload: { who: 'alice', ...body },
    });

  it('the sheet list says where the one-click offer is available', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/sheets` });
    const by = new Map(res.json().sheets.map((s: { id: string }) => [s.id, s]));
    expect(
      (by.get(oneScale) as { whole_sheet: { available: boolean } }).whole_sheet.available,
    ).toBe(true);
    expect(
      (by.get(twoScales) as { whole_sheet: { available: boolean } }).whole_sheet.available,
    ).toBe(false);
    expect((by.get(noScale) as { whole_sheet: { available: boolean } }).whole_sheet.available).toBe(
      false,
    );
  });

  it('creates the view with the margin box and suggests the sheet scale, still unconfirmed', async () => {
    const res = await create(oneScale, { whole_sheet: true });
    expect(res.statusCode).toBe(201);
    const v = res.json();
    expect(v.name).toBe('whole sheet');
    expect(v.box).toEqual(wholeSheetBox(2448, 1584));
    expect(v.scale.confirmed).toBe(false);
    expect(v.suggestion).toMatchObject({ ratio: 24, where: 'sheet', ambiguous: false });
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/views/${v.id}`,
      payload: { who: 'alice', scale: { action: 'confirm_suggestion' } },
    });
    expect(ok.json().scale).toMatchObject({ ratio: 24, confirmed: true, source: 'detected_text' });
  });

  it('refuses a sheet with several scales or none, and a call with neither box nor flag', async () => {
    expect((await create(twoScales, { whole_sheet: true })).statusCode).toBe(409);
    expect((await create(noScale, { whole_sheet: true })).statusCode).toBe(409);
    expect((await create(oneScale, {})).statusCode).toBe(400);
  });

  it('a drawn box still works and also gets the single sheet scale as a suggestion', async () => {
    const res = await create(oneScale, { box: { x0: 100, y0: 100, x1: 500, y1: 400 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().suggestion).toMatchObject({ ratio: 24, where: 'sheet' });
    const several = await create(twoScales, { box: { x0: 100, y0: 100, x1: 500, y1: 400 } });
    expect(several.json().suggestion).toBeNull();
  });
});
