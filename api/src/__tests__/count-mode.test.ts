import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { loadWorkbook, deleteProject, insertProject, insertSheet } from './helpers.js';

interface Row {
  id: string;
  deleted: boolean;
  count: { state: string; source: string | null; size_source: string | null };
  status: { color: string };
  tag: { text: string };
  length_source: string | null;
  length_measurement: string | null;
  length_mm: number;
  length_ft: number;
  length_in: number;
  unit_w: number | null;
  total_w: number | null;
  quantity: number;
  member_ids: string[];
}

const app = buildApp();
const db = getDb();
const WHO = 'alice';

let projectId: string;
let sheetId: string;
let viewId: string;
// lines of the synthetic sheet: [x0, y0, x1, y1, class, width]
const LINES = [
  [100, 300, 700, 300, 0, 2.0], // 0: a heavy beam line
  [100, 360, 700, 360, 1, 0.25], // 1: a thin line
  [100, 420, 700, 420, 2, 0.5], // 2: a dashed class
  [400, 100, 400, 500, 0, 2.0], // 3: a vertical line crossing 0, 1 and 2
];
const ids: Record<string, string> = {};
let tagNumber = 0;
const cand = (y: number) => [
  { rank: 1, p: [100, y], q: [700, y], score: 5, dist: 5, rel_angle: 0 },
];

const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
const get = (url: string) => app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
const click = async (kind: string, x: number, y: number, extra: object = {}) =>
  post('/count/click', { who: WHO, sheet_id: sheetId, kind, x, y, ...extra });
const members = async () => (await get('/members?include_deleted=true')).json().members as Row[];
const takeoff = async () => (await get('/takeoff')).json();

async function insertLabel(
  key: string,
  text: string,
  y: number,
  x0: number,
  linked: boolean,
  confidence: 'high' | 'low' = 'high',
) {
  const row = await db
    .insertInto('members')
    .values({
      project_id: projectId,
      sheet_id: sheetId,
      view_id: viewId,
      member_id: `M-${key}`,
      origin: 'extracted',
      type: 'beam',
      profile_raw: text,
      profile: text.toUpperCase(),
      field_sources: '{}',
      field_confidence: '{}',
      source_bbox: JSON.stringify({ x0, y0: y - 14, x1: x0 + 40, y1: y - 6 }),
      link_confidence: linked ? confidence : null,
      link_candidates: linked ? JSON.stringify(cand(y)) : null,
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  ids[key] = row.id;
}

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, {
    page_index: 0,
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
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
        scale_ratio: 96,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  // two system labels: A is linked to the beam line at y = 300, B is linked to the line at y = 420
  await insertLabel('A', 'W12x26', 300, 450, true);
  await insertLabel('B', 'HSS6x6x1/4', 420, 450, true);
  // C: a label with no line, in open space
  await insertLabel('C', 'W8x10', 650, 800, false);
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

describe('count mode: settings and the lines of a sheet', () => {
  it('defaults: count mode off, 24 pt snap radius, 80 pt label radius; changing it is logged', async () => {
    expect((await get('/count')).json()).toEqual({
      count_mode: false,
      snap_radius_pt: 24,
      label_radius_pt: 80,
    });
    const put = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, snap_radius_pt: 30 },
    });
    expect(put.json().snap_radius_pt).toBe(30);
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, snap_radius_pt: 24 },
    });
    const log = (await get('/count-actions')).json().actions;
    expect(log.filter((a: { action: string }) => a.action === 'mode')).toHaveLength(2);
  });

  it('the lines are not there until the worker has written them; prepare queues the job once', async () => {
    expect((await get(`/sheets/${sheetId}/lines`)).statusCode).toBe(404);
    // the scan must be done before lines can be asked for
    expect((await post(`/sheets/${sheetId}/lines/prepare`, {})).statusCode).toBe(409);
    await db
      .insertInto('project_files')
      .values({
        project_id: projectId,
        original_filename: 'x.pdf',
        stored_path: `${projectId}/x.pdf`,
        sha256: 'a'.repeat(64),
        size_bytes: 10,
        scan_status: 'done',
      } as never)
      .execute();
    const first = await post(`/sheets/${sheetId}/lines/prepare`, {});
    const second = await post(`/sheets/${sheetId}/lines/prepare`, {});
    expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
    expect(first.json().job_id).toBe(second.json().job_id);
    await db
      .deleteFrom('jobs')
      .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
      .execute();
  });

  it('a click before the lines exist is kept (not snapped, flagged lines_ready false)', async () => {
    const res = await click('Beams', 250, 304);
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.snap).toMatchObject({ snapped: false, line: null, lines_ready: false });
    expect(j.member.count).toMatchObject({
      state: 'confirmed',
      source: 'human_click',
      snapped: false,
    });
    // delete it again so the later counts are clean (a soft delete)
    await post(`/members/${j.member.id}/delete`, { who: WHO });
  });

  it('serves the lines once they are stored', async () => {
    await db
      .insertInto('sheet_lines')
      .values({
        sheet_id: sheetId,
        classes: JSON.stringify(['2-3|black|solid', '0-1|black|solid', '0.5-1|black|dash']),
        lines: JSON.stringify(LINES),
        n_lines: LINES.length,
        version: 'v-test',
      })
      .execute();
    expect((await post(`/sheets/${sheetId}/lines/prepare`, {})).json()).toMatchObject({
      status: 'ready',
      n_lines: 4,
    });
    const l = (await get(`/sheets/${sheetId}/lines`)).json();
    expect(l.version).toBe('v-test');
    expect(l.lines).toHaveLength(4);
  });
});

describe('count mode: a click makes a confirmed piece with evidence', () => {
  it('snaps to the nearest line of ANY class and stores the line as evidence; size from the linked label', async () => {
    const res = await click('Beams', 520, 296); // 4 pt from the heavy beam line, label A is linked to it
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.snap).toMatchObject({ snapped: true, distance_pt: 4, lines_ready: true });
    expect(j.snap.line).toMatchObject({ id: 0, p: [100, 300], q: [700, 300], version: 'v-test' });
    expect(j.size).toMatchObject({ source: 'linked_label', profile_text: 'W12x26' });
    const m = j.member;
    expect(m).toMatchObject({
      origin: 'manual',
      profile: 'W12X26',
      kind: { name: 'Beams', state: 'confirmed', source: 'person' },
    });
    expect(m.count).toMatchObject({
      state: 'confirmed',
      source: 'human_click',
      snapped: true,
      size_source: 'linked_label',
    });
    expect(m.count.click).toMatchObject({ x: 520, y: 296 });
    expect(new Date(m.count.click.at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(m.count.size_evidence).toMatchObject({ member_id: ids.A });
    expect(m.link.line).toEqual({ p: [100, 300], q: [700, 300] });
    expect(m.tag.text).toMatch(/^[A-Za-z]+\d+$/);
    tagNumber = Number(/\d+$/.exec(m.tag.text)?.[0]);
    ids.click1 = m.id;
  });

  it('a thin line that is nearer wins over a heavier one (any class)', async () => {
    const res = await click('Beams', 600, 356); // 4 pt from the thin line (class 1)
    const j = res.json();
    expect(j.snap.line).toMatchObject({ id: 1 });
    expect(Number(/\d+$/.exec(j.member.tag.text)?.[0])).toBe(tagNumber + 1); // click order
    ids.click2 = j.member.id;
  });

  it('with no linked label the nearest profile label within the radius fills the size', async () => {
    const res = await click('Beams', 500, 340); // snaps to the thin line (no label linked to it)
    const j = res.json();
    expect(j.snap.line).toMatchObject({ id: 1 });
    expect(j.size.source).toBe('nearest_label'); // label A's box is about 46 pt away: inside 80
    expect(j.size.profile_text).toBe('W12x26');
    ids.click3 = j.member.id;
  });

  it('with no label in range the size is blank, the piece is amber, and a person can type it', async () => {
    const res = await click('Beams', 1000, 700); // nothing near: no snap, no label within 80 pt
    const j = res.json();
    expect(j.snap).toMatchObject({ snapped: false, line: null });
    expect(j.size).toEqual({ profile_text: null, source: 'none', evidence: null });
    expect(j.member.status).toMatchObject({ color: 'amber' });
    expect(j.member.status.reasons.join(' ')).toContain('size missing');
    expect(j.member.count.state).toBe('confirmed'); // the click is never dropped
    ids.click4 = j.member.id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.click4}`,
      payload: { who: WHO, profile_text: 'W10x12' },
    });
    expect(patch.json().member).toMatchObject({ profile: 'W10X12' });
    expect(patch.json().member.count.size_source).toBe('manual');
    expect(patch.json().member.status.color).not.toBe('amber');
  });

  it('the radius is configurable per click; a different kind has its own running number', async () => {
    const tight = await click('Beams', 520, 306, { radius: 4 }); // 6 pt away, radius 4: no snap
    expect(tight.json().snap.snapped).toBe(false);
    const col = await click('Column', 400, 300); // a different kind: its own prefix and number 1
    const t = col.json().member.tag.text as string;
    expect(t).toMatch(/1$/);
    expect(t).not.toBe(tight.json().member.tag.text);
    ids.tight = tight.json().member.id;
    ids.col = col.json().member.id;
  });

  it('rejects a click outside the page, an unknown kind and a blank name', async () => {
    expect((await click('Beams', 5000, 5)).statusCode).toBe(400);
    expect((await click('Not a kind', 10, 10)).statusCode).toBe(400);
    expect(
      (await post('/count/click', { who: ' ', sheet_id: sheetId, kind: 'Beams', x: 1, y: 1 }))
        .statusCode,
    ).toBe(400);
  });

  it('the tag is editable, and a tag already used on the sheet is refused', async () => {
    const own = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.click1}`,
      payload: { who: WHO, tag_text: 'B7' },
    });
    expect(own.json().member.tag.text).toBe('B7');
    const clash = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.click2}`,
      payload: { who: WHO, tag_text: 'b7' },
    });
    expect(clash.statusCode).toBe(409);
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.click2}`,
      payload: { who: WHO, tag_text: '??' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('count mode: suggestions are accepted or rejected, everything is undoable', () => {
  it('a suggestion starts undecided; accept makes it a confirmed piece, reject keeps it out of every total', async () => {
    const before = (await members()).find((m) => m.id === ids.A) as Row;
    expect(before.count).toMatchObject({ state: 'suggested', source: null });
    const acc = await post(`/members/${ids.A}/count-decision`, { who: WHO, decision: 'accept' });
    expect(acc.json().member.count).toMatchObject({
      state: 'confirmed',
      source: 'suggestion_accepted',
    });
    const rej = await post(`/members/${ids.B}/count-decision`, { who: WHO, decision: 'reject' });
    expect(rej.json().member.count).toMatchObject({ state: 'rejected', source: null });
    // the rejected one is kept
    expect((await members()).some((m) => m.id === ids.B)).toBe(true);
  });

  it('a clicked piece is not a suggestion: the decision is refused', async () => {
    const r = await post(`/members/${ids.click1}/count-decision`, { who: WHO, decision: 'reject' });
    expect(r.statusCode).toBe(409);
  });

  it('undo reverses the last action, redo puts it back, and a new action clears the redo', async () => {
    await post('/undo', { who: WHO }); // undoes the reject of B
    expect(((await members()).find((m) => m.id === ids.B) as Row).count.state).toBe('suggested');
    expect((await post('/redo', { who: WHO })).statusCode).toBe(200);
    expect(((await members()).find((m) => m.id === ids.B) as Row).count.state).toBe('rejected');
    await post('/undo', { who: WHO });
    expect(((await members()).find((m) => m.id === ids.B) as Row).count.state).toBe('suggested');
    // a new action clears the redo
    await post(`/members/${ids.B}/count-decision`, { who: WHO, decision: 'reject' });
    expect((await post('/redo', { who: WHO })).statusCode).toBe(409);
    // the undo of that action is possible again, and again redo works
    await post('/undo', { who: WHO });
    expect(((await members()).find((m) => m.id === ids.B) as Row).count.state).toBe('suggested');
    await post('/redo', { who: WHO });
    expect(((await members()).find((m) => m.id === ids.B) as Row).count.state).toBe('rejected');
  });

  it('undo of a click makes the piece a soft-deleted one (kept, out of totals); redo brings it back', async () => {
    const res = await click('Beams', 300, 302);
    const id = res.json().member.id as string;
    await post('/undo', { who: WHO });
    const gone = (await members()).find((m) => m.id === id) as Row;
    expect(gone).toBeDefined();
    expect(gone.deleted).toBe(true);
    await post('/redo', { who: WHO });
    expect(((await members()).find((m) => m.id === id) as Row).deleted).toBe(false);
    ids.click5 = id;
  });

  it('delete is a soft delete and is logged', async () => {
    const r = await post(`/members/${ids.click5}/delete`, { who: WHO });
    expect(r.statusCode).toBe(200);
    expect(((await members()).find((m) => m.id === ids.click5) as Row).deleted).toBe(true);
    const last = (await get('/count-actions')).json().actions.at(-1);
    expect(last).toMatchObject({ action: 'delete', member_id: ids.click5, who: WHO });
  });

  it("a person cannot undo another person's action", async () => {
    const r = await post('/undo', { who: 'bob' });
    expect(r.statusCode).toBe(409);
  });
});

describe('count mode: totals, tables and the Excel export count confirmed pieces only', () => {
  it('outside count mode the totals are the old ones: every linked member counts; a rejected one never does', async () => {
    const t = await takeoff();
    expect(t.count_mode).toBe(false);
    // legacy view: A (accepted) + click pieces; B rejected; C unlinked (no line)
    const sizes = t.rows.map((r: { profile: string }) => r.profile);
    expect(sizes).not.toContain('HSS6X6X1/4'); // the rejected suggestion is out
    expect(t.review.count.rejected).toBe(1);
  });

  it('count mode on: only confirmed pieces are in the totals; undecided suggestions are listed apart', async () => {
    // a fresh undecided suggestion
    await insertLabel('D', 'W14x30', 420, 150, true); // on the line B was rejected from
    const on = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, count_mode: true },
    });
    expect(on.json().count_mode).toBe(true);
    const t = await takeoff();
    expect(t.count_mode).toBe(true);
    const confirmed = (await members()).filter(
      (m) => m.count.state === 'confirmed' && !m.deleted && m.status.color !== 'unlinked',
    );
    // every counted piece is a click or an accepted suggestion
    expect(t.totals.labels).toBe(confirmed.length);
    const inTotals = new Set(t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids));
    for (const m of await members()) {
      if (inTotals.has(m.id)) expect(m.count.state).toBe('confirmed');
    }
    // D is suggested and shown apart, never in a total
    expect(t.suggested.totals.labels).toBeGreaterThanOrEqual(1);
    const suggestedIds = new Set(
      t.suggested.rows.flatMap((r: { member_ids: string[] }) => r.member_ids),
    );
    expect(suggestedIds.has(ids.D)).toBe(true);
    expect(inTotals.has(ids.D)).toBe(false);
    expect(inTotals.has(ids.B)).toBe(false); // rejected
    expect(suggestedIds.has(ids.B)).toBe(false);
  });

  it('the sheet list counts confirmed pieces and shows the suggested ones apart', async () => {
    const f = (await get('/flags')).json();
    const sheet = f.sheets.find((s: { sheet_id: string }) => s.sheet_id === sheetId);
    expect(sheet.piece_count).toBeGreaterThan(0);
    expect(sheet.suggested_count).toBe(1); // D
  });

  it('the page and job tables list suggestions apart, not in a total', async () => {
    const t = (await get('/tables')).json();
    expect(t.job.suggested.pieces).toBe(1);
    expect(t.pages[0].suggested.pieces).toBe(1);
    const inRows = t.job.rows.flatMap((r: { member_ids: string[] }) => r.member_ids);
    expect(inRows).not.toContain(ids.D);
    expect(inRows).not.toContain(ids.B);
  });

  it('the takeoff workbook has the confirmed totals and a sheet for the undecided suggestions', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    const wb = await loadWorkbook(res.rawPayload);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toContain('Suggested (undecided)');
    const sw = wb.getWorksheet('Suggested (undecided)')!;
    const cells: string[] = [];
    sw.eachRow((row) => cells.push(String(row.getCell(1).value)));
    expect(cells.some((c) => c.startsWith('SUGGESTED, NOT IN ANY TOTAL'))).toBe(true);
    const take = wb.getWorksheet('Takeoff')!;
    const texts: string[] = [];
    take.eachRow((row) => texts.push(String(row.getCell(1).value)));
    expect(texts.some((c) => c.startsWith('COUNT MODE:'))).toBe(true);
  });

  it('count mode off again: the old behaviour returns (suggestions count again)', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: WHO, count_mode: false },
    });
    const t = await takeoff();
    expect(t.count_mode).toBe(false);
    expect(t.suggested.totals.labels).toBe(0);
    const inTotals = new Set(t.rows.flatMap((r: { member_ids: string[] }) => r.member_ids));
    expect(inTotals.has(ids.D)).toBe(true);
    expect(inTotals.has(ids.B)).toBe(false); // a rejected suggestion is out in every mode
  });
});

describe('count mode: a person confirmation', () => {
  it('accepting a low-confidence (red) suggestion is a person confirmation: it counts', async () => {
    await insertLabel('E', 'W21x44', 300, 120, true, 'low');
    const before = (await members()).find((m) => m.id === ids.E) as Row;
    expect(before.status.color).toBe('red');
    expect(before.count.state).toBe('suggested');
    const acc = await post(`/members/${ids.E}/count-decision`, { who: WHO, decision: 'accept' });
    expect(acc.json().member.status.color).not.toBe('red');
    expect(acc.json().member.human).toBe('confirmed');
    await post(`/members/${ids.E}/count-decision`, { who: WHO, decision: 'reset' });
    expect(((await members()).find((m) => m.id === ids.E) as Row).status.color).toBe('red');
    await post(`/members/${ids.E}/count-decision`, { who: WHO, decision: 'reject' }); // keep later totals as they were
  });
});

describe('count mode: the action log', () => {
  it('has every create, accept, reject, edit, delete, undo and redo with who and when', async () => {
    const log = (await get('/count-actions')).json();
    const kinds = new Set(log.actions.map((a: { action: string }) => a.action));
    for (const a of ['create', 'accept', 'reject', 'edit', 'delete', 'undo', 'redo', 'mode']) {
      expect(kinds.has(a), a).toBe(true);
    }
    const create = log.actions.find((a: { action: string }) => a.action === 'create');
    expect(create.detail).toMatchObject({ kind: 'Beams', snapped: false });
    expect(create.who).toBe(WHO);
    expect(new Date(create.at).getTime()).toBeGreaterThan(Date.now() - 600_000);
    // in time order
    const times = log.actions.map((a: { at: string }) => new Date(a.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // time per page and person
    const tp = log.time_per_page.find((t: { sheet_id: string }) => t.sheet_id === sheetId);
    expect(tp.who).toBe(WHO);
    expect(tp.actions).toBeGreaterThan(5);
  });

  it('can be filtered by sheet and person', async () => {
    expect((await get(`/count-actions?sheet_id=${sheetId}&who=nobody`)).json().actions).toEqual([]);
    expect(
      (await get(`/count-actions?sheet_id=${sheetId}&who=${WHO}&limit=3`)).json().actions,
    ).toHaveLength(3);
  });
});

describe('measure tool (Part C): two clicks, snapped, with the confirmed scale', () => {
  it('measures with the confirmed scale and snaps each click to an endpoint or an intersection', async () => {
    // the vertical line (x = 400) crosses the beam line (y = 300): an intersection at (400, 300)
    const res = await post('/measure', {
      sheet_id: sheetId,
      a: { x: 104, y: 296 }, // near the end point (100, 300)
      b: { x: 404, y: 303 }, // near the intersection (400, 300)
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.a_snap).toMatchObject({ kind: 'endpoint', x: 100, y: 300 });
    expect(m.b_snap).toMatchObject({ kind: 'intersection', x: 400, y: 300 });
    // 300 pt at 1/8" = 1'-0" (ratio 96): 300/72 in x 96 = 400 in = 33'-4"
    expect(m.length_mm).toBeCloseTo((300 * 25.4 * 96) / 72, 0);
    expect(m.length_ft_in).toBe('33\'-4"');
    expect(m.scale_ratio).toBe(96);
  });

  it('a click with nothing to snap to keeps its own place', async () => {
    const m = (
      await post('/measure', { sheet_id: sheetId, a: { x: 900, y: 700 }, b: { x: 900, y: 772 } })
    ).json();
    expect(m.a_snap).toBeNull();
    expect(m.length_mm).toBeCloseTo((72 * 25.4 * 96) / 72, 0); // 1 inch drawn = 8 ft
    expect(m.length_ft_in).toBe('8\'-0"');
  });

  it('refuses when the page has no confirmed scale', async () => {
    const other = await insertSheet(db, projectId, {
      page_index: 1,
      width_pt: 1200,
      height_pt: 800,
    });
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: other,
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
        scale_ratio: 96,
        scale_source: 'detected_text',
        scale_confirmed: false, // a guessed scale is not used
      })
      .execute();
    const res = await post('/measure', { sheet_id: other, a: { x: 1, y: 1 }, b: { x: 100, y: 1 } });
    expect(res.statusCode).toBe(409);
  });

  it('a metric scale (1:100) converts the same way and is displayed in feet-inches too', async () => {
    const metric = await insertSheet(db, projectId, {
      page_index: 2,
      width_pt: 1200,
      height_pt: 800,
    });
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: metric,
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
        scale_ratio: 100,
        scale_source: 'user_confirmed',
        scale_confirmed: true,
      })
      .execute();
    const m = (
      await post('/measure', { sheet_id: metric, a: { x: 0, y: 0 }, b: { x: 283.4646, y: 0 } })
    ).json();
    // 283.4646 pt = 100 mm drawn; at 1:100 that is 10 000 mm
    expect(m.length_mm).toBeCloseTo(10000, 0);
    expect(m.length_ft_in).toBe('32\'-9 11/16"');
  });

  it('saves a measurement, attaches it to a piece, and the length and the table row fill in', async () => {
    const saved = await post('/measurements', {
      who: WHO,
      sheet_id: sheetId,
      a: { x: 100, y: 300 },
      b: { x: 400, y: 300 },
    });
    expect(saved.statusCode).toBe(201);
    const meas = saved.json();
    const att = await post(`/members/${ids.click1}/attach-measurement`, {
      who: WHO,
      measurement_id: meas.id,
    });
    expect(att.statusCode).toBe(200);
    const m = att.json().member;
    expect(m.length_source).toBe('measured_manual');
    expect(m.length_measurement).toBe(meas.id);
    expect(m.length_mm).toBeCloseTo(meas.length_mm, 1);
    // the table row has Length (ft), Length (in) and Total W (W12X26 is 26 lb/ft in the catalog; if the
    // catalog has no such shape in the test database the Unit W stays empty and so does Total W)
    const rows = (await get('/tables')).json().job.rows as Row[];
    const row = rows.find((r) => r.member_ids.includes(ids.click1)) as Row;
    expect(row.length_ft).toBeCloseTo(meas.length_mm / 304.8, 1);
    expect(row.length_in).toBeCloseTo(meas.length_mm / 25.4, 0);
    if (row.unit_w !== null) {
      expect(row.total_w).toBeCloseTo(row.quantity * row.length_ft * row.unit_w, 0);
    } else expect(row.total_w).toBeNull();
    const log = (await get('/count-actions'))
      .json()
      .actions.map((a: { action: string }) => a.action);
    expect(log).toContain('measure');
    expect(log).toContain('attach_length');
    // undo of the attach removes the measured length again
    await post('/undo', { who: WHO });
    const after = (await members()).find((x) => x.id === ids.click1) as Row;
    expect(after.length_source).not.toBe('measured_manual');
  });

  it('a column takes its length from its elevations: a plan measurement is refused', async () => {
    const meas = (
      await post('/measurements', {
        who: WHO,
        sheet_id: sheetId,
        a: { x: 100, y: 300 },
        b: { x: 200, y: 300 },
      })
    ).json();
    const res = await post(`/members/${ids.col}/attach-measurement`, {
      who: WHO,
      measurement_id: meas.id,
    });
    expect(res.statusCode).toBe(400);
  });

  it('typing a length after a measured one replaces it (the measurement is no longer the evidence)', async () => {
    const meas = (
      await post('/measurements', {
        who: WHO,
        sheet_id: sheetId,
        a: { x: 100, y: 300 },
        b: { x: 250, y: 300 },
      })
    ).json();
    await post(`/members/${ids.click3}/attach-measurement`, { who: WHO, measurement_id: meas.id });
    const typed = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/members/${ids.click3}`,
      payload: { who: WHO, length: '20\'-0"' },
    });
    expect(typed.json().member.length_source).toBe('manual');
    expect(typed.json().member.length_measurement).toBeNull();
  });
});
