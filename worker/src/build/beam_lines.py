"""Step 6: beam lines from the segments of the confirmed beam pen class.

The pen class key is the one a person confirms (src/linking/lines.py): "width bucket|colour|style".
Only kept segments (step 3) of that width bucket and colour are used. Regular short dashes (equal
pieces of 1 to 14 pt in a run of 4 or more, the src/linking/lines.py dash rule) and segments with a
PDF dash array form DASHED lines:
- style "solid": dash runs are left out (hidden lines); the other segments are merged when
  collinear (direction within MERGE_ANGLE_DEG, offset at most MERGE_OFFSET_PT) and gaps up to
  SOLID_GAP_MAX_PT are bridged (a beam drawn in pieces, broken where it crosses another member).
- style "dash": only the dash runs are used, merged and bridged the same way.
Lines shorter than BEAM_MIN_PT are dropped (ticks and stubs). Every line keeps its source segment
ids and the gaps it bridged.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from src.build.chain import chain_segments
from src.build.geom import Pt
from src.build.segments import PageSegments
from src.linking.lines import DASH_MAX, DASH_MIN, _dash_chains

SOLID_GAP_MAX_PT = 24.0
MERGE_ANGLE_DEG = 1.0
MERGE_OFFSET_PT = 1.0
BEAM_MIN_PT = 24.0


@dataclass
class BeamLine:
    id: int
    p0: Pt
    p1: Pt
    seg_ids: list[int]
    gaps: list[float]
    dashed: bool
    role: str = "beam"  # girder or beam, set by supports.py
    level: int | None = None  # support order: 1 girder, 2+ beams; None = never supported twice
    supports: list = field(default_factory=list)

    @property
    def length(self) -> float:
        return math.hypot(self.p1[0] - self.p0[0], self.p1[1] - self.p0[1])


def parse_pen_class(key: str) -> tuple[str, str, str]:
    parts = key.split("|")
    if len(parts) != 3 or parts[2] not in ("solid", "dash"):
        raise ValueError("a pen class is 'width bucket|colour|solid or dash'")
    return parts[0], parts[1], parts[2]


def pen_segments(ps: PageSegments, keep: np.ndarray, pen_class: str) -> list[int]:
    width, colour, _ = parse_pen_class(pen_class)
    return [i for i in range(len(ps)) if keep[i] and ps.pen(i) == (width, colour)]


def dash_run_ids(ps: PageSegments, ids: list[int]) -> set[int]:
    length = ps.length()
    short = [i for i in ids if DASH_MIN <= length[i] <= DASH_MAX]
    if not short:
        return set()
    chains = _dash_chains([tuple(ps.seg[i]) for i in short])
    return {short[k] for ch in chains for k in ch}


def beam_lines(ps: PageSegments, keep: np.ndarray, pen_class: str) -> list[BeamLine]:
    _, _, style = parse_pen_class(pen_class)
    ids = pen_segments(ps, keep, pen_class)
    dashes = dash_run_ids(ps, ids) | {i for i in ids if ps.pdf_dashed[i]}
    use = [i for i in ids if (i in dashes) == (style == "dash")]
    out: list[BeamLine] = []
    chains = chain_segments(ps.seg, use, SOLID_GAP_MAX_PT, MERGE_ANGLE_DEG, MERGE_OFFSET_PT)
    chains = [c for c in chains if c.length >= BEAM_MIN_PT]
    chains.sort(key=lambda c: (round(c.p0[1], 2), round(c.p0[0], 2), round(c.p1[1], 2), c.p1[0]))
    for c in chains:
        out.append(BeamLine(len(out), c.p0, c.p1, c.seg_ids, c.gaps, style == "dash"))
    return out
