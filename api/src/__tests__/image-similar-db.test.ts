// Phase 14d: Find similar through the worker's image search (FIND_SIMILAR_IMAGE on) and the
// global settings (SYNTHETIC rows only; a stand-in worker completes the queued jobs).
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
    expect(findSimilarImage({})).toBe(false);
    expect(findSimilarImage({ FIND_SIMILAR_IMAGE: 'on' })).toBe(true);
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
                        { centre: [x, y], source: 'image', rotation: 0 },
                        { centre: [x + 100, y], source: 'image', rotation: 0 },
                        { centre: [x + 200, y], source: 'image', rotation: 90 },
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
    process.env.FIND_SIMILAR_IMAGE = 'on';
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
    await db.deleteFrom('jobs').where('type', '=', 'find_similar').execute();
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
      count: 2,
      points: [
        [200, 100],
        [300, 100],
      ],
      sources: ['image', 'image'],
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
    const acc = await post(`/line-first/pieces/${id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
    });
    expect(acc.json()).toMatchObject({ accepted: true, count: 2, run_id: pv.run_id });
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
    expect(log.detail).toMatchObject({ image: { run_id: pv.run_id, runtime_s: 0.5 } });
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
