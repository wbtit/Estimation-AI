import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import {
  annotateSharedLines,
  isPossibleDuplicate,
  lineKey,
  pieceQuantity,
} from '../review/shared-line.js';
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
    length_shared: false,
    shared_resolution: null,
    merged_into: null,
    not_member: null,
    existing: false,
    plan_point: null,
    ...over,
  } as MemberView;
}

describe('shared line grouping', () => {
  it('the same line in either direction is one key; another sheet is another key', () => {
    expect(lineKey('s1', LINE)).toBe(lineKey('s1', { p: LINE.q, q: LINE.p }));
    expect(lineKey('s1', LINE)).not.toBe(lineKey('s2', LINE));
  });

  it('flags every member of a shared line amber, ranks one best, and does not call them duplicates', () => {
    const worse = member('b', {
      profile: 'W10X12',
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
    expect(better.shared_line).toMatchObject({
      size: 2,
      best: true,
      resolved: false,
      duplicate_of: null,
    });
    expect(worse.shared_line).toMatchObject({ size: 2, best: false, duplicate_of: null });
    expect(better.status.color).toBe('amber');
    expect(better.status.reasons).toContain(REASONS.sharedLine);
    expect(lone.shared_line).toBeNull();
    expect(lone.status.color).toBe('green');
    // different profiles on one line are separate members: nobody is held out of the total
    expect(all.filter(isPossibleDuplicate)).toEqual([]);
  });

  it('the length of a member on a shared line is not trusted, unless a person typed it', () => {
    const a = member('a');
    const b = member('b', { profile: 'W10X12' });
    const typed = member('t', { profile: 'W8X10', length_source: 'manual' });
    const lone = member('c', { link: { ...member('c').link, line: { p: [0, 0], q: [10, 0] } } });
    annotateSharedLines([a, b, typed, lone]);
    expect([a.length_shared, b.length_shared, typed.length_shared, lone.length_shared]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  describe('true duplicate candidates: same line, same profile, labels at one spot', () => {
    const box = (x0: number, y0 = 100) => ({ x0, y0, x1: x0 + 40, y1: y0 + 8 }); // label height 8
    const pair = (a: object, b: object) => {
      const first = member('a', a);
      const second = member('b', b);
      annotateSharedLines([first, second]);
      return second.shared_line?.duplicate_of ?? null;
    };

    it('overlapping labels with the same profile', () => {
      expect(pair({ bbox: box(100) }, { bbox: box(110) })).toBe('a');
    });

    it('closer than 2 label heights (16 pt here) but not overlapping', () => {
      expect(pair({ bbox: box(100) }, { bbox: box(155) })).toBe('a'); // 15 pt gap
    });

    it('not when the gap is 2 label heights or more', () => {
      expect(pair({ bbox: box(100) }, { bbox: box(156) })).toBeNull(); // 16 pt gap
      expect(pair({ bbox: box(100) }, { bbox: box(400) })).toBeNull();
    });

    it('not with another profile, however close', () => {
      expect(pair({ bbox: box(100) }, { bbox: box(110), profile: 'W10X12' })).toBeNull();
    });

    it('a person saying "separate members" lifts it', () => {
      const a = member('a', { bbox: box(100), shared_resolution: 'separate' });
      const b = member('b', { bbox: box(110), shared_resolution: 'separate' });
      annotateSharedLines([a, b]);
      expect(b.shared_line?.duplicate_of).toBeNull();
      expect(isPossibleDuplicate(b)).toBe(false);
    });
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

  it('takeoff: one piece per linked line; the other labels on it are listed with 0 pieces', () => {
    const a = member('a', { quantity: 2 });
    const b = member('b', { profile: 'W10X12' });
    const lone = member('c', { link: { ...member('c').link, line: { p: [0, 0], q: [10, 0] } } });
    annotateSharedLines([a, b, lone]);
    const t = buildTakeoff([a, b, lone], new Map([['s1', 3]]));
    expect(t.totals.pieces).toBe(3); // the line of a and b (a carries it, quantity 2) + the lone line
    expect(t.totals.labels).toBe(4); // the older basis, one piece per label
    expect(t.totals.length_shared_pieces).toBe(2);
    expect(t.totals.total_length_mm).toBe(3000); // only the member alone on its line
    expect(t.possible_duplicates.pieces).toBe(0);
    const shared = t.rows.find((r) => r.profile === 'W10X12')!;
    expect(shared).toMatchObject({
      quantity: 0,
      labels: 1,
      members: 1,
      total_length_mm: null,
      length_shared_pieces: 0,
    });
    expect(shared.unit_lengths_mm).toEqual([]);
    expect(t.review.main_total_unreviewed.of_pieces).toBe(3);
  });

  describe('which label carries the piece of a line', () => {
    it('the best-ranked label that is not red; a red label never takes the piece', () => {
      const red = member('r', {
        link: { ...member('r').link, confidence: 'high' },
        status: { color: 'red', confirmed: false, reasons: ['x'] },
      });
      const ok = member('o', {
        profile: 'W10X12',
        link: { ...member('o').link, confidence: 'low' },
      });
      annotateSharedLines([red, ok]);
      expect(red.shared_line?.best).toBe(true); // ranked first ...
      expect(red.shared_line?.line_piece).toBe(false); // ... but red, so it does not carry the piece
      expect(ok.shared_line?.line_piece).toBe(true);
      const t = buildTakeoff([red, ok], new Map([['s1', 3]]));
      expect(t.totals.pieces).toBe(1);
      expect(t.excluded_red.pieces).toBe(0);
    });

    it('a line whose labels are all red keeps one red piece', () => {
      const r1 = member('r1', { status: { color: 'red', confirmed: false, reasons: ['x'] } });
      const r2 = member('r2', {
        profile: 'W10X12',
        status: { color: 'red', confirmed: false, reasons: ['x'] },
      });
      annotateSharedLines([r1, r2]);
      expect([r1, r2].filter((m) => m.shared_line?.line_piece)).toHaveLength(1);
      expect(buildTakeoff([r1, r2], new Map([['s1', 3]])).excluded_red.pieces).toBe(1);
    });

    it('a person saying "separate members" makes every label its own piece', () => {
      const a = member('a', { shared_resolution: 'separate' });
      const b = member('b', { profile: 'W10X12', shared_resolution: 'separate' });
      annotateSharedLines([a, b]);
      expect(buildTakeoff([a, b], new Map([['s1', 3]])).totals.pieces).toBe(2);
    });

    it('a typed length makes the label its own piece', () => {
      const a = member('a');
      const b = member('b', { profile: 'W10X12', length_source: 'manual' });
      annotateSharedLines([a, b]);
      expect(a.shared_line?.line_piece).toBe(true);
      expect(b.shared_line?.line_piece).toBe(true);
      expect(buildTakeoff([a, b], new Map([['s1', 3]])).totals.pieces).toBe(2);
    });

    it('existing steel never carries the piece of a line that has a new label', () => {
      const old = member('e', {
        existing: true,
        link: { ...member('e').link, confidence: 'high' },
      });
      const fresh = member('f', {
        profile: 'W10X12',
        link: { ...member('f').link, confidence: 'low' },
      });
      annotateSharedLines([old, fresh]);
      expect(fresh.shared_line?.line_piece).toBe(true);
      expect(old.shared_line?.line_piece).toBe(false);
      const t = buildTakeoff([old, fresh], new Map([['s1', 3]]));
      expect(t.totals.pieces).toBe(1);
      expect(t.existing.totals.pieces).toBe(1); // existing steel is listed with its labels
    });

    it('a label alone on its line counts its full quantity', () => {
      const a = member('a', { quantity: 3 });
      annotateSharedLines([a]);
      expect(pieceQuantity(a)).toBe(3);
    });
  });

  it('takeoff: a true duplicate candidate is held out of the main total on its own line, not deleted', () => {
    const bbox = { x0: 100, y0: 100, x1: 140, y1: 108 };
    const a = member('a', { bbox });
    const b = member('b', { bbox: { ...bbox, x0: 105, x1: 145 } });
    annotateSharedLines([a, b]);
    const t = buildTakeoff([a, b], new Map([['s1', 3]]));
    expect(t.totals.pieces).toBe(1);
    expect(t.possible_duplicates.pieces).toBe(1);
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
      decided: 'include',
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
  });

  it('two members on one line are grouped; ONE piece counts (the line), their length does not', async () => {
    const ms = await members();
    expect(ms.map((m) => m.shared_line?.size)).toEqual([2, 2]);
    expect(ms.every((m) => m.status.color === 'amber' && m.length_shared)).toBe(true);
    expect(ms.filter((m) => m.shared_line?.best)).toHaveLength(1);
    const t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(t.totals.labels).toBe(2);
    expect(t.totals.length_shared_pieces).toBe(1);
    expect(t.totals.total_length_mm).toBe(0);
    expect(t.possible_duplicates.pieces).toBe(0);
  });

  it('the sheet list counts the same basis: one piece for the shared line', async () => {
    const f = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/flags` })).json();
    const total = f.sheets.reduce(
      (n: number, sh: { piece_count: number }) => n + sh.piece_count,
      0,
    );
    expect(total).toBe(1);
  });

  it('"separate members" lifts the amber flag for everybody (the length stays untrusted); undo re-opens it', async () => {
    expect((await post(ids[0], { resolution: 'separate' })).statusCode).toBe(200);
    let ms = await members();
    expect(ms.every((m) => m.shared_line?.resolved && m.status.color === 'green')).toBe(true);
    expect(ms.every((m) => m.length_shared)).toBe(true);
    expect((await takeoff()).totals.pieces).toBe(2); // every label is its own piece once a person says so
    const undo = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect(undo.statusCode).toBe(200);
    ms = await members();
    expect(ms.every((m) => m.status.color === 'amber')).toBe(true);
  });

  it('a merge keeps one member and takes the other out of the takeoff; the kept length is trusted; undo brings it back', async () => {
    const ms = await members();
    const best = ms.find((m) => m.shared_line?.best)!;
    const other = ms.find((m) => !m.shared_line?.best)!;
    const res = await post(other.id, { resolution: 'merge' });
    expect(res.statusCode).toBe(200);
    const after = await members();
    expect(after.find((m) => m.id === other.id)!.merged_into).toBe(best.id);
    expect(after.find((m) => m.id === best.id)!.shared_line).toBeNull();
    expect(after.find((m) => m.id === best.id)!.length_shared).toBe(false);
    const t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(t.totals.length_shared_pieces).toBe(0);
    expect(t.totals.total_length_mm).toBeGreaterThan(0);
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect((await takeoff()).totals.pieces).toBe(1); // still one piece for the one line
  });

  it('refuses a member that is not in a group, and an unknown member to keep', async () => {
    const bad = await post(ids[0], {
      resolution: 'merge',
      keep: '00000000-0000-4000-8000-000000000000',
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('true duplicate candidates through the routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  const ids: Record<string, string> = {};
  const cand = [{ rank: 1, p: [100, 400], q: [700, 400], score: 5, dist: 5, rel_angle: 0 }];

  const insert = async (
    key: string,
    sheetId: string,
    viewId: string,
    x0: number,
    profile: string,
  ) => {
    const row = await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        view_id: viewId,
        member_id: `M-${key}`,
        origin: 'extracted',
        type: 'beam',
        profile_raw: profile,
        profile: profile.toUpperCase(),
        field_sources: '{}',
        field_confidence: '{}',
        source_bbox: JSON.stringify({ x0, y0: 380, x1: x0 + 40, y1: 388 }),
        link_confidence: 'high',
        link_candidates: JSON.stringify(cand),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    ids[key] = row.id;
  };
  const takeoff = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })).json();
  const post = (id: string, body: object) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members/${id}/shared-line`,
      payload: { who: 'alice', ...body },
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
      decided: 'include',
      width_pt: 1200,
      height_pt: 800,
    });
    const viewId = (
      await db
        .insertInto('sheet_views')
        .values({
          sheet_id: sheetId,
          box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
          scale_ratio: 96,
          scale_source: 'user_confirmed',
          scale_confirmed: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await insert('a', sheetId, viewId, 300, 'W12x26');
    await insert('twin', sheetId, viewId, 310, 'W12x26'); // same line, same profile, overlapping label
    await insert('far', sheetId, viewId, 600, 'W12x26'); // same profile, far along the line
    await insert('other', sheetId, viewId, 305, 'W10x12'); // other profile at the same spot
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
  });

  it('only the twin is held out of the main total; the other three share the one piece of the line', async () => {
    const t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(t.totals.labels).toBe(3);
    expect(t.possible_duplicates.pieces).toBe(1);
    expect(t.totals.length_shared_pieces).toBe(1);
    const twin = t.rows.find((r: { kind: string }) => r.kind === 'duplicate');
    expect(twin.member_ids).toEqual([ids.twin]);
  });

  it('"separate members" brings the twin into the total; an undo holds it out again', async () => {
    expect((await post(ids.twin, { resolution: 'separate' })).statusCode).toBe(200);
    let t = await takeoff();
    expect(t.totals.pieces).toBe(4); // "separate members" resolves the whole line: every label is a piece
    expect(t.possible_duplicates.pieces).toBe(0);
    expect((await undo()).statusCode).toBe(200);
    t = await takeoff();
    expect(t.possible_duplicates.pieces).toBe(1);
  });

  it('a merge takes the twin out of the takeoff altogether', async () => {
    expect((await post(ids.twin, { resolution: 'merge', keep: ids.a })).statusCode).toBe(200);
    const t = await takeoff();
    expect(t.possible_duplicates.pieces).toBe(0);
    expect(t.totals.pieces).toBe(1); // a, far and other still share the one line
    expect(t.totals.labels).toBe(3);
    expect((await undo()).statusCode).toBe(200);
    expect((await takeoff()).possible_duplicates.pieces).toBe(1);
  });
});

afterAll(async () => {
  await closeDatabaseConnection();
});
