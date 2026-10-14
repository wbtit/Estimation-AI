// Scale conversion and display of a two-click measurement (Phase 8 Part C). Real millimetres =
// drawn points x (25.4 / 72) x scale ratio (real / drawn: 96 for 1/8" = 1'-0", 100 for 1:100).
// The API computes the stored value; this copy shows the preview before the click is confirmed.
export const MM_PER_PT = 25.4 / 72;
const MM_PER_INCH = 25.4;

export interface Pt {
  x: number;
  y: number;
}

export function lengthMm(a: Pt, b: Pt, scaleRatio: number): number {
  return Math.hypot(b.x - a.x, b.y - a.y) * MM_PER_PT * scaleRatio;
}

/** 10 000 mm -> `32'-9 11/16"` (sixteenths, like the API's display). */
export function feetInches(mm: number, denominator = 16): string {
  const totalSixteenths = Math.round((mm / MM_PER_INCH) * denominator);
  const inchesTotal = totalSixteenths / denominator;
  let feet = Math.floor(inchesTotal / 12 + 1e-9);
  let rest = totalSixteenths - feet * 12 * denominator;
  if (rest >= 12 * denominator) {
    feet += 1;
    rest -= 12 * denominator;
  }
  const whole = Math.floor(rest / denominator);
  let frac = rest - whole * denominator;
  let den = denominator;
  while (frac > 0 && frac % 2 === 0) {
    frac /= 2;
    den /= 2;
  }
  const fraction = frac > 0 ? ` ${frac}/${den}` : "";
  return `${feet}'-${whole}${fraction}"`;
}

/** Metric display: `3 528 mm (3.53 m)`. */
export function metric(mm: number): string {
  return `${Math.round(mm).toLocaleString("en-US").replace(/,/g, " ")} mm (${(mm / 1000).toFixed(2)} m)`;
}
