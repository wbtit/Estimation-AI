// Phase 10 Parts B and C: "x N typical" on a counted piece (owner decision 126) and counted pieces
// without a length (owner decision 127). Synthetic project and sheet.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type ExcelJS from 'exceljs';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { weightTotals, type TableRow } from '../review/tables.js';
import { deleteProject, insertProject, insertSheet, loadWorkbook } from './helpers.js';

interface Row {
  id: string;
  quantity: number;
  status: { color: string; reasons: string[] };
  typical: { n: number; note: string; base_quantity: number } | null;
}

const app = buildApp();
const db = getDb();
const WHO = 'alice';
let projectId: string;
let sheetId: string;
const ids: Record<string, string> = {};

const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
const get = (url: string) => app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
const member = async (id: string) =>
  ((await get('/members?include_deleted=true')).json().members as Row[]).find(
    (m) => m.id === id,
  ) as Row;
const typical = (id: string, body: object) => post(`/members/${id}/typical`, { who: WHO, ...body });
const cells = (ws: ExcelJS.Worksheet): string[] => {
  const out: string[] = [];
  ws.eachRow((r) => out.push(String(r.getCell(1).value)));
  return out;
};

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, {
    page_index: 0,
    page_type_guess: 'framing_plan',
    decided: 'include',
    width_pt: 1200,
    height_pt: 800,
  });
  await db
    .insertInto('sheet_views')
    .values({
      sheet_id: sheetId,
      box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
      scale_ratio: 96,
      scale_source: 'user_confirmed',
      scale_confirmed: true,
    })
    .execute();
  // a suggestion that nobody decided (a linked label)
  ids.sugg = (
    await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        member_id: 'M-S',
        origin: 'extracted',
        type: 'beam',
        profile_raw: 'W8x10',
        profile: 'W8X10',
        field_sources: '{}',
        field_confidence: '{}',
        source_bbox: JSON.stringify({ x0: 800, y0: 600, x1: 840, y1: 608 }),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

describe('typical x N (owner decision 126)', () => {
  it('is refused while the pilot (count mode) is off', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, count_mode: true },
    });
    const c = await post('/count/click', {
      who: WHO,
      sheet_id: sheetId,
      kind: 'Beams',
      x: 300,
      y: 300,
    });
    ids.piece = c.json().member.id;
    await post(`/members/${ids.piece}/typical`, { who: WHO, n: null }); // nothing to remove: no change
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, count_mode: false },
    });
    expect((await typical(ids.piece, { n: 4, note: 'typ. bay' })).statusCode).toBe(409);
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, count_mode: true },
    });
  });

  it('needs an integer of 2 or more and a note; only a counted piece can be typical', async () => {
    expect((await typical(ids.piece, { n: 1, note: 'x' })).statusCode).toBe(400);
    expect((await typical(ids.piece, { n: 2.5, note: 'x' })).statusCode).toBe(400);
    expect((await typical(ids.piece, { n: 3 })).statusCode).toBe(400);
    expect((await typical(ids.piece, { n: 3, note: '   ' })).statusCode).toBe(400);
    expect((await typical(ids.sugg, { n: 3, note: 'typ.' })).statusCode).toBe(409); // undecided
  });

  it('counts N in the member, amber with a reason; the tables and the takeoff count N', async () => {
    const r = await typical(ids.piece, { n: 6, note: '6 bays per the typical note' });
    expect(r.statusCode).toBe(200);
    const m = await member(ids.piece);
    expect(m.quantity).toBe(6);
    expect(m.typical).toEqual({ n: 6, note: '6 bays per the typical note', base_quantity: 1 });
    expect(m.status.color).toBe('amber');
    expect(m.status.reasons.join(' ')).toContain('typical x6');

    const t = (await get('/takeoff')).json();
    const row = t.rows.find((x: { member_ids: string[] }) => x.member_ids.includes(ids.piece));
    expect(row.quantity).toBe(6);
    expect(t.totals.pieces).toBe(6);

    const tables = (await get('/tables')).json();
    const jr = tables.job.rows.find((x: TableRow) => x.member_ids.includes(ids.piece));
    expect(jr.quantity).toBe(6);
    expect(jr.flags).toContain('typical x6');
    expect(tables.job.quantity).toBe(6);
    expect(tables.pages[0].quantity).toBe(6);
  });

  it('both Excel exports count N', async () => {
    const tw = await loadWorkbook(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables.xlsx` }))
        .rawPayload,
    );
    const job = tw.getWorksheet('Job') as ExcelJS.Worksheet;
    let total: unknown = null;
    job.eachRow((r) => {
      if (String(r.getCell(1).value) === 'TOTAL (main total)') total = r.getCell(3).value;
    });
    expect(total).toBe(6);
    const kw = await loadWorkbook(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` }))
        .rawPayload,
    );
    const take = kw.getWorksheet('Takeoff') as ExcelJS.Worksheet;
    let pieces: unknown = null;
    take.eachRow((r) => {
      if (String(r.getCell(1).value).startsWith('TOTAL (rows in totals)'))
        pieces = r.getCell(4).value;
    });
    expect(pieces).toBe(6);
  });

  it('edit and remove are logged; undo brings the multiplier back', async () => {
    await typical(ids.piece, { n: 4, note: 'four bays' });
    expect((await member(ids.piece)).quantity).toBe(4);
    await typical(ids.piece, { n: null });
    const m = await member(ids.piece);
    expect(m.quantity).toBe(1);
    expect(m.typical).toBeNull();
    expect(m.status.reasons.join(' ')).not.toContain('typical');
    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    expect((await member(ids.piece)).typical).toMatchObject({ n: 4 });
    const log = (await get('/count-actions')).json();
    const changes = log.actions
      .filter((a: { action: string }) => a.action === 'typical')
      .map((a: { detail: { change: string } }) => a.detail.change);
    expect(changes).toEqual(['create', 'edit', 'remove']);
  });

  it('a quantity typed on a typical piece is the base quantity', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.piece}`,
      payload: { who: WHO, quantity: 2 },
    });
    expect(r.statusCode).toBe(200);
    const m = await member(ids.piece);
    expect(m.typical).toMatchObject({ n: 4, base_quantity: 2 });
    expect(m.quantity).toBe(8);
  });
});

describe('counted pieces without a length (owner decision 127)', () => {
  it('weightTotals: weight of rows with a length and a Unit W; the others counted apart', () => {
    const row = (q: number, ft: number | null, w: number | null): TableRow =>
      ({
        quantity: q,
        length_ft: ft,
        unit_w: w,
        total_w: ft !== null && w !== null ? q * ft * w : null,
      }) as TableRow;
    expect(weightTotals([row(2, 10, 26), row(3, null, 26), row(1, 12, null)])).toEqual({
      total_w: 520,
      pieces_without_length: 3,
      pieces_without_unit_w: 1,
    });
    expect(weightTotals([])).toEqual({
      total_w: 0,
      pieces_without_length: 0,
      pieces_without_unit_w: 0,
    });
  });

  it('they stay in the quantity; Total W stays blank; job and page totals say how many', async () => {
    const c = await post('/count/click', {
      who: WHO,
      sheet_id: sheetId,
      kind: 'Beams',
      x: 900,
      y: 700,
    });
    ids.second = c.json().member.id;
    const tables = (await get('/tables')).json();
    // the tables count one per piece (N for a typical one), whatever the label quantity: 4 + 1
    expect(tables.job.quantity).toBe(5);
    for (const r of tables.job.rows as TableRow[]) expect(r.total_w).toBeNull();
    expect(tables.job.weight).toEqual({
      total_w: 0,
      pieces_without_length: tables.job.quantity,
      pieces_without_unit_w: 0,
    });
    expect(tables.pages[0].weight.pieces_without_length).toBe(tables.pages[0].quantity);
  });

  it('the Excel exports add the line next to the weight', async () => {
    const tw = await loadWorkbook(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables.xlsx` }))
        .rawPayload,
    );
    const jobLines = cells(tw.getWorksheet('Job') as ExcelJS.Worksheet);
    expect(jobLines.some((c) => c.startsWith('Total W (lb)'))).toBe(true);
    expect(jobLines.some((c) => /^\d+ pieces without length/.test(c))).toBe(true);
    const kw = await loadWorkbook(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` }))
        .rawPayload,
    );
    const take = cells(kw.getWorksheet('Takeoff') as ExcelJS.Worksheet);
    expect(take.some((c) => /^\d+ pieces without length/.test(c))).toBe(true);
  });
});
