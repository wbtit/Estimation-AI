export const MM_PER_PT = 25.4 / 72; // a second, different scale this close counts as ambiguous

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
