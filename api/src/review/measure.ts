// The two-click measure tool (Phase 8 Part C): scale conversion, which view's scale applies, and the
// snapped end points. Pure. A length is real millimetres = drawn points x (25.4 / 72) x scale ratio,
// where the ratio is real / drawn (96 for 1/8" = 1'-0", 100 for 1:100); feet-inches is for display.
import type { ViewBox } from '../db/types.js';
import { mmToFeetInches } from '../units/index.js';
import { lengthMm, type Point } from './geometry.js';
import { snapPoint, type LineRow, type SnappedPoint } from './snap.js';

export const DEFAULT_MEASURE_SNAP_PT = 12;

export interface ScaledView {
  id: string;
  box: ViewBox;
  scale_ratio: number | null;
  scale_confirmed: boolean;
}

export interface Measured {
  a: Point;
  b: Point;
  a_snap: SnappedPoint | null;
  b_snap: SnappedPoint | null;
  scale_ratio: number;
  view_id: string;
  length_mm: number;
  length_ft_in: string;
}

const inBox = (box: ViewBox, p: Point): boolean =>
  p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;

/**
 * The view whose CONFIRMED scale applies to the measurement: the requested one, else the first view
 * whose box holds both points. A guessed scale is not used (the page's confirmed scale only).
 */
export function scaleViewFor(
  views: readonly ScaledView[],
  a: Point,
  b: Point,
  requested?: string,
): ScaledView | null {
  const ok = (v: ScaledView) => v.scale_confirmed && v.scale_ratio !== null && v.scale_ratio > 0;
  if (requested) {
    const v = views.find((x) => x.id === requested);
    return v && ok(v) ? v : null;
  }
  return views.find((v) => ok(v) && inBox(v.box, a) && inBox(v.box, b)) ?? null;
}

/** Snap a click to the nearest line end point or intersection within `radius`; the raw click if none. */
export function snapClick(
  lines: readonly LineRow[],
  p: Point,
  radius: number,
): { point: Point; snap: SnappedPoint | null } {
  const snap = snapPoint(lines, p.x, p.y, radius);
  return { point: snap ? { x: snap.x, y: snap.y } : p, snap };
}

export function measureTwoClicks(
  lines: readonly LineRow[],
  a: Point,
  b: Point,
  view: ScaledView,
  radius = DEFAULT_MEASURE_SNAP_PT,
): Measured {
  const sa = snapClick(lines, a, radius);
  const sb = snapClick(lines, b, radius);
  const ratio = view.scale_ratio as number;
  const mm = Math.round(lengthMm(sa.point, sb.point, ratio) * 10) / 10;
  return {
    a: sa.point,
    b: sb.point,
    a_snap: sa.snap,
    b_snap: sb.snap,
    scale_ratio: ratio,
    view_id: view.id,
    length_mm: mm,
    length_ft_in: mmToFeetInches(mm),
  };
}
