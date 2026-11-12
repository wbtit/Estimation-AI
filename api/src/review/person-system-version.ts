// The SYSTEM VERSION of a page when auto mode never ran (the normal click-first flow; Review 3, item
// 5). It is what the SYSTEM produced, before a person's edits:
//   1. the pieces of the page's builds: for each view, its FIRST person Build snapshot (a later
//      Build of the same view is a rebuild, not the system version), the pieces a person drew
//      (members with origin 'manual') left out;
//   2. the Find similar matches the person accepted (the members that action created, as the system
//      proposed them: the geometry and size they were created with, before any edit).
// Pure functions: the route loads the snapshots, the members and the Find similar log.
import type { SnapshotPiece } from '../db/types.js';

export interface PersonSnap {
  sheet_id: string;
  view_id: string | null;
  created_at: Date | string;
  pieces: SnapshotPiece[];
  /** The setup frozen with the snapshot (the report compares it with the final setup). */
  setup: Record<string, unknown>;
}

const t = (d: Date | string): number => new Date(d).getTime();

/** The first snapshot of each (sheet, view), oldest first. */
export function firstSnapshotPerView(snaps: readonly PersonSnap[]): PersonSnap[] {
  const sorted = [...snaps].sort((a, b) => t(a.created_at) - t(b.created_at));
  const seen = new Set<string>();
  const out: PersonSnap[] = [];
  for (const s of sorted) {
    const key = `${s.sheet_id}|${s.view_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** The system's pieces of a sheet: the union of its views' first snapshots (by member id), without
 * the pieces a person drew. `originOf` maps a member id to its origin; a member that no longer
 * exists (a rebuild replaced it) has none and is kept (the snapshot only holds what a Build or a
 * person's drawing put on the page, and a person's drawing is never replaced by a rebuild). */
export function systemPiecesOfSheet(
  firsts: readonly PersonSnap[],
  originOf: ReadonlyMap<string, string>,
): SnapshotPiece[] {
  const seen = new Set<string>();
  const out: SnapshotPiece[] = [];
  for (const s of firsts)
    for (const p of s.pieces) {
      if (seen.has(p.member_id) || originOf.get(p.member_id) === 'manual') continue;
      seen.add(p.member_id);
      out.push(p);
    }
  return out;
}

export interface MemberRow {
  member_id: string;
  sheet_id: string | null;
  type: string;
  kind: string | null;
  tag_prefix: string | null;
  tag_number: number | null;
  profile: string | null;
  profile_raw: string | null;
  page_x0: number | string | null;
  page_y0: number | string | null;
  page_x1: number | string | null;
  page_y1: number | string | null;
  build_state: string | null;
  size_state: string | null;
  support_state: string | null;
  piece_index: number | null;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** A member as the system proposed it (its stored row, never the person's later edits). */
export function proposedPiece(m: MemberRow): SnapshotPiece {
  const x0 = num(m.page_x0);
  const y0 = num(m.page_y0);
  const x1 = num(m.page_x1);
  const y1 = num(m.page_y1);
  return {
    member_id: m.member_id,
    kind: m.kind,
    type: m.type,
    tag: m.tag_prefix && m.tag_number !== null ? `${m.tag_prefix}${m.tag_number}` : null,
    profile: m.profile,
    profile_raw: m.profile_raw,
    page: x0 === null || y0 === null ? null : [x0, y0, x1 ?? x0, y1 ?? y0],
    start: null,
    end: null,
    length_mm: null,
    build_state: m.build_state,
    size_state: m.size_state,
    support_state: m.support_state,
    piece_index: m.piece_index,
  };
}

/** The member ids a sheet's Find similar actions created, in order, without duplicates. */
export function findSimilarMemberIds(
  actions: readonly { sheet_id: string | null; detail: unknown }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of actions) {
    const ids = (a.detail as { member_ids?: unknown } | null)?.member_ids;
    if (!a.sheet_id || !Array.isArray(ids)) continue;
    const list = out.get(a.sheet_id) ?? [];
    for (const id of ids) if (typeof id === 'string' && !list.includes(id)) list.push(id);
    out.set(a.sheet_id, list);
  }
  return out;
}
