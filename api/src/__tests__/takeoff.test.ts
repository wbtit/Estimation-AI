import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import { buildTakeoff } from '../review/takeoff.js';
import { deleteProject, insertProject, insertSheet, loadWorkbook } from './helpers.js';

function member(over: Partial<MemberView> & { color?: 'green' | 'amber' | 'red' }): MemberView {
  const { color = 'green', ...rest } = over;
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    member_id: 'M-x',
    sheet_id: 'sheet-14',
    view_id: 'v1',
    origin: 'extracted',
    type: 'beam',
    mark: null,
    profile_raw: 'W12x26',
    profile: 'W12X26',
    quantity: 1,
    level: 'Level 2',
    deleted: false,
    review_status: 'pending',
    bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
    mark_ref: { status: null, legend_row_id: null },
    link: {
      source: 'rule',
      confidence: 'high',
      margin: 50,
      line: null,
      chosen_rank: 1,
      candidates: [],
    },
    length_mm: 3000,
    length_ft_in: null,
    status: { color, confirmed: false, reasons: [] },
    system: null,
    human: 'unreviewed',
    joist_series: null,
    shared_line: null,
    length_shared: false,
    shared_resolution: null,
    merged_into: null,
    not_member: null,
    existing: false,
    ...rest,
  } as MemberView;
}

const pages = new Map([
  ['sheet-14', 14],
  ['sheet-15', 15],
]);

describe('takeoff grouping', () => {
  it('groups by level, mark and profile and adds up quantity and length', () => {
    const t = buildTakeoff(
      [
        member({ mark: 'B1', length_mm: 3000 }),
        member({ mark: 'B1', length_mm: 2000, sheet_id: 'sheet-15' }),
        member({ mark: 'B2', profile_raw: 'W10x12', profile: 'W10X12' }),
        member({ mark: 'B1', level: 'Roof' }),
      ],
      pages,
    );
    expect(t.rows).toHaveLength(3);
    const b1 = t.rows.find((r) => r.mark === 'B1' && r.level === 'Level 2')!;
    expect(b1.quantity).toBe(2);
    expect(b1.total_length_mm).toBe(5000);
    expect(b1.unit_lengths_mm).toEqual([2000, 3000]);
    expect(b1.sheets).toEqual([14, 15]);
    expect(b1.source.page_number).toBe(14);
    expect(t.totals.pieces).toBe(4);
    expect(t.by_level.map((l) => l.level)).toEqual(['Level 2', 'Roof']);
    expect(t.by_level[0].totals.pieces).toBe(3);
  });

  it('groups on canonical profile so spacing in the label does not split a row', () => {
    const t = buildTakeoff(
      [member({ profile_raw: 'W12x26' }), member({ profile_raw: 'W 12 X 26' })],
      pages,
    );
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].quantity).toBe(2);
  });

  it('keeps red members out of the main total and reports them on their own line', () => {
    const t = buildTakeoff(
      [
        member({ mark: 'B1', color: 'green', length_mm: 3000 }),
        member({ mark: 'B1', color: 'amber', length_mm: 1000 }),
        member({ mark: 'B1', color: 'red', length_mm: 4000 }),
        member({ mark: 'B3', color: 'red', length_mm: null }),
      ],
      pages,
    );
    expect(t.totals.pieces).toBe(2);
    expect(t.totals.total_length_mm).toBe(4000);
    expect(t.excluded_red.pieces).toBe(2);
    expect(t.excluded_red.total_length_mm).toBe(4000);
    expect(t.excluded_red.unmeasured).toBe(1);
    const included = t.rows.filter((r) => !r.excluded);
    expect(included).toHaveLength(1);
    expect(included[0].color).toBe('amber');
    expect(t.rows.at(-1)!.excluded).toBe(true);
    expect(t.by_level[0].totals.pieces).toBe(2);
  });

  it('ignores deleted members and counts unmeasured pieces', () => {
    const t = buildTakeoff(
      [
        member({ deleted: true }),
        member({ length_mm: null, color: 'amber', quantity: 3 }),
        member({ length_mm: 1000, color: 'amber' }),
      ],
      pages,
    );
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].quantity).toBe(4);
    expect(t.rows[0].unmeasured).toBe(3);
    expect(t.rows[0].total_length_mm).toBe(1000);
  });

  it('unlinked labels are in no total and no row; they are counted per sheet as a warning', () => {
    const lonely = (sheet: string) =>
      member({
        sheet_id: sheet,
        length_mm: null,
        status: { color: 'unlinked', confirmed: false, reasons: ['no candidate line'] },
      } as never);
    const t = buildTakeoff(
      [member({}), lonely('sheet-14'), lonely('sheet-14'), lonely('sheet-15')],
      pages,
    );
    expect(t.rows).toHaveLength(1);
    expect(t.totals.pieces).toBe(1);
    expect(t.excluded_red.pieces).toBe(0);
    expect(t.unlinked_labels).toEqual({
      count: 3,
      by_sheet: [
        { sheet_id: 'sheet-14', page_number: 14, count: 2 },
        { sheet_id: 'sheet-15', page_number: 15, count: 1 },
      ],
    });
  });

  it('joists have their own section, never mixed into the steel rows or totals', () => {
    const joist = (over = {}) =>
      member({
        type: 'joist',
        profile_raw: '24 K 7',
        profile: null,
        joist_series: { series: 'K', canonical: '24K7', depth: '24', number: '7' },
        ...over,
      } as never);
    const t = buildTakeoff(
      [
        member({}),
        joist(),
        joist({ length_mm: 6000 }),
        joist({ profile_raw: '24K7', level: 'Roof' }),
      ],
      pages,
    );
    expect(t.totals.pieces).toBe(1);
    expect(t.rows.every((r) => r.profile === 'W12X26')).toBe(true);
    expect(t.joists.totals.pieces).toBe(3);
    const l2 = t.joists.rows.find((r) => r.level === 'Level 2')!;
    expect(l2).toMatchObject({ profile: '24K7', quantity: 2, total_length_mm: 9000 });
    expect(t.joists.rows).toHaveLength(2);
  });

  it('keeps the system result and the human state apart, and counts unreviewed system output', () => {
    const sys = (color: 'green' | 'amber' | 'red') => ({ color, confirmed: false, reasons: [] });
    const t = buildTakeoff(
      [
        member({ system: sys('green'), human: 'unreviewed' }),
        member({ system: sys('amber'), human: 'confirmed', color: 'green' } as never),
        member({ system: sys('amber'), human: 'edited', length_mm: 1000 }),
        member({ system: sys('red'), human: 'unreviewed', color: 'red' } as never),
        member({ system: null, human: 'edited' }),
        member({ system: sys('green'), human: 'not_member', not_member: { reason: 'existing' } }),
        member({ system: sys('green'), human: 'deleted', deleted: true }),
      ],
      pages,
    );
    expect(t.review.system).toEqual({
      green: 3,
      amber: 2,
      red: 1,
      unlinked: 0,
      added_by_person: 1,
    });
    expect(t.review.human).toEqual({
      unreviewed: 2,
      confirmed: 1,
      edited: 2,
      existing: 0,
      not_member: 1,
      deleted: 1,
    });
    // main total: the green unreviewed, the confirmed, the edited, the added one (4 pieces); red held out
    expect(t.totals.pieces).toBe(4);
    expect(t.review.main_total_unreviewed).toMatchObject({
      pieces: 1,
      of_pieces: 4,
      total_length_mm: 3000,
      of_length_mm: 10000,
    });
  });

  it('is empty and zero for a project without members', () => {
    const t = buildTakeoff([], pages);
    expect(t.rows).toEqual([]);
    expect(t.totals.pieces).toBe(0);
    expect(t.excluded_red.pieces).toBe(0);
  });
});

describe('takeoff routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;

  beforeAll(async () => {
    projectId = await insertProject(db);
    const sheetId = await insertSheet(db, projectId, {
      page_index: 13,
      page_type_guess: 'framing_plan',
      decided: 'include',
      width_pt: 1200,
      height_pt: 800,
    });
    const view = await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheetId,
        box: JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 }),
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [mark, x] of [
      ['C1', 172],
      ['C1', 300],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/members`,
        payload: {
          view_id: view.id,
          type: 'column',
          mark,
          profile_text: 'HSS 6 x 6 x 3/8',
          point: { x, y: 400 },
          base_elevation: '0\'-0"',
          top_elevation: '12\'-6"',
          who: 'alice',
        },
      });
      expect(res.statusCode).toBe(201);
    }
    // a column with no base elevation: red, must be excluded
    const red = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: view.id,
        type: 'column',
        mark: 'C2',
        profile_text: 'W10x33',
        point: { x: 500, y: 400 },
        top_elevation: '12\'-6"',
        who: 'alice',
      },
    });
    expect(red.statusCode).toBe(201);
    // Stage 1 colours do not depend on lengths: make it red by an ambiguous mark instead
    await db
      .updateTable('members')
      .set({ mark_ref_status: 'ambiguous' })
      .where('id', '=', red.json().id)
      .execute();
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
  });

  it('returns rows, totals and the excluded (red) line', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const c1 = body.rows.find((r: { mark: string }) => r.mark === 'C1');
    expect(c1.quantity).toBe(2);
    expect(c1.excluded).toBe(false);
    expect(c1.sheets).toEqual([14]);
    expect(c1.total_length_mm).toBeCloseTo(2 * 3810, 0);
    expect(body.totals.pieces).toBe(2);
    expect(body.excluded_red.pieces).toBe(1);
    const c2 = body.rows.find((r: { mark: string }) => r.mark === 'C2');
    expect(c2.excluded).toBe(true);
    expect(c2.color).toBe('red');
    expect(JSON.stringify(body)).not.toMatch(/weight|price|cost/i);
  });

  it('404 for an unknown project', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects/00000000-0000-4000-8000-000000000000/takeoff',
    });
    expect(res.statusCode).toBe(404);
  });

  it('exports an xlsx with the table, totals and no weight or price column', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = await loadWorkbook(res.rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Takeoff',
      'Summary',
      'Joists',
      'Existing (not counted)',
      'Grades',
      'Sheets',
    ]);
    const ws = wb.getWorksheet('Takeoff')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    expect(header).toContain('Mark');
    expect(header).toContain('Total length (mm)');
    expect(header.join('|')).not.toMatch(/weight|price|cost/i);
    const cells: string[] = [];
    ws.eachRow((row) => cells.push(String(row.getCell(1).value)));
    expect(cells).toContain('C1');
    expect(cells).toContain('TOTAL (rows in totals)');
    expect(cells).toContain('EXCLUDED (red), not in totals');
    const total = ws
      .getRows(1, ws.rowCount)!
      .find((r) => r.getCell(1).value === 'TOTAL (rows in totals)')!;
    expect(total.getCell(4).value).toBe(2);
  });
});

describe('joists through the routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let viewId: string;
  const line = { p: [200, 300], q: [600, 300] };
  const post = (body: object) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: viewId,
        point: { x: 300, y: 300 },
        line,
        who: 'alice',
        ...body,
      },
    });

  beforeAll(async () => {
    projectId = await insertProject(db);
    const sheetId = await insertSheet(db, projectId, {
      page_index: 3,
      page_type_guess: 'framing_plan',
      decided: 'include',
      width_pt: 1200,
      height_pt: 800,
    });
    viewId = (
      await db
        .insertInto('sheet_views')
        .values({
          sheet_id: sheetId,
          box: JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 }),
          scale_ratio: 96,
          scale_source: 'user_confirmed',
          scale_confirmed: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
  });

  it('a joist designation makes a joist member with no AISC profile and the joist flag', async () => {
    const res = await post({ type: 'beam', profile_text: '28 LH 10' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: 'joist',
      profile: null,
      profile_raw: '28 LH 10',
      joist_series: { series: 'LH', canonical: '28LH10', depth: '28', number: '10' },
      status: { color: 'green' },
    });
  });

  it('typing a joist designation into a beam turns it into a joist (an edit, with undo)', async () => {
    const created = (await post({ type: 'beam', profile_text: 'W12x26' })).json();
    expect(created.type).toBe('beam');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${created.id}`,
      payload: { who: 'alice', profile_text: '24K7' },
    });
    expect(res.json().member).toMatchObject({ type: 'joist', profile: null });
    expect(res.json().member.joist_series.canonical).toBe('24K7');
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    const back = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members` }))
      .json()
      .members.find((m: { id: string }) => m.id === created.id);
    expect(back).toMatchObject({ type: 'beam', profile: 'W12X26' });
  });

  it('the takeoff and the Excel show joists in their own section', async () => {
    const t = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })
    ).json();
    expect(t.joists.rows.map((r: { profile: string }) => r.profile)).toEqual(['28LH10']);
    expect(t.rows.map((r: { profile: string }) => r.profile)).toEqual(['W12X26']);
    const x = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    const ws = (await loadWorkbook(x.rawPayload)).getWorksheet('Joists')!;
    expect(ws.getRow(2).getCell(1).value).toBe('28LH10');
    expect(ws.getRow(2).getCell(2).value).toBe('28 LH 10');
  });
});

afterAll(async () => {
  await closeDatabaseConnection();
});
