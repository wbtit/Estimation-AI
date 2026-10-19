"""Phase 12b rule "scale_from_dimensions" (docs/PHASE12B_PLAN.md rule 1).

For a page with no stored scale: every text line inside the box that is ONE whole feet-inch
dimension (src/text_layer/parsers/dimension.parse_dimension) of at least DIM_MIN_FT is paired with
the nearest segment parallel to it (within DIM_PARALLEL_DEG) whose span holds the text centre's
projection and whose axis passes within DIM_TEXT_REACH_PT of the text centre. Each pair gives a
ratio = real inches / paper inches. The ratios are grouped in increasing order (a group holds the
ratios within DIM_AGREE of its first one); the largest group must have at least DIM_MIN_AGREE
members and more than any other group. Its median is snapped to the nearest STANDARD_RATIOS entry
within DIM_SNAP; else there is no scale. Pure: no database access.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median

import numpy as np

from src.build.geom import Box
from src.build.segments import PageSegments, TextLine
from src.text_layer.parsers.dimension import parse_dimension

DIM_MIN_FT = 1.0
DIM_PARALLEL_DEG = 3.0
DIM_TEXT_REACH_PT = 12.0
DIM_MIN_SEG_PT = 12.0
DIM_AGREE = 0.02
DIM_MIN_AGREE = 3
DIM_SNAP = 0.02
STANDARD_RATIOS = (
    12,
    16,
    24,
    32,
    48,
    64,
    96,
    128,
    192,
    256,
    384,
    120,
    240,
    360,
    480,
    600,
    720,
    1200,
)
MM_PER_IN = 25.4


@dataclass
class DimensionScale:
    ratio: float | None
    rule: str  # dimensions, too_few, no_majority, no_standard
    pairs: int = 0
    agreeing: int = 0
    ratios: list[float] = field(default_factory=list)


def _inside(c: tuple[float, float], box: Box) -> bool:
    return box[0] <= c[0] <= box[2] and box[1] <= c[1] <= box[3]


def dimension_pairs(ps: PageSegments, text: list[TextLine], box: Box) -> list[float]:
    """The ratio of every dimension text paired with its dimension line."""
    if len(ps) == 0:
        return []
    s = ps.seg
    length = ps.length()
    ang = np.degrees(np.arctan2(s[:, 3] - s[:, 1], s[:, 2] - s[:, 0])) % 180.0
    long = length >= DIM_MIN_SEG_PT
    out: list[float] = []
    for t in text:
        c = t.centre
        if not _inside(c, box):
            continue
        d = parse_dimension(t.text)
        if d is None or d.mm < DIM_MIN_FT * 12 * MM_PER_IN:
            continue
        diff = np.abs(ang - (t.angle_deg % 180.0)) % 180.0
        diff = np.minimum(diff, 180.0 - diff)
        cand = np.flatnonzero(long & (diff <= DIM_PARALLEL_DEG))
        best = None
        for i in cand:
            x0, y0, x1, y1 = s[i]
            L = float(length[i])
            ux, uy = (x1 - x0) / L, (y1 - y0) / L
            along = (c[0] - x0) * ux + (c[1] - y0) * uy
            perp = abs(-(c[0] - x0) * uy + (c[1] - y0) * ux)
            if 0.0 <= along <= L and perp <= DIM_TEXT_REACH_PT and (best is None or perp < best[0]):
                best = (perp, L)
        if best is not None:
            out.append((d.mm / MM_PER_IN) / (best[1] / 72.0))
    return out


def scale_from_ratios(ratios: list[float]) -> DimensionScale:
    """Group, majority, snap (module note)."""
    if len(ratios) < DIM_MIN_AGREE:
        return DimensionScale(None, "too_few", len(ratios), 0, ratios)
    groups: list[list[float]] = []
    for r in sorted(ratios):
        if groups and r <= groups[-1][0] * (1 + DIM_AGREE):
            groups[-1].append(r)
        else:
            groups.append([r])
    groups.sort(key=len, reverse=True)
    top = groups[0]
    if len(top) < DIM_MIN_AGREE or (len(groups) > 1 and len(groups[1]) == len(top)):
        return DimensionScale(None, "no_majority", len(ratios), len(top), ratios)
    m = median(top)
    std = min(STANDARD_RATIOS, key=lambda x: abs(x - m) / x)
    if abs(std - m) / std > DIM_SNAP:
        return DimensionScale(None, "no_standard", len(ratios), len(top), ratios)
    return DimensionScale(float(std), "dimensions", len(ratios), len(top), ratios)


def scale_from_dimensions(ps: PageSegments, text: list[TextLine], box: Box) -> DimensionScale:
    return scale_from_ratios(dimension_pairs(ps, text, box))


__all__ = ["DimensionScale", "dimension_pairs", "scale_from_dimensions", "scale_from_ratios"]
