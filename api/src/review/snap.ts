// Snapping of a click to the extracted lines of a sheet (Phase 8). Lines are rows
// [x0, y0, x1, y1, class_index, width] in displayed page points, of ANY class (the sheet_lines
// table). Pure and deterministic; the web has a copy of the same algorithm
// (web/src/lib/snap.ts) and both run the same cases (fixtures/synthetic/snap-cases.json).

export type LineRow = readonly number[];

export interface NearestLine {
  index: number;
  distance: number;
}

export interface SnappedPoint {
  x: number;
  y: number;
  kind: 'endpoint' | 'intersection';
  distance: number;
}

export function pointSegmentDistance(px: number, py: number, l: LineRow): number {
  const [x0, y0, x1, y1] = l as [number, number, number, number];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

const lengthOf = (l: LineRow): number => Math.hypot(l[2] - l[0], l[3] - l[1]);

/**
 * The extracted line nearest to the click within `radius`, of any class. A tie (within 1e-9) goes to
 * the longer line, then the lower index.
 */
export function nearestLine(
  lines: readonly LineRow[],
  x: number,
  y: number,
  radius: number,
): NearestLine | null {
  let best: NearestLine | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] as LineRow;
    if (
      x < Math.min(l[0], l[2]) - radius ||
      x > Math.max(l[0], l[2]) + radius ||
      y < Math.min(l[1], l[3]) - radius ||
      y > Math.max(l[1], l[3]) + radius
    ) {
      continue;
    }
    const d = pointSegmentDistance(x, y, l);
    if (d > radius) continue;
    if (
      best === null ||
      d < best.distance - 1e-9 ||
      (Math.abs(d - best.distance) <= 1e-9 &&
        lengthOf(l) > lengthOf(lines[best.index] as LineRow) + 1e-9)
    ) {
      best = { index: i, distance: d };
    }
  }
  return best;
}

/** Intersection point of two segments (touching counts), or null when parallel or apart. */
export function segmentIntersection(a: LineRow, b: LineRow): [number, number] | null {
  const ax = a[2] - a[0];
  const ay = a[3] - a[1];
  const bx = b[2] - b[0];
  const by = b[3] - b[1];
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b[0] - a[0]) * by - (b[1] - a[1]) * bx) / den;
  const u = ((b[0] - a[0]) * ay - (b[1] - a[1]) * ax) / den;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [a[0] + t * ax, a[1] + t * ay];
}

const MAX_NEAR_LINES = 60;

/**
 * The nearest line endpoint or intersection of two lines within `radius` of the click (the measure
 * tool snaps to it, and shows it before the click is confirmed). At equal distance an endpoint is
 * preferred to an intersection.
 */
export function snapPoint(
  lines: readonly LineRow[],
  x: number,
  y: number,
  radius: number,
): SnappedPoint | null {
  const near: { i: number; d: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] as LineRow;
    if (
      x < Math.min(l[0], l[2]) - radius ||
      x > Math.max(l[0], l[2]) + radius ||
      y < Math.min(l[1], l[3]) - radius ||
      y > Math.max(l[1], l[3]) + radius
    ) {
      continue;
    }
    const d = pointSegmentDistance(x, y, l);
    if (d <= radius) near.push({ i, d });
  }
  near.sort((a, b) => a.d - b.d || a.i - b.i);
  const use = near.slice(0, MAX_NEAR_LINES);
  const cands: SnappedPoint[] = [];
  for (const { i } of use) {
    const l = lines[i] as LineRow;
    for (const [px, py] of [
      [l[0], l[1]],
      [l[2], l[3]],
    ] as const) {
      const d = Math.hypot(px - x, py - y);
      if (d <= radius) cands.push({ x: px, y: py, kind: 'endpoint', distance: d });
    }
  }
  for (let a = 0; a < use.length; a += 1) {
    for (let b = a + 1; b < use.length; b += 1) {
      const p = segmentIntersection(
        lines[(use[a] as { i: number }).i] as LineRow,
        lines[(use[b] as { i: number }).i] as LineRow,
      );
      if (!p) continue;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d <= radius) cands.push({ x: p[0], y: p[1], kind: 'intersection', distance: d });
    }
  }
  if (cands.length === 0) return null;
  cands.sort(
    (p, q) =>
      p.distance - q.distance ||
      (p.kind === q.kind ? 0 : p.kind === 'endpoint' ? -1 : 1) ||
      p.x - q.x ||
      p.y - q.y,
  );
  return cands[0] as SnappedPoint;
}
