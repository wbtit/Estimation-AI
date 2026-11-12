// Phase 0 column orientation: stored, read per match, set by a person, undone, backfilled; the capture
// box reaches the job; unknown 45 degree squares are capture targets (SYNTHETIC rows, test database;
// a stand-in worker completes the queued find_similar jobs).
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { type PieceView } from '../review/line-first-pieces.js';
import {
  applyOrientationBackfill,
  planOrientationBackfill,
} from '../review/orientation-backfill.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';
const RATIO = 96; // 1 pt = 96 / 72 real inches: a W12X53 (10 x 12.1 in) is 7.5 x 9.1 pt

/** A W drawn as three strokes (two flanges and a web) with its web vertical or horizontal. */
function w3(cx: number, cy: number, web: 'vertical' | 'horizontal'): number[][] {
  const bf = 3.75;
  const d = 4.55;
  const row = (a: number, b: number, c: number, e: number) => [a, b, c, e, 5, 1.08, 3, 0];
  return web === 'vertical'
    ? [
        row(cx - bf, cy - d, cx + bf, cy - d),
        row(cx - bf, cy + d, cx + bf, cy + d),
        row(cx, cy - d, cx, cy + d),
      ]
    : [
        row(cx - d, cy - bf, cx - d, cy + bf),
        row(cx + d, cy - bf, cx + d, cy + bf),
        row(cx - d, cy, cx + d, cy),
      ];
}

describe('column orientation (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let worker: ReturnType<typeof setInterval> | null = null;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const page = async () =>
    (
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${projectId}/sheets/${sheetId}/line-first`,
        })
      ).json() as {
        pieces: PieceView[];
      }
    ).pieces;
  const draw = async (payload: object) =>
    (
      await post(`/sheets/${sheetId}/line-first/pieces`, {
        who: WHO,
        kind: 'Column',
        symbol: 'w_shape',
        ...payload,
      })
    ).json() as PieceView;

  /** A stand-in worker: two image matches (a W with its web vertical, a W with its web horizontal). */
  const startWorker = () => {
    worker = setInterval(() => {
      void (async () => {
        const jobs = await db
          .selectFrom('jobs')
          .select(['id', 'payload'])
          .where('type', '=', 'find_similar')
          .where('status', '=', 'pending')
          .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
          .execute();
        for (const j of jobs) {
          const [x, y] = (j.payload as { click: [number, number] }).click;
          const answer = {
            example: {
              source: 'ink',
              family: 'unknown',
              solid: null,
              box: [x - 4, y - 5, x + 4, y + 5],
              centre: [x, y],
              real_in: [10, 12],
              angle: 0,
              rect: [],
            },
            note: null,
            refused: null,
            snap: null,
            warning: 'unchecked_ink',
            angles: [0, 90],
            vector: 0,
            image: 2,
            combined: [
              { centre: [200, 100], source: 'image', score: 0.95, rotation: 0 },
              { centre: [300, 100], source: 'image', score: 0.9, rotation: 90 },
            ],
            runtime_s: 0.1,
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
      scale_ratio: RATIO,
    });
    await db
      .updateTable('sheets')
      .set({ build_role: 'column_plan', build_scale_ratio: String(RATIO) } as never)
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
    const sym = (cx: number, cy: number, family: string, real: number[], rot: number) => ({
      family,
      solid: null,
      box: [
        cx - real[0]! * 0.375,
        cy - real[1]! * 0.375,
        cx + real[0]! * 0.375,
        cy + real[1]! * 0.375,
      ],
      centre: [cx, cy],
      rotation_deg: rot,
      real_in: real,
    });
    await db
      .insertInto('page_symbols')
      .values({
        build_run_id: run.id,
        sheet_id: sheetId,
        ratio: RATIO,
        rules: 'five_families',
        symbols: JSON.stringify([
          sym(100, 100, 'w_shape', [10, 12], 0),
          sym(500, 300, 'unknown', [30, 30], 45), // a plate / pier turned 45 degrees: a capture target
          sym(600, 300, 'unknown', [30, 18], 45), // not square
          sym(700, 300, 'unknown', [30, 30], 0), // not turned
        ]),
      })
      .execute();
    await db
      .insertInto('sheet_lines')
      .values({
        sheet_id: sheetId,
        classes: JSON.stringify(['k']),
        n_lines: 9,
        version: 'v',
        lines: JSON.stringify([
          ...w3(100, 100, 'vertical'),
          ...w3(200, 100, 'vertical'),
          ...w3(300, 100, 'horizontal'),
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
      .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
      .execute();
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('column-symbols flags the unknown 45 degree square, and only it, as a capture target', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/sheets/${sheetId}/column-symbols`,
    });
    const body = res.json() as {
      symbols: { centre: number[]; family: string; square45: boolean }[];
    };
    const centres = body.symbols.map((s) => s.centre[0]);
    expect(centres).toEqual([100, 500]); // the known W and the 45 degree square; not the other two
    expect(body.symbols.find((s) => s.centre[0] === 500)).toMatchObject({
      family: 'unknown',
      square45: true,
    });
  });

  it('a drawn column stores its orientation, source and state, derives the marker rotation, and logs the timing', async () => {
    const p = await draw({
      a: [100, 100],
      orientation_deg: 90,
      orientation_state: 'clear',
      timing: { click_to_marker_ms: 3.4 },
      rotation_deg: 77,
    });
    expect(p).toMatchObject({
      orientation_deg: 90,
      orientation_state: 'clear',
      orientation_source: 'click',
      rotation_deg: 0,
    });
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('member_id', '=', p.id)
      .where('action', '=', 'add')
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({
      orientation: { deg: 90, state: 'clear' },
      click_to_marker_ms: 3.4,
    });
    const bad = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [1, 1],
      orientation_deg: 400,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('every match is read from its own lines: vertical and horizontal W columns each get their own orientation', async () => {
    startWorker();
    const ex = await draw({ a: [100, 100], orientation_deg: 90, orientation_state: 'clear' });
    const pv = (
      await post(`/line-first/pieces/${ex.id}/find-similar`, {
        who: WHO,
        snap: false,
        box: [96, 95, 104, 105],
      })
    ).json();
    expect(pv.matches).toMatchObject([
      { centre: [200, 100], orientation_deg: 90, orientation_state: 'clear' },
      { centre: [300, 100], orientation_deg: 0, orientation_state: 'clear' },
    ]);
    expect(pv.orientation_ms).toBeLessThan(500);
    const job = await db
      .selectFrom('jobs')
      .select(['payload'])
      .where('id', '=', pv.run_id)
      .executeTakeFirstOrThrow();
    expect(job.payload).toMatchObject({ box: [96, 95, 104, 105] }); // the worker searches exactly this box
    const acc = await post(`/line-first/pieces/${ex.id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      snap: false,
      box: [96, 95, 104, 105],
      timing: { find_similar_ms: 412 },
    });
    const made = (acc.json().pieces as PieceView[]).sort((p, q) => p.a![0] - q.a![0]);
    expect(
      made.map((q) => [
        q.a,
        q.orientation_deg,
        q.orientation_state,
        q.orientation_source,
        q.rotation_deg,
      ]),
    ).toEqual([
      [[200, 100], 90, 'clear', 'match', 0],
      [[300, 100], 0, 'clear', 'match', 90],
    ]);
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('action', '=', 'find_similar')
      .where('member_id', '=', ex.id)
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({
      orientation: { clear: 2, unsure: 0 },
      find_similar_ms: 412,
      box: [96, 95, 104, 105],
    });
  });

  it('R / Shift+R turn a selection by 90 / 15 degrees as ONE recorded action and undo restores them', async () => {
    const a = await draw({ a: [400, 400], orientation_deg: 90, orientation_state: 'clear' });
    const b = await draw({ a: [450, 400], orientation_deg: 0, orientation_state: 'unsure' });
    const r90 = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [a.id, b.id],
      rotate_deg: 90,
    });
    expect(r90.statusCode).toBe(200);
    const after = r90.json().pieces as PieceView[];
    const by = (id: string) => after.find((q) => q.id === id)!;
    expect(by(a.id)).toMatchObject({
      orientation_deg: 0,
      orientation_state: 'manual',
      orientation_source: 'manual',
      rotation_deg: 90,
    });
    expect(by(b.id)).toMatchObject({
      orientation_deg: 90,
      orientation_state: 'manual',
      rotation_deg: 0,
    });
    const edits = await db
      .selectFrom('member_edits')
      .select(['action_id', 'field_name'])
      .where('member_id', 'in', [a.id, b.id])
      .where('field_name', '=', 'orientation')
      .execute();
    expect(new Set(edits.map((e) => e.action_id)).size).toBe(1); // one action for the selection
    const r15 = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [a.id],
      rotate_deg: 15,
    });
    expect((r15.json().pieces as PieceView[])[0]).toMatchObject({ orientation_deg: 165 });
    const set = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [a.id],
      orientation_deg: 33,
    });
    expect((set.json().pieces as PieceView[])[0]).toMatchObject({
      orientation_deg: 33,
      orientation_state: 'manual',
    });
    // undo walks back: the absolute set, the 15 degree turn, then the 90 degree turn of both
    for (let i = 0; i < 3; i++) expect((await post('/undo', { who: WHO })).statusCode).toBe(200);
    const back = await page();
    expect(back.find((q) => q.id === a.id)).toMatchObject({
      orientation_deg: 90,
      orientation_state: 'clear',
      orientation_source: 'click',
      rotation_deg: 0,
    });
    expect(back.find((q) => q.id === b.id)).toMatchObject({
      orientation_deg: 0,
      orientation_state: 'unsure',
    });
  });

  it('a round HSS has no orientation and R leaves it alone', async () => {
    const r = await draw({ a: [550, 400], symbol: 'hss_round', rotation_deg: 0 });
    const res = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [r.id],
      rotate_deg: 90,
    });
    expect((res.json().pieces as PieceView[])[0]).toMatchObject({ orientation_deg: null });
  });

  it('the backfill reads an empty orientation from the page lines, never overwrites, and says so', async () => {
    const legacy = await draw({ a: [200, 100], rotation_deg: 0 }); // no orientation stored: web vertical in the drawing
    const manual = await draw({ a: [300, 100], rotation_deg: 0 });
    await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [manual.id],
      orientation_deg: 150,
    }); // a person's value
    const plan = await planOrientationBackfill(db, projectId);
    const row = (id: string) => plan.find((r) => r.id === id)!;
    expect(row(legacy.id).would_store).toEqual({ deg: 90, state: 'clear' });
    expect(row(manual.id).edited).toBe(true);
    const n = await applyOrientationBackfill(db, projectId, plan);
    expect(n).toBeGreaterThanOrEqual(1);
    const now = await page();
    expect(now.find((q) => q.id === legacy.id)).toMatchObject({
      orientation_deg: 90,
      orientation_state: 'clear',
      orientation_source: 'backfill',
    });
    expect(now.find((q) => q.id === manual.id)).toMatchObject({
      orientation_deg: 150,
      orientation_source: 'manual',
    });
    expect(
      await applyOrientationBackfill(db, projectId, await planOrientationBackfill(db, projectId)),
    ).toBe(0); // nothing left to fill
  });
});
