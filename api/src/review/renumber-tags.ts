// "Renumber tags" (Phase 14f, owner decision): the counted pieces (not deleted, not ignored) get
// running numbers per prefix again, in page order then reading order (top end: y, then x; the
// member id breaks a tie), so the piecemarks have no gaps. Numbering stays job-wide (or per sheet
// when the project numbers tags per sheet). It is ONE recorded action of `tag` edit rows (reason
// RENUMBER_REASON), undone and redone like any other; members rows and member ids never change.
// Never changed: a tag a person typed, and the tags of members that are not renumbered (ignored
// pieces, label-first members): their numbers are kept free so no duplicate is made. Deleted
// members keep their tags (undoing a delete can then give a duplicate; duplicateTagIds finds it).
// After the action the counter rows are set to the highest number in use, so the next tag follows.
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { recordAction, type EditEntry } from './actions.js';
import { logCountAction } from './count-log.js';
import { loadPieces, type PagePt } from './line-first-pieces.js';
import { tagScopeOf } from './tag-scope.js';

export const RENUMBER_REASON = 'renumber tags';

export interface TagValue {
  prefix: string | null;
  number: number | null;
}

/** A member as the renumber rule sees it. */
export interface TagMember {
  id: string;
  member_id: string;
  sheet_id: string | null;
  page_index: number;
  /** Top end in displayed page points (null: no geometry, sorted last on the page). */
  top: PagePt | null;
  tag: TagValue;
  deleted: boolean;
  /** A built piece that counts (not deleted, not ignored). */
  counted_piece: boolean;
  /** Its current tag is one a person typed. */
  typed: boolean;
}

export interface TagChange {
  id: string;
  sheet_id: string | null;
  before: TagValue;
  after: TagValue;
}

const groupKey = (m: TagMember, perSheet: boolean) =>
  `${perSheet ? (m.sheet_id ?? '') : ''}\u0000${m.tag.prefix ?? ''}`;

/** The changes "Renumber tags" makes (pure). Only counted pieces with a number and no typed tag are
 * renumbered; every other member that is not deleted keeps its number, and that number is skipped. */
export function renumberPlan(members: readonly TagMember[], perSheet: boolean): TagChange[] {
  const groups = new Map<string, { moving: TagMember[]; kept: Set<number> }>();
  for (const m of members) {
    if (m.deleted || m.tag.number === null) continue;
    const k = groupKey(m, perSheet);
    const g = groups.get(k) ?? { moving: [], kept: new Set<number>() };
    groups.set(k, g);
    if (m.counted_piece && !m.typed) g.moving.push(m);
    else g.kept.add(m.tag.number);
  }
  const out: TagChange[] = [];
  for (const g of groups.values()) {
    g.moving.sort(
      (a, b) =>
        a.page_index - b.page_index ||
        (a.top ? a.top[1] : Infinity) - (b.top ? b.top[1] : Infinity) ||
        (a.top ? a.top[0] : Infinity) - (b.top ? b.top[0] : Infinity) ||
        (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    let n = 0;
    for (const m of g.moving) {
      n += 1;
      while (g.kept.has(n)) n += 1;
      if (m.tag.number !== n)
        out.push({
          id: m.id,
          sheet_id: m.sheet_id,
          before: { ...m.tag },
          after: { prefix: m.tag.prefix, number: n },
        });
    }
  }
  return out;
}

/** Ids of the members (not deleted) whose tag another member of the scope also has (pure). */
export function duplicateTagIds(members: readonly TagMember[], perSheet: boolean): Set<string> {
  const by = new Map<string, string[]>();
  for (const m of members) {
    if (m.deleted || m.tag.number === null) continue;
    const k = `${groupKey(m, perSheet)}\u0000${m.tag.number}`;
    by.set(k, [...(by.get(k) ?? []), m.id]);
  }
  const out = new Set<string>();
  for (const ids of by.values()) if (ids.length > 1) ids.forEach((id) => out.add(id));
  return out;
}

const sameTag = (a: unknown, b: TagValue): boolean => {
  const x = (a ?? {}) as { prefix?: unknown; number?: unknown };
  return (x.prefix ?? null) === b.prefix && (x.number ?? null) === b.number;
};

/** Every member of the project with its current tag, whether it is deleted, a counted piece, and
 * whether its tag is one a person typed (a `tag` edit that is not an undo or redo, not a renumber
 * and not the tag that follows a kind change in the same action, with the same value as now).
 * With `light` only the tags and deletes are read (enough for duplicateTagIds). */
export async function loadTagMembers(
  db: Kysely<Database>,
  projectId: string,
  light = false,
): Promise<{ members: TagMember[]; perSheet: boolean }> {
  const perSheet = (await tagScopeOf(db, projectId)) === 'sheet';
  const rows = await sql<{
    id: string;
    member_id: string;
    sheet_id: string | null;
    page_index: number | null;
    piece: boolean;
    tag: TagValue | null;
    status: string | null;
  }>`
    SELECT m.id, m.member_id, m.sheet_id, s.page_index, m.build_run_id IS NOT NULL AS piece,
      COALESCE(
        (SELECT e.corrected_value FROM member_edits e
          WHERE e.member_id = m.id AND e.field_name = 'tag'
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
        jsonb_build_object('prefix', m.tag_prefix, 'number', m.tag_number)) AS tag,
      COALESCE(
        (SELECT e.corrected_value #>> '{}' FROM member_edits e
          WHERE e.member_id = m.id AND e.field_name = 'review_status'
          ORDER BY e.created_at DESC, e.id DESC LIMIT 1),
        m.review_status::text) AS status
    FROM members m LEFT JOIN sheets s ON s.id = m.sheet_id
    WHERE m.project_id = ${projectId}`.execute(db);
  const typed = light
    ? { rows: [] }
    : await sql<{ member_id: string; corrected_value: unknown }>`
    SELECT e.member_id, e.corrected_value FROM member_edits e JOIN members m ON m.id = e.member_id
    WHERE m.project_id = ${projectId} AND e.field_name = 'tag' AND e.undo_of_action_id IS NULL
      AND e.reason IS DISTINCT FROM ${RENUMBER_REASON}
      AND NOT EXISTS (SELECT 1 FROM member_edits k WHERE k.action_id = e.action_id
        AND k.member_id = e.member_id AND k.field_name = 'kind')`.execute(db);
  const typedOf = new Map<string, unknown[]>();
  for (const t of typed.rows)
    typedOf.set(t.member_id, [...(typedOf.get(t.member_id) ?? []), t.corrected_value]);
  const pieces = new Map(
    light ? [] : (await loadPieces(db, projectId)).map((p) => [p.id, p] as const),
  );
  const members = rows.rows.map((r): TagMember => {
    const raw = (r.tag ?? {}) as { prefix?: unknown; number?: unknown };
    const tag: TagValue = {
      prefix: typeof raw.prefix === 'string' ? raw.prefix : null,
      number: typeof raw.number === 'number' ? raw.number : null,
    };
    const p = r.piece ? pieces.get(r.id) : undefined;
    const ends = p ? [p.a, p.b].filter((x): x is PagePt => x !== null) : [];
    const top = ends.length
      ? ends.reduce((a, b) => (b[1] < a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a))
      : null;
    return {
      id: r.id,
      member_id: r.member_id,
      sheet_id: r.sheet_id,
      page_index: r.page_index ?? Number.MAX_SAFE_INTEGER,
      top,
      tag,
      deleted: r.status === 'rejected',
      counted_piece: !!p && !p.deleted && !p.ignored,
      typed: (typedOf.get(r.id) ?? []).some((v) => sameTag(v, tag)),
    };
  });
  return { members, perSheet };
}

/** Ids of the project's members whose tag is a duplicate in its scope. */
export async function projectDuplicateTags(
  db: Kysely<Database>,
  projectId: string,
): Promise<Set<string>> {
  const { members, perSheet } = await loadTagMembers(db, projectId, true);
  return duplicateTagIds(members, perSheet);
}

/** What "Renumber tags" would do now: tags it would change and duplicate tags, per prefix. */
export async function renumberPreview(db: Kysely<Database>, projectId: string) {
  const { members, perSheet } = await loadTagMembers(db, projectId);
  const changes = renumberPlan(members, perSheet);
  const duplicates = duplicateTagIds(members, perSheet);
  const byPrefix: Record<string, number> = {};
  for (const c of changes)
    byPrefix[c.before.prefix ?? ''] = (byPrefix[c.before.prefix ?? ''] ?? 0) + 1;
  return { changes: changes.length, by_prefix: byPrefix, duplicates: duplicates.size };
}

/** Renumber as one recorded action; returns the action id (null: nothing to change). */
export async function renumberTags(
  db: Kysely<Database>,
  projectId: string,
  who: string,
): Promise<{ action_id: string | null; changed: number }> {
  const { members, perSheet } = await loadTagMembers(db, projectId);
  const changes = renumberPlan(members, perSheet);
  if (changes.length === 0) return { action_id: null, changed: 0 };
  const after = new Map(changes.map((c) => [c.id, c.after]));
  // highest number in use per counter row after the change (members not deleted)
  const highest = new Map<string, { key: string; prefix: string; n: number }>();
  for (const m of members) {
    const t = after.get(m.id) ?? m.tag;
    if (m.deleted || t.number === null) continue;
    const key = perSheet ? (m.sheet_id ?? '') : '';
    const k = `${key}\u0000${t.prefix ?? ''}`;
    const h = highest.get(k);
    if (!h || t.number > h.n) highest.set(k, { key, prefix: t.prefix ?? '', n: t.number });
  }
  const touched = new Set(
    changes.map((c) => `${perSheet ? (c.sheet_id ?? '') : ''}\u0000${c.before.prefix ?? ''}`),
  );
  const entries: EditEntry[] = changes.map((c) => ({
    memberId: c.id,
    field: 'tag',
    before: c.before,
    after: c.after,
    status: 'edited',
  }));
  const actionId = await db.transaction().execute(async (trx) => {
    const id = await recordAction(trx, who, entries, RENUMBER_REASON);
    await logCountAction(trx, {
      projectId,
      sheetId: null,
      action: 'edit',
      who,
      editActionId: id,
      detail: {
        change: 'renumber_tags',
        changed: changes.length,
        prefixes: [...new Set(changes.map((c) => c.before.prefix ?? ''))].length,
      },
    });
    for (const k of touched) {
      const h = highest.get(k);
      if (!h) continue;
      await trx
        .updateTable('tag_counters')
        .set({ last_number: h.n })
        .where('project_id', '=', projectId)
        .where('scope_key', '=', h.key)
        .where('prefix', '=', h.prefix)
        .execute();
    }
    return id;
  });
  return { action_id: actionId, changed: changes.length };
}
