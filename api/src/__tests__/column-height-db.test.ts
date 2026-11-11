// Review 3 item 4: column height (BOM length of a column): top - base, the column's own height, the
// project default, else none. SYNTHETIC rows only, test database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { LineFirstBom } from '../review/line-first-bom.js';
import { columnHeight, type PieceView } from '../review/line-first-pieces.js';
import {
  loadWorkbook,
  deleteEdition,
  deleteProject,
  insertProject,
  insertSheet,
  setFirstView,
  uniqueLabel,
} from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';
const edition = uniqueLabel('column-height-test');
const MM_FT = 304.8;
const HSS = 'HSS6X6X5/16';
const HSS_LB_FT = 23.34; // AISC v16
const KG_PER_M_PER_LB_FT = 1.4881639435;

describe('column height precedence (pure)', () => {
  it('top - base, then the column, then the project default, else none (never invented)', () => {
    expect(columnHeight(4000, 1000, 3000, 2000)).toEqual({
      height_mm: 3000,
      height_source: 'schedule',
    });
    expect(columnHeight(null, null, 3000, 2000)).toEqual({
      height_mm: 3000,
      height_source: 'column',
    });
    expect(columnHeight(null, null, null, 2000)).toEqual({
      height_mm: 2000,
      height_source: 'project',
    });
    expect(columnHeight(null, null, null, null)).toEqual({ height_mm: null, height_source: null });
    // only one of top / base is no schedule; a top at or below the base is no schedule either
    expect(columnHeight(4000, null, null, 2000).height_source).toBe('project');
    expect(columnHeight(null, 0, null, null).height_mm).toBeNull();
    expect(columnHeight(1000, 4000, 3000, 2000).height_source).toBe('column');
  });
});

describe('column height (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let runId: string;
  const cols: string[] = [];
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
  const bom = async () => (await get('/line-first/bom')).json() as LineFirstBom;
  const rowOf = async (id: string) => (await bom()).rows.find((r) => r.piece_id === id)!;
  const height = (ids: string[], extra: object) =>
    post('/line-first/columns/height', { who: WHO, member_ids: ids, ...extra });
  const piece = async (id: string) =>
    ((await get(`/sheets/${sheetId}/line-first`)).json().pieces as PieceView[]).find(
      (p) => p.id === id,
    )!;

  beforeAll(async () => {
    process.env.CATALOG_EDITION = edition;
    await importCatalog(db, edition, [
      {
        shape_name: HSS,
        family: 'HSS',
        weight_kg_per_m: HSS_LB_FT * KG_PER_M_PER_LB_FT,
        weight_lb_per_ft: HSS_LB_FT,
        properties: {},
      },
    ]);
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    // a role that counts columns (whatever the column-plan role is called)
    const role = await db
      .selectFrom('role_names')
      .select('name')
      .where('behaviour', '=', 'column_plan')
      .orderBy('position')
      .executeTakeFirstOrThrow();
    await setFirstView(db, sheetId, {
      role_name: role.name,
      box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
      scale_ratio: 96,
    });
    const run = await db
      .insertInto('build_runs')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        requested_by: WHO,
        mode: 'person',
        status: 'done',
        finished_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    runId = run.id;
    for (const n of [1, 2, 3]) {
      const r = await db
        .insertInto('members')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          member_id: `LF-C-${n}`,
          origin: 'manual',
          type: 'column',
          kind: 'Column',
          build_run_id: runId,
          profile: HSS,
          profile_raw: HSS,
          size_state: 'sized',
          build_state: 'found',
          support_state: null,
          tag_prefix: 'C',
          tag_number: n,
          page_x0: 100 * n,
          page_y0: 100,
          start_x_mm: 1000 * n,
          start_y_mm: -1000,
          plan_scale_ratio: 96,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      cols.push(r.id);
    }
  });

  afterAll(async () => {
    delete process.env.CATALOG_EDITION;
    await deleteProject(db, projectId);
    await deleteEdition(db, edition);
    await closeDatabaseConnection();
  });

  it('no height anywhere: the length and the weight stay blank, never made up', async () => {
    const r = await rowOf(cols[0]!);
    expect(r.length_mm).toBeNull();
    expect(r.weight_lb).toBeNull();
    expect(r.length_source).toBeNull();
    expect((await bom()).totals.pieces_without_length).toBe(3);
    expect((await get('/column-height')).json()).toEqual({ default_height_mm: null });
  });

  it('project default: weight = AISC lb/ft x length (HSS6X6X5/16 at 12 ft = 23.34 x 12)', async () => {
    const res = await post('/column-height-default', { who: WHO, height_mm: 12 * MM_FT });
    expect(res.statusCode).toBe(200);
    expect(res.json().default_height_mm).toBeCloseTo(3657.6, 1);
    const r = await rowOf(cols[0]!);
    expect(r.length_mm).toBeCloseTo(12 * MM_FT, 1);
    expect(r.length_source).toBe('project');
    expect(r.unit_w_lb_ft).toBe(HSS_LB_FT);
    expect(r.weight_lb!).toBeCloseTo(HSS_LB_FT * 12, 0);
    expect((await bom()).totals.pieces_without_length).toBe(0);
    const log = await db
      .selectFrom('count_actions')
      .select(['who', 'detail'])
      .where('project_id', '=', projectId)
      .where('action', '=', 'project')
      .executeTakeFirstOrThrow();
    expect(log.who).toBe(WHO);
    expect(log.detail).toMatchObject({ change: 'default_column_height', from: null });
  });

  it('precedence: top - base beats the column height, which beats the project default', async () => {
    const own = await height([cols[0]!], { height_mm: 15 * MM_FT });
    expect(own.statusCode).toBe(200);
    expect((await rowOf(cols[0]!)).length_source).toBe('column');
    expect((await rowOf(cols[0]!)).length_mm).toBeCloseTo(15 * MM_FT, 1);
    expect((await rowOf(cols[1]!)).length_source).toBe('project'); // the others keep the default
    // top without base is no schedule
    await height([cols[0]!], { top_mm: 6000 });
    expect((await rowOf(cols[0]!)).length_source).toBe('column');
    // both set: height = top - base, whatever the override and the default say
    await height([cols[0]!], { base_mm: 1000 });
    const r = await rowOf(cols[0]!);
    expect(r.length_source).toBe('schedule');
    expect(r.length_mm).toBeCloseTo(5000, 1);
    expect(r.weight_lb!).toBeCloseTo(HSS_LB_FT * (5000 / MM_FT), 0);
    const p = await piece(cols[0]!);
    expect(p).toMatchObject({
      column_top_mm: 6000,
      column_base_mm: 1000,
      column_height_mm: 15 * MM_FT,
      height_mm: 5000,
      height_source: 'schedule',
    });
  });

  it('refuses a top at or below the base, and anything that is not a column', async () => {
    const bad = await height([cols[1]!], { top_mm: 1000, base_mm: 2000 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('bad_elevations');
    expect((await piece(cols[1]!)).column_top_mm).toBeNull();
    const none = await height([cols[1]!], { top_mm: 500 }); // base missing: allowed (no schedule)
    expect(none.statusCode).toBe(200);
    await height([cols[1]!], { top_mm: null });
    // a beam is not a column
    const beam = await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        member_id: 'LF-B-1',
        origin: 'extracted',
        type: 'beam',
        kind: 'Beams',
        build_run_id: runId,
        profile: HSS,
        size_state: 'sized',
        build_state: 'found',
        support_state: 'both',
        page_x0: 0,
        page_y0: 10,
        page_x1: 100,
        page_y1: 10,
        start_x_mm: 0,
        start_y_mm: 0,
        end_x_mm: 1000,
        end_y_mm: 0,
        plan_scale_ratio: 96,
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    const nb = await height([beam.id], { height_mm: 3000 });
    expect(nb.statusCode).toBe(409);
    expect(nb.json().code).toBe('not_a_column');
  });

  it('bulk edit: several columns set once, ONE recorded action, one Undo puts all back', async () => {
    const before = await Promise.all(cols.map((c) => piece(c)));
    const res = await height(cols, { height_mm: 20 * MM_FT });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(true);
    const actionId = res.json().action_id as string;
    expect(actionId).toBeTruthy();
    const edits = await db
      .selectFrom('member_edits')
      .select(['member_id', 'field_name'])
      .where('action_id', '=', actionId)
      .execute();
    expect(new Set(edits.map((e) => e.member_id))).toEqual(new Set(cols));
    expect(edits.every((e) => e.field_name === 'column_height')).toBe(true);
    const after = await Promise.all(cols.map((c) => piece(c)));
    expect(after.map((p) => p.column_height_mm)).toEqual([20 * MM_FT, 20 * MM_FT, 20 * MM_FT]);
    // logged
    const logged = await db
      .selectFrom('count_actions')
      .select('detail')
      .where('edit_action_id', '=', actionId)
      .executeTakeFirstOrThrow();
    expect(logged.detail).toMatchObject({ column_height: true, members: 3 });
    // the same value again changes nothing (no action)
    const same = await height(cols, { height_mm: 20 * MM_FT });
    expect(same.json()).toMatchObject({ changed: false, action_id: null });
    // undo: every column is as before
    expect((await post('/undo', { who: WHO })).statusCode).toBe(200);
    const undone = await Promise.all(cols.map((c) => piece(c)));
    expect(undone.map((p) => [p.column_height_mm, p.height_mm, p.height_source])).toEqual(
      before.map((p) => [p.column_height_mm, p.height_mm, p.height_source]),
    );
  });

  it('Excel: the length source is a column of the BOM (no height, project default, column, schedule)', async () => {
    await height(cols, { height_mm: null, top_mm: null, base_mm: null }); // a clean start
    await post('/column-height-default', { who: WHO, height_mm: 12 * MM_FT });
    await height([cols[1]!], { height_mm: 15 * MM_FT });
    await height([cols[2]!], { top_mm: 5000, base_mm: 1000 });
    const wb = await loadWorkbook((await get('/line-first/bom.xlsx')).rawPayload);
    const rows: unknown[][] = [];
    wb.getWorksheet('BOM')!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    const head = rows.find((l) => l[0] === 'Main')!;
    const at = head.indexOf('Length source');
    expect(at).toBeGreaterThan(0);
    const src = rows.filter((l) => l[1] === 'Column').map((l) => l[at]);
    expect(src).toEqual(['project default', 'column', 'schedule (top - base)']);
    await height(cols, { height_mm: null, top_mm: null, base_mm: null });
  });

  it('clearing: back to the project default; with no default the length is blank again', async () => {
    await height(cols, { height_mm: null, top_mm: null, base_mm: null });
    await post('/column-height-default', { who: WHO, height_mm: 12 * MM_FT });
    expect((await rowOf(cols[0]!)).length_source).toBe('project');
    const clear = await post('/column-height-default', { who: WHO, height_mm: null });
    expect(clear.json()).toEqual({ default_height_mm: null });
    for (const c of cols) {
      const r = await rowOf(c);
      expect(r.length_mm).toBeNull();
      expect(r.weight_lb).toBeNull();
      expect(r.length_source).toBeNull();
    }
    expect((await post('/column-height-default', { who: WHO, height_mm: 0 })).statusCode).toBe(400);
  });
});
