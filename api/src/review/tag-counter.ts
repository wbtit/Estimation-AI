// One tag counter per project (Phase 11b, Decision Log): the line-first build (worker
// src/build/job.py take_tag_numbers), the review UI and the counting copilot take numbers from the
// same tag_counters row, with the same rule. The scope is the job ('') or the sheet when the project
// numbers tags per sheet; prefix '' stands for "no prefix". The counter never goes below the highest
// number in use for the prefix in the scope (stored tags, and `floor` for numbers only known from
// edits), so a number is never reused.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { tagScopeOf } from './tag-scope.js';

type Db = Kysely<Database> | Transaction<Database>;

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
  const usedRow = await db
    .selectFrom('members')
    .select(sql<number>`COALESCE(MAX(tag_number), 0)::int`.as('n'))
    .where(perSheet ? 'sheet_id' : 'project_id', '=', perSheet ? (sheetId as string) : projectId)
    .where(sql<boolean>`COALESCE(tag_prefix, '') = ${prefix ?? ''}`)
    .where('tag_number', 'is not', null)
    .executeTakeFirstOrThrow();
  const used = Math.max(Number(usedRow.n), floor);
  const row = await sql<{ last_number: number }>`
    INSERT INTO tag_counters (project_id, scope_key, prefix, last_number)
    VALUES (${projectId}, ${key}, ${prefix ?? ''}, ${used + n})
    ON CONFLICT (project_id, scope_key, prefix) DO UPDATE
      SET last_number = GREATEST(tag_counters.last_number, ${used}) + ${n}
    RETURNING last_number`.execute(db);
  return Number(row.rows[0]?.last_number) - n + 1;
}
