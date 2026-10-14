// Phase 10 Part D: the estimators' mark prefix -> kind, per project (owner decision 124).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { loadKinds } from '../review/kinds.js';
import {
  importChanges,
  kindForMark,
  parsePrefixCsv,
  prefixForKind,
  type PrefixKind,
} from '../review/prefix-kinds.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'alice';
let projectId: string;
let sheetId: string;

const url = (p: string) => `/api/projects/${projectId}${p}`;
const put = (prefix: string, kind: string | null) =>
  app.inject({ method: 'PUT', url: url('/prefix-kinds'), payload: { who: WHO, prefix, kind } });
const row = (prefix: string, kind: string): PrefixKind => ({
  prefix,
  kind,
  set_by: 'x',
  set_at: '',
});

beforeAll(async () => {
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, {
    page_index: 0,
    page_type_guess: 'framing_plan',
    decided: 'include',
    width_pt: 1200,
    height_pt: 800,
  });
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

describe('pure helpers', () => {
  it('the tag prefix of a kind: the shortest mapped prefix, then alphabetical; none: null', () => {
    const map = [row('BM', 'Beams'), row('B', 'Beams'), row('C', 'Column')];
    expect(prefixForKind(map, 'Beams')).toBe('B');
    expect(prefixForKind(map, 'Column')).toBe('C');
    expect(prefixForKind(map, 'Truss')).toBeNull();
  });

  it('the kind of a mark from its letters; an unmapped prefix or an odd mark gives null', () => {
    const map = [row('B', 'Beams'), row('HR', 'Hangers')];
    expect(kindForMark(map, 'B12')).toBe('Beams');
    expect(kindForMark(map, 'hr-3')).toBe('Hangers');
    expect(kindForMark(map, 'Q4')).toBeNull();
    expect(kindForMark(map, 'TYP')).toBeNull();
  });

  it('the owner file: header required, each row checked, nothing guessed', async () => {
    const kinds = await loadKinds(db);
    const rows = parsePrefixCsv(
      'prefix,kind\nb,Beams\nC,Column\nC,Beams\nX1,Beams\nZ,Not a kind\n',
      kinds,
    );
    expect(rows.map((r) => [r.prefix, r.problem])).toEqual([
      ['B', null],
      ['C', null],
      ['C', 'prefix given twice'],
      ['X1', 'prefix must be 1 to 6 letters'],
      ['Z', 'kind is not on the scope-of-work list'],
    ]);
    expect(() => parsePrefixCsv('a,b\nB,Beams', kinds)).toThrow(/prefix and kind/);
    expect(importChanges(rows, [row('B', 'Beams')])).toEqual([
      { prefix: 'C', before: null, after: 'Column' },
    ]);
  });
});

describe('the project setting', () => {
  it('starts empty; set, change and remove are logged; bad input is refused', async () => {
    expect((await app.inject({ method: 'GET', url: url('/prefix-kinds') })).json().rows).toEqual(
      [],
    );
    expect((await put('b', 'Beams')).json().rows).toMatchObject([{ prefix: 'B', kind: 'Beams' }]);
    expect((await put('B', 'Column')).json().rows).toMatchObject([{ prefix: 'B', kind: 'Column' }]);
    expect((await put('B', null)).json().rows).toEqual([]);
    expect((await put('B1', 'Beams')).statusCode).toBe(400);
    expect((await put('B', 'Not a kind')).statusCode).toBe(400);
    expect((await put('CO', 'Beams')).statusCode).toBe(400); // the list's own tag prefix of Column
    const log = (await app.inject({ method: 'GET', url: url('/count-actions') })).json();
    const maps = log.actions.filter((a: { action: string }) => a.action === 'prefix_map');
    expect(
      maps.map((a: { detail: { before: string | null; after: string | null } }) => [
        a.detail.before,
        a.detail.after,
      ]),
    ).toEqual([
      [null, 'Beams'],
      ['Beams', 'Column'],
      ['Column', null],
    ]);
  });

  it('the owner file: a preview writes nothing; a file with problems is refused; then applied', async () => {
    const csv = 'prefix,kind\nB,Beams\nC,Column\n';
    const preview = await app.inject({
      method: 'POST',
      url: url('/prefix-kinds/import'),
      payload: { who: WHO, csv },
    });
    expect(preview.json()).toMatchObject({ applied: false, rows: 2, problems: [] });
    expect(preview.json().changes).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: url('/prefix-kinds') })).json().rows).toEqual(
      [],
    );
    const bad = await app.inject({
      method: 'POST',
      url: url('/prefix-kinds/import'),
      payload: { who: WHO, csv: 'prefix,kind\nB,Beams\nQ,Nope\n', apply: true },
    });
    expect(bad.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: url('/prefix-kinds') })).json().rows).toEqual(
      [],
    );
    const ok = await app.inject({
      method: 'POST',
      url: url('/prefix-kinds/import'),
      payload: { who: WHO, csv, apply: true },
    });
    expect(ok.json().applied).toBe(true);
    expect(ok.json().current.map((r: PrefixKind) => r.prefix)).toEqual(['B', 'C']);
  });

  it('in count mode a new piece of a mapped kind takes the estimators prefix, not provisional', async () => {
    await app.inject({
      method: 'PUT',
      url: url('/count'),
      payload: { who: WHO, count_mode: true },
    });
    const beam = await app.inject({
      method: 'POST',
      url: url('/count/click'),
      payload: { who: WHO, sheet_id: sheetId, kind: 'Beams', x: 100, y: 100 },
    });
    expect(beam.json().member.tag).toMatchObject({
      prefix: 'B',
      number: 1,
      text: 'B1',
      provisional: false,
    });
    const truss = await app.inject({
      method: 'POST',
      url: url('/count/click'),
      payload: { who: WHO, sheet_id: sheetId, kind: 'Truss', x: 200, y: 200 },
    });
    // an unmapped kind keeps the kind list's own (provisional) prefix
    expect(truss.json().member.tag.prefix).not.toBe('B');
    expect(truss.json().member.tag.provisional).toBe(true);
  });
});
