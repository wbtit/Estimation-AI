import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { importCatalog } from '../catalog/store.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { MemberView } from '../review/members.js';
import {
  deleteEdition,
  deleteProject,
  insertProject,
  insertSheet,
  uniqueLabel,
} from './helpers.js';

const app = buildApp();
const db = getDb();
let projectId: string;
let sheetId: string;
let viewId: string;
const ids: Record<string, string> = {};
const edition = uniqueLabel('kinds-test');
const prefix: Record<string, string> = {};

async function member(key: string, over: Record<string, unknown>) {
  const row = await db
    .insertInto('members')
    .values({
      project_id: projectId,
      sheet_id: sheetId,
      view_id: viewId,
      member_id: `M-${key}`,
      origin: 'extracted',
      type: 'beam',
      field_sources: '{}',
      field_confidence: '{}',
      link_confidence: 'high',
      profile_raw: 'W12x26',
      profile: 'W12X26',
      link_candidates: JSON.stringify([
        { rank: 1, p: [100, 120], q: [700, 120], score: 6, dist: 6, rel_angle: 0 },
      ]),
      source_bbox: JSON.stringify({ x0: 300, y0: 100, x1: 340, y1: 110 }),
      ...over,
    } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  ids[key] = row.id;
}

const list = async (): Promise<MemberView[]> =>
  (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/members` })).json().members;
const get = async (key: string) => (await list()).find((m) => m.id === ids[key]) as MemberView;
const post = (path: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/projects/${projectId}/members/${path}`, payload });

beforeAll(async () => {
  process.env.CATALOG_EDITION = edition;
  await importCatalog(db, edition, [
    {
      shape_name: 'W12X26',
      family: 'W',
      weight_kg_per_m: 38.7,
      weight_lb_per_ft: 26,
      properties: {},
    },
  ]);
  for (const k of await db.selectFrom('member_kinds').selectAll().execute())
    prefix[k.kind] = k.abbreviation ?? k.provisional_prefix;
  projectId = await insertProject(db);
  sheetId = await insertSheet(db, projectId, {
    page_index: 0,
    width_pt: 1200,
    height_pt: 800,
    page_type_guess: 'framing_plan',
    decided: 'include',
  });
  viewId = (
    await db
      .insertInto('sheet_views')
      .values({
        sheet_id: sheetId,
        box: JSON.stringify({ x0: 0, y0: 0, x1: 1200, y1: 800 }),
        scale_ratio: 96,
        scale_confirmed: true,
        structural_classes: ['1.5-2.5|black|solid'],
        classes_confirmed: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const strong = { where: 'same_line', keyword: 'beam', status: 'set', candidates: [] };
  await member('strong', {
    kind: 'Beams',
    kind_source: 'keyword',
    kind_evidence: JSON.stringify(strong),
    tag_prefix: prefix.Beams,
    tag_number: 1,
    mark: 'B1',
    mark_ref_status: 'linked',
  });
  await member('weak', {
    kind: 'Beams',
    kind_source: 'keyword',
    kind_evidence: JSON.stringify({ ...strong, where: 'near' }),
    tag_prefix: prefix.Beams,
    tag_number: 2,
    mark: 'B1',
    mark_ref_status: 'linked',
  });
  await member('none', {
    kind_evidence: JSON.stringify({ status: 'missing', candidates: [] }),
    tag_number: 1,
  });
  await member('ambiguous', {
    kind_evidence: JSON.stringify({
      status: 'ambiguous',
      keyword: 'brace',
      candidates: ['Vertical Brace', 'Horizontal Brace'],
    }),
    tag_number: 2,
  });
  await member('uncat', { profile_raw: 'W99x99', profile: 'W99X99', tag_number: 3 });
});

afterAll(async () => {
  delete process.env.CATALOG_EDITION;
  await deleteProject(db, projectId);
  await deleteEdition(db, edition);
  await closeDatabaseConnection();
});

describe('kind, tag, symbol and flags of a member', () => {
  it("a kind found in the label's own line: guessed, strong, green, with its tag and group", async () => {
    const m = await get('strong');
    expect(m.kind).toMatchObject({
      name: 'Beams',
      state: 'guessed',
      source: 'keyword',
      scope: 'main',
    });
    expect(m.kind.evidence).toMatchObject({ keyword: 'beam', where: 'same_line' });
    expect(m.symbol_group).toBe('linear');
    expect(m.symbol_color).toBe('green');
    expect(m.tag).toEqual({
      prefix: prefix.Beams,
      number: 1,
      text: `${prefix.Beams}1`,
      provisional: true,
    });
    expect(m.flags.map((f) => f.code)).toEqual(['KIND_GUESSED', 'PREFIX_PROVISIONAL']);
    expect(m.counting).toBe('counted');
  });

  it('a kind from nearby text is amber; no kind is a grey symbol; a bare brace is ambiguous', async () => {
    const weak = await get('weak');
    expect(weak.status).toMatchObject({ color: 'amber' });
    expect(weak.status.reasons).toContain(
      'kind guessed from nearby text, the legend or the sheet title',
    );
    const none = await get('none');
    expect(none.kind).toMatchObject({ name: null, state: 'missing' });
    expect(none.symbol_color).toBe('grey');
    expect(none.tag).toMatchObject({ prefix: null, number: 1, text: '?1', provisional: false });
    expect(none.flags.map((f) => f.code)).toContain('KIND_MISSING');
    const amb = await get('ambiguous');
    expect(amb.kind.state).toBe('ambiguous');
    expect(amb.status.color).toBe('amber');
    expect(amb.flags.find((f) => f.code === 'KIND_AMBIGUOUS')?.text).toContain('Vertical Brace');
  });

  it('SHAPE and Unit W come from the catalog; a profile not in it is flagged and left empty', async () => {
    const ok = await get('strong');
    expect(ok.catalog).toMatchObject({ found: true, shape: 'W', unit_w_lb_ft: 26, via: 'exact' });
    const bad = await get('uncat');
    expect(bad.catalog).toMatchObject({ found: false, unit_w_lb_ft: null, shape: null });
    expect(bad.flags.map((f) => f.code)).toContain('PROFILE_NOT_IN_CATALOG');
  });
});

describe('setting and confirming a kind', () => {
  it('confirming keeps the kind, removes the guess flag, and can be undone', async () => {
    const res = await post(`${ids.strong}/kind`, { who: 'alice', confirm: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().member.kind).toMatchObject({ state: 'confirmed', name: 'Beams' });
    expect(res.json().member.flags.map((f: { code: string }) => f.code)).not.toContain(
      'KIND_GUESSED',
    );
    const undo = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect(undo.statusCode).toBe(200);
    expect((await get('strong')).kind.state).toBe('guessed');
  });

  it('choosing a kind is the confirmation; the tag follows the kind; the choice is validated', async () => {
    const bad = await post(`${ids.none}/kind`, { who: 'alice', kind: 'Not a kind' });
    expect(bad.statusCode).toBe(400);
    const res = await post(`${ids.none}/kind`, { who: 'alice', kind: 'Column' });
    const m = res.json().member as MemberView;
    expect(m.kind).toMatchObject({ name: 'Column', state: 'confirmed', source: 'person' });
    expect(m.type).toBe('column'); // the type follows the kind
    expect(m.symbol_group).toBe('column');
    expect(m.tag).toMatchObject({ prefix: prefix.Column, number: 1 });
    expect(m.symbol_color).toBe('green');
    // the next piece of the same kind gets the next number on the sheet
    const second = await post(`${ids.ambiguous}/kind`, { who: 'alice', kind: 'Column' });
    expect(second.json().member.tag).toMatchObject({ prefix: prefix.Column, number: 2 });
  });

  it('undo restores the system guess, the old tag and the type', async () => {
    const undo = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'alice' },
    });
    expect(undo.statusCode).toBe(200);
    const amb = await get('ambiguous');
    expect(amb.kind.state).toBe('ambiguous');
    expect(amb.tag).toMatchObject({ prefix: null, number: 2 });
    expect(amb.type).toBe('beam');
  });

  it('"apply to all pieces with this tag" shows its count first and is one action', async () => {
    const count = (
      await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/members/${ids.strong}/same-tag`,
      })
    ).json();
    expect(count).toMatchObject({ basis: 'mark', count: 1, member_ids: [ids.weak] });
    const res = await post(`${ids.strong}/kind`, {
      who: 'bob',
      kind: 'Truss',
      all_same_tag: true,
    });
    expect(res.statusCode).toBe(200);
    expect((await get('strong')).kind.name).toBe('Truss');
    expect((await get('weak')).kind).toMatchObject({ name: 'Truss', state: 'confirmed' });
    expect((await get('weak')).tag.prefix).toBe(prefix.Truss);
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/undo`,
      payload: { who: 'bob' },
    });
    expect((await get('strong')).kind.name).toBe('Beams');
    expect((await get('weak')).kind.name).toBe('Beams'); // both pieces come back with one undo
  });

  it('lists the 36 kinds for the dropdown, main first', async () => {
    const res = (await app.inject({ method: 'GET', url: '/api/member-kinds' })).json();
    expect(res.kinds).toHaveLength(36);
    expect(res.kinds[0]).toMatchObject({ kind: 'Column', scope: 'main' });
    expect(res.kinds.at(-1)).toMatchObject({ kind: 'Other trades', scope: 'excluded' });
  });

  it('clearing the kind is a person decision to have none', async () => {
    const res = await post(`${ids.weak}/kind`, { who: 'carol', kind: null });
    expect(res.json().member.kind).toMatchObject({ name: null, state: 'missing', source: null });
  });
});

describe('history and change times', () => {
  it('lists what a person changed, newest first, with who, when and the value before', async () => {
    await post(`${ids.uncat}/kind`, { who: 'dana', kind: 'Beams' });
    await post(`${ids.uncat}/kind`, { who: 'dana', kind: 'Hangers' });
    const h = (
      await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/members/${ids.uncat}/history`,
      })
    ).json().edits as { field: string; before: unknown; after: unknown; who: string; at: string }[];
    const kinds = h.filter((e) => e.field === 'kind');
    expect(kinds.map((e) => [e.who, e.before, e.after])).toEqual([
      ['dana', 'Beams', 'Hangers'],
      ['dana', { reset: true }, 'Beams'],
    ]);
    expect(Date.parse(kinds[0]?.at ?? '')).toBeGreaterThan(0);
  });

  it('a member changed by a person has a later change time than an untouched one', async () => {
    const touched = await get('uncat');
    const untouched = await get('strong');
    expect(touched.changed_at > untouched.changed_at).toBe(true);
  });

  it('the flags endpoint reports the last pipeline run (none yet in this project)', async () => {
    const f = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/flags` })).json();
    expect(f.last_run ?? null).toBeNull();
    expect(f.draft.label).toMatch(/^draft|reviewed$/);
  });
});
