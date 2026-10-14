// Phase 10 Part E: the pilot timing report on SYNTHETIC action logs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { pilotReport, reportCsv, type ActionRow, type PieceInfo } from '../review/pilot-report.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const T0 = Date.parse('2026-01-05T09:00:00Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const act = (
  seconds: number,
  who: string,
  sheet: string | null,
  action: string,
  member: string | null = null,
): ActionRow => ({ created_at: at(seconds), who, sheet_id: sheet, action, member_id: member });
const piece = (id: string, over: Partial<PieceInfo> = {}): PieceInfo => ({
  id,
  live: true,
  confirmed: true,
  typical: false,
  has_length: false,
  ...over,
});

describe('pilotReport (pure)', () => {
  it('active time sums the gaps of 5 minutes or less; longer gaps are reported apart', () => {
    const rows = pilotReport(
      [
        act(0, 'ann', 'S1', 'create', 'm1'),
        act(30, 'ann', 'S1', 'create', 'm2'),
        act(90, 'ann', 'S1', 'accept', 'm3'),
        act(90 + 301, 'ann', 'S1', 'reject', 'm4'), // 301 s: idle, not active
        act(90 + 301 + 300, 'ann', 'S1', 'edit', 'm1'), // exactly 300 s: active
      ],
      [piece('m1'), piece('m2', { typical: true }), piece('m3', { has_length: true })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sheet_id: 'S1',
      who: 'ann',
      actions: 5,
      active_seconds: 30 + 60 + 300,
      idle_gaps: 1,
      idle_seconds: 301,
      created: 2,
      accepted: 1,
      rejected: 1,
      edited: 1,
      pieces: 3,
      typical_pieces: 1,
      pieces_without_length: 2,
    });
  });

  it('a gap is given to the sheet of the later action, so time is never counted twice', () => {
    const rows = pilotReport(
      [
        act(0, 'ann', 'S1', 'create', 'a'),
        act(40, 'ann', 'S2', 'create', 'b'),
        act(100, 'ann', 'S1', 'create', 'c'),
      ],
      [],
    );
    const s1 = rows.find((r) => r.sheet_id === 'S1');
    const s2 = rows.find((r) => r.sheet_id === 'S2');
    expect(s1?.active_seconds).toBe(60);
    expect(s2?.active_seconds).toBe(40);
  });

  it('people are timed apart; undo, redo, delete, measure and typical are counted', () => {
    const rows = pilotReport(
      [
        act(0, 'ann', 'S1', 'create', 'a'),
        act(10, 'bob', 'S1', 'create', 'b'),
        act(20, 'ann', 'S1', 'undo'),
        act(25, 'ann', 'S1', 'redo'),
        act(30, 'bob', 'S1', 'delete', 'b'),
        act(40, 'bob', 'S1', 'measure'),
        act(50, 'bob', 'S1', 'typical', 'b'),
        act(60, 'ann', null, 'mode'),
      ],
      [piece('a'), piece('b', { live: false })],
    );
    const ann = rows.find((r) => r.who === 'ann' && r.sheet_id === 'S1');
    const bob = rows.find((r) => r.who === 'bob');
    expect(ann).toMatchObject({ active_seconds: 25, undo: 1, redo: 1, pieces: 1 });
    expect(bob).toMatchObject({
      active_seconds: 40,
      deleted: 1,
      measured: 1,
      typical_changes: 1,
      pieces: 0, // its piece was deleted
    });
    expect(rows.find((r) => r.sheet_id === null)?.actions).toBe(1);
  });

  it('a suggestion that is no longer confirmed does not count as a piece', () => {
    const rows = pilotReport(
      [act(0, 'ann', 'S1', 'accept', 'x')],
      [piece('x', { confirmed: false })],
    );
    expect(rows[0]?.pieces).toBe(0);
  });

  it('the CSV has one line per sheet and person, minutes rounded, text quoted', () => {
    const rows = pilotReport(
      [act(0, 'o"neil, a', 'S1', 'create', 'a'), act(90, 'o"neil, a', 'S1', 'create', 'b')],
      [piece('a'), piece('b')],
    );
    const csv = reportCsv(rows, () => ({ page: 3, sheet_number: 'S-3' }));
    const lines = csv.trim().split('\n');
    expect(lines[0]?.startsWith('page,sheet_number,who,first,last,actions,active_minutes')).toBe(
      true,
    );
    expect(lines[1]).toContain('3,S-3,"o""neil, a"');
    expect(lines[1]).toContain(',2,1.5,0,0,2,'); // 2 actions, 1.5 active minutes, 0 gaps, 2 created
  });

  it('an empty log gives an empty report', () => {
    expect(pilotReport([], [])).toEqual([]);
  });
});

describe('the report routes', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;
  let sheetId: string;

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, {
      page_index: 2,
      sheet_number: 'S-3',
      page_type_guess: 'framing_plan',
      decided: 'include',
      width_pt: 1200,
      height_pt: 800,
    });
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/count`,
      payload: { who: 'ann', count_mode: true },
    });
    for (const x of [100, 200]) {
      await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/count/click`,
        payload: { who: 'ann', sheet_id: sheetId, kind: 'Beams', x, y: 100 },
      });
    }
  });

  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('JSON: per sheet and person with the page number; the mode change is its own row', async () => {
    const r = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/pilot-report` })
    ).json();
    expect(r.idle_seconds).toBe(300);
    const row = r.rows.find((x: { sheet_id: string | null }) => x.sheet_id === sheetId);
    expect(row).toMatchObject({
      who: 'ann',
      page_number: 3,
      sheet_number: 'S-3',
      created: 2,
      pieces: 2,
      pieces_without_length: 2,
      typical_pieces: 0,
    });
    expect(r.rows.some((x: { sheet_id: string | null }) => x.sheet_id === null)).toBe(true);
  });

  it('CSV export', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/pilot-report.csv`,
    });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\n')[0]).toContain('pieces_without_length');
    expect(res.body).toContain('3,S-3,ann');
  });
});
