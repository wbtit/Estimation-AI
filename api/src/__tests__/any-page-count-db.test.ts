// Phase 0: Find similar works on any built page (a framing build stores no column symbols), says the real
// reason when it cannot, and columns are COUNTED only on column / foundation / pile plans (Reference
// elsewhere, with a per-column "Count this column"). SYNTHETIC rows, test database.
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { type PieceView } from '../review/line-first-pieces.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

describe('any page and the count rule (test database)', () => {
  let projectId: string;
  const sheets: Record<string, string> = {};
  let worker: ReturnType<typeof setInterval> | null = null;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const draw = async (sheet: string, at: [number, number]) =>
    (
      await post(`/sheets/${sheets[sheet]}/line-first/pieces`, {
        who: WHO,
        kind: 'Column',
        a: at,
        symbol: 'w_shape',
        profile_text: 'W12X53',
      })
    ).json() as PieceView;
  const bom = async () =>
    (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/line-first/bom` })
    ).json() as {
      rows: { piece_id: string; reference: boolean; in_main_total: boolean }[];
      totals: { pieces: number };
      reference: { pieces: number };
    };
  const page = async (sheet: string) =>
    (
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${projectId}/sheets/${sheets[sheet]}/line-first`,
        })
      ).json() as {
        pieces: PieceView[];
      }
    ).pieces;

  /** A stand-in worker for this project's find_similar jobs. */
  const startWorker = () => {
    worker = setInterval(() => {
      void (async () => {
        const jobs = await db
          .selectFrom('jobs')
          .select(['id', 'payload'])
          .where('type', '=', 'find_similar')
          .where('status', '=', 'pending')
          .where(sql<boolean>`payload->>'sheet_id' IN (${sheets.framing}, ${sheets.plan})`)
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
            image: 1,
            combined: [{ centre: [x + 100, y], source: 'image', score: 0.9, rotation: 0 }],
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
    for (const [key, role, idx] of [
      ['framing', 'Framing plan', 0],
      ['plan', 'Foundation / column plan', 1],
      ['roof', 'Roof framing', 2],
    ] as const) {
      sheets[key] = await insertSheet(db, projectId, {
        page_index: idx,
        width_pt: 1000,
        height_pt: 800,
      });
      await setFirstView(db, sheets[key], {
        role_name: role,
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
        scale_ratio: 96,
      });
      await db
        .updateTable('sheets')
        .set({ build_scale_ratio: '96' } as never)
        .where('id', '=', sheets[key])
        .execute();
    }
    // the column plan stores its symbols (as a column-plan Build does); the framing page does not
    const run = await db
      .insertInto('build_runs')
      .values({
        project_id: projectId,
        sheet_id: sheets.plan,
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
        sheet_id: sheets.plan,
        ratio: 96,
        rules: 'five_families',
        symbols: JSON.stringify([]),
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
      .where(
        sql<boolean>`payload->>'sheet_id' IN (${sheets.framing}, ${sheets.plan}, ${sheets.roof})`,
      )
      .execute();
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('Find similar runs on a framing page that stores no column symbols, with its own run and no 409', async () => {
    startWorker();
    const c = await draw('framing', [100, 100]);
    expect(
      await db
        .selectFrom('page_symbols')
        .select('build_run_id')
        .where('sheet_id', '=', sheets.framing!)
        .execute(),
    ).toHaveLength(0);
    const res = await post(`/line-first/pieces/${c.id}/find-similar`, { who: WHO, snap: false });
    expect(res.statusCode).toBe(200);
    const pv = res.json();
    expect(pv.symbols_stored).toBe(false);
    expect(pv.matches).toHaveLength(1);
    const job = await db
      .selectFrom('jobs')
      .select(['payload'])
      .where('id', '=', pv.run_id)
      .executeTakeFirstOrThrow();
    expect(job.payload).toMatchObject({ sheet_id: sheets.framing, build_run_id: c.build_run_id });
  });

  it('on a column plan with stored symbols it still says so', async () => {
    startWorker();
    const c = await draw('plan', [100, 100]);
    const pv = (
      await post(`/line-first/pieces/${c.id}/find-similar`, { who: WHO, snap: false })
    ).json();
    expect(pv.symbols_stored).toBe(true);
  });

  it('says the real reason and a code: no scale, a scan', async () => {
    const c = await draw('framing', [300, 100]);
    await db
      .updateTable('members')
      .set({ plan_scale_ratio: null } as never)
      .where('id', '=', c.id)
      .execute();
    await db
      .updateTable('sheets')
      .set({ build_scale_ratio: null } as never)
      .where('id', '=', sheets.framing!)
      .execute();
    const noScale = await post(`/line-first/pieces/${c.id}/find-similar`, { who: WHO });
    expect(noScale.statusCode).toBe(409);
    expect(noScale.json()).toMatchObject({ code: 'no_scale' });
    expect(noScale.json().error).toContain('no scale');
    await db
      .updateTable('sheets')
      .set({ build_scale_ratio: '96', page_kind: 'scanned' } as never)
      .where('id', '=', sheets.framing!)
      .execute();
    const raster = await post(`/line-first/pieces/${c.id}/find-similar`, { who: WHO });
    expect(raster.json()).toMatchObject({ code: 'raster_page' });
    await db
      .updateTable('sheets')
      .set({ page_kind: 'vector' } as never)
      .where('id', '=', sheets.framing!)
      .execute();
  });

  it('columns count on a column plan, are Reference on a framing page, and the tick counts one', async () => {
    const before = await bom();
    const onPlan = await draw('plan', [400, 400]);
    const onRoof = await draw('roof', [400, 400]);
    const onFraming = await draw('framing', [400, 400]);
    const b1 = await bom();
    const row = (b: typeof b1, id: string) => b.rows.find((r) => r.piece_id === id)!;
    expect(row(b1, onPlan.id)).toMatchObject({ reference: false, in_main_total: true });
    expect(row(b1, onRoof.id)).toMatchObject({ reference: true, in_main_total: false });
    expect(row(b1, onFraming.id)).toMatchObject({ reference: true, in_main_total: false });
    // totals: only the column plan's column is added; the two reference columns are kept apart
    expect(b1.reference.pieces - before.reference.pieces).toBe(2);
    expect(b1.totals.pieces - before.totals.pieces).toBe(1);
    // the piece view says why
    expect((await page('framing')).find((p) => p.id === onFraming.id)).toMatchObject({
      page_counts_columns: false,
      count_column: null,
      reference: true,
    });
    // "Count this column" on a column that starts at that level (a crane column)
    const on = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [onFraming.id],
      count_column: true,
    });
    expect((on.json().pieces as PieceView[])[0]).toMatchObject({
      count_column: true,
      reference: false,
    });
    const b2 = await bom();
    expect(row(b2, onFraming.id)).toMatchObject({ reference: false, in_main_total: true });
    expect(b2.totals.pieces - b1.totals.pieces).toBe(1);
    // the same choice as the default is stored as "default" (null): undo and redo are plain edits
    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    expect(row(await bom(), onFraming.id)).toMatchObject({ reference: true });
    // a column on a column plan can be left out the other way
    const off = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [onPlan.id],
      count_column: false,
    });
    expect((off.json().pieces as PieceView[])[0]).toMatchObject({
      count_column: false,
      reference: true,
    });
    expect((await bom()).totals.pieces).toBe(b1.totals.pieces - 1);
    // beams are never reference
    expect(
      (await page('framing'))
        .filter((p) => p.type !== 'column')
        .every((p) => p.reference === false),
    ).toBe(true);
  });
});
