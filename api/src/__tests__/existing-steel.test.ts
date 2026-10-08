import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import { annotateSharedLines } from '../review/shared-line.js';
import { buildTakeoff } from '../review/takeoff.js';
import { deleteProject, insertProject, insertSheet, loadWorkbook } from './helpers.js';

const LINE = { p: [100, 100] as [number, number], q: [500, 100] as [number, number] };

function member(id: string, over: Partial<MemberView> = {}): MemberView {
  return {
    id,
    member_id: id,
    sheet_id: 's1',
    view_id: 'v1',
    origin: 'extracted',
    type: 'beam',
    mark: null,
    profile_raw: 'W12x26',
    profile: 'W12X26',
    quantity: 1,
    level: 'L1',
    deleted: false,
    review_status: 'unreviewed',
    bbox: null,
    mark_ref: { status: null, legend_row_id: null },
    link: {
      source: 'rule',
      confidence: 'high',
      margin: 50,
      line: { p: [id.length * 10, 0], q: [id.length * 10 + 50, 0] },
      chosen_rank: 1,
      candidates: [],
    },
    length_mm: 3000,
    length_ft_in: null,
    length_source: 'plan_geometry',
    base_elevation_mm: null,
    top_elevation_mm: null,
    status: { color: 'green', confirmed: false, reasons: [] },
    system: null,
    human: 'unreviewed',
    joist_series: null,
    shared_line: null,
    length_shared: false,
    shared_resolution: null,
    merged_into: null,
    not_member: null,
    existing: false,
    plan_point: null,
    ...over,
  } as MemberView;
}

const pages = new Map([
  ['s1', 1],
  ['s2', 2],
]);

describe('existing steel in the takeoff', () => {
  it('is listed by sheet with its profile and trusted length, and counted nowhere else', () => {
    const t = buildTakeoff(
      [
        member('a'),
        member('e', { existing: true, human: 'existing', length_mm: 4000 }),
        member('f', {
          existing: true,
          human: 'existing',
          sheet_id: 's2',
          profile: 'W10X12',
          profile_raw: 'W10x12',
        }),
      ],
      pages,
    );
    expect(t.totals.pieces).toBe(1);
    expect(t.totals.total_length_mm).toBe(3000);
    expect(t.existing.totals).toMatchObject({ pieces: 2, members: 2, total_length_mm: 7000 });
    expect(t.existing.rows.map((r) => [r.source.page_number, r.profile])).toEqual([
      [1, 'W12X26'],
      [2, 'W10X12'],
    ]);
    expect(t.existing.by_sheet.map((s) => [s.page_number, s.totals.pieces])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(t.existing.rows.every((r) => r.kind === 'main' && r.excluded === false)).toBe(true);
  });

  it('an existing member on a shared line keeps its profile but its length is not trusted', () => {
    const shared = { ...member('a').link, line: LINE };
    const a = member('a', { link: shared });
    const e = member('e', { link: shared, existing: true, human: 'existing', profile: 'W10X12' });
    annotateSharedLines([a, e]);
    const t = buildTakeoff([a, e], pages);
    expect(t.existing.totals).toMatchObject({
      pieces: 1,
      total_length_mm: 0,
      length_shared_pieces: 1,
    });
    expect(t.existing.rows[0].total_length_mm).toBeNull();
  });

  it('not-a-member labels are counted per reason, never in the totals', () => {
    const nm = (id: string, reason: string) =>
      member(id, { not_member: { reason }, human: 'not_member' });
    const t = buildTakeoff(
      [
        member('a'),
        nm('b1', 'misc_steel'),
        nm('b2', 'misc_steel'),
        nm('b3', 'detail'),
        nm('b4', 'existing'),
      ],
      pages,
    );
    expect(t.totals.pieces).toBe(1);
    expect(t.not_member_reasons).toEqual({
      existing: 1,
      misc_steel: 2,
      detail: 1,
      other: 0,
      total: 4,
    });
    expect(t.review.human.not_member).toBe(4);
  });
});

describe('existing steel through the routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let a: string;
  let b: string;

  const add = async (viewId: string, y: number, profile: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: viewId,
        type: 'beam',
        profile_text: profile,
        point: { x: 300, y },
        line: { p: [200, y], q: [600, y] },
        who: 'alice',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };
  const takeoff = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })).json();
  const existing = (id: string, value: boolean) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members/${id}/existing`,
      payload: { who: 'alice', value },
    });
  const undo = () =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });

  beforeAll(async () => {
    projectId = await insertProject(db);
    const sheetId = await insertSheet(db, projectId, {
      page_index: 0,
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
        structural_classes: ['1.5-2.5|black|solid'],
        classes_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    a = await add(view.id, 300, 'W12x26');
    b = await add(view.id, 400, 'W10x12');
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('marking a member existing moves it to its own block; undo brings it back', async () => {
    expect((await existing(b, true)).statusCode).toBe(200);
    let t = await takeoff();
    expect(t.totals.pieces).toBe(1);
    expect(t.existing.totals.pieces).toBe(1);
    expect(t.existing.rows[0]).toMatchObject({ profile: 'W10X12' });
    expect(t.existing.rows[0].total_length_mm).toBeGreaterThan(0);
    expect(t.review.human.existing).toBe(1);
    expect((await existing(b, true)).json().changed).toBe(false);
    expect((await undo()).statusCode).toBe(200);
    t = await takeoff();
    expect(t.totals.pieces).toBe(2);
    expect(t.existing.totals.pieces).toBe(0);
  });

  it('is in the corrections export, and the Excel has the existing sheet and the reason table', async () => {
    await existing(a, true);
    const lines = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/corrections.jsonl` })
    ).body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.final.existing === true)).toBe(true);
    expect(lines.some((l) => l.edits.some((e: { field: string }) => e.field === 'existing'))).toBe(
      true,
    );
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    const wb = await loadWorkbook(res.rawPayload);
    const ew = wb.getWorksheet('Existing (not counted)')!;
    expect(ew.getRow(2).getCell(4).value).toBe('W12X26');
    const sum = wb.getWorksheet('Summary')!;
    const cells: string[] = [];
    sum.eachRow((r) => cells.push(String(r.getCell(1).value)));
    expect(cells.some((c) => c.startsWith('Labels marked "not a member"'))).toBe(true);
    await undo();
  });
});
