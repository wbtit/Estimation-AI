"""Line reconstruction from PDF path data, in DISPLAYED page points (page rotation applied).

Segments of stroked paths (and thin filled rectangles, which some producers use for thick lines)
are collected with width, colour class and layer. Touching collinear segments are merged; equal
short collinear segments chained end to end become one dashed line. A stroke class is
(width bucket, colour class, solid or dash). Ported from the Phase 4e study tools.
"""

import math
from dataclasses import dataclass

import numpy as np
import pymupdf

MERGE_GAP_PT = 1.0  # touching: collinear segments closer than this are one line
COLLINEAR_PT = 0.6  # perpendicular offset tolerance
ANGLE_BIN_DEG = 0.5
DASH_MIN, DASH_MAX, DASH_RUN_MIN = 1.0, 14.0, 4
MIN_LINE_PT = 3.0
WIDTH_BUCKETS = [
    (0.1, "<0.1"),
    (0.25, "0.1-0.25"),
    (0.5, "0.25-0.5"),
    (1.0, "0.5-1"),
    (1.5, "1-1.5"),
    (2.5, "1.5-2.5"),
    (1e9, ">2.5"),
]
# heavier first: used to suggest the structural class
WEIGHT_ORDER = [">2.5", "1.5-2.5", "1-1.5", "0.5-1", "0.25-0.5", "0.1-0.25", "<0.1"]


@dataclass(frozen=True)
class Line:
    x0: float
    y0: float
    x1: float
    y1: float
    width: float
    colour: str
    dashed: bool
    n_src: int

    @property
    def length(self) -> float:
        return math.hypot(self.x1 - self.x0, self.y1 - self.y0)

    @property
    def klass(self) -> str:
        return class_key(self.width, self.colour, self.dashed)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (
            min(self.x0, self.x1),
            min(self.y0, self.y1),
            max(self.x0, self.x1),
            max(self.y0, self.y1),
        )


def width_bucket(w: float) -> str:
    for hi, name in WIDTH_BUCKETS:
        if w < hi:
            return name
    return ">2.5"


def class_key(width: float, colour: str, dashed: bool) -> str:
    return f"{width_bucket(width)}|{colour}|{'dash' if dashed else 'solid'}"


def colour_class(c) -> str:
    if c is None:
        return "none"
    r, g, b = (c[0], c[0], c[0]) if len(c) == 1 else (list(c) + [0, 0, 0])[:3]
    if max(r, g, b) < 0.15:
        return "black"
    if max(r, g, b) - min(r, g, b) < 0.1:
        return "grey"
    if r > 0.6 and g < 0.4 and b < 0.4:
        return "red"
    if g > 0.6 and r < 0.4 and b < 0.4:
        return "green"
    if b > 0.6 and r < 0.4 and g < 0.4:
        return "blue"
    return "other"


Segment = tuple[float, float, float, float, float, str]  # x0 y0 x1 y1 width colour


def page_segments(page: pymupdf.Page) -> list[Segment]:
    m = page.rotation_matrix
    segs: list[Segment] = []
    for d in page.get_cdrawings():
        kind = d.get("type")
        if kind == "f":
            rect = pymupdf.Rect(d["rect"]) * m
            rect.normalize()
            w, h = rect.width, rect.height
            long_side, thin = max(w, h), min(w, h)
            if long_side >= 8 and thin > 0 and long_side / thin >= 8 and thin <= 6:
                col = colour_class(d.get("fill"))
                if w >= h:
                    cy = (rect.y0 + rect.y1) / 2
                    segs.append((rect.x0, cy, rect.x1, cy, thin, col))
                else:
                    cx = (rect.x0 + rect.x1) / 2
                    segs.append((cx, rect.y0, cx, rect.y1, thin, col))
            continue
        if kind not in ("s", "fs"):
            continue
        w = d.get("width") or 0.0
        col = colour_class(d.get("color"))
        for it in d["items"]:
            if it[0] == "l":
                p, q = pymupdf.Point(it[1]) * m, pymupdf.Point(it[2]) * m
                segs.append((p.x, p.y, q.x, q.y, w, col))
            elif it[0] == "re":
                r = pymupdf.Rect(it[1]) * m
                r.normalize()
                corners = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)]
                for a, b in zip(corners, corners[1:], strict=False):
                    segs.append((a[0], a[1], b[0], b[1], w, col))
    return segs


def _merge_collinear(group: list[tuple[float, float, float, float]]):
    buckets: dict[tuple[int, int], list[tuple[float, float, float, float]]] = {}
    for x0, y0, x1, y1 in group:
        ang = math.atan2(y1 - y0, x1 - x0) % math.pi
        a_bin = round(math.degrees(ang) / ANGLE_BIN_DEG) % round(180 / ANGLE_BIN_DEG)
        off = -x0 * math.sin(ang) + y0 * math.cos(ang)
        buckets.setdefault((a_bin, round(off / COLLINEAR_PT)), []).append((x0, y0, x1, y1))
    out = []
    for (a_bin, _), segs in buckets.items():
        ang = math.radians(a_bin * ANGLE_BIN_DEG)
        ux, uy = math.cos(ang), math.sin(ang)
        iv = []
        for x0, y0, x1, y1 in segs:
            a, b = x0 * ux + y0 * uy, x1 * ux + y1 * uy
            iv.append((min(a, b), max(a, b), (x0, y0, x1, y1)))
        iv.sort(key=lambda t: t[0])
        cur_lo, cur_hi, n = iv[0][0], iv[0][1], 1
        ref = iv[0][2]
        base_off = -ref[0] * uy + ref[1] * ux
        for lo, hi, _ in iv[1:]:
            if lo <= cur_hi + MERGE_GAP_PT:
                cur_hi = max(cur_hi, hi)
                n += 1
            else:
                out.append(_point(ux, uy, base_off, cur_lo, cur_hi, n))
                cur_lo, cur_hi, n = lo, hi, 1
        out.append(_point(ux, uy, base_off, cur_lo, cur_hi, n))
    return out


def _point(ux: float, uy: float, off: float, lo: float, hi: float, n: int):
    nx, ny = -uy, ux
    return (lo * ux + off * nx, lo * uy + off * ny, hi * ux + off * nx, hi * uy + off * ny, n)


def _dash_chains(segs: list[tuple[float, float, float, float]]) -> list[list[int]]:
    if len(segs) < DASH_RUN_MIN:
        return []
    arr = np.array(segs, dtype=float)
    flip = (arr[:, 2] < arr[:, 0]) | ((arr[:, 2] == arr[:, 0]) & (arr[:, 3] < arr[:, 1]))
    arr[flip] = arr[flip][:, [2, 3, 0, 1]]
    length = np.hypot(arr[:, 2] - arr[:, 0], arr[:, 3] - arr[:, 1])
    ang = np.arctan2(arr[:, 3] - arr[:, 1], arr[:, 2] - arr[:, 0])
    cell = 30.0
    grid: dict[tuple[int, int], list[int]] = {}
    for i, (x, y) in enumerate(arr[:, :2]):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(i)
    nxt: dict[int, int] = {}
    taken: set[int] = set()
    for i in range(len(arr)):
        ex, ey = arr[i, 2], arr[i, 3]
        gx, gy = int(ex // cell), int(ey // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j == i or j in taken or i in nxt:
                        continue
                    vx, vy = arr[j, 0] - ex, arr[j, 1] - ey
                    if vx * math.cos(ang[i]) + vy * math.sin(ang[i]) <= 0:
                        continue
                    gap = math.hypot(vx, vy)
                    if not 0.2 * length[i] <= gap <= 2.5 * length[i]:
                        continue
                    if abs(length[j] - length[i]) > 0.15 * length[i] + 0.2:
                        continue
                    if abs(math.atan2(math.sin(ang[j] - ang[i]), math.cos(ang[j] - ang[i]))) > 0.03:
                        continue
                    if abs(-vx * math.sin(ang[i]) + vy * math.cos(ang[i])) > 0.4:
                        continue
                    nxt[i] = j
                    taken.add(j)
    prev = {j: i for i, j in nxt.items()}
    chains = []
    for start in (i for i in range(len(arr)) if i not in prev):
        chain, cur = [start], start
        while cur in nxt:
            cur = nxt[cur]
            chain.append(cur)
        if len(chain) >= DASH_RUN_MIN:
            chains.append(chain)
    return chains


def reconstruct(segs: list[Segment]) -> list[Line]:
    styles: dict[tuple[float, str], list[Segment]] = {}
    for s in segs:
        if math.hypot(s[2] - s[0], s[3] - s[1]) < 0.05:
            continue
        styles.setdefault((round(s[4], 2), s[5]), []).append(s)
    lines: list[Line] = []
    for (w, col), group in styles.items():
        short = [g for g in group if DASH_MIN <= math.hypot(g[2] - g[0], g[3] - g[1]) <= DASH_MAX]
        in_chain: set[int] = set()
        for chain in _dash_chains([g[:4] for g in short]):
            ids = [short[k] for k in chain]
            in_chain.update(id(x) for x in ids)
            pts = [(g[0], g[1]) for g in ids] + [(g[2], g[3]) for g in ids]
            a, b = min(pts), max(pts)
            lines.append(Line(a[0], a[1], b[0], b[1], w, col, True, len(ids)))
        rest = [g for g in group if id(g) not in in_chain]
        for x0, y0, x1, y1, n in _merge_collinear([g[:4] for g in rest]):
            ln = Line(x0, y0, x1, y1, w, col, False, n)
            if ln.length >= MIN_LINE_PT:
                lines.append(ln)
    return lines


def page_lines(page: pymupdf.Page) -> list[Line]:
    return reconstruct(page_segments(page))
