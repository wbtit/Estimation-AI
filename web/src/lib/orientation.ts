// Phase 0 column orientation (pre-registration worker/prereg/PHASE0_COLUMN_CAPTURE_PREREGISTRATION.md).
// ONE algorithm, two identical copies (web/src/lib/orientation.ts and api/src/review/orientation.ts) run
// by the same shared cases (fixtures/synthetic/orientation-cases.json). Pure.
//
// CONVENTION (stored, for the 3D / Tekla step): `orientation_deg` is the direction of the column's WEB (the
// line between the two flanges of a W or W with cover plates; the long side of a rectangular HSS; a side of a
// square HSS), measured COUNTER-CLOCKWISE as seen on screen from the drawing's +X axis (to the right), in the
// DISPLAYED page frame (the page after the PDF's own /Rotate, y down on screen), in degrees, normalised to
// the symbol's symmetry: [0, 180) for W / W with cover plates / rectangular HSS, [0, 90) for square HSS,
// null for round HSS. The marker's rotation (clockwise, web vertical at 0) is (90 - orientation) mod 180.
//
// The reading uses the stored vector lines of the page (rows [x0, y0, x1, y1, class, width, role, dimension]
// in displayed page points) and ONLY the column symbol: segments of an enclosing outline (a plate or pier
// drawn around the column) are dropped, so they never outvote the column's own lines.

export type Pt2 = [number, number];
export type LineRow = readonly number[];
export type OrientationState = "clear" | "unsure" | "none";

export interface Reading {
  deg: number | null;
  state: OrientationState;
  reason: string;
  /** fraction of the edge length along the dominant direction, and along its perpendicular */
  share?: number;
  perp?: number;
  /** long / short extent of the symbol along its two edge axes */
  extRatio?: number;
  /** the bounding box [x0, y0, x1, y1] of the column symbol's own lines (the tight capture box) */
  box?: [number, number, number, number];
}

/** Longest side (real inches) a column symbol of the family can have when its size is not known. */
export const FAMILY_CAP_IN: Record<string, number> = {
  w_shape: 23,
  w_cover_plates: 23,
  hss_square: 24,
  hss_rect: 24,
  hss_round: 24,
};
/** The reading window around a column's centre (real inches): a family-sized square, wide enough for a
 * symbol a click or a snap put a few points off-centre, narrow enough to leave the neighbours out. */
export const PROBE_IN = 20;
/** The reading box around a centre: PROBE_IN across, or the given half sizes when they are larger. */
export function probeBox(
  centre: Pt2,
  ratio: number,
  halfW = 0,
  halfH = 0,
): [number, number, number, number] {
  const half = (PROBE_IN / 2) * (72 / ratio);
  const w = Math.max(half, halfW);
  const h = Math.max(half, halfH);
  return [centre[0] - w, centre[1] - h, centre[0] + w, centre[1] + h];
}
/** A stored symbol is the column's OWN when its centre is this close (real inches) and it has the
 * column's family: only then is its size a hint. Never a neighbour's size (an 8 x 4 in HSS pair 5 pt
 * away sized the window for the wrong object), never the size of an inherited profile. */
export const OWN_SYMBOL_IN = 5;
/** A centre is refined to the column symbol's own centre when it is between these (real inches)
 * off it: smaller is already right, larger is a different object (left to the amber flag). */
export const REFINE_MIN_IN = 2.5;
export const REFINE_MAX_IN = 5;
/** A column whose centre is more than this (real inches) from every grid crossing is amber, but only
 * where a grid was detected on the page. Never snapped to the grid. */
export const OFFGRID_IN = 2;
/** The rotate handle snaps to 0 / 90 / 45 and the page's grid directions within this many degrees. */
export const SNAP_TOL_DEG = 3;
export const SIZE_MARGIN = 1.25; // L_max = this x the known longest side
export const EXT_RATIO_MIN = 1.1; // catalogue: d/bf >= 1.10 for 63 of 105 column-range W shapes
export const EDGE_SHARE_MIN = 0.55; // catalogue: the 42 W with d/bf < 1.10 all have flange share >= 0.55
export const ORTHO_SHARE_MIN = 0.75; // an I / box outline puts its edges along two orthogonal directions
export const SQUARE_ORTHO_MIN = 0.9;
const COLLINEAR_DEG = 1.5;
const OFFSET_PT = 0.3;
const GAP_PT = 0.6;
const JOIN_PT = 0.3;
const OVERLAP_PT = 0.5; // segments overlapping by more than this are an overlay, never one chain
const WINDOW_GROW = 0.15;
const SNAP_DEG = 1.5;

const d2r = Math.PI / 180;
const norm = (a: number, period: number) => ((a % period) + period) % period;
const len = (r: LineRow) => Math.hypot(r[2]! - r[0]!, r[3]! - r[1]!);
/** A segment's direction counter-clockwise on screen (y down), in [0, 180). */
const dirCcw = (r: LineRow) =>
  norm(-Math.atan2(r[3]! - r[1]!, r[2]! - r[0]!) / d2r, 180);

export const markerRotation = (orientationDeg: number): number =>
  norm(90 - orientationDeg, 180);
export const orientationFromRotation = (rotationDeg: number): number =>
  norm(90 - rotationDeg, 180);

/** The symmetry period of an orientation: 90 for a square HSS, 180 otherwise (round: none). */
export const periodOf = (family: string): number | null =>
  family === "hss_round" ? null : family === "hss_square" ? 90 : 180;

/** An orientation turned clockwise on screen by `delta` degrees (R = 90, Shift+R = 15), normalised. */
export function rotated(
  orientationDeg: number,
  family: string,
  delta: number,
): number {
  const p = periodOf(family) ?? 180;
  return Math.round(norm(orientationDeg - delta, p) * 10) / 10;
}

class Dsu {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  f(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]!]!;
      i = this.p[i]!;
    }
    return i;
  }
  u(a: number, b: number) {
    this.p[this.f(a)] = this.f(b);
  }
}

export interface ReadArgs {
  lines: readonly LineRow[];
  /** the capture box [x0, y0, x1, y1] (page points) */
  box: [number, number, number, number];
  family: string;
  /** page scale: real length / drawn length (inches per inch); 1 pt = ratio / 72 real inches */
  ratio: number;
  /** the symbol's real size [short, long] in inches when known (stored symbol or section) */
  sizeIn?: readonly number[] | null;
  /** page grid directions (degrees ccw); a reading within 1.5 degrees of one snaps to it */
  grid?: readonly number[];
}

interface Seg {
  r: LineRow;
  d: number; // ccw direction [0, 180)
  l: number;
}

const inside = (x: number, y: number, b: readonly number[]) =>
  x >= b[0]! && x <= b[2]! && y >= b[1]! && y <= b[3]!;

/** An end of `p` lies on `q` (an end to an end, or a T junction: a web ending on a flange). */
function touches(p: LineRow, q: LineRow): boolean {
  const qx = q[2]! - q[0]!;
  const qy = q[3]! - q[1]!;
  const ql = Math.hypot(qx, qy) || 1e-9;
  for (const [x, y] of [
    [p[0]!, p[1]!],
    [p[2]!, p[3]!],
  ] as const) {
    const t = ((x - q[0]!) * qx + (y - q[1]!) * qy) / (ql * ql);
    if (t < -JOIN_PT / ql || t > 1 + JOIN_PT / ql) continue;
    const cx = q[0]! + Math.max(0, Math.min(1, t)) * qx;
    const cy = q[1]! + Math.max(0, Math.min(1, t)) * qy;
    if (Math.hypot(x - cx, y - cy) <= JOIN_PT) return true;
  }
  return false;
}

function snapped(
  deg: number,
  grid: readonly number[] | undefined,
  period: number,
): number {
  const cands = [0, 45, 90, 135, ...(grid ?? [])].map((c) => norm(c, period));
  for (const c of cands) {
    const diff = Math.min(Math.abs(deg - c), period - Math.abs(deg - c));
    if (diff <= SNAP_DEG) return c;
  }
  return Math.round(deg * 10) / 10;
}

/** The reading of a column symbol's orientation (see the header for the convention). */
export function readOrientation(a: ReadArgs): Reading {
  const { lines, box, family, ratio } = a;
  const period = periodOf(family);
  if (period === null) return { deg: null, state: "none", reason: "round" };
  if (!(family in FAMILY_CAP_IN))
    return { deg: null, state: "none", reason: "family" };
  const k = 72 / ratio; // points per real inch
  const known =
    a.sizeIn && a.sizeIn.length === 2
      ? Math.max(a.sizeIn[0]!, a.sizeIn[1]!)
      : null;
  const lMax =
    (known !== null ? known * SIZE_MARGIN : FAMILY_CAP_IN[family]!) * k;
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const region = [box[0] - lMax, box[1] - lMax, box[2] + lMax, box[3] + lMax];
  const grow = WINDOW_GROW * Math.max(bw, bh);
  const win = [box[0] - grow, box[1] - grow, box[2] + grow, box[3] + grow];
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;

  // 1. the pool: no hatch (role 0), no dimension lines, an end inside the region
  const pool: Seg[] = [];
  for (const r of lines) {
    if (r.length > 6 && r[6] === 0) continue;
    if (r.length > 7 && r[7]) continue;
    const l = len(r);
    if (l < 1e-6) continue;
    if (!inside(r[0]!, r[1]!, region) && !inside(r[2]!, r[3]!, region))
      continue;
    pool.push({ r, d: dirCcw(r), l });
  }

  // 2. chains of touching collinear segments; a chain longer than L_max is an enclosing / long line
  const dsu = new Dsu(pool.length);
  const order = pool.map((_, i) => i).sort((i, j) => pool[i]!.d - pool[j]!.d);
  for (let ii = 0; ii < order.length; ii++) {
    const s = pool[order[ii]!]!;
    for (let jj = ii + 1; jj < order.length; jj++) {
      const t = pool[order[jj]!]!;
      if (t.d - s.d > COLLINEAR_DEG && t.d - s.d < 180 - COLLINEAR_DEG) break;
      const ux = (s.r[2]! - s.r[0]!) / s.l;
      const uy = (s.r[3]! - s.r[1]!) / s.l;
      const off = (p: readonly number[], q: number) =>
        Math.abs((p[q]! - s.r[0]!) * -uy + (p[q + 1]! - s.r[1]!) * ux);
      if (off(t.r, 0) > OFFSET_PT || off(t.r, 2) > OFFSET_PT) continue;
      const along = (x: number, y: number) =>
        (x - s.r[0]!) * ux + (y - s.r[1]!) * uy;
      const t0 = along(t.r[0]!, t.r[1]!);
      const t1 = along(t.r[2]!, t.r[3]!);
      const lo = Math.max(Math.min(t0, t1), 0);
      const hi = Math.min(Math.max(t0, t1), s.l);
      if (hi - lo > OVERLAP_PT) continue; // a line drawn over another (a centre line over a web)
      const gap = Math.max(0, lo - hi);
      if (gap <= GAP_PT) dsu.u(order[ii]!, order[jj]!);
    }
  }
  const chain = new Map<number, { lo: number; hi: number }>();
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    const root = dsu.f(i);
    const th = -s.d * d2r; // the chain's screen direction
    const ux = Math.cos(-th);
    const uy = -Math.sin(-th);
    const e = chain.get(root) ?? { lo: Infinity, hi: -Infinity };
    for (const [x, y] of [
      [s.r[0]!, s.r[1]!],
      [s.r[2]!, s.r[3]!],
    ] as const) {
      const t = x * ux + y * uy;
      e.lo = Math.min(e.lo, t);
      e.hi = Math.max(e.hi, t);
    }
    chain.set(root, e);
  }
  const keep: Seg[] = [];
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    const e = chain.get(dsu.f(i))!;
    if (e.hi - e.lo > lMax || s.l > lMax) continue; // enclosing outline / long line
    if (!inside(s.r[0]!, s.r[1]!, win) || !inside(s.r[2]!, s.r[3]!, win))
      continue;
    keep.push(s);
  }
  if (keep.length === 0) return fromBox(family, box, "no_lines");

  // 3. connected pieces; the one that fits the family and sits nearest the capture centre
  const pd = new Dsu(keep.length);
  for (let i = 0; i < keep.length; i++)
    for (let j = i + 1; j < keep.length; j++) {
      const p = keep[i]!.r;
      const q = keep[j]!.r;
      if (touches(p, q) || touches(q, p)) pd.u(i, j);
    }
  const pieces = new Map<number, Seg[]>();
  keep.forEach((s, i) => {
    const root = pd.f(i);
    pieces.set(root, [...(pieces.get(root) ?? []), s]);
  });
  const refPt = (known !== null ? known : FAMILY_CAP_IN[family]! / 2) * k;
  type Cand = {
    segs: Seg[];
    size: number;
    dist: number;
    total: number;
    bb: [number, number, number, number];
  };
  const cands: Cand[] = [];
  for (const segs of pieces.values()) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      total = 0;
    for (const s of segs) {
      x0 = Math.min(x0, s.r[0]!, s.r[2]!);
      x1 = Math.max(x1, s.r[0]!, s.r[2]!);
      y0 = Math.min(y0, s.r[1]!, s.r[3]!);
      y1 = Math.max(y1, s.r[1]!, s.r[3]!);
      total += s.l;
    }
    cands.push({
      segs,
      size: Math.max(x1 - x0, y1 - y0),
      dist: Math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy),
      total,
      bb: [x0, y0, x1, y1],
    });
  }
  // a piece that ENCLOSES another candidate piece is an enclosing outline (a plate or pier drawn
  // around the column, even one smaller than the family's largest symbol): it never counts
  const encloses = (a: Cand, b: Cand) =>
    a !== b &&
    a.size > b.size * 1.3 &&
    b.bb[0] >= a.bb[0] - 0.3 &&
    b.bb[1] >= a.bb[1] - 0.3 &&
    b.bb[2] <= a.bb[2] + 0.3 &&
    b.bb[3] <= a.bb[3] + 0.3;
  const inner = cands.filter((a) => !cands.some((b) => encloses(a, b)));
  const usable = inner.length > 0 ? inner : cands;
  const fit = usable.filter((c) => c.size >= 0.35 * refPt && c.size <= lMax);
  const pickFrom = fit.length ? fit : usable;
  pickFrom.sort((p, q) => p.dist - q.dist || q.total - p.total);
  const segs = pickFrom[0]!.segs;
  const pieceBox: [number, number, number, number] = [
    Math.min(...segs.flatMap((s) => [s.r[0]!, s.r[2]!])),
    Math.min(...segs.flatMap((s) => [s.r[1]!, s.r[3]!])),
    Math.max(...segs.flatMap((s) => [s.r[0]!, s.r[2]!])),
    Math.max(...segs.flatMap((s) => [s.r[1]!, s.r[3]!])),
  ];

  // 4. direction histogram (1 degree bins, length weighted, +-3 degree window)
  const bins = new Array<number>(180).fill(0);
  let total = 0;
  for (const s of segs) {
    bins[Math.min(179, Math.floor(s.d))]! += s.l;
    total += s.l;
  }
  const win3 = (c: number) => {
    let w = 0;
    for (let o = -3; o <= 3; o++) w += bins[norm(Math.round(c) + o, 180)]!;
    return w;
  };
  // the windows reach a plateau around the true direction: centre on the middle of the plateau,
  // then refine with the length-weighted mean direction of the segments near it
  const wins = Array.from({ length: 180 }, (_, c) => win3(c));
  const bestW = Math.max(...wins);
  const plateau = wins
    .map((w, c) => (w >= bestW - 1e-9 ? c : -1))
    .filter((c) => c >= 0);
  const first = plateau[0]!;
  // (a square has two equal directions: keep only the first plateau cluster)
  const near = plateau.filter(
    (c) => Math.abs(((((c - first + 90) % 180) + 180) % 180) - 90) <= 6,
  );
  let best = first;
  {
    let acc = 0;
    for (const c of near) acc += ((((c - first + 90) % 180) + 180) % 180) - 90;
    best = norm(first + acc / near.length, 180);
  }
  let sx = 0,
    sw = 0;
  for (const s of segs) {
    const diff = ((((s.d - best + 90) % 180) + 180) % 180) - 90;
    if (Math.abs(diff) <= 4) {
      sx += diff * s.l;
      sw += s.l;
    }
  }
  const D = norm(best + (sw > 0 ? sx / sw : 0), 180);
  const share = bestW / total;
  const perp = win3(norm(Math.round(D) + 90, 180)) / total;
  const ortho = share + perp;

  // 5. extents of the piece along the two edge axes
  const axis = (deg: number): Pt2 => [
    Math.cos(deg * d2r),
    -Math.sin(deg * d2r),
  ];
  const extent = (deg: number) => {
    const [ux, uy] = axis(deg);
    let lo = Infinity,
      hi = -Infinity;
    for (const s of segs)
      for (const [x, y] of [
        [s.r[0]!, s.r[1]!],
        [s.r[2]!, s.r[3]!],
      ] as const) {
        const t = x * ux + y * uy;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    return hi - lo;
  };
  const extD = extent(D);
  const extP = extent(norm(D + 90, 180));
  const extRatio = Math.max(extD, extP) / Math.max(Math.min(extD, extP), 1e-9);
  const extWebAlongP = extP >= extD; // the longer extent runs along D + 90
  const finish = (
    deg: number,
    state: OrientationState,
    reason: string,
  ): Reading => ({
    deg: snapped(norm(deg, period), a.grid, period),
    state,
    reason,
    share,
    perp,
    extRatio,
    box: pieceBox,
  });

  if (family === "hss_square") {
    return finish(
      D,
      ortho >= SQUARE_ORTHO_MIN ? "clear" : "unsure",
      ortho >= SQUARE_ORTHO_MIN ? "square" : "not_square",
    );
  }
  if (family === "hss_rect") {
    const longDir = extWebAlongP ? D + 90 : D;
    return finish(
      longDir,
      extRatio >= EXT_RATIO_MIN && ortho >= ORTHO_SHARE_MIN
        ? "clear"
        : "unsure",
      "long_side",
    );
  }
  // W and W with cover plates: the web runs along the longer extent (d/bf >= 1.10), else it is
  // perpendicular to the dominant (flange) edges
  const extDecisive = extRatio >= EXT_RATIO_MIN;
  const edgeDecisive = share >= EDGE_SHARE_MIN;
  const webExt = extWebAlongP ? D + 90 : D;
  const webEdge = D + 90;
  const sameAxis = (x: number, y: number) =>
    Math.min(Math.abs(norm(x - y, 180)), 180 - Math.abs(norm(x - y, 180))) <= 5;
  if (ortho < ORTHO_SHARE_MIN)
    return finish(extDecisive ? webExt : webEdge, "unsure", "not_an_i_outline");
  if (extDecisive && edgeDecisive)
    return sameAxis(webExt, webEdge)
      ? finish(webExt, "clear", "extent_and_edges")
      : finish(webExt, "unsure", "extent_vs_edges");
  if (extDecisive) return finish(webExt, "clear", "extent");
  if (edgeDecisive) return finish(webEdge, "clear", "edges");
  return finish(webEdge, "unsure", "ambiguous");
}

/** Without stored lines: the symbol's own box (and family) give an amber guess. */
function fromBox(
  family: string,
  box: readonly number[],
  reason: string,
): Reading {
  const w = box[2]! - box[0]!;
  const h = box[3]! - box[1]!;
  const ratio = Math.max(w, h) / Math.max(Math.min(w, h), 1e-9);
  if (family === "hss_square") return { deg: 0, state: "unsure", reason };
  if (ratio < 1.1)
    return { deg: null, state: "unsure", reason: `${reason}_square_box` };
  return { deg: h > w ? 90 : 0, state: "unsure", reason };
}

/** The size hint a column may use: the real size [short, long] of the stored symbol that is the
 * column's OWN (its family, its centre within OWN_SYMBOL_IN), else null. A neighbour, another
 * family or the size of an inherited profile is never a hint. */
export function ownSymbolSize(
  symbols: readonly {
    family: string;
    centre: readonly number[];
    real_in: readonly number[];
  }[],
  centre: Pt2,
  family: string,
  ratio: number,
): [number, number] | null {
  const tol = OWN_SYMBOL_IN * (72 / ratio);
  let best: { d: number; size: [number, number] } | null = null;
  for (const s of symbols) {
    if (s.family !== family || s.real_in.length !== 2) continue;
    const d = Math.hypot(s.centre[0]! - centre[0], s.centre[1]! - centre[1]);
    if (d <= tol && (!best || d < best.d))
      best = {
        d,
        size: [
          Math.min(s.real_in[0]!, s.real_in[1]!),
          Math.max(s.real_in[0]!, s.real_in[1]!),
        ],
      };
  }
  return best ? best.size : null;
}

/** The rotate handle's angle: within SNAP_TOL_DEG of 0 / 90 / 45 (and the page's grid directions) it
 * snaps to it, within the symbol's symmetry; otherwise it is kept (1 degree). Shift = free: the
 * caller does not call this. */
export function snapOrientation(
  deg: number,
  family: string,
  grid: readonly number[] = [],
  tol: number = SNAP_TOL_DEG,
): number {
  const period = periodOf(family) ?? 180;
  const d = norm(deg, period);
  const cands = [0, 45, 90, 135, ...grid].map((c) => norm(c, period));
  let best: { diff: number; c: number } | null = null;
  for (const c of cands) {
    const diff = Math.min(Math.abs(d - c), period - Math.abs(d - c));
    if (diff <= tol && (!best || diff < best.diff)) best = { diff, c };
  }
  return best ? Math.round(best.c * 10) / 10 : Math.round(d);
}

/** The column's centre refined to its own symbol's centre (the middle of its strokes) when that is
 * REFINE_MIN_IN to REFINE_MAX_IN away (real inches); otherwise left where it is. */
export function refineCentre(
  placed: Pt2,
  glyph: Pt2 | null | undefined,
  ratio: number,
): { centre: Pt2; moved: boolean; offsetIn: number } {
  if (!glyph) return { centre: placed, moved: false, offsetIn: 0 };
  const offsetIn =
    Math.hypot(glyph[0] - placed[0], glyph[1] - placed[1]) * (ratio / 72);
  const moved = offsetIn >= REFINE_MIN_IN && offsetIn <= REFINE_MAX_IN;
  return { centre: moved ? glyph : placed, moved, offsetIn };
}

/** The middle of a reading's column symbol (its strokes' box), or null. */
export function glyphCentre(r: Reading): Pt2 | null {
  return r.box ? [(r.box[0] + r.box[2]) / 2, (r.box[1] + r.box[3]) / 2] : null;
}
