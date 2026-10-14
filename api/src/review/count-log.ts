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

export interface PageTime {
  sheet_id: string | null;
  who: string;
  actions: number;
  first: string;
  last: string;
  /** Seconds between the first and the last action, gaps over `idleSeconds` not counted. */
  active_seconds: number;
}

/** Time per page and person from log rows (oldest first): gaps longer than idleSeconds are idle. */
export function pageTimes(
  rows: readonly { sheet_id: string | null; who: string; created_at: Date | string }[],
  idleSeconds = 300,
): PageTime[] {
  const groups = new Map<string, { sheet_id: string | null; who: string; times: number[] }>();
  for (const r of rows) {
    const key = `${r.sheet_id ?? ''}|${r.who}`;
    const g = groups.get(key) ?? { sheet_id: r.sheet_id, who: r.who, times: [] };
    g.times.push(new Date(r.created_at as string).getTime());
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const t = [...g.times].sort((a, b) => a - b);
    let active = 0;
    for (let i = 1; i < t.length; i += 1) {
      const gap = ((t[i] as number) - (t[i - 1] as number)) / 1000;
      if (gap <= idleSeconds) active += gap;
    }
    return {
      sheet_id: g.sheet_id,
      who: g.who,
      actions: t.length,
      first: new Date(t[0] as number).toISOString(),
      last: new Date(t[t.length - 1] as number).toISOString(),
      active_seconds: Math.round(active * 10) / 10,
    };
  });
}
