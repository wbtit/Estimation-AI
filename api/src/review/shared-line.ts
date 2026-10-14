// Members that share the same chosen line. Phase 5b held every member but the best of a shared line
// out of the main total; Phase 5c measured that this was wrong (on job-005 111 of the 113 members on
// shared lines have different profiles, so they are separate members, and 113 of 113 lines are ONE
// drawn segment, so the merge of segments is not the cause). Now:
//   - pieces: every member of a shared line stays in the main total (amber, shown grouped);
//   - length: the whole line is not the length of each member, so a member on a shared line has
//     length_shared and its length is left out of the length totals (a typed length is trusted);
//   - Phase 7 (owner decision 4 of Phase 6b, confirmed in 6c): the DISPLAY COUNT BASIS is one piece per
//     linked line. Of the labels on one line only the best-ranked one that is not red carries the piece;
//     the others stay listed (amber, grouped) but add 0 pieces. A label counts as its own piece when a
//     person said "separate members" or typed its length. See `pieceQuantity`.
//   - duplicates: only a true duplicate candidate (same line, same canonical profile, labels
//     overlapping or closer than DUPLICATE_LABEL_HEIGHTS label heights) is held out of the main
//     total, until a person says "separate members" or merges it (both are edits with undo).
// Nothing is merged or deleted automatically.
import type { MemberView, Line } from './members.js';
import { withSharedLine } from './status.js';

export interface SharedLine {
  /** Same for every member of the group. */
  group: string;
  /** Members in the group (merged, deleted and not-a-member ones do not count). */
  size: number;
  /** The best-ranked member of the group (a person's link first, then confidence, then score). */
  best: boolean;
  /**
   * This member carries a piece of the line (one piece per linked line): the best-ranked member that
   * is not red, or a member a person made separate or gave a typed length.
   */
  line_piece: boolean;
  /** What a person decided for this member. */
  resolution: 'separate' | null;
  /** The whole group is resolved (every member is "separate"). The amber flag is lifted then. */
  resolved: boolean;
  /**
   * Set when this member looks like a DUPLICATE of a better-ranked member of the group: same line,
   * same canonical profile, and the two labels overlap or are closer than DUPLICATE_LABEL_HEIGHTS
   * label heights. The id is that better member. Only these stay out of the main total, until a
   * person says "separate members" or merges them.
   */
  duplicate_of: string | null;
}

/** Two labels closer than this many label heights (or overlapping) are the same label drawn twice. */
export const DUPLICATE_LABEL_HEIGHTS = 2;

const CONF_RANK = { high: 0, medium: 1, low: 2 } as const;

/** A key for a line that does not depend on which end is first. */
export function lineKey(sheetId: string | null, line: Line): string {
  const a: [number, number] = [Math.round(line.p[0]), Math.round(line.p[1])];
  const b: [number, number] = [Math.round(line.q[0]), Math.round(line.q[1])];
  const [lo, hi] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  return `${sheetId ?? ''}|${lo[0]},${lo[1]}|${hi[0]},${hi[1]}`;
}

/** Lower is better: a person's own link first, then the rule's confidence class, then its score. */
function rank(m: MemberView, order: number): [number, number, number, number, number] {
  const chosen = m.link.candidates.find((c) => c.rank === m.link.chosen_rank);
  return [
    // a piece a person confirmed carries the line before any undecided suggestion does
    m.count.state === 'confirmed' ? 0 : 1,
    m.link.source === 'person' ? 0 : 1,
    m.link.confidence ? CONF_RANK[m.link.confidence] : 3,
    chosen ? chosen.score : 0,
    order,
  ];
}

function before(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** A length a person typed or measured by two clicks (trusted, not the whole shared line). */
export const isTypedLength = (source: string | null): boolean =>
  source === 'manual' || source === 'measured_manual';

// A piece a person clicked (Phase 8) is a person's own count: it is never grouped with the labels of
// a line, so a click on a line that already has a suggestion adds its own piece.
const counts = (m: MemberView): boolean =>
  !m.deleted &&
  m.merged_into === null &&
  m.not_member === null &&
  m.link.line !== null &&
  m.count.source !== 'human_click' &&
  m.count.state !== 'rejected';

/** Fills `shared_line` on every member and downgrades unresolved members to amber. In place. */
export function annotateSharedLines(members: MemberView[]): MemberView[] {
  const groups = new Map<string, { m: MemberView; order: number }[]>();
  members.forEach((m, order) => {
    m.shared_line = null;
    m.length_shared = false;
    if (!counts(m)) return;
    const k = lineKey(m.sheet_id, m.link.line as Line);
    const list = groups.get(k) ?? [];
    list.push({ m, order });
    groups.set(k, list);
  });
  for (const [group, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => before(rank(a.m, a.order), rank(b.m, b.order)));
    const resolved = list.every((x) => x.m.shared_resolution === 'separate');
    // the piece of the line: the best member that is not red (a red one is held out of the main total,
    // so it must not take the piece of a line that has a usable label); all red: the best one
    // (existing steel is listed apart and never carries the piece of a line with a new label)
    const carrier = (
      sorted.find((e) => e.m.status.color !== 'red' && !e.m.existing) ??
      sorted.find((e) => !e.m.existing) ??
      sorted[0]
    ).m;
    sorted.forEach(({ m }, i) => {
      // a duplicate of a better-ranked member of this line, unless a person said "separate"
      const twin =
        m.shared_resolution === 'separate'
          ? undefined
          : sorted.slice(0, i).find((e) => looksLikeSameLabel(e.m, m));
      m.shared_line = {
        group,
        size: list.length,
        best: i === 0,
        line_piece:
          m === carrier ||
          m.shared_resolution === 'separate' ||
          isTypedLength(m.length_source) ||
          m.count.state === 'confirmed',
        resolution: m.shared_resolution,
        resolved,
        duplicate_of: twin ? twin.m.id : null,
      };
      if (!resolved) m.status = withSharedLine(m.status);
    });
  }
  for (const m of members) {
    // the whole line is not this member's length, unless a person typed the length
    m.length_shared = m.shared_line !== null && !isTypedLength(m.length_source);
  }
  return members;
}

/**
 * Pieces this member adds on the display basis (one piece per linked line): its quantity, except a
 * label on a line that already has its piece, which adds 0. A member alone on its line counts fully.
 */
export function pieceQuantity(m: MemberView): number {
  return m.shared_line !== null && !m.shared_line.line_piece ? 0 : m.quantity;
}

/** A true duplicate candidate: held out of the main total until a person decides. */
export function isPossibleDuplicate(m: MemberView): boolean {
  return m.shared_line !== null && m.shared_line.duplicate_of !== null;
}

function profileKey(m: MemberView): string | null {
  if (m.type === 'joist') return m.joist_series?.canonical ?? null;
  return m.profile ?? null;
}

/** The text height of a label: the thin side of its box. */
function labelHeight(m: MemberView): number {
  const b = m.bbox;
  return b ? Math.min(b.x1 - b.x0, b.y1 - b.y0) : 0;
}

/** Same canonical profile, and the two label boxes overlap or are closer than 2 label heights. */
export function looksLikeSameLabel(a: MemberView, b: MemberView): boolean {
  const ka = profileKey(a);
  if (ka === null || ka !== profileKey(b) || !a.bbox || !b.bbox) return false;
  const gapX = Math.max(0, a.bbox.x0 - b.bbox.x1, b.bbox.x0 - a.bbox.x1);
  const gapY = Math.max(0, a.bbox.y0 - b.bbox.y1, b.bbox.y0 - a.bbox.y1);
  const height = Math.max(labelHeight(a), labelHeight(b));
  return Math.hypot(gapX, gapY) < DUPLICATE_LABEL_HEIGHTS * height || (gapX === 0 && gapY === 0);
}

/** The other members of a member's group, best first. */
export function groupOf(target: MemberView, all: MemberView[]): MemberView[] {
  if (!target.shared_line) return [];
  const g = target.shared_line.group;
  return all
    .filter((m) => m.shared_line?.group === g)
    .sort((a, b) => Number(b.shared_line?.best) - Number(a.shared_line?.best));
}
