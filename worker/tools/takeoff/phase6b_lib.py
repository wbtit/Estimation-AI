"""Phase 6b: pure geometry and scoring helpers (pre-registered in docs/PHASE6B_PREREGISTRATION.md).

No file or network access here; the driver (phase6b_study.py) feeds these functions. Everything is
unit-tested with synthetic numbers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

Seg = tuple[float, float, float, float]

# merge rule for the line-first basis (fixed in the pre-registration, not tuned)
MERGE_ANGLE_DEG = 1.0
MERGE_OFFSET_PT = 1.0
MERGE_GAP_PT = 12.0
SPLIT_GAP_MAX_PT = 60.0
MIN_LINE_PT = 12.0
SAME_LINE_PT = 0.6  # two linked lines are "the same line" when their ends agree within this

RADII = (12.0, 6.0, 24.0)  # primary first


# ---- distances ----------------------------------------------------------------------------------
def point_segment_distance(px: float, py: float, s: Seg) -> float:
    x0, y0, x1, y1 = s
    dx, dy = x1 - x0, y1 - y0
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / l2))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def point_rect_distance(px: float, py: float, r: tuple[float, float, float, float]) -> float:
    dx = max(r[0] - px, 0.0, px - r[2])
    dy = max(r[1] - py, 0.0, py - r[3])
    return math.hypot(dx, dy)


@dataclass
class Piece:
    """A counted piece: its linked line (preferred) or its label box, a colour and an id."""

    line: Seg | None
    box: tuple[float, float, float, float] | None = None
    colour: str | None = None
    key: str = ""
    n_src: int = 1  # raw lines joined into this piece (line-first)
    extra: dict = field(default_factory=dict)

    def distance(self, x: float, y: float) -> float:
        if self.line is not None:
            return point_segment_distance(x, y, self.line)
        if self.box is not None:
            return point_rect_distance(x, y, self.box)
        return math.inf


def greedy_match(
    symbols: list[tuple[float, float]], pieces: list[Piece], radius: float
) -> list[tuple[int, int, float]]:
    """One-to-one: candidate pairs within the radius, taken by ascending distance (ties: symbol
    index, then piece index). Returns (symbol index, piece index, distance)."""
    pairs = []
    for si, (x, y) in enumerate(symbols):
        for pi, p in enumerate(pieces):
            d = p.distance(x, y)
            if d <= radius:
                pairs.append((d, si, pi))
    pairs.sort()
    used_s: set[int] = set()
    used_p: set[int] = set()
    out = []
    for d, si, pi in pairs:
        if si in used_s or pi in used_p:
            continue
        used_s.add(si)
        used_p.add(pi)
        out.append((si, pi, d))
    return out


def prf(
    matched: int, n_pieces: int, n_syms: int
) -> tuple[float | None, float | None, float | None]:
    p = None if n_pieces == 0 else matched / n_pieces
    r = None if n_syms == 0 else matched / n_syms
    if p is None or r is None or p + r == 0:
        return p, r, None
    return p, r, 2 * p * r / (p + r)


def page_agreement(ours: int, theirs: int) -> dict[str, bool]:
    return {
        "equal": ours == theirs,
        "within1": abs(ours - theirs) <= 1,
        "within20": theirs >= 1 and abs(ours - theirs) <= 0.2 * theirs,
    }


def verdict(share_within1: float | None, precision: float | None, recall: float | None) -> str:
    """The pre-registered bars at R = 12 pt."""
    if None in (share_within1, precision, recall):
        return "not enough"
    assert share_within1 is not None and precision is not None and recall is not None
    if share_within1 >= 0.50 and precision >= 0.6 and recall >= 0.6:
        return "worth building on"
    if share_within1 >= 0.30 and precision >= 0.4 and recall >= 0.4:
        return "promising"
    return "not enough"


# ---- line merging (line-first basis) ------------------------------------------------------------
def _angle(s: Seg) -> float:
    return math.degrees(math.atan2(s[3] - s[1], s[2] - s[0])) % 180.0


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def _collinear(a: Seg, b: Seg) -> bool:
    if _angle_diff(_angle(a), _angle(b)) > MERGE_ANGLE_DEG:
        return False

    # perpendicular offset of b's ends from a's infinite line, and the reverse
    def off(s: Seg, px: float, py: float) -> float:
        dx, dy = s[2] - s[0], s[3] - s[1]
        n = math.hypot(dx, dy) or 1.0
        return abs(dx * (py - s[1]) - dy * (px - s[0])) / n

    return (
        max(off(a, b[0], b[1]), off(a, b[2], b[3])) <= MERGE_OFFSET_PT
        or max(off(b, a[0], a[1]), off(b, a[2], a[3])) <= MERGE_OFFSET_PT
    )


def _gap(a: Seg, b: Seg) -> float:
    """Gap along the common direction between two collinear segments (0 if they overlap)."""
    dx, dy = a[2] - a[0], a[3] - a[1]
    n = math.hypot(dx, dy) or 1.0
    ux, uy = dx / n, dy / n
    pa = sorted((a[0] * ux + a[1] * uy, a[2] * ux + a[3] * uy))
    pb = sorted((b[0] * ux + b[1] * uy, b[2] * ux + b[3] * uy))
    return max(pb[0] - pa[1], pa[0] - pb[1], 0.0)


def _join(a: Seg, b: Seg) -> Seg:
    pts = [(a[0], a[1]), (a[2], a[3]), (b[0], b[1]), (b[2], b[3])]
    dx, dy = a[2] - a[0], a[3] - a[1]
    n = math.hypot(dx, dy) or 1.0
    ux, uy = dx / n, dy / n
    lo = min(pts, key=lambda p: p[0] * ux + p[1] * uy)
    hi = max(pts, key=lambda p: p[0] * ux + p[1] * uy)
    return (lo[0], lo[1], hi[0], hi[1])


def merge_lines(lines: list[Seg]) -> list[tuple[Seg, int]]:
    """Join collinear lines whose gap is at most MERGE_GAP_PT; repeated until nothing joins.
    Returns (line, number of raw lines in it). Deterministic: input is sorted first."""
    items: list[tuple[Seg, int]] = [
        (s, 1) for s in sorted(lines, key=lambda s: (round(s[0], 2), round(s[1], 2), s[2], s[3]))
    ]
    changed = True
    while changed:
        changed = False
        out: list[tuple[Seg, int]] = []
        used = [False] * len(items)
        for i, (a, na) in enumerate(items):
            if used[i]:
                continue
            for j in range(i + 1, len(items)):
                if used[j]:
                    continue
                b, nb = items[j]
                if _collinear(a, b) and _gap(a, b) <= MERGE_GAP_PT:
                    a, na = _join(a, b), na + nb
                    used[j] = True
                    changed = True
            used[i] = True
            out.append((a, na))
        items = out
    return items


def split_remains(line: Seg, others: list[Seg]) -> bool:
    """A collinear neighbour (same angle and offset tolerance) at a gap between 12 and 60 pt."""
    for o in others:
        if o == line:
            continue
        if _collinear(line, o) and MERGE_GAP_PT < _gap(line, o) <= SPLIT_GAP_MAX_PT:
            return True
    return False


def line_segment_class(sym: tuple[float, float], merged: list[tuple[Seg, int]]) -> str | None:
    """For a symbol: the kind of line it sits on within 12 pt: 'merged', 'split remains', 'single'
    (None when no line is within 12 pt)."""
    best = None
    for s, n in merged:
        d = point_segment_distance(sym[0], sym[1], s)
        if d <= 12.0 and (best is None or d < best[0]):
            best = (d, s, n)
    if best is None:
        return None
    _, s, n = best
    if n >= 2:
        return "merged"
    return "split remains" if split_remains(s, [m[0] for m in merged]) else "single"


# ---- same-line grouping (line-with-label basis) -------------------------------------------------
def same_line(a: Seg, b: Seg, tol: float = SAME_LINE_PT) -> bool:
    def close(x0, y0, x1, y1):
        return abs(x0 - x1) <= tol and abs(y0 - y1) <= tol

    return (close(a[0], a[1], b[0], b[1]) and close(a[2], a[3], b[2], b[3])) or (
        close(a[0], a[1], b[2], b[3]) and close(a[2], a[3], b[0], b[1])
    )


def distinct_lines(pieces: list[Piece]) -> list[Piece]:
    """One piece per distinct linked line; the colour is the worst of the labels on it."""
    rank = {"green": 0, "amber": 1, "red": 2}
    groups: list[list[Piece]] = []
    for p in pieces:
        if p.line is None:
            continue
        for g in groups:
            if same_line(g[0].line, p.line):  # type: ignore[arg-type]
                g.append(p)
                break
        else:
            groups.append([p])
    out = []
    for g in groups:
        worst = max(g, key=lambda q: rank.get(q.colour or "green", 0))
        out.append(
            Piece(
                line=g[0].line,
                box=g[0].box,
                colour=worst.colour,
                key=g[0].key,
                extra={"labels": len(g)},
            )
        )
    return out


# ---- miss reasons -------------------------------------------------------------------------------
def line_key(s: Seg) -> tuple[float, float, float, float]:
    a = (round(s[0], 1), round(s[1], 1))
    b = (round(s[2], 1), round(s[3], 1))
    lo, hi = sorted((a, b))
    return (lo[0], lo[1], hi[0], hi[1])


def symbol_miss_reason(
    *,
    raster: bool,
    lines_near: list[Seg],
    reach: set,
    linked: set,
    pieces_near_used: bool,
    pieces_near_far: bool,
) -> str:
    """ONE reason per unmatched symbol, fixed order (sheet-excluded is added by the caller)."""
    if raster:
        return "raster page"
    if not lines_near:
        return "no extracted line within 24 pt"
    keys = {line_key(s) for s in lines_near}
    if not (keys & reach):
        return "unlinked: no label reached the line"
    if not (keys & linked):
        return "linked elsewhere: labels reach it but chose other lines"
    if pieces_near_used:
        return "other: several symbols on one linked line"
    if pieces_near_far:
        return "other: linked piece is 12 to 24 pt away"
    return "other"


def piece_miss_reason(*, page_has_symbols: bool, shared: bool, symbol_within_24: bool) -> str:
    if not page_has_symbols:
        return "page has no symbols of theirs"
    if shared:
        return "extra piece on a shared line"
    if not symbol_within_24:
        return "no symbol of theirs within 24 pt"
    return "other"


def lines_near_point(x: float, y: float, segs: np.ndarray, radius: float) -> list[Seg]:
    if len(segs) == 0:
        return []
    ax, ay, bx, by = segs[:, 0], segs[:, 1], segs[:, 2], segs[:, 3]
    dx, dy = bx - ax, by - ay
    l2 = np.maximum(dx * dx + dy * dy, 1e-9)
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1)
    d = np.hypot(x - (ax + t * dx), y - (ay + t * dy))
    return [tuple(map(float, segs[i])) for i in np.nonzero(d <= radius)[0]]  # type: ignore[misc]
