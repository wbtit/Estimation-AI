// Review 4 migration 037 (the page beam style of a view), checked on SYNTHETIC rows of the test
// database inside transactions that are rolled back.
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, getDb } from '../db/client.js';
import { deleteProject, insertProject, insertSheet } from './helpers.js';

const db = getDb();
const ROLLBACK = new Error('rollback');

afterAll(async () => {
  await closeDatabaseConnection();
});

describe('migration 037: beam style', () => {
  it('a view starts with no style (single), and only single / double / both are accepted', async () => {
    const projectId = await insertProject(db);
    try {
      const sheetId = await insertSheet(db, projectId, { page_index: 0 });
      const view = await db
        .selectFrom('build_views')
        .selectAll()
        .where('sheet_id', '=', sheetId)
        .executeTakeFirstOrThrow();
      expect(view).toMatchObject({
        beam_style: null,
        beam_gap_min_pt: null,
        beam_gap_max_pt: null,
        beam_centreline_required: true,
        beam_style_source: null,
        beam_style_evidence: null,
      });
      const set = (v: Record<string, unknown>) =>
        db
          .transaction()
          .execute(async (trx) => {
            await trx
              .updateTable('build_views')
              .set(v as never)
              .where('id', '=', view.id)
              .execute();
            throw ROLLBACK;
          })
          .catch((e: unknown) => {
            if (e !== ROLLBACK) throw e;
          });
      for (const style of ['single', 'double', 'both']) await set({ beam_style: style });
      await expect(set({ beam_style: 'triple' })).rejects.toThrow(/beam_style_check/);
      await expect(set({ beam_style_source: 'robot' })).rejects.toThrow(/source_check/);
      await expect(set({ beam_gap_min_pt: 0 })).rejects.toThrow(/gap_min_check/);
      await expect(set({ beam_gap_max_pt: -1 })).rejects.toThrow(/gap_max_check/);
      await set({
        beam_style: 'double',
        beam_gap_min_pt: 3.94,
        beam_gap_max_pt: 3.94,
        beam_style_source: 'learned',
        beam_style_evidence: JSON.stringify({ reason: 'thin pair' }),
      });
      // every old row reads as single: nothing was written by the migration
      const n = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM build_views WHERE beam_style IS NOT NULL`.execute(db);
      expect(Number(n.rows[0]!.n)).toBe(0);
    } finally {
      await deleteProject(db, projectId);
    }
  });
});
