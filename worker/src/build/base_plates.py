"""Phase 12a: base plates and grid markers on the page (rules "base_plate" and "grid_marker").

Rings: a small circle drawn either as a curved closed shape or, as CAD exports often do, as a closed
loop of short straight segments (each end shared by exactly two segments, ends joined within
RING_JOIN_PT, at least RING_MIN_SEGS pieces, every point within RING_ROUND of the mean radius,
relative). Only rings no wider than RING_MAX_IN real inches count (anchor bolts and their holes).

Rule "base_plate": four rings of about the same size (diameters within BOLT_SIZE_TOL, relative) at
the corners of a rectangle (two by two on its two axes, the axes at right angles within
BOLT_RECT_DEG, corners within BOLT_CORNER_TOL_PT of the rectangle) with sides BOLT_SIDE_MIN_IN to
BOLT_SIDE_MAX_IN mark ONE column at the rectangle's centre. The plate is the bolt rectangle grown by
PLATE_GROW_X times its larger side (the plate drawn around the bolts lies inside); every line inside
it (the plate, the bolts, the column's own outline) belongs to the column and is never a beam. The
shape inside the bolts sets the column's section type: a small rectangle (sides joined at right
angles) -> "HSS"; an I (two parallel lines joined at their middles by a third)
-> "W"; else none. Its size still comes from the labels. A base-plate column with no grid crossing
within OFF_GRID_PT is kept and marked off grid (review).

Rule "grid_marker": grid-line end or break markers (a pair of small filled triangles on a grid line,
a "bow-tie") are not column glyphs: a filled glyph of three corners whose centre lies within
MARKER_ON_LINE_PT of a grid line's axis and within MARKER_REACH_PT of that line's end or of one of
its bubbles.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from src.build.columns import Glyph
from src.build.geom import Box, Pt
from src.build.grids import Crossing, GridLine
from src.build.segments import PageSegments

PT_PER_IN = 72.0

RING_JOIN_PT = 0.1
RING_MIN_SEGS = 6
RING_ROUND = 0.2
RING_MAX_IN = 3.0
RING_MIN_PT = 0.4

BOLT_SIZE_TOL = 0.25
BOLT_CORNER_TOL_PT = 1.0
BOLT_SIDE_MIN_IN = 2.0
BOLT_SIDE_MAX_IN = 36.0
PLATE_GROW_X = 0.35
OFF_GRID_PT = 30.0
INNER_PARALLEL_DEG = 5.0

MARKER_ON_LINE_PT = 6.0
MARKER_REACH_PT = 72.0


def real_pt(inches: float, ratio: float) -> float:
    return inches * PT_PER_IN / ratio


@dataclass
class Ring:
    centre: Pt
    diameter: float
    seg_ids: list[int]


@dataclass
class BasePlate:
    centre: Pt
    bolts: list[Ring]
    plate: Box  # the area whose lines belong to the column
    section_type: str | None  # "HSS", "W" or None
    grid: Crossing | None  # the crossing within OFF_GRID_PT, None = off grid

    @property
    def off_grid(self) -> bool:
        return self.grid is None


def _key(x: float, y: float) -> tuple[int, int]:
    return (round(x / RING_JOIN_PT), round(y / RING_JOIN_PT))


def find_rings(ps: PageSegments, max_pt: float) -> list[Ring]:
    """Small circles: curved closed shapes and closed loops of short segments (module note)."""
    out: list[Ring] = []
    for sh in ps.shapes:
        if not (sh.curved and sh.closed):
            continue
        d = max(sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1])
        if RING_MIN_PT <= d <= max_pt:
            c = ((sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2)
            out.append(Ring(c, d, []))
    if len(ps) == 0:
        return out
    length = ps.length()
    short = np.flatnonzero((length > 0) & (length <= max_pt))
    ends: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in short:
        x0, y0, x1, y1 = ps.seg[i]
        ends[_key(x0, y0)].append(int(i))
        ends[_key(x1, y1)].append(int(i))
    # union of segments sharing an end
    parent = {int(i): int(i) for i in short}

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for ids in ends.values():
        for j in ids[1:]:
            ra, rb = find(ids[0]), find(j)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    groups: dict[int, list[int]] = defaultdict(list)
    for i in short:
        groups[find(int(i))].append(int(i))
    for ids in groups.values():
        if len(ids) < RING_MIN_SEGS:
            continue
        # a closed loop: every end is shared by exactly two of its segments
        keys = [_key(*ps.seg[i][0:2]) for i in ids] + [_key(*ps.seg[i][2:4]) for i in ids]
        count: dict[tuple[int, int], int] = defaultdict(int)
        for k in keys:
            count[k] += 1
        if any(v != 2 for v in count.values()):
            continue
        pts = np.concatenate([ps.seg[ids][:, 0:2], ps.seg[ids][:, 2:4]])
        c = pts.mean(axis=0)
        r = np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1])
        mean = float(r.mean())
        if mean <= 0 or float(np.abs(r - mean).max()) > RING_ROUND * mean:
            continue
        d = 2 * mean
        if RING_MIN_PT <= d <= max_pt:
            out.append(Ring((float(c[0]), float(c[1])), d, sorted(ids)))
    out.sort(key=lambda g: (round(g.centre[1], 2), round(g.centre[0], 2)))
    return out


def _rect_of(four: list[Ring]) -> tuple[Pt, float, float, float] | None:
    """The rectangle with these four points as corners: (centre, side a, side b, angle) or None."""
    pts = np.asarray([r.centre for r in four])
    c = pts.mean(axis=0)
    # the axes: the directions from the centre to the corners pair up; take the first side found
    best = None
    for i in range(4):
        for j in range(i + 1, 4):
            v = pts[j] - pts[i]
            ang = math.atan2(v[1], v[0])
            ux, uy = math.cos(ang), math.sin(ang)
            t = (pts[:, 0] - c[0]) * ux + (pts[:, 1] - c[1]) * uy
            n = -(pts[:, 0] - c[0]) * uy + (pts[:, 1] - c[1]) * ux
            a, b = float(np.abs(t).mean()), float(np.abs(n).mean())
            ok = (
                np.all(np.abs(np.abs(t) - a) <= BOLT_CORNER_TOL_PT)
                and np.all(np.abs(np.abs(n) - b) <= BOLT_CORNER_TOL_PT)
                and sorted(np.sign(t) * 2 + np.sign(n)) == [-3.0, -1.0, 1.0, 3.0]
            )
            if ok and (best is None or ang < best[3]):
                best = ((float(c[0]), float(c[1])), 2 * a, 2 * b, math.degrees(ang) % 180.0)
    return best


def find_base_plates(ps: PageSegments, ratio: float, crossings: list[Crossing]) -> list[BasePlate]:
    """Rule "base_plate" (module note)."""
    rings = find_rings(ps, real_pt(RING_MAX_IN, ratio))
    lo, hi = real_pt(BOLT_SIDE_MIN_IN, ratio), real_pt(BOLT_SIDE_MAX_IN, ratio)
    used: set[int] = set()
    out: list[BasePlate] = []
    for k, r in enumerate(rings):
        if k in used:
            continue
        near = [
            j
            for j, q in enumerate(rings)
            if j != k
            and j not in used
            and math.dist(q.centre, r.centre) <= hi * math.sqrt(2) + BOLT_CORNER_TOL_PT
            and abs(q.diameter - r.diameter) <= BOLT_SIZE_TOL * r.diameter
        ]
        near.sort(key=lambda j: (math.dist(rings[j].centre, r.centre), j))
        found = None
        # the smallest rectangle with r as a corner and three of its neighbours
        for a in range(len(near)):
            for b in range(a + 1, len(near)):
                for c in range(b + 1, len(near)):
                    four = [r, rings[near[a]], rings[near[b]], rings[near[c]]]
                    rect = _rect_of(four)
                    if rect and lo <= rect[1] <= hi and lo <= rect[2] <= hi:
                        found = (rect, [near[a], near[b], near[c]])
                        break
                if found:
                    break
            if found:
                break
        if not found:
            continue
        (centre, sa, sb, _), others = found
        used.update([k, *others])
        bolts = [r] + [rings[j] for j in others]
        grow = PLATE_GROW_X * max(sa, sb)
        xs = [q.centre[0] for q in bolts]
        ys = [q.centre[1] for q in bolts]
        plate = (min(xs) - grow, min(ys) - grow, max(xs) + grow, max(ys) + grow)
        cross = min(crossings, key=lambda g: math.dist(g.point, centre), default=None)
        at = cross if cross is not None and math.dist(cross.point, centre) <= OFF_GRID_PT else None
        inner = (min(xs), min(ys), max(xs), max(ys))
        out.append(BasePlate(centre, bolts, plate, section_type(ps, inner, bolts), at))
    out.sort(key=lambda p: (round(p.centre[1], 2), round(p.centre[0], 2)))
    return out


def section_type(ps: PageSegments, inner: Box, bolts: list[Ring]) -> str | None:
    """The column outline inside the bolts: "HSS" (a small rectangle round the centre), "W" (an I:
    two parallel lines joined at their middles by a third), else None."""
    if len(ps) == 0:
        return None
    bolt_ids = {i for b in bolts for i in b.seg_ids}
    s = ps.seg
    inside = [
        i
        for i in range(len(s))
        if i not in bolt_ids
        and inner[0] < min(s[i, 0], s[i, 2])
        and max(s[i, 0], s[i, 2]) < inner[2]
        and inner[1] < min(s[i, 1], s[i, 3])
        and max(s[i, 1], s[i, 3]) < inner[3]
        and math.hypot(s[i, 2] - s[i, 0], s[i, 3] - s[i, 1]) > RING_JOIN_PT * 10
    ]
    if len(inside) < 3:
        return None
    ang = {
        i: math.degrees(math.atan2(s[i, 3] - s[i, 1], s[i, 2] - s[i, 0])) % 180.0 for i in inside
    }
    mid = {i: ((s[i, 0] + s[i, 2]) / 2, (s[i, 1] + s[i, 3]) / 2) for i in inside}
    length = {i: math.hypot(s[i, 2] - s[i, 0], s[i, 3] - s[i, 1]) for i in inside}

    def par(a: float, b: float) -> bool:
        d = abs(a - b) % 180.0
        return min(d, 180.0 - d) <= INNER_PARALLEL_DEG

    def perp(a: float, b: float) -> bool:
        return par(a, (b + 90.0) % 180.0)

    def touches(p: Pt, i: int) -> bool:
        return min(math.dist(p, s[i, 0:2]), math.dist(p, s[i, 2:4])) <= 2 * RING_JOIN_PT + 0.5

    # an I: a web whose two ends touch the middles of two parallel flanges
    for w in inside:
        a, b = (float(s[w, 0]), float(s[w, 1])), (float(s[w, 2]), float(s[w, 3]))
        flanges = [
            f
            for f in inside
            if f != w
            and perp(ang[f], ang[w])
            and any(math.dist(m, mid[f]) <= 0.15 * length[f] + 0.5 for m in (a, b))
        ]
        ends_hit = {0 if math.dist(a, mid[f]) < math.dist(b, mid[f]) else 1 for f in flanges}
        if len(ends_hit) == 2:
            return "W"
    # a rectangle: four sides, two pairs of parallel lines joined at their ends
    for i in inside:
        joined = [
            j
            for j in inside
            if j != i
            and perp(ang[i], ang[j])
            and (
                touches((float(s[i, 0]), float(s[i, 1])), j)
                or touches((float(s[i, 2]), float(s[i, 3])), j)
            )
        ]
        if len(joined) >= 2:
            return "HSS"
    return None


def _inside(b: Box, q: Pt) -> bool:
    return b[0] <= q[0] <= b[2] and b[1] <= q[1] <= b[3]


def in_plate(plates: list[BasePlate], q: Pt) -> bool:
    return any(_inside(p.plate, q) for p in plates)


def plate_line(plates: list[BasePlate], p0: Pt, p1: Pt) -> bool:
    """A line lying inside a base plate (both ends within its area): it belongs to the column."""
    return any(_inside(p.plate, p0) and _inside(p.plate, p1) for p in plates)


def plate_glyph(p: BasePlate) -> Glyph:
    """A base plate's column as a glyph (no shapes of its own; its box is the bolt rectangle)."""
    xs = [b.centre[0] for b in p.bolts]
    ys = [b.centre[1] for b in p.bolts]
    return Glyph([], (min(xs), min(ys), max(xs), max(ys)), "plate", 0, p.grid is not None, p.grid)


def is_grid_marker(g: Glyph, ps: PageSegments, grid: list[GridLine]) -> bool:
    """Rule "grid_marker" (module note)."""
    if "f" not in g.paint or g.n_verts != 3:
        return False
    for gl in grid:
        dx, dy = gl.p1[0] - gl.p0[0], gl.p1[1] - gl.p0[1]
        ln = math.hypot(dx, dy)
        if ln == 0:
            continue
        cx, cy = g.centre
        off = abs(-(cx - gl.p0[0]) * dy + (cy - gl.p0[1]) * dx) / ln
        if off > MARKER_ON_LINE_PT:
            continue
        ends = [gl.p0, gl.p1] + [b.centre for b in gl.bubbles]
        if min(math.dist(g.centre, q) for q in ends) <= MARKER_REACH_PT:
            return True
    return False
