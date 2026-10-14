// Human actions on a member, each producing a list of edit entries (field, before, after).
// "before" is always the EFFECTIVE value before the action, in the same JSON shape the edit
// stores, so an undo is just the same entries swapped. Nothing here touches the stored row.
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db/types.js';
import { recordAction, type EditEntry } from './actions.js';
import type { Line, LinkEdit, LinkReset, MemberView } from './members.js';
import { parseLengthMm } from '../units/parse.js';
import { parseJoist } from './joist.js';
import { parseProfile } from './profile.js';
import { groupOf } from './shared-line.js';
import type { KindIndex } from './kinds.js';

type Db = Kysely<Database> | Transaction<Database>;

export class OpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The link as an edit value: a person's choice, or {reset} when the rule's proposal is in force. */
export function linkValue(m: MemberView): LinkEdit | LinkReset {
  return m.link.source === 'person'
    ? { line: m.link.line, rank: m.link.chosen_rank }
    : { reset: true };
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
  if (patch.quantity !== undefined) push('quantity', m.quantity, patch.quantity);
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

export function linkEntries(m: MemberView, choice: { rank?: number; line?: Line }): EditEntry[] {
  let after: LinkEdit;
  if (choice.rank !== undefined) {
    const c = m.link.candidates.find((x) => x.rank === choice.rank);
    if (!c) throw new OpError(400, `there is no candidate ${choice.rank}`);
    after = { line: { p: c.p, q: c.q }, rank: c.rank };
  } else if (choice.line) {
    after = { line: choice.line, rank: null };
  } else {
    throw new OpError(400, 'give a candidate rank or a line');
  }
  return [{ memberId: m.id, field: 'link', before: linkValue(m), after, status: 'edited' }];
}

export function confirmEntries(m: MemberView): EditEntry[] {
  if (m.review_status === 'approved') return [];
  return [
    {
      memberId: m.id,
      field: 'review_status',
      before: m.review_status,
      after: 'approved',
      status: 'approved',
    },
  ];
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

/**
 * A person's answer for a group of members on one line: "separate members" (every member of the
 * group is kept) or a merge (THIS member becomes part of `keep`; the other members of the line are
 * separate members and are not touched). One action, so one undo. Nothing is deleted.
 */
export function sharedLineEntries(
  target: MemberView,
  all: MemberView[],
  choice: { resolution: 'separate' } | { resolution: 'merge'; keep?: string },
): EditEntry[] {
  const group = groupOf(target, all);
  if (group.length < 2) throw new OpError(409, 'this member does not share its line with another');
  if (choice.resolution === 'separate') {
    return group
      .filter((m) => m.shared_resolution !== 'separate')
      .map((m) => ({
        memberId: m.id,
        field: 'shared_line',
        before: m.shared_resolution,
        after: 'separate',
        status: 'edited' as const,
      }));
  }
  // a merge moves THIS member into another one (default: the member it duplicates, else the best of
  // the line); the other members of a shared line are separate members and are not touched
  const keep = choice.keep
    ? group.find((m) => m.id === choice.keep)
    : (group.find((m) => m.id === target.shared_line?.duplicate_of) ??
      group.find((m) => m.id !== target.id));
  if (!keep || keep.id === target.id)
    throw new OpError(400, 'the member to keep is not in this group');
  return [
    {
      memberId: target.id,
      field: 'merged_into',
      before: target.merged_into,
      after: keep.id,
      status: 'edited' as const,
    },
  ];
}

/**
 * "Existing steel": a real member that is already there. It keeps its profile and its length (if
 * the length is trusted) but is outside the main total, in its own takeoff block. Different from
 * "not a member" (a label that is not a member at all). An undo takes the flag off again.
 */
export function existingEntries(m: MemberView, value: boolean): EditEntry[] {
  if (m.existing === value) return [];
  return [
    {
      memberId: m.id,
      field: 'existing',
      before: m.existing ? true : null,
      after: value ? true : null,
      status: 'edited',
    },
  ];
}

export const NOT_MEMBER_REASONS = ['existing', 'misc_steel', 'detail', 'other'] as const;
export type NotMemberReason = (typeof NOT_MEMBER_REASONS)[number];

/**
 * "Not a member": the label is something else (existing steel, misc steel, a detail, other). It
 * leaves the member list, the unlinked list and the takeoff; nothing is deleted, and an undo
 * brings it back. A null reason takes the flag off again.
 */
export function notMemberEntries(m: MemberView, reason: NotMemberReason | null): EditEntry[] {
  const after = reason === null ? null : { reason };
  if (JSON.stringify(m.not_member) === JSON.stringify(after)) return [];
  return [{ memberId: m.id, field: 'not_member', before: m.not_member, after, status: 'edited' }];
}

export interface LegendChoice {
  status: 'linked' | 'no_legend_row' | 'ambiguous';
  row?: { id: string; designation_raw: string; profile: string | null } | null;
}

/** Confirming a legend row also takes the profile from that row; the mark link is the person's. */
export function markRefEntries(m: MemberView, choice: LegendChoice): EditEntry[] {
  const out: EditEntry[] = [
    {
      memberId: m.id,
      field: 'mark_ref',
      before: m.mark_ref,
      after: { status: choice.status, legend_row_id: choice.row?.id ?? null },
      status: 'edited',
    },
  ];
  if (choice.row) {
    if (m.profile_raw !== choice.row.designation_raw) {
      out.push({
        memberId: m.id,
        field: 'profile_raw',
        before: m.profile_raw,
        after: choice.row.designation_raw,
        status: 'edited',
      });
    }
    if (m.profile !== choice.row.profile) {
      out.push({
        memberId: m.id,
        field: 'profile',
        before: m.profile,
        after: choice.row.profile,
        status: 'edited',
      });
    }
  }
  return out;
}

/** The inverse of an action's rows (an undo appends them; nothing is deleted). */
export async function undoLastAction(
  db: Kysely<Database>,
  projectId: string,
  who: string,
  states: (memberId: string) => Promise<MemberView | null>,
): Promise<{ undone: string | null; rows: number }> {
  const last = await sql<{ action_id: string }>`
    SELECT e.action_id FROM member_edits e JOIN members m ON m.id = e.member_id
    WHERE m.project_id = ${projectId} AND e.reviewer = ${who}
      AND e.action_id IS NOT NULL AND e.undo_of_action_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM member_edits u WHERE u.undo_of_action_id = e.action_id
          AND NOT EXISTS (SELECT 1 FROM member_edits r WHERE r.undo_of_action_id = u.action_id))
    GROUP BY e.action_id ORDER BY max(e.created_at) DESC, e.action_id DESC LIMIT 1`.execute(db);
  const actionId = last.rows[0]?.action_id;
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

export async function applyEntries(
  db: Db,
  who: string,
  entries: EditEntry[],
): Promise<string | null> {
  if (entries.length === 0) return null;
  return recordAction(db, who, entries);
}

/** The kind as an edit value: the person's own choice, or {reset} when the rule's guess is in force. */
export function kindValue(m: MemberView): string | null | { reset: true } {
  return m.kind.source === 'person' ? m.kind.name : { reset: true };
}

/**
 * Next free tag number of a prefix on a sheet, from the effective tags of its members.
 * Numbers are never reused, so a tag stays stable once seen.
 */
export function nextTagNumber(sheetMembers: readonly MemberView[], prefix: string | null): number {
  let max = 0;
  for (const m of sheetMembers) {
    if (m.tag.prefix === prefix && m.tag.number !== null && m.tag.number > max) max = m.tag.number;
  }
  return max + 1;
}

export interface KindChoice {
  /** Set the kind (a kind of the list) or null to clear it. Omit to only confirm. */
  kind?: string | null;
  /** Confirm the kind the system guessed (no change of the kind). */
  confirm?: boolean;
}

/**
 * A person sets, clears or confirms the kind of members (one or several, as one action). Setting a
 * kind is the confirmation; the tag follows the kind (new prefix, next free number on the sheet);
 * clearing goes back to "no kind" (a person's decision, no guess).
 */
export function kindEntries(
  targets: readonly MemberView[],
  sheetMembers: readonly MemberView[],
  kinds: KindIndex,
  choice: KindChoice,
): EditEntry[] {
  const out: EditEntry[] = [];
  const taken = [...sheetMembers];
  const info = choice.kind ? kinds.get(choice.kind) : undefined;
  if (choice.kind !== undefined && choice.kind !== null && !info) {
    throw new OpError(400, `"${choice.kind}" is not a kind of the list`);
  }
  for (const m of targets) {
    if (choice.kind !== undefined) {
      if (m.kind.name === choice.kind && m.kind.source === 'person') continue;
      out.push({
        memberId: m.id,
        field: 'kind',
        before: kindValue(m),
        after: choice.kind,
        status: 'edited',
      });
      const prefix = info ? info.prefix : null;
      if (m.tag.prefix !== prefix || m.tag.number === null) {
        const number = nextTagNumber(taken, prefix);
        out.push({
          memberId: m.id,
          field: 'tag',
          before: { prefix: m.tag.prefix, number: m.tag.number },
          after: { prefix, number },
          status: 'edited',
        });
        taken.push({ ...m, tag: { ...m.tag, prefix, number } });
      }
    } else if (choice.confirm) {
      if (m.kind.state !== 'guessed') continue;
      out.push({
        memberId: m.id,
        field: 'kind_confirmed',
        before: false,
        after: true,
        status: 'edited',
      });
    }
  }
  return out;
}

/**
 * The pieces that share the tag of this one: the same mark on the sheet (a drawing mark such as a
 * beam mark is shared by every piece it labels), else the same profile text. Used by the explicit
 * "apply to all pieces with this tag" button, which shows this number before the click.
 */
export function sameTagMembers(
  target: MemberView,
  sheetMembers: readonly MemberView[],
): MemberView[] {
  const basis = target.mark ?? target.profile_raw;
  if (basis === null || basis === '') return [];
  return sheetMembers.filter(
    (m) =>
      m.id !== target.id &&
      !m.deleted &&
      m.not_member === null &&
      (target.mark !== null ? m.mark === target.mark : m.mark === null && m.profile_raw === basis),
  );
}
