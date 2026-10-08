// Every human change to a member is a set of member_edits rows (field, before, after, who, when)
// that share an action id. An undo appends the inverse rows with undo_of_action_id; nothing is
// ever deleted, so the history stays complete and the stored (extracted) row is never changed.
import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Database, ReviewStatus } from '../db/types.js';

export interface EditEntry {
  memberId: string;
  field: string;
  before: unknown;
  after: unknown;
  /** Review status recorded with the edit row. */
  status?: Exclude<ReviewStatus, 'unreviewed'>;
}

type Db = Kysely<Database> | Transaction<Database>;

export async function recordAction(
  db: Db,
  who: string,
  entries: EditEntry[],
  reason: string | null = null,
  undoOf: string | null = null,
): Promise<string> {
  const actionId = randomUUID();
  await db
    .insertInto('member_edits')
    .values(
      entries.map((e) => ({
        member_id: e.memberId,
        field_name: e.field,
        original_value: JSON.stringify(e.before ?? null),
        corrected_value: JSON.stringify(e.after ?? null),
        review_status: e.status ?? 'edited',
        reviewer: who,
        reason,
        action_id: actionId,
        undo_of_action_id: undoOf,
      })),
    )
    .execute();
  return actionId;
}
