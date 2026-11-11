// Phase 0-14g: Draw column lands on the symbol (SYNTHETIC rows only, test database; a stand-in
// worker completes the queued find_similar jobs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { SNAP_RADIUS_PT } from '../review/column-snap.js';
import { CLICK_PT } from '../review/find-similar.js';
import { type PieceView } from '../review/line-first-pieces.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the one snap radius', () => {
  it('is the value of schema/column-snap.json, used by the API lookup too', () => {
    const shared = JSON.parse(fs.readFileSync(path.join(root, 'schema/column-snap.json'), 'utf8'));
    expect(SNAP_RADIUS_PT).toBe(shared.snap_radius_pt);
    expect(SNAP_RADIUS_PT).toBe(14);
    expect(CLICK_PT).toBe(SNAP_RADIUS_PT);
  });
});

describe('Draw column snap (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let worker: ReturnType<typeof setInterval> | null = null;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const draw = async (payload: object) =>
    (
      await post(`/sheets/${sheetId}/line-first/pieces`, {
        who: WHO,
        kind: 'Column',
        symbol: 'hss_square',
        ...payload,
      })
    ).json() as PieceView;

  /** A stand-in worker: answers each find_similar job with an ink example whose centre is offset
   * from the click, or refuses it. */
  const startWorker = (refuse = false, rotation = 0, unchecked = false) => {
    worker = setInterval(() => {
      void (async () => {
        const jobs = await db
          .selectFrom('jobs')
          .select(['id', 'payload'])
          .where('type', '=', 'find_similar')
          .where('status', '=', 'pending')
          // only this file's sheet: another test file's stand-in worker must not take the job
          .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
          .execute();
        for (const j of jobs) {
          const [x, y] = (j.payload as { click: [number, number] }).click;
          const c: [number, number] = [x + 4, y + 3];
          const answer = refuse
            ? {
                example: null,
                note: 'click closer to the column symbol (size)',
                refused: 'click_closer',
              }
            : {
                example: {
                  source: 'ink',
                  family: 'unknown',
                  solid: null,
                  box: [c[0] - 3, c[1] - 3, c[0] + 3, c[1] + 3],
                  centre: c,
                  real_in: [11.5, 12.5],
                  angle: 0,
                  rect: [
                    [c[0] - 3, c[1] - 3],
                    [c[0] + 3, c[1] - 3],
                    [c[0] + 3, c[1] + 3],
                    [c[0] - 3, c[1] + 3],
                  ],
                },
                note: null,
                refused: null,
                // an unchecked ink read (main's example) carries no snap: the column stays put
                snap: unchecked ? null : { source: 'ink', centre: c, distance: 5 },
                warning: unchecked ? 'unchecked_ink' : null,
                angles: [0, 90, 40, 130],
                vector: 0,
                image: 1,
                combined: [{ centre: [x + 300, y], source: 'image', score: 0.9, rotation }],
                runtime_s: 0.4,
                settings: { image: true },
              };
          await db
            .updateTable('jobs')
            .set({ status: 'completed', result: JSON.stringify(answer) as never })
            .where('id', '=', j.id)
            .execute();
        }
      })();
    }, 50);
  };

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    await setFirstView(db, sheetId, {
      role_name: 'Foundation / column plan',
      box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
      scale_ratio: 96,
    });
    await db
      .updateTable('sheets')
      .set({ build_role: 'column_plan', build_scale_ratio: '96' } as never)
      .where('id', '=', sheetId)
      .execute();
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
    const sym = (cx: number, family: string, solid: string | null) => ({
      family,
      solid,
      box: [cx - 3, 97, cx + 3, 103],
      centre: [cx, 100],
      rotation_deg: 0,
      real_in: [16, 16],
    });
    await db
      .insertInto('page_symbols')
      .values({
        build_run_id: run.id,
        sheet_id: sheetId,
        ratio: 96,
        rules: 'five_families,known_only',
        symbols: JSON.stringify([
          sym(100, 'hss_square', null),
          sym(200, 'unknown', 'square'),
          sym(300, 'unknown', null), // not an example: neither a known family nor a solid shape
        ]),
      })
      .execute();
  });

  afterEach(() => {
    if (worker) clearInterval(worker);
    worker = null;
  });

  afterAll(async () => {
    await db
      .deleteFrom('jobs')
      .where('type', '=', 'find_similar')
      .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`) // not another file's in-flight job
      .execute();
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('GET column-symbols: the radius and only the symbols Find similar can use', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sheets/${sheetId}/column-symbols`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.snap_radius_pt).toBe(SNAP_RADIUS_PT);
    expect(body.symbols.map((s: { centre: number[] }) => s.centre)).toEqual([
      [100, 100],
      [200, 100],
    ]);
    expect(body.symbols[0]).toMatchObject({ family: 'hss_square', real_in: [16, 16] });
  });

  it('a drawn column keeps the snapped symbol size and logs how it was snapped', async () => {
    const p = await draw({
      a: [100, 100],
      real_in: [16, 16],
      rotation_deg: 40,
      snap: { source: 'symbol', distance: 5.5, snapped: true },
    });
    expect(p.symbol_real_in).toEqual([16, 16]);
    expect(p.rotation_deg).toBe(40);
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('member_id', '=', p.id)
      .where('action', '=', 'add')
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({
      kind: 'Column',
      snap: { source: 'symbol', distance: 5.5, snapped: true },
    });
    const bad = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [100, 100],
      snap: { source: 'wherever', snapped: true },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('nudges are one edit that logs how many arrow presses it sums up', async () => {
    const p = await draw({ a: [400, 400], snap: { source: 'none', snapped: false } });
    const res = await post(`/line-first/pieces/${p.id}/ends`, {
      who: WHO,
      a: [403, 398],
      b: null,
      nudges: 5,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().piece.a).toEqual([403, 398]);
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('member_id', '=', p.id)
      .where('action', '=', 'edit')
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({ fields: ['page_ends'], nudges: 5 });
  });

  it('an example read from ink moves the column onto the ink centre, logged, and shows its box', async () => {
    startWorker();
    const p = await draw({ a: [500, 500] });
    const res = await post(`/line-first/pieces/${p.id}/find-similar`, { who: WHO });
    expect(res.statusCode).toBe(200);
    const pv = res.json();
    expect(pv.snap).toEqual({ source: 'ink', centre: [504, 503], distance: 5, moved: true });
    expect(pv.example).toMatchObject({ source: 'ink', centre: [504, 503], angle: 0 });
    expect(pv.example.rect).toHaveLength(4);
    expect(pv.angles).toEqual([0, 90, 40, 130]);
    const moved = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sheets/${sheetId}/line-first`,
    });
    const piece = (moved.json().pieces as PieceView[]).find((q) => q.id === p.id)!;
    expect(piece.a).toEqual([504, 503]);
    expect(piece.symbol_real_in).toEqual([11.5, 12.5]); // an empty size is filled from the example
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('member_id', '=', p.id)
      .where('action', '=', 'edit')
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({
      snap: { source: 'ink', distance: 5, from: [500, 500], to: [504, 503] },
    });
  });

  it('an unchecked ink example answers 200 with the warning and does not move the column', async () => {
    startWorker(false, 0, true);
    const p = await draw({ a: [650, 150] });
    const res = await post(`/line-first/pieces/${p.id}/find-similar`, { who: WHO });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ warning: 'unchecked_ink', snap: null });
    const page = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sheets/${sheetId}/line-first`,
    });
    expect((page.json().pieces as PieceView[]).find((q) => q.id === p.id)!.a).toEqual([650, 150]);
  });

  it('snap:false (Shift placement, nudged) leaves the column where it is', async () => {
    startWorker();
    const p = await draw({ a: [600, 600], snap: { source: 'shift_off', snapped: false } });
    const pv = (
      await post(`/line-first/pieces/${p.id}/find-similar`, { who: WHO, snap: false })
    ).json();
    expect(pv.snap).toMatchObject({ source: 'ink', moved: false });
    const page = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sheets/${sheetId}/line-first`,
    });
    expect((page.json().pieces as PieceView[]).find((q) => q.id === p.id)!.a).toEqual([600, 600]);
  });

  it('a refused example answers 409 "click closer to the column symbol"', async () => {
    startWorker(true);
    const p = await draw({ a: [700, 700] });
    const res = await post(`/line-first/pieces/${p.id}/find-similar`, { who: WHO });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'click closer to the column symbol',
      code: 'click_closer',
    });
  });

  it('a match turned by a fractional angle is created at the drawn rotation plus that angle', async () => {
    startWorker(false, 140.5);
    const p = await draw({
      a: [800, 300],
      rotation_deg: 10,
      snap: { source: 'none', snapped: false },
    });
    const pv = (
      await post(`/line-first/pieces/${p.id}/find-similar`, { who: WHO, snap: false })
    ).json();
    const acc = await post(`/line-first/pieces/${p.id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      snap: false,
    });
    expect(acc.statusCode).toBe(200);
    const made = acc.json().pieces as PieceView[];
    expect(made).toHaveLength(1);
    expect(made[0]!.rotation_deg).toBeCloseTo(150.5, 5); // (10 + 140.5) mod 180
  });
});
