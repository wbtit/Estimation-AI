// Members that share the same chosen line (Phase 5b item 1). One drawn line often carries several
// labels (a long line with a beam label for each of several beams), and the takeoff counts members,
// so a shared line is flagged for a person to decide. Nothing is merged or deleted automatically:
// the best-scoring member stays in the main takeoff total, the others are held out as "possible
// duplicates" until a person says "separate members" or merges them (both are edits with undo).
import type { MemberView, Line } from './members.js';
import { withSharedLine } from './status.js';

export interface SharedLine {
  /** Same for every member of the group. */
  group: string;
  /** Members in the group (merged, deleted and not-a-member ones do not count). */
  size: number;
  /** The best-scoring member of the group: the one that stays in the main total. */
  best: boolean;
  /** What a person decided for this member. */
  resolution: 'separate' | null;
  /** The whole group is resolved (every member is "separate"). Nothing is flagged then. */
  resolved: boolean;
}

const CONF_RANK = { high: 0, medium: 1, low: 2 } as const;

/** A key for a line that does not depend on which end is first. */
export function lineKey(sheetId: string | null, line: Line): string {
  const a: [number, number] = [Math.round(line.p[0]), Math.round(line.p[1])];
  const b: [number, number] = [Math.round(line.q[0]), Math.round(line.q[1])];
  const [lo, hi] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  return `${sheetId ?? ''}|${lo[0]},${lo[1]}|${hi[0]},${hi[1]}`;
}

/** Lower is better: a person's own link first, then the rule's confidence class, then its score. */
function rank(m: MemberView, order: number): [number, number, number, number] {
  const chosen = m.link.candidates.find((c) => c.rank === m.link.chosen_rank);
  return [
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

const counts = (m: MemberView): boolean =>
  !m.deleted && m.merged_into === null && m.not_member === null && m.link.line !== null;

/** Fills `shared_line` on every member and downgrades unresolved members to amber. In place. */
export function annotateSharedLines(members: MemberView[]): MemberView[] {
  const groups = new Map<string, { m: MemberView; order: number }[]>();
  members.forEach((m, order) => {
    m.shared_line = null;
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
    for (const { m } of list) {
      m.shared_line = {
        group,
        size: list.length,
        best: m === sorted[0].m,
        resolution: m.shared_resolution,
        resolved,
      };
      if (!resolved) m.status = withSharedLine(m.status);
    }
  }
  return members;
}

/** Members that are held out of the main total until a person decides (not the best of the group). */
export function isPossibleDuplicate(m: MemberView): boolean {
  return m.shared_line !== null && !m.shared_line.resolved && !m.shared_line.best;
}

/** The other members of a member's group, best first. */
export function groupOf(target: MemberView, all: MemberView[]): MemberView[] {
  if (!target.shared_line) return [];
  const g = target.shared_line.group;
  return all
    .filter((m) => m.shared_line?.group === g)
    .sort((a, b) => Number(b.shared_line?.best) - Number(a.shared_line?.best));
}
