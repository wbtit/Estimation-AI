"""Line roles for the snap (Phase 9): which extracted lines are hatch or a dimension line.

The rules and constants are the Phase 7 grammar rules v1, unchanged
(tools/takeoff/phase7_grammar.py,
docs/PHASE7_PREREGISTRATION.md 4.2): a page-relative role from the length-weighted width histogram
(thin below the 50th, medium below the 85th percentile, heavy above), hatch = a segment with at
least
four near-parallel neighbours of similar length at small offsets (plus one propagation pass), and a
dimension line = a thin line of 30 pt or more with a terminator (a tick of up to 8 pt at 30 to 60
degrees, or a small filled arrow) at both ends and a number within 12 pt. They run here on the
MERGED lines of `page_lines` (not on raw path segments), so they are a port, not the same numbers.
The snap uses the result: hatch and dimension lines are never snap targets, solid medium and heavy
lines come first. Pure over arrays; `classify_page` reads the page for words and arrows.
Deterministic; no model.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence

import numpy as np
import pymupdf

ROLE_LEN_PT = 12.0
ROLE_Q_THIN, ROLE_Q_MEDIUM = 0.50, 0.85
WIDTH_ROUND = 0.05
HATCH_N, HATCH_ANGLE, HATCH_RATIO, HATCH_OFFSET, HATCH_OVERLAP = 4, 2.0, 0.30, 6.0, 0.5
HATCH, THIN, MEDIUM, HEAVY = 0, 1, 2, 3
DIM_MIN_LEN, TICK_MAX, TICK_END_TOL, DIM_TEXT_RADIUS = 30.0, 8.0, 3.0, 12.0
ARROW_MAX = 10.0
MAX_HATCH_CANDIDATES = 120_000


def _mid(seg: np.ndarray) -> np.ndarray:
    return np.stack([(seg[:, 0] + seg[:, 2]) / 2, (seg[:, 1] + seg[:, 3]) / 2], axis=1)


def _seg_dist(px: float, py: float, s: Sequence[float]) -> float:
    dx, dy = s[2] - s[0], s[3] - s[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - s[0]) * dx + (py - s[1]) * dy) / l2))
    return math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy))


def _angle(s: Sequence[float]) -> float:
    return math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def hatch_mask(seg: np.ndarray, length: np.ndarray) -> np.ndarray:
    """True for hatch segments (see the module note). `seg` is n x 4."""
    n = len(seg)
    out = np.zeros(n, dtype=bool)
    if n < HATCH_N + 1:
        return out
    ang = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180.0
    mid = _mid(seg)
    cand = np.array([i for i in range(n) if 0.5 < length[i] < 400.0], dtype=int)
    if len(cand) == 0 or len(cand) > MAX_HATCH_CANDIDATES:
        return out
    ux = np.cos(np.radians(ang))
    uy = np.sin(np.radians(ang))
    n_bins = int(round(180.0 / HATCH_ANGLE))
    bins = np.floor(ang[cand] / HATCH_ANGLE).astype(int) % n_bins
    neighbours: dict[int, np.ndarray] = {}
    for b in np.unique(bins):
        a_ids = cand[bins == b]
        near_bins = {(b - 1) % n_bins, int(b), (b + 1) % n_bins}
        b_ids = cand[np.isin(bins, list(near_bins))]
        th = math.radians((b + 0.5) * HATCH_ANGLE)
        sin_t, cos_t = math.sin(th), math.cos(th)
        perp_b = -mid[b_ids, 0] * sin_t + mid[b_ids, 1] * cos_t
        order = np.argsort(perp_b, kind="stable")
        b_sorted = b_ids[order]
        perp_sorted = perp_b[order]
        for i in a_ids:
            p_i = -mid[i, 0] * sin_t + mid[i, 1] * cos_t
            margin = HATCH_OFFSET + 0.04 * length[i] + 1.0
            lo = int(np.searchsorted(perp_sorted, p_i - margin, side="left"))
            hi = int(np.searchsorted(perp_sorted, p_i + margin, side="right"))
            js = b_sorted[lo:hi]
            js = js[js != i]
            if len(js) == 0:
                neighbours[int(i)] = js
                continue
            d_ang = np.abs(ang[js] - ang[i]) % 180.0
            d_ang = np.minimum(d_ang, 180.0 - d_ang)
            dx, dy = mid[js, 0] - mid[i, 0], mid[js, 1] - mid[i, 1]
            along = dx * ux[i] + dy * uy[i]
            perp = -dx * uy[i] + dy * ux[i]
            ok = (
                (d_ang <= HATCH_ANGLE)
                & (np.abs(length[js] - length[i]) <= HATCH_RATIO * length[i])
                & (np.abs(perp) <= HATCH_OFFSET)
                & (np.abs(perp) >= 0.2)
                & (1.0 - np.abs(along) / max(float(length[i]), 1e-9) >= HATCH_OVERLAP)
            )
            neighbours[int(i)] = js[ok]
    for i, found in neighbours.items():
        out[i] = len(found) >= HATCH_N
    core = out.copy()
    for i, found in neighbours.items():
        if not core[i] and len(found) and core[found].any():
            out[i] = True
    return out


def assign_roles(seg: np.ndarray, width: np.ndarray) -> np.ndarray:
    """Role per segment: 0 hatch, 1 thin, 2 medium, 3 heavy (by the page's own length-weighted
    width histogram, hatch and lines under 12 pt left out of the histogram). Unlike the grammar,
    a short line that is not part of a hatch stack keeps its width's role (a column outline has
    short sides)."""
    n = len(seg)
    roles = np.full(n, THIN, dtype=int)
    if n == 0:
        return roles
    length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    hatch = hatch_mask(seg, length)
    wr = np.round(width / WIDTH_ROUND) * WIDTH_ROUND
    basis = (length >= ROLE_LEN_PT) & ~hatch
    widths = np.unique(wr[basis]) if basis.any() else np.array([])
    total = float(length[basis].sum()) if basis.any() else 0.0
    role_of: dict[float, int] = {}
    cum = 0.0
    for w in widths:
        before = cum / total if total else 0.0
        role_of[float(w)] = (
            THIN if before < ROLE_Q_THIN else MEDIUM if before < ROLE_Q_MEDIUM else HEAVY
        )
        cum += float(length[basis & (wr == w)].sum())
    for i in range(n):
        if hatch[i]:
            roles[i] = HATCH
        else:  # not hatch here even if short (the grammar said so): it takes its width's role
            w = float(wr[i])
            if w in role_of:
                roles[i] = role_of[w]
            elif role_of:
                roles[i] = role_of[min(role_of, key=lambda k: abs(k - w))]
            else:
                roles[i] = THIN
    return roles


def dimension_lines(
    seg: np.ndarray,
    roles: np.ndarray,
    arrow_points: Sequence[Sequence[tuple[float, float]]],
    number_centres: Sequence[tuple[float, float]],
) -> np.ndarray:
    """Flag (bool per segment) the dimension lines and their tick terminators. `arrow_points` are
    the corner points of small filled shapes (arrow heads), `number_centres` the centres of words
    that contain a digit."""
    n = len(seg)
    flag = np.zeros(n, dtype=bool)
    if n == 0:
        return flag
    length = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    cell = 40.0
    ticks = [i for i in range(n) if length[i] <= TICK_MAX]
    tgrid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in ticks:
        for px, py in ((seg[i, 0], seg[i, 1]), (seg[i, 2], seg[i, 3])):
            tgrid[(int(px // cell), int(py // cell))].append(i)
    agrid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for k, pts in enumerate(arrow_points):
        for px, py in pts:
            agrid[(int(px // cell), int(py // cell))].append(k)
    wgrid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for cx, cy in number_centres:
        wgrid[(int(cx // cell), int(cy // cell))].append((cx, cy))

    def terminator(end: tuple[float, float], direction: float) -> list[int] | None:
        gx, gy = int(end[0] // cell), int(end[1] // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in tgrid.get((gx + dx, gy + dy), ()):
                    if _seg_dist(end[0], end[1], seg[i]) <= TICK_END_TOL:
                        ad = _angle_diff(_angle(seg[i]), direction)
                        if 30.0 <= ad <= 60.0 or 30.0 <= 180.0 - ad <= 60.0:
                            return [i]
                for k in agrid.get((gx + dx, gy + dy), ()):
                    if any(
                        math.hypot(px - end[0], py - end[1]) <= TICK_END_TOL
                        for px, py in arrow_points[k]
                    ):
                        return []
        return None

    for i in range(n):
        if roles[i] != THIN or length[i] < DIM_MIN_LEN:
            continue
        ang = _angle(seg[i])
        t0 = terminator((seg[i, 0], seg[i, 1]), ang)
        if t0 is None:
            continue
        t1 = terminator((seg[i, 2], seg[i, 3]), ang)
        if t1 is None:
            continue
        mx, my = (seg[i, 0] + seg[i, 2]) / 2, (seg[i, 1] + seg[i, 3]) / 2
        gx, gy = int(mx // cell), int(my // cell)
        near_number = any(
            _seg_dist(cx, cy, seg[i]) <= DIM_TEXT_RADIUS
            for dx in (-2, -1, 0, 1, 2)
            for dy in (-2, -1, 0, 1, 2)
            for cx, cy in wgrid.get((gx + dx, gy + dy), ())
        )
        if not near_number:
            continue
        flag[i] = True
        for t in t0 + t1:
            flag[t] = True
    return flag


def page_arrows(page: pymupdf.Page) -> list[list[tuple[float, float]]]:
    """Corner points of small filled triangles and quads (arrow heads), displayed orientation."""
    m = page.rotation_matrix
    out = []
    for d in page.get_cdrawings():
        if d.get("type") not in ("f", "fs"):
            continue
        items = d.get("items") or []
        if not 3 <= len(items) <= 4 or any(it[0] != "l" for it in items):
            continue
        pts = [tuple(pymupdf.Point(it[1]) * m) for it in items]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        if max(max(xs) - min(xs), max(ys) - min(ys)) <= ARROW_MAX:
            out.append(pts)
    return out


def page_number_centres(page: pymupdf.Page) -> list[tuple[float, float]]:
    m = page.rotation_matrix
    out = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        if any(ch.isdigit() for ch in text):
            r = pymupdf.Rect(x0, y0, x1, y1) * m
            r.normalize()
            out.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))
    return out


def classify_page(
    page: pymupdf.Page, rows: Sequence[Sequence[float]]
) -> tuple[list[int], list[int]]:
    """(role, dimension flag) per row of the sheet_lines table, in the same order. Rows are
    [x0, y0, x1, y1, class_index, width]."""
    if not rows:
        return [], []
    arr = np.array([[r[0], r[1], r[2], r[3]] for r in rows], dtype=float)
    width = np.array([r[5] for r in rows], dtype=float)
    roles = assign_roles(arr, width)
    dim = dimension_lines(arr, roles, page_arrows(page), page_number_centres(page))
    return [int(r) for r in roles], [int(d) for d in dim]
