// One tag counter per project (Phase 11b, Decision Log): the line-first build (worker
// src/build/job.py take_tag_numbers), the review UI and the counting copilot take numbers from the
// same tag_counters row, with the same rule. The scope is the job ('') or the sheet when the project
// numbers tags per sheet; prefix '' stands for "no prefix". The counter never goes below the highest
// CURRENT number in use for the prefix in the scope (Phase 14f: a person's tag edit applied, deleted
// members left out, and `floor` for numbers only known from edits). A delete alone frees no number
// (the counter row keeps it); "Renumber tags" (renumber-tags.ts) sets the row back to the highest
// number in use, so the next tag follows the renumbered ones.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { tagScopeOf } from './tag-scope.js';

type Db = Kysely<Database> | Transaction<Database>;

/** The highest current tag number of the prefix among the members of the scope that are not
 * deleted (the latest tag edit, else the stored tag; the latest review_status edit, else the
 * stored status, is not 'rejected'). Same SQL as the worker's take_tag_numbers. */
export async function highestCurrentTag(
  db: Db,
  projectId: string,
  sheetId: string | null,
  prefix: string | null,
): Promise<number> {
  const scope = sheetId === null ? sql`m.project_id = ${projectId}` : sql`m.sheet_id = ${sheetId}`;
  const row = await sql<{ n: number }>`
    SELECT COALESCE(MAX((t.tag ->> 'number')::int), 0)::int AS n FROM (
      SELECT COALESCE(
          (SELECT e.corrected_value FROM member_edits e
            WHERE e.member_id = m.id AND e.field_name = 'tag'
            ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
          jsonb_build_object('prefix', m.tag_prefix, 'number', m.tag_number)) AS tag,
        COALESCE(
          (SELECT e.corrected_value #>> '{}' FROM member_edits e
            WHERE e.member_id = m.id AND e.field_name = 'review_status'
            ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
          m.review_status::text) AS status
      FROM members m WHERE ${scope}) t
    WHERE t.status IS DISTINCT FROM 'rejected'
      AND COALESCE(t.tag ->> 'prefix', '') = ${prefix ?? ''}
      AND jsonb_typeof(t.tag -> 'number') = 'number'`.execute(db);
  return Number(row.rows[0]?.n ?? 0);
}

/** Reserve `n` numbers and return the first. */
export async function takeTagNumbers(
  db: Db,
  projectId: string,
  sheetId: string | null,
  prefix: string | null,
  n = 1,
  floor = 0,
): Promise<number> {
  const perSheet = (await tagScopeOf(db as Kysely<Database>, projectId)) === 'sheet' && !!sheetId;
  const key = perSheet ? (sheetId as string) : '';
  const inUse = await highestCurrentTag(db, projectId, perSheet ? sheetId : null, prefix);
  const used = Math.max(inUse, floor);
  const row = await sql<{ last_number: number }>`
    INSERT INTO tag_counters (project_id, scope_key, prefix, last_number)
    VALUES (${projectId}, ${key}, ${prefix ?? ''}, ${used + n})
    ON CONFLICT (project_id, scope_key, prefix) DO UPDATE
      SET last_number = GREATEST(tag_counters.last_number, ${used}) + ${n}
    RETURNING last_number`.execute(db);
  return Number(row.rows[0]?.last_number) - n + 1;
}
