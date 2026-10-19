// Phase 11b review UI: page badges, the system-vs-final report, the answer key, and the routes on the
// test database (SYNTHETIC rows only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { SnapshotPiece } from '../db/types.js';
import { answerKey, feetAndInches } from '../review/answer-key.js';
import { lineFirstBom } from '../review/line-first-bom.js';
import { lineFirstEdits, planMm, type PieceView } from '../review/line-first-pieces.js';
import { pageBadge, systemValues, type BadgeInput } from '../review/page-badge.js';
import {
  matchPieces,
  minutesPerSheet,
  systemReport,
  type SetupValues,
} from '../review/system-report.js';
import { ftIn, nearestClass, setupReasons } from '../routes/build.js';
import { asSheet, viewsOf } from '../review/build-views.js';
import {
  deleteEdition,
  deleteProject,
  firstView,
  insertProject,
  insertSheet,
  setFirstView,
  uniqueLabel,
} from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

// ---- pure ----------------------------------------------------------------------------------------
const T0 = '2026-01-01T10:00:00Z';
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();

function badge(over: Partial<BadgeInput>): string {
  return pageBadge({
    role: 'framing',
    built_at: at(1),
    setup_changed_at: null,
    reviewed_at: null,
    last_edit_at: null,
    last_run: { status: 'done', started_at: at(0) },
    system_values: [],
    ...over,
  });
}

describe('page badge', () => {
  it('follows the order of the rule', () => {
    expect(badge({ last_run: { status: 'running', started_at: at(0) } })).toBe('Building');
    expect(badge({ setup_changed_at: at(2) })).toBe('Requesting Build');
    expect(badge({ last_run: { status: 'refused', started_at: at(0) }, built_at: null })).toBe(
      'Not built',
    );
    expect(badge({ role: null })).toBe('Skip');
    expect(badge({ system_values: ['crop'] })).toBe('Not confirmed');
    expect(badge({})).toBe('Built');
    expect(badge({ reviewed_at: at(3), system_values: ['crop'] })).toBe('Reviewed');
    // an edit after the save takes the badge off Reviewed
    expect(badge({ reviewed_at: at(3), last_edit_at: at(4) })).toBe('Built');
    expect(badge({ role: null, reviewed_at: at(3) })).toBe('Reviewed');
  });

  it('lists the values no person set or saved', () => {
    const s = {
      build_role: 'framing',
      role_confirmed_by: null,
      crop_region: {},
      crop_confirmed_by: 'x',
      build_scale_ratio: '96',
      scale_confirmed_by: null,
      pen_class: 'k',
      pen_class_confirmed_by: null,
      tos_mm: null,
      tos_confirmed_by: null,
      column_plan_confirmed_by: null,
    };
    expect(systemValues(s)).toEqual(['role', 'scale', 'pen_class', 'column_plan']);
    expect(systemValues({ ...s, build_role: null })).toEqual(['role']);
  });
});

function sys(over: Partial<SnapshotPiece>): SnapshotPiece {
  return {
    member_id: 'LF-B-1',
    kind: 'Beams',
    type: 'beam',
    tag: 'B1',
    profile: 'W16X26',
    profile_raw: 'W16X26',
    page: [100, 100, 300, 100],
    start: [0, 0, 0],
    end: [6096, 0, 0],
    length_mm: 6096,
    build_state: 'found',
    size_state: 'sized',
    support_state: 'both',
    piece_index: 1,
    ...over,
  };
}

function fin(over: Partial<PieceView>): PieceView {
  return {
    id: 'u',
    member_id: 'LF-B-1',
    sheet_id: 'S',
    type: 'beam',
    kind: 'Beams',
    tag: 'B1',
    quantity: 1,
    profile: 'W16X26',
    profile_raw: 'W16X26',
    studs: null,
    camber_raw: null,
    ignored: false,
    approved: false,
    deleted: false,
    added: false,
    edited: false,
    a: [100, 100],
    b: [300, 100],
    ends_moved: false,
    length_mm: 6096,
    elevation_mm: null,
    build_state: 'found',
    size_state: 'sized',
    support_state: 'both',
    piece_index: 1,
    scale_ratio: 96,
    evidence: null,
    build_run_id: 'r',
    build_view_id: null,
    start: null,
    end: null,
    ...over,
  };
}

const SETUP: SetupValues = {
  role: 'framing',
  crop: { x0: 0, y0: 0, x1: 500, y1: 500 },
  pen_class: '1.5-2.5|black|solid',
  scale_ratio: 96,
  tos_mm: null,
  column_plan: null,
};

describe('system vs final report', () => {
  it('matches by id first, then by geometry (direction, offset, overlap, kind)', () => {
    const system = [
      sys({ member_id: 'a' }),
      sys({ member_id: 'b', page: [100, 200, 300, 200] }),
      sys({ member_id: 'c', page: [100, 300, 300, 300] }),
    ];
    const final = [
      fin({ member_id: 'a' }),
      fin({ member_id: 'new-b', a: [102, 203], b: [280, 203] }), // same line, 3 pt off
      fin({ member_id: 'new-c', a: [100, 300], b: [300, 300], kind: 'Column' }), // other kind
      fin({ member_id: 'far', a: [100, 320], b: [300, 320] }), // 20 pt away
    ];
    const m = matchPieces(system, final);
    expect([...m.entries()]).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('classifies every system piece and every unmatched final piece', () => {
    const system = [
      sys({ member_id: 'kept' }),
      sys({ member_id: 'size', page: [100, 120, 300, 120] }),
      sys({ member_id: 'len', page: [100, 140, 300, 140] }),
      sys({ member_id: 'both', page: [100, 160, 300, 160] }),
      sys({ member_id: 'del', page: [100, 180, 300, 180] }),
      sys({ member_id: 'ign', page: [100, 200, 300, 200] }),
      sys({ member_id: 'gone', page: [100, 400, 300, 400] }),
      sys({ member_id: 'conf', page: [100, 220, 300, 220] }),
      sys({ member_id: 'conf-size', page: [100, 240, 300, 240] }),
    ];
    const final = [
      fin({ member_id: 'kept', length_mm: 6096 + 20 }), // within 1 inch
      fin({ member_id: 'size', profile: 'W18X35' }),
      fin({ member_id: 'len', length_mm: 6096 + 30 }),
      fin({ member_id: 'both', profile: 'W18X35', length_mm: 5000 }),
      fin({ member_id: 'del', deleted: true }),
      fin({ member_id: 'ign', ignored: true }),
      // approved, size and length the system's: confirmed unchanged by person
      fin({ member_id: 'conf', approved: true, edited: true }),
      // approved after a size change: a size change, not a confirmation
      fin({ member_id: 'conf-size', approved: true, edited: true, profile: 'W21X44' }),
      fin({ member_id: 'drawn', added: true, a: [400, 0], b: [400, 300] }),
      fin({ member_id: 'rebuilt', a: [500, 0], b: [500, 300] }),
      fin({ member_id: 'drawn-del', added: true, deleted: true, a: [450, 0], b: [450, 300] }),
    ];
    const r = systemReport(
      [
        {
          sheet_id: 'S',
          page_index: 0,
          sheet_number: 'S-1',
          system,
          system_setup: SETUP,
          final_setup: { ...SETUP, pen_class: '>2.5|black|solid', tos_mm: 3000 },
          reviewed_by: WHO,
          reviewed_at: at(10),
        },
      ],
      final,
      [],
    );
    const p = r.pages[0]!;
    expect(p).toMatchObject({
      system_pieces: 9,
      final_pieces: 8,
      kept_unchanged: 1,
      confirmed_unchanged: 1,
      size_changed: 3,
      length_changed: 2,
      deleted_by_person: 1,
      ignored: 1,
      removed_by_rebuild: 1,
      added_by_person: 1,
      added_by_rebuild: 1,
      added_then_deleted: 1,
    });
    expect(p.setup_changed).toEqual(['pen_class', 'tos_mm']);
    expect(r.total.pages_with_setup_changes).toBe(1);
    expect(r.total.confirmed_unchanged).toBe(1);
    const w16 = r.sizes.find((s) => s.size === 'W16X26')!;
    expect(w16.system_count).toBe(9);
    // final W16X26: kept, len, conf, drawn, rebuilt (del and ign are out)
    expect(w16.final_count).toBe(5);
  });

  it('counts minutes per page from gaps on the same page, capped at 5 minutes', () => {
    const rows = [
      { sheet_id: 'A', created_at: at(0) },
      { sheet_id: 'A', created_at: at(2) },
      { sheet_id: 'A', created_at: at(30) }, // a 28 minute gap counts 5
      { sheet_id: 'B', created_at: at(31) }, // a page change counts nothing
      { sheet_id: 'B', created_at: at(32) },
      { sheet_id: null, created_at: at(33) },
    ];
    const m = minutesPerSheet(rows);
    expect(m.get('A')).toBe(7);
    expect(m.get('B')).toBe(1);
  });
});

describe('answer key, units and helpers', () => {
  it('writes the rows.json format with feet, inches and lb', () => {
    expect(feetAndInches(3810)).toEqual({ ft: 12, inch: 6 });
    expect(feetAndInches(304.8 * 10 + 25.4 * 3.5)).toEqual({ ft: 10, inch: 3.5 });
    expect(ftIn(3810)).toBe(`12'-6"`);
    expect(ftIn(304.8 + 25.4 * 0.5)).toBe(`1'-1/2"`);
    expect(ftIn(304.8 * 2 + 25.4 * 3.25)).toBe(`2'-3 1/4"`);
    const bom = lineFirstBom(
      [
        {
          id: 'x',
          member_id: 'm',
          sheet_id: 'S',
          type: 'beam',
          kind: 'Beams',
          tag: 'B1',
          quantity: 2,
          profile: 'W16X26',
          profile_raw: 'W16X26',
          start: [0, 0, 0],
          end: [3810, 0, 0],
          build_state: 'found',
          size_state: 'sized',
          support_state: 'both',
          piece_index: 1,
        },
      ],
      null,
      new Map(),
    );
    const key = answerKey(bom, new Map([['S', { sheet_number: 'S-201', page_index: 4 }]]));
    expect(key.cols.ref).toBe('Reference');
    expect(key.rows).toEqual([
      {
        ref: '-/S-201',
        qty: 2,
        shape: 'W',
        size: '16X26',
        name: 'Beams',
        len_ft: 12,
        len_in: 6,
        unit_w: null, // no catalog here: never guessed
        total_w: null,
        grade: null,
      },
    ]);
  });

  it('picks the class of the nearest line within 12 pt, the longer on a tie', () => {
    const classes = ['0.5-1|black|solid', '1.5-2.5|black|solid'];
    const rows = [
      [0, 10, 100, 10, 0, 0.7],
      [0, 20, 300, 20, 1, 2],
      [0, 0, 50, 0, 0, 0.7],
    ];
    expect(nearestClass(classes, rows, 50, 18)).toEqual({
      pen_class: '1.5-2.5|black|solid',
      distance_pt: 2,
    });
    expect(nearestClass(classes, rows, 50, 15)!.pen_class).toBe('1.5-2.5|black|solid'); // tie: longer
    expect(nearestClass(classes, rows, 50, 60)).toBeNull();
  });

  it('plan points and line-first edits', () => {
    const [x, y] = planMm([72, 72], 96);
    expect(x).toBeCloseTo(2438.4);
    expect(y).toBeCloseTo(-2438.4);
    const e = lineFirstEdits([
      { field_name: 'studs', corrected_value: 12 },
      { field_name: 'profile', corrected_value: 'X' },
      { field_name: 'studs', corrected_value: 14 },
    ]);
    expect([...e.entries()]).toEqual([['studs', 14]]);
  });
});

// ---- routes on the test database -----------------------------------------------------------------
describe('review UI routes (test database)', () => {
  let projectId: string;
  let planId: string;
  let framingId: string;
  let autoId: string;
  const ids: Record<string, string> = {};
  const jobs: string[] = [];
  const edition = uniqueLabel('review-ui-test');
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
  const pages = async () =>
    (await get('/pages')).json().pages as {
      id: string;
      badge: string;
      system_values: string[];
      pending_edits: number;
      counts: Record<string, number>;
    }[];
  const pageOf = async (id: string) => (await pages()).find((p) => p.id === id)!;

  beforeAll(async () => {
    process.env.CATALOG_EDITION = edition;
    await importCatalog(db, edition, [
      {
        shape_name: 'W16X26',
        family: 'W',
        weight_kg_per_m: 38.7,
        weight_lb_per_ft: 26,
        properties: {},
      },
      {
        shape_name: 'W16X31',
        family: 'W',
        weight_kg_per_m: 46.1,
        weight_lb_per_ft: 31,
        properties: {},
      },
      {
        shape_name: 'W18X35',
        family: 'W',
        weight_kg_per_m: 52.1,
        weight_lb_per_ft: 35,
        properties: {},
      },
    ]);
    projectId = await insertProject(db);
    planId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    framingId = await insertSheet(db, projectId, {
      page_index: 1,
      width_pt: 1000,
      height_pt: 800,
      sheet_number: 'S-2',
    });
    await db
      .insertInto('project_files')
      .values({
        project_id: projectId,
        original_filename: 'synthetic.pdf',
        stored_path: `${projectId}/x.pdf`,
        sha256: '0'.repeat(64),
        size_bytes: 1,
        scan_status: 'done',
      })
      .execute();
    // the page as auto mode leaves it: system values only
    await db
      .updateTable('sheets')
      .set({ build_status: 'built', built_at: new Date(Date.now() - 60_000) })
      .where('id', '=', framingId)
      .execute();
    await setFirstView(
      db,
      framingId,
      {
        role_name: 'Framing plan',
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
        scale_ratio: 96,
        built_at: new Date(Date.now() - 60_000),
      },
      [{ pen_class: '0.5-1|black|solid', source: 'suggested' }],
    );
    await db
      .insertInto('sheet_lines')
      .values({
        sheet_id: framingId,
        classes: JSON.stringify(['0.5-1|black|solid', '1.5-2.5|black|solid']),
        lines: JSON.stringify([
          [100, 100, 400, 100, 1, 2],
          [100, 300, 400, 300, 0, 0.7],
        ]),
        n_lines: 2,
        version: 'v',
      })
      .execute();
    const auto = await db
      .insertInto('auto_builds')
      .values({ project_id: projectId, status: 'done', finished_at: new Date(Date.now() - 60_000) })
      .returning('id')
      .executeTakeFirstOrThrow();
    autoId = auto.id;
    const run = await db
      .insertInto('build_runs')
      .values({
        project_id: projectId,
        sheet_id: framingId,
        requested_by: 'system',
        mode: 'auto',
        auto_build_id: autoId,
        status: 'done',
        started_at: new Date(Date.now() - 120_000),
        finished_at: new Date(Date.now() - 60_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const beam = (key: string, y: number, profile: string | null) => ({
      project_id: projectId,
      sheet_id: framingId,
      member_id: `LF-B-${key}`,
      origin: 'extracted',
      type: 'beam',
      kind: 'Beams',
      build_run_id: run.id,
      profile,
      profile_raw: profile,
      size_state: profile ? 'sized' : 'undefined',
      build_state: profile ? 'found' : 'attention',
      support_state: 'both',
      tag_prefix: 'BE',
      tag_number: y / 100,
      page_x0: 100,
      page_y0: y,
      page_x1: 400,
      page_y1: y,
      start_x_mm: 1016,
      start_y_mm: -y * 33.8667,
      end_x_mm: 1016 + 10160,
      end_y_mm: -y * 33.8667,
      plan_scale_ratio: 96,
    });
    for (const [key, y, profile] of [
      ['one', 100, 'W16X26'],
      ['two', 200, 'W16X26'],
      ['three', 300, null],
    ] as const) {
      const row = await db
        .insertInto('members')
        .values(beam(key, y, profile) as never)
        .returning(['id', 'member_id'])
        .executeTakeFirstOrThrow();
      ids[key] = row.id;
    }
    const all = await db
      .selectFrom('members')
      .selectAll()
      .where('sheet_id', '=', framingId)
      .orderBy('member_id')
      .execute();
    await db
      .insertInto('build_snapshots')
      .values({
        project_id: projectId,
        auto_build_id: autoId,
        sheet_id: framingId,
        build_run_id: run.id,
        setup: JSON.stringify({
          role: { value: 'framing', source: 'system' },
          crop: { value: { x0: 0, y0: 0, x1: 1000, y1: 800 }, source: 'system' },
          scale: { value: 96, source: 'system' },
          pen_class: { value: '0.5-1|black|solid', source: 'system' },
          tos: { value_mm: null, source: 'system' },
          column_plan: { value: null, source: 'system' },
        }),
        pieces: JSON.stringify(
          all.map((m) => ({
            member_id: m.member_id,
            kind: 'Beams',
            type: 'beam',
            tag: `BE${m.tag_number}`,
            profile: m.profile,
            profile_raw: m.profile_raw,
            page: [100, Number(m.page_y0), 400, Number(m.page_y1)],
            start: null,
            end: null,
            length_mm: 10160,
            build_state: m.build_state,
            size_state: m.size_state,
            support_state: 'both',
            piece_index: 1,
          })),
        ),
      })
      .execute();
  });

  afterAll(async () => {
    delete process.env.CATALOG_EDITION;
    if (jobs.length) await db.deleteFrom('jobs').where('id', 'in', jobs).execute();
    await deleteProject(db, projectId);
    await deleteEdition(db, edition);
    await closeDatabaseConnection();
  });

  it('lists the pages with their badge, system values and counts', async () => {
    const f = await pageOf(framingId);
    expect(f.badge).toBe('Not confirmed');
    expect(f.system_values).toEqual(['role', 'crop', 'scale', 'pen_class', 'column_plan']);
    expect(f.counts).toMatchObject({ pieces: 3, beams: 3, found: 2, attention: 1 });
    expect((await pageOf(planId)).badge).toBe('Skip');
  });

  it('a click on a line picks its pen class, as a person; the page then requests a build', async () => {
    const res = await post(`/sheets/${framingId}/build-setup/pick-pen`, {
      x: 200,
      y: 103,
      who: WHO,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pen_class).toBe('1.5-2.5|black|solid');
    const v = await firstView(db, framingId);
    expect(v.pens.map((p) => [p.pen_class, p.source, p.confirmed_by])).toEqual([
      ['1.5-2.5|black|solid', 'person', WHO],
    ]);
    expect((await pageOf(framingId)).badge).toBe('Requesting Build');
    const miss = await post(`/sheets/${framingId}/build-setup/pick-pen`, {
      x: 900,
      y: 700,
      who: WHO,
    });
    expect(miss.statusCode).toBe(404);
    const log = await db
      .selectFrom('count_actions')
      .select('action')
      .where('sheet_id', '=', framingId)
      .execute();
    expect(log.map((l) => l.action)).toContain('pick_pen');
  });

  it('"No beams" sets the beam pen to none as a person; such a page can still build', async () => {
    const res = await post(`/sheets/${planId}/build-setup/no-beams`, { who: WHO });
    expect(res.statusCode).toBe(200);
    const v = await firstView(db, planId);
    expect([v.pens.length, v.no_beams_by]).toEqual([0, WHO]);
    const page = await db
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', planId)
      .executeTakeFirstOrThrow();
    const s = asSheet(page, (await viewsOf(db, planId))[0]!);
    expect([s.pen_class, s.pen_class_source, s.pen_class_confirmed_by]).toEqual([
      null,
      'person',
      WHO,
    ]);
    const framing = { ...s, build_role: 'framing', crop_region: {}, build_scale_ratio: '96' };
    expect(setupReasons(framing as never, true)).toEqual([]);
    expect(setupReasons({ ...framing, pen_class_source: 'suggested' } as never, true)).toEqual([
      'no beam pen class',
    ]);
    const edits = await db
      .selectFrom('sheet_edits')
      .select(['field_name', 'corrected_value'])
      .where('sheet_id', '=', planId)
      .execute();
    expect(edits).toEqual([{ field_name: 'pen_class', corrected_value: null }]);
  });

  it('builds with system values from the review UI (mode person), logged as a rebuild', async () => {
    const strict = await post(`/sheets/${framingId}/build`, { who: WHO });
    expect(strict.statusCode).toBe(409);
    const ok = await post(`/sheets/${framingId}/build`, { who: WHO, allow_system_values: true });
    expect(ok.statusCode).toBe(202);
    jobs.push(ok.json().job_id);
    const run = await db
      .selectFrom('build_runs')
      .selectAll()
      .where('id', '=', ok.json().build_run_id)
      .executeTakeFirstOrThrow();
    expect(run.mode).toBe('person');
    expect(run.inputs).toMatchObject({ allow_system_values: true, no_column_plan: true });
    expect((await pageOf(framingId)).badge).toBe('Building');
    // the worker would finish it; here the test marks it done
    await db
      .updateTable('build_runs')
      .set({ status: 'done', finished_at: new Date() })
      .where('id', '=', run.id)
      .execute();
    await setFirstView(db, framingId, { built_at: new Date() });
  });

  it('edits several pieces as one action; undo puts them back', async () => {
    const res = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.one, ids.two],
      profile_text: 'W16X31',
      studs: 12,
    });
    expect(res.statusCode).toBe(200);
    const edits = await db
      .selectFrom('member_edits')
      .select(['action_id', 'field_name'])
      .where('member_id', 'in', [ids.one!, ids.two!])
      .execute();
    expect(new Set(edits.map((e) => e.action_id)).size).toBe(1);
    const pcs = res.json().pieces as PieceView[];
    expect(pcs.map((p) => [p.profile, p.studs])).toEqual([
      ['W16X31', 12],
      ['W16X31', 12],
    ]);
    expect((await pageOf(framingId)).pending_edits).toBe(1);
    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    const back = (await get(`/sheets/${framingId}/line-first`)).json().pieces as PieceView[];
    expect(back.find((p) => p.id === ids.one)!.profile).toBe('W16X26');
    expect(back.find((p) => p.id === ids.one)!.studs).toBeNull();
  });

  it('approves members as one logged, undoable action; an edit keeps them approved', async () => {
    const before = await pageOf(framingId);
    const res = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.one, ids.two],
      approved: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pieces.map((p: PieceView) => p.approved)).toEqual([true, true]);
    const logRow = await db
      .selectFrom('count_actions')
      .select(['action', 'who', 'member_id', 'detail', 'edit_action_id'])
      .where('project_id', '=', projectId)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(logRow).toMatchObject({
      action: 'approve',
      who: WHO,
      member_id: null,
      detail: { members: 2, changed: 2, fields: ['approved'], approved: true },
    });
    expect(logRow.edit_action_id).toBeTruthy();
    // approved members are out of the found / review / attention counts
    const page = await pageOf(framingId);
    expect(page.counts.approved).toBe(before.counts.approved + 2);
    expect(page.counts.found + page.counts.needs_review + page.counts.attention).toBe(
      before.counts.found + before.counts.needs_review + before.counts.attention - 2,
    );
    expect(page.pending_edits).toBe(before.pending_edits + 1);
    // the BOM row says so
    const bom = (await get('/line-first/bom')).json();
    const row = bom.rows.find((r: { piece_id: string }) => r.piece_id === ids.one);
    expect(row.approved).toBe(true);
    // a size edit keeps it approved; undo takes back the edit, then the approval
    const ed = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.one],
      profile_text: 'W21X44',
    });
    expect(ed.json().pieces[0]).toMatchObject({ profile: 'W21X44', approved: true });
    await post('/undo', { who: WHO });
    await post('/undo', { who: WHO });
    const back = (await get(`/sheets/${framingId}/line-first`)).json().pieces as PieceView[];
    expect(back.find((p) => p.id === ids.one)).toMatchObject({
      profile: 'W16X26',
      approved: false,
    });
    expect(back.find((p) => p.id === ids.two)!.approved).toBe(false);
    // approving again and then unapproving with the button is its own action
    await post('/line-first/pieces/edit', { who: WHO, member_ids: [ids.two], approved: true });
    const un = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.two],
      approved: false,
    });
    expect(un.json().pieces[0].approved).toBe(false);
  });

  it('a typed size, a new kind with a tag from the counter, ignore and delete', async () => {
    const r1 = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.three],
      profile_text: 'W18X35',
    });
    expect(r1.json().pieces[0]).toMatchObject({ profile: 'W18X35', build_state: 'found' });
    const r2 = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.two],
      ignored: true,
    });
    expect(r2.json().pieces[0].ignored).toBe(true);
    const bom = (await get('/line-first/bom')).json();
    expect(bom.rows.map((r: { member: string }) => r.member)).not.toContain(ids.two);
    expect(bom.rows[0].weight_lb).toBeGreaterThan(0);
    const del = await post('/line-first/pieces/delete', { who: WHO, member_ids: [ids.one] });
    expect(del.json().deleted).toBe(1);
    const shown = (await get(`/sheets/${framingId}/line-first`)).json().pieces as PieceView[];
    expect(shown.map((p) => p.id)).not.toContain(ids.one);
    // a deleted piece is not approved
    const ap = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.one],
      approved: true,
    });
    expect(ap.json().changed).toBe(false);
    const bad = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [ids.three],
      kind: 'Not a kind',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('draws a beam with the next tag of the one counter, then moves an end', async () => {
    const res = await post(`/sheets/${framingId}/line-first/pieces`, {
      who: WHO,
      kind: 'Beams',
      a: [100, 500],
      b: [172, 500],
      profile_text: 'W16X26',
    });
    expect(res.statusCode).toBe(201);
    const p = res.json() as PieceView;
    expect(p.added).toBe(true);
    expect(p.tag).toBe('BE4'); // after BE1..BE3 of the build
    expect(p.length_mm).toBeCloseTo(2438.4, 1); // 72 pt at 1/8" = 1'-0"
    const counter = await db
      .selectFrom('tag_counters')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    expect(counter).toMatchObject({ prefix: 'BE', last_number: 4 });
    const moved = await post(`/line-first/pieces/${p.id}/ends`, {
      who: WHO,
      a: [100, 500],
      b: [244, 500],
    });
    expect(moved.json().piece.length_mm).toBeCloseTo(4876.8, 1);
    const wrong = await post(`/line-first/pieces/${p.id}/ends`, { who: WHO, a: [1, 1], b: null });
    expect(wrong.statusCode).toBe(400);
  });

  it('Save page confirms what is left of the system values and marks the page Reviewed', async () => {
    const res = await post(`/sheets/${framingId}/save-page`, { who: WHO });
    expect(res.json().confirmed).toEqual(['role', 'crop', 'scale', 'column_plan']);
    const f = await pageOf(framingId);
    expect(f.badge).toBe('Reviewed');
    expect(f.system_values).toEqual([]);
    expect(f.pending_edits).toBe(0);
  });

  it('reports SYSTEM VERSION vs SAVED FINAL and exports it', async () => {
    await post(`/sheets/${framingId}/view`, { who: WHO });
    const r = (await get('/report')).json();
    const p = r.pages.find((x: { sheet_id: string }) => x.sheet_id === framingId);
    expect(p).toMatchObject({
      system_pieces: 3,
      kept_unchanged: 0,
      size_changed: 1, // three: none -> W18X35
      deleted_by_person: 1,
      ignored: 1,
      added_by_person: 1,
      reviewed_by: WHO,
    });
    expect(p.setup_changed).toEqual(['pen_class']);
    const xlsx = await get('/report.xlsx');
    expect(xlsx.statusCode).toBe(200);
    const key = (await get('/answer-key.json')).json();
    expect(key.rows.map((x: { size: string }) => x.size).sort()).toEqual(['16X26', '18X35']);
    expect(key.rows.every((x: { ref: string }) => x.ref === '-/S-2')).toBe(true);
    const w18 = key.rows.find((x: { size: string }) => x.size === '18X35');
    expect(w18.unit_w).toBe(35);
  });

  it('searches the AISC sections of the catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalog/sections?q=w16' });
    expect(res.json().sections.map((s: { name: string }) => s.name)).toEqual(['W16X26', 'W16X31']);
  });

  it('starts auto mode once', async () => {
    const res = await post('/auto-build', {});
    expect(res.statusCode).toBe(409); // a finished auto run exists
    const proc = (await get('/processing')).json();
    expect(proc.auto_build.status).toBe('done');
  });

  it('creates a project with a status, changes it, and lists a thumbnail field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: uniqueLabel('test-project'), stage: 'Submitted' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(res.json().stage).toBe('Submitted');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { stage: 'Won' },
    });
    expect(patched.json().stage).toBe('Won');
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { stage: 'Maybe' },
    });
    expect(bad.statusCode).toBe(400);
    expect(patched.json().archived).toBe(false);
    const archived = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { archived: true },
    });
    expect(archived.json()).toMatchObject({ stage: 'Won', archived: true });
    const empty = await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: {} });
    expect(empty.statusCode).toBe(400);
    const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json().projects;
    expect(list.find((p: { id: string }) => p.id === id)).toMatchObject({
      thumbnail_url: null,
      archived: true,
    });
    const auto = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/auto-build`,
      payload: {},
    });
    expect(auto.statusCode).toBe(409); // no PDF scanned
    await deleteProject(db, id);
  });
});
