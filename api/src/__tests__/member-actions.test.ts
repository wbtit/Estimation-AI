import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
let projectId: string;
let sheetId: string;
let viewId: string;
let noScaleView: string;

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1200, height_pt: 800 });
  const box = JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 });
  viewId = (
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheetId,
        box,
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  noScaleView = (
    await db
      .insertInto('sheet_views')
      .values({ sheet_id: sheetId, box })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

const post = (body: object) =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}/members`, payload: body });

describe('adding a column by hand', () => {
  it('stores the point in the view frame and is green with both elevations', async () => {
    const res = await post({
      view_id: viewId,
      type: 'column',
      mark: 'C1',
      profile_text: 'HSS 6 x 6 x 3/8',
      point: { x: 172, y: 628 },
      base_elevation: '0\'-0"',
      top_elevation: '12\'-6"',
      who: 'alice',
    });
    expect(res.statusCode).toBe(201);
    const m = res.json();
    expect(m).toMatchObject({
      type: 'column',
      mark: 'C1',
      profile_raw: 'HSS 6 x 6 x 3/8',
      profile: 'HSS6X6X3/8',
      origin: 'manual',
      length_source: 'manual',
    });
    expect(m.length_mm).toBeCloseTo(3810, 6);
    expect(m.status).toEqual({ color: 'green', confirmed: true, reasons: [] });
    // 72 pt right and 72 pt above the lower-left corner of the box, at 1/8" = 1'-0"
    expect(m.plan_point.x_mm).toBeCloseTo(2438.4, 1);
    expect(m.plan_point.y_mm).toBeCloseTo(2438.4, 1);
    const edits = await db
      .selectFrom('member_edits')
      .selectAll()
      .where('member_id', '=', m.id)
      .execute();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ field_name: '__created__', reviewer: 'alice' });
    expect(edits[0].action_id).toBeTruthy();
  });

  it('is red when the base elevation cannot be determined', async () => {
    const res = await post({
      view_id: viewId,
      type: 'column',
      mark: 'C2',
      profile_text: 'W10x33',
      point: { x: 300, y: 300 },
      top_elevation: '12\'-6"',
      who: 'alice',
    });
    expect(res.json().status).toMatchObject({
      color: 'red',
      reasons: ['column base elevation unknown'],
    });
    expect(res.json().length_mm).toBeNull();
  });

  it('keeps a profile that does not parse as typed, with no canonical profile', async () => {
    const res = await post({
      view_id: viewId,
      type: 'column',
      profile_text: 'TS6x6',
      point: { x: 300, y: 300 },
      base_elevation: '0 mm',
      top_elevation: '3000 mm',
      who: 'alice',
    });
    expect(res.json()).toMatchObject({ profile_raw: 'TS6x6', profile: null, length_mm: 3000 });
  });

  it('works in a view whose scale is not confirmed (a column needs no scale)', async () => {
    const res = await post({
      view_id: noScaleView,
      type: 'column',
      mark: 'C3',
      profile_text: 'W8x31',
      point: { x: 300, y: 300 },
      base_elevation: '0 mm',
      top_elevation: '4000 mm',
      who: 'alice',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status.color).toBe('green');
  });

  it('rejects points outside the view, bad elevations and unknown views', async () => {
    const outside = await post({
      view_id: viewId,
      type: 'column',
      point: { x: 50, y: 50 },
      who: 'a',
    });
    expect(outside.statusCode).toBe(400);
    const badElev = await post({
      view_id: viewId,
      type: 'column',
      point: { x: 300, y: 300 },
      base_elevation: 'high',
      who: 'a',
    });
    expect(badElev.statusCode).toBe(400);
    const none = await post({
      view_id: '00000000-0000-4000-8000-000000000000',
      type: 'column',
      point: { x: 300, y: 300 },
      who: 'a',
    });
    expect(none.statusCode).toBe(404);
  });
});
