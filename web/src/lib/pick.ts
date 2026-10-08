// Picking the line under a click, and choosing the next member to look at. Pure helpers.

export type Seg = [number, number, number, number];

/** Distance in points from a point to a segment. */
export function pointSegmentDistance(px: number, py: number, s: Seg): number {
  const [x0, y0, x1, y1] = s;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** The line nearest to the click within `tolerance` points, or null. */
export function nearestLine(
  px: number,
  py: number,
  lines: Seg[],
  tolerance: number,
): Seg | null {
  let best: Seg | null = null;
  let bestD = tolerance;
  for (const s of lines) {
    const d = pointSegmentDistance(px, py, s);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

const ORDER: Record<string, number> = { red: 0, amber: 1, green: 2 };

/** The id of the next member that still needs a look: red first, then amber, not yet confirmed; wraps around. */
export function nextToReview<
  T extends {
    id: string;
    deleted: boolean;
    status: { color: string; confirmed: boolean };
    merged_into?: string | null;
    not_member?: unknown;
  },
>(members: T[], currentId: string | null): string | null {
  const open = members.filter(
    (m) =>
      !m.deleted &&
      !m.merged_into &&
      !m.not_member &&
      !m.status.confirmed &&
      m.status.color !== "green" &&
      m.status.color !== "unlinked",
  );
  if (open.length === 0) return null;
  const ranked = [...open].sort(
    (a, b) => ORDER[a.status.color] - ORDER[b.status.color],
  );
  const i = ranked.findIndex((m) => m.id === currentId);
  return ranked[(i + 1) % ranked.length].id;
}
