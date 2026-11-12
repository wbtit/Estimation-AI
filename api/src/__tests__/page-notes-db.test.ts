// Page notes (migration 040): one note per page, a version, and a warning when it changed under you
// (SYNTHETIC rows, test database).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();

describe('page notes (test database)', () => {
  let projectId: string;
  let sheetId: string;
  let otherSheet: string;
  const url = (s = sheetId) => `/api/projects/${projectId}/sheets/${s}/notes`;
  const get = async (s = sheetId) => (await app.inject({ method: 'GET', url: url(s) })).json();
  const put = (payload: object, s = sheetId) => app.inject({ method: 'PUT', url: url(s), payload });

  beforeAll(async () => {
    projectId = await insertProject(db);
    sheetId = await insertSheet(db, projectId, { page_index: 0, width_pt: 792, height_pt: 612 });
    otherSheet = await insertSheet(db, projectId, { page_index: 1, width_pt: 792, height_pt: 612 });
  });
  afterAll(async () => {
    await deleteProject(db, projectId);
    await app.close();
    await closeDatabaseConnection();
  });

  it('a page with no note answers version 0 and empty', async () => {
    expect(await get()).toEqual({ note: '', version: 0, updated_by: null, updated_at: null });
  });

  it('saves, with who and when, and counts the version up', async () => {
    const a = await put({ who: 'ann', note: 'check the roof opening', base_version: 0 });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({
      note: 'check the roof opening',
      version: 1,
      updated_by: 'ann',
    });
    expect(a.json().updated_at).toBeTruthy();
    const b = await put({ who: 'ann', note: 'check the roof opening, 2nd bay', base_version: 1 });
    expect(b.json()).toMatchObject({ version: 2 });
    expect((await get()).note).toBe('check the roof opening, 2nd bay');
  });

  it('a save over a note that changed since you opened it is refused with the current note', async () => {
    // bob opened version 2; ann saves version 3; bob's autosave carries base_version 2
    await put({ who: 'ann', note: "ann's newer words", base_version: 2 });
    const stale = await put({ who: 'bob', note: "bob's words", base_version: 2 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: 'changed',
      current: { note: "ann's newer words", version: 3, updated_by: 'ann' },
    });
    expect((await get()).note).toBe("ann's newer words"); // nothing was overwritten
  });

  it('keep mine (force) saves over it: last save wins', async () => {
    const mine = await put({ who: 'bob', note: "bob's words", base_version: 2, force: true });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ note: "bob's words", version: 4, updated_by: 'bob' });
  });

  it('notes are per page, and an empty note is kept as empty (no icon)', async () => {
    expect((await get(otherSheet)).version).toBe(0);
    await put({ who: 'ann', note: '', base_version: 4 });
    const pages = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/pages` })
    ).json().pages as { id: string; has_notes: boolean }[];
    expect(pages.find((p) => p.id === sheetId)!.has_notes).toBe(false);
    await put({ who: 'ann', note: 'again', base_version: 5 });
    const again = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/pages` })
    ).json().pages as { id: string; has_notes: boolean }[];
    expect(again.find((p) => p.id === sheetId)!.has_notes).toBe(true);
    expect(again.find((p) => p.id === otherSheet)!.has_notes).toBe(false);
  });

  it('needs who and a page of this project; two first saves at once do not both win', async () => {
    expect((await put({ note: 'x', base_version: 0 })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${projectId}/sheets/00000000-0000-4000-8000-000000000000/notes`,
        })
      ).statusCode,
    ).toBe(404);
    const fresh = otherSheet;
    const [x, y] = await Promise.all([
      put({ who: 'ann', note: 'first', base_version: 0 }, fresh),
      put({ who: 'bob', note: 'second', base_version: 0 }, fresh),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
  });
});
