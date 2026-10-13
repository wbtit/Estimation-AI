import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { draftStatus, type SheetFlags } from '../review/flags.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

describe('draft status', () => {
  const sheet = (n: number, included: boolean, codes: number): SheetFlags => ({
    sheet_id: String(n),
    page_number: n,
    included,
    by_default: true,
    piece_count: 0,
    likely_not_framing: false,
    flags: Array.from({ length: codes }, () => ({ code: 'CLASSES_SUGGESTED', text: 'x' })),
    confirmed_by: null,
    confirmed_at: null,
  });
  it('is draft while any sheet has a flag and reviewed when none has', () => {
    expect(draftStatus([sheet(1, true, 2), sheet(2, false, 1), sheet(3, true, 0)])).toMatchObject({
      unconfirmed_sheets: 2,
      unconfirmed_included: 1,
      unconfirmed_excluded_by_default: 1,
      reviewed: false,
      label: 'draft, 2 sheets unconfirmed',
    });
    expect(draftStatus([sheet(1, true, 1)]).label).toBe('draft, 1 sheet unconfirmed');
    expect(draftStatus([sheet(1, true, 0)])).toMatchObject({ reviewed: true, label: 'reviewed' });
  });
});

describe('flags and one-click confirmation', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let plan: string;
  let detail: string;
  let raster: string;
  const box = JSON.stringify({ x0: 10, y0: 10, x1: 900, y1: 700 });
  const flags = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/flags` })).json();

  beforeAll(async () => {
    projectId = await insertProject(db);
    const size = { width_pt: 1200, height_pt: 800, page_kind: 'vector' as const };
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
    raster = await insertSheet(db, projectId, {
      page_index: 2,
      page_type_guess: 'framing_plan',
      width_pt: 1200,
      height_pt: 800,
      page_kind: 'scanned',
    });
    await db
      .insertInto('sheet_views')
      .values({ sheet_id: detail, box, scale_ratio: 96, structural_classes: ['x|black|solid'] })
      .execute();
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: plan,
        box,
        scale_ratio: 96,
        scale_source: 'detected_text',
        scale_confirmed: false,
        structural_classes: ['1.5-2.5|black|solid'],
        classes_confirmed: false,
        auto_created: true,
      })
      .execute();
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('lists a flag for every unconfirmed guess and labels the totals draft', async () => {
    const f = await flags();
    expect(f.draft).toMatchObject({ unconfirmed_sheets: 3, label: 'draft, 3 sheets unconfirmed' });
    const codes = (id: string) =>
      f.sheets
        .find((s: SheetFlags) => s.sheet_id === id)
        .flags.map((x: { code: string }) => x.code);
    expect(codes(plan)).toEqual([
      'SHEET_INCLUDED_BY_DEFAULT',
      'SCALE_GUESSED',
      'CLASSES_SUGGESTED',
    ]);
    // a vector sheet is in by default; a detail sheet only gets the "likely not framing" flag
    expect(codes(detail)).toEqual([
      'SHEET_INCLUDED_BY_DEFAULT',
      'LIKELY_NOT_FRAMING',
      'SCALE_GUESSED',
      'CLASSES_SUGGESTED',
    ]);
    expect(codes(raster)).toEqual(['SHEET_NOT_VECTOR']);
    const byId = (id: string) => f.sheets.find((s: SheetFlags) => s.sheet_id === id);
    expect([byId(detail).likely_not_framing, byId(plan).likely_not_framing]).toEqual([true, false]);
    expect([byId(plan).piece_count, byId(raster).included]).toEqual([0, false]);
    const takeoff = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })
    ).json();
    expect(takeoff.draft.label).toBe('draft, 3 sheets unconfirmed');
  });

  it('"these guesses are right" confirms scale, classes and the decision, and records who', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sheets/${plan}/confirm-guesses`,
      payload: { who: 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sheet).toMatchObject({ flags: [], confirmed_by: 'alice' });
    expect(res.json().draft.unconfirmed_sheets).toBe(2);
    const view = await db
      .selectFrom('sheet_views')
      .selectAll()
      .where('sheet_id', '=', plan)
      .executeTakeFirstOrThrow();
    expect([view.scale_confirmed, view.classes_confirmed]).toEqual([true, true]);
    const edits = await db
      .selectFrom('sheet_edits')
      .select(['field_name', 'editor', 'corrected_value'])
      .where('sheet_id', '=', plan)
      .orderBy('created_at')
      .execute();
    expect(edits.map((e) => [e.field_name, e.editor])).toEqual([
      ['takeoff', 'alice'],
      ['view_scale', 'alice'],
    ]);
    expect(edits[0]?.corrected_value).toBe('include');
  });

  it('confirms every sheet excluded by default in one call; the label becomes reviewed', async () => {
    // the detail sheet is in by default: its flags clear with its own confirmation
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sheets/${detail}/confirm-guesses`,
      payload: { who: 'bob' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/confirm-excluded-defaults`,
      payload: { who: 'bob' },
    });
    expect(res.json()).toMatchObject({
      confirmed: [3],
      draft: { reviewed: true, label: 'reviewed' },
    });
    const f = await flags();
    expect(f.sheets.every((s: SheetFlags) => s.flags.length === 0)).toBe(true);
  });

  it('refuses a blank name and an unknown sheet', async () => {
    const blank = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sheets/${plan}/confirm-guesses`,
      payload: { who: '   ' },
    });
    expect(blank.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sheets/00000000-0000-4000-8000-000000000000/confirm-guesses`,
      payload: { who: 'alice' },
    });
    expect(missing.statusCode).toBe(404);
  });
});
