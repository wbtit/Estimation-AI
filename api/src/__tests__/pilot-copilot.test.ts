// Phase 9 Part D: unlinked labels as amber suggestions, a person's piece with no line still counts,
// ranked snap with Tab, tag numbering scope, the pilot switch.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

interface Row {
  id: string;
  sheet_id: string;
  deleted: boolean;
  count: {
    state: string;
    source: string | null;
    snapped: boolean | null;
    snapped_line: { id: number; rank?: number; by?: string } | null;
  };
  status: { color: string; reasons: string[] };
  tag: { text: string };
  quantity: number;
}

const app = buildApp();
const db = getDb();
const WHO = 'alice';

let projectId: string;
let sheetA: string;
let sheetB: string;
let viewA: string;
const ids: Record<string, string> = {};

// rows [x0, y0, x1, y1, class, width, role, dimension]
const CLASSES = ['2-3|black|solid', '0-1|black|solid'];
const LINES = [
  [100, 300, 700, 300, 0, 2.0, 3, 0], // 0: a heavy beam
  [100, 304, 700, 304, 1, 0.25, 1, 0], // 1: a thin line, nearer to the click
  [100, 302, 700, 302, 1, 0.25, 0, 0], // 2: hatch, nearest of all
  [100, 303, 700, 303, 1, 0.25, 1, 1], // 3: a dimension line
];

const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
const get = (url: string) => app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
const put = (payload: object) =>
  app.inject({ method: 'PUT', url: `/api/projects/${projectId}/count`, payload });
const click = (sheet: string, kind: string, x: number, y: number, extra: object = {}) =>
  post('/count/click', { who: WHO, sheet_id: sheet, kind, x, y, ...extra });
const members = async () => (await get('/members?include_deleted=true')).json().members as Row[];
const takeoff = async () => (await get('/takeoff')).json();

async function insertLabel(
  key: string,
  sheetId: string,
  text: string | null,
  y: number,
  linked: boolean,
) {
  const row = await db
    .insertInto('members')
    .values({
      project_id: projectId,
      sheet_id: sheetId,
      view_id: sheetId === sheetA ? viewA : null,
      member_id: `M-${key}`,
      origin: 'extracted',
      type: 'beam',
      profile_raw: text,
      profile: text ? text.toUpperCase() : null,
      field_sources: '{}',
      field_confidence: '{}',
      source_bbox: JSON.stringify({ x0: 800, y0: y - 14, x1: 840, y1: y - 6 }),
      link_confidence: linked ? 'high' : null,
      link_candidates: linked
        ? JSON.stringify([{ rank: 1, p: [100, y], q: [700, y], score: 5, dist: 5, rel_angle: 0 }])
        : null,
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  ids[key] = row.id;
}

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetA = await insertSheet(db, projectId, {
    page_index: 0,
    page_type_guess: 'framing_plan',
    decided: 'include',
    width_pt: 1200,
    height_pt: 800,
  });
  sheetB = await insertSheet(db, projectId, {
    page_index: 1,
    page_type_guess: 'framing_plan',
    decided: 'include',
    width_pt: 1200,
    height_pt: 800,
  });
  viewA = (
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheetA,
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  await db
    .insertInto('sheet_lines')
    .values({
      sheet_id: sheetA,
      classes: JSON.stringify(CLASSES),
      lines: JSON.stringify(LINES),
      n_lines: LINES.length,
      version: 'v-roles',
    })
    .execute();
  await insertLabel('L', sheetA, 'W12x26', 300, true); // linked
  await insertLabel('U', sheetA, 'W8x10', 650, false); // a size label with no line
  await insertLabel('N', sheetA, null, 700, false); // an unlinked label with no parsed size
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

describe('the pilot switch', () => {
  it('count mode (the pilot) is off for a new project and is switched per project, with a log row', async () => {
    expect((await get('/count')).json()).toMatchObject({ count_mode: false, tag_scope: 'job' });
    const other = await insertProject(db);
    const res = await app.inject({ method: 'GET', url: `/api/projects/${other}/count` });
    expect(res.json().count_mode).toBe(false);
    await deleteProject(db, other);
  });
});

describe('unlinked size labels are amber suggestions in count mode', () => {
  it('outside count mode they stay in the unlinked list only', async () => {
    const t = await takeoff();
    expect(t.count_mode).toBe(false);
    expect(t.unlinked_labels.count).toBe(2); // U and N
    expect(t.unlinked_labels.as_suggestions).toBe(0);
    const inRows = t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(inRows).not.toContain(ids.U);
  });

  it('count mode on: the unlinked size label is listed as an amber suggestion, in no total', async () => {
    const on = await put({ who: WHO, count_mode: true });
    expect(on.json().count_mode).toBe(true);
    const t = await takeoff();
    const suggested = t.suggested.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(suggested).toContain(ids.U);
    expect(suggested).not.toContain(ids.N); // no parsed size: stays in the unlinked list
    expect(t.unlinked_labels).toMatchObject({ count: 2, as_suggestions: 1 });
    const urow = t.suggested.rows.find((r: { member_ids: string[] }) =>
      r.member_ids.includes(ids.U),
    );
    expect(urow.color).toBe('amber');
    const inRows = t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(inRows).not.toContain(ids.U);
    const flags = (await get('/flags')).json();
    const sheet = flags.sheets.find((s: { sheet_id: string }) => s.sheet_id === sheetA);
    expect(sheet.suggested_count).toBeGreaterThanOrEqual(2); // L and U
    const tables = (await get('/tables')).json();
    expect(tables.job.suggested.pieces).toBeGreaterThanOrEqual(2);
  });

  it('accepting it makes a counted piece (amber, "no line"); rejecting keeps it out of every list', async () => {
    const acc = await post(`/members/${ids.U}/count-decision`, { who: WHO, decision: 'accept' });
    expect(acc.statusCode).toBe(200);
    let t = await takeoff();
    let inRows = t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(inRows).toContain(ids.U);
    const u = (await members()).find((m) => m.id === ids.U) as Row;
    expect(u.count).toMatchObject({ state: 'confirmed', source: 'suggestion_accepted' });
    expect(u.status.color).toBe('amber');
    expect(u.status.reasons.join(' ')).toContain('no line');
    expect(t.unlinked_labels.as_suggestions).toBe(0);

    await post(`/members/${ids.U}/count-decision`, { who: WHO, decision: 'reject' });
    t = await takeoff();
    inRows = t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    const listed = t.suggested.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(inRows).not.toContain(ids.U);
    expect(listed).not.toContain(ids.U);
    await post(`/members/${ids.U}/count-decision`, { who: WHO, decision: 'reset' });
    expect(
      (await takeoff()).suggested.rows.flatMap((r: { member_ids: string[] }) => r.member_ids),
    ).toContain(ids.U);
  });

  it('a click with nothing near keeps the piece and it is counted in count mode', async () => {
    const res = await click(sheetB, 'Beams', 900, 700);
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.snap).toMatchObject({ snapped: false });
    const t = await takeoff();
    const inRows = t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(inRows).toContain(j.member.id);
    ids.nosnap = j.member.id;
  });
});

describe('ranked snap: no hatch, no dimension line, solid heavy first, Tab picks another', () => {
  it('a click between a heavy beam, a thin line, hatch and a dimension line snaps to the beam', async () => {
    const res = await click(sheetA, 'Beams', 200, 302.4);
    const j = res.json();
    expect(j.snap.snapped).toBe(true);
    expect(j.snap.line).toMatchObject({ id: 0, rank: 0, by: 'rank', version: 'v-roles' });
    ids.snapBeam = j.member.id;
  });

  it('Tab to the next candidate: the chosen line is used and the evidence says so', async () => {
    const res = await click(sheetA, 'Beams', 200, 302.4, {
      snap_choice: { line_id: 1, version: 'v-roles' },
    });
    const j = res.json();
    expect(j.snap.line).toMatchObject({ id: 1, rank: 1, by: 'tab' });
    expect(j.member.count.snapped_line).toMatchObject({ id: 1, by: 'tab' });
    const log = (await get('/count-actions')).json();
    const last = log.actions.find((a: { member_id: string }) => a.member_id === j.member.id);
    expect(last.detail).toMatchObject({ snap_rank: 1, snap_by: 'tab', snap_candidates: 2 });
  });

  it('a choice that is hatch, a dimension line, out of range or of an old version is ignored', async () => {
    for (const choice of [
      { line_id: 2, version: 'v-roles' }, // hatch
      { line_id: 3, version: 'v-roles' }, // dimension line
      { line_id: 99, version: 'v-roles' }, // not a line
      { line_id: 1, version: 'older' }, // the lines changed since the pointer moved
    ]) {
      const res = await click(sheetA, 'Beams', 200, 302.4, { snap_choice: choice });
      expect(res.json().snap.line).toMatchObject({ id: 0, rank: 0, by: 'rank' });
    }
  });
});

describe('tag numbering: per job and per kind, in click order; the scope is a project setting', () => {
  it('job scope (default): the next number of a kind runs on across sheets', async () => {
    const all = (await members()).filter((m) => m.count.source === 'human_click' && !m.deleted);
    const beamTags = all
      .filter((m) => /^[A-Z]+\d+$/.test(m.tag.text))
      .map((m) => ({
        prefix: /^[A-Z]+/.exec(m.tag.text)?.[0],
        n: Number(/\d+$/.exec(m.tag.text)),
      }));
    const prefix = beamTags[0]?.prefix;
    const ns = beamTags.filter((t) => t.prefix === prefix).map((t) => t.n);
    expect(new Set(ns).size).toBe(ns.length); // no number is used twice in the job
    const before = Math.max(...ns);
    const res = await click(sheetB, 'Beams', 300, 300);
    expect(Number(/\d+$/.exec(res.json().member.tag.text))).toBe(before + 1); // sheet B continues the job's number
  });

  it('an edit to a tag used elsewhere in the job is refused; on a sheet-scope project it is allowed', async () => {
    const mine = (await members()).filter((m) => m.count.source === 'human_click' && !m.deleted);
    const onA = mine.find((m) => m.id === ids.snapBeam) as Row;
    const onB = mine.find((m) => m.id === ids.nosnap) as Row;
    const patch = (id: string, tag_text: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}/members/${id}`,
        payload: { who: WHO, tag_text },
      });
    expect((await patch(onB.id, onA.tag.text)).statusCode).toBe(409);
    expect((await put({ who: WHO, tag_scope: 'sheet' })).json().tag_scope).toBe('sheet');
    // sheet scope: the same text on another sheet is a different tag
    expect((await patch(onB.id, onA.tag.text)).statusCode).toBe(200);
    // and the next click on sheet B numbers from that sheet's own tags only
    const prefix = /^[A-Z]+/.exec(onA.tag.text)?.[0];
    const own = (await members()).filter(
      (m) => m.sheet_id === sheetB && m.tag.text.startsWith(prefix ?? ''),
    );
    const maxOwn = Math.max(0, ...own.map((m) => Number(/\d+$/.exec(m.tag.text)?.[0] ?? 0)));
    const res = await click(sheetB, 'Beams', 320, 320);
    expect(Number(/\d+$/.exec(res.json().member.tag.text))).toBe(maxOwn + 1);
    await put({ who: WHO, tag_scope: 'job' });
  });

  it('the setting is logged and refuses an unknown scope', async () => {
    expect((await put({ who: WHO, tag_scope: 'page' })).statusCode).toBe(400);
    const log = (await get('/count-actions')).json();
    expect(
      log.actions.some(
        (a: { action: string; detail: { change?: { tag_scope?: string } } }) =>
          a.action === 'mode' && a.detail.change?.tag_scope === 'sheet',
      ),
    ).toBe(true);
  });
});
