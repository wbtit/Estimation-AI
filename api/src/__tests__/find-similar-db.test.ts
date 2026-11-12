// Phase 14b/14c Find similar and the column palette (migration 029; SYNTHETIC rows only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { loadPieces, type PieceView } from '../review/line-first-pieces.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

const sym = (
  x: number,
  y: number,
  family = 'hss_square',
  real: [number, number] = [12, 12],
  solid: string | null = null,
) => ({
  family,
  box: [x - 5, y - 5, x + 5, y + 5],
  centre: [x, y],
  rotation_deg: 0,
  real_in: real,
  solid,
});

describe('find similar (test database)', () => {
  let projectId: string;
  let sheetId: string;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });

  beforeAll(async () => {
    process.env.FIND_SIMILAR_IMAGE = 'off'; // Phase 14e: the vector path (the image search is on by default)
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
    await db
      .insertInto('page_symbols')
      .values({
        build_run_id: run.id,
        sheet_id: sheetId,
        ratio: 96,
        rules: 'arrow_pt,click_solid,five_families,grid_strip,known_only',
        symbols: JSON.stringify([
          sym(100, 100),
          sym(300, 100),
          sym(500, 100),
          sym(700, 100, 'hss_square', [20, 20]), // another size
          sym(100, 300, 'w_shape', [14, 14]), // another family
          sym(300, 300, 'unknown'),
          sym(100, 500, 'unknown', [12, 12], 'square'), // solid squares (14c)
          sym(300, 500, 'unknown', [12, 12], 'square'),
          sym(500, 500, 'unknown', [12, 12], 'square'),
          sym(700, 500, 'unknown', [12, 12], 'round'),
        ]),
      })
      .execute();
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('a column drawn with the palette keeps its symbol and rotation', async () => {
    const res = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Stud/Post',
      a: [101, 99],
      profile_text: 'HSS12X12X3/8',
      symbol: 'hss_square',
      rotation_deg: 90,
    });
    expect(res.statusCode).toBe(201);
    const p = res.json() as PieceView;
    expect(p).toMatchObject({
      type: 'column',
      kind: 'Stud/Post',
      symbol: 'hss_square',
      symbol_source: 'drawn',
      rotation_deg: 90,
    });
    const bad = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [10, 10],
      symbol: 'not_a_family',
    });
    expect(bad.statusCode).toBe(400);
    // 14c: only the five families; the other nine 14b symbols are refused
    const old = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [10, 10],
      symbol: 'welded_box',
    });
    expect(old.statusCode).toBe(400);
  });

  it('previews, accepts as one logged session action, and undoes in one step', async () => {
    const start = await post('/session/start', { actor: 'estimator', who: WHO });
    const session = start.json().session.id as string;
    const drawn = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [300, 102],
      profile_text: 'HSS12X12X3/8',
    });
    // (the Stud/Post above already sits on the symbol at 100, 100)
    const id = (drawn.json() as PieceView).id;
    const preview = await post(`/line-first/pieces/${id}/find-similar`, { who: WHO });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      example: { family: 'hss_square', real_in: [12, 12] },
      count: 1,
      points: [[500, 100]],
      accepted: false,
    });
    const before = await db
      .selectFrom('members')
      .select('id')
      .where('sheet_id', '=', sheetId)
      .execute();
    expect(before).toHaveLength(2); // the preview wrote nothing
    const acc = await post(`/line-first/pieces/${id}/find-similar`, { who: WHO, accept: true });
    expect(acc.json()).toMatchObject({ accepted: true, count: 1 });
    const made = acc.json().pieces as PieceView[];
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      kind: 'Column',
      profile: 'HSS12X12X3/8',
      symbol: 'hss_square',
      symbol_source: 'find_similar',
      a: [500, 100],
    });
    const log = await db
      .selectFrom('count_actions')
      .select(['action', 'actor', 'session_id', 'detail'])
      .where('project_id', '=', projectId)
      .where('action', '=', 'find_similar')
      .executeTakeFirstOrThrow();
    expect(log).toMatchObject({ actor: 'estimator', session_id: session });
    expect((log.detail as { example_member_id: string }).example_member_id).toBe(id);
    const row = await db
      .selectFrom('members')
      .select(['actor', 'session_id'])
      .where('id', '=', made[0]!.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ actor: 'estimator', session_id: session });
    // nothing left to find
    expect((await post(`/line-first/pieces/${id}/find-similar`, { who: WHO })).json().count).toBe(
      0,
    );
    // undo removes the accepted columns in one step
    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    const [gone] = await loadPieces(db, projectId, { memberIds: [made[0]!.id] });
    expect(gone!.deleted).toBe(true);
    await post('/session/end', { who: WHO });
  });

  it('a solid shape under a drawn column finds the same solid shapes (14c)', async () => {
    const drawn = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [101, 501],
      symbol: 'hss_square',
    });
    const id = (drawn.json() as PieceView).id;
    const preview = await post(`/line-first/pieces/${id}/find-similar`, { who: WHO });
    expect(preview.json()).toMatchObject({
      example: { family: 'solid_square', real_in: [12, 12] },
      count: 2,
      points: [
        [300, 500],
        [500, 500],
      ],
    });
    const acc = await post(`/line-first/pieces/${id}/find-similar`, { who: WHO, accept: true });
    const made = acc.json().pieces as PieceView[];
    expect(made.map((p) => [p.symbol, p.symbol_source])).toEqual([
      ['hss_square', 'find_similar'],
      ['hss_square', 'find_similar'],
    ]);
  });

  it('refuses without a symbol under the column', async () => {
    const drawn = await post(`/sheets/${sheetId}/line-first/pieces`, {
      who: WHO,
      kind: 'Column',
      a: [900, 700],
    });
    const id = (drawn.json() as PieceView).id;
    const res = await post(`/line-first/pieces/${id}/find-similar`, { who: WHO });
    expect(res.statusCode).toBe(409);
  });
});
