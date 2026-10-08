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
    shared_line: null,
    shared_resolution: null,
    merged_into: null,
    not_member: null,
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
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
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
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Takeoff', 'Summary']);
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
