"""Double-line beams (Review 4): two thin parallel flange-edge lines with a dashed centreline.

Beams are drawn either as one heavy line (today's path, `beam_lines`) or, at larger scale, as two
THIN parallel lines a flange width apart with a dashed centreline between them. Parallel spacing
alone is not evidence: close parallel heavy single lines stay untouched (heavy pens are never
paired). A pair is ONE beam on the midline only when the evidence agrees (pre-registration
worker/prereg/PHASE0_DOUBLE_LINE_BEAMS_PREREGISTRATION.md): same thin pen, parallel, overlapping
most of the run, a gap that matches the learned gap and a real flange width at the page scale, a
dashed centreline midway when the page style says so, both lines ending together. Pairs that fail
only a soft rule are AMBER (reason text), never silently merged or dropped.

Pure geometry: no database, no page. Units are page points; real inches = pt / 72 x ratio.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from src.build.beam_lines import (
    BEAM_MIN_PT,
    MERGE_ANGLE_DEG,
    MERGE_OFFSET_PT,
    SOLID_GAP_MAX_PT,
    BeamLine,
    dash_ids,
    parse_pen_class,
)
from src.build.chain import chain_segments
from src.build.geom import Pt
from src.build.segments import PageSegments

STYLES = ("single", "double", "both")
THIN_BUCKETS = ("0.1-0.25", "0.25-0.5")

PAIR_ANGLE_DEG = 1.0
OVERLAP_MIN = 0.70
GAP_LO_REL = 0.40  # the learned gap x this = the narrowest gap accepted (Addendum 1)
GAP_HI_REL = 1.60
GAP_REAL_MIN_IN = 1.11  # AISC aisc-v16.0 catalog bf minimum 1.17 in, 5 % slack
GAP_REAL_MAX_IN = 19.7  # catalog bf maximum 18.8 in, 5 % slack
END_TOL_HARD = 0.6  # x gap
END_TOL_SOFT = 1.5  # x gap
CENTRE_OFFSET_REL = 0.10  # x gap (at least CENTRE_OFFSET_MIN_PT); Addendum 1
CENTRE_OFFSET_MIN_PT = 1.0
CENTRE_ANGLE_DEG = 2.0
CENTRE_COVER_MIN = 0.60
AMBIGUOUS_MARGIN = 0.05
AMBER_SCORE = 0.80
WIDTH_TOL_IN = 0.75
WIDTH_TOL_REL = 0.20
RUN_CLASH = 0.5  # two pairs of one line may share at most this share of the shorter run
CENTRE_MIN_PT = 8.0  # a dashed centreline shorter than this is not one


@dataclass(frozen=True)
class BeamStyle:
    """The page beam style of a view. gap range in pt (None = only the real-width range)."""

    style: str = "single"
    gap_min_pt: float | None = None
    gap_max_pt: float | None = None
    centreline_required: bool = True

    @property
    def pairs(self) -> bool:
        return self.style in ("double", "both")


@dataclass
class Pair:
    a: int  # BeamLine ids
    b: int
    gap_pt: float
    gap_in: float | None
    overlap: float
    ends_pt: tuple[float, float]  # start and end offset between the two lines
    centreline: float | None  # cover of the overlap by a dashed centreline (None = not looked for)
    score: float
    amber: list[str] = field(default_factory=list)
    p0: Pt = (0.0, 0.0)
    p1: Pt = (0.0, 0.0)
    run_a: tuple[float, float] = (0.0, 0.0)  # the common run along each line, from its own p0
    run_b: tuple[float, float] = (0.0, 0.0)
    cut_ends: int = 0  # ends where one line continues past the other (a crossing member cut it)

    def evidence(self) -> dict:
        return {
            "gap_pt": round(self.gap_pt, 2),
            "gap_in": None if self.gap_in is None else round(self.gap_in, 2),
            "overlap": round(self.overlap, 3),
            "ends_pt": [round(v, 2) for v in self.ends_pt],
            "centreline": None if self.centreline is None else round(self.centreline, 3),
            "score": round(self.score, 3),
            "cut_ends": self.cut_ends,
            "amber": list(self.amber),
        }


@dataclass
class PairResult:
    lines: list[BeamLine]  # the beams: pair midlines, then (style both) the unpaired singles
    pairs: list[Pair]
    unpaired: list[BeamLine]  # thin lines that are in no pair
    kept_single: int = 0  # unpaired lines kept as single-line beams (style both)
    ambiguous: int = 0


def beam_style_of(row: dict) -> BeamStyle | None:
    """The BeamStyle of a build_views row (None = single: every pen line is a beam)."""
    style = row.get("beam_style")
    if style not in ("double", "both"):
        return None
    lo, hi = row.get("beam_gap_min_pt"), row.get("beam_gap_max_pt")
    return BeamStyle(
        style,
        None if lo is None else float(lo),
        None if hi is None else float(hi),
        bool(row.get("beam_centreline_required", True)),
    )


# ---- geometry ---------------------------------------------------------------------------------


def _unit(ln: BeamLine) -> tuple[float, float, float]:
    d = math.hypot(ln.p1[0] - ln.p0[0], ln.p1[1] - ln.p0[1]) or 1.0
    return (ln.p1[0] - ln.p0[0]) / d, (ln.p1[1] - ln.p0[1]) / d, d


def _angle(ln: BeamLine) -> float:
    return math.degrees(math.atan2(ln.p1[1] - ln.p0[1], ln.p1[0] - ln.p0[0])) % 180.0


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def real_in(pt: float, ratio: float) -> float:
    return pt / 72.0 * ratio


def _dist_text(pt: float, ratio: float | None) -> str:
    return f"{pt:.0f} pt" if ratio is None else f"{real_in(pt, ratio):.1f} in"


def is_thin_pen(pen_class: str) -> bool:
    return parse_pen_class(pen_class)[0] in THIN_BUCKETS


def centrelines(ps: PageSegments, keep: np.ndarray | None = None) -> list[BeamLine]:
    """The dashed lines of the thin pens (any colour of a thin width bucket): the candidates for a
    beam's centreline. Uses the existing dash rules (dash array, equal dashes, dash pattern).
    Every segment counts, kept or not: page cleaning (hatch, dimension, text) removes some dashes
    of a dash-dot centreline, and a centreline is only ever used as evidence next to two flange
    lines, never as a beam."""
    ids = [i for i in range(len(ps)) if ps.pen(i)[0] in THIN_BUCKETS and (keep is None or keep[i])]
    dashes, _ = dash_ids(ps, ids)
    use = [i for i in ids if i in dashes]
    out: list[BeamLine] = []
    for c in chain_segments(ps.seg, use, SOLID_GAP_MAX_PT, MERGE_ANGLE_DEG, MERGE_OFFSET_PT):
        if c.length >= CENTRE_MIN_PT:
            out.append(BeamLine(len(out), c.p0, c.p1, c.seg_ids, c.gaps, True))
    return out


def _centre_cover(
    ux: float, uy: float, lo: float, hi: float, side: float, gap: float, ref: Pt,
    dashed: list[BeamLine],
) -> float:  # fmt: skip
    """Share of the run [lo, hi] (along u from `ref`) covered by dashed lines on the midline."""
    nx, ny = -uy, ux
    tol = max(CENTRE_OFFSET_MIN_PT, CENTRE_OFFSET_REL * gap)
    spans: list[tuple[float, float]] = []
    for d in dashed:
        dx, dy, dl = _unit(d)
        if _angle_diff(math.degrees(math.atan2(dy, dx)) % 180.0,
                       math.degrees(math.atan2(uy, ux)) % 180.0) > CENTRE_ANGLE_DEG:  # fmt: skip
            continue
        mx, my = (d.p0[0] + d.p1[0]) / 2 - ref[0], (d.p0[1] + d.p1[1]) / 2 - ref[1]
        if abs((mx * nx + my * ny) * side - gap / 2) > tol:
            continue
        a0 = (d.p0[0] - ref[0]) * ux + (d.p0[1] - ref[1]) * uy
        a1 = (d.p1[0] - ref[0]) * ux + (d.p1[1] - ref[1]) * uy
        s0, s1 = max(lo, min(a0, a1)), min(hi, max(a0, a1))
        if s1 > s0:
            spans.append((s0, s1))
    spans.sort()
    covered, end = 0.0, -math.inf
    for s0, s1 in spans:
        s0 = max(s0, end)
        if s1 > s0:
            covered += s1 - s0
            end = s1
    return covered / (hi - lo) if hi > lo else 0.0


def evaluate_pair(
    la: BeamLine, lb: BeamLine, style: BeamStyle, ratio: float | None, dashed: list[BeamLine],
) -> Pair | None:  # fmt: skip
    """The pair of two thin lines, or None when a HARD rule fails. Soft failures are amber."""
    ux, uy, ula = _unit(la)
    if _angle_diff(_angle(la), _angle(lb)) > PAIR_ANGLE_DEG:
        return None
    nx, ny = -uy, ux
    ref = la.p0
    mx, my = (lb.p0[0] + lb.p1[0]) / 2 - ref[0], (lb.p0[1] + lb.p1[1]) / 2 - ref[1]
    signed = mx * nx + my * ny
    gap = abs(signed)
    if gap <= 0.0:
        return None
    g_in = None if ratio is None else real_in(gap, ratio)  # no scale yet (learning): not checked
    if g_in is not None and not GAP_REAL_MIN_IN <= g_in <= GAP_REAL_MAX_IN:
        return None
    if style.gap_min_pt is not None and style.gap_max_pt is not None:
        # beams of different sizes on one page have different flange widths: the learned gap
        # is a wide band; the width check against the label's bf catches the mismatches
        if not style.gap_min_pt * GAP_LO_REL <= gap <= style.gap_max_pt * GAP_HI_REL:
            return None
    b0 = (lb.p0[0] - ref[0]) * ux + (lb.p0[1] - ref[1]) * uy
    b1 = (lb.p1[0] - ref[0]) * ux + (lb.p1[1] - ref[1]) * uy
    if b0 > b1:
        b0, b1 = b1, b0
    a0, a1 = 0.0, ula
    lo, hi = max(a0, b0), min(a1, b1)
    shorter = min(a1 - a0, b1 - b0)
    if hi <= lo or shorter <= 0:
        return None
    overlap = (hi - lo) / shorter
    if overlap < OVERLAP_MIN:
        return None
    ends = (abs(a0 - b0), abs(a1 - b1))
    side = 1.0 if signed > 0 else -1.0
    cover = _centre_cover(ux, uy, lo, hi, side, gap, ref, dashed)
    amber: list[str] = []
    if cover < CENTRE_COVER_MIN:
        if style.centreline_required:
            return None
        amber.append("no dashed centreline between the two lines")
    # ends: aligned (both end together), or cut (one line continues past the other: a member
    # crossing the beam breaks one flange line). A cut end needs the dashed centreline to carry on
    # over the run; two lines that end apart with no centreline are not a pair.
    cut = 0
    fits: list[float] = []
    for e in ends:
        if e <= END_TOL_HARD * gap:
            fits.append(1.0 - 0.5 * e / (END_TOL_HARD * gap))
        elif e <= END_TOL_SOFT * gap:
            amber.append(
                f"the two lines end {_dist_text(e, ratio)} apart (more than {END_TOL_HARD:g}"
                " x the gap)"
            )
            fits.append(0.5)
        else:
            if cover < CENTRE_COVER_MIN:
                return None
            cut += 1
            fits.append(0.75)
    end_fit = min(fits)
    score = (min(1.0, overlap) + min(1.0, cover) + end_fit) / 3
    if score < AMBER_SCORE:
        amber.append(f"low pair score {score:.2f}")
    s0 = lo if ends[0] > END_TOL_HARD * gap else (a0 + b0) / 2
    s1 = hi if ends[1] > END_TOL_HARD * gap else (a1 + b1) / 2
    off = signed / 2
    p0 = (ref[0] + ux * s0 + nx * off, ref[1] + uy * s0 + ny * off)
    p1 = (ref[0] + ux * s1 + nx * off, ref[1] + uy * s1 + ny * off)
    if math.dist(p0, p1) < BEAM_MIN_PT:
        return None
    ubx, uby, _ = _unit(lb)
    pb = [
        ((ref[0] + ux * t - lb.p0[0]) * ubx + (ref[1] + uy * t - lb.p0[1]) * uby) for t in (lo, hi)
    ]
    pair = Pair(la.id, lb.id, gap, g_in, overlap, (ends[0], ends[1]), cover, score, amber, p0, p1)
    pair.run_a, pair.run_b = (lo, hi), (min(pb), max(pb))
    pair.cut_ends = cut
    return pair


def pair_lines(
    lines: list[BeamLine], style: BeamStyle, ratio: float, dashed: list[BeamLine],
) -> PairResult:  # fmt: skip
    """Pair the thin lines of one pen. Style double: the pairs only; style both: the unpaired
    lines stay single-line beams. Greedy by score, confident pairs first; one pair per line."""
    cands: list[Pair] = []
    ang = np.array([_angle(ln) for ln in lines]) if lines else np.zeros(0)
    for i, la in enumerate(lines):
        for j in range(i + 1, len(lines)):
            d = abs(ang[i] - ang[j])
            if min(d, 180.0 - d) > PAIR_ANGLE_DEG:
                continue
            p = evaluate_pair(la, lines[j], style, ratio, dashed)
            if p is not None:
                cands.append(p)
    cands.sort(key=lambda p: (bool(p.amber), -p.score, p.a, p.b))
    by_line: dict[int, list[Pair]] = {}
    for p in cands:
        by_line.setdefault(p.a, []).append(p)
        by_line.setdefault(p.b, []).append(p)
    taken: dict[int, list[tuple[float, float]]] = {}
    used: set[int] = set()
    chosen: list[Pair] = []
    ambiguous = 0

    def clash(line: int, run: tuple[float, float]) -> bool:
        w = run[1] - run[0]
        return any(
            min(run[1], t1) - max(run[0], t0) > RUN_CLASH * w for t0, t1 in taken.get(line, ())
        )

    def same_run(p: Pair, q: Pair) -> bool:
        if p.a == q.a:
            x, y = p.run_a, q.run_a
        elif p.b == q.b:
            x, y = p.run_b, q.run_b
        elif p.a == q.b:
            x, y = p.run_a, q.run_b
        else:
            x, y = p.run_b, q.run_a
        return min(x[1], y[1]) - max(x[0], y[0]) > RUN_CLASH * min(x[1] - x[0], y[1] - y[0])

    for p in cands:
        if clash(p.a, p.run_a) or clash(p.b, p.run_b):
            continue
        rivals = [
            q
            for line in (p.a, p.b)
            for q in by_line[line]
            if q is not p
            and not (clash(q.a, q.run_a) or clash(q.b, q.run_b))
            and abs(q.score - p.score) <= AMBIGUOUS_MARGIN
            and same_run(p, q)
        ]
        if rivals:
            p.amber.append("another line could be the partner (ambiguous)")
            ambiguous += 1
        taken.setdefault(p.a, []).append(p.run_a)
        taken.setdefault(p.b, []).append(p.run_b)
        used.update((p.a, p.b))
        chosen.append(p)
    unpaired = [ln for ln in lines if ln.id not in used]
    chosen.sort(key=lambda p: (round(p.p0[1], 2), round(p.p0[0], 2), p.a, p.b))
    out: list[BeamLine] = []
    for p in chosen:
        la, lb = lines[p.a], lines[p.b]
        ev = {"pair": p.evidence()}
        out.append(
            BeamLine(len(out), p.p0, p.p1, [*la.seg_ids, *lb.seg_ids], [], False, evidence=ev)
        )
    kept = 0
    if style.style == "both":
        for ln in unpaired:
            out.append(BeamLine(len(out), ln.p0, ln.p1, ln.seg_ids, ln.gaps, ln.dashed))
            kept += 1
    # the pair order in `chosen` and in `out` agree, so pairs[k] describes out[k]
    return PairResult(out, chosen, unpaired, kept, ambiguous)


# ---- learning ---------------------------------------------------------------------------------


@dataclass
class Learned:
    style: str  # single | double
    gap_min_pt: float | None
    gap_max_pt: float | None
    centreline_required: bool
    evidence: dict


def learn_style(
    lines: list[BeamLine], click: Pt, pen_class: str, ratio: float | None, dashed: list[BeamLine],
    max_dist_pt: float = 12.0,
) -> Learned:  # fmt: skip
    """The page beam style from one picked beam: a heavy single line, or a thin pair."""
    if not is_thin_pen(pen_class):
        return Learned("single", None, None, False, {"reason": "heavy pen: a single line"})
    near = _nearest(lines, click, max_dist_pt)
    if near is None:
        return Learned("single", None, None, False, {"reason": "no line at the click"})
    open_style = BeamStyle(
        "double", None, None, False
    )  # real-width range only; centreline read below
    best: Pair | None = None
    for other in lines:
        if other.id == near.id:
            continue
        p = evaluate_pair(near, other, open_style, ratio, dashed)
        if p is None:
            continue
        if best is None or (p.centreline or 0.0, p.score) > (best.centreline or 0.0, best.score):
            best = p
    if best is None:
        return Learned("single", None, None, False, {"reason": "no thin partner line found"})
    has_centre = (best.centreline or 0.0) >= CENTRE_COVER_MIN
    ev = {
        "partner_gap_pt": round(best.gap_pt, 2),
        "partner_gap_in": None if best.gap_in is None else round(best.gap_in, 2),
        "overlap": round(best.overlap, 3),
        "centreline": round(best.centreline or 0.0, 3),
    }
    if not has_centre:
        ev["reason"] = "a close thin partner but no dashed centreline: not learned as double"
        return Learned("single", None, None, False, ev)
    ev["reason"] = "thin pair with a dashed centreline"
    return Learned("double", best.gap_pt, best.gap_pt, True, ev)


def _nearest(lines: list[BeamLine], click: Pt, max_dist: float) -> BeamLine | None:
    best: tuple[float, float, BeamLine] | None = None
    for ln in lines:
        d = _point_seg(click, ln.p0, ln.p1)
        if d <= max_dist and (best is None or (d, -ln.length) < (best[0], -best[1])):
            best = (d, ln.length, ln)
    return None if best is None else best[2]


def _point_seg(p: Pt, a: Pt, b: Pt) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


__all__ = [
    "BeamStyle",
    "Learned",
    "Pair",
    "PairResult",
    "STYLES",
    "THIN_BUCKETS",
    "beam_style_of",
    "centrelines",
    "evaluate_pair",
    "is_thin_pen",
    "learn_style",
    "pair_lines",
    "real_in",
]
