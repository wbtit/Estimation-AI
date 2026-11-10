// Phase 14d: Find similar through the worker's image search (FIND_SIMILAR_IMAGE on) and the
// global settings (SYNTHETIC rows only; a stand-in worker completes the queued jobs).
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { type PieceView } from '../review/line-first-pieces.js';
import { columnMode, findSimilarImage } from '../review/settings.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

describe('settings', () => {
  it('column mode defaults to click_first; image search defaults to off', () => {
    expect(columnMode({})).toBe('click_first');
    expect(columnMode({ COLUMN_MODE: 'glyph' })).toBe('glyph');
    expect(() => columnMode({ COLUMN_MODE: 'other' })).toThrow();
    // Phase 14e: on by default, an env switch turns it off
    expect(findSimilarImage({})).toBe(true);
    expect(findSimilarImage({ FIND_SIMILAR_IMAGE: 'on' })).toBe(true);
    expect(findSimilarImage({ FIND_SIMILAR_IMAGE: 'off' })).toBe(false);
    expect(findSimilarImage({ FIND_SIMILAR_IMAGE: '0' })).toBe(false);
  });
});

describe('find similar with the image search (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let worker: ReturnType<typeof setInterval> | null = null;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });

  /** A stand-in worker: completes each pending find_similar job with a fixed answer around the
   * click (or fails it). */
  const startWorker = (fail = false) => {
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
          await db
            .updateTable('jobs')
            .set(
              fail
                ? { status: 'failed', error: 'stand-in failure' }
                : {
                    status: 'completed',
                    result: JSON.stringify({
                      example: {
                        source: 'ink',
                        family: 'unknown',
                        solid: null,
                        box: [x - 2, y - 2, x + 2, y + 2],
                        centre: [x, y],
                        real_in: [12, 12],
                      },
                      note: null,
                      vector: 0,
                      image: 3,
                      combined: [
                        { centre: [x, y], source: 'image', score: 1, rotation: 0 },
                        { centre: [x + 100, y], source: 'image', score: 0.95, rotation: 0 },
                        { centre: [x + 200, y], source: 'image', score: 0.85, rotation: 90 },
                        { centre: [x, y + 100], source: 'vector', score: null, rotation: 0 },
                        { centre: [x + 100, y + 100], source: 'image', score: 0.7, rotation: 0 },
                      ],
                      runtime_s: 0.5,
                      settings: { image: true, threshold: 0.7 },
                    }) as never,
                  },
            )
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
    await db
      .insertInto('page_symbols')
      .values({
        build_run_id: run.id,
        sheet_id: sheetId,
        ratio: 96,
        rules: 'arrow_pt,click_solid,five_families,grid_strip,known_only',
        symbols: JSON.stringify([]),
      })
      .execute();
  });

  afterEach(() => {
    if (worker) clearInterval(worker);
    worker = null;
  });

  afterAll(async () => {
    delete process.env.FIND_SIMILAR_IMAGE;
    await db
      .deleteFrom('jobs')
      .where('type', '=', 'find_similar')
      .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`) // not another file's in-flight job
      .execute();
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('previews through a job, then accepts exactly the previewed points', async () => {
    startWorker();
    const drawn = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [100, 100],
      symbol: 'hss_square',
      rotation_deg: 0,
    });
    const id = (drawn.json() as PieceView).id;
    const preview = await post(`/line-first/pieces/${id}/find-similar`, { who: WHO });
    expect(preview.statusCode).toBe(200);
    const pv = preview.json();
    // the clicked column itself is already a column: two new points
    expect(pv).toMatchObject({
      example: { family: 'drawn_symbol', real_in: [12, 12] },
      count: 4,
      matches: [
        { centre: [200, 100], source: 'image', score: 0.95 },
        { centre: [300, 100], source: 'image', score: 0.85 },
        { centre: [100, 200], source: 'vector', score: null },
        { centre: [200, 200], source: 'image', score: 0.7 },
      ],
      strictness_default: 0.8,
      image: true,
      runtime_s: 0.5,
      accepted: false,
    });
    const job = await db
      .selectFrom('jobs')
      .select(['payload'])
      .where('id', '=', pv.run_id)
      .executeTakeFirstOrThrow();
    expect(job.payload).toMatchObject({ member_id: id, click: [100, 100] }); // recorded
    // at the default strictness 0.8 three are shown (the 0.7 one is not); the person unticks the
    // vector match at 100, 200: two are added
    const acc = await post(`/line-first/pieces/${id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      unticked: [[100, 200]],
    });
    expect(acc.json()).toMatchObject({
      accepted: true,
      count: 2,
      strictness: 0.8,
      run_id: pv.run_id,
    });
    const made = acc.json().pieces as PieceView[];
    const byX = [...made].sort((p, q) => p.a![0] - q.a![0]); // pieces come in no fixed order
    expect(byX.map((p) => [p.a, p.symbol, p.rotation_deg])).toEqual([
      [[200, 100], 'hss_square', 0],
      [[300, 100], 'hss_square', 90],
    ]);
    const log = await db
      .selectFrom('count_actions')
      .select(['detail'])
      .where('project_id', '=', projectId)
      .where('action', '=', 'find_similar')
      .executeTakeFirstOrThrow();
    expect(log.detail).toMatchObject({
      image: { run_id: pv.run_id, runtime_s: 0.5 },
      strictness: 0.8,
      shown: 3,
      found: 4,
      created: 2,
      unticked: [{ centre: [100, 200], source: 'vector', score: null }],
    });
    // a run of another column is refused
    const other = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [500, 500],
    });
    const bad = await post(`/line-first/pieces/${(other.json() as PieceView).id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('the strictness filters the matches; only the ticked ones are added', async () => {
    startWorker();
    const drawn = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [100, 500],
      symbol: 'hss_square',
    });
    const id = (drawn.json() as PieceView).id;
    const pv = (await post(`/line-first/pieces/${id}/find-similar`, { who: WHO })).json();
    const acc = await post(`/line-first/pieces/${id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      strictness: 0.9,
      unticked: [[200, 500]],
    });
    // at 0.9: the 0.95 image match and the vector match; the 0.95 one unticked: only the vector one
    expect(acc.json()).toMatchObject({ accepted: true, count: 1, strictness: 0.9 });
    expect((acc.json().pieces as PieceView[]).map((p) => p.a)).toEqual([[100, 600]]);
    // everything unticked: nothing is added
    const none = await post(`/line-first/pieces/${id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      strictness: 0.9,
      unticked: [[200, 500]],
    });
    expect(none.json()).toMatchObject({ accepted: false, count: 0 }); // the vector one is taken now
    const bad = await post(`/line-first/pieces/${id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      strictness: 0.95,
    });
    expect(bad.statusCode).toBe(400); // outside 0.6-0.9
  });

  it('reports a failed search', async () => {
    startWorker(true);
    const drawn = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [700, 700],
    });
    const res = await post(`/line-first/pieces/${(drawn.json() as PieceView).id}/find-similar`, {
      who: WHO,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('image search failed');
  });
});
