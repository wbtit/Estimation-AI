"""Phase 12a: beam lines of the pen that are not beams, taken out before the supports are built:
rule "wall_band" here, rule "base_plate" (src/build/base_plates.py) and rule "column_shape" here.
Every threshold is a constant below; sizes on the drawing are real inches at the view's scale
(pt = inches * 72 / ratio).

Rule "wall_band": a concrete wall is two parallel faces with a hatch or concrete pattern between
them, or a filled band. A beam line is a wall face when its nearest parallel line on one side
(within WALL_PARALLEL_DEG, more than WALL_SAME_LINE_PT away, any kept segment of at least
WALL_PARTNER_MIN_PT, together covering at least WALL_COVER_MIN of the beam line) is WALL_MIN_IN
to WALL_MAX_IN away, and the band between them holds at least
max(WALL_FILL_MIN_ITEMS, overlap / WALL_FILL_SPACING_PT) fill items: hatch segments (the clean
step's hatch role, src/review/line_roles.py), cross strokes (not parallel to the faces, at most
WALL_CROSS_MAX_X times the band: a hatch sparser than the hatch rule's stacks), and short strokes
and small shapes (dots, triangles, stipple) no longer than WALL_FILL_ITEM_MAX_PT. A beam line along
a closed filled band (WALL_MIN_IN to WALL_MAX_IN thick, at least FILLED_BAND_MIN_PT on paper, at
least FILLED_BAND_ASPECT times as long) is a wall face too. Only the NEAREST covering line counts,
so a beam drawn beside a wall is kept: its nearest parallel line is the wall face, with no fill
between them. A base plate is checked first (its parallel edges with bolts between would read as a
wall).

Rule "column_shape": the edges of a column glyph or of a base plate (with or without bolt circles)
around a column are not beams. A beam line no longer than COLUMN_SHAPE_MAX_IN is a column-shape edge
when a column position (a column of the column plan, a column projected from it, or the centre of
any glyph) lies inside the shape it bounds: it projects onto the middle of the line (from
COLUMN_SHAPE_T_MIN to 1 - COLUMN_SHAPE_T_MIN of its length) at COLUMN_SHAPE_OFF_MIN to
COLUMN_SHAPE_OFF_MAX times the line's length (+ COLUMN_SHAPE_END_TOL_PT) away, and the shape closes
towards it: perpendicular lines (within COLUMN_SHAPE_PERP_DEG) leave both ends of the line towards
the position (a rectangle, a base plate), or one leaves the middle third of the line towards it (the
web of an I). A short beam that ends at a column or runs through it is kept (the column is on the
line, not beside it).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from src.build.base_plates import BasePlate, plate_line
from src.build.beam_lines import BeamLine
from src.build.clean import Cleaned
from src.build.geom import Pt
from src.build.segments import PageSegments
from src.review.line_roles import HATCH

MM_PER_IN = 25.4
PT_PER_IN = 72.0

WALL_MIN_IN = 4.0
WALL_MAX_IN = 24.0
WALL_PARALLEL_DEG = 2.0
WALL_SAME_LINE_PT = 0.75
WALL_PARTNER_MIN_PT = 6.0
WALL_COVER_MIN = 0.5
WALL_FILL_ITEM_MAX_PT = 6.0
WALL_CROSS_MAX_X = 2.0
WALL_FILL_MIN_ITEMS = 4
WALL_FILL_SPACING_PT = 48.0
WALL_BAND_MARGIN_PT = 0.5
FILLED_BAND_MIN_PT = 3.0
FILLED_BAND_ASPECT = 4.0

COLUMN_SHAPE_MAX_IN = 36.0
COLUMN_SHAPE_T_MIN = 0.15
COLUMN_SHAPE_OFF_MIN = 0.2
COLUMN_SHAPE_OFF_MAX = 1.0
COLUMN_SHAPE_END_TOL_PT = 2.0
COLUMN_SHAPE_TOUCH_PT = 1.5
COLUMN_SHAPE_PERP_DEG = 5.0


def real_pt(inches: float, ratio: float) -> float:
    """Real inches drawn at 1:ratio, in pt on the paper."""
    return inches * PT_PER_IN / ratio


@dataclass
class Removed:
    lines: list[BeamLine]  # the lines that stay
    wall: list[int] = field(default_factory=list)  # ids of the lines taken out as wall faces
    base_plate: list[int] = field(default_factory=list)  # lines inside a base plate (its column)
    column_shape: list[int] = field(default_factory=list)


def _frame(ln: BeamLine) -> tuple[float, float, float, float, float]:
    length = ln.length or 1.0
    ux, uy = (ln.p1[0] - ln.p0[0]) / length, (ln.p1[1] - ln.p0[1]) / length
    return ux, uy, -uy, ux, length


def _local(points: np.ndarray, ln: BeamLine) -> tuple[np.ndarray, np.ndarray]:
    """Along (t) and across (d, signed) coordinates of points in the line's frame."""
    ux, uy, nx, ny, _ = _frame(ln)
    dx, dy = points[:, 0] - ln.p0[0], points[:, 1] - ln.p0[1]
    return dx * ux + dy * uy, dx * nx + dy * ny


def _union(spans: list[tuple[float, float]]) -> float:
    total, end = 0.0, -math.inf
    for a, b in sorted(spans):
        if b <= end:
            continue
        total += b - max(a, end)
        end = b
    return total


@dataclass
class _Page:
    """The page's segments and small shapes in arrays, once per page."""

    seg: np.ndarray
    mid: np.ndarray
    length: np.ndarray
    angle: np.ndarray  # degrees mod 180
    keep: np.ndarray
    hatch: np.ndarray
    small: np.ndarray  # centres of small shapes (dots, triangles)
    bands: list[tuple[float, float, float, float]]  # filled closed shapes, bbox

    @classmethod
    def of(cls, ps: PageSegments, cleaned: Cleaned) -> _Page:
        s = ps.seg if len(ps) else np.zeros((0, 4))
        mid = np.stack([(s[:, 0] + s[:, 2]) / 2, (s[:, 1] + s[:, 3]) / 2], axis=1)
        small = [
            ((sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2)
            for sh in ps.shapes
            if max(sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]) <= WALL_FILL_ITEM_MAX_PT
        ]
        bands = [
            sh.bbox for sh in ps.shapes if sh.closed and sh.paint in ("f", "fs") and not sh.curved
        ]
        return cls(
            seg=s,
            mid=mid,
            length=ps.length(),
            angle=np.degrees(np.arctan2(s[:, 3] - s[:, 1], s[:, 2] - s[:, 0])) % 180.0,
            keep=cleaned.keep if len(cleaned.keep) == len(s) else np.ones(len(s), dtype=bool),
            hatch=cleaned.roles == HATCH
            if len(cleaned.roles) == len(s)
            else np.zeros(len(s), bool),
            small=np.asarray(small, dtype=float).reshape(-1, 2),
            bands=bands,
        )


def _angle_diff(a: np.ndarray, b: float) -> np.ndarray:
    d = np.abs(a - b) % 180.0
    return np.minimum(d, 180.0 - d)


def _line_angle(ln: BeamLine) -> float:
    return math.degrees(math.atan2(ln.p1[1] - ln.p0[1], ln.p1[0] - ln.p0[0])) % 180.0


def is_wall_face(ln: BeamLine, pg: _Page, ratio: float) -> bool:
    """Rule "wall_band" (module note)."""
    lo, hi = real_pt(WALL_MIN_IN, ratio), real_pt(WALL_MAX_IN, ratio)
    _, _, _, _, length = _frame(ln)
    if _filled_band(ln, pg, lo, hi):
        return True
    own = set(ln.seg_ids)
    par = (
        pg.keep
        & (pg.length >= WALL_PARTNER_MIN_PT)
        & (_angle_diff(pg.angle, _line_angle(ln)) <= WALL_PARALLEL_DEG)
    )
    idx = [int(i) for i in np.flatnonzero(par) if int(i) not in own]
    if not idx:
        return False
    a_t, a_d = _local(pg.seg[idx][:, 0:2], ln)
    b_t, b_d = _local(pg.seg[idx][:, 2:4], ln)
    d = (a_d + b_d) / 2
    t0 = np.clip(np.minimum(a_t, b_t), 0.0, length)
    t1 = np.clip(np.maximum(a_t, b_t), 0.0, length)
    for side in (1.0, -1.0):
        on = [k for k in range(len(idx)) if d[k] * side > WALL_SAME_LINE_PT and t1[k] > t0[k]]
        on.sort(key=lambda k: abs(d[k]))
        # offset groups, nearest first; the nearest group covering enough of the line is the partner
        k = 0
        while k < len(on):
            g = [on[k]]
            while k + len(g) < len(on) and abs(d[on[k + len(g)]]) - abs(d[on[k]]) <= (
                WALL_SAME_LINE_PT
            ):
                g.append(on[k + len(g)])
            spans = [(float(t0[j]), float(t1[j])) for j in g]
            if _union(spans) >= WALL_COVER_MIN * length:
                off = float(np.mean([abs(d[j]) for j in g]))
                if lo <= off <= hi:
                    span = (min(s[0] for s in spans), max(s[1] for s in spans))
                    if _band_filled(ln, pg, side, off, span):
                        return True
                break
            k += len(g)
    return False


def _band_filled(
    ln: BeamLine, pg: _Page, side: float, off: float, span: tuple[float, float]
) -> bool:
    """Fill items (hatch segments, short strokes, small shapes) in the band between the line and
    its partner along `span`: at least max(WALL_FILL_MIN_ITEMS, span / WALL_FILL_SPACING_PT)."""
    own = np.zeros(len(pg.seg), dtype=bool)
    own[ln.seg_ids] = True
    # short strokes and cross strokes count only when the clean step kept them (stroked lettering
    # is not fill); a cross stroke is not parallel to the faces and no longer than
    # WALL_CROSS_MAX_X times the band
    cross = (_angle_diff(pg.angle, _line_angle(ln)) > WALL_PARALLEL_DEG) & (
        pg.length <= WALL_CROSS_MAX_X * off
    )
    item = (pg.hatch | (((pg.length <= WALL_FILL_ITEM_MAX_PT) | cross) & pg.keep)) & ~own
    pts = pg.mid[item]
    if len(pg.small):
        pts = np.concatenate([pts, pg.small])
    if len(pts) == 0:
        return False
    t, d = _local(pts, ln)
    d = d * side
    inside = (
        (t >= span[0])
        & (t <= span[1])
        & (d > WALL_BAND_MARGIN_PT)
        & (d < off - WALL_BAND_MARGIN_PT)
    )
    need = max(WALL_FILL_MIN_ITEMS, (span[1] - span[0]) / WALL_FILL_SPACING_PT)
    return int(inside.sum()) >= need


def _filled_band(ln: BeamLine, pg: _Page, lo: float, hi: float) -> bool:
    """The line runs along a closed filled band of wall thickness (axis-aligned bbox)."""
    ang = _line_angle(ln)
    horiz = min(ang, 180.0 - ang) <= WALL_PARALLEL_DEG
    vert = abs(ang - 90.0) <= WALL_PARALLEL_DEG
    if not (horiz or vert):
        return False
    mx, my = (ln.p0[0] + ln.p1[0]) / 2, (ln.p0[1] + ln.p1[1]) / 2
    for x0, y0, x1, y1 in pg.bands:
        w, h = x1 - x0, y1 - y0
        thick, long = (h, w) if horiz else (w, h)
        if not (max(lo, FILLED_BAND_MIN_PT) <= thick <= hi and long >= FILLED_BAND_ASPECT * thick):
            continue
        m = WALL_BAND_MARGIN_PT
        if not (x0 - m <= mx <= x1 + m and y0 - m <= my <= y1 + m):
            continue
        a, b = (ln.p0[0], ln.p1[0]) if horiz else (ln.p0[1], ln.p1[1])
        c0, c1 = (x0, x1) if horiz else (y0, y1)
        overlap = min(max(a, b), c1) - max(min(a, b), c0)
        if overlap >= WALL_COVER_MIN * ln.length:
            return True
    return False


def is_column_shape_edge(ln: BeamLine, pg: _Page, positions: np.ndarray, ratio: float) -> bool:
    """Rule "column_shape" (module note)."""
    _, _, _, _, length = _frame(ln)
    if length > real_pt(COLUMN_SHAPE_MAX_IN, ratio) or len(positions) == 0:
        return False
    t, d = _local(positions, ln)
    near = np.flatnonzero(
        (t >= COLUMN_SHAPE_T_MIN * length)
        & (t <= (1 - COLUMN_SHAPE_T_MIN) * length)
        & (np.abs(d) >= COLUMN_SHAPE_OFF_MIN * length)
        & (np.abs(d) <= COLUMN_SHAPE_OFF_MAX * length + COLUMN_SHAPE_END_TOL_PT)
    )
    if len(near) == 0:
        return False
    perp = _angle_diff(pg.angle, (_line_angle(ln) + 90.0) % 180.0) <= COLUMN_SHAPE_PERP_DEG
    idx = np.flatnonzero(perp)
    if len(idx) == 0:
        return False
    a_t, a_d = _local(pg.seg[idx][:, 0:2], ln)
    b_t, b_d = _local(pg.seg[idx][:, 2:4], ln)
    tol = COLUMN_SHAPE_TOUCH_PT
    for k in near:
        side = 1.0 if d[k] > 0 else -1.0

        # a perpendicular leaving the line at `at` towards the position: one end on the line there,
        # the other end on the position's side
        def leaves(lo: float, hi: float, side: float = side) -> bool:
            for t_on, d_on, d_off in ((a_t, a_d, b_d), (b_t, b_d, a_d)):
                hit = (
                    (np.abs(d_on) <= tol)
                    & (t_on >= lo - tol)
                    & (t_on <= hi + tol)
                    & (d_off * side >= tol)
                )
                if hit.any():
                    return True
            return False

        if (leaves(0.0, 0.0) and leaves(length, length)) or leaves(length / 3, 2 * length / 3):
            return True
    return False


def not_beams(
    lines: list[BeamLine],
    ps: PageSegments,
    cleaned: Cleaned,
    ratio: float,
    column_points: list[Pt],
    plates: list[BasePlate] | None = None,
) -> Removed:
    """The beam lines without the wall faces, the lines of base plates (src/build/base_plates.py,
    rule "base_plate") and column-shape edges (ids kept as they were)."""
    if not lines:
        return Removed(lines=[])
    pg = _Page.of(ps, cleaned)
    positions = np.asarray(column_points, dtype=float).reshape(-1, 2)
    out = Removed(lines=[])
    for ln in lines:
        # a base plate first: its parallel edges with bolts between would read as a wall
        if plates and plate_line(plates, ln.p0, ln.p1):
            out.base_plate.append(ln.id)
        elif is_wall_face(ln, pg, ratio):
            out.wall.append(ln.id)
        elif is_column_shape_edge(ln, pg, positions, ratio):
            out.column_shape.append(ln.id)
        else:
            out.lines.append(ln)
    return out
