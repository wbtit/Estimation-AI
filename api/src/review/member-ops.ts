// Human actions on a member, each producing a list of edit entries (field, before, after).
// "before" is always the EFFECTIVE value before the action, in the same JSON shape the edit
// stores, so an undo is just the same entries swapped. Nothing here touches the stored row.
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/types.js';
import { recordAction, type EditEntry } from './actions.js';
import type { MemberView } from './members.js';
import { parseLengthMm } from '../units/parse.js';
import { parseJoist } from './joist.js';
import { parseProfile } from './profile.js';

type Db = Kysely<Database> | Transaction<Database>;

export class OpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The typed length in force (an edit), not the line length. */
function typedLengthOf(m: MemberView): number | null {
  return (m.length_source === 'manual' || m.length_source === 'measured_manual') &&
    m.type !== 'column'
    ? m.length_mm
    : null;
}

export interface MemberPatch {
  profile_text?: string | null;
  mark?: string | null;
  level?: string | null;
  type?: string;
  quantity?: number;
  /** A typed length (feet-inch or mm); empty clears it. */
  length?: string | null;
  /** The Name of the table row (empty = back to the system wording). */
  name?: string | null;
  /** The tag as drawn on the symbol: letters then a number (`B7`); empty clears the number. */
  tag_text?: string | null;
}

/** Splits `B7` into its prefix and number; `7` has no prefix. Null when it is not that shape. */
export function parseTagText(text: string): { prefix: string | null; number: number } | null {
  const m = /^([A-Za-z]{0,6})(\d{1,5})$/.exec(text.trim());
  if (!m) return null;
  return { prefix: m[1] === '' ? null : (m[1] as string), number: Number(m[2]) };
}

/** Edits for changed fields only; the profile text is re-parsed into the canonical profile. */
export function patchEntries(
  m: MemberView,
  memberLevelOverride: string | null,
  patch: MemberPatch,
): EditEntry[] {
  const out: EditEntry[] = [];
  const push = (field: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push({ memberId: m.id, field, before, after, status: 'edited' });
    }
  };
  if (patch.profile_text !== undefined) {
    const text = patch.profile_text === null ? null : patch.profile_text.trim() || null;
    const parsed = text ? parseProfile(text) : null;
    push('profile_raw', m.profile_raw, text);
    push('profile', m.profile, parsed?.canonical ?? null);
    // a person's own text for a counted piece: record that the size is no longer the system's fill
    if ((m.count.source !== null || m.origin === 'manual') && m.count.size_source !== 'manual') {
      push('size_source', m.count.size_source, 'manual');
    }
    // a joist designation makes the member a joist (kept as written, never matched to AISC)
    if (text && parseJoist(text) && m.type !== 'column' && patch.type === undefined) {
      push('type', m.type, 'joist');
    }
  }
  if (patch.mark !== undefined) push('mark', m.mark, patch.mark?.trim() || null);
  if (patch.level !== undefined) push('level', memberLevelOverride, patch.level?.trim() || null);
  if (patch.type !== undefined) push('type', m.type, patch.type);
  // the stored quantity is the base one: a typical multiplier is its own edit
  if (patch.quantity !== undefined)
    push('quantity', m.typical ? m.typical.base_quantity : m.quantity, patch.quantity);
  if (patch.name !== undefined) push('name', m.name, patch.name?.trim() || null);
  if (patch.length !== undefined) {
    const text = patch.length === null ? '' : patch.length.trim();
    let mm: number | null = null;
    if (text !== '') {
      mm = parseLengthMm(text);
      if (mm === null) throw new OpError(400, 'the length is not a length (use 12\'-6", 3000 mm)');
    }
    push('length_mm', typedLengthOf(m), mm === null ? null : Math.round(mm * 10) / 10);
    // a typed length replaces a measured one: the measurement is no longer its evidence
    push('length_measurement', m.length_measurement, null);
  }
  if (patch.tag_text !== undefined) {
    const text = patch.tag_text === null ? '' : patch.tag_text.trim();
    let after: { prefix: string | null; number: number | null };
    if (text === '') after = { prefix: m.tag.prefix, number: null };
    else {
      const t = parseTagText(text);
      if (!t) throw new OpError(400, 'the tag is letters and a number, for example B7');
      after = t;
    }
    push('tag', { prefix: m.tag.prefix, number: m.tag.number }, after);
  }
  return out;
}

export function deleteEntries(m: MemberView): EditEntry[] {
  if (m.deleted) return [];
  return [
    {
      memberId: m.id,
      field: 'review_status',
      before: m.review_status,
      after: 'rejected',
      status: 'rejected',
    },
  ];
}

/** The inverse of an action's rows (an undo appends them; nothing is deleted). */
/** The last member action of this person that is not undone (its id and time), or null. */
export async function lastUndoableAction(
  db: Db,
  projectId: string,
  who: string,
): Promise<{ action_id: string; at: Date } | null> {
  const last = await sql<{ action_id: string; at: Date }>`
    SELECT e.action_id, max(e.created_at) AS at FROM member_edits e JOIN members m ON m.id = e.member_id
    WHERE m.project_id = ${projectId} AND e.reviewer = ${who}
      AND e.action_id IS NOT NULL AND e.undo_of_action_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM member_edits u WHERE u.undo_of_action_id = e.action_id
          AND NOT EXISTS (SELECT 1 FROM member_edits r WHERE r.undo_of_action_id = u.action_id))
    GROUP BY e.action_id ORDER BY max(e.created_at) DESC, e.action_id DESC LIMIT 1`.execute(db);
  return last.rows[0] ?? null;
}

export async function undoLastAction(
  db: Kysely<Database>,
  projectId: string,
  who: string,
  states: (memberId: string) => Promise<MemberView | null>,
): Promise<{ undone: string | null; rows: number }> {
  const actionId = (await lastUndoableAction(db, projectId, who))?.action_id;
  if (!actionId) return { undone: null, rows: 0 };
  const rows = await db
    .selectFrom('member_edits')
    .select(['member_id', 'field_name', 'original_value', 'corrected_value'])
    .where('action_id', '=', actionId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const entries: EditEntry[] = [];
  for (const r of rows) {
    if (r.field_name === '__created__') {
      const m = await states(r.member_id);
      entries.push({
        memberId: r.member_id,
        field: 'review_status',
        before: m?.review_status ?? 'edited',
        after: 'rejected',
        status: 'rejected',
      });
    } else {
      entries.push({
        memberId: r.member_id,
        field: r.field_name,
        before: r.corrected_value,
        after: r.original_value,
        status: 'edited',
      });
    }
  }
  entries.reverse(); // restore in the opposite order
  await recordAction(db, who, entries, `undo of action ${actionId}`, actionId);
  return { undone: actionId, rows: entries.length };
}

/**
 * Redo: put back the last action this person undid, as long as they have done nothing new since
 * (a new action clears the redo). It is an action of its own (the inverse of the undo, recorded as
 * undoing that undo), so the history stays complete and the original can be undone again.
 */
export async function redoLastUndo(
  db: Kysely<Database>,
  projectId: string,
  who: string,
): Promise<{ redone: string | null; undone_action: string | null; rows: number }> {
  const last = await sql<{ action_id: string; undo_of: string; created: Date }>`
    SELECT u.action_id, u.undo_of_action_id AS undo_of, max(u.created_at) AS created
    FROM member_edits u JOIN members m ON m.id = u.member_id
    WHERE m.project_id = ${projectId} AND u.reviewer = ${who} AND u.undo_of_action_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM member_edits t
                  WHERE t.action_id = u.undo_of_action_id AND t.undo_of_action_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM member_edits r WHERE r.undo_of_action_id = u.action_id)
    GROUP BY u.action_id, u.undo_of_action_id
    ORDER BY max(u.created_at) DESC, u.action_id DESC LIMIT 1`.execute(db);
  const u = last.rows[0];
  if (!u) return { redone: null, undone_action: null, rows: 0 };
  const newer = await sql<{ n: string }>`
    SELECT count(*) AS n FROM member_edits e JOIN members m ON m.id = e.member_id
    WHERE m.project_id = ${projectId} AND e.reviewer = ${who}
      AND e.action_id IS NOT NULL AND e.undo_of_action_id IS NULL
      AND e.created_at > ${u.created}`.execute(db);
  if (Number(newer.rows[0]?.n ?? 0) > 0) return { redone: null, undone_action: null, rows: 0 };
  const rows = await db
    .selectFrom('member_edits')
    .select(['member_id', 'field_name', 'original_value', 'corrected_value'])
    .where('action_id', '=', u.action_id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const entries: EditEntry[] = rows
    .map((r) => ({
      memberId: r.member_id,
      field: r.field_name,
      before: r.corrected_value,
      after: r.original_value,
      status: 'edited' as const,
    }))
    .reverse();
  const redone = await recordAction(db, who, entries, `redo of action ${u.undo_of}`, u.action_id);
  return { redone, undone_action: u.undo_of, rows: entries.length };
}

/** The kind as an edit value: the person's own choice, or {reset} when the rule's guess is in force. */
export function kindValue(m: MemberView): string | null | { reset: true } {
  return m.kind.source === 'person' ? m.kind.name : { reset: true };
}
