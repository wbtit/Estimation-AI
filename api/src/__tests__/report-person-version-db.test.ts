// Review 3 item 5: the report in the click-first flow (auto mode never ran): the system version is
// what the system produced in the person's builds, plus the Find similar matches it proposed, before
// the person's edits. SYNTHETIC rows only, test database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

const SETUP = JSON.stringify({
  role: { value: 'framing', source: 'person' },
  crop: { value: { x0: 0, y0: 0, x1: 1000, y1: 800 }, source: 'person' },
  scale: { value: 96, source: 'person' },
  pen_class: { value: '0.5-1|black|solid', source: 'person' },
  tos: { value_mm: null, source: 'system' },
  column_plan: { value: null, source: 'system' },
});

describe('report without auto mode (test database)', () => {
  let emptyProject: string;
  let projectId: string;
  let sheetId: string;
  let viewA: string;
  let viewB: string;
  const ids: Record<string, string> = {};
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });

  const member = (key: string, extra: object) => ({
    project_id: projectId,
    sheet_id: sheetId,
    member_id: `LF-${key}`,
    type: 'beam',
    kind: 'Beams',
    profile: 'W16X26',
    profile_raw: 'W16X26',
    size_state: 'sized',
    build_state: 'found',
    support_state: 'both',
    plan_scale_ratio: 96,
    ...extra,
  });
  const beam = (key: string, y: number, extra: object = {}) =>
    member(key, {
      origin: 'extracted',
      tag_prefix: 'BE',
      tag_number: y / 100,
      page_x0: 100,
      page_y0: y,
      page_x1: 400,
      page_y1: y,
      start_x_mm: 0,
      start_y_mm: -y,
      end_x_mm: 3048,
      end_y_mm: -y,
      ...extra,
    });
  const column = (key: string, x: number, extra: object = {}) =>
    member(key, {
      origin: 'manual',
      added_by: WHO, // drawn by a person (or accepted from Find similar)
      type: 'column',
      kind: 'Column',
      profile: 'HSS6X6X5/16',
      profile_raw: 'HSS6X6X5/16',
      support_state: null,
      tag_prefix: 'C',
      tag_number: x / 100,
      page_x0: x,
      page_y0: 500,
      start_x_mm: x * 10,
      start_y_mm: -5000,
      ...extra,
    });
  const run = async (view: string) =>
    (
      await db
        .insertInto('build_runs')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          view_id: view,
          requested_by: WHO,
          mode: 'person',
          status: 'done',
          finished_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const snapshot = async (
    runId: string,
    view: string,
    pieces: object[],
    beforeEdit: boolean,
    at: Date,
  ) =>
    db
      .insertInto('build_snapshots')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        view_id: view,
        mode: 'person',
        build_run_id: runId,
        before_user_edit: beforeEdit,
        setup: SETUP,
        pieces: JSON.stringify(pieces),
        created_at: at,
      } as never)
      .execute();
  const piece = (m: {
    member_id: string;
    type: string;
    kind: string;
    page: number[];
    tag?: string;
  }) => ({
    member_id: m.member_id,
    kind: m.kind,
    type: m.type,
    tag: m.tag ?? null,
    profile: m.type === 'column' ? 'HSS6X6X5/16' : 'W16X26',
    profile_raw: null,
    page: m.page,
    start: null,
    end: null,
    length_mm: m.type === 'column' ? null : 3048,
    build_state: 'found',
    size_state: 'sized',
    support_state: null,
    piece_index: 1,
  });

  beforeAll(async () => {
    emptyProject = await insertProject(db);
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    await setFirstView(db, sheetId, {
      role_name: 'Framing plan',
      box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
      scale_ratio: 96,
    });
    const first = await db
      .selectFrom('build_views')
      .select('id')
      .where('sheet_id', '=', sheetId)
      .executeTakeFirstOrThrow();
    viewA = first.id;
    viewB = (
      await db
        .insertInto('build_views')
        .values({
          sheet_id: sheetId,
          position: 2,
          name: 'View 2',
          role_name: 'Framing plan',
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const runA = await run(viewA);
    const runB = await run(viewB);
    const runB2 = await run(viewB);
    const insert = async (v: object, runId: string) =>
      (
        await db
          .insertInto('members')
          .values({ ...v, build_run_id: runId } as never)
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    ids.b1 = await insert(beam('B1', 100), runB);
    ids.b2 = await insert(beam('B2', 200), runB);
    ids.b3 = await insert(beam('B3', 300), runB);
    ids.example = await insert(column('C-EX', 300), runB); // a column the person drew: not the system's
    ids.match = await insert(column('C-FS', 600), runB); // accepted from Find similar: the system's
    // view A's first Build: nothing (a column page); view B's first Build: the beams AND the drawn
    // column (the person drew it first); a later rebuild of view B adds a piece (not the system's)
    const t0 = Date.now() - 600_000;
    await snapshot(runA, viewA, [], true, new Date(t0));
    await snapshot(
      runB,
      viewB,
      [
        ...['B1', 'B2', 'B3'].map((k, i) =>
          piece({
            member_id: `LF-${k}`,
            type: 'beam',
            kind: 'Beams',
            page: [100, (i + 1) * 100, 400, (i + 1) * 100],
          }),
        ),
        piece({ member_id: 'LF-C-EX', type: 'column', kind: 'Column', page: [300, 500, 300, 500] }),
      ],
      false,
      new Date(t0 + 60_000),
    );
    await snapshot(
      runB2,
      viewB,
      [piece({ member_id: 'LF-LATER', type: 'beam', kind: 'Beams', page: [100, 700, 400, 700] })],
      false,
      new Date(t0 + 120_000),
    );
    await db
      .insertInto('count_actions')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        action: 'find_similar',
        who: WHO,
        detail: JSON.stringify({ member_ids: [ids.match], found: 2, created: 1 }),
      } as never)
      .execute();
    // the person's work: B1 approved (a person's confirmation), B2 gets another size, the Find
    // similar column is deleted again, and one beam is drawn by hand
    const r = async (path: string, payload: object) =>
      app.inject({ method: 'POST', url: `/api/projects/${projectId}${path}`, payload });
    await r('/line-first/pieces/edit', { who: WHO, member_ids: [ids.b1], approved: true });
    await r('/line-first/pieces/edit', { who: WHO, member_ids: [ids.b2], profile_text: 'W18X35' });
    await r('/line-first/pieces/delete', { who: WHO, member_ids: [ids.match] });
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await deleteProject(db, emptyProject);
    await closeDatabaseConnection();
  });

  it('no build at all: a clear 409, not "auto mode has not run"', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${emptyProject}/report` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('no system version yet');
    expect(res.json().error).not.toContain('auto mode');
  });

  it('system version = first Build of each view (without the drawn column) + the Find similar match', async () => {
    const res = await get('/report');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.auto_build_id).toBeNull();
    expect(r.system_source).toBe('person');
    const p = r.pages[0];
    // 3 beams + the Find similar column; the person's example column and the later rebuild's piece
    // are not the system's
    expect(p.system_pieces).toBe(4);
    expect(p).toMatchObject({
      confirmed_unchanged: 1, // B1 approved, size and length the system's
      size_changed: 1, // B2 -> W18X35
      kept_unchanged: 1, // B3
      deleted_by_person: 1, // the Find similar column, deleted again
      added_by_person: 1, // the person's own example column
      added_by_rebuild: 0,
    });
    expect(r.total.system_pieces).toBe(4);
  });
});
