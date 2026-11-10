// Phase 0 orientation fixes: a match's centre is refined to its symbol's own centre (2.5 to 5 in, never
// otherwise), the backfill's size hint is the column's OWN symbol only, and near-axis manual values
// are normalised only on a person's yes (preview first; one undoable action). SYNTHETIC, test database.
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { type PieceView } from '../review/line-first-pieces.js';
import { planOrientationBackfill, planOrientationPoints } from '../review/orientation-backfill.js';
import { applyNormalise, planNormalise } from '../review/orientation-normalise.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';
const RATIO = 96; // 1 pt = 1.33 in real; a W12X53 is 7.5 x 9.1 pt

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

describe('orientation fixes (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let worker: ReturnType<typeof setInterval> | null = null;
  let matchCentres: [number, number][] = [];
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const draw = async (payload: object) =>
    (
      await post(`/sheets/${sheetId}/line-first/pieces`, {
        who: WHO,
        kind: 'Column',
        symbol: 'w_shape',
        ...payload,
      })
    ).json() as PieceView;

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
            image: matchCentres.length,
            combined: matchCentres.map((centre) => ({
              centre,
              source: 'image',
              score: 0.9,
              rotation: 0,
            })),
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
      role_name: 'Column plan',
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
    // a stored HSS 8 x 4 in pair 3 pt from the W at (200, 100): a NEIGHBOUR, not the column's own symbol
    await db
      .insertInto('page_symbols')
      .values({
        build_run_id: run.id,
        sheet_id: sheetId,
        ratio: RATIO,
        rules: 'five_families',
        symbols: JSON.stringify([
          {
            family: 'hss_rect',
            solid: null,
            box: [201, 98, 205, 102],
            centre: [203, 100],
            rotation_deg: 0,
            real_in: [4, 8],
          },
        ]),
      })
      .execute();
    await db
      .insertInto('sheet_lines')
      .values({
        sheet_id: sheetId,
        classes: JSON.stringify(['k']),
        n_lines: 6,
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

  it('a match is refined to its symbol centre only when 2.5 to 5 in off; the centre is logged', async () => {
    startWorker();
    // offsets in pt at 1 pt = 1.33 in: 2.5 pt = 3.3 in (refine), 0.6 pt = 0.8 in (already right), 205 = 6.7 in off the W at 200 (a different object: left)
    matchCentres = [
      [202.5, 100],
      [300.6, 100],
      [205, 100],
    ];
    const ex = await draw({ a: [100, 100], orientation_deg: 90, orientation_state: 'clear' });
    const pv = (
      await post(`/line-first/pieces/${ex.id}/find-similar`, { who: WHO, snap: false })
    ).json();
    const by = (x: number) =>
      (pv.matches as { centre: number[] }[]).find((m) => Math.abs(m.centre[0]! - x) < 0.7)!;
    expect(pv.refined).toBe(1);
    expect(pv.matches.map((m: { centre: number[] }) => m.centre[0]).sort()).toEqual([
      200, 205, 300.6,
    ]); // 202.5 -> 200
    expect(by(200)).toMatchObject({ orientation_deg: 90, orientation_state: 'clear' });
    const acc = await post(`/line-first/pieces/${ex.id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      snap: false,
    });
    const made = (acc.json().pieces as PieceView[]).map((p) => p.a![0]).sort();
    expect(made).toEqual([200, 205, 300.6]);
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('action', '=', 'find_similar')
      .where('member_id', '=', ex.id)
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({ refined: 1 });
  });

  it("the backfill never takes a neighbour's size: the 8 x 4 in HSS beside a W does not change its reading", async () => {
    const c = await draw({ a: [200, 100], rotation_deg: 0 }); // legacy: no orientation stored
    const row = (await planOrientationBackfill(db, projectId)).find((r) => r.id === c.id)!;
    expect(row.would_store).toEqual({ deg: 90, state: 'clear' });
  });

  it('points read as columns are refined like a click, in real inches', async () => {
    const rows = await planOrientationPoints(
      db,
      sheetId,
      [
        [302.5, 100],
        [100.4, 100],
      ],
      RATIO,
    );
    expect(rows[0]).toMatchObject({ placed: [302.5, 100], reading: { deg: 0, state: 'clear' } });
    expect(rows[0]!.a[0]).toBeCloseTo(300, 1);
    expect(rows[0]!.refined_in).toBeGreaterThan(2.5);
    expect(rows[1]!.refined_in).toBeNull(); // 0.5 in off: already right
  });

  it('normalising near-axis manual values: a preview first, then ONE undoable action; others untouched', async () => {
    const a = await draw({ a: [400, 400] });
    const b = await draw({ a: [450, 400] });
    const c = await draw({ a: [500, 400] });
    const d = await draw({ a: [550, 400] });
    for (const [p, deg] of [
      [a, 179],
      [b, 89],
      [c, 90],
      [d, 33],
    ] as const)
      await post('/line-first/pieces/edit', { who: WHO, member_ids: [p.id], orientation_deg: deg });
    const plan = await planNormalise(db, projectId);
    const mine = plan.filter((r) => [a.id, b.id, c.id, d.id].includes(r.id));
    expect(mine.map((r) => [r.from, r.to]).sort()).toEqual([
      [179, 0],
      [89, 90],
    ]); // 90 and 33 stay
    expect(await planNormalise(db, projectId)).toEqual(plan); // a preview changes nothing
    expect(await applyNormalise(db, projectId, mine, 'normalise-test')).toBe(2);
    const page = async () =>
      (
        (
          await app.inject({
            method: 'GET',
            url: `/api/projects/${projectId}/sheets/${sheetId}/line-first`,
          })
        ).json() as { pieces: PieceView[] }
      ).pieces;
    let now = await page();
    expect(now.find((p) => p.id === a.id)).toMatchObject({
      orientation_deg: 0,
      orientation_state: 'manual',
    });
    expect(now.find((p) => p.id === b.id)).toMatchObject({ orientation_deg: 90 });
    expect(now.find((p) => p.id === d.id)).toMatchObject({ orientation_deg: 33 });
    expect((await post('/undo', { who: 'normalise-test' })).statusCode).toBe(200);
    now = await page();
    expect(now.find((p) => p.id === a.id)).toMatchObject({ orientation_deg: 179 });
    expect(now.find((p) => p.id === b.id)).toMatchObject({ orientation_deg: 89 });
    expect(
      (await planNormalise(db, projectId)).filter((r) => [a.id, b.id].includes(r.id)),
    ).toHaveLength(2); // back to the preview
  });
});
