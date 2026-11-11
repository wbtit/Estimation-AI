// Phase 0-14g: Draw column lands on the symbol. The page's stored candidate symbols (GET
// .../column-symbols) are the snap targets: the nearest known-family symbol within the snap radius,
// else the nearest solid shape (the worker's `vector_example` rule, so a snapped click can never be
// refused by Find similar). The radius is NOT defined here: it comes from the API response
// (schema/column-snap.json is the one source). No symbol near: the line snap of Phase 8, else the
// raw click. Shift places the click as it is. Pure.

export type Pt2 = [number, number];

export interface ColumnSymbol {
  centre: Pt2;
  box: [number, number, number, number];
  /** direction of the symbol's edges, degrees mod 90 (worker symbol_json) */
  rotation_deg: number;
  /** [short, long] real inches */
  real_in: [number, number];
  family: string;
  solid: string | null;
  /** Phase 0-column-capture: an unknown 45 degree square (a plate / pier): a capture target */
  square45?: boolean;
}

export interface ColumnSymbols {
  snap_radius_pt: number;
  /** REAL inches: an unknown square is the click's symbol only when the click is inside its box + this */
  square_margin_in?: number;
  build_run_id: string | null;
  symbols: ColumnSymbol[];
}

export type SnapSource = "symbol" | "ink" | "line" | "none" | "shift_off";

/** A symbol turned less than this from the page axes is treated as upright (worker ANGLE_MIN_DEG). */
export const TURN_MIN_DEG = 2;

/** An edge direction mod 90 as a signed turn in (-45, 45] (clockwise > 0). */
export function signedTurn(rotationDeg: number): number {
  const a = ((rotationDeg % 90) + 90) % 90;
  return a <= 45 ? a : a - 90;
}

const dist = (a: Pt2, b: Pt2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The symbol a click at `p` snaps to: the nearest known-family centre within `radius`, else the
 * nearest solid shape within it (ties: the earlier symbol). `distance` is the click-to-centre
 * distance. */
export function nearestSymbol(
  symbols: readonly ColumnSymbol[],
  p: Pt2,
  radius: number,
  squareMargin = 0,
): { symbol: ColumnSymbol; distance: number } | null {
  for (const ok of [
    (s: ColumnSymbol) => s.family !== "unknown",
    (s: ColumnSymbol) => !!s.solid,
    (s: ColumnSymbol) =>
      s.square45 === true &&
      p[0] >= s.box[0] - squareMargin &&
      p[0] <= s.box[2] + squareMargin &&
      p[1] >= s.box[1] - squareMargin &&
      p[1] <= s.box[3] + squareMargin,
  ]) {
    let best: { symbol: ColumnSymbol; distance: number } | null = null;
    for (const s of symbols) {
      if (!ok(s)) continue;
      const d = dist(p, s.centre);
      if (d <= radius && (!best || d < best.distance))
        best = { symbol: s, distance: d };
    }
    if (best) return best;
  }
  return null;
}

/** The distance from `p` to the nearest candidate symbol at any range (logged; null: none). */
export function nearestDistance(
  symbols: readonly ColumnSymbol[],
  p: Pt2,
): number | null {
  let best: number | null = null;
  for (const s of symbols) {
    const d = dist(p, s.centre);
    if (best === null || d < best) best = d;
  }
  return best;
}

export interface Placement {
  at: Pt2;
  source: SnapSource;
  /** click-to-symbol distance (page points) to the nearest candidate; null: no candidate */
  distance: number | null;
  snapped: boolean;
  symbol: ColumnSymbol | null;
  /** the symbol's own turn to add to the palette rotation (0 when upright) */
  turn: number;
}

/** Where a Draw column click lands. `line` is the Phase 8 end point / intersection snap. */
export function placeColumn(args: {
  p: Pt2;
  symbols: readonly ColumnSymbol[];
  radius: number | null;
  squareMargin?: number;
  shift: boolean;
  line: (p: Pt2) => Pt2 | null;
}): Placement {
  const { p, symbols, radius, squareMargin, shift, line } = args;
  const distance = nearestDistance(symbols, p);
  if (shift)
    return {
      at: p,
      source: "shift_off",
      distance,
      snapped: false,
      symbol: null,
      turn: 0,
    };
  const hit =
    radius === null ? null : nearestSymbol(symbols, p, radius, squareMargin);
  if (hit) {
    const t = signedTurn(hit.symbol.rotation_deg);
    return {
      at: hit.symbol.centre,
      source: "symbol",
      distance: hit.distance,
      snapped: true,
      symbol: hit.symbol,
      turn: Math.abs(t) >= TURN_MIN_DEG ? t : 0,
    };
  }
  const q = line(p);
  return q
    ? { at: q, source: "line", distance, snapped: true, symbol: null, turn: 0 }
    : {
        at: p,
        source: "none",
        distance,
        snapped: false,
        symbol: null,
        turn: 0,
      };
}

/** The nudge of an arrow key: 1 pt, 5 pt with Shift. */
export function nudgeStep(shift: boolean): number {
  return shift ? 5 : 1;
}

/** The unknown-square click margin (REAL inches) in page points at the page scale; 0 without a scale. */
export function squareMarginPt(
  marginIn: number | undefined,
  ratio: number | null | undefined,
): number {
  return marginIn && ratio ? (marginIn * 72) / ratio : 0;
}
