// Page geometry for the viewer. Everything is in DISPLAYED page points (rotation applied, origin
// top-left, y down), the same space the worker and the API use. Internal lengths are mm.

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MM_PER_PT = 25.4 / 72;
export const MM_PER_INCH = 25.4;

/** Real length in mm of a drawn length in points at a drawing scale (real / drawn). */
export function realMm(drawnPt: number, scaleRatio: number): number {
  return drawnPt * MM_PER_PT * scaleRatio;
}

export function lengthMm(p: Pt, q: Pt, scaleRatio: number): number {
  return realMm(Math.hypot(q.x - p.x, q.y - p.y), scaleRatio);
}

export function normaliseBox(a: Pt, b: Pt): Box {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

export function boxWidth(b: Box): number {
  return b.x1 - b.x0;
}

export function boxHeight(b: Box): number {
  return b.y1 - b.y0;
}

/**
 * Page point under a pointer. `rect` is the on-screen rectangle of the page (CSS pixels) and
 * `pageW` x `pageH` the displayed page size in points; the page fills the rectangle exactly.
 */
export function clientToPage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  pageW: number,
  pageH: number,
): Pt {
  return {
    x: ((clientX - rect.left) / rect.width) * pageW,
    y: ((clientY - rect.top) / rect.height) * pageH,
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Millimetres as feet-inches to the nearest 1/16 inch: 3810 -> 12'-6", 304.8 -> 1'-0". */
export function mmToFeetInches(mm: number, denominator = 16): string {
  if (!Number.isFinite(mm)) return "";
  const negative = mm < 0;
  const units = Math.round((Math.abs(mm) / MM_PER_INCH) * denominator);
  const perFoot = 12 * denominator;
  const feet = Math.floor(units / perFoot);
  const rest = units - feet * perFoot;
  const inches = Math.floor(rest / denominator);
  const numerator = rest % denominator;
  let inchText = `${inches}`;
  if (numerator !== 0) {
    const g = gcd(numerator, denominator);
    const fraction = `${numerator / g}/${denominator / g}`;
    inchText = inches === 0 ? fraction : `${inches} ${fraction}`;
  }
  return `${negative && units !== 0 ? "-" : ""}${feet}'-${inchText}"`;
}

/** Zoom that makes a page of the given width fit a container width (with a little margin). */
export function fitZoom(pageW: number, containerW: number): number {
  return Math.max(0.05, (containerW - 16) / pageW);
}
