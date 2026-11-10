// Phase 14b/14c Find similar (worker src/build/col_symbols.py, docs/PHASE14B_PREREGISTRATION.md 2b,
// PHASE14B2 and PHASE14C): from a column a person drew (or a confirmed example), the stored candidate
// symbols of the page (page_symbols) with the same family and real size become columns of the same
// kind. A drawn column is always a click, so a solid shape under it is an example too (14c 2.3):
// it matches only the same solid shape and size. Pure; the same rule as the worker's `same_kind`
// (shared cases: fixtures/synthetic).

import { SNAP_RADIUS_PT, UNKNOWN_SQUARE, unknownSquares } from './column-snap.js';

/** The five column symbol families (worker col_symbols.FIVE_FAMILIES), in palette order. */
export const SYMBOL_FAMILIES = [
  'w_shape',
  'w_cover_plates',
  'hss_square',
  'hss_rect',
  'hss_round',
] as const;

export const SIZE_TOL_IN = 1.0;
export const SIZE_TOL_SHARE = 0.15;
/** A drawn column's symbol: the stored symbol whose centre is within this of the column
 * (Phase 0-14g: the one snap radius, schema/column-snap.json, as the web snap and the worker). */
export const CLICK_PT = SNAP_RADIUS_PT;
/** A symbol this close to an existing column is that column (not a new match). */
export const TAKEN_PT = 12.0;

export interface StoredSymbol {
  family: string;
  box: [number, number, number, number];
  centre: [number, number];
  rotation_deg: number;
  real_in: [number, number]; // [short, long]
  solid?: 'square' | 'rect' | 'round' | null; // 14c: a solid shape (family 'unknown')
  square45?: boolean; // Phase 0-column-capture: an unknown 45 degree square (set by the example lookup)
}

type Kind = Pick<StoredSymbol, 'family' | 'real_in' | 'solid'>;

export function sameSize(a: [number, number], b: [number, number]): boolean {
  return a.every((x, k) => Math.abs(x - b[k]!) <= Math.max(SIZE_TOL_IN, SIZE_TOL_SHARE * b[k]!));
}

/** `s` matches the example `e`: the same known family and real size (either orientation); with
 * `solid` (a clicked solid example) the same solid shape and real size. */
export function sameKind(s: Kind, e: Kind, solid = false): boolean {
  if (solid && e.solid) return s.solid === e.solid && sameSize(s.real_in, e.real_in);
  if (s.family !== e.family || s.family === 'unknown') return false;
  return sameSize(s.real_in, e.real_in);
}

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

function nearest(
  point: [number, number],
  symbols: readonly StoredSymbol[],
  ok: (s: StoredSymbol) => boolean,
): StoredSymbol | null {
  let best: { d: number; k: number } | null = null;
  symbols.forEach((s, k) => {
    if (!ok(s)) return;
    const d = dist(point, s.centre);
    if (d <= CLICK_PT && (!best || d < best.d || (d === best.d && k < best.k))) best = { d, k };
  });
  return best === null ? null : symbols[(best as { k: number }).k]!;
}

/** The click is inside the symbol's box plus the shared margin (an unknown square must be under the click). */
function insideBox(p: readonly number[], b: readonly number[], ratio: number): boolean {
  const m = (UNKNOWN_SQUARE.click_margin_in * 72) / ratio; // real inches -> page points
  return p[0]! >= b[0]! - m && p[0]! <= b[2]! + m && p[1]! >= b[1]! - m && p[1]! <= b[3]! + m;
}

/** The stored symbol under a drawn column: the nearest known-family centre within CLICK_PT, else
 * the nearest solid shape within CLICK_PT. */
export function symbolAt(
  point: [number, number],
  symbols: readonly StoredSymbol[],
  ratio: number,
): StoredSymbol | null {
  // Phase 0-column-capture: an unknown 45 degree square (a plate / pier) is the third kind of target
  const square = unknownSquares(symbols);
  return (
    nearest(point, symbols, (s) => s.family !== 'unknown') ??
    nearest(point, symbols, (s) => !!s.solid) ??
    nearest(
      point,
      symbols,
      (s) => square[symbols.indexOf(s)] === true && insideBox(point, s.box, ratio),
    )
  );
}

/** What the preview names: the family, or "solid_<shape>" for a solid example. */
export function exampleName(e: StoredSymbol): string {
  if (e.family === 'unknown' && e.square45) return 'square_45';
  return e.family === 'unknown' && e.solid ? `solid_${e.solid}` : e.family;
}

/** The symbols matching the example that are not already a column, in (y, x) order. */
export function findSimilar(
  example: StoredSymbol,
  symbols: readonly StoredSymbol[],
  columns: readonly [number, number][],
): StoredSymbol[] {
  const square = unknownSquares(symbols);
  const exSquare = example.square45 === true;
  return symbols
    .filter(
      (s, i) =>
        s !== example &&
        (exSquare
          ? square[i] === true && sameSize(s.real_in, example.real_in)
          : sameKind(s, example, true)) &&
        !columns.some((c) => dist(c, s.centre) <= TAKEN_PT),
    )
    .sort((a, b) => a.centre[1] - b.centre[1] || a.centre[0] - b.centre[0]);
}
