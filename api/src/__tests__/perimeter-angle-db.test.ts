// Phase 0 perimeter angle: manual L-sections on beams (SYNTHETIC rows only, test database).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { LineFirstBom } from '../review/line-first-bom.js';
import { type PieceView } from '../review/line-first-pieces.js';
import {
  angleSize,
  bentPlateKgPerM,
  bentPlateLbPerFt,
  bentPlateName,
  deriveAngle,
  formatInches,
  inchesOf,
  parseBentPlate,
  type Parent,
} from '../review/perimeter-angle.js';
import { viewPieces } from '../review/view-undo.js';
import {
  deleteEdition,
  deleteProject,
  firstView,
  insertProject,
  insertSheet,
  loadWorkbook,
  setFirstView,
  uniqueLabel,
} from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';
const edition = uniqueLabel('perimeter-angle-test');
const MM_FT = 304.8;
// AISC v16 unit weights (lb/ft), as published and as read from the AISC catalog on disk
const AISC_LB_FT: Record<string, number> = {
  'L4X4X1/4': 6.6,
  'L4X4X5/16': 8.2,
  'L6X4X3/8': 12.3,
  'L6X6X3/8': 14.9,
};
const KG_PER_M_PER_LB_FT = 1.4881639435;

describe('perimeter angle geometry (pure)', () => {
  const parent: Parent = {
    a: [100, 100],
    b: [500, 100],
    start: [0, 0, 3000],
    end: [10000, 0, 3000],
  };

  it('blank length follows the whole beam; an offset runs to the end', () => {
    const d = deriveAngle(parent, null, null);
    expect(d.length_mm).toBe(10000);
    expect(d.a).toEqual([100, 100]);
    expect(d.b).toEqual([500, 100]);
    const o = deriveAngle(parent, 2500, null);
    expect(o.length_mm).toBe(7500);
    expect(o.start).toEqual([2500, 0, 3000]);
    expect(o.a).toEqual([200, 100]);
  });

  it('a typed length is a real length from the offset, capped at the beam', () => {
    expect(deriveAngle(parent, 1000, 4000).length_mm).toBe(4000);
    expect(deriveAngle(parent, 1000, 4000).end).toEqual([5000, 0, 3000]);
    expect(deriveAngle(parent, 8000, 4000).length_mm).toBe(2000); // capped
    expect(deriveAngle(parent, 20000, 4000).length_mm).toBeNull(); // offset past the beam: nothing
    // a longer beam keeps the typed real length, it is not a fraction
    const longer: Parent = { ...parent, end: [20000, 0, 3000], b: [900, 100] };
    expect(deriveAngle(longer, 1000, 4000).length_mm).toBe(4000);
  });

  it('parses the AISC names of the L shapes', () => {
    expect(inchesOf('1-1/4')).toBe(1.25);
    expect(inchesOf('3/8')).toBe(0.375);
    expect(angleSize('L6X4X3/8')).toEqual({ long_in: 6, short_in: 4, thickness_in: 0.375 });
    expect(angleSize('L4x6x3/8')).toEqual({ long_in: 6, short_in: 4, thickness_in: 0.375 });
    expect(angleSize('W16X26')).toBeNull();
  });
});

describe('bent plate (pure)', () => {
  it('names and parses the sizes: thickness x leg 1 x leg 2, fractions of an inch', () => {
    const b = { thickness_in: 0.375, leg1_in: 6, leg2_in: 4 };
    expect(bentPlateName(b)).toBe('BENT PL 3/8 x 6 x 4');
    expect(parseBentPlate('BENT PL 3/8 x 6 x 4')).toEqual(b);
    expect(parseBentPlate('BENT BP 3/8 x 6 x 1-1/2')).toEqual({ ...b, leg2_in: 1.5 });
    expect(formatInches(1.5)).toBe('1-1/2');
    expect(formatInches(0.3125)).toBe('5/16');
    expect(parseBentPlate('BENT PL 3/8 x 6 x 1/4')).toBeNull(); // leg not longer than t
    expect(parseBentPlate('BENT PL 3/8 x 60 x 4')).toBeNull(); // above 48 in
    expect(parseBentPlate('L4X4X1/4')).toBeNull();
  });

  it('lb/ft = 3.4 x t x (leg1 + leg2 - t) is within 2% of AISC for the 4 common angles', () => {
    for (const [name, lbFt] of Object.entries(AISC_LB_FT)) {
      const s = angleSize(name)!;
      const w = bentPlateLbPerFt({
        thickness_in: s.thickness_in,
        leg1_in: s.long_in,
        leg2_in: s.short_in,
      });
      expect(Math.abs(w - lbFt) / lbFt, `${name}: ${w} vs ${lbFt}`).toBeLessThan(0.02);
    }
    expect(bentPlateLbPerFt({ thickness_in: 0.375, leg1_in: 6, leg2_in: 4 })).toBeCloseTo(
      3.4 * 0.375 * 9.625,
      9,
    );
    expect(bentPlateKgPerM({ thickness_in: 0.375, leg1_in: 6, leg2_in: 4 })).toBeCloseTo(
      3.4 * 0.375 * 9.625 * KG_PER_M_PER_LB_FT,
      3,
    );
  });
});

describe('perimeter angles (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let runId: string;
  const beams: Record<string, string> = {};
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
  const pieces = async () =>
    (await get(`/sheets/${sheetId}/line-first`)).json().pieces as PieceView[];
  const piece = async (id: string) => (await pieces()).find((p) => p.id === id)!;
  const bom = async () => (await get('/line-first/bom')).json() as LineFirstBom;
  const add = (beam_ids: string[], extra: object = {}) =>
    post('/line-first/perimeter-angles', {
      who: WHO,
      beam_ids,
      profile_text: 'L4X4X1/4',
      ...extra,
    });

  const beam = (key: string, y: number, extra: object = {}) => ({
    project_id: projectId,
    sheet_id: sheetId,
    member_id: `LF-B-${key}`,
    origin: 'extracted',
    type: 'beam',
    kind: 'Beams',
    build_run_id: runId,
    profile: 'W16X26',
    profile_raw: 'W16X26',
    size_state: 'sized',
    build_state: 'found',
    support_state: 'both',
    tag_prefix: 'BE',
    tag_number: y / 100,
    page_x0: 100,
    page_y0: y,
    page_x1: 500,
    page_y1: y,
    start_x_mm: 0,
    start_y_mm: -y,
    end_x_mm: 10 * MM_FT, // a 10 ft beam
    end_y_mm: -y,
    start_z_mm: 3000,
    end_z_mm: 3000,
    start_elevation_mm: 3000,
    end_elevation_mm: 3000,
    plan_scale_ratio: 96,
    ...extra,
  });

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
      ...Object.entries(AISC_LB_FT).map(([shape_name, lb]) => ({
        shape_name,
        family: 'L',
        weight_kg_per_m: lb * KG_PER_M_PER_LB_FT,
        weight_lb_per_ft: lb,
        properties: {},
      })),
    ]);
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    await setFirstView(db, sheetId, {
      role_name: 'Framing plan',
      box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
      scale_ratio: 96,
    });
    await db
      .updateTable('sheets')
      .set({ build_role: 'framing', build_scale_ratio: '96' } as never)
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
    runId = run.id;
    const view = await firstView(db, sheetId);
    for (const [key, y, extra] of [
      ['one', 100, {}],
      ['two', 200, {}],
      ['three', 300, {}],
      ['inview', 400, { build_view_id: view.id }],
      ['col', 500, { type: 'column', kind: 'Column', page_x1: null, page_y1: null }],
    ] as const) {
      const r = await db
        .insertInto('members')
        .values(beam(key, y, extra) as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      beams[key] = r.id;
    }
  });

  afterAll(async () => {
    delete process.env.CATALOG_EDITION;
    await deleteProject(db, projectId);
    await deleteEdition(db, edition);
    await closeDatabaseConnection();
  });

  it('options: the AISC L shapes with the common ones first; kind, grade and last profile', async () => {
    const res = await get('/perimeter-angles/options');
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.edition).toBe(edition);
    expect(o.angles.map((a: { name: string }) => a.name).slice(0, 4)).toEqual([
      'L4X4X1/4',
      'L4X4X5/16',
      'L6X4X3/8',
      'L6X6X3/8',
    ]);
    expect(o.angles[0]).toMatchObject({
      long_in: 4,
      short_in: 4,
      thickness_in: 0.25,
      lb_per_ft: 6.6,
    });
    expect(o.kind).toBe('Deck edge Angle / Bent plate');
    expect(o.last_profile).toBeNull();
    expect(o.grade).toBe('A36'); // confirmed default for angles and bent plates
    expect(o.grade_is_default).toBe(true);
  });

  it('adds an angle on a beam: its own piece, length = the beam, own tag from the kind prefix', async () => {
    const res = await add([beams.one!], { slab_edge_side: 'left', vertical_leg: 'long' });
    expect(res.statusCode).toBe(201);
    const p = res.json().pieces[0] as PieceView;
    expect(p).toMatchObject({
      parent_member_id: beams.one,
      kind: 'Deck edge Angle / Bent plate',
      profile: 'L4X4X1/4',
      length_mm: 3048,
      angle_length_mm: null,
      slab_edge_side: 'left',
      vertical_leg: 'long',
      added: true,
      deleted: false,
    });
    expect(p.tag).toMatch(/^[A-Z]+\d+$/);
    expect(p.parent_tag).toBe('BE1');
    expect(p.a).toEqual([100, 100]);
    expect(p.b).toEqual([500, 100]);
    expect(res.json().action_id).toBeTruthy();
    const log = await db
      .selectFrom('count_actions')
      .select(['action', 'detail'])
      .where('member_id', '=', p.id)
      .executeTakeFirstOrThrow();
    expect(log.action).toBe('add');
    expect(log.detail).toMatchObject({ perimeter_angle: true, profile: 'L4X4X1/4' });
    // the project remembers the last profile
    expect((await get('/perimeter-angles/options')).json().last_profile).toBe('L4X4X1/4');
  });

  it('refuses a profile that is not an AISC L shape, a column, and an angle on an angle', async () => {
    for (const bad of ['W16X26', 'L99X99X1', 'banana']) {
      const r = await add([beams.two!], { profile_text: bad });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe('not_an_angle');
    }
    expect((await add([beams.col!])).json().code).toBe('not_a_beam');
    const angle = (await pieces()).find((p) => p.parent_member_id !== null)!;
    expect((await add([angle.id])).json().code).toBe('not_a_beam');
    expect((await add([beams.two!, beams.two!])).statusCode).toBe(400); // duplicate ids
  });

  it('several beams: one action, one undo removes them all; redo-able', async () => {
    const before = (await pieces()).filter((p) => p.parent_member_id !== null).length;
    const res = await add([beams.two!, beams.three!], { profile_text: 'L6X4X3/8' });
    expect(res.statusCode).toBe(201);
    expect(res.json().pieces).toHaveLength(2);
    const actionIds = new Set(
      (
        await db
          .selectFrom('member_edits')
          .select('action_id')
          .where(
            'member_id',
            'in',
            res.json().pieces.map((p: PieceView) => p.id),
          )
          .execute()
      ).map((r) => r.action_id),
    );
    expect(actionIds.size).toBe(1);
    expect((await pieces()).filter((p) => p.parent_member_id !== null && !p.deleted)).toHaveLength(
      before + 2,
    );
    expect((await post('/undo', { who: WHO })).statusCode).toBe(200);
    expect((await pieces()).filter((p) => p.parent_member_id !== null && !p.deleted)).toHaveLength(
      before,
    );
  });

  it('follows its beam; a typed length stays that real length (capped); blank follows the beam', async () => {
    const a = (await pieces()).find((p) => p.parent_member_id === beams.one)!;
    // a typed length from an offset: 4 ft from 1 ft
    const ed = await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [a.id],
      length_mm: 4 * MM_FT,
      start_offset_mm: MM_FT,
    });
    expect(ed.statusCode).toBe(200);
    expect(ed.json().pieces[0]).toMatchObject({ length_mm: 1219.2, angle_start_offset_mm: 304.8 });
    // the beam is lengthened (end moved right): the typed angle keeps its real length
    const moved = await post(`/line-first/pieces/${beams.one}/ends`, {
      who: WHO,
      a: [100, 100],
      b: [900, 100],
    });
    expect(moved.statusCode).toBe(200);
    expect((await piece(a.id)).length_mm).toBe(1219.2);
    // a typed length longer than the beam is capped at the beam from the offset
    await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [a.id],
      length_mm: 500 * MM_FT,
    });
    const capped = await piece(a.id);
    const beamNow = await piece(beams.one!);
    expect(capped.length_mm).toBeCloseTo(beamNow.length_mm! - 304.8, 1);
    // blank = follows the whole beam again (and the offset): moves with the beam
    await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [a.id],
      length_mm: null,
      start_offset_mm: null,
    });
    const whole = await piece(a.id);
    expect(whole.length_mm).toBe(beamNow.length_mm);
    expect(whole.a).toEqual(beamNow.a);
    expect(whole.b).toEqual(beamNow.b);
  });

  it('edits profile / length / side / leg as one undoable action; refuses a non-angle profile', async () => {
    const a = (await pieces()).find((p) => p.parent_member_id === beams.one)!;
    const ed = await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [a.id],
      profile_text: 'L6X6X3/8',
      slab_edge_side: 'right',
      vertical_leg: null,
    });
    expect(ed.json().pieces[0]).toMatchObject({
      profile: 'L6X6X3/8',
      slab_edge_side: 'right',
      vertical_leg: null,
    });
    expect((await post('/undo', { who: WHO })).statusCode).toBe(200);
    expect(await piece(a.id)).toMatchObject({
      profile: 'L4X4X1/4',
      slab_edge_side: 'left',
      vertical_leg: 'long',
    });
    const bad = await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [a.id],
      profile_text: 'W16X26',
    });
    expect(bad.statusCode).toBe(400);
    const notAngle = await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [beams.one],
      length_mm: 100,
    });
    expect(notAngle.json().code).toBe('not_an_angle');
  });

  it('BOM: its own line by profile with count, length, unit and total weight; beams stay apart', async () => {
    // L4X4X1/4 on beam one (10 ft) + a second one on beam two with a typed 6 ft
    const two = await add([beams.two!], { length_mm: 6 * MM_FT });
    expect(two.statusCode).toBe(201);
    const b = await bom();
    const mine = (await pieces()).filter((p) => p.profile === 'L4X4X1/4' && !p.deleted);
    const totalMm = mine.reduce((n, p) => n + p.length_mm!, 0);
    const line = b.angles.find((l) => l.section === 'L4X4X1/4')!;
    expect(line).toMatchObject({
      category: 'Deck edge Angle / Bent plate',
      qty: mine.length,
      unit_w_lb_ft: 6.6,
    });
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(line.length_mm).toBeCloseTo(totalMm, 0);
    expect(line.weight_lb!).toBeCloseTo((totalMm / MM_FT) * 6.6, 0);
    expect(b.rows.filter((r) => r.perimeter_angle)).toHaveLength(mine.length);
    expect(b.rows.filter((r) => !r.perimeter_angle && r.category === 'Beams')).toHaveLength(4);
  });

  it('weights agree with AISC for four angles on a 10 ft run (lb/ft x 10 ft)', async () => {
    for (const [name, lbFt] of Object.entries(AISC_LB_FT)) {
      const made = await add([beams.three!], { profile_text: name });
      expect(made.statusCode).toBe(201);
      const row = (await bom()).rows.find((r) => r.piece_id === made.json().pieces[0].id)!;
      expect(row.section).toBe(name);
      expect(row.unit_w_lb_ft).toBe(lbFt);
      expect(row.weight_lb!).toBeCloseTo(lbFt * 10, 1);
      expect(row.weight_kg!).toBeCloseTo(lbFt * 10 * 0.45359237, 1);
    }
  });

  it('grade: A36 by default, editable per project (any text), logged; angles only, never the beams', async () => {
    expect((await bom()).angles[0]!.grade).toBe('A36');
    const set = await post('/perimeter-angles/grade', { who: WHO, grade: 'A572 Gr 50' });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ grade: 'A572 Gr 50', grade_is_default: false });
    expect((await bom()).angles.every((l) => l.grade === 'A572 Gr 50')).toBe(true);
    expect((await get('/perimeter-angles/options')).json()).toMatchObject({
      grade: 'A572 Gr 50',
      grade_is_default: false,
    });
    const log = await db
      .selectFrom('count_actions')
      .select(['who', 'detail'])
      .where('project_id', '=', projectId)
      .where('action', '=', 'project')
      .executeTakeFirstOrThrow();
    expect(log.who).toBe(WHO);
    expect(log.detail).toMatchObject({ change: 'perimeter_grade', from: 'A36', to: 'A572 Gr 50' });
    // beams are not touched by it
    expect((await bom()).rows.find((r) => !r.perimeter_angle)!.grade).toBeNull();
    // null: back to the default
    const back = await post('/perimeter-angles/grade', { who: WHO, grade: null });
    expect(back.json()).toEqual({ grade: 'A36', grade_is_default: true });
    expect((await bom()).angles[0]!.grade).toBe('A36');
    expect((await post('/perimeter-angles/grade', { who: WHO, grade: '  ' })).statusCode).toBe(400);
  });

  it('bent plate: sizes in inches, own piece, weight from the formula, BOM and Excel by size next to angles', async () => {
    const made = await add([beams.one!], {
      profile_text: undefined,
      bent: { thickness_in: 0.375, leg1_in: 6, leg2_in: 4 },
    });
    expect(made.statusCode).toBe(201);
    const bp = made.json().pieces[0] as PieceView;
    expect(bp.profile).toBe('BENT PL 3/8 x 6 x 4');
    expect(bp.parent_member_id).toBe(beams.one);
    expect(bp.kind).toBe('Deck edge Angle / Bent plate');
    expect(bp.length_mm).toBeCloseTo((await piece(beams.one!)).length_mm!, 1); // the whole beam
    const lbFt = 3.4 * 0.375 * (6 + 4 - 0.375);
    const row = (await bom()).rows.find((r) => r.piece_id === bp.id)!;
    const lenFt = bp.length_mm! / MM_FT;
    expect(row.section).toBe('BENT PL 3/8 x 6 x 4');
    expect(row.section_type).toBe('BENT PL');
    expect(row.grade).toBe('A36');
    expect(row.unit_w_lb_ft).toBeCloseTo(lbFt, 2);
    expect(row.weight_lb!).toBeCloseTo(lbFt * lenFt, 0);
    const lines = (await bom()).angles;
    const line = lines.find((l) => l.section === 'BENT PL 3/8 x 6 x 4')!;
    expect(line).toMatchObject({ sub_type: 'bent_plate', qty: 1, grade: 'A36' });
    // grouped by size, next to the angles (angles first, then the bent plates)
    const kinds = lines.map((l) => l.sub_type);
    expect(kinds.indexOf('bent_plate')).toBeGreaterThan(kinds.lastIndexOf('angle'));
    expect(lines.some((l) => l.sub_type === 'angle')).toBe(true);
    // a second bent plate of the same size joins the same line
    const two = await add([beams.two!], {
      profile_text: undefined,
      bent: { thickness_in: 0.375, leg1_in: 6, leg2_in: 4 },
    });
    expect(two.statusCode).toBe(201);
    expect((await bom()).angles.find((l) => l.section === 'BENT PL 3/8 x 6 x 4')!.qty).toBe(2);
    // Excel: the section lists it with the type BENT PL and the unit weight
    const wb = await loadWorkbook((await get('/line-first/bom.xlsx')).rawPayload);
    const rows: unknown[][] = [];
    wb.getWorksheet('BOM')!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    const at = rows.findIndex((l) => String(l[0]).startsWith('PERIMETER ANGLES'));
    const x = rows.slice(at + 1).find((l) => l[5] === 'BENT PL 3/8 x 6 x 4')!;
    expect(x[1]).toBe('Deck edge Angle / Bent plate');
    expect(x[3]).toBe(2);
    expect(x[4]).toBe('BENT PL');
    expect(x[7]).toBe('A36');
    expect(x[10] as number).toBeCloseTo(lbFt, 2);
    // the project's last profile is the bent plate; the picker starts on it
    expect((await get('/perimeter-angles/options')).json().last_profile).toBe(
      'BENT PL 3/8 x 6 x 4',
    );
    // edit the sizes: one undoable action; the name and the weight follow
    const ed = await post('/line-first/perimeter-angles/edit', {
      who: WHO,
      member_ids: [bp.id],
      bent: { thickness_in: 0.25, leg1_in: 5, leg2_in: 3 },
    });
    expect(ed.statusCode).toBe(200);
    expect((await piece(bp.id)).profile).toBe('BENT PL 1/4 x 5 x 3');
    const r2 = (await bom()).rows.find((r) => r.piece_id === bp.id)!;
    expect(r2.unit_w_lb_ft).toBeCloseTo(3.4 * 0.25 * (5 + 3 - 0.25), 2);
    await post('/undo', { who: WHO });
    expect((await piece(bp.id)).profile).toBe('BENT PL 3/8 x 6 x 4');
    // typed as text it is the same thing; an L profile stays an L profile
    const typed = await add([beams.two!], { profile_text: 'bent pl 1/4 x 4 x 3' });
    expect(typed.statusCode).toBe(201);
    expect(typed.json().pieces[0].profile).toBe('BENT PL 1/4 x 4 x 3');
    await post('/undo', { who: WHO });
    await post('/undo', { who: WHO }); // the second bent plate goes too
    expect((await bom()).angles.find((l) => l.section === 'BENT PL 3/8 x 6 x 4')!.qty).toBe(1);
  });

  it('bent plate: sizes that cannot be made are refused (400), nothing is added', async () => {
    const count = async () => (await pieces()).filter((p) => p.parent_member_id !== null).length;
    const n = await count();
    const short = await add([beams.one!], {
      profile_text: undefined,
      bent: { thickness_in: 0.5, leg1_in: 0.5, leg2_in: 4 }, // a leg not longer than the thickness
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().code).toBe('bad_bent_plate');
    const huge = await add([beams.one!], {
      profile_text: undefined,
      bent: { thickness_in: 0.25, leg1_in: 60, leg2_in: 4 }, // above 48 in
    });
    expect(huge.statusCode).toBe(400);
    const text = await add([beams.one!], { profile_text: 'BENT PL x' });
    expect(text.statusCode).toBe(400);
    expect(text.json().code).toBe('bad_bent_plate');
    const none = await post('/line-first/perimeter-angles', { who: WHO, beam_ids: [beams.one!] });
    expect(none.json().code).toBe('no_profile');
    expect(await count()).toBe(n);
  });

  it('Excel: its own section by profile', async () => {
    const res = await get('/line-first/bom.xlsx');
    expect(res.statusCode).toBe(200);
    const wb = await loadWorkbook(res.rawPayload);
    const ws = wb.getWorksheet('BOM')!;
    const lines: unknown[][] = [];
    ws.eachRow((r) => lines.push((r.values as unknown[]).slice(1)));
    const at = lines.findIndex((l) => String(l[0]).startsWith('PERIMETER ANGLES'));
    expect(at).toBeGreaterThan(0);
    const sec = lines.slice(at + 1).filter((l) => l[1] === 'Deck edge Angle / Bent plate');
    expect(sec.length).toBeGreaterThan(0);
    const l4 = sec.find((l) => l[5] === 'L4X4X1/4')!;
    const expected = (await bom()).angles.find((l) => l.section === 'L4X4X1/4')!;
    expect(l4[3]).toBe(expected.qty);
    expect(l4[7]).toBe('A36'); // grade from the project rule
    expect(l4[10]).toBe(6.6); // unit weight lb/ft
  });

  it('deleting the beam takes its angles with it (BOM and page); one Undo brings both back', async () => {
    const angles = (await pieces()).filter((p) => p.parent_member_id === beams.one && !p.deleted);
    expect(angles.length).toBeGreaterThan(0);
    const before = (await bom()).angles.reduce((n, l) => n + l.qty, 0);
    const del = await post('/line-first/pieces/delete', { who: WHO, member_ids: [beams.one] });
    expect(del.statusCode).toBe(200);
    // the page no longer lists the beam or its angles
    expect((await pieces()).filter((p) => p.parent_member_id === beams.one)).toHaveLength(0);
    expect((await bom()).angles.reduce((n, l) => n + l.qty, 0)).toBe(before - angles.length);
    expect((await post('/undo', { who: WHO })).statusCode).toBe(200);
    expect(
      (await pieces()).filter((p) => p.parent_member_id === beams.one && !p.deleted),
    ).toHaveLength(angles.length);
    expect((await bom()).angles.reduce((n, l) => n + l.qty, 0)).toBe(before);
  });

  it('removing an angle is the ordinary delete: undoable, the beam stays', async () => {
    const a = (await pieces()).find((p) => p.parent_member_id === beams.two && !p.deleted)!;
    expect(
      (await post('/line-first/pieces/delete', { who: WHO, member_ids: [a.id] })).statusCode,
    ).toBe(200);
    expect(await piece(a.id)).toBeUndefined(); // deleted pieces are not listed
    expect(await piece(beams.two!)).toBeDefined(); // the beam stays
    await post('/undo', { who: WHO });
    expect(await piece(a.id)).toBeDefined();
  });

  it('an ignored beam ignores its angles', async () => {
    const a = (await pieces()).find((p) => p.parent_member_id === beams.two && !p.deleted)!;
    await post('/line-first/pieces/edit', { who: WHO, member_ids: [beams.two], ignored: true });
    expect((await piece(a.id)).ignored).toBe(true);
    expect((await bom()).rows.some((r) => r.piece_id === a.id)).toBe(false);
    await post('/undo', { who: WHO });
    expect((await piece(a.id)).ignored).toBe(false);
  });

  it('a beam with an angle is "touched", so a rebuild keeps it (the angle would cascade away)', async () => {
    const view = await firstView(db, sheetId);
    await add([beams.inview!]);
    const { touched, untouched } = await viewPieces(db, view.id);
    expect(touched).toContain(beams.inview);
    expect(untouched).not.toContain(beams.inview);
  });

  it('the kind of the BOM line can be renamed per project (must be in the kinds list)', async () => {
    await db
      .updateTable('projects')
      .set({ perimeter_angle_kind: 'No such kind' } as never)
      .where('id', '=', projectId)
      .execute();
    const r = await add([beams.three!]);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('no_kind');
    await db
      .updateTable('projects')
      .set({ perimeter_angle_kind: 'Embeds Angle' } as never)
      .where('id', '=', projectId)
      .execute();
    expect((await get('/perimeter-angles/options')).json().kind).toBe('Embeds Angle');
    const ok = await add([beams.three!]);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().pieces[0].kind).toBe('Embeds Angle');
  });
});
