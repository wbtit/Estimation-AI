// Geometry and scale helpers for the review screen. Everything is in DISPLAYED page points
// (page rotation already applied, origin top-left, y down), which is what the viewer and the
// worker both use. Internal lengths are millimetres.
import type { ViewBox } from '../db/types.js';

export const MM_PER_PT = 25.4 / 72;
export const MIN_VIEW_SIZE_PT = 20;
export const SCALE_NEAR_MAX_PT = 150;
const AMBIGUITY_RATIO = 1.2; // a second, different scale this close counts as ambiguous

export interface Point {
  x: number;
  y: number;
}

/** Real length in mm of a drawn length in points at a drawing scale (real / drawn). */
export function realMm(drawnPt: number, scaleRatio: number): number {
  return drawnPt * MM_PER_PT * scaleRatio;
}

export function lengthMm(p: Point, q: Point, scaleRatio: number): number {
  return realMm(Math.hypot(q.x - p.x, q.y - p.y), scaleRatio);
}

/** Plan frame of a view: origin at the lower-left of the box, x right, y up, millimetres. */
export function planXY(box: ViewBox, scaleRatio: number, p: Point): [number, number] {
  const k = MM_PER_PT * scaleRatio;
  return [(p.x - box.x0) * k, (box.y1 - p.y) * k];
}

export function planFrameOf(box: ViewBox): { origin_pt: [number, number]; y_up: true } {
  return { origin_pt: [box.x0, box.y1], y_up: true };
}

export function boxContains(box: ViewBox, p: Point): boolean {
  return p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
}

export function boxCenter(b: ViewBox): Point {
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

/** Distance in points from a box to another box (0 when they overlap). */
export function boxDistance(a: ViewBox, b: ViewBox): number {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
  const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
  return Math.hypot(dx, dy);
}

export function normaliseBox(b: ViewBox): ViewBox {
  return {
    x0: Math.min(b.x0, b.x1),
    y0: Math.min(b.y0, b.y1),
    x1: Math.max(b.x0, b.x1),
    y1: Math.max(b.y0, b.y1),
  };
}

/** Null if the box is usable on a page of the given size (small tolerance), else the reason. */
export function boxProblem(b: ViewBox, pageW: number, pageH: number): string | null {
  const n = normaliseBox(b);
  if (![n.x0, n.y0, n.x1, n.y1].every(Number.isFinite)) return 'the box has a non-numeric corner';
  if (n.x1 - n.x0 < MIN_VIEW_SIZE_PT || n.y1 - n.y0 < MIN_VIEW_SIZE_PT) {
    return `the box must be at least ${MIN_VIEW_SIZE_PT} pt on each side`;
  }
  const tol = 2;
  if (n.x0 < -tol || n.y0 < -tol || n.x1 > pageW + tol || n.y1 > pageH + tol) {
    return 'the box must lie on the page';
  }
  return null;
}

/**
 * "Whole sheet" view box. There is NO reliable rule for where the title block is (the sheet-number
 * finder only knows a bottom-right corner and a far-right strip, and the study documents differ), so
 * the box is a fixed margin: 2.5% of the page on every side for the sheet border, and the far-right
 * 14% of the width left out for a title block strip. A title block along the bottom is NOT
 * excluded; the person can adjust the box or draw one instead. Documented in docs/PHASE5B_PLAN.md.
 */
export const WHOLE_SHEET_BORDER_FRACTION = 0.025;
export const WHOLE_SHEET_TITLE_STRIP_FRACTION = 0.14;

export function wholeSheetBox(pageW: number, pageH: number): ViewBox {
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    x0: round(pageW * WHOLE_SHEET_BORDER_FRACTION),
    y0: round(pageH * WHOLE_SHEET_BORDER_FRACTION),
    x1: round(pageW * (1 - WHOLE_SHEET_TITLE_STRIP_FRACTION)),
    y1: round(pageH * (1 - WHOLE_SHEET_BORDER_FRACTION)),
  };
}

/** The sheet's only scale, when the scan found exactly one distinct scale expression with a ratio. */
export function singleSheetScale(
  scales: { raw: string; kind: string; ratio: number | null; count?: number }[],
): { raw: string; ratio: number } | null {
  if (scales.length !== 1) return null;
  const s = scales[0];
  return s.kind === 'ratio' && s.ratio !== null && s.ratio > 0
    ? { raw: s.raw, ratio: s.ratio }
    : null;
}

export interface ScaleItem {
  bbox: ViewBox;
  raw: string;
  ratio: number | null;
}

export interface ScaleSuggestion {
  ratio: number;
  raw: string;
  where: 'inside' | 'near' | 'sheet';
  distance_pt: number;
  /** Other different scales found inside or near the box, nearest first. */
  alternatives: { raw: string; ratio: number; distance_pt: number }[];
  /** True when another, different scale is as close as the suggested one (the user must choose). */
  ambiguous: boolean;
}

/**
 * Scale suggested for a view: scale text inside the box, else the nearest scale text within
 * SCALE_NEAR_MAX_PT of it. Items without a numeric ratio (NTS) are never suggested.
 */
export function suggestScale(box: ViewBox, items: ScaleItem[]): ScaleSuggestion | null {
  const usable = items
    .filter((i): i is ScaleItem & { ratio: number } => i.ratio !== null && i.ratio > 0)
    .map((i) => {
      const c = boxCenter(i.bbox);
      const inside = boxContains(box, c);
      return {
        raw: i.raw,
        ratio: i.ratio,
        inside,
        distance: inside ? 0 : boxDistance(box, i.bbox),
      };
    })
    .filter((i) => i.inside || i.distance <= SCALE_NEAR_MAX_PT);
  if (usable.length === 0) return null;
  const inside = usable.filter((i) => i.inside);
  const pool = inside.length > 0 ? inside : usable;
  // nearest first; among inside items prefer the one lowest on the page (view scales sit under the view)
  const ordered = [...pool].sort((a, b) => a.distance - b.distance);
  const best = ordered[0];
  const others = usable
    .filter((i) => i.ratio !== best.ratio)
    .sort((a, b) => a.distance - b.distance)
    .map((i) => ({ raw: i.raw, ratio: i.ratio, distance_pt: Math.round(i.distance * 10) / 10 }));
  const ambiguous =
    inside.length > 0
      ? inside.some((i) => i.ratio !== best.ratio)
      : others.length > 0 && others[0].distance_pt <= best.distance * AMBIGUITY_RATIO + 1;
  return {
    ratio: best.ratio,
    raw: best.raw,
    where: best.inside ? 'inside' : 'near',
    distance_pt: Math.round(best.distance * 10) / 10,
    alternatives: others,
    ambiguous,
  };
}
