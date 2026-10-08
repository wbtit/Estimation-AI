import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

describe('"not a member"', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let a: string;
  let b: string;

  const add = async (y: number) => {
    const sheetId = (
      await db
        .selectFrom('sheets')
        .select('id')
        .where('project_id', '=', projectId)
        .executeTakeFirstOrThrow()
    ).id;
    const view = await db
      .selectFrom('sheet_views')
      .select('id')
      .where('sheet_id', '=', sheetId)
      .executeTakeFirstOrThrow();
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: view.id,
        type: 'beam',
        profile_text: 'W12x26',
        point: { x: 300, y },
        line: { p: [200, y], q: [600, y] },
        who: 'alice',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };
  const list = async (q = '') =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members${q}` })).json()
      .members as MemberView[];
  const flag = (id: string, reason: string | null) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members/${id}/not-member`,
      payload: { who: 'alice', reason },
    });
  const undo = () =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });

  beforeAll(async () => {
    projectId = await insertProject(db);
    const sheetId = await insertSheet(db, projectId, {
      page_index: 0,
      page_type_guess: 'framing_plan',
      width_pt: 1200,
      height_pt: 800,
    });
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheetId,
        box: JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 }),
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .execute();
    a = await add(300);
    b = await add(400);
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('takes the member out of the list, the counts and the takeoff, keeping it stored', async () => {
    const stored = () =>
      db
        .selectFrom('members')
        .select(['review_status', 'profile_raw'])
        .where('id', '=', a)
        .executeTakeFirstOrThrow();
    const before = await stored();
    expect((await flag(a, 'existing')).statusCode).toBe(200);
    expect((await list()).map((m) => m.id)).toEqual([b]);
    const all = await list('?include_deleted=true');
    expect(all.find((m) => m.id === a)?.not_member).toEqual({ reason: 'existing' });
    const t = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })
    ).json();
    expect(t.totals.pieces).toBe(1);
    expect(await stored()).toEqual(before); // the stored row is untouched
  });

  it('is in the corrections export with its reason, and an undo brings the member back', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/corrections.jsonl`,
    });
    const lines = res.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const mine = lines.find((l) => l.final.not_member !== null);
    expect(mine.final.not_member).toEqual({ reason: 'existing' });
    expect(mine.edits.some((e: { field: string }) => e.field === 'not_member')).toBe(true);
    expect((await undo()).statusCode).toBe(200);
    expect((await list()).map((m) => m.id).sort()).toEqual([a, b].sort());
  });

  it('only the four reasons are accepted; null takes the flag off', async () => {
    expect((await flag(a, 'because')).statusCode).toBe(400);
    expect((await flag(a, 'misc_steel')).statusCode).toBe(200);
    expect((await flag(a, null)).statusCode).toBe(200);
    expect((await list()).map((m) => m.id).sort()).toEqual([a, b].sort());
    expect((await flag(a, null)).json().changed).toBe(false);
  });
});
