// Phase 11c: views per page, role names, several beam pens, exclude areas (and the suggestions),
// deselected lines, per-view builds, set-size-for-all as one action, and the log of every person
// action (SYNTHETIC rows only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { asSheet, viewAt, type LoadedView } from '../review/build-views.js';
import {
  GRID_OVERLAP_MAX,
  overlapShare,
  suggestExcludes,
  TABLE_MIN_LINES,
} from '../review/excludes.js';
import { combineBadges } from '../review/page-badge.js';
import { deleteProject, firstView, insertProject, insertSheet, uniqueLabel } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

// ---- pure ----------------------------------------------------------------------------------------
const W = 1000;
const H = 800;
/** A synthetic sheet: frame lines near every edge, a title block line, a 4 x 4 table (16 lines). */
function sheetLines(): number[][] {
  const frame = [
    [10, 10, 990, 10, 0, 1],
    [10, 790, 990, 790, 0, 1],
    [10, 10, 10, 790, 0, 1],
    [990, 10, 990, 790, 0, 1],
  ];
  const title = [[850, 10, 850, 790, 0, 1]];
  const table: number[][] = [];
  for (let i = 0; i < 8; i++) table.push([100, 600 + i * 20, 250, 600 + i * 20, 0, 0.5]);
  for (let i = 0; i < 8; i++) table.push([100 + i * 20, 600, 100 + i * 20, 740, 0, 0.5]);
  return [...frame, ...title, ...table];
}

describe('suggested excludes (pure)', () => {
  const grid = { x0: 300, y0: 100, x1: 800, y1: 500 };

  it('proposes the frame bands, the title block band and a table', () => {
    const s = suggestExcludes(sheetLines(), [W, H], null, grid, null);
    expect(s.map((x) => x.rule)).toEqual([
      'frame',
      'frame',
      'frame',
      'frame',
      'title_block',
      'table',
    ]);
    expect(s[0]!.box).toEqual({ x0: 0, y0: 0, x1: 14, y1: 800 });
    expect(s[4]!.box).toEqual({ x0: 846, y0: 0, x1: 1000, y1: 800 });
    expect(s[5]!.box).toEqual({ x0: 98, y0: 598, x1: 252, y1: 742 });
  });

  it('never proposes a box over the grid area by more than 5%', () => {
    // a grid area that reaches into the table and the title band
    const big = { x0: 90, y0: 100, x1: 900, y1: 700 };
    const s = suggestExcludes(sheetLines(), [W, H], null, big, null);
    expect(s.map((x) => x.rule)).not.toContain('table');
    expect(s.map((x) => x.rule)).not.toContain('title_block');
    for (const x of s) expect(overlapShare(x.box, big)).toBeLessThanOrEqual(GRID_OVERLAP_MAX);
  });

  it('makes no table suggestion without grid evidence; bands are checked against the beams', () => {
    const none = suggestExcludes(sheetLines(), [W, H], null, null, null);
    expect(none.map((x) => x.rule)).toEqual(['frame', 'frame', 'frame', 'frame', 'title_block']);
    const beams = { x0: 20, y0: 20, x1: 900, y1: 700 };
    const guarded = suggestExcludes(sheetLines(), [W, H], null, null, beams);
    expect(guarded.map((x) => x.rule)).not.toContain('title_block');
  });

  it('clips suggestions to the view box and needs enough lines for a table', () => {
    const view = { x0: 0, y0: 0, x1: 500, y1: 800 };
    const s = suggestExcludes(sheetLines(), [W, H], view, grid, null);
    for (const x of s) expect(x.box.x1).toBeLessThanOrEqual(500);
    const few = sheetLines().slice(0, 5 + TABLE_MIN_LINES - 1);
    expect(suggestExcludes(few, [W, H], null, grid, null).map((x) => x.rule)).not.toContain(
      'table',
    );
  });
});

describe('views (pure)', () => {
  const view = (position: number, box: object | null): LoadedView =>
    ({
      row: { id: `v${position}`, position, box },
      behaviour: 'framing',
      pens: [],
      plan_sheet_id: null,
      exclusions: [],
      deselections: [],
    }) as unknown as LoadedView;

  it('a point belongs to the smallest view box holding it, else the first view', () => {
    const views = [
      view(1, { x0: 0, y0: 0, x1: 1000, y1: 800 }),
      view(2, { x0: 500, y0: 0, x1: 900, y1: 400 }),
    ];
    expect(viewAt(views, 600, 100)!.row.id).toBe('v2');
    expect(viewAt(views, 100, 100)!.row.id).toBe('v1');
    expect(viewAt(views, 5000, 5000)!.row.id).toBe('v1');
  });

  it('a page shows the badge of the view that needs the most attention', () => {
    expect(combineBadges(['Built', 'Requesting Build'])).toBe('Requesting Build');
    expect(combineBadges(['Skip', 'Built'])).toBe('Built');
    expect(combineBadges(['Skip', 'Skip'])).toBe('Skip');
    expect(combineBadges(['Reviewed', 'Reviewed'])).toBe('Reviewed');
  });
});

// ---- routes on the test database -----------------------------------------------------------------
describe('view routes (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let planId: string;
  let v1: string;
  let v2: string;
  const jobs: string[] = [];
  const roleNames: string[] = [];
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const del = (url: string, payload: object) =>
    app.inject({ method: 'DELETE', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
  const firstViewOrNull = async (id: string) =>
    (await db
      .selectFrom('build_views')
      .select(['id', 'position', 'box'])
      .where('id', '=', id)
      .executeTakeFirst()) ?? null;
  const log = async () =>
    db
      .selectFrom('count_actions')
      .select(['action', 'sheet_id', 'detail', 'who'])
      .where('project_id', '=', projectId)
      .orderBy('id')
      .execute();

  beforeAll(async () => {
    projectId = await insertProject(db);
    planId = await insertSheet(db, projectId, { page_index: 0, width_pt: W, height_pt: H });
    sheetId = await insertSheet(db, projectId, { page_index: 1, width_pt: W, height_pt: H });
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
    await db
      .insertInto('sheet_lines')
      .values({
        sheet_id: sheetId,
        classes: JSON.stringify(['0.5-1|black|solid', '1.5-2.5|black|solid']),
        lines: JSON.stringify([
          [100, 100, 400, 100, 1, 2],
          [100, 300, 400, 300, 0, 0.7],
          ...sheetLines(),
        ]),
        n_lines: 2 + sheetLines().length,
        version: 'v1',
      })
      .execute();
  });

  afterAll(async () => {
    if (jobs.length) await db.deleteFrom('jobs').where('id', 'in', jobs).execute();
    await deleteProject(db, projectId);
    if (roleNames.length)
      await db.deleteFrom('role_names').where('name', 'in', roleNames).execute();
    await closeDatabaseConnection();
  });

  it('every new page has a first view; a second view is drawn as a box and logged', async () => {
    const first = await firstView(db, sheetId);
    expect([first.position, first.name, first.box]).toEqual([1, 'View 1', null]);
    v1 = first.id;
    const bad = await post(`/sheets/${sheetId}/build-views`, {
      box: { x0: 10, y0: 10, x1: 5, y1: 20 },
      who: WHO,
    });
    expect(bad.statusCode).toBe(400);
    const res = await post(`/sheets/${sheetId}/build-views`, {
      box: { x0: 500, y0: 0, x1: 900, y1: 400 },
      who: WHO,
    });
    expect(res.statusCode).toBe(201);
    v2 = res.json().id;
    expect(res.json()).toMatchObject({ position: 2, name: 'View 2', role_name: null, pens: [] });
    const rows = await log();
    expect(rows.at(-1)).toMatchObject({
      action: 'setup',
      sheet_id: sheetId,
      detail: { field: 'view_add', view_id: v2, position: 2 },
    });
  });

  it('the setup routes act on the named view (first view by default), each with its own scale', async () => {
    const box = { x0: 0, y0: 0, x1: 500, y1: 800 };
    expect((await post(`/sheets/${sheetId}/build-setup/crop`, { box, who: WHO })).statusCode).toBe(
      200,
    );
    await post(`/sheets/${sheetId}/build-setup/scale`, { ratio: 96, who: WHO });
    await post(`/sheets/${sheetId}/build-setup/scale`, { ratio: 48, view_id: v2, who: WHO });
    await post(`/sheets/${sheetId}/build-setup/tos`, { tos_mm: 0, source: 'typed', who: WHO });
    await post(`/sheets/${sheetId}/build-setup/tos`, {
      tos_mm: 3000,
      source: 'typed',
      view_id: v2,
      who: WHO,
    });
    const views = (await get(`/sheets/${sheetId}/build`)).json().views;
    expect(views.map((v: { scale_ratio: number }) => v.scale_ratio)).toEqual([96, 48]);
    expect(views.map((v: { tos_mm: number }) => v.tos_mm)).toEqual([0, 3000]);
    const edits = await db
      .selectFrom('sheet_edits')
      .select('field_name')
      .where('sheet_id', '=', sheetId)
      .execute();
    expect(edits.map((e) => e.field_name)).toContain('view2.build_scale');
    const foreign = await post(`/sheets/${planId}/build-setup/scale`, {
      ratio: 96,
      view_id: v2,
      who: WHO,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('roles: built-in names, a custom name with a behaviour (logged), edited later', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/role-names' })).json().roles;
    expect(list.slice(0, 4).map((r: { name: string }) => r.name)).toEqual([
      'Column plan',
      'Framing plan',
      'Roof framing',
      'Foundation plan',
    ]);
    const name = uniqueLabel('Mezzanine framing');
    roleNames.push(name);
    const add = await app.inject({
      method: 'POST',
      url: '/api/role-names',
      payload: { name, behaviour: 'framing', who: WHO, project_id: projectId, sheet_id: sheetId },
    });
    expect(add.statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/role-names',
      payload: { name: name.toUpperCase(), behaviour: 'none', who: WHO, project_id: projectId },
    });
    expect(dup.statusCode).toBe(409);
    const set = await post(`/sheets/${sheetId}/build-setup/role`, {
      role_name: name,
      view_id: v2,
      who: WHO,
    });
    expect(set.json()).toMatchObject({ role: 'framing', role_name: name, behaviour: 'framing' });
    await post(`/sheets/${sheetId}/build-setup/role`, { role: 'framing', who: WHO });
    expect((await firstView(db, sheetId)).role_name).toBe('Framing plan');
    expect(
      (await post(`/sheets/${sheetId}/build-setup/role`, { role_name: 'No such role', who: WHO }))
        .statusCode,
    ).toBe(400);
    const builtIn = await app.inject({
      method: 'PATCH',
      url: `/api/role-names/${encodeURIComponent('Detail')}`,
      payload: { behaviour: 'framing', who: WHO, project_id: projectId },
    });
    expect(builtIn.statusCode).toBe(400);
    // marking: the view's setup changed when the behaviour of its role name changes
    await db
      .updateTable('build_views')
      .set({ setup_changed_at: null })
      .where('id', '=', v2)
      .execute();
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/role-names/${encodeURIComponent(name)}`,
      payload: { behaviour: 'column_plan', who: WHO, project_id: projectId, sheet_id: sheetId },
    });
    expect(edit.json()).toMatchObject({ behaviour: 'column_plan', views_marked: 1 });
    const back = await app.inject({
      method: 'PATCH',
      url: `/api/role-names/${encodeURIComponent(name)}`,
      payload: { behaviour: 'framing', who: WHO, project_id: projectId },
    });
    expect(back.statusCode).toBe(200);
    const roles = (await log()).filter((r) => r.action === 'role');
    expect(roles.map((r) => (r.detail as { kind: string }).kind)).toEqual(['add', 'edit', 'edit']);
  });

  it('pens: Replace pen, Add pen (a second pen), remove one', async () => {
    const one = await post(`/sheets/${sheetId}/build-setup/pick-pen`, {
      x: 200,
      y: 301,
      view_id: v2,
      who: WHO,
    });
    expect(one.json()).toMatchObject({ pens: ['0.5-1|black|solid'], mode: 'replace' });
    const two = await post(`/sheets/${sheetId}/build-setup/pick-pen`, {
      x: 200,
      y: 101,
      mode: 'add',
      view_id: v2,
      who: WHO,
    });
    expect(two.json().pens).toEqual(['0.5-1|black|solid', '1.5-2.5|black|solid']);
    const again = await post(`/sheets/${sheetId}/build-setup/pick-pen`, {
      x: 200,
      y: 101,
      mode: 'add',
      view_id: v2,
      who: WHO,
    });
    expect(again.json().pens).toHaveLength(2);
    const rm = await post(`/sheets/${sheetId}/build-setup/remove-pen`, {
      pen_class: '0.5-1|black|solid',
      view_id: v2,
      who: WHO,
    });
    expect(rm.json().pens).toEqual(['1.5-2.5|black|solid']);
    await post(`/sheets/${sheetId}/build-setup/pick-pen`, {
      x: 200,
      y: 301,
      mode: 'add',
      view_id: v2,
      who: WHO,
    });
    const pens = await db
      .selectFrom('view_pens')
      .select(['position', 'pen_class'])
      .where('view_id', '=', v2)
      .orderBy('position')
      .execute();
    expect(pens).toEqual([
      { position: 1, pen_class: '1.5-2.5|black|solid' },
      { position: 2, pen_class: '0.5-1|black|solid' },
    ]);
    await post(`/sheets/${sheetId}/build-setup/pick-pen`, { x: 200, y: 101, who: WHO });
  });

  it('exclusions: drawn boxes count at once; suggestions only once accepted', async () => {
    await db
      .updateTable('build_views')
      .set({ setup_changed_at: null })
      .where('id', '=', v1)
      .execute();
    const add = await post(`/sheets/${sheetId}/build-views/${v1}/exclusions`, {
      box: { x0: 400, y0: 600, x1: 480, y1: 700 },
      who: WHO,
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().view.exclusions).toHaveLength(1);
    expect((await firstView(db, sheetId)).setup_changed_at).not.toBeNull();
    // suggestions: no grid evidence (never built), so frame and title bands only, inside the view
    await db
      .updateTable('build_views')
      .set({ setup_changed_at: null })
      .where('id', '=', v1)
      .execute();
    const sug = await post(`/sheets/${sheetId}/build-views/${v1}/exclusions/suggest`, { who: WHO });
    expect(sug.statusCode).toBe(200);
    expect(sug.json().grid_evidence).toBe(false);
    const open = sug
      .json()
      .view.exclusions.filter((e: { status: string }) => e.status === 'suggested');
    expect(open.map((e: { rule: string }) => e.rule)).toEqual(['frame', 'frame', 'frame']);
    for (const e of open) expect(e.box.x1).toBeLessThanOrEqual(500);
    expect((await firstView(db, sheetId)).setup_changed_at).toBeNull(); // not a build input yet
    const one = await post(`/sheets/${sheetId}/build-views/${v1}/exclusions/accept`, {
      ids: [open[0].id],
      who: WHO,
    });
    expect(one.json().accepted).toBe(1);
    expect((await firstView(db, sheetId)).setup_changed_at).not.toBeNull();
    const all = await post(`/sheets/${sheetId}/build-views/${v1}/exclusions/accept`, {
      all: true,
      who: WHO,
    });
    expect(all.json().accepted).toBe(2);
    const again = await post(`/sheets/${sheetId}/build-views/${v1}/exclusions/suggest`, {
      who: WHO,
    });
    expect(again.json().suggested).toBe(0); // accepted boxes are not proposed again
    const rm = await del(`/sheets/${sheetId}/build-views/${v1}/exclusions/${add.json().id}`, {
      who: WHO,
    });
    expect(rm.json().view.exclusions).toHaveLength(3);
    const rows = (await log()).filter((r) =>
      String((r.detail as { field?: string }).field).startsWith('exclusion'),
    );
    expect(rows.map((r) => (r.detail as { field: string }).field)).toEqual([
      'exclusion_add',
      'exclusion_suggest',
      'exclusion_accept',
      'exclusion_accept',
      'exclusion_suggest',
      'exclusion_delete',
    ]);
  });

  it('deselections: a click toggles, ctrl+drag adds many, reset clears; all logged', async () => {
    const line = [100, 100, 400, 100];
    const off = await post(`/sheets/${sheetId}/build-views/${v1}/deselections/toggle`, {
      line,
      line_index: 0,
      who: WHO,
    });
    expect(off.json().deselected).toBe(true);
    expect(off.json().view.deselections.map((d: { line: number[] }) => d.line)).toEqual([line]);
    const on = await post(`/sheets/${sheetId}/build-views/${v1}/deselections/toggle`, {
      line,
      who: WHO,
    });
    expect(on.json().deselected).toBe(false);
    expect(on.json().view.deselections).toEqual([]);
    const box = await post(`/sheets/${sheetId}/build-views/${v1}/deselections/box`, {
      lines: [{ line }, { line: [100, 300, 400, 300] }, { line }],
      who: WHO,
    });
    expect(box.json().deselected).toBe(2);
    const stored = await db
      .selectFrom('view_deselections')
      .select(['lines_version', 'created_by'])
      .where('view_id', '=', v1)
      .execute();
    expect(stored).toEqual([
      { lines_version: 'v1', created_by: WHO },
      { lines_version: 'v1', created_by: WHO },
    ]);
    const reset = await post(`/sheets/${sheetId}/build-views/${v1}/deselections/reset`, {
      who: WHO,
    });
    expect(reset.json()).toMatchObject({ reset: 2, view: { deselections: [] } });
    const fields = (await log())
      .map((r) => (r.detail as { field?: string }).field)
      .filter((f) => f && /select/.test(f));
    expect(fields).toEqual(['deselect', 'reselect', 'deselect_box', 'deselect_reset']);
  });

  it('the page Build queues one run per building view; a refused view is reported', async () => {
    const res = await post(`/sheets/${sheetId}/build`, {
      who: WHO,
      no_column_plan: true,
      allow_system_values: true,
    });
    expect(res.statusCode).toBe(202);
    const runs = res.json().runs as { view_id: string; job_id: string }[];
    jobs.push(...runs.map((r) => r.job_id));
    expect(runs.map((r) => r.view_id)).toEqual([v1, v2]);
    const busy = await post(`/sheets/${sheetId}/build`, {
      who: WHO,
      view_id: v2,
      no_column_plan: true,
    });
    expect(busy.statusCode).toBe(409);
    await db
      .updateTable('build_runs')
      .set({
        status: 'done',
        finished_at: new Date(),
        counts: JSON.stringify({ deselections_unmatched: 2 }),
      })
      .where('sheet_id', '=', sheetId)
      .where('status', '=', 'pending')
      .execute();
    await db
      .updateTable('build_views')
      .set({ built_at: new Date() })
      .where('sheet_id', '=', sheetId)
      .execute();
    // a third view with no scale is refused alone; the others still build
    const v3 = (
      await post(`/sheets/${sheetId}/build-views`, {
        box: { x0: 0, y0: 0, x1: 100, y1: 100 },
        who: WHO,
      })
    ).json().id;
    await post(`/sheets/${sheetId}/build-setup/role`, {
      role_name: 'Framing plan',
      view_id: v3,
      who: WHO,
    });
    const part = await post(`/sheets/${sheetId}/build`, {
      who: WHO,
      no_column_plan: true,
      allow_system_values: true,
    });
    expect(part.statusCode).toBe(202);
    jobs.push(...(part.json().runs as { job_id: string }[]).map((r) => r.job_id));
    expect(part.json().refused).toMatchObject([
      { view_id: v3, reasons: ['no scale', 'no beam pen class'] },
    ]);
    const page = (await get('/pages')).json().pages.find((p: { id: string }) => p.id === sheetId);
    expect(page.views.map((v: { name: string }) => v.name)).toEqual(['View 1', 'View 2', 'View 3']);
    expect(page.reasons).toContain('View 3: no scale');
    expect(page.badge).toBe('Building');
    const canvas = (await get(`/sheets/${sheetId}/line-first`)).json();
    expect(
      canvas.views.map((v: { deselections_unmatched: number }) => v.deselections_unmatched),
    ).toEqual([2, 2, 0]);
    const del3 = await del(`/sheets/${sheetId}/build-views/${v3}`, { who: WHO });
    expect(del3.json()).toEqual({ ok: true, pieces_removed: 0, pieces_kept: 0 });
    expect((await del(`/sheets/${sheetId}/build-views/${v1}`, { who: WHO })).statusCode).toBe(400);
  });

  it('set size for all undefined beams of a view is one logged, undoable action', async () => {
    const run = await db
      .insertInto('build_runs')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        view_id: v2,
        requested_by: 'x',
        status: 'done',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const ids: string[] = [];
    for (const y of [50, 150, 250]) {
      const row = await db
        .insertInto('members')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          build_view_id: v2,
          member_id: `LF-B-sz${y}`,
          origin: 'extracted',
          type: 'beam',
          kind: 'Beams',
          build_run_id: run.id,
          size_state: 'undefined',
          build_state: 'attention',
          support_state: 'both',
          page_x0: 550,
          page_y0: y,
          page_x1: 850,
          page_y1: y,
          start_x_mm: 0,
          start_y_mm: 0,
          end_x_mm: 1000,
          end_y_mm: 0,
          plan_scale_ratio: 48,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    const before = (await log()).length;
    const res = await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: ids,
      profile_text: 'W16X26',
    });
    expect(res.statusCode).toBe(200);
    const after = await log();
    expect(after.length - before).toBe(1);
    expect(after.at(-1)).toMatchObject({ action: 'edit', sheet_id: sheetId });
    const states = (await get(`/sheets/${sheetId}/line-first`))
      .json()
      .pieces.filter((p: { id: string }) => ids.includes(p.id));
    expect(states.map((p: { build_state: string }) => p.build_state)).toEqual([
      'found',
      'found',
      'found',
    ]);
    expect(states.every((p: { build_view_id: string }) => p.build_view_id === v2)).toBe(true);
    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    const back = (await get(`/sheets/${sheetId}/line-first`))
      .json()
      .pieces.filter((p: { id: string }) => ids.includes(p.id));
    expect(back.map((p: { profile: string | null }) => p.profile)).toEqual([null, null, null]);
  });

  it('deleting a view removes its untouched pieces, keeps edited ones on View 1; undo puts it back', async () => {
    const run = await db
      .selectFrom('build_runs')
      .select('id')
      .where('view_id', '=', v2)
      .executeTakeFirstOrThrow();
    // one untouched built piece of view 2 (the three of the test before carry edit rows: touched)
    const loose = await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        build_view_id: v2,
        member_id: 'LF-B-loose',
        origin: 'extracted',
        type: 'beam',
        kind: 'Beams',
        build_run_id: run.id,
        size_state: 'undefined',
        build_state: 'attention',
        support_state: 'both',
        page_x0: 560,
        page_y0: 350,
        page_x1: 840,
        page_y1: 350,
        plan_scale_ratio: 48,
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    const node = await db
      .insertInto('support_nodes')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        build_run_id: run.id,
        x_pt: 560,
        y_pt: 350,
        source: 'glyph',
        column_member_id: loose.id,
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    const pagesBefore = (await get('/pages'))
      .json()
      .pages.find((p: { id: string }) => p.id === sheetId);
    const res = await del(`/sheets/${sheetId}/build-views/${v2}`, { who: WHO });
    expect(res.json()).toEqual({ ok: true, pieces_removed: 1, pieces_kept: 3 });
    expect((await log()).at(-1)).toMatchObject({
      action: 'setup',
      detail: { field: 'view_delete', view_id: v2, pieces_removed: 1, pieces_kept: 3 },
    });
    const kept = await db
      .selectFrom('members')
      .select(['id', 'build_view_id'])
      .where('sheet_id', '=', sheetId)
      .where('member_id', 'like', 'LF-B-sz%')
      .execute();
    expect(kept.map((k) => k.build_view_id)).toEqual([null, null, null]);
    expect(
      await db.selectFrom('members').select('id').where('id', '=', loose.id).executeTakeFirst(),
    ).toBeUndefined();
    // the delete counts as a pending edit, so the Undo button is on
    const pagesAfter = (await get('/pages'))
      .json()
      .pages.find((p: { id: string }) => p.id === sheetId);
    expect(pagesAfter.pending_edits).toBe(pagesBefore.pending_edits + 1);

    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().view).toMatchObject({
      kind: 'delete',
      view_id: v2,
      applied: true,
      pieces_restored: 1,
    });
    const back = await firstViewOrNull(v2);
    expect(back).toMatchObject({ id: v2, position: 2 });
    const pens = await db.selectFrom('view_pens').select('id').where('view_id', '=', v2).execute();
    expect(pens.length).toBeGreaterThan(0);
    expect(
      (
        await db
          .selectFrom('members')
          .select('build_view_id')
          .where('id', '=', loose.id)
          .executeTakeFirstOrThrow()
      ).build_view_id,
    ).toBe(v2);
    expect(
      (
        await db
          .selectFrom('support_nodes')
          .select('column_member_id')
          .where('id', '=', node.id)
          .executeTakeFirstOrThrow()
      ).column_member_id,
    ).toBe(loose.id);
    const kept2 = await db
      .selectFrom('members')
      .select('build_view_id')
      .where('sheet_id', '=', sheetId)
      .where('member_id', 'like', 'LF-B-sz%')
      .execute();
    expect(kept2.map((k) => k.build_view_id)).toEqual([v2, v2, v2]);
    expect(
      (
        await db
          .selectFrom('build_runs')
          .select('view_id')
          .where('id', '=', run.id)
          .executeTakeFirstOrThrow()
      ).view_id,
    ).toBe(v2);
    expect((await log()).at(-1)).toMatchObject({
      action: 'undo',
      sheet_id: sheetId,
      detail: { view_change: 'delete', view_id: v2, applied: true, pieces_restored: 1 },
    });
    const pagesUndone = (await get('/pages'))
      .json()
      .pages.find((p: { id: string }) => p.id === sheetId);
    expect(pagesUndone.pending_edits).toBe(pagesBefore.pending_edits);
  });

  it('undo takes back a box change and a view add, newest first, after newer piece edits', async () => {
    const box0 = (await firstViewOrNull(v2))!.box;
    const moved = { x0: 520, y0: 10, x1: 880, y1: 390 };
    expect(
      (await post(`/sheets/${sheetId}/build-setup/crop`, { box: moved, view_id: v2, who: WHO }))
        .statusCode,
    ).toBe(200);
    const added = await post(`/sheets/${sheetId}/build-views`, {
      box: { x0: 20, y0: 500, x1: 300, y1: 780 },
      who: WHO,
    });
    const v4 = added.json().id as string;
    // newest first: the add, then the box
    const u1 = await post('/undo', { who: WHO });
    expect(u1.json().view).toMatchObject({ kind: 'add', view_id: v4, applied: true });
    expect(await firstViewOrNull(v4)).toBeNull();
    const u2 = await post('/undo', { who: WHO });
    expect(u2.json().view).toMatchObject({ kind: 'box', view_id: v2, applied: true });
    expect((await firstViewOrNull(v2))!.box).toEqual(box0);
    // a piece edit newer than any open view change is undone first
    const crop2 = await post(`/sheets/${sheetId}/build-setup/crop`, {
      box: moved,
      view_id: v2,
      who: WHO,
    });
    expect(crop2.statusCode).toBe(200);
    const piece = await db
      .selectFrom('members')
      .select('id')
      .where('sheet_id', '=', sheetId)
      .where('member_id', '=', 'LF-B-sz50')
      .executeTakeFirstOrThrow();
    await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [piece.id],
      profile_text: 'W12X19',
    });
    const u3 = await post('/undo', { who: WHO });
    expect(u3.json().view).toBeUndefined();
    expect(u3.json().undone).toBeTruthy();
    const u4 = await post('/undo', { who: WHO });
    expect(u4.json().view).toMatchObject({ kind: 'box', view_id: v2 });
    // another person's view changes are not on this person's stack
    await post(`/sheets/${sheetId}/build-setup/crop`, {
      box: moved,
      view_id: v2,
      who: 'someone else',
    });
    await post('/undo', { who: WHO });
    const theirs = await db
      .selectFrom('view_undo')
      .select('undone_at')
      .where('who', '=', 'someone else')
      .execute();
    expect(theirs.map((r) => r.undone_at)).toEqual([null]);
    await db.deleteFrom('count_actions').where('who', '=', 'someone else').execute();
  });

  it('the setup and role log rows hold ids and counts only, never page text', async () => {
    const rows = (await log()).filter((r) => r.action === 'setup' || r.action === 'role');
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.who).toBe(WHO);
      for (const v of Object.values(r.detail as Record<string, unknown>))
        expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
      const d = r.detail as Record<string, unknown>;
      expect(Object.keys(d).every((k) => !/^(name|text|box|line|raw|title)$/.test(k))).toBe(true);
    }
  });

  it('the first view reads like the page did before views', async () => {
    const page = await db
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .executeTakeFirstOrThrow();
    const v = (await import('../review/build-views.js')).viewsOf;
    const s = asSheet(page, (await v(db, sheetId))[0]!);
    expect(s.build_role).toBe('framing');
    expect(Number(s.build_scale_ratio)).toBe(96);
    expect(s.pen_class).toBe('1.5-2.5|black|solid');
    expect(s.crop_region).toEqual({ x0: 0, y0: 0, x1: 500, y1: 800 });
  });
});
