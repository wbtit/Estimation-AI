"""Step 3: remove hatch, dimension and text strokes before grids and beams are looked for.

Hatch and dimension lines use the existing rules of src/review/line_roles.py (the Phase 7 grammar
rules v1), here on the cropped path segments: hatch = a segment with at least four near-parallel
neighbours of similar length at small offsets; a dimension line = a thin line of 30 pt or more with
a tick or small arrow at both ends and a number within 12 pt (with its ticks). A text stroke = a
segment that lies inside the box of a text line (padded by TEXT_PAD_PT): stroked lettering and
underlines. The result is a keep mask plus counts per reason; nothing else is changed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from src.build.geom import Box
from src.build.segments import PageSegments, TextLine
from src.review.line_roles import HATCH, assign_roles, dimension_lines

TEXT_PAD_PT = 1.0
ARROW_MAX_PT = 10.0


@dataclass
class Cleaned:
    keep: np.ndarray  # bool per segment
    roles: np.ndarray  # 0 hatch, 1 thin, 2 medium, 3 heavy
    removed: dict[str, int] = field(default_factory=dict)


def arrow_points(ps: PageSegments) -> list[list[tuple[float, float]]]:
    """Corner points of small filled triangles and quads (arrow heads)."""
    out = []
    for sh in ps.shapes:
        if sh.paint not in ("f", "fs") or len(sh.pts) not in (3, 4) or sh.curved:
            continue
        if max(sh.bbox[2] - sh.bbox[0], sh.bbox[3] - sh.bbox[1]) <= ARROW_MAX_PT:
            out.append(list(sh.pts))
    return out


def text_mask(ps: PageSegments, boxes: list[Box]) -> np.ndarray:
    """True for segments with both ends inside one text box (padded)."""
    n = len(ps)
    out = np.zeros(n, dtype=bool)
    if n == 0 or not boxes:
        return out
    s = ps.seg
    for x0, y0, x1, y1 in boxes:
        x0, y0, x1, y1 = x0 - TEXT_PAD_PT, y0 - TEXT_PAD_PT, x1 + TEXT_PAD_PT, y1 + TEXT_PAD_PT
        inside = (
            (s[:, 0] >= x0)
            & (s[:, 0] <= x1)
            & (s[:, 2] >= x0)
            & (s[:, 2] <= x1)
            & (s[:, 1] >= y0)
            & (s[:, 1] <= y1)
            & (s[:, 3] >= y0)
            & (s[:, 3] <= y1)
        )
        out |= inside
    return out


def clean(ps: PageSegments, text: list[TextLine]) -> Cleaned:
    n = len(ps)
    if n == 0:
        return Cleaned(np.zeros(0, dtype=bool), np.zeros(0, dtype=int), {})
    roles = assign_roles(ps.seg, ps.width)
    hatch = roles == HATCH
    numbers = [t.centre for t in text if any(ch.isdigit() for ch in t.text)]
    dim = dimension_lines(ps.seg, roles, arrow_points(ps), numbers) & ~hatch
    txt = text_mask(ps, [t.box for t in text]) & ~hatch & ~dim
    keep = ~(hatch | dim | txt)
    return Cleaned(
        keep=keep,
        roles=roles,
        removed={"hatch": int(hatch.sum()), "dimension": int(dim.sum()), "text": int(txt.sum())},
    )
