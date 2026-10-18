// Suggested exclude areas (Phase 11c, docs/PHASE11C_PLAN.md section 3). Proposals only: a box
// counts for the build once a person accepts it. Conservative on purpose: a missed suggestion is
// better than one over framing, so any box that overlaps the view's grid area (or, with no grid
// evidence, its built beam lines) by more than GRID_OVERLAP_MAX of its own area is dropped, and
// tables are suggested only when there is grid evidence. Pure and deterministic.
import type { Box } from './build-views.js';

export const FRAME_EDGE_FRAC = 0.03;
export const FRAME_SPAN_FRAC = 0.5;
export const FRAME_PAD_PT = 4;
export const TITLE_ZONE_FRAC = 0.3;
export const TITLE_SPAN_FRAC = 0.8;
export const TABLE_MIN_LINES = 12;
export const TABLE_MIN_CELLS = 6;
export const TABLE_LINE_MAX_FRAC = 0.25;
export const TABLE_JOIN_PT = 2;
export const GRID_OVERLAP_MAX = 0.05;
const AXIS_TOL_PT = 0.5; // a line is vertical / horizontal when its other extent is under this

export type Rule = 'frame' | 'title_block' | 'table';
export interface Suggestion {
  rule: Rule;
  box: Box;
}

/** A line [x0, y0, x1, y1, ...] as sheet_lines stores it (displayed page points). */
type Line = readonly number[];

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
export function intersect(a: Box, b: Box): Box | null {
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}
/** Share of `a`'s area inside `b` (0 when they do not meet). */
export function overlapShare(a: Box, b: Box): number {
  const i = intersect(a, b);
  return i && area(a) > 0 ? area(i) / area(a) : 0;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const round = (b: Box): Box => ({ x0: r2(b.x0), y0: r2(b.y0), x1: r2(b.x1), y1: r2(b.y1) });

function isVertical(l: Line): boolean {
  return Math.abs(l[2]! - l[0]!) < AXIS_TOL_PT && Math.abs(l[3]! - l[1]!) >= AXIS_TOL_PT;
}
function isHorizontal(l: Line): boolean {
  return Math.abs(l[3]! - l[1]!) < AXIS_TOL_PT && Math.abs(l[2]! - l[0]!) >= AXIS_TOL_PT;
}
const len = (l: Line) => Math.hypot(l[2]! - l[0]!, l[3]! - l[1]!);

/** Frame bands: lines along a sheet edge spanning most of it; one band per edge, edge to line. */
function frameBands(lines: Line[], w: number, h: number): Suggestion[] {
  const out: Suggestion[] = [];
  const ex = FRAME_EDGE_FRAC * w;
  const ey = FRAME_EDGE_FRAC * h;
  const vert = lines.filter((l) => isVertical(l) && len(l) >= FRAME_SPAN_FRAC * h);
  const hor = lines.filter((l) => isHorizontal(l) && len(l) >= FRAME_SPAN_FRAC * w);
  const left = vert.map((l) => l[0]!).filter((x) => x <= ex);
  const right = vert.map((l) => l[0]!).filter((x) => x >= w - ex);
  const top = hor.map((l) => l[1]!).filter((y) => y <= ey);
  const bottom = hor.map((l) => l[1]!).filter((y) => y >= h - ey);
  if (left.length)
    out.push({ rule: 'frame', box: { x0: 0, y0: 0, x1: Math.max(...left) + FRAME_PAD_PT, y1: h } });
  if (top.length)
    out.push({ rule: 'frame', box: { x0: 0, y0: 0, x1: w, y1: Math.max(...top) + FRAME_PAD_PT } });
  if (right.length)
    out.push({
      rule: 'frame',
      box: { x0: Math.min(...right) - FRAME_PAD_PT, y0: 0, x1: w, y1: h },
    });
  if (bottom.length)
    out.push({
      rule: 'frame',
      box: { x0: 0, y0: Math.min(...bottom) - FRAME_PAD_PT, x1: w, y1: h },
    });
  return out;
}

/** The title block band: the left-most long vertical line in the right zone (outside the frame
 * zone), to the right edge. */
function titleBand(lines: Line[], w: number, h: number): Suggestion[] {
  const xs = lines
    .filter(
      (l) =>
        isVertical(l) &&
        len(l) >= TITLE_SPAN_FRAC * h &&
        l[0]! >= w * (1 - TITLE_ZONE_FRAC) &&
        l[0]! < w * (1 - FRAME_EDGE_FRAC),
    )
    .map((l) => l[0]!);
  if (!xs.length) return [];
  return [
    { rule: 'title_block', box: { x0: Math.min(...xs) - FRAME_PAD_PT, y0: 0, x1: w, y1: h } },
  ];
}

/** Tables: clusters of short axis-aligned lines that cross into enough cells. */
function tables(lines: Line[], w: number): Suggestion[] {
  const cand = lines.filter(
    (l) => (isVertical(l) || isHorizontal(l)) && len(l) < TABLE_LINE_MAX_FRAC * w,
  );
  const n = cand.length;
  const parent = cand.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const bb = cand.map((l) => ({
    x0: Math.min(l[0]!, l[2]!) - TABLE_JOIN_PT,
    y0: Math.min(l[1]!, l[3]!) - TABLE_JOIN_PT,
    x1: Math.max(l[0]!, l[2]!) + TABLE_JOIN_PT,
    y1: Math.max(l[1]!, l[3]!) + TABLE_JOIN_PT,
  }));
  // sweep on x so the join stays near-linear on a busy page
  const order = [...cand.keys()].sort((a, b) => bb[a]!.x0 - bb[b]!.x0);
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    for (let m = k + 1; m < n; m++) {
      const j = order[m]!;
      if (bb[j]!.x0 > bb[i]!.x1) break;
      if (bb[j]!.y0 <= bb[i]!.y1 && bb[j]!.y1 >= bb[i]!.y0) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
  const out: Suggestion[] = [];
  for (const g of groups.values()) {
    if (g.length < TABLE_MIN_LINES) continue;
    const ys = new Set(
      g.filter((i) => isHorizontal(cand[i]!)).map((i) => Math.round(cand[i]![1]!)),
    );
    const xs = new Set(g.filter((i) => isVertical(cand[i]!)).map((i) => Math.round(cand[i]![0]!)));
    if (ys.size < 2 || xs.size < 2 || (ys.size - 1) * (xs.size - 1) < TABLE_MIN_CELLS) continue;
    const b = {
      x0: Math.min(...g.map((i) => bb[i]!.x0)),
      y0: Math.min(...g.map((i) => bb[i]!.y0)),
      x1: Math.max(...g.map((i) => bb[i]!.x1)),
      y1: Math.max(...g.map((i) => bb[i]!.y1)),
    };
    out.push({ rule: 'table', box: b });
  }
  return out.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}

/**
 * Suggested exclude boxes for a view.
 * @param lines   the page's sheet_lines rows
 * @param page    displayed page size [w, h]
 * @param view    the view box (suggestions are clipped to it), or null for the whole page
 * @param grid    bounding box of the grid lines and bubbles in the view, or null (no grid evidence)
 * @param beams   bounding box of the view's built beam lines, or null
 */
export function suggestExcludes(
  lines: readonly Line[],
  page: [number, number],
  view: Box | null,
  grid: Box | null,
  beams: Box | null,
): Suggestion[] {
  const [w, h] = page;
  const all = [
    ...frameBands(lines as Line[], w, h),
    ...titleBand(lines as Line[], w, h),
    ...(grid ? tables(lines as Line[], w) : []),
  ];
  const guard = grid ?? beams;
  const out: Suggestion[] = [];
  for (const s of all) {
    const clipped = view ? intersect(s.box, view) : s.box;
    if (!clipped) continue;
    if (guard && overlapShare(clipped, guard) > GRID_OVERLAP_MAX) continue;
    // a table inside a frame or title band is already covered
    if (
      s.rule === 'table' &&
      out.some((o) => o.rule !== 'table' && overlapShare(clipped, o.box) > 0.5)
    )
      continue;
    out.push({ rule: s.rule, box: round(clipped) });
  }
  return out;
}
