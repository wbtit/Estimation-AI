// Phase 0 column capture: the page's grid crossings, for the amber "off the grid crossing" flag.
// Only where a grid was detected on the page (at least one crossing); a column is never moved to a
// crossing, only flagged when its centre is more than OFFGRID_IN (real inches) from every one. Pure.
import { OFFGRID_IN } from "./orientation";

export type Pt2 = [number, number];
export interface GridSeg {
  a: Pt2;
  b: Pt2;
}

/** A grid line runs this far (pt) past its end points when the crossing is taken (its bubble). */
const SLACK_PT = 6;
/** Two grid lines closer than this (degrees) to parallel never cross. */
const MIN_ANGLE_DEG = 20;

/** Every crossing of two grid lines (their segments, with a little slack at the ends). */
export function crossings(grid: readonly GridSeg[]): Pt2[] {
  const out: Pt2[] = [];
  for (let i = 0; i < grid.length; i++)
    for (let j = i + 1; j < grid.length; j++) {
      const p = grid[i]!;
      const q = grid[j]!;
      const px = p.b[0] - p.a[0];
      const py = p.b[1] - p.a[1];
      const qx = q.b[0] - q.a[0];
      const qy = q.b[1] - q.a[1];
      const pl = Math.hypot(px, py);
      const ql = Math.hypot(qx, qy);
      if (pl < 1e-6 || ql < 1e-6) continue;
      const den = px * qy - py * qx;
      if (Math.abs(den) / (pl * ql) < Math.sin((MIN_ANGLE_DEG * Math.PI) / 180))
        continue;
      const t = ((q.a[0] - p.a[0]) * qy - (q.a[1] - p.a[1]) * qx) / den;
      const u = ((q.a[0] - p.a[0]) * py - (q.a[1] - p.a[1]) * px) / den;
      if (t * pl < -SLACK_PT || t * pl > pl + SLACK_PT) continue;
      if (u * ql < -SLACK_PT || u * ql > ql + SLACK_PT) continue;
      out.push([p.a[0] + t * px, p.a[1] + t * py]);
    }
  return out;
}

/** True when a grid was detected AND the centre is more than OFFGRID_IN from every crossing. */
export function offGrid(
  centre: Pt2,
  cross: readonly Pt2[],
  ratio: number,
): boolean {
  if (cross.length === 0) return false; // no grid on the page: nothing to be off
  const tol = OFFGRID_IN * (72 / ratio);
  return cross.every(
    (c) => Math.hypot(c[0] - centre[0], c[1] - centre[1]) > tol,
  );
}
