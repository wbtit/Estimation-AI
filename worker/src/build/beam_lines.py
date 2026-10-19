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

Phase 12a rule "dash_pattern": the dash rule above only sees equal dashes of 1 to 14 pt with gaps
up to 2.5 times the dash, so a long-short-short pattern (27 / 9 / 9 pt) or short dashes with wide
gaps (4.5 pt dash, 18 pt gap) were chained into one long beam. Now the pieces of every collinear
chain are put in order along it and cut into runs wherever a piece is longer than
DASH_PATTERN_SEG_MAX_PT or two pieces touch or overlap (gap under DASH_PATTERN_GAP_MIN_PT). A run of
at least DASH_PATTERN_RUN_MIN pieces is a dash pattern when its gaps are regular (a share
DASH_PATTERN_SHARE of them within DASH_PATTERN_GAP_TOL of the median gap, relative, plus
DASH_PATTERN_GAP_ABS_PT), the median gap is at least DASH_PATTERN_GAP_RATIO_MIN of the median piece
(a beam broken where members cross it has gaps far shorter than its pieces), and the piece lengths
take at most DASH_PATTERN_LENGTHS_MAX values (pieces within DASH_PATTERN_LEN_TOL relative plus
DASH_PATTERN_LEN_ABS_PT are one value) for the same share of the pieces. Its pieces are dashes like
the runs of the old rule: left out with a solid pen, used with a dash pen.
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

DASH_PATTERN_RUN_MIN = 5
DASH_PATTERN_SEG_MAX_PT = 40.0
DASH_PATTERN_GAP_MIN_PT = 1.0
DASH_PATTERN_GAP_TOL = 0.25
DASH_PATTERN_GAP_ABS_PT = 0.5
DASH_PATTERN_GAP_RATIO_MIN = 0.2
DASH_PATTERN_LENGTHS_MAX = 3
DASH_PATTERN_LEN_TOL = 0.15
DASH_PATTERN_LEN_ABS_PT = 0.3
DASH_PATTERN_SHARE = 0.8


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


def _ordered(ps: PageSegments, ids: list[int], p0: Pt, p1: Pt) -> list[tuple[float, float, int]]:
    """The pieces of a chain in order along it: (start, end, id) in pt from the chain's start."""
    ln = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) or 1.0
    ux, uy = (p1[0] - p0[0]) / ln, (p1[1] - p0[1]) / ln
    out = []
    for i in ids:
        x0, y0, x1, y1 = (float(v) for v in ps.seg[i])
        a = (x0 - p0[0]) * ux + (y0 - p0[1]) * uy
        b = (x1 - p0[0]) * ux + (y1 - p0[1]) * uy
        out.append((min(a, b), max(a, b), i))
    out.sort()
    return out


def _share_near(values: list[float], centre: float, tol: float, abs_pt: float) -> float:
    return sum(1 for v in values if abs(v - centre) <= tol * centre + abs_pt) / len(values)


def _length_values_share(lengths: list[float]) -> float:
    """The share of pieces covered by the DASH_PATTERN_LENGTHS_MAX most common length values."""
    groups: list[list[float]] = []
    for v in sorted(lengths):
        if groups and v - groups[-1][0] <= DASH_PATTERN_LEN_TOL * groups[-1][0] + (
            DASH_PATTERN_LEN_ABS_PT
        ):
            groups[-1].append(v)
        else:
            groups.append([v])
    top = sorted((len(g) for g in groups), reverse=True)[:DASH_PATTERN_LENGTHS_MAX]
    return sum(top) / len(lengths)


def is_dash_pattern(run: list[tuple[float, float, int]]) -> bool:
    """A run of pieces in order along a line (start, end, id): a regular dash pattern?"""
    if len(run) < DASH_PATTERN_RUN_MIN:
        return False
    lengths = [b - a for a, b, _ in run]
    gaps = [run[k + 1][0] - run[k][1] for k in range(len(run) - 1)]
    gap = float(np.median(gaps))
    piece = float(np.median(lengths))
    return (
        gap >= DASH_PATTERN_GAP_MIN_PT
        and gap >= DASH_PATTERN_GAP_RATIO_MIN * piece
        and _share_near(gaps, gap, DASH_PATTERN_GAP_TOL, DASH_PATTERN_GAP_ABS_PT)
        >= DASH_PATTERN_SHARE
        and _length_values_share(lengths) >= DASH_PATTERN_SHARE
    )


def dash_pattern_runs(ps: PageSegments, ids: list[int]) -> list[list[int]]:
    """Rule "dash_pattern" (module note): the runs of pieces of these segments that are a regular
    dash pattern, each as its segment ids."""
    out: list[list[int]] = []
    chains = chain_segments(ps.seg, ids, SOLID_GAP_MAX_PT, MERGE_ANGLE_DEG, MERGE_OFFSET_PT)
    for c in chains:
        if len(c.seg_ids) < DASH_PATTERN_RUN_MIN:
            continue
        run: list[tuple[float, float, int]] = []
        end = -math.inf
        for a, b, i in _ordered(ps, c.seg_ids, c.p0, c.p1):
            if b - a > DASH_PATTERN_SEG_MAX_PT or a - end < DASH_PATTERN_GAP_MIN_PT:
                if is_dash_pattern(run):
                    out.append([r[2] for r in run])
                run = []
            if b - a <= DASH_PATTERN_SEG_MAX_PT:
                run.append((a, b, i))
            end = max(end, b)
        if is_dash_pattern(run):
            out.append([r[2] for r in run])
    return out


def dash_ids(ps: PageSegments, ids: list[int]) -> tuple[set[int], list[list[int]]]:
    """Every dash among these segments (the old dash rule, a PDF dash array, rule "dash_pattern"),
    and the dash_pattern runs that the old rules did not already find (for the counts)."""
    old = dash_run_ids(ps, ids) | {i for i in ids if ps.pdf_dashed[i]}
    runs = [r for r in dash_pattern_runs(ps, [i for i in ids if i not in old])]
    return old | {i for r in runs for i in r}, runs


def beam_lines(
    ps: PageSegments, keep: np.ndarray, pen_class: str, removed: dict[str, int] | None = None
) -> list[BeamLine]:
    _, _, style = parse_pen_class(pen_class)
    ids = pen_segments(ps, keep, pen_class)
    dashes, runs = dash_ids(ps, ids)
    if removed is not None:
        removed["dash_pattern_runs"] = removed.get("dash_pattern_runs", 0) + len(runs)
        removed["dash_pattern_segments"] = removed.get("dash_pattern_segments", 0) + sum(
            len(r) for r in runs
        )
    use = [i for i in ids if (i in dashes) == (style == "dash")]
    out: list[BeamLine] = []
    chains = chain_segments(ps.seg, use, SOLID_GAP_MAX_PT, MERGE_ANGLE_DEG, MERGE_OFFSET_PT)
    chains = [c for c in chains if c.length >= BEAM_MIN_PT]
    chains.sort(key=lambda c: (round(c.p0[1], 2), round(c.p0[0], 2), round(c.p1[1], 2), c.p1[0]))
    for c in chains:
        out.append(BeamLine(len(out), c.p0, c.p1, c.seg_ids, c.gaps, style == "dash"))
    return out
