"""Double-line beams (Review 4): the pairing rules, the learning, and the build with a style.

SYNTHETIC geometry only. Units are page points; the page ratio is 96 (1/8" = 1'-0"), so 1 pt =
1.333 real inches and a W8x18 flange (bf 5.25 in) is a gap of 3.94 pt.
"""

from __future__ import annotations

import math

import pymupdf
from build_factory import line

from src.build.beam_lines import BeamLine
from src.build.double_line import (
    BeamStyle,
    centrelines,
    evaluate_pair,
    is_thin_pen,
    learn_style,
    pair_lines,
)
from src.build.double_width import width_check
from src.build.page import Setup, build_page

RATIO = 96.0
GAP = 3.94  # W8x18 flange at 1/8" = 1'
PEN = "0.25-0.5|black|solid"
THIN = 0.4
STYLE = BeamStyle("double", GAP, GAP, True)


def bl(i, a, b):
    return BeamLine(i, a, b, [i], [], False)


def dashed(i, a, b):
    return BeamLine(i, a, b, [i], [], True)


def pair_of(len_=200.0, gap=GAP, y=100.0):
    return [bl(0, (100, y), (100 + len_, y)), bl(1, (100, y + gap), (100 + len_, y + gap))], [
        dashed(0, (100, y + gap / 2), (100 + len_, y + gap / 2))
    ]


# --- the rules ---


def test_a_clean_pair_is_one_beam_on_the_midline() -> None:
    lines, dash = pair_of()
    res = pair_lines(lines, STYLE, RATIO, dash)
    assert len(res.pairs) == 1 and len(res.lines) == 1 and res.unpaired == []
    ln = res.lines[0]
    assert ln.p0[1] == ln.p1[1] == 100.0 + GAP / 2
    assert math.isclose(ln.length, 200.0, abs_tol=0.01)
    p = res.pairs[0]
    assert p.amber == [] and p.cut_ends == 0 and p.centreline == 1.0
    assert ln.evidence["pair"]["gap_in"] == round(GAP / 72 * RATIO, 2)
    assert ln.seg_ids == [0, 1]


def test_any_angle_a_diagonal_pair() -> None:
    a = math.radians(35.0)
    ux, uy = math.cos(a), math.sin(a)
    nx, ny = -uy, ux
    base = (300.0, 200.0)

    def pt(t, off):
        return (base[0] + ux * t + nx * off, base[1] + uy * t + ny * off)

    lines = [bl(0, pt(0, 0), pt(150, 0)), bl(1, pt(0, 2.5), pt(150, 2.5))]
    dash = [dashed(0, pt(0, 1.25), pt(150, 1.25))]
    res = pair_lines(lines, BeamStyle("double", 2.5, 2.5, True), RATIO, dash)
    assert len(res.lines) == 1
    mid = res.lines[0]
    assert math.isclose(mid.length, 150.0, abs_tol=0.05)
    assert math.isclose(math.dist(mid.p0, pt(0, 1.25)), 0.0, abs_tol=0.05)


def test_parallel_spacing_alone_is_not_a_pair() -> None:
    lines, _ = pair_of()
    assert pair_lines(lines, STYLE, RATIO, []).pairs == []  # no dashed centreline between them
    assert evaluate_pair(lines[0], lines[1], STYLE, RATIO, []) is None


def test_no_centreline_needed_style_makes_an_amber_pair() -> None:
    lines, _ = pair_of()
    res = pair_lines(lines, BeamStyle("double", GAP, GAP, False), RATIO, [])
    assert len(res.pairs) == 1
    assert "no dashed centreline between the two lines" in res.pairs[0].amber


def test_the_gap_must_fit_the_learned_gap_and_a_real_flange_width() -> None:
    far, dash = pair_of(gap=GAP * 3)  # 3x the learned gap: another member, not this flange
    assert pair_lines(far, STYLE, RATIO, dash).pairs == []
    huge, dash = pair_of(gap=40.0)  # 53 in: no flange is that wide
    assert (
        evaluate_pair(huge[0], huge[1], BeamStyle("double", None, None, True), RATIO, dash) is None
    )
    tiny, dash = pair_of(gap=0.4)  # 0.5 in: narrower than any catalog flange
    assert (
        evaluate_pair(tiny[0], tiny[1], BeamStyle("double", None, None, True), RATIO, dash) is None
    )


def test_beams_of_other_sizes_on_the_page_still_pair() -> None:
    wide, dash = pair_of(gap=GAP * 1.4)  # a W12x26 on a page learned from a W8x18
    assert len(pair_lines(wide, STYLE, RATIO, dash).pairs) == 1


def test_lines_must_overlap_most_of_the_run() -> None:
    lines = [bl(0, (100, 100), (300, 100)), bl(1, (260, 100 + GAP), (460, 100 + GAP))]
    dash = [dashed(0, (100, 100 + GAP / 2), (460, 100 + GAP / 2))]
    assert pair_lines(lines, STYLE, RATIO, dash).pairs == []


def test_a_line_cut_by_a_crossing_member_pairs_with_each_piece() -> None:
    # one flange line runs the whole bay, the other is broken where a member crosses it
    lines = [
        bl(0, (100, 100), (500, 100)),
        bl(1, (100, 100 + GAP), (220, 100 + GAP)),
        bl(2, (300, 100 + GAP), (500, 100 + GAP)),
    ]
    dash = [dashed(0, (100, 100 + GAP / 2), (500, 100 + GAP / 2))]
    res = pair_lines(lines, STYLE, RATIO, dash)
    assert len(res.pairs) == 2 and len(res.lines) == 2
    assert sorted(round(ln.length) for ln in res.lines) == [120, 200]
    assert all(p.cut_ends == 1 for p in res.pairs)  # one end cut by the crossing member each
    assert res.unpaired == []


def test_ends_apart_without_a_centreline_are_not_a_pair() -> None:
    lines = [bl(0, (100, 100), (500, 100)), bl(1, (100, 100 + GAP), (220, 100 + GAP))]
    assert pair_lines(lines, STYLE, RATIO, []).pairs == []


def test_ends_a_little_apart_are_amber_not_merged_silently() -> None:
    lines = [bl(0, (100, 100), (300, 100)), bl(1, (104, 100 + GAP), (300, 100 + GAP))]
    dash = [dashed(0, (100, 100 + GAP / 2), (300, 100 + GAP / 2))]
    res = pair_lines(lines, STYLE, RATIO, dash)
    assert len(res.pairs) == 1 and any("apart" in a for a in res.pairs[0].amber)


def test_an_ambiguous_partner_is_amber() -> None:
    lines = [
        bl(0, (100, 100), (300, 100)),
        bl(1, (100, 100 + GAP), (300, 100 + GAP)),
        bl(2, (100, 100 + GAP * 1.02), (300, 100 + GAP * 1.02)),
    ]
    dash = [dashed(0, (100, 100 + GAP / 2), (300, 100 + GAP / 2))]
    res = pair_lines(lines, STYLE, RATIO, dash)
    assert len(res.pairs) == 1 and res.ambiguous == 1
    assert any("ambiguous" in a for a in res.pairs[0].amber)
    assert len(res.unpaired) == 1


def test_double_drops_unpaired_thin_lines_both_keeps_them() -> None:
    lines, dash = pair_of()
    lines.append(bl(2, (100, 400), (260, 400)))  # a lone thin line (a leader, a section mark)
    d = pair_lines(lines, STYLE, RATIO, dash)
    assert len(d.lines) == 1 and len(d.unpaired) == 1 and d.kept_single == 0
    b = pair_lines(lines, BeamStyle("both", GAP, GAP, True), RATIO, dash)
    assert len(b.lines) == 2 and b.kept_single == 1
    assert b.lines[1].evidence is None  # the kept line is a plain single-line beam


# --- learning ---


def test_learning_a_thin_pair_with_a_dashed_centreline() -> None:
    lines, dash = pair_of()
    got = learn_style(lines, (200, 100), PEN, RATIO, dash)
    assert got.style == "double" and got.centreline_required
    assert math.isclose(got.gap_min_pt, GAP, abs_tol=0.01)


def test_learning_never_calls_a_heavy_pen_double() -> None:
    lines, dash = pair_of()
    got = learn_style(lines, (200, 100), "1.5-2.5|black|solid", RATIO, dash)
    assert got.style == "single" and "heavy" in got.evidence["reason"]
    assert is_thin_pen(PEN) and not is_thin_pen("1.5-2.5|black|solid")


def test_learning_a_close_thin_pair_without_a_centreline_stays_single() -> None:
    lines, _ = pair_of()
    got = learn_style(lines, (200, 100), PEN, RATIO, [])
    assert got.style == "single" and "no dashed centreline" in got.evidence["reason"]


def test_learning_a_lone_line_and_a_click_on_nothing() -> None:
    lone = [bl(0, (100, 100), (300, 100))]
    assert learn_style(lone, (200, 100), PEN, RATIO, []).style == "single"
    assert learn_style(lone, (200, 500), PEN, RATIO, []).style == "single"


def test_learning_without_a_scale_skips_only_the_real_width_check() -> None:
    lines, dash = pair_of()
    assert learn_style(lines, (200, 100), PEN, None, dash).style == "double"


# --- the width check ---


class _Label:
    canonical = "W8X18"


def test_width_check_against_bf() -> None:
    assert width_check(5.25, _Label(), 5.25) == []
    assert width_check(5.9, _Label(), 5.25) == []  # inside max(0.75 in, 20 %)
    bad = width_check(7.4, _Label(), 5.25)
    assert len(bad) == 1 and "7.40 in" in bad[0] and "W8X18" in bad[0] and "5.25" in bad[0]
    assert width_check(7.4, None, 5.25) == [] and width_check(7.4, _Label(), None) == []
    assert width_check(None, _Label(), 5.25) == []


# --- the build on a synthetic page ---


def _page(*, double: bool = True, heavy_pair: bool = False) -> pymupdf.Page:
    doc = pymupdf.open()
    page = doc.new_page(width=1000, height=800)
    if double:  # a beam drawn as two thin flange lines with a dashed centreline
        line(page, (200, 300), (500, 300), THIN)
        line(page, (200, 300 + GAP), (500, 300 + GAP), THIN)
        line(page, (200, 300 + GAP / 2), (500, 300 + GAP / 2), 0.2, dashes="[8 4] 0")
    if heavy_pair:  # two close parallel HEAVY single-line beams ("W12x19 (10)" rows)
        for y in (500.0, 500.0 + GAP):
            line(page, (200, y), (500, y), 2.0)
    return page


def _setup(pens, style) -> Setup:
    return Setup((0, 0, 1000, 800), RATIO, None, pens[0], "framing", pens=pens, beam_style=style,
                 column_mode="click_first")  # fmt: skip


def test_build_style_single_is_todays_behaviour_each_flange_line_is_a_beam() -> None:
    page = _page()
    b = build_page(page, _setup((PEN,), None))
    assert len(b.lines) == 2 and b.double_line == {}
    assert not any(k.startswith("double_") for k in b.counts())
    same = build_page(page, _setup((PEN,), BeamStyle("single")))
    assert [(ln.p0, ln.p1) for ln in same.lines] == [(ln.p0, ln.p1) for ln in b.lines]


def test_build_style_double_one_beam_on_the_centreline() -> None:
    b = build_page(_page(), _setup((PEN,), STYLE))
    assert len(b.lines) == 1
    ln = b.lines[0]
    assert math.isclose(ln.p0[1], 300 + GAP / 2, abs_tol=0.1) and math.isclose(
        ln.length, 300, abs_tol=0.2
    )
    assert b.double_line["pairs"] == 1 and b.double_line["unpaired_thin_lines"] == 0
    assert b.counts()["double_pairs"] == 1
    assert ln.evidence and ln.evidence["pair"]["centreline"] >= 0.6


def test_build_close_parallel_heavy_lines_are_never_paired() -> None:
    heavy = "1.5-2.5|black|solid"
    page = _page(double=False, heavy_pair=True)
    base = build_page(page, _setup((heavy,), None))
    for style in (STYLE, BeamStyle("both", GAP, GAP, True), BeamStyle("double", None, None, False)):
        b = build_page(page, _setup((heavy,), style))
        assert len(b.lines) == len(base.lines) == 2
        assert [(ln.p0, ln.p1) for ln in b.lines] == [(ln.p0, ln.p1) for ln in base.lines]
        assert b.double_line == {}  # a heavy pen is never searched for pairs


def test_the_centrelines_are_found_from_every_segment() -> None:
    page = _page()
    from src.build.segments import parse_page

    found = centrelines(parse_page(page))
    assert len(found) == 1 and found[0].dashed


def test_a_pair_on_a_filled_beam_is_not_taken_for_a_wall_face() -> None:
    # the beam's flange is drawn with a grey fill between the two lines (page 8 of the fit set):
    # the wall-face rule sees a filled band beside the midline; a pair is exempt from it
    page = _page()
    page.draw_rect(pymupdf.Rect(200, 300, 500, 300 + GAP), color=None, fill=(0.85, 0.85, 0.85))
    b = build_page(page, _setup((PEN,), STYLE))
    assert len(b.lines) == 1 and b.removed["wall_lines"] == 0
    assert b.double_line["pairs"] == 1


def test_the_centreline_must_lie_on_the_midline_not_just_somewhere_between() -> None:
    lines, _ = pair_of(
        gap=11.5
    )  # a dashed line 2.4 pt off the midline: a hidden line, not a centreline
    off = [dashed(0, (100, 100 + 11.5 / 2 - 2.4), (300, 100 + 11.5 / 2 - 2.4))]
    assert pair_lines(lines, BeamStyle("double", None, None, True), RATIO, off).pairs == []
    exact = [dashed(0, (100, 100 + 11.5 / 2 + 0.4), (300, 100 + 11.5 / 2 + 0.4))]
    assert len(pair_lines(lines, BeamStyle("double", None, None, True), RATIO, exact).pairs) == 1
