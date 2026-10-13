import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
let projectId: string;
let sheetId: string;
let viewId: string;
let noScaleView: string;

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1200, height_pt: 800 });
  const box = JSON.stringify({ x0: 100, y0: 100, x1: 900, y1: 700 });
  viewId = (
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheetId,
        box,
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  noScaleView = (
    await db
      .insertInto('sheet_views')
      .values({ sheet_id: sheetId, box })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

const post = (body: object) =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}/members`, payload: body });

describe('adding a column by hand', () => {
  it('stores the point in the view frame and is green with both elevations', async () => {
    const res = await post({
      view_id: viewId,
      type: 'column',
      mark: 'C1',
      profile_text: 'HSS 6 x 6 x 3/8',
      point: { x: 172, y: 628 },
      base_elevation: '0\'-0"',
      top_elevation: '12\'-6"',
      who: 'alice',
    });
    expect(res.statusCode).toBe(201);
    const m = res.json();
    expect(m).toMatchObject({
      type: 'column',
      mark: 'C1',
      profile_raw: 'HSS 6 x 6 x 3/8',
      profile: 'HSS6X6X3/8',
      origin: 'manual',
      length_source: 'manual',
    });
    expect(m.length_mm).toBeCloseTo(3810, 6);
    expect(m.status).toEqual({ color: 'green', confirmed: true, reasons: [] });
    // 72 pt right and 72 pt above the lower-left corner of the box, at 1/8" = 1'-0"
    expect(m.plan_point.x_mm).toBeCloseTo(2438.4, 1);
    expect(m.plan_point.y_mm).toBeCloseTo(2438.4, 1);
    const edits = await db
      .selectFrom('member_edits')
      .selectAll()
      .where('member_id', '=', m.id)
      .execute();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ field_name: '__created__', reviewer: 'alice' });
    expect(edits[0].action_id).toBeTruthy();
  });

  it('is not red for a missing base elevation in Stage 1: the length stays empty', async () => {
    const res = await post({
      view_id: viewId,
      type: 'column',
      mark: 'C2',
      profile_text: 'W10x33',
      point: { x: 300, y: 300 },
      top_elevation: '12\'-6"',
      who: 'alice',
    });
    expect(res.json().status).toMatchObject({ color: 'green', reasons: [] });
    expect(res.json().length_mm).toBeNull();
  });

  it('keeps a profile that does not parse as typed, with no canonical profile', async () => {
    const res = await post({
      view_id: viewId,
      type: 'column',
      profile_text: 'TS6x6',
      point: { x: 300, y: 300 },
      base_elevation: '0 mm',
      top_elevation: '3000 mm',
      who: 'alice',
    });
    expect(res.json()).toMatchObject({ profile_raw: 'TS6x6', profile: null, length_mm: 3000 });
  });

  it('works in a view whose scale is not confirmed (a column needs no scale)', async () => {
    const res = await post({
      view_id: noScaleView,
      type: 'column',
      mark: 'C3',
      profile_text: 'W8x31',
      point: { x: 300, y: 300 },
      base_elevation: '0 mm',
      top_elevation: '4000 mm',
      who: 'alice',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status.color).toBe('green');
  });

  it('rejects points outside the view, bad elevations and unknown views', async () => {
    const outside = await post({
      view_id: viewId,
      type: 'column',
      point: { x: 50, y: 50 },
      who: 'a',
    });
    expect(outside.statusCode).toBe(400);
    const badElev = await post({
      view_id: viewId,
      type: 'column',
      point: { x: 300, y: 300 },
      base_elevation: 'high',
      who: 'a',
    });
    expect(badElev.statusCode).toBe(400);
    const none = await post({
      view_id: '00000000-0000-4000-8000-000000000000',
      type: 'column',
      point: { x: 300, y: 300 },
      who: 'a',
    });
    expect(none.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
describe('fixing members', () => {
  let amber: string;
  let markMember: string;
  let legendA: string;
  let legendB: string;
  const cand = (rank: number, y: number, score: number) => ({
    rank,
    p: [100, y],
    q: [700, y],
    score,
    dist: score,
    rel_angle: 0,
  });

  beforeAll(async () => {
    const base = {
      project_id: projectId,
      sheet_id: sheetId,
      view_id: viewId,
      origin: 'extracted',
      type: 'beam',
      field_sources: '{}',
      field_confidence: '{}',
      source_bbox: JSON.stringify({ x0: 300, y0: 100, x1: 340, y1: 110 }),
    };
    amber = (
      await db
        .insertInto('members')
        .values({
          ...base,
          member_id: 'M-fix-1',
          profile_raw: 'W12x26',
          profile: 'W12X26',
          link_confidence: 'medium',
          link_candidates: JSON.stringify([cand(1, 120, 6), cand(2, 150, 20), cand(3, 190, 60)]),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    legendA = (
      await db
        .insertInto('legend_rows')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          mark: 'B1',
          designation_raw: 'HSS6x4x1/4',
          profile: 'HSS6X4X1/4',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    legendB = (
      await db
        .insertInto('legend_rows')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          mark: 'B1',
          designation_raw: 'W8x10',
          profile: 'W8X10',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    markMember = (
      await db
        .insertInto('members')
        .values({
          ...base,
          member_id: 'M-fix-2',
          mark: 'B1',
          mark_ref_status: 'ambiguous',
          link_confidence: 'high',
          link_candidates: JSON.stringify([cand(1, 120, 6)]),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  const url = (id: string, tail: string) => `/api/projects/${projectId}/members/${id}${tail}`;
  const get = async (id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/members?include_deleted=true`,
      })
    )
      .json()
      .members.find((m: { id: string }) => m.id === id);

  it('picking candidate 2 stores the person-chosen line, before and after', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url(amber, '/link'),
      payload: { who: 'carol', rank: 2 },
    });
    expect(res.statusCode).toBe(200);
    const m = res.json().member;
    expect(m.link).toMatchObject({ source: 'person', chosen_rank: 2 });
    expect(m.link.line).toEqual({ p: [100, 150], q: [700, 150] });
    expect(m.status.color).toBe('green');
    const edit = await db
      .selectFrom('member_edits')
      .selectAll()
      .where('member_id', '=', amber)
      .where('field_name', '=', 'link')
      .executeTakeFirstOrThrow();
    expect(edit.original_value).toEqual({ reset: true }); // the rule's proposal was in force
    expect(edit.corrected_value).toEqual({ line: { p: [100, 150], q: [700, 150] }, rank: 2 });
    expect([edit.reviewer, edit.action_id !== null]).toEqual(['carol', true]);
    const stored = await db
      .selectFrom('members')
      .select('link_candidates')
      .where('id', '=', amber)
      .executeTakeFirstOrThrow();
    expect((stored.link_candidates as { rank: number }[])[0].rank).toBe(1); // the proposal is untouched
  });

  it('clicking another line works and is not tied to a candidate rank', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url(amber, '/link'),
      payload: { who: 'carol', line: { p: [100, 300], q: [400, 300] } },
    });
    expect(res.json().member.link).toMatchObject({ source: 'person', chosen_rank: null });
    expect(res.json().member.length_mm).toBeCloseTo((300 * 25.4 * 96) / 72, 3);
    const bad = await app.inject({
      method: 'POST',
      url: url(amber, '/link'),
      payload: { who: 'carol', rank: 3, line: undefined },
    });
    expect(bad.statusCode).toBe(200);
    const none = await app.inject({
      method: 'POST',
      url: url(amber, '/link'),
      payload: { who: 'carol' },
    });
    expect(none.statusCode).toBe(400);
  });

  it('editing the profile re-parses it; an unparsed text keeps the raw string and leaves the profile empty', async () => {
    const ok = await app.inject({
      method: 'PATCH',
      url: url(amber, ''),
      payload: { who: 'carol', profile_text: 'W 14 x 30' },
    });
    expect(ok.json().member).toMatchObject({ profile_raw: 'W 14 x 30', profile: 'W14X30' });
    const odd = await app.inject({
      method: 'PATCH',
      url: url(amber, ''),
      payload: { who: 'carol', profile_text: 'TS6x6' },
    });
    expect(odd.json().member).toMatchObject({ profile_raw: 'TS6x6', profile: null });
    const same = await app.inject({
      method: 'PATCH',
      url: url(amber, ''),
      payload: { who: 'carol', profile_text: 'TS6x6' },
    });
    expect(same.json()).toMatchObject({ changed: false, action_id: null });
  });

  it('level, mark and type edits are member-level overrides', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: url(amber, ''),
      payload: { who: 'carol', level: 'Roof', mark: 'B7', type: 'brace' },
    });
    expect(res.json().member).toMatchObject({ level: 'Roof', mark: 'B7', type: 'brace' });
    const back = await app.inject({
      method: 'PATCH',
      url: url(amber, ''),
      payload: { who: 'carol', level: null },
    });
    expect(back.json().member.level).toBeNull();
  });

  it('confirming a legend row takes its profile and links the mark', async () => {
    const before = await get(markMember);
    expect(before.status.reasons).toContain('mark has several legend rows');
    const res = await app.inject({
      method: 'POST',
      url: url(markMember, '/mark-ref'),
      payload: { who: 'carol', legend_row_id: legendB },
    });
    expect(res.json().member).toMatchObject({ profile_raw: 'W8x10', profile: 'W8X10' });
    expect(res.json().member.mark_ref).toEqual({ status: 'linked', legend_row_id: legendB });
    // high confidence, parsed profile and a linked mark: green by the rule alone, not yet confirmed
    expect(res.json().member.status).toEqual({ color: 'green', confirmed: false, reasons: [] });
    const rows = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/legend?mark=B1` })
    ).json().rows;
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual([legendA, legendB].sort());
    const unknown = await app.inject({
      method: 'POST',
      url: url(markMember, '/mark-ref'),
      payload: { who: 'carol', legend_row_id: '00000000-0000-4000-8000-000000000000' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('"looks right" turns amber into confirmed green; delete hides the member', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: url(markMember, '/confirm'),
      payload: { who: 'carol' },
    });
    expect(ok.json().member.status).toEqual({ color: 'green', confirmed: true, reasons: [] });
    const again = await app.inject({
      method: 'POST',
      url: url(markMember, '/confirm'),
      payload: { who: 'carol' },
    });
    expect(again.json().changed).toBe(false);
    const del = await app.inject({
      method: 'POST',
      url: url(markMember, '/delete'),
      payload: { who: 'carol' },
    });
    expect(del.json().member.deleted).toBe(true);
    const list = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members` })
    ).json();
    expect(list.members.find((m: { id: string }) => m.id === markMember)).toBeUndefined();
  });

  it('undo reverts the last action of this person, one at a time, and keeps the history', async () => {
    // last two actions of carol: confirm, then delete (of markMember)
    const first = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'carol' },
    });
    expect(first.statusCode).toBe(200);
    expect((await get(markMember)).deleted).toBe(false); // the delete is undone
    expect((await get(markMember)).status.confirmed).toBe(true); // the confirm still holds
    const second = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'carol' },
    });
    expect(second.statusCode).toBe(200);
    expect((await get(markMember)).status.confirmed).toBe(false); // the confirm is undone
    const edits = await db
      .selectFrom('member_edits')
      .selectAll()
      .where('member_id', '=', markMember)
      .execute();
    expect(edits.filter((e) => e.undo_of_action_id !== null).length).toBeGreaterThanOrEqual(2);
    expect(edits.length).toBeGreaterThanOrEqual(6); // nothing was deleted
    const other = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'nobody' },
    });
    expect([other.statusCode, other.json().error]).toEqual([409, 'nothing to undo']);
  });

  it('undoing a first link edit puts the rule proposal back (not a person choice)', async () => {
    const solo = (
      await db
        .insertInto('members')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          view_id: viewId,
          member_id: 'M-fix-3',
          origin: 'extracted',
          type: 'beam',
          profile_raw: 'W10x33',
          profile: 'W10X33',
          link_confidence: 'medium',
          link_candidates: JSON.stringify([cand(1, 120, 6), cand(2, 150, 20)]),
          field_sources: '{}',
          field_confidence: '{}',
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await app.inject({
      method: 'POST',
      url: url(solo, '/link'),
      payload: { who: 'dave', rank: 2 },
    });
    expect((await get(solo)).link.source).toBe('person');
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'dave' },
    });
    const m = await get(solo);
    expect(m.link).toMatchObject({ source: 'rule', chosen_rank: 1 });
    expect(m.status.confirmed).toBe(false);
  });

  it('a member added on a line is a person-made, measured beam; undoing the add hides it', async () => {
    const res = await post({
      view_id: viewId,
      type: 'beam',
      mark: 'B9',
      profile_text: 'W16x31',
      point: { x: 400, y: 400 },
      line: { p: [100, 400], q: [700, 400] },
      who: 'erin',
    });
    expect(res.statusCode).toBe(201);
    const m = res.json();
    expect(m).toMatchObject({ origin: 'manual', type: 'beam', profile: 'W16X31' });
    expect(m.link).toMatchObject({ source: 'person' });
    expect(m.length_mm).toBeCloseTo((600 * 25.4 * 96) / 72, 3);
    expect(m.status.color).toBe('green');
    const noLine = await post({
      view_id: viewId,
      type: 'beam',
      point: { x: 400, y: 400 },
      who: 'erin',
    });
    expect(noLine.statusCode).toBe(400);
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'erin' },
    });
    expect((await get(m.id)).deleted).toBe(true);
  });
});

describe('click targets and the corrections export', () => {
  it('serves the structural lines of a view', async () => {
    await db
      .updateTable('sheet_views')
      .set({
        structural_lines: JSON.stringify([[100, 120, 700, 120]]),
        structural_classes: ['1.5-2.5|black|solid'],
      })
      .where('id', '=', viewId)
      .execute();
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/views/${viewId}/lines`,
    });
    expect(res.json()).toEqual({ classes: ['1.5-2.5|black|solid'], lines: [[100, 120, 700, 120]] });
    const none = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/views/00000000-0000-4000-8000-000000000000/lines`,
    });
    expect(none.statusCode).toBe(404);
  });

  it('exports every touched member with proposed link, final link and the edits', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/corrections.jsonl`,
    });
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const lines = res.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const fix1 = lines.find((l) => l.member_id === 'M-fix-1');
    expect(fix1.proposed.line).toEqual({ p: [100, 120], q: [700, 120] });
    expect(fix1.proposed.confidence).toBe('medium');
    expect(fix1.final.source).toBe('person');
    expect(fix1.link_changed).toBe(true);
    expect(fix1.who).toBe('carol');
    expect(
      fix1.edits.every(
        (e: { who: string; when: string; action_id: string }) => e.who && e.when && e.action_id,
      ),
    ).toBe(true);
    expect(fix1.edits.map((e: { field: string }) => e.field)).toContain('link');
    const added = lines.find((l) => l.origin === 'manual' && l.final.mark === 'B9');
    expect(added.final.deleted).toBe(true);
    // a member nobody touched is not in the export
    expect(lines.find((l) => l.member_id === 'M-fix-nothing')).toBeUndefined();
  });
});
