import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
let projectId: string;
let sheetId: string;
let viewId: string; // scale 1/8" = 1'-0" confirmed
let unconfirmedViewId: string;
const ids: Record<string, string> = {};

const cand = (rank: number, y: number, score: number) => ({
  rank,
  p: [100, y],
  q: [700, y],
  score,
  dist: score,
  rel_angle: 0,
});

async function member(key: string, over: Record<string, unknown>) {
  const row = await db
    .insertInto('members')
    .values({
      project_id: projectId,
      sheet_id: sheetId,
      member_id: `M-${key}`,
      origin: 'extracted',
      type: 'beam',
      field_sources: '{}',
      field_confidence: '{}',
      source_bbox: JSON.stringify({ x0: 300, y0: 100, x1: 340, y1: 110 }),
      ...over,
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  ids[key] = row.id;
}

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1200, height_pt: 800 });
  await db
    .updateTable('sheets')
    .set({ level_guess: 'Second floor' })
    .where('id', '=', sheetId)
    .execute();
  const box = JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 });
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
  unconfirmedViewId = (
    await db
      .insertInto('sheet_views')
      .values({ sheet_id: sheetId, box })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const high = {
    view_id: viewId,
    link_confidence: 'high',
    profile_raw: 'W12x26',
    profile: 'W12X26',
  };
  await member('green', {
    ...high,
    link_candidates: JSON.stringify([cand(1, 120, 6), cand(2, 220, 100)]),
  });
  await member('amber', {
    ...high,
    link_confidence: 'medium',
    link_candidates: JSON.stringify([cand(1, 120, 6), cand(2, 150, 20)]),
  });
  await member('red', {
    ...high,
    link_confidence: 'low',
    link_candidates: JSON.stringify([cand(1, 120, 6)]),
  });
  await member('nolink', { ...high, link_confidence: 'low', link_candidates: JSON.stringify([]) });
  await member('noscale', {
    ...high,
    view_id: unconfirmedViewId,
    link_candidates: JSON.stringify([cand(1, 120, 6)]),
  });
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

const list = async (query = '') =>
  (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members${query}` })).json();
const byKey = (members: MemberView[], key: string): MemberView =>
  members.find((m) => m.id === ids[key]) as MemberView;

describe('members', () => {
  it('lists effective members with colors, lengths and the top candidates', async () => {
    const res = await list();
    expect(res.count).toBe(5);
    expect(res.colors).toEqual({ green: 1, amber: 1, red: 3 });
    const g = byKey(res.members, 'green');
    expect(g.status).toEqual({ color: 'green', confirmed: false, reasons: [] });
    // 600 pt of paper at 1/8" = 1'-0" is 600/72 in x 96 = 800 in = 66'-8"
    expect(g.length_mm).toBeCloseTo((600 * 25.4 * 96) / 72, 3);
    expect(g.length_ft_in).toBe('66\'-8"');
    expect(g.length_source).toBe('plan_geometry');
    expect(g.level).toBe('Second floor'); // from the sheet
    expect(g.link).toMatchObject({ source: 'rule', confidence: 'high', chosen_rank: 1 });
    expect(g.link.candidates).toHaveLength(2);
    expect(byKey(res.members, 'amber').status.reasons).toEqual(['link confidence medium']);
    expect(byKey(res.members, 'red').status.reasons).toEqual(['link confidence low']);
    expect(byKey(res.members, 'nolink').status.reasons).toEqual(['no candidate line']);
    const ns = byKey(res.members, 'noscale');
    expect(ns.status.reasons).toEqual(['scale of the view is not confirmed']);
    expect(ns.length_mm).toBeNull();
  });

  it('filters by view and sheet; unknown projects are 404', async () => {
    expect((await list(`?view_id=${unconfirmedViewId}`)).count).toBe(1);
    expect((await list(`?sheet_id=${sheetId}`)).count).toBe(5);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/projects/00000000-0000-4000-8000-000000000000/members',
    });
    expect(bad.statusCode).toBe(404);
  });

  it('applies the latest edit of each field and keeps the stored row unchanged', async () => {
    await db
      .insertInto('member_edits')
      .values([
        {
          member_id: ids.amber,
          field_name: 'profile_raw',
          original_value: '"W12x26"',
          corrected_value: '"W14x30"',
          review_status: 'edited',
          reviewer: 'a',
        },
        {
          member_id: ids.amber,
          field_name: 'profile',
          original_value: '"W12X26"',
          corrected_value: '"W14X30"',
          review_status: 'edited',
          reviewer: 'a',
        },
        {
          member_id: ids.amber,
          field_name: 'review_status',
          original_value: '"unreviewed"',
          corrected_value: '"approved"',
          review_status: 'approved',
          reviewer: 'a',
        },
      ])
      .execute();
    const m = byKey((await list()).members, 'amber');
    expect([m.profile_raw, m.profile, m.review_status]).toEqual(['W14x30', 'W14X30', 'approved']);
    expect(m.status).toEqual({ color: 'green', confirmed: true, reasons: [] });
    const row = await db
      .selectFrom('members')
      .select(['profile_raw', 'review_status'])
      .where('id', '=', ids.amber)
      .executeTakeFirstOrThrow();
    expect([row.profile_raw, row.review_status]).toEqual(['W12x26', 'unreviewed']); // original kept
  });

  it('a person-chosen line replaces the proposal and marks the link as theirs', async () => {
    await db
      .insertInto('member_edits')
      .values({
        member_id: ids.nolink,
        field_name: 'link',
        original_value: 'null',
        corrected_value: JSON.stringify({ line: { p: [100, 300], q: [400, 300] }, rank: null }),
        review_status: 'edited',
        reviewer: 'a',
      })
      .execute();
    const m = byKey((await list()).members, 'nolink');
    expect(m.link).toMatchObject({ source: 'person', chosen_rank: null });
    expect(m.length_mm).toBeCloseTo((300 * 25.4 * 96) / 72, 3);
    expect(m.status.color).toBe('green');
  });

  it('rejected members are hidden unless asked for', async () => {
    await db
      .insertInto('member_edits')
      .values({
        member_id: ids.red,
        field_name: 'review_status',
        original_value: '"unreviewed"',
        corrected_value: '"rejected"',
        review_status: 'rejected',
        reviewer: 'a',
      })
      .execute();
    expect((await list()).count).toBe(4);
    const all = await list('?include_deleted=true');
    expect(all.count).toBe(5);
    expect(byKey(all.members, 'red').deleted).toBe(true);
  });
});

describe('link job', () => {
  it('refuses to find members before the scale is confirmed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/views/${unconfirmedViewId}/link`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/confirm the scale/);
  });

  it('queues one job per view and reports its status', async () => {
    await db
      .insertInto('project_files')
      .values({
        project_id: projectId,
        original_filename: 'x.pdf',
        stored_path: 'x/y.pdf',
        sha256: '0'.repeat(64),
        size_bytes: 1,
        scan_status: 'done',
      })
      .execute();
    const first = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/views/${viewId}/link`,
    });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/views/${viewId}/link`,
    });
    expect([second.statusCode, second.json().job_id]).toEqual([409, first.json().job_id]);
    const status = (
      await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/views/${viewId}/link-status`,
      })
    ).json();
    expect(status.job).toMatchObject({ id: first.json().job_id, status: 'pending' });
    const none = (
      await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/views/${unconfirmedViewId}/link-status`,
      })
    ).json();
    expect(none.job).toBeNull();
    await db.deleteFrom('jobs').where('id', '=', first.json().job_id).execute();
  });
});
