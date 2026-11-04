// The action log of the counting copilot: one row per create, accept, reject, edit, delete, undo,
// redo, measure and mode change, with who and when. It exists so that time per page can be
// measured and clean member-linked labels can be collected later. Logging never blocks an action.
import type { Kysely, Transaction } from 'kysely';
import type { CountActionName, Database } from '../db/types.js';

type Db = Kysely<Database> | Transaction<Database>;

export interface CountLogEntry {
  projectId: string;
  sheetId?: string | null;
  memberId?: string | null;
  action: CountActionName;
  who: string;
  editActionId?: string | null;
  detail?: Record<string, unknown>;
}

export async function logCountAction(db: Db, e: CountLogEntry): Promise<void> {
  await db
    .insertInto('count_actions')
    .values({
      project_id: e.projectId,
      sheet_id: e.sheetId ?? null,
      member_id: e.memberId ?? null,
      action: e.action,
      who: e.who,
      edit_action_id: e.editActionId ?? null,
      detail: JSON.stringify(e.detail ?? {}),
    })
    .execute();
}
