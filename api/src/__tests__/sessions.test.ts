// Session preparation (migration 027): work sessions, actor + session on every action row, page
// activity, time per page and its CSV, export logging (SYNTHETIC rows only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { sessionPageTimes, timingCsv, TIMING_COLUMNS } from '../review/session-timing.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';

const T0 = Date.parse('2026-10-29T10:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

describe('time per page in a session (pure)', () => {
  it('counts wall time to the first save and to the last action, idle gaps over 2 min out', () => {
    const out = sessionPageTimes([
      { sheet_id: 'A', at: at(0), kind: 'view' },
      { sheet_id: 'A', at: at(30), kind: 'active' },
      { sheet_id: 'A', at: at(60), kind: 'edit' },
      { sheet_id: 'A', at: at(400), kind: 'active' }, // 340 s idle before it: not counted
      { sheet_id: 'A', at: at(430), kind: 'save' },
      { sheet_id: 'A', at: at(460), kind: 'edit' }, // came back after saving
    ]);
    expect(out).toEqual([
      {
        sheet_id: 'A',
        first_open: at(0),
        first_save: at(430),
        last_action: at(460),
        wall_to_save_s: 430,
        wall_to_last_action_s: 460,
        active_to_save_s: 90,
        active_total_s: 120,
        opens: 1,
        actions: 3,
      },
    ]);
  });

  it('time on another page never counts for this one, and a leave stops the clock', () => {
    const out = sessionPageTimes([
      { sheet_id: 'A', at: at(0), kind: 'view' },
      { sheet_id: 'A', at: at(20), kind: 'leave' },
      { sheet_id: 'B', at: at(60), kind: 'view' },
      { sheet_id: 'B', at: at(90), kind: 'edit' },
      { sheet_id: 'A', at: at(100), kind: 'view' },
      { sheet_id: null, at: at(110), kind: 'export' },
    ]);
    const by = Object.fromEntries(out.map((p) => [p.sheet_id, p]));
    expect(by.A!.active_total_s).toBe(30); // 0-20, then 100-110; 20-60 after the leave is out
    expect(by.B!.active_total_s).toBe(40); // 60-100
    expect(by.A!.opens).toBe(2);
    expect(by.A!.first_save).toBeNull();
    expect(by.A!.wall_to_save_s).toBeNull();
    expect(by.A!.active_to_save_s).toBeNull();
  });

  it('writes one CSV line per page in page order, ids and times only', () => {
    const pages = sessionPageTimes([
      { sheet_id: 'B', at: at(0), kind: 'view' },
      { sheet_id: 'A', at: at(10), kind: 'view' },
    ]).map((p) => ({ ...p, page_index: p.sheet_id === 'A' ? 0 : 4 }));
    const csv = timingCsv({ id: 's1', actor: 'estimator', project_id: 'p1' }, pages);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(TIMING_COLUMNS.join(','));
    expect(lines[1]!.startsWith('s1,estimator,p1,1,A,')).toBe(true);
    expect(lines[2]!.startsWith('s1,estimator,p1,5,B,')).toBe(true);
  });
});

describe('work sessions (database)', () => {
  let projectId: string;
  let sheetId: string;

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0 });
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  const base = () => `/api/projects/${projectId}`;
  const lastLog = () =>
    db
      .selectFrom('count_actions')
      .select(['action', 'actor', 'session_id'])
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();

  it('with no session an action counts as owner', async () => {
    expect((await app.inject(`${base()}/session`)).json()).toEqual({ session: null });
    await post(`${base()}/sheets/${sheetId}/view`, { who: WHO });
    expect(await lastLog()).toEqual({ action: 'view', actor: 'owner', session_id: null });
  });

  it('a session tags every row with its actor and id, and the timing comes out as CSV', async () => {
    const start = await post(`${base()}/session/start`, { actor: 'estimator', who: WHO });
    expect(start.statusCode).toBe(200);
    const s = start.json().session;
    expect(s.actor).toBe('estimator');
    expect(s.short_id).toBe(s.id.slice(0, 8));
    expect((await post(`${base()}/session/start`, { actor: 'owner', who: WHO })).statusCode).toBe(
      409,
    );
    expect(await lastLog()).toEqual({ action: 'session', actor: 'estimator', session_id: s.id });

    await post(`${base()}/sheets/${sheetId}/view`, { who: WHO });
    expect(await lastLog()).toEqual({ action: 'view', actor: 'estimator', session_id: s.id });
    const ping = await post(`${base()}/sheets/${sheetId}/page-event`, { kind: 'active', who: WHO });
    expect(ping.statusCode).toBe(204);
    const ev = await db
      .selectFrom('page_events')
      .select(['actor', 'session_id'])
      .where('sheet_id', '=', sheetId)
      .executeTakeFirstOrThrow();
    expect(ev).toEqual({ actor: 'estimator', session_id: s.id });
    await post(`${base()}/sheets/${sheetId}/save-page`, { who: WHO });

    await app.inject(`${base()}/line-first/bom.xlsx?who=${WHO}`);
    expect(await lastLog()).toEqual({ action: 'export', actor: 'estimator', session_id: s.id });

    const timing = (await app.inject(`/api/sessions/${s.id}/timing`)).json();
    expect(timing.pages).toHaveLength(1);
    expect(timing.pages[0]).toMatchObject({ sheet_id: sheetId, page_index: 0, opens: 1 });
    expect(timing.pages[0].first_save).not.toBeNull();
    const csv = await app.inject(`/api/sessions/${s.id}/timing.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n')[1]).toContain(`${s.id},estimator,${projectId},1,${sheetId},`);

    const end = await post(`${base()}/session/end`, { who: WHO });
    expect(end.json().session.ended_at).not.toBeNull();
    expect((await post(`${base()}/session/end`, { who: WHO })).statusCode).toBe(409);
    await post(`${base()}/sheets/${sheetId}/view`, { who: WHO });
    expect(await lastLog()).toEqual({ action: 'view', actor: 'owner', session_id: null });
    const all = (await app.inject(`${base()}/sessions`)).json().sessions;
    expect(all.map((x: { id: string }) => x.id)).toEqual([s.id]);
  });
});
