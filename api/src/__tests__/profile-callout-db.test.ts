// Phase 0 profile from callout (SYNTHETIC rows, test database; a stand-in worker answers Find
// similar): a match takes the profile of its own label, the profile search, Mark all, and the
// proposals for members that already exist.
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { equivKey, searchKey } from '../review/profile-search.js';
import { deleteProject, insertProject, insertSheet, setFirstView } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'tester';
const RATIO = 96;

describe('profile search keys', () => {
  it('spellings, a fraction and its decimal are one profile', () => {
    expect(searchKey('w12x26')!.key).toBe(searchKey('W 12 x 26')!.key);
    expect(searchKey('HSS12X12X3/8')!.key).toBe(searchKey('HSS 12x12x.375')!.key);
    expect(equivKey('HSS12X12X3/8')).toBe(equivKey('HSS12X12X0.375'));
    expect(equivKey('W12X26')).not.toBe(equivKey('W12X27'));
    expect(searchKey('not a profile')).toBeNull();
  });
});

describe('profile from callout (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let viewId: string;
  let worker: ReturnType<typeof setInterval> | null = null;
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}${url}`, payload });
  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}` });
  const label = async (
    canonical: string,
    x: number,
    y: number,
    o: {
      valid?: boolean;
      flags?: string[];
      leaders?: number[][];
      raw?: string;
      family?: string;
    } = {},
  ) =>
    (
      await db
        .insertInto('page_labels')
        .values({
          sheet_id: sheetId,
          view_id: viewId,
          text: o.raw ?? canonical,
          raw: o.raw ?? canonical,
          canonical,
          family: o.family ?? canonical.replace(/[0-9X/.].*$/, ''),
          kind: 'profile',
          valid: o.valid ?? true,
          flags: o.flags ?? [],
          x0: x - 10,
          y0: y - 4,
          x1: x + 10,
          y1: y + 4,
          leaders: JSON.stringify(o.leaders ?? []),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const member = async (id: string) =>
    db.selectFrom('members').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const undone = async (xs: number[]) =>
    (
      await db
        .selectFrom('member_edits as e')
        .innerJoin('members as m', 'm.id', 'e.member_id')
        .select('m.id')
        .where('m.sheet_id', '=', sheetId)
        .where('m.page_x0', 'in', xs.map(String))
        .where('e.field_name', '=', 'review_status')
        .where('e.review_status', '=', 'rejected')
        .execute()
    ).length;
  const startWorker = (at: number[][]) => {
    worker = setInterval(() => {
      void (async () => {
        const jobs = await db
          .selectFrom('jobs')
          .select(['id', 'payload'])
          .where('type', '=', 'find_similar')
          .where('status', '=', 'pending')
          .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
          .execute();
        for (const j of jobs) {
          const [x, y] = (j.payload as { click: [number, number] }).click;
          const answer = {
            example: {
              source: 'ink',
              family: 'unknown',
              solid: null,
              box: [x - 4, y - 5, x + 4, y + 5],
              centre: [x, y],
              real_in: [10, 12],
              angle: 0,
              rect: [],
            },
            note: null,
            refused: null,
            snap: null,
            warning: null,
            angles: [0],
            vector: 0,
            image: at.length,
            combined: at.map((c) => ({ centre: c, source: 'image', score: 0.95, rotation: 0 })),
            runtime_s: 0.1,
            settings: { image: true },
          };
          await db
            .updateTable('jobs')
            .set({ status: 'completed', result: JSON.stringify(answer) as never })
            .where('id', '=', j.id)
            .execute();
        }
      })();
    }, 50);
  };

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 1000, height_pt: 800 });
    viewId = await setFirstView(db, sheetId, {
      role_name: 'Foundation / column plan',
      box: JSON.stringify({ x0: 0, y0: 0, x1: 1000, y1: 800 }),
      scale_ratio: RATIO,
    });
    await db
      .updateTable('sheets')
      .set({ build_role: 'column_plan', build_scale_ratio: String(RATIO) } as never)
      .where('id', '=', sheetId)
      .execute();
    await db
      .insertInto('build_runs')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        requested_by: WHO,
        mode: 'person',
        status: 'done',
        finished_at: new Date(),
      })
      .execute();
  });

  afterEach(() => {
    if (worker) clearInterval(worker);
    worker = null;
  });

  afterAll(async () => {
    await db
      .deleteFrom('jobs')
      .where(sql<boolean>`payload->>'sheet_id' = ${sheetId}`)
      .execute();
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('migration 038: the new logged actions and the profile columns exist', async () => {
    const r = await sql<{ n: string }>`select count(*)::text as n from information_schema.columns
      where table_name = 'members' and column_name in ('profile_source', 'profile_label_id', 'profile_link')`.execute(
      db,
    );
    expect(r.rows[0]!.n).toBe('3');
    await expect(
      db
        .insertInto('count_actions')
        .values({ project_id: projectId, action: 'profile_mark', who: WHO } as never)
        .execute(),
    ).resolves.toBeDefined();
  });

  it("a placed column: the palette's profile is a default its own label replaces; only a profile typed on the member is the person's and stays", async () => {
    const own = await label('W12X65', 150, 400);
    const draw = async (payload: object) =>
      (
        await post(`/sheets/${sheetId}/line-first/pieces`, {
          who: WHO,
          kind: 'Column',
          symbol: 'w_shape',
          ...payload,
        })
      ).json() as { id: string };
    const a = await draw({ a: [150, 410] });
    expect(await member(a.id)).toMatchObject({
      profile: 'W12X65',
      profile_source: 'label',
      profile_label_id: own,
    });
    // the palette's W14x90 is a default (example): the label next to the column replaces it
    const palette = await draw({ a: [150, 410], profile_text: 'W14x90' });
    expect(await member(palette.id)).toMatchObject({
      profile: 'W12X65',
      profile_source: 'label',
    });
    expect((await member(palette.id)).profile_link).toMatchObject({
      note: 'label W12X65, example W14X90',
    });
    // no label near: the palette's profile stays, as an example (amber)
    const far = await draw({ a: [900, 700], profile_text: 'W14x90' });
    expect(await member(far.id)).toMatchObject({ profile: 'W14X90', profile_source: 'example' });
    const none = await draw({ a: [900, 650] }); // no profile at all, no label
    expect(await member(none.id)).toMatchObject({ profile: null, profile_source: null });
    // typed on the member (the member panel): the person's, and a proposal never replaces it
    await post('/line-first/pieces/edit', {
      who: WHO,
      member_ids: [palette.id],
      profile_text: 'W16X40',
    });
    const shown = (await get(`/sheets/${sheetId}/line-first`)).json() as {
      pieces: { id: string; profile: string; profile_source: string }[];
    };
    expect(shown.pieces.find((p) => p.id === palette.id)).toMatchObject({
      profile: 'W16X40',
      profile_source: 'person',
    });
    expect(
      (await get(`/sheets/${sheetId}/profile-proposals`))
        .json()
        .proposals.map((p: { member_id: string }) => p.member_id),
    ).not.toContain(palette.id);
    await db.deleteFrom('page_labels').where('id', '=', own).execute();
  });

  it("Find similar: each match takes its OWN label, never just the example's profile", async () => {
    const own = await label('W12X65', 220, 100); // 20 pt from the first match only
    const bad = await label('W12X999', 320, 100, { valid: false }); // not in the catalog
    startWorker([
      [200, 100],
      [300, 100],
      [700, 100],
    ]);
    const ex = (
      await post(`/sheets/${sheetId}/line-first/pieces`, {
        who: WHO,
        kind: 'Column',
        symbol: 'w_shape',
        a: [100, 100],
        profile_text: 'W12x53',
      })
    ).json() as { id: string };
    const pv = (
      await post(`/line-first/pieces/${ex.id}/find-similar`, {
        who: WHO,
        snap: false,
        box: [96, 95, 104, 105],
      })
    ).json();
    const acc = await post(`/line-first/pieces/${ex.id}/find-similar`, {
      who: WHO,
      accept: true,
      run_id: pv.run_id,
      snap: false,
      box: [96, 95, 104, 105],
    });
    expect(acc.statusCode).toBe(200);
    const rows = await db
      .selectFrom('members')
      .selectAll()
      .where('sheet_id', '=', sheetId)
      .where('page_y0', '=', '100')
      .orderBy('page_x0')
      .execute();
    const byX = Object.fromEntries(rows.map((r) => [Number(r.page_x0), r]));
    expect(byX[100]).toMatchObject({ profile: 'W12X53', profile_source: 'example' }); // palette default, no label
    // 200: its own label wins over the example, and says so
    expect(byX[200]).toMatchObject({ profile: 'W12X65', profile_source: 'label' });
    expect(byX[200]!.profile_link).toMatchObject({
      method: 'beside',
      note: 'label W12X65, example W12X53',
    });
    // 300: the label next to it is not in the catalog: not used silently, the example stays (amber)
    expect(byX[300]).toMatchObject({ profile: 'W12X53', profile_source: 'example' });
    expect(byX[300]!.profile_link).toMatchObject({
      note: expect.stringContaining('not in the AISC catalog'),
    });
    // 700: no label at all: today's behaviour, the example's profile (amber)
    expect(byX[700]).toMatchObject({ profile: 'W12X53', profile_source: 'example' });
    const logged = await db
      .selectFrom('count_actions')
      .select('detail')
      .where('project_id', '=', projectId)
      .where('action', '=', 'find_similar')
      .executeTakeFirstOrThrow();
    expect(logged.detail).toMatchObject({ profile_sources: { label: 1, example: 2 } });
    // one Undo takes all three matches back
    const un = await post('/undo', { who: WHO });
    expect(un.json().rows).toBe(3);
    expect(await undone([200, 300, 700])).toBe(3); // an undone creation is a 'rejected' edit
    await db.deleteFrom('page_labels').where('id', 'in', [own, bad]).execute();
    await db.deleteFrom('members').where('sheet_id', '=', sheetId).execute();
  });

  it('the profile search: normalised text, counts per sheet and project, a fraction equals its decimal', async () => {
    const other = await insertSheet(db, projectId, {
      page_index: 1,
      width_pt: 1000,
      height_pt: 800,
    });
    const otherView = await db
      .selectFrom('build_views')
      .select('id')
      .where('sheet_id', '=', other)
      .executeTakeFirstOrThrow();
    const ids = [
      await label('W12X26', 100, 100),
      await label('W12X26', 100, 200),
      await label('HSS12X12X3/8', 100, 300, { raw: 'HSS12x12x.375' }),
    ];
    await db
      .insertInto('page_labels')
      .values({
        sheet_id: other,
        view_id: otherView.id,
        text: 'W 12 x 26',
        raw: 'W 12 x 26',
        canonical: 'W12X26',
        family: 'W',
        kind: 'profile',
        valid: true,
        flags: [],
        x0: 1,
        y0: 1,
        x1: 9,
        y1: 9,
        leaders: '[]',
      } as never)
      .execute();
    const res = (
      await get(`/profile-search?q=${encodeURIComponent('w12 x 26')}&sheet_id=${sheetId}`)
    ).json();
    expect(res).toMatchObject({ canonical: 'W12X26', total: 3 });
    expect(res.per_sheet.map((s: { count: number }) => s.count).sort()).toEqual([1, 2]);
    expect(res.occurrences).toHaveLength(2);
    expect(res.ms).toBeLessThan(500);
    const hss = (await get(`/profile-search?q=${encodeURIComponent('HSS12X12X0.375')}`)).json();
    expect(hss.total).toBe(1);
    expect((await get('/profile-search?q=hello')).statusCode).toBe(400);
    const counts = (await get(`/profile-counts?sheet_id=${sheetId}`)).json();
    expect(counts.profiles.find((p: { profile: string }) => p.profile === 'W12X26')).toMatchObject({
      project: 3,
      sheet: 2,
    });
    await db.deleteFrom('page_labels').where('id', 'in', ids).execute();
    await db.deleteFrom('sheets').where('id', '=', other).execute();
  });

  it('proposals for existing members: a preview, one applied action, one Undo; typed profiles are left alone', async () => {
    const lb = await label('W12X65', 520, 100, { flags: ['existing'] });
    const mk = async (x: number, profile: string, source: string | null) =>
      (
        await db
          .insertInto('members')
          .values({
            project_id: projectId,
            sheet_id: sheetId,
            member_id: `LF-T-${x}`,
            origin: 'extracted',
            type: 'column',
            kind: 'Column',
            profile,
            profile_source: source,
            page_x0: x,
            page_y0: 100,
            size_state: 'sized',
            build_state: 'found',
            build_run_id: (
              await db
                .selectFrom('build_runs')
                .select('id')
                .where('sheet_id', '=', sheetId)
                .executeTakeFirstOrThrow()
            ).id,
          } as never)
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const wrong = await mk(500, 'W12X53', 'example');
    const typed = await mk(540, 'W12X53', 'person');
    const preview = (await get(`/sheets/${sheetId}/profile-proposals`)).json();
    expect(preview.proposals).toHaveLength(1); // 540 is nearer the label, but a person typed it
    expect(preview.proposals[0]).toMatchObject({
      member_id: wrong,
      current: 'W12X53',
      proposed: 'W12X65',
      set_existing: true,
    });
    const applied = (await post(`/sheets/${sheetId}/profile-proposals/apply`, { who: WHO })).json();
    expect(applied.applied).toBe(1);
    expect((await get(`/sheets/${sheetId}/profile-proposals`)).json().proposals).toHaveLength(0);
    const eff = (await get(`/line-first/pieces/${wrong}`)).json?.() ?? null;
    void eff;
    const undo = await post('/undo', { who: WHO });
    expect(undo.statusCode).toBe(200);
    expect((await get(`/sheets/${sheetId}/profile-proposals`)).json().proposals).toHaveLength(1);
    expect(await member(typed)).toMatchObject({ profile: 'W12X53', profile_source: 'person' });
    await db.deleteFrom('members').where('id', 'in', [wrong, typed]).execute();
    await db.deleteFrom('page_labels').where('id', '=', lb).execute();
  });

  it('Mark all: a preview first (nothing counted), accept sets linked members and creates proposed ones, untick and Undo work', async () => {
    const run = await db
      .selectFrom('build_runs')
      .select('id')
      .where('sheet_id', '=', sheetId)
      .executeTakeFirstOrThrow();
    const linked = await label('W10X33', 620, 300);
    const lone = await label('W10X33', 800, 600, { leaders: [[790, 640]] });
    const m = (
      await db
        .insertInto('members')
        .values({
          project_id: projectId,
          sheet_id: sheetId,
          member_id: 'LF-T-mark',
          origin: 'extracted',
          type: 'column',
          kind: 'Column',
          profile: 'W12X53',
          profile_source: 'example',
          page_x0: 640,
          page_y0: 300,
          size_state: 'sized',
          build_state: 'found',
          build_run_id: run.id,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const before = (
      await db.selectFrom('members').select('id').where('sheet_id', '=', sheetId).execute()
    ).length;
    const pv = (
      await post(`/sheets/${sheetId}/profile-search/mark`, { q: 'W10X33', who: WHO })
    ).json();
    expect(pv).toMatchObject({ occurrences: 2, accepted: false, created: 0 });
    expect(pv.proposals.map((p: { kind: string }) => p.kind).sort()).toEqual(['new', 'set']);
    const nw = pv.proposals.find((p: { kind: string }) => p.kind === 'new');
    expect(nw).toMatchObject({ at: [790, 640], position: 'leader end', can_create: true });
    expect(
      (await db.selectFrom('members').select('id').where('sheet_id', '=', sheetId).execute())
        .length,
    ).toBe(before);
    // untick the new one: only the linked member is set
    const one = (
      await post(`/sheets/${sheetId}/profile-search/mark`, {
        q: 'W10X33',
        who: WHO,
        accept: true,
        unticked: [lone],
      })
    ).json();
    expect(one).toMatchObject({ accepted: true, created: 0, updated: 1 });
    await post('/undo', { who: WHO });
    const all = (
      await post(`/sheets/${sheetId}/profile-search/mark`, { q: 'W10X33', who: WHO, accept: true })
    ).json();
    expect(all).toMatchObject({ created: 1, updated: 1 });
    const made = await db
      .selectFrom('members')
      .selectAll()
      .where('sheet_id', '=', sheetId)
      .where('page_x0', '=', '790')
      .executeTakeFirstOrThrow();
    expect(made).toMatchObject({ profile: 'W10X33', profile_source: 'label', type: 'column' });
    await post('/undo', { who: WHO });
    expect(await undone([790])).toBe(1);
    await db.deleteFrom('members').where('id', '=', m).execute();
    await db.deleteFrom('page_labels').where('id', 'in', [linked, lone]).execute();
  });

  it('queues one read of the labels, and a second request does not queue another', async () => {
    const a = await post(`/sheets/${sheetId}/profile-labels/read`, { who: WHO });
    const b = await post(`/sheets/${sheetId}/profile-labels/read`, { who: WHO });
    expect([a.json().queued, b.json().queued]).toEqual([true, false]);
  });

  it('search response time: 5,000 synthetic labels over 50 sheets', async () => {
    const sheets: string[] = [];
    for (let k = 0; k < 50; k++)
      sheets.push(
        await insertSheet(db, projectId, { page_index: 10 + k, width_pt: 1000, height_pt: 800 }),
      );
    const views = await db
      .selectFrom('build_views')
      .select(['id', 'sheet_id'])
      .where('sheet_id', 'in', sheets)
      .execute();
    const view = new Map(views.map((v) => [v.sheet_id, v.id]));
    const sizes = ['W12X26', 'W12X65', 'W14X90', 'HSS8X8X1/2', 'W10X33', 'L3X3X1/4'];
    const rows = [];
    for (let n = 0; n < 5000; n++) {
      const sid = sheets[n % 50]!;
      const profile = sizes[n % sizes.length]!;
      rows.push({
        sheet_id: sid,
        view_id: view.get(sid)!,
        text: profile,
        raw: profile,
        canonical: profile,
        family: profile.replace(/[0-9X/.].*$/, ''),
        kind: 'profile',
        valid: true,
        flags: [],
        x0: n % 900,
        y0: Math.floor(n / 900) * 9,
        x1: (n % 900) + 20,
        y1: Math.floor(n / 900) * 9 + 8,
        leaders: '[]',
      });
    }
    for (let i = 0; i < rows.length; i += 500)
      await db
        .insertInto('page_labels')
        .values(rows.slice(i, i + 500) as never)
        .execute();
    const times: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      const res = await get(`/profile-search?q=W12X26&sheet_id=${sheets[0]}`);
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBeGreaterThan(800);
    }
    times.sort((a, b) => a - b);
    console.log(
      `PROFILE_SEARCH_MS median ${times[2]!.toFixed(0)} max ${times[4]!.toFixed(0)} over 5000 labels`,
    );
    expect(times[4]!).toBeLessThan(500);
    await db.deleteFrom('sheets').where('id', 'in', sheets).execute();
  });
});
