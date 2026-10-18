import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { CatalogLookup } from '../catalog/lookup.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { SheetsTable } from '../db/types.js';
import type { GradeRule } from '../review/grades.js';
import { lineFirstBom, type BuiltPiece } from '../review/line-first-bom.js';
import { effectiveState, PEN_CLASS_RE, setupReasons } from '../routes/build.js';
import type { Selectable } from 'kysely';
import { deleteProject, firstView, insertProject, insertSheet, loadWorkbook } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

function piece(over: Partial<BuiltPiece>): BuiltPiece {
  return {
    id: 'x',
    member_id: 'LF-B-1',
    sheet_id: 's',
    type: 'beam',
    kind: 'Beams',
    tag: 'B1',
    quantity: 1,
    profile: 'TEST-001',
    profile_raw: 'TEST-001',
    start: [0, 0, 3000],
    end: [6000, 0, 3000],
    build_state: 'found',
    size_state: 'sized',
    support_state: 'both',
    piece_index: 1,
    ...over,
  };
}

const catalog = new CatalogLookup([
  { shape_name: 'TEST-001', family: 'TEST', weight_lb_per_ft: null, weight_kg_per_m: 10 },
]);

describe('line-first BOM (pure)', () => {
  it('has the Steel Genie columns and weight = qty x length x kg/m', () => {
    const b = lineFirstBom([piece({ quantity: 2 })], catalog, new Map());
    const r = b.rows[0]!;
    expect([r.main, r.category, r.piecemark, r.qty, r.section_type, r.section]).toEqual([
      1,
      'Beams',
      'B1',
      2,
      'TEST',
      'TEST-001',
    ]);
    expect(r.length_mm).toBe(6000);
    expect(r.weight_kg).toBe(120);
    expect(b.totals).toMatchObject({ pieces: 2, length_mm: 12000, weight_kg: 120 });
  });

  it('keeps attention rows out of the main total and counts missing lengths and weights', () => {
    const b = lineFirstBom(
      [
        piece({ member_id: 'a' }),
        piece({ member_id: 'b', build_state: 'attention', profile: null, profile_raw: null }),
        piece({ member_id: 'c', type: 'column', kind: 'Column', start: [0, 0, 0], end: null }),
        piece({ member_id: 'd', profile: 'NOT-IN-CATALOG', build_state: 'needs_review' }),
      ],
      catalog,
      new Map(),
    );
    expect(b.totals.pieces).toBe(3);
    expect(b.totals.pieces_without_length).toBe(1); // the column
    expect(b.totals.pieces_without_weight).toBe(2); // the column and the unknown section
    expect(b.attention.pieces).toBe(1);
    expect(b.by_category.map((c) => [c.category, c.pieces])).toEqual([
      ['Beams', 2],
      ['Column', 1],
    ]);
  });

  it('takes the grade a person set for the family, else none', () => {
    const grades = new Map([
      ['W', { family: 'W', grade: 'G-1', set_by: WHO, set_at: '' } as GradeRule],
    ]);
    const b = lineFirstBom(
      [piece({ profile: 'W12X99', profile_raw: 'W12X99' }), piece({ member_id: 'z' })],
      catalog,
      grades as never,
    );
    expect(b.rows.map((r) => r.grade).sort()).toEqual(['G-1', null].sort());
    const w = b.rows.find((r) => r.section === 'W12X99')!;
    expect(w.weight_kg).toBeNull(); // not in the catalog: no weight, never guessed
  });
});

describe('build colour state after edits', () => {
  it('follows the build rules and lets a typed size lift an undefined piece', () => {
    expect(effectiveState('sized', 'both', 'X').build_state).toBe('found');
    expect(effectiveState('inferred', 'both', 'X').build_state).toBe('needs_review');
    expect(effectiveState('sized', 'one', 'X').build_state).toBe('needs_review');
    expect(effectiveState('undefined', 'both', null).build_state).toBe('attention');
    expect(effectiveState('sized', 'none', 'X').build_state).toBe('attention');
    expect(effectiveState('undefined', 'both', 'TYPED')).toEqual({
      size_state: 'person',
      build_state: 'found',
    });
  });

  it('accepts only pen class keys in the line-class form', () => {
    expect(PEN_CLASS_RE.test('1.5-2.5|black|solid')).toBe(true);
    expect(PEN_CLASS_RE.test('>2.5|grey|dash')).toBe(true);
    expect(PEN_CLASS_RE.test('2|black|solid')).toBe(false);
    expect(PEN_CLASS_RE.test('1.5-2.5|black')).toBe(false);
  });

  it('lists what a page still needs before it can be built', () => {
    const blank = {
      build_role: null,
      crop_region: null,
      crop_confirmed_by: null,
      build_scale_ratio: null,
      scale_confirmed_by: null,
      tos_confirmed_by: null,
      pen_class: null,
      pen_class_confirmed_by: null,
    } as unknown as Selectable<SheetsTable>;
    expect(setupReasons(blank)).toEqual([
      'page role not set (column plan or framing)',
      'crop not confirmed',
      'scale not confirmed',
    ]);
    expect(setupReasons({ ...blank, build_role: 'framing' })).toContain('T.O.S. not confirmed');
    expect(setupReasons({ ...blank, build_role: 'column_plan' })).not.toContain(
      'T.O.S. not confirmed',
    );
  });
});

describe('build routes (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let planId: string;
  const jobs: string[] = [];
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    planId = await insertSheet(db, projectId, { page_index: 1, width_pt: 1000, height_pt: 800 });
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
  });

  afterAll(async () => {
    if (jobs.length) await db.deleteFrom('jobs').where('id', 'in', jobs).execute();
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('refuses to build a page that is not set up, with the reasons and a refused run', async () => {
    const res = await post(`/sheets/${sheetId}/build`, { who: WHO });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.reasons).toContain('crop not confirmed');
    const run = await db
      .selectFrom('build_runs')
      .selectAll()
      .where('id', '=', body.build_run_id)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe('refused');
    expect(run.requested_by).toBe(WHO);
  });

  it('stores every setup confirmation with who and when, and logs it', async () => {
    expect(
      (await post(`/sheets/${sheetId}/build-setup/role`, { role: 'framing', who: WHO })).statusCode,
    ).toBe(200);
    const crop = { x0: 40, y0: 40, x1: 960, y1: 760 };
    expect(
      (await post(`/sheets/${sheetId}/build-setup/crop`, { box: crop, who: WHO })).statusCode,
    ).toBe(200);
    const bad = await post(`/sheets/${sheetId}/build-setup/crop`, {
      box: { x0: 40, y0: 40, x1: 2000, y1: 760 },
      who: WHO,
    });
    expect(bad.statusCode).toBe(400);
    const scale = await post(`/sheets/${sheetId}/build-setup/scale`, {
      scale_text: '1/8" = 1\'-0"',
      who: WHO,
    });
    expect(scale.json().ratio).toBe(96);
    expect(
      (await post(`/sheets/${sheetId}/build-setup/scale`, { scale_text: 'NTS', who: WHO }))
        .statusCode,
    ).toBe(400);
    const tos = await post(`/sheets/${sheetId}/build-setup/tos`, {
      tos_mm: 0,
      raw: 'T.O.S. 0',
      source: 'typed',
      who: WHO,
    });
    expect(tos.statusCode).toBe(200);
    expect(
      (
        await post(`/sheets/${sheetId}/build-setup/pen-class`, {
          pen_class: 'heavy',
          source: 'person',
          who: WHO,
        })
      ).statusCode,
    ).toBe(400);
    const pen = await post(`/sheets/${sheetId}/build-setup/pen-class`, {
      pen_class: '1.5-2.5|black|solid',
      source: 'suggested',
      who: WHO,
    });
    expect(pen.statusCode).toBe(200);
    const v = await firstView(db, sheetId);
    expect(v.box_confirmed_by).toBe(WHO);
    expect(Number(v.scale_ratio)).toBe(96);
    expect(Number(v.tos_mm)).toBe(0);
    expect(v.tos_confirmed_by).toBe(WHO);
    expect(v.pens.map((p) => p.source)).toEqual(['suggested']);
    // the sheets setup columns are a read-only legacy copy now
    const s = await db
      .selectFrom('sheets')
      .selectAll()
      .where('id', '=', sheetId)
      .executeTakeFirstOrThrow();
    expect([s.crop_confirmed_by, s.pen_class]).toEqual([null, null]);
    const edits = await db
      .selectFrom('sheet_edits')
      .select('field_name')
      .where('sheet_id', '=', sheetId)
      .execute();
    expect(edits.map((e) => e.field_name).sort()).toEqual(
      ['build_role', 'build_scale', 'crop_region', 'pen_class', 'tos'].sort(),
    );
    const state = (await get(`/sheets/${sheetId}/build`)).json();
    expect(state.missing).toEqual([]);
    expect(state.setup.tos.mm).toBe(0);
  });

  it('a framing page waits for its column plan unless told there is none', async () => {
    const res = await post(`/sheets/${sheetId}/build`, { who: WHO });
    expect(res.statusCode).toBe(409);
    expect(res.json().reasons).toEqual([
      'build the column plan page first, or say the job has none',
    ]);
    const ok = await post(`/sheets/${sheetId}/build`, { who: WHO, no_column_plan: true });
    expect(ok.statusCode).toBe(202);
    jobs.push(ok.json().job_id);
    const job = await db
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', ok.json().job_id)
      .executeTakeFirstOrThrow();
    expect(job.type).toBe('build_sheet');
    expect((job.payload as { build_run_id: string }).build_run_id).toBe(ok.json().build_run_id);
    const again = await post(`/sheets/${sheetId}/build`, { who: WHO, no_column_plan: true });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/already being built/);
    const state = (await get(`/sheets/${sheetId}/build`)).json();
    expect(state.last_run.status).toBe('pending');
  });

  it('serves the BOM of built pieces only, and the label-first lists leave them out', async () => {
    const run = await db
      .insertInto('build_runs')
      .values({ project_id: projectId, sheet_id: planId, requested_by: WHO, status: 'done' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const base = {
      project_id: projectId,
      sheet_id: planId,
      origin: 'extracted' as const,
      type: 'beam' as const,
      kind: 'Beams',
      build_run_id: run.id,
      support_state: 'both' as const,
      start_x_mm: 0,
      start_y_mm: 0,
      start_z_mm: 3000,
      end_x_mm: 5000,
      end_y_mm: 0,
      end_z_mm: 3000,
    };
    await db
      .insertInto('members')
      .values([
        {
          ...base,
          member_id: 'LF-B-t1',
          profile: 'TEST-001',
          profile_raw: 'TEST-001',
          size_state: 'sized',
          build_state: 'found',
          tag_prefix: 'BE',
          tag_number: 1,
        },
        {
          ...base,
          member_id: 'LF-B-t2',
          size_state: 'undefined',
          build_state: 'attention',
          tag_prefix: 'BE',
          tag_number: 2,
        },
      ] as never)
      .execute();
    await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: planId,
        member_id: 'M-label',
        origin: 'extracted',
        type: 'beam',
      } as never)
      .execute();
    const bom = (await get('/line-first/bom')).json();
    expect(bom.rows).toHaveLength(2);
    expect(bom.totals.pieces).toBe(1);
    expect(bom.attention.pieces).toBe(1);
    expect(bom.rows.map((r: { piecemark: string }) => r.piecemark).sort()).toEqual(['BE1', 'BE2']);
    const listed = (await get('/members')).json().members as { member_id: string }[];
    expect(listed.map((m) => m.member_id)).toEqual(['M-label']);
    const xlsx = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/line-first/bom.xlsx`,
    });
    expect(xlsx.statusCode).toBe(200);
    const wb = await loadWorkbook(xlsx.rawPayload);
    const header = wb.getWorksheet('BOM')!.getRow(2).values as unknown[];
    expect(header.slice(1, 10)).toEqual([
      'Main',
      'Category',
      'Piecemark',
      'Qty',
      'Section Type',
      'Section',
      'Length',
      'Grade',
      'Weight (lb)',
    ]);
  });
});
