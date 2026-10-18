"""Person inputs the build reads (Phase 11c, docs/PHASE11C_PLAN.md section 2). Not build rules:
they only take content away before the unchanged steps run.

- Exclude boxes (accepted ones): every segment is clipped to its parts outside every box, shapes
  whose centre lies in a box are dropped, and text lines whose centre lies in a box are dropped.
- Deselected lines: a beam pen segment is removed when it lies on a deselected line: direction
  within DESELECT_ANGLE_DEG, both ends within DESELECT_AXIS_PT of the line's axis, and at least
  DESELECT_OVERLAP of the segment's length inside the line's extent. A deselection that matches no
  pen segment is counted (`unmatched`), so a mismatch between the preview lines and the build's
  segments is never silent.
Pure.
"""

from __future__ import annotations

import math

import numpy as np

from src.build.geom import Box, clip_segment, in_box
from src.build.segments import MIN_SEG_PT, PageSegments, TextLine

DESELECT_ANGLE_DEG = 1.0
DESELECT_AXIS_PT = 1.0
DESELECT_OVERLAP = 0.5

Line = tuple[float, float, float, float]


def _outside(x0: float, y0: float, x1: float, y1: float, boxes: list[Box]) -> list[Line]:
    """The parts of a segment outside every box, in order along it."""
    keep = [(0.0, 1.0)]
    dx, dy = x1 - x0, y1 - y0
    for b in boxes:
        c = clip_segment((x0, y0), (x1, y1), b)
        if c is None:
            continue
        span = dx if abs(dx) >= abs(dy) else dy
        if span == 0:
            return []  # a point inside a box
        base = x0 if abs(dx) >= abs(dy) else y0
        t0 = ((c[0][0] if abs(dx) >= abs(dy) else c[0][1]) - base) / span
        t1 = ((c[1][0] if abs(dx) >= abs(dy) else c[1][1]) - base) / span
        lo, hi = min(t0, t1), max(t0, t1)
        nxt = []
        for a, z in keep:
            if hi <= a or lo >= z:
                nxt.append((a, z))
                continue
            if lo > a:
                nxt.append((a, lo))
            if hi < z:
                nxt.append((hi, z))
        keep = nxt
    out = []
    for a, z in keep:
        p = (x0 + a * dx, y0 + a * dy, x0 + z * dx, y0 + z * dy)
        if math.hypot(p[2] - p[0], p[3] - p[1]) >= MIN_SEG_PT:
            out.append(p)
    return out


def exclude(ps: PageSegments, boxes: list[Box]) -> PageSegments:
    """The segments clipped to the parts outside the boxes; shapes centred in a box dropped."""
    if not boxes:
        return ps
    out = PageSegments(size=ps.size)
    centre = lambda s: ((s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2)  # noqa: E731
    out.shapes = [s for s in ps.shapes if not any(in_box(centre(s), b) for b in boxes)]
    rows, src = [], []
    for i, (x0, y0, x1, y1) in enumerate(ps.seg):
        for part in _outside(float(x0), float(y0), float(x1), float(y1), boxes):
            rows.append(part)
            src.append(i)
    if rows:
        idx = np.asarray(src, dtype=int)
        out.seg = np.asarray(rows, dtype=float)
        out.width = ps.width[idx]
        out.colour = [ps.colour[i] for i in src]
        out.pdf_dashed = ps.pdf_dashed[idx]
        out.shape_id = ps.shape_id[idx]
    return out


def drop_text(text: list[TextLine], boxes: list[Box]) -> list[TextLine]:
    return [t for t in text if not any(in_box(t.centre, b) for b in boxes)]


def _on_line(seg: Line, line: Line) -> bool:
    lx, ly = line[2] - line[0], line[3] - line[1]
    ll = math.hypot(lx, ly)
    sx, sy = seg[2] - seg[0], seg[3] - seg[1]
    sl = math.hypot(sx, sy)
    if ll == 0 or sl == 0:
        return False
    ang = abs(math.degrees(math.atan2(sy, sx)) - math.degrees(math.atan2(ly, lx))) % 180.0
    if min(ang, 180.0 - ang) > DESELECT_ANGLE_DEG:
        return False
    ux, uy = lx / ll, ly / ll

    def along(px: float, py: float) -> float:
        return (px - line[0]) * ux + (py - line[1]) * uy

    def off(px: float, py: float) -> float:
        return abs((px - line[0]) * uy - (py - line[1]) * ux)

    if off(seg[0], seg[1]) > DESELECT_AXIS_PT or off(seg[2], seg[3]) > DESELECT_AXIS_PT:
        return False
    a, b = sorted((along(seg[0], seg[1]), along(seg[2], seg[3])))
    shared = min(b, ll) - max(a, 0.0)
    return shared >= DESELECT_OVERLAP * sl


def deselect(ps: PageSegments, pen_ids: list[int], deselected: list[Line]) -> tuple[set[int], int]:
    """(pen segment ids lying on a deselected line, deselections that matched none)."""
    removed: set[int] = set()
    unmatched = 0
    for d in deselected:
        hit = [i for i in pen_ids if _on_line(tuple(float(v) for v in ps.seg[i]), d)]
        removed.update(hit)
        if not hit:
            unmatched += 1
    return removed, unmatched


__all__ = [
    "DESELECT_ANGLE_DEG",
    "DESELECT_AXIS_PT",
    "DESELECT_OVERLAP",
    "deselect",
    "drop_text",
    "exclude",
]
