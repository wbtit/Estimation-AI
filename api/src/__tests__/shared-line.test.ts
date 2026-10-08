import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import { annotateSharedLines, isPossibleDuplicate, lineKey } from '../review/shared-line.js';
import { buildTakeoff } from '../review/takeoff.js';
import { REASONS, withSharedLine } from '../review/status.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const LINE = { p: [100, 100] as [number, number], q: [500, 100] as [number, number] };

function member(id: string, over: Partial<MemberView> = {}): MemberView {
  return {
    id,
    member_id: id,
    sheet_id: 's1',
    view_id: 'v1',
    origin: 'extracted',
    type: 'beam',
    mark: null,
    profile_raw: 'W12X26',
    profile: 'W12X26',
    quantity: 1,
    level: 'L1',
    deleted: false,
    review_status: 'unreviewed',
    bbox: null,
    mark_ref: { status: null, legend_row_id: null },
    link: {
      source: 'rule',
      confidence: 'high',
      margin: 50,
      line: LINE,
      chosen_rank: 1,
      candidates: [{ rank: 1, ...LINE, score: 5, dist: 5, rel_angle: 0, length_mm: 1 }],
    },
    length_mm: 3000,
    length_ft_in: null,
    length_source: 'plan_geometry',
    base_elevation_mm: null,
    top_elevation_mm: null,
    status: { color: 'green', confirmed: false, reasons: [] },
    system: null,
    human: 'unreviewed',
    joist_series: null,
    shared_line: null,
    shared_resolution: null,
    merged_into: null,
    not_member: null,
    plan_point: null,
    ...over,
  } as MemberView;
}

describe('shared line grouping', () => {
  it('the same line in either direction is one key; another sheet is another key', () => {
    expect(lineKey('s1', LINE)).toBe(lineKey('s1', { p: LINE.q, q: LINE.p }));
    expect(lineKey('s1', LINE)).not.toBe(lineKey('s2', LINE));
  });

  it('flags every member of a shared line amber and keeps the best-scoring one in the total', () => {
    const worse = member('b', {
      link: {
        ...member('b').link,
        candidates: [{ rank: 1, ...LINE, score: 30, dist: 30, rel_angle: 0, length_mm: 1 }],
      },
    });
    const better = member('a');
    const lone = member('c', {
      link: { ...member('c').link, line: { p: [0, 0], q: [10, 0] } },
    });
    const all = annotateSharedLines([worse, better, lone]);
    expect(better.shared_line).toMatchObject({ size: 2, best: true, resolved: false });
    expect(worse.shared_line).toMatchObject({ size: 2, best: false });
    expect(better.status.color).toBe('amber');
    expect(better.status.reasons).toContain(REASONS.sharedLine);
    expect(lone.shared_line).toBeNull();
    expect(lone.status.color).toBe('green');
    expect(all.filter(isPossibleDuplicate).map((m) => m.id)).toEqual(['b']);
  });

  it('a person link beats a rule link; high confidence beats medium', () => {
    const rule = member('r');
    const person = member('p', { link: { ...member('p').link, source: 'person' } });
    annotateSharedLines([rule, person]);
    expect(person.shared_line?.best).toBe(true);
    const med = member('m', { link: { ...member('m').link, confidence: 'medium' } });
    const high = member('h');
    annotateSharedLines([med, high]);
    expect(high.shared_line?.best).toBe(true);
  });

  it('red stays red; a confirmed member is still amber until the group is resolved', () => {
    expect(withSharedLine({ color: 'red', confirmed: false, reasons: ['x'] }).color).toBe('red');
    const m = member('a', { status: { color: 'green', confirmed: true, reasons: [] } });
    const n = member('b');
    annotateSharedLines([m, n]);
    expect(m.status).toMatchObject({ color: 'amber', confirmed: true });
  });

  it('nothing is flagged once every member of the group is "separate"', () => {
    const a = member('a', { shared_resolution: 'separate' });
    const b = member('b', { shared_resolution: 'separate' });
    annotateSharedLines([a, b]);
    expect(a.shared_line).toMatchObject({ resolved: true });
    expect(a.status.color).toBe('green');
    expect([a, b].some(isPossibleDuplicate)).toBe(false);
  });

  it('a new member joining a resolved group re-opens it', () => {
    const a = member('a', { shared_resolution: 'separate' });
    const b = member('b', { shared_resolution: 'separate' });
    const c = member('c');
    annotateSharedLines([a, b, c]);
    expect(a.shared_line?.resolved).toBe(false);
  });

  it('deleted, merged and not-a-member members do not count', () => {
    const a = member('a');
    const gone = member('d', { deleted: true });
    const merged = member('m', { merged_into: 'a' });
    const no = member('n', { not_member: { reason: 'existing' } });
    annotateSharedLines([a, gone, merged, no]);
    expect(a.shared_line).toBeNull();
  });

  it('takeoff: duplicates are held out of the main total on their own line, not deleted', () => {
    const a = member('a');
    const b = member('b', {
      link: {
        ...member('b').link,
        candidates: [{ rank: 1, ...LINE, score: 30, dist: 30, rel_angle: 0, length_mm: 1 }],
      },
    });
    annotateSharedLines([a, b]);
    const t = buildTakeoff([a, b], new Map([['s1', 3]]));
    expect(t.totals.pieces).toBe(1);
    expect(t.possible_duplicates.pieces).toBe(1);
    expect(t.possible_duplicates.total_length_mm).toBe(3000);
    expect(t.excluded_red.pieces).toBe(0);
    expect(t.rows.map((r) => r.kind)).toEqual(['main', 'duplicate']);
  });
});

describe('shared line routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let viewId: string;
  const ids: string[] = [];
  const line = { p: [200, 300], q: [600, 300] };

  const add = async (mark: string, profile: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: viewId,
        type: 'beam',
        mark,
        profile_text: profile,
        point: { x: 300, y: 300 },
        line,
        who: 'alice',
      },
    });
    expect(res.statusCode).toBe(201);
    ids.push(res.json().id);
  };
  const members = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members` })).json()
      .members as MemberView[];
  const takeoff = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })).json();
  const post = (id: string, body: object) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members/${id}/shared-line`,
      payload: { who: 'alice', ...body },
    });

  beforeAll(async () => {
    projectId = await insertProject(db);
    const sheetId = await insertSheet(db, projectId, {
      page_index: 0,
      page_type_guess: 'framing_plan',
      width_pt: 1200,
      height_pt: 800,
    });
    viewId = (
      await db
        .insertInto('sheet_views')
        .values({
          sheet_id: sheetId,
          box: JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 }),
          scale_ratio: 96,
          scale_source: 'user_confirmed',
          scale_confirmed: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await add('B1', 'W12x26');
    await add('B2', 'W10x12');
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('two members on one line are grouped and the second is a possible duplicate', async () => {
    const ms = await members();
    expect(ms.map((m) => m.shared_line?.size)).toEqual([2, 2]);
    expect(ms.every((m) => m.status.color === 'amber')).toBe(true);
    const t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(t.possible_duplicates.pieces).toBe(1);
    expect(ms.filter((m) => m.shared_line?.best)).toHaveLength(1);
  });

  it('"separate members" resolves the group for everybody, and an undo re-opens it', async () => {
    expect((await post(ids[0], { resolution: 'separate' })).statusCode).toBe(200);
    expect((await takeoff()).totals.pieces).toBe(2);
    expect((await members()).every((m) => m.shared_line?.resolved)).toBe(true);
    const undo = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect(undo.statusCode).toBe(200);
    expect((await takeoff()).totals.pieces).toBe(1);
  });

  it('a merge keeps one member and takes the other out of the takeoff; undo brings it back', async () => {
    const ms = await members();
    const best = ms.find((m) => m.shared_line?.best)!;
    const other = ms.find((m) => !m.shared_line?.best)!;
    const res = await post(other.id, { resolution: 'merge' });
    expect(res.statusCode).toBe(200);
    const after = await members();
    expect(after.find((m) => m.id === other.id)!.merged_into).toBe(best.id);
    expect(after.find((m) => m.id === best.id)!.shared_line).toBeNull();
    const t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(t.possible_duplicates.pieces).toBe(0);
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect((await takeoff()).possible_duplicates.pieces).toBe(1);
  });

  it('refuses a member that is not in a group, and an unknown member to keep', async () => {
    const bad = await post(ids[0], {
      resolution: 'merge',
      keep: '00000000-0000-4000-8000-000000000000',
    });
    expect(bad.statusCode).toBe(400);
  });
});
