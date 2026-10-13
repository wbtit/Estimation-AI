import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { setGrade } from '../review/grades.js';
import { classify, GRADE_SUGGESTION } from '../review/tables.js';
import {
  deleteEdition,
  deleteProject,
  insertProject,
  insertSheet,
  loadWorkbook,
  uniqueLabel,
} from './helpers.js';

const app = buildApp();
const db = getDb();
const edition = uniqueLabel('tables-test');
let projectId: string;
let planA: string;
let planB: string;
let detail: string;
const ids: Record<string, string> = {};

let lineNo = 0;
async function piece(key: string, sheet: string, over: Record<string, unknown> = {}) {
  lineNo += 1;
  const y = 100 * lineNo; // every piece has its own line (no shared-line flag)
  const row = await db
    .insertInto('members')
    .values({
      project_id: projectId,
      sheet_id: sheet,
      member_id: `M-${key}`,
      origin: 'extracted',
      type: 'beam',
      field_sources: '{}',
      field_confidence: '{}',
      link_confidence: 'high',
      profile_raw: 'W12x26',
      profile: 'W12X26',
      kind: 'Beams',
      kind_source: 'keyword',
      kind_evidence: JSON.stringify({
        status: 'set',
        where: 'same_line',
        keyword: 'beam',
        candidates: [],
      }),
      link_candidates: JSON.stringify([
        { rank: 1, p: [0, y], q: [500, y], score: 5, dist: 5, rel_angle: 0 },
      ]),
      source_bbox: JSON.stringify({
        x0: 10 + 50 * lineNo,
        y0: y - 20,
        x1: 30 + 50 * lineNo,
        y1: y - 10,
      }),
      ...over,
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  ids[key] = row.id;
}

const tables = async () =>
  (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables` })).json();

beforeAll(async () => {
  process.env.CATALOG_EDITION = edition;
  await importCatalog(db, edition, [
    {
      shape_name: 'W12X26',
      family: 'W',
      weight_kg_per_m: 38.7,
      weight_lb_per_ft: 26,
      properties: {},
    },
    {
      shape_name: 'HSS6X4X1/4',
      family: 'HSS',
      weight_kg_per_m: 23.2,
      weight_lb_per_ft: 15.62,
      properties: {},
    },
  ]);
  projectId = await insertProject(db);
  const size = { width_pt: 1200, height_pt: 800 };
  planA = await insertSheet(db, projectId, {
    page_index: 0,
    sheet_number: 'S1.1',
    page_type_guess: 'framing_plan',
    decided: 'include',
    ...size,
  });
  planB = await insertSheet(db, projectId, {
    page_index: 1,
    sheet_number: 'S1.2',
    page_type_guess: 'framing_plan',
    decided: 'include',
    ...size,
  });
  detail = await insertSheet(db, projectId, {
    page_index: 2,
    sheet_number: 'S9.1',
    page_type_guess: 'detail',
    decided: 'exclude',
    ...size,
  });
  for (const sheet of [planA, planB])
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheet,
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
        scale_ratio: 96,
        scale_source: 'detected_text',
        structural_classes: ['1.5-2.5|black|solid'],
      })
      .execute();
  // page A: three beams W12x26 (one amber), two HSS, one column, one with no kind, one not in catalog
  await piece('a1', planA, { tag_prefix: 'XX', tag_number: 1 });
  await piece('a2', planA, { tag_prefix: 'XX', tag_number: 2 });
  await piece('a3', planA, { tag_prefix: 'XX', tag_number: 3, link_confidence: 'medium' });
  await piece('h1', planA, {
    profile_raw: 'HSS6x4x1/4',
    profile: 'HSS6X4X1/4',
    kind: 'Vertical Brace',
    type: 'brace',
    tag_prefix: 'YY',
    tag_number: 1,
  });
  await piece('h2', planA, {
    profile_raw: 'HSS6x4x1/4',
    profile: 'HSS6X4X1/4',
    kind: 'Vertical Brace',
    type: 'brace',
    tag_prefix: 'YY',
    tag_number: 2,
  });
  await piece('nokind', planA, {
    kind: null,
    kind_source: null,
    kind_evidence: JSON.stringify({ status: 'missing', candidates: [] }),
    tag_number: 1,
  });
  await piece('uncat', planA, {
    profile_raw: 'W99x99',
    profile: 'W99X99',
    tag_prefix: 'XX',
    tag_number: 4,
  });
  // page B: the same beam size again
  await piece('b1', planB, { tag_prefix: 'XX', tag_number: 1 });
  // lines listed apart
  await piece('red', planA, { link_confidence: 'low', tag_prefix: 'XX', tag_number: 5 });
  await piece('joist', planA, {
    kind: 'Joist',
    type: 'joist',
    profile_raw: '24K7',
    profile: null,
    tag_prefix: 'ZZ',
    tag_number: 1,
  });
  await piece('stair', planA, {
    kind: 'Stair',
    profile_raw: 'C10x15',
    profile: 'C10X15',
    tag_prefix: 'WW',
    tag_number: 1,
  });
  await piece('unlinked', planA, {
    link_candidates: JSON.stringify([]),
    link_confidence: 'low',
    tag_prefix: 'XX',
    tag_number: 6,
  });
  // a piece on an excluded sheet is in no table
  await piece('onDetail', detail, { tag_prefix: 'XX', tag_number: 1 });
});

afterAll(async () => {
  delete process.env.CATALOG_EDITION;
  await deleteProject(db, projectId);
  await deleteEdition(db, edition);
  await closeDatabaseConnection();
});

describe('page table', () => {
  it('has one row per (kind, shape, size, name) group with Quantity = pieces, Kind first', async () => {
    const t = await tables();
    const a = t.pages.find((p: { page_number: number }) => p.page_number === 1);
    const view = a.rows.map((r: Record<string, unknown>) => [
      r.kind,
      r.shape,
      r.size,
      r.name,
      r.quantity,
    ]);
    expect(view).toEqual([
      ['Beams', 'W', '12X26', 'Beams', 3],
      ['Beams', 'W', '99X99', 'Beams', 1],
      ['Vertical Brace', 'HSS', '6X4X1/4', 'Vertical Brace', 2],
      [null, 'W', '12X26', '', 1],
    ]);
    expect(a.quantity).toBe(7);
    expect(a.sheet_number).toBe('S1.1');
  });

  it('leaves Length ft, Length In and Total W empty; Unit W only from the catalog', async () => {
    const a = (await tables()).pages[0];
    for (const r of a.rows)
      expect([r.length_ft, r.length_in, r.total_w]).toEqual([null, null, null]);
    const beams = a.rows.find(
      (r: { size: string; kind: string }) => r.size === '12X26' && r.kind === 'Beams',
    );
    expect(beams.unit_w).toBe(26);
    const uncat = a.rows.find((r: { size: string }) => r.size === '99X99');
    expect(uncat.unit_w).toBeNull();
    expect(uncat.flags).toContain('not in catalog');
    expect(uncat.colour).toBe('amber');
  });

  it('shows the worst colour of the pieces, and grey for a group with no kind', async () => {
    const a = (await tables()).pages[0];
    expect(a.rows[0].colour).toBe('amber'); // one of the three beams is medium confidence
    expect(a.rows[2].colour).toBe('green');
    const nokind = a.rows.at(-1);
    expect(nokind.colour).toBe('grey');
    expect(nokind.flags).toContain('no kind');
  });

  it('marks the Name as the system wording and the grade as not set, with a suggestion that is not applied', async () => {
    const a = (await tables()).pages[0];
    const beams = a.rows[0];
    expect(beams.name_is_system).toBe(true);
    expect(beams.grade).toBeNull();
    expect(beams.grade_suggestion).toBe(GRADE_SUGGESTION.W);
    expect(beams.flags).toEqual(
      expect.arrayContaining(['system wording', 'grade not set (suggested A992, not applied)']),
    );
    const hss = a.rows.find((r: { shape: string }) => r.shape === 'HSS');
    expect(hss.grade_suggestion).toBe('A500');
  });

  it('puts red pieces on their own line, outside the quantity, and lists the other pieces apart', async () => {
    const a = (await tables()).pages[0];
    expect(a.red).toMatchObject({ pieces: 1, by_kind: [{ kind: 'Beams', pieces: 1 }] });
    expect(a.not_counted).toMatchObject({ pieces: 1, by_kind: [{ kind: 'Joist', pieces: 1 }] });
    expect(a.misc).toMatchObject({ pieces: 1, by_kind: [{ kind: 'Stair', pieces: 1 }] });
    expect(a.unlinked).toBe(1);
    const inRows = a.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    for (const k of ['red', 'joist', 'stair', 'unlinked']) expect(inRows).not.toContain(ids[k]);
  });

  it('a row lists its tags and piece ids so a click can select its symbols', async () => {
    const row = (await tables()).pages[0].rows[0];
    expect(row.tags).toEqual(['XX1', 'XX2', 'XX3']);
    expect(row.member_ids).toHaveLength(3);
  });
});

describe('job table and summary', () => {
  it('groups across pages; the reference shows the first sheet plus a count; excluded sheets add nothing', async () => {
    const t = await tables();
    const beams = t.job.rows.find(
      (r: { size: string; kind: string }) => r.size === '12X26' && r.kind === 'Beams',
    );
    expect([beams.quantity, beams.reference, beams.sheets]).toEqual([4, 'S1.1 (+1)', [1, 2]]);
    expect(t.job.quantity).toBe(8); // 7 on page A + 1 on page B; nothing from the excluded sheet
    expect(t.job.sheets_excluded).toEqual([3]);
  });

  it('summarises by kind, main kinds first, then no kind, misc (reserved) and not counted last', async () => {
    const s = (await tables()).job.summary as {
      kind: string | null;
      scope: string | null;
      quantity: number;
      groups: number;
    }[];
    expect(s.slice(0, 21).every((x) => x.scope === 'main')).toBe(true);
    expect(s[0]?.kind).toBe('Column');
    const by = (k: string | null) => s.find((x) => x.kind === k);
    expect(by('Beams')).toMatchObject({ quantity: 5, groups: 2 });
    expect(by('Vertical Brace')).toMatchObject({ quantity: 2, groups: 1 });
    expect(by(null)).toMatchObject({ quantity: 1, scope: null });
    expect(s.slice(-2).map((x) => [x.kind, x.scope])).toEqual([
      ['Stair', 'misc'],
      ['Joist', 'excluded'],
    ]);
    const total = s
      .filter((x) => x.scope === 'main' || x.scope === null)
      .reduce((n, x) => n + x.quantity, 0);
    expect(total).toBe((await tables()).job.quantity); // the summary adds up to the table
  });

  it('is labelled draft while a sheet has a flag, and the red line is outside the total', async () => {
    const t = await tables();
    expect(t.draft.reviewed).toBe(false);
    expect(t.draft.label).toMatch(/^draft, \d+ sheets? unconfirmed$/);
    expect(t.job.red.pieces).toBe(1);
  });

  it('takes the grade a person set for the shape family, and no suggestion remains for it', async () => {
    await setGrade(db, projectId, 'W', 'A572 Gr50', 'alice');
    const beams = (await tables()).job.rows.find(
      (r: { size: string; kind: string }) => r.size === '12X26' && r.kind === 'Beams',
    );
    expect([beams.grade, beams.grade_suggestion]).toEqual(['A572 Gr50', null]);
  });
});

describe('row actions', () => {
  const act = (path: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}/rows/${path}`, payload });

  it('sets the Name of a whole row as one action; the row regroups; undo restores it', async () => {
    const before = (await tables()).pages[0].rows[0];
    const res = await act('name', {
      member_ids: before.member_ids,
      name: 'Roof beams',
      who: 'alice',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBe(3);
    const after = (await tables()).pages[0].rows.find(
      (r: { name: string }) => r.name === 'Roof beams',
    );
    expect([after.quantity, after.name_is_system, after.flags]).toEqual([
      3,
      false,
      expect.not.arrayContaining(['system wording']),
    ]);
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect((await tables()).pages[0].rows[0].name).toBe('Beams');
  });

  it('sets the kind of a whole row as one action; the summary follows', async () => {
    const row = (await tables()).pages[0].rows.find((r: { size: string }) => r.size === '99X99');
    const res = await act('kind', { member_ids: row.member_ids, kind: 'Column', who: 'bob' });
    expect(res.statusCode).toBe(200);
    const s = (await tables()).job.summary as { kind: string | null; quantity: number }[];
    expect(s.find((x) => x.kind === 'Column')?.quantity).toBe(1);
    expect(s.find((x) => x.kind === 'Beams')?.quantity).toBe(4);
  });

  it('refuses an unknown kind, a blank name and a piece that does not exist', async () => {
    const some = [ids.a1 as string];
    expect((await act('kind', { member_ids: some, kind: 'Nope', who: 'bob' })).statusCode).toBe(
      400,
    );
    expect((await act('name', { member_ids: some, name: 'x', who: '  ' })).statusCode).toBe(400);
    expect(
      (
        await act('name', {
          member_ids: ['00000000-0000-4000-8000-000000000000'],
          name: 'x',
          who: 'bob',
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('Excel export', () => {
  it('carries DRAFT in the header and the file name while a sheet is unconfirmed, with empty length cells', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables.xlsx` });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-disposition'])).toMatch(/_takeoff_DRAFT\.xlsx"$/);
    const wb = await loadWorkbook(res.rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Job', 'p1 S1.1', 'p2 S1.2', 'Corrections']);
    const job = wb.getWorksheet('Job')!;
    expect(String(job.getRow(1).getCell(1).value)).toMatch(
      /^DRAFT - draft, \d+ sheets? unconfirmed$/,
    );
    const head = job
      .getRows(1, job.rowCount)!
      .find((r) => r.getCell(1).value === 'Kind' && r.getCell(2).value === 'Reference Dwg No.')!;
    expect((head.values as unknown[]).slice(1)).toEqual([
      'Kind',
      'Reference Dwg No.',
      'Quantity',
      'SHAPE',
      'Size',
      'Name',
      'Length ft',
      'Length In',
      'Unit W',
      'Total W',
      'Grade',
    ]);
    const body = job
      .getRows(Number(head.number) + 1, 10)!
      .find((r) => r.getCell(1).value === 'Beams' && r.getCell(5).value === '12X26')!;
    expect([body.getCell(7).value, body.getCell(8).value, body.getCell(10).value]).toEqual([
      null,
      null,
      null,
    ]);
    expect(body.getCell(9).value).toBe(26);
    const text = JSON.stringify(job.getRows(1, job.rowCount)!.map((r) => r.values));
    expect(text).toContain('Red, not counted');
    expect(text).toContain('Not counted (excluded kinds)');
    expect(text).toContain('Misc, reserved (not computed)');
  });

  it('lists corrections on their own sheet with who and what', async () => {
    const wb = await loadWorkbook(
      (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables.xlsx` }))
        .rawPayload,
    );
    const cs = wb.getWorksheet('Corrections')!;
    const rows = cs.getRows(3, cs.rowCount)!.map((r) => r.values as unknown[]);
    expect(rows.some((v) => v.includes('bob') && v.includes('kind'))).toBe(true);
  });

  it('drops DRAFT from the header and the file name once no sheet is unconfirmed', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/confirm-excluded-defaults`,
      payload: { who: 'carol' },
    });
    for (const sheet of [planA, planB, detail])
      await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/sheets/${sheet}/confirm-guesses`,
        payload: { who: 'carol' },
      });
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables.xlsx` });
    expect(String(res.headers['content-disposition'])).not.toMatch(/DRAFT/);
    const wb = await loadWorkbook(res.rawPayload);
    expect(wb.getWorksheet('Job')!.getRow(1).getCell(1).value).toBe('Reviewed');
  });
});

describe('classify', () => {
  it('ignores pieces of sheets that are not included', () => {
    const c = classify([], new Set());
    expect(c.counted).toEqual([]);
  });
});
