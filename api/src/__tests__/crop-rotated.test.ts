// fix/crop-anywhere: the stored width_pt / height_pt are the DISPLAYED page size (the scan stores
// PyMuPDF's page.rect, rotation applied), so a crop on a rotated page is checked against that size
// and never against a swapped one. Before the fix a rotated 3024 x 2160 page refused any crop
// reaching past x = 2161 (71 % of its width), and "reset to the full page" failed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, firstView, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
const WHO = 'crop tester';
let projectId: string;
const sheets: Record<number, string> = {};

const crop = (sheetId: string, box: object) =>
  app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/sheets/${sheetId}/build-setup/crop`,
    payload: { box, who: WHO },
  });

beforeAll(async () => {
  projectId = await insertProject(db);
  for (const [i, rotation] of [0, 90, 270].entries()) {
    const id = await insertSheet(db, projectId, { page_index: i, width_pt: 3024, height_pt: 2160 });
    await db.updateTable('sheets').set({ rotation }).where('id', '=', id).execute();
    sheets[rotation] = id;
  }
});

afterAll(async () => {
  await app.close();
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

describe('a crop anywhere on the displayed page, on every rotation', () => {
  it.each([0, 90, 270])('rotation %i: the full page is accepted and stored', async (rotation) => {
    const full = { x0: 0, y0: 0, x1: 3024, y1: 2160 };
    const res = await crop(sheets[rotation]!, full);
    expect(res.statusCode).toBe(200);
    expect((await firstView(db, sheets[rotation]!)).box).toEqual(full);
    // a box in the right-hand part of the page (past 71 % of the width)
    expect(
      (await crop(sheets[rotation]!, { x0: 2500, y0: 100, x1: 3000, y1: 2100 })).statusCode,
    ).toBe(200);
  });

  it.each([0, 90, 270])(
    'rotation %i: a box past the displayed page is refused',
    async (rotation) => {
      for (const box of [
        { x0: 0, y0: 0, x1: 3100, y1: 2160 },
        { x0: 0, y0: 0, x1: 2000, y1: 2938 }, // the unrotated height: off the displayed page
        { x0: -5, y0: 0, x1: 100, y1: 100 },
      ]) {
        const res = await crop(sheets[rotation]!, box);
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('outside the page');
      }
    },
  );
});
