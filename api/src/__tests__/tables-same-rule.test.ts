// Owner decision 133: the Stage 1 tables count pieces with the takeoff's rule (label quantity, times
// N when typical; a second label on a line that already has its piece adds 0). Synthetic project.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import type { TableRow } from '../review/tables.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const app = buildApp();
const db = getDb();
let projectId: string;
let sheetId: string;
const ids: Record<string, string> = {};

async function label(key: string, text: string, y: number, x0: number, quantity = 1) {
  ids[key] = (
    await db
      .insertInto('members')
      .values({
        project_id: projectId,
        sheet_id: sheetId,
        member_id: `M-${key}`,
        origin: 'extracted',
        type: 'beam',
        profile_raw: text,
        profile: text.toUpperCase(),
        quantity,
        kind: 'Beams',
        kind_source: 'person',
        kind_confirmed: true,
        field_sources: '{}',
        field_confidence: '{}',
        link_confidence: 'high',
        link_candidates: JSON.stringify([
          { rank: 1, p: [0, y], q: [600, y], score: 5, dist: 5, rel_angle: 0 },
        ]),
        source_bbox: JSON.stringify({ x0, y0: y - 14, x1: x0 + 40, y1: y - 6 }),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
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
  await label('A', 'W12x26', 100, 50); // alone on its line
  await label('B', 'W14x30', 200, 50, 3); // a label that says three pieces
  await label('C', 'W16x31', 300, 50); // two labels on one line, far apart: the line's piece...
  await label('D', 'W18x35', 300, 450); // ...and a second label on it that adds 0
});

afterAll(async () => {
  await deleteProject(db, projectId);
  await closeDatabaseConnection();
});

describe('tables and takeoff count with one rule', () => {
  it('label quantity counts; a second label on a carried line adds 0; totals agree', async () => {
    const t = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/takeoff` })
    ).json();
    const tables = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectId}/tables` })
    ).json();
    const q = (id: string) =>
      (tables.job.rows as TableRow[]).find((r) => r.member_ids.includes(id))?.quantity;
    expect(q(ids.A as string)).toBe(1);
    expect(q(ids.B as string)).toBe(3);
    expect((q(ids.C as string) ?? 0) + (q(ids.D as string) ?? 0)).toBe(1);
    expect(tables.job.quantity).toBe(5);
    expect(t.totals.pieces).toBe(5);
    expect(tables.pages[0].quantity).toBe(5);
  });
});
