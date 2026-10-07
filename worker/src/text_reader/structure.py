"""Structure-only categories for choosing evaluation lines. No text is read or needed.

Used by the accuracy harness to build a stratified ground-truth sample. A line is assigned to the
first matching category (priority: callout, scale, legend, dimension, mark, sheet) from page
GEOMETRY only. These rules choose which lines to ask a person to transcribe; they say nothing about
what the lines contain, and they are not used for decoding.

  callout    centre inside a detected circle of 8 to 16 pt radius (detail/section bubbles)
  scale      two stacked, aligned horizontal bars inside the line (an "=" sign)
  legend     a colon (two stacked dots) after at most 4 characters, e.g. "B1: ..." entries
  dimension  lies between two small filled triangles (arrowheads) on the same level
  mark       2 to 6 characters sitting within 10 pt of a long, thick horizontal stroke (a member)
  sheet      in the title-block corner (right 16% and bottom 30% of the page) with tall characters
"""

import math
from dataclasses import dataclass, field

import numpy as np
import pymupdf

from src.text_reader import rules
from src.text_reader.lines import Line, _typical_height
from src.text_reader.strokes import _is_dark, _stroke_points

CATEGORIES = ("callout", "scale", "legend", "dimension", "mark", "sheet")

LONG_SEGMENT_PT = 60.0
MEMBER_MIN_WIDTH = 1.1  # stroke width of a structural member line (1.44 in the test set)
MARK_MAX_DISTANCE_PT = 10.0
CIRCLE_R_MIN, CIRCLE_R_MAX = 8.0, 16.0
CIRCLE_FIT_RMS, CIRCLE_MIN_ARC_DEG = 0.03, 300.0
ARROW_MIN_PT, ARROW_MAX_PT = 3.0, 12.0
ARROW_LEVEL_TOL_PT = 1.5
DIM_TEXT_MAX_OFFSET_PT = 12.0
EQUALS_BAR_MAX_H, EQUALS_BAR_MIN_W, EQUALS_BAR_MAX_W = 0.5, 2.5, 6.5
EQUALS_DY_MIN, EQUALS_DY_MAX = 1.0, 3.5
LEGEND_MAX_CHARS_BEFORE_COLON = 4
SHEET_X_FRACTION, SHEET_Y_FRACTION, SHEET_MIN_CHAR_HEIGHT = 0.84, 0.70, 8.0


@dataclass
class Geometry:
    segments: list[tuple[float, float, float, float, float]] = field(default_factory=list)
    triangles: list[tuple[float, float]] = field(default_factory=list)
    circles: list[tuple[float, float, float]] = field(default_factory=list)


def _fit_circle(pts: np.ndarray):
    x, y = pts[:, 0], pts[:, 1]
    a = np.c_[2 * x, 2 * y, np.ones(len(x))]
    (cx, cy, c), *_ = np.linalg.lstsq(a, x**2 + y**2, rcond=None)
    r = math.sqrt(max(c + cx**2 + cy**2, 0.0))
    res = np.hypot(x - cx, y - cy) - r
    ang = np.sort(np.arctan2(y - cy, x - cx))
    gaps = np.diff(np.r_[ang, ang[0] + 2 * math.pi])
    return (
        cx,
        cy,
        r,
        float(np.sqrt((res**2).mean()) / r) if r else 9.0,
        360 - math.degrees(gaps.max()),
    )


def page_geometry(page: pymupdf.Page) -> Geometry:
    """Long thick segments, small filled triangles and circles, in displayed coordinates."""
    g = Geometry()
    matrix = page.rotation_matrix
    for d in page.get_drawings():
        if d["type"] == "s" and _is_dark(d["color"]):
            for it in d["items"]:
                if it[0] == "l":
                    p, q = pymupdf.Point(it[1]) * matrix, pymupdf.Point(it[2]) * matrix
                    if math.dist(p, q) >= LONG_SEGMENT_PT:
                        g.segments.append((p.x, p.y, q.x, q.y, d["width"] or 0.0))
            if len(d["items"]) >= 2:
                r_box = d["rect"]
                if 7 <= max(r_box.width, r_box.height) <= 90:
                    pts = np.array(_stroke_points(d["items"], matrix))
                    if len(pts) >= 12:
                        cx, cy, r, rms, arc = _fit_circle(pts)
                        if (
                            CIRCLE_R_MIN <= r <= CIRCLE_R_MAX
                            and rms < CIRCLE_FIT_RMS
                            and arc >= CIRCLE_MIN_ARC_DEG
                        ):
                            g.circles.append((cx, cy, r))
        elif d["type"] == "f":
            r_box = d["rect"]
            size = max(r_box.width, r_box.height)
            if ARROW_MIN_PT <= size <= ARROW_MAX_PT:
                pts = _stroke_points(d["items"], matrix)
                if len({(round(x, 2), round(y, 2)) for x, y in pts}) == 3:
                    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                    g.triangles.append(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2))
    return g


def _has_equals(line: Line) -> bool:
    bars = [
        c
        for c in line.members
        if c.h <= EQUALS_BAR_MAX_H and EQUALS_BAR_MIN_W <= c.w <= EQUALS_BAR_MAX_W
    ]
    return any(
        abs(a.x0 - b.x0) <= rules.EQUALS_EDGE_TOL_PT
        and abs(a.x1 - b.x1) <= rules.EQUALS_EDGE_TOL_PT
        and EQUALS_DY_MIN <= abs(a.cy - b.cy) <= EQUALS_DY_MAX
        for i, a in enumerate(bars)
        for b in bars[i + 1 :]
    )


def _has_early_colon(line: Line) -> bool:
    dots = [m for m in line.marks if m.w < rules.DOT_MAX_PT and m.h < rules.DOT_MAX_PT]
    for i, a in enumerate(dots):
        for b in dots[i + 1 :]:
            if abs(a.cx - b.cx) <= rules.COLON_DX_PT and abs(a.cy - b.cy) >= rules.COLON_MIN_DY_PT:
                before = sum(1 for m in line.members if m.x1 <= a.x0 + 0.5)
                if 1 <= before <= LEGEND_MAX_CHARS_BEFORE_COLON:
                    return True
    return False


def _dimension_between_arrowheads(tri: np.ndarray, cx: float, cy: float, width: float) -> bool:
    near = tri[np.abs(tri[:, 1] - cy) <= DIM_TEXT_MAX_OFFSET_PT]
    left, right = near[near[:, 0] < cx], near[near[:, 0] > cx]
    if not len(left) or not len(right):
        return False
    span = max(width, 10.0)
    ok = (np.abs(left[:, None, 1] - right[None, :, 1]) <= ARROW_LEVEL_TOL_PT) & (
        right[None, :, 0] - left[:, None, 0] >= span
    )
    return bool(ok.any())


def categorize_lines(
    lines: list[Line], geom: Geometry, page_w: float, page_h: float
) -> list[str | None]:
    """The structural category of each line (None if it matches none)."""
    circ = np.array(geom.circles).reshape(-1, 3)
    tri = np.array(geom.triangles).reshape(-1, 2)
    seg = np.array(
        [s for s in geom.segments if s[4] >= MEMBER_MIN_WIDTH and abs(s[1] - s[3]) < 0.5]
    ).reshape(-1, 5)
    out: list[str | None] = []
    for line in lines:
        x0, y0, x1, y1 = line.bbox
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if len(circ) and (np.hypot(cx - circ[:, 0], cy - circ[:, 1]) < 0.95 * circ[:, 2]).any():
            out.append("callout")
        elif _has_equals(line):
            out.append("scale")
        elif _has_early_colon(line):
            out.append("legend")
        elif len(tri) and _dimension_between_arrowheads(tri, cx, cy, x1 - x0):
            out.append("dimension")
        elif (
            2 <= len(line.members) <= 6
            and len(seg)
            and (
                (np.minimum(seg[:, 0], seg[:, 2]) <= cx)
                & (cx <= np.maximum(seg[:, 0], seg[:, 2]))
                & (np.abs(cy - seg[:, 1]) <= MARK_MAX_DISTANCE_PT)
            ).any()
        ):
            out.append("mark")
        elif (
            x0 >= SHEET_X_FRACTION * page_w
            and y0 >= SHEET_Y_FRACTION * page_h
            and _typical_height(line) >= SHEET_MIN_CHAR_HEIGHT
        ):
            out.append("sheet")
        else:
            out.append(None)
    return out
