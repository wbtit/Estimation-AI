"""Step 5a: column glyphs on the page (port of find_glyphs in the Phase 7 grammar).

A glyph candidate is a small closed or filled shape: long side 3 to 24 pt, short side at least 3 pt,
aspect at most 3, at most 20 vertices, centre inside the crop, not a grid bubble and not inside a
text box. Overlapping shapes (IoU > 0.5) are one glyph (the largest). `at_grid` = within AT_GRID_PT
of a grid crossing.

On the column plan, the columns are the glyphs at grid crossings. Without a usable grid there, the
columns are the glyphs of the most frequent shape signature (paint, size rounded to 1 pt), when at
least REPEAT_MIN glyphs share it (a repeated column symbol); the build run notes which rule was
used. On a framing page a glyph becomes a support only through supports.py (at a grid crossing, or
touched by at least two beam lines).
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from src.build.geom import Box, Pt, in_box
from src.build.grids import Bubble, Crossing
from src.build.segments import PageSegments, TextLine

GLYPH_LONG_MIN, GLYPH_LONG_MAX, GLYPH_SHORT_MIN, GLYPH_ASPECT = 3.0, 24.0, 3.0, 3.0
GLYPH_MAX_VERTS, GLYPH_IOU = 20, 0.5
AT_GRID_PT = 30.0
REPEAT_MIN = 4
# Phase 12b rule "column_glyph_shape": a glyph chosen by the repeated-glyph rule must have a
# column-like outline: straight-sided, closed, COLUMN_GLYPH_VERTS corners, long side
# COLUMN_GLYPH_MIN_IN to COLUMN_GLYPH_MAX_IN at the view's scale (rebar dots, elevation targets and
# triangle markers are not columns)
COLUMN_GLYPH_VERTS = (4, 12)
COLUMN_GLYPH_MIN_IN = 4.0
COLUMN_GLYPH_MAX_IN = 36.0
TEXT_PAD_PT = 1.0
# Phase 13c flag "column_strokes" (F4a, off by default): open strokes whose ends meet within the
# end gap form one glyph when they close an outline of 4 sides (rect / square), 12 sides (I) or more
# than 12 pieces around a centre (circle); sides = strokes merged when collinear and touching
STROKE_GAP_PT = 1.0
STROKE_SIDE_DEG = 2.0
STROKE_SIDE_OFFSET_PT = 1.0
STROKE_CIRCLE_TOL = 0.15
SQUARE_ASPECT = 1.2
# Phase 13c flag "column_off_grid" (F4b, off by default): a glyph off the grid is a column when it
# matches the page's column symbol (the most common type and size of the at-grid columns, at least
# REPEAT_MIN of them) within max(SYMBOL_TOL_PT, SYMBOL_TOL_REL) in width and height
SYMBOL_TOL_PT = 1.0
SYMBOL_TOL_REL = 0.10


@dataclass
class Glyph:
    shape_ids: list[int]
    box: Box
    paint: str
    n_verts: int
    at_grid: bool
    grid: Crossing | None
    curved: bool = False  # the outline has a curve (a circle, a target)
    outline: str | None = None  # Phase 13c stroke glyphs: rect, square, I or circle

    @property
    def centre(self) -> Pt:
        return ((self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2)

    @property
    def half_diag(self) -> float:
        return math.hypot(self.box[2] - self.box[0], self.box[3] - self.box[1]) / 2

    @property
    def signature(self) -> tuple[str, int, int]:
        w, h = self.box[2] - self.box[0], self.box[3] - self.box[1]
        return ("filled" if "f" in self.paint else "outline", round(w), round(h))


def _iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class _TextIndex:
    """Text boxes in a coarse grid, so a shape only looks at the boxes around it."""

    CELL = 50.0

    def __init__(self, boxes: list[Box]):
        self.cells: dict[tuple[int, int], list[Box]] = {}
        for b in boxes:
            for gx in range(int(b[0] // self.CELL), int(b[2] // self.CELL) + 1):
                for gy in range(int(b[1] // self.CELL), int(b[3] // self.CELL) + 1):
                    self.cells.setdefault((gx, gy), []).append(b)

    def contains(self, box: Box) -> bool:
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        return any(
            box[0] >= t[0] - TEXT_PAD_PT
            and box[1] >= t[1] - TEXT_PAD_PT
            and box[2] <= t[2] + TEXT_PAD_PT
            and box[3] <= t[3] + TEXT_PAD_PT
            for t in self.cells.get((int(cx // self.CELL), int(cy // self.CELL)), ())
        )


def find_glyphs(
    ps: PageSegments,
    crop: Box,
    bubbles: list[Bubble],
    text: list[TextLine],
    grid: list[Crossing],
) -> list[Glyph]:
    bubble_shapes = {b.shape for b in bubbles}
    text_index = _TextIndex([t.box for t in text])
    by_id = {sh.id: sh for sh in ps.shapes}
    cands = []
    for sh in ps.shapes:
        if sh.id in bubble_shapes or not (sh.closed or "f" in sh.paint):
            continue
        if not 3 <= len(sh.pts) <= GLYPH_MAX_VERTS:
            continue
        w, h = sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]
        long_s, short_s = max(w, h), min(w, h)
        if not GLYPH_LONG_MIN <= long_s <= GLYPH_LONG_MAX or short_s < GLYPH_SHORT_MIN:
            continue
        if long_s / short_s > GLYPH_ASPECT:
            continue
        c = ((sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2)
        if not in_box(c, crop) or text_index.contains(sh.bbox):
            continue
        cands.append((w * h, sh))
    cands.sort(key=lambda t: (-t[0], t[1].id))
    kept: list[tuple[object, list[int]]] = []
    cells: dict[tuple[int, int], list[int]] = {}
    cell = 2 * GLYPH_LONG_MAX
    for _, sh in cands:
        gx, gy = int(sh.bbox[0] // cell), int(sh.bbox[1] // cell)
        near = sorted(
            {k for dx in (-1, 0, 1) for dy in (-1, 0, 1) for k in cells.get((gx + dx, gy + dy), ())}
        )
        for k in near:
            if _iou(sh.bbox, kept[k][0].bbox) > GLYPH_IOU:
                kept[k][1].append(sh.id)
                break
        else:
            cells.setdefault((gx, gy), []).append(len(kept))
            kept.append((sh, [sh.id]))
    out = []
    for sh, ids in kept:
        c = ((sh.bbox[0] + sh.bbox[2]) / 2, (sh.bbox[1] + sh.bbox[3]) / 2)
        near = min(grid, key=lambda g: math.dist(g.point, c), default=None)
        at = near is not None and math.dist(near.point, c) <= AT_GRID_PT
        paint = "fs" if any("f" in by_id[i].paint for i in ids) else "s"
        curved = any(by_id[i].curved for i in ids)
        out.append(
            Glyph(sorted(ids), sh.bbox, paint, len(sh.pts), at, near if at else None, curved)
        )
    out.sort(key=lambda g: (round(g.centre[1], 1), round(g.centre[0], 1)))
    return out


def column_like(g: Glyph, ratio: float | None) -> bool:
    """Rule "column_glyph_shape" (constants above)."""
    if g.curved or not COLUMN_GLYPH_VERTS[0] <= g.n_verts <= COLUMN_GLYPH_VERTS[1]:
        return False
    if ratio is None:
        return True
    long_in = max(g.box[2] - g.box[0], g.box[3] - g.box[1]) / 72.0 * ratio
    return COLUMN_GLYPH_MIN_IN <= long_in <= COLUMN_GLYPH_MAX_IN


def column_plan_columns(
    glyphs: list[Glyph],
    has_grid: bool,
    ratio: float | None = None,
    symbol_shapes: dict[int, object] | None = None,
) -> tuple[list[Glyph], str]:
    """The columns of a column plan page and the rule that chose them. Phase 12b: the
    repeated-glyph rule only looks at column-like glyphs (rule "column_glyph_shape"); a glyph at a
    grid crossing needs no shape test."""
    if has_grid:
        cols = [g for g in glyphs if g.at_grid]
        if cols:
            # one column per grid crossing: the glyph nearest to it
            best: dict[tuple[str, str], Glyph] = {}
            for g in cols:
                assert g.grid is not None
                key = (g.grid.n_label, g.grid.a_label)
                cur = best.get(key)
                if cur is None or math.dist(g.centre, g.grid.point) < math.dist(
                    cur.centre, cur.grid.point
                ):
                    best[key] = g
            chosen = sorted(best.values(), key=lambda g: (g.centre[1], g.centre[0]))
            if symbol_shapes is not None:
                extra = off_grid_columns(glyphs, chosen, symbol_shapes)
                if extra:
                    chosen = sorted(chosen + extra, key=lambda g: (g.centre[1], g.centre[0]))
                    return chosen, "glyph_at_grid+symbol"
            return chosen, "glyph_at_grid"
    glyphs = [g for g in glyphs if column_like(g, ratio)]
    counts = Counter(g.signature for g in glyphs)
    if not counts:
        return [], "none"
    sig, n = min(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    if n < REPEAT_MIN:
        return [], "none"
    return [g for g in glyphs if g.signature == sig], "repeated_glyph"


# --- Phase 13c F4 (behind flags) ------------------------------------------------------------------


def outline_type(n_corners: int, w: float, h: float) -> str | None:
    if n_corners == 4:
        lo, hi = min(w, h), max(w, h)
        return "square" if lo > 0 and hi / lo <= SQUARE_ASPECT else "rect"
    if n_corners == 12:
        return "I"
    return None


def _corners(pts) -> int:
    out: list[tuple[float, float]] = []
    for x, y in pts:
        q = (round(x, 1), round(y, 1))
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return len(out)


def glyph_type(g: Glyph, shapes: dict[int, object]) -> str | None:
    """rect, square, I or circle (None: other) of a glyph: its stroke outline, else its shape."""
    if g.outline:
        return g.outline
    if g.curved:
        return "circle"
    sh = shapes.get(g.shape_ids[0]) if g.shape_ids else None
    if sh is None:
        return None
    w, h = g.box[2] - g.box[0], g.box[3] - g.box[1]
    return outline_type(_corners(sh.pts), w, h)  # type: ignore[attr-defined]


def off_grid_columns(
    glyphs: list[Glyph], chosen: list[Glyph], shapes: dict[int, object]
) -> list[Glyph]:
    """F4b: glyphs off the grid that match the page's column symbol."""
    keys = Counter(
        (t, round(g.box[2] - g.box[0]), round(g.box[3] - g.box[1]))
        for g in chosen
        if (t := glyph_type(g, shapes))
    )
    if not keys:
        return []
    (t, sw, sh), n = min(keys.items(), key=lambda kv: (-kv[1], kv[0][1] * kv[0][2], kv[0]))
    if n < REPEAT_MIN:
        return []
    have = {id(g) for g in chosen}
    out = []
    for g in glyphs:
        if id(g) in have or g.at_grid or glyph_type(g, shapes) != t:
            continue
        w, h = g.box[2] - g.box[0], g.box[3] - g.box[1]
        if abs(w - sw) <= max(SYMBOL_TOL_PT, SYMBOL_TOL_REL * sw) and abs(h - sh) <= max(
            SYMBOL_TOL_PT, SYMBOL_TOL_REL * sh
        ):
            out.append(g)
    return out


def _sides(segs: list[tuple[float, float, float, float]], gap: float) -> int:
    """Strokes merged when collinear (STROKE_SIDE_DEG, STROKE_SIDE_OFFSET_PT) and touching."""
    n = len(segs)
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    ang = [math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0 for s in segs]
    for i in range(n):
        x0, y0, x1, y1 = segs[i]
        L = math.hypot(x1 - x0, y1 - y0) or 1.0
        nx, ny = -(y1 - y0) / L, (x1 - x0) / L
        for j in range(i + 1, n):
            d = abs(ang[i] - ang[j]) % 180.0
            if min(d, 180.0 - d) > STROKE_SIDE_DEG:
                continue
            o = segs[j]
            off = max(
                abs((o[0] - x0) * nx + (o[1] - y0) * ny), abs((o[2] - x0) * nx + (o[3] - y0) * ny)
            )
            if off > STROKE_SIDE_OFFSET_PT:
                continue
            ends_i = ((x0, y0), (x1, y1))
            ends_j = ((o[0], o[1]), (o[2], o[3]))
            if min(math.dist(p, q) for p in ends_i for q in ends_j) <= gap:
                parent[find(i)] = find(j)
    return len({find(i) for i in range(n)})


def stroke_glyphs(
    ps: PageSegments,
    keep,
    crop: Box,
    bubbles: list[Bubble],
    text: list[TextLine],
    grid: list[Crossing],
    existing: list[Glyph],
    gap: float = STROKE_GAP_PT,
) -> list[Glyph]:
    """F4a: glyphs from open strokes (module constants above)."""
    shapes = {sh.id: sh for sh in ps.shapes}
    bubble_shapes = {b.shape for b in bubbles}
    length = ps.length() if len(ps) else []
    ids = [
        i
        for i in range(len(ps))
        if keep[i]
        and 0 < length[i] <= GLYPH_LONG_MAX
        and (sh := shapes.get(int(ps.shape_id[i]))) is not None
        and not sh.closed
        and "f" not in sh.paint
        and sh.id not in bubble_shapes
    ]
    if not ids:
        return []
    # union of strokes whose ends meet within the gap (ends hashed in cells of the gap)
    parent = {i: i for i in ids}

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    cell = max(gap, 1e-6)
    ends: dict[tuple[int, int], list[tuple[float, float, int]]] = {}
    for i in ids:
        x0, y0, x1, y1 = map(float, ps.seg[i])
        for x, y in ((x0, y0), (x1, y1)):
            ends.setdefault((int(x // cell), int(y // cell)), []).append((x, y, i))
    meets: dict[tuple[int, float, float], bool] = {}
    for (cx, cy), pts in ends.items():
        near = [
            q for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in ends.get((cx + dx, cy + dy), ())
        ]
        for x, y, i in pts:
            for qx, qy, j in near:
                if j != i and math.hypot(qx - x, qy - y) <= gap:
                    parent[find(i)] = find(j)
                    meets[(i, x, y)] = True
    groups: dict[int, list[int]] = {}
    for i in ids:
        groups.setdefault(find(i), []).append(i)
    text_index = _TextIndex([t.box for t in text])
    out: list[Glyph] = []
    for members in sorted(groups.values(), key=lambda m: min(m)):
        if len(members) < 2:
            continue
        segs = [tuple(map(float, ps.seg[i])) for i in members]
        xs = [v for s in segs for v in (s[0], s[2])]
        ys = [v for s in segs for v in (s[1], s[3])]
        box = (min(xs), min(ys), max(xs), max(ys))
        w, h = box[2] - box[0], box[3] - box[1]
        long_s, short_s = max(w, h), min(w, h)
        if not GLYPH_LONG_MIN <= long_s <= GLYPH_LONG_MAX or short_s < GLYPH_SHORT_MIN:
            continue
        if long_s / short_s > GLYPH_ASPECT:
            continue
        c = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        if not in_box(c, crop) or text_index.contains(box):
            continue
        # closed: every stroke end meets another stroke's end
        if not all(meets.get((i, float(x), float(y))) for i, s in zip(members, segs, strict=True)
                   for x, y in ((s[0], s[1]), (s[2], s[3]))):  # fmt: skip
            continue
        sides = _sides(segs, gap)
        kind = outline_type(sides, w, h)
        curved = False
        if kind is None and len(segs) > 12:
            r = [math.dist(c, (x, y)) for x, y in zip(xs, ys, strict=True)]
            mean = sum(r) / len(r)
            if mean > 0 and all(abs(v - mean) <= STROKE_CIRCLE_TOL * mean for v in r):
                kind, curved = "circle", True
        if kind is None:
            continue
        if any(_iou(box, g.box) > GLYPH_IOU for g in existing + out):
            continue
        near = min(grid, key=lambda g: math.dist(g.point, c), default=None)
        at = near is not None and math.dist(near.point, c) <= AT_GRID_PT
        sids = sorted({int(ps.shape_id[i]) for i in members})
        out.append(Glyph(sids, box, "s", sides, at, near if at else None, curved, kind))
    return out
