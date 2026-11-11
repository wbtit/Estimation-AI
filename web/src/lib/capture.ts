// Phase 0-column-capture: the capture box shown after a column is clicked. The default is TIGHT around
// the symbol (a large box pulls beams and grids into the example: the 14g bug); eight handles and the
// body resize and move it; Find similar searches EXACTLY the box shown. Pure.
import { dragHandle, handleAt, type Box4, type BoxHandle } from "./tools";

export type CaptureBox = Box4;
export const MIN_CAPTURE_PT = 2;
/** The margin added around a symbol's own box (the template margin of Phase 14d). */
export const CAPTURE_MARGIN = 0.1;

export const toArray = (b: Box4): [number, number, number, number] => [
  b.x0,
  b.y0,
  b.x1,
  b.y1,
];
export const fromArray = (a: readonly number[]): Box4 => ({
  x0: a[0]!,
  y0: a[1]!,
  x1: a[2]!,
  y1: a[3]!,
});

/** The tight default: the symbol's box plus a small margin (at least 1 pt). */
export function tightBox(box: readonly number[]): Box4 {
  const w = box[2]! - box[0]!;
  const h = box[3]! - box[1]!;
  const m = Math.max(1, CAPTURE_MARGIN * Math.max(w, h));
  return { x0: box[0]! - m, y0: box[1]! - m, x1: box[2]! + m, y1: box[3]! + m };
}

/** A square box of `sidePt` around a point (when nothing of the drawing is known there). */
export function boxAround(p: [number, number], sidePt: number): Box4 {
  return {
    x0: p[0] - sidePt / 2,
    y0: p[1] - sidePt / 2,
    x1: p[0] + sidePt / 2,
    y1: p[1] + sidePt / 2,
  };
}

export type CaptureDrag = BoxHandle | "move";

/** What a pointer at `p` would drag: a handle (within `tol`), the body, or nothing. */
export function captureHit(
  b: Box4,
  p: [number, number],
  tol: number,
): CaptureDrag | null {
  const h = handleAt(b, p, tol);
  if (h) return h;
  return p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1
    ? "move"
    : null;
}

/** The box after a drag of (dx, dy) page points from `start`. */
export function dragCapture(
  start: Box4,
  how: CaptureDrag,
  dx: number,
  dy: number,
  page: { w: number; h: number },
): Box4 {
  if (how !== "move")
    return dragHandle(start, how, dx, dy, page, MIN_CAPTURE_PT);
  const w = start.x1 - start.x0;
  const h = start.y1 - start.y0;
  const x0 = Math.max(0, Math.min(start.x0 + dx, page.w - w));
  const y0 = Math.max(0, Math.min(start.y0 + dy, page.h - h));
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

export const sameBox = (a: Box4, b: Box4, eps = 0.01) =>
  Math.abs(a.x0 - b.x0) < eps &&
  Math.abs(a.y0 - b.y0) < eps &&
  Math.abs(a.x1 - b.x1) < eps &&
  Math.abs(a.y1 - b.y1) < eps;
