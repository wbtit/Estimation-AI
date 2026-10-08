import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { familyOf } from '../review/grades.js';
import { deleteProject, insertProject, insertSheet, loadWorkbook } from './helpers.js';

describe('grade rules are never filled in by the system', () => {
  it('the migration creates the table and inserts nothing', () => {
    const sql = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../db/migrations/008_grade_rules.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/CREATE TABLE project_grade_rules/);
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/\bINSERT\b/i);
  });

  it('families come from the parsed profile; joists are their own family', () => {
    expect(familyOf({ type: 'beam', profile: 'W12X26' })).toBe('W');
    expect(familyOf({ type: 'beam', profile: 'HSS6X4X1/4' })).toBe('HSS');
    expect(familyOf({ type: 'beam', profile: 'PL1/2X8' })).toBe('PL');
    expect(familyOf({ type: 'joist', profile: null })).toBe('joist');
    expect(familyOf({ type: 'beam', profile: null })).toBeNull();
  });
});

describe('grade routes and the takeoff', () => {
  const app = buildApp();
  const db = getDb();
  let projectId: string;

  const add = async (viewId: string, y: number, text: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/members`,
      payload: {
        view_id: viewId,
        type: 'beam',
        profile_text: text,
        point: { x: 300, y },
        line: { p: [200, y], q: [600, y] },
        who: 'alice',
      },
    });
    expect(res.statusCode).toBe(201);
  };
  const takeoff = async () =>
    (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })).json();
  const put = (family: string, grade: string | null) =>
    app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/grades/${family}`,
      payload: { grade, who: 'alice' },
    });

  beforeAll(async () => {
    projectId = await insertProject(db);
    const sheetId = await insertSheet(db, projectId, {
      page_index: 0,
      page_type_guess: 'framing_plan',
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
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await add(view.id, 300, 'W12x26');
    await add(view.id, 400, 'HSS6x4x1/4');
    await add(view.id, 500, '24K7');
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await closeDatabaseConnection();
  });

  it('a new project has no rules and every row says "not set"', async () => {
    const g = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/grades` })
    ).json();
    expect(g.rules).toEqual([]);
    expect(g.families).toContain('joist');
    const t = await takeoff();
    expect(t.grades).toEqual([]);
    expect([...t.rows, ...t.joists.rows].map((r: { grade: string }) => r.grade)).toEqual([
      'not set',
      'not set',
      'not set',
    ]);
  });

  it('a person sets a grade for a family: only that family changes; the latest wins; null clears', async () => {
    expect((await put('W', 'ASTM A992')).statusCode).toBe(200);
    let t = await takeoff();
    const by = (n: string) => t.rows.find((r: { family: string }) => r.family === n);
    expect(by('W').grade).toBe('ASTM A992');
    expect(by('HSS').grade).toBe('not set');
    expect(t.grades).toMatchObject([{ family: 'W', grade: 'ASTM A992', set_by: 'alice' }]);
    await put('W', 'A572-50');
    expect((await takeoff()).rows.find((r: { family: string }) => r.family === 'W').grade).toBe(
      'A572-50',
    );
    await put('joist', 'SJI standard');
    t = await takeoff();
    expect(t.joists.rows[0].grade).toBe('SJI standard');
    await put('W', null);
    t = await takeoff();
    expect(t.rows.find((r: { family: string }) => r.family === 'W').grade).toBe('not set');
  });

  it('the Excel shows the user-set grade or "not set" and no weight or price column', async () => {
    await put('HSS', 'A500 Gr C');
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff.xlsx` });
    const wb = await loadWorkbook(res.rawPayload);
    const ws = wb.getWorksheet('Takeoff')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    const col = header.indexOf('Grade (user-set)') + 1;
    expect(col).toBeGreaterThan(0);
    expect(header.join('|')).not.toMatch(/weight|price|cost/i);
    const grades = new Map<string, unknown>();
    ws.eachRow((r, n) => n > 1 && grades.set(String(r.getCell(3).value), r.getCell(col).value));
    expect(grades.get('HSS6X4X1/4')).toBe('A500 Gr C');
    expect(grades.get('W12X26')).toBe('not set');
    const gw = wb.getWorksheet('Grades')!;
    const rows: unknown[][] = [];
    gw.eachRow((r, n) => n > 1 && rows.push([r.getCell(1).value, r.getCell(2).value]));
    expect(rows).toContainEqual(['HSS', 'A500 Gr C']);
    expect(rows).toContainEqual(['W', 'not set']);
  });

  it('rejects an unknown family and a blank name', async () => {
    expect((await put('ZZ', 'x')).statusCode).toBe(400);
    const blank = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/grades/W`,
      payload: { grade: 'x', who: '   ' },
    });
    expect(blank.statusCode).toBe(400);
  });
});
