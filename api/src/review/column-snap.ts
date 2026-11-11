// Phase 0-14g: the Draw column snap radius, ONE value shared with the web (sent by GET .../column-
// symbols) and the worker (col_image.SNAP_RADIUS_PT): schema/column-snap.json at the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../schema/column-snap.json',
);

interface SharedConstants {
  snap_radius_pt: unknown;
  unknown_square?: {
    aspect_tol: number;
    side_in: [number, number];
    turn_deg: number;
    turn_tol_deg: number;
    click_margin_in: number;
  };
}
const shared = JSON.parse(fs.readFileSync(file, 'utf8')) as SharedConstants;

/** Page points: a stored symbol this close to a click is the column's symbol. */
export const SNAP_RADIUS_PT: number = (() => {
  const v = shared.snap_radius_pt;
  if (typeof v !== 'number' || !(v > 0)) throw new Error(`${file}: snap_radius_pt must be > 0`);
  return v;
})();

/** Phase 0-column-capture: the DEFINED rule for a 45 degree square symbol of family 'unknown' as a
 * capture target (pre-registered; the same numbers as the worker's col_image.unknown_squares). */
export const UNKNOWN_SQUARE = (() => {
  const u = shared.unknown_square;
  if (!u) throw new Error(`${file}: unknown_square is missing`);
  return u;
})();

interface SquareCandidate {
  family: string;
  solid?: string | null;
  box: number[];
  centre: number[];
  rotation_deg: number;
  real_in: number[];
}

/** Which symbols are unknown 45 degree squares: family unknown without a solid flag, real sides within
 * the aspect tolerance, a real side inside the size range, turned turn_deg +/- turn_tol_deg (mod 90),
 * and no known-family symbol centre inside its box. */
export function unknownSquares(symbols: readonly SquareCandidate[]): boolean[] {
  const known = symbols.filter((s) => s.family !== 'unknown');
  const u = UNKNOWN_SQUARE;
  return symbols.map((s) => {
    if (s.family !== 'unknown' || s.solid) return false;
    const short = Math.min(s.real_in[0]!, s.real_in[1]!);
    const long = Math.max(s.real_in[0]!, s.real_in[1]!);
    if (long <= 0 || (long - short) / long > u.aspect_tol) return false;
    if (short < u.side_in[0] || long > u.side_in[1]) return false;
    const turn = ((s.rotation_deg % 90) + 90) % 90;
    if (Math.abs(turn - u.turn_deg) > u.turn_tol_deg) return false;
    return !known.some(
      (k) =>
        k.centre[0]! >= s.box[0]! &&
        k.centre[0]! <= s.box[2]! &&
        k.centre[1]! >= s.box[1]! &&
        k.centre[1]! <= s.box[3]!,
    );
  });
}

/** How a column placement was snapped (logged with the placement). */
export const SNAP_SOURCES = ['symbol', 'ink', 'line', 'none', 'shift_off'] as const;
export type SnapSource = (typeof SNAP_SOURCES)[number];
