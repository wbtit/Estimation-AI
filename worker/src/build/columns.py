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


@dataclass
class Glyph:
    shape_ids: list[int]
    box: Box
    paint: str
    n_verts: int
    at_grid: bool
    grid: Crossing | None
    curved: bool = False  # the outline has a curve (a circle, a target)

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
    glyphs: list[Glyph], has_grid: bool, ratio: float | None = None
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
            return chosen, "glyph_at_grid"
    glyphs = [g for g in glyphs if column_like(g, ratio)]
    counts = Counter(g.signature for g in glyphs)
    if not counts:
        return [], "none"
    sig, n = min(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    if n < REPEAT_MIN:
        return [], "none"
    return [g for g in glyphs if g.signature == sig], "repeated_glyph"
