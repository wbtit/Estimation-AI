"""Line-first build, one test group per step, on SYNTHETIC PDFs only (tests/build_factory.py)."""

from __future__ import annotations

import math

import numpy as np
import pymupdf
import pytest
from build_factory import XS, YS, bubble, column, framing_plan, grids, line, pieces

from src.build.beam_lines import beam_lines, parse_pen_class
from src.build.clean import clean
from src.build.columns import REPEAT_MIN, column_plan_columns, find_glyphs
from src.build.geom import clip_segment, seg_intersection
from src.build.grids import crossings, find_bubbles, find_grid_lines
from src.build.labels import attach_to_columns, attach_to_pieces, find_labels
from src.build.page import ColumnPlanRef, Setup, build_page
from src.build.pieces import build_state, length_mm, stable_member_id
from src.build.register import register
from src.build.segments import TextLine, crop, page_text_lines, parse_page
from src.build.supports import build
from src.text_layer.parsers.studs_camber import find_camber, find_studs

FULL = (0.0, 0.0, 1000.0, 800.0)
PEN = "1.5-2.5|black|solid"


def _page(w=1000, h=800):
    doc = pymupdf.open()
    return doc, doc.new_page(width=w, height=h)


def _steps(page, box=FULL, pen=PEN):
    text = page_text_lines(page)
    ps = crop(parse_page(page), box)
    cl = clean(ps, text)
    bub = find_bubbles(ps, text, box)
    grid, _ = find_grid_lines(ps, cl.keep, bub)
    cross = crossings(grid)
    glyphs = find_glyphs(ps, box, bub, text, cross)
    lines = beam_lines(ps, cl.keep, pen)
    return text, ps, cl, bub, grid, cross, glyphs, lines


def _hv(p):
    return tuple(round(v) for v in p)


# ---- step 2: segments ---------------------------------------------------------------------------
def test_segments_are_in_displayed_points_on_a_rotated_page():
    doc, page = _page(400, 300)
    page.set_rotation(90)
    page.draw_line((10, 20), (110, 20), width=2.0)
    ps = parse_page(page)
    assert len(ps) == 1
    x0, y0, x1, y1 = ps.seg[0]
    m = page.rotation_matrix
    a, b = pymupdf.Point(10, 20) * m, pymupdf.Point(110, 20) * m
    assert {(round(x0), round(y0)), (round(x1), round(y1))} == {
        (round(a.x), round(a.y)),
        (round(b.x), round(b.y)),
    }


def test_thin_filled_rectangle_is_a_segment_with_its_thickness_as_width():
    doc, page = _page()
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(100, 100, 300, 103))
    s.finish(fill=(0, 0, 0), color=None, width=0)
    s.commit()
    ps = parse_page(page)
    assert len(ps) == 1 and abs(ps.width[0] - 3.0) < 1e-6 and ps.colour[0] == "black"
    assert ps.pen(0) == (">2.5", "black")


def test_crop_clips_segments_and_keeps_inner_shapes():
    doc, page = _page()
    line(page, (0, 100), (1000, 100))
    column(page, (500, 100))
    column(page, (950, 700))
    ps = crop(parse_page(page), (200, 50, 800, 600))
    xs = sorted({round(v) for v in ps.seg[:, [0, 2]].ravel()})
    assert xs[0] >= 200 and xs[-1] <= 800
    assert sum(sh.paint == "f" for sh in ps.shapes) == 1  # the column at (950, 700) is outside


def test_clip_segment_outside_is_none():
    assert clip_segment((0, 0), (10, 0), (20, -5, 30, 5)) is None
    assert clip_segment((0, 0), (40, 0), (20, -5, 30, 5)) == ((20.0, 0.0), (30.0, 0.0))


# ---- step 3: clean ------------------------------------------------------------------------------
def test_hatch_dimension_and_text_strokes_are_removed_and_the_beam_stays():
    doc, page = _page()
    line(page, (100, 600), (900, 600))  # the beam
    for k in range(8):  # a hatch stack
        line(page, (100 + 2 * k, 100), (140 + 2 * k, 140), width=0.2)
    line(page, (300, 300), (500, 300), width=0.2)  # a dimension line with ticks and a number
    line(page, (297.5, 302.5), (302.5, 297.5), width=0.2)
    line(page, (497.5, 302.5), (502.5, 297.5), width=0.2)
    page.insert_text((380, 295), "10'-0\"", fontsize=8)
    page.insert_text((600, 450), "NOTE", fontsize=20)  # a text box ...
    line(page, (602, 448), (650, 448), width=0.2)  # ... with a stroke inside it (underline)
    ps = parse_page(page)
    cl = clean(ps, page_text_lines(page))
    kept = [tuple(np.round(ps.seg[i])) for i in range(len(ps)) if cl.keep[i]]
    assert (100, 600, 900, 600) in kept
    assert cl.removed["hatch"] >= 8
    assert cl.removed["dimension"] >= 1
    assert cl.removed["text"] >= 1
    assert (300, 300, 500, 300) not in kept


# ---- step 4: grids ------------------------------------------------------------------------------
def test_grid_lines_from_bubbles_and_dash_dot_pieces_with_crossings():
    doc, page = _page()
    grids(page)
    _, ps, cl, bub, grid, cross, _, _ = _steps(page)
    assert sorted(b.label for b in bub) == ["1", "2", "3", "A", "B", "C"]
    assert sorted((g.family, g.label) for g in grid) == [
        ("A", "A"), ("A", "B"), ("A", "C"), ("N", "1"), ("N", "2"), ("N", "3"),
    ]  # fmt: skip
    assert len(cross) == 9
    pts = {(c.n_label, c.a_label): _hv(c.point) for c in cross}
    assert pts[("2", "B")] == (500, 400)


def test_a_long_solid_grid_line_counts_and_one_axis_with_two_bubbles_is_one_line():
    doc, page = _page()
    bubble(page, (300, 60), "D")
    bubble(page, (300, 740), "D")
    line(page, (300, 72), (300, 728), width=0.3, color=(0.5, 0.5, 0.5))
    _, _, _, _, grid, _, _, _ = _steps(page)
    assert len(grid) == 1 and grid[0].label == "D" and len(grid[0].bubbles) == 2


def test_no_bubble_or_a_line_that_misses_the_bubble_is_no_grid():
    doc, page = _page()
    pieces(page, (100, 100), (100, 700))  # no bubble at all
    bubble(page, (400, 60), "E")
    pieces(page, (400, 150), (400, 700))  # ends 78 pt away from the bubble
    bubble(page, (700, 60), "F")
    pieces(page, (720, 72), (720, 700))  # off the bubble axis by 20 pt
    _, _, _, bub, grid, _, _, _ = _steps(page)
    assert len(bub) == 2 and grid == []


def test_a_circle_with_long_text_is_not_a_bubble():
    doc, page = _page()
    s = page.new_shape()
    s.draw_circle((300, 300), 15)
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    page.insert_text((290, 303), "NOTE5", fontsize=6)
    assert _steps(page)[3] == []


# ---- step 5: columns ----------------------------------------------------------------------------
def test_column_glyphs_at_grid_crossings():
    doc, page = _page()
    grids(page)
    for x in XS.values():
        for y in YS.values():
            column(page, (x, y))
    column(page, (420, 520))  # off the grid
    *_, glyphs, _ = _steps(page)
    assert len(glyphs) == 10
    assert sum(g.at_grid for g in glyphs) == 9
    cols, rule = column_plan_columns(glyphs, has_grid=True)
    assert rule == "glyph_at_grid" and len(cols) == 9


def test_without_a_grid_the_column_plan_takes_the_repeated_glyph():
    doc, page = _page()
    for k in range(REPEAT_MIN + 1):
        column(page, (100 + 100 * k, 300))
    column(page, (300, 600), size=16)  # one bigger, different symbol
    *_, glyphs, _ = _steps(page)
    cols, rule = column_plan_columns(glyphs, has_grid=False)
    assert rule == "repeated_glyph" and len(cols) == REPEAT_MIN + 1
    doc2, page2 = _page()
    for k in range(REPEAT_MIN - 1):
        column(page2, (100 + 100 * k, 300))
    assert column_plan_columns(_steps(page2)[6], has_grid=False) == ([], "none")


def test_a_shape_inside_a_text_box_is_not_a_glyph():
    doc, page = _page()
    page.insert_text((100, 120), "XXXXXXXXXX", fontsize=24)
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(110, 100, 118, 108))
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    column(page, (500, 500))
    assert len(_steps(page)[6]) == 1


# ---- step 5b: registration ----------------------------------------------------------------------
def _grid_only(dx=0.0, dy=0.0, letters=("A", "B", "C"), numbers=("1", "2", "3")):
    doc, page = _page()
    for lab in letters:
        x = XS[lab] + dx
        bubble(page, (x, 80 + dy), lab)
        pieces(page, (x, 92 + dy), (x, 720 + dy))
    for lab in numbers:
        y = YS[lab] + dy
        bubble(page, (80 + dx, y), lab)
        pieces(page, (92 + dx, y), (920 + dx, y))
    return _steps(page)[4]


def test_registration_of_a_shifted_page_recovers_the_shift():
    plan, page = _grid_only(), _grid_only(dx=30.0, dy=-20.0)
    reg = register(page, 96.0, plan, 96.0)
    assert reg.ok and abs(reg.theta_deg) < 1e-6 and reg.residual_mm < 1.0
    k = 25.4 / 72 * 96
    assert reg.tx == pytest.approx(-30 * k, abs=1) and reg.ty == pytest.approx(-20 * k, abs=1)
    assert sorted(reg.matched) == ["1", "2", "3", "A", "B", "C"]


def test_registration_needs_two_matched_lines_in_two_directions():
    plan = _grid_only()
    assert register(_grid_only(letters=("A",), numbers=()), 96, plan, 96).reason == (
        "too_few_matched"
    )
    assert register(_grid_only(letters=("A", "B"), numbers=()), 96, plan, 96).reason == (
        "parallel_only"
    )
    two = register(_grid_only(letters=("A",), numbers=("1",)), 96, plan, 96)
    assert two.ok and sorted(two.matched) == ["1", "A"]


def test_registration_with_a_wrong_scale_is_refused():
    plan, page = _grid_only(), _grid_only()
    assert register(page, 48.0, plan, 96.0).reason == "residual_too_large"


# ---- step 6: beam lines -------------------------------------------------------------------------
def test_gaps_up_to_24pt_are_bridged_on_solid_lines_and_larger_ones_are_not():
    doc, page = _page()
    line(page, (100, 100), (300, 100))
    line(page, (320, 100), (500, 100))  # 20 pt gap: one line
    line(page, (100, 300), (300, 300))
    line(page, (330, 300), (500, 300))  # 30 pt gap: two lines
    lines = _steps(page)[7]
    spans = sorted((_hv(ln.p0), _hv(ln.p1)) for ln in lines)
    assert len(lines) == 3
    one = [ln for ln in lines if round(ln.p0[1]) == 100][0]
    assert one.gaps == [20.0] and len(one.seg_ids) == 2
    assert ((100, 300), (300, 300)) in [tuple(sorted(s)) for s in spans]


def test_merge_needs_direction_within_1_degree_and_offset_within_1pt():
    doc, page = _page()
    line(page, (100, 100), (300, 100))
    line(page, (305, 102.5), (500, 102.5))  # 2.5 pt off: separate
    line(page, (100, 400), (300, 400))
    line(page, (305, 400.5), (500, 400.5))  # 0.5 pt off: merged
    lines = _steps(page)[7]
    assert len(lines) == 3


def test_dashed_hidden_lines_are_never_solid_beams_and_dash_mode_takes_only_them():
    doc, page = _page()
    line(page, (100, 100), (600, 100))  # solid beam
    for k in range(30):  # dashes drawn as pieces, 6 pt with 4 pt gaps
        line(page, (100 + 10 * k, 300), (106 + 10 * k, 300))
    line(page, (100, 500), (600, 500), dashes="[6 4] 0")  # a PDF dash array
    solid = _steps(page)[7]
    assert [sorted((_hv(ln.p0), _hv(ln.p1))) for ln in solid] == [[(100, 100), (600, 100)]]
    dash = _steps(page, pen="1.5-2.5|black|dash")[7]
    assert sorted(round(ln.p0[1]) for ln in dash) == [300, 500]
    assert all(ln.dashed for ln in dash)


def test_other_pens_are_not_beam_lines():
    doc, page = _page()
    line(page, (100, 100), (600, 100), width=0.3)
    line(page, (100, 200), (600, 200), color=(1, 0, 0))
    assert _steps(page)[7] == []
    with pytest.raises(ValueError):
        parse_pen_class("1.5-2.5|black")


# ---- step 7: supports and pieces ----------------------------------------------------------------
def test_girders_split_at_columns_beams_at_girders_and_girders_not_at_beams():
    doc = pymupdf.open()
    page = framing_plan(doc, labels=False)
    _, _, _, _, _, _, glyphs, lines = _steps(page)
    res = build(lines, glyphs, [])
    by_line = {}
    for p in res.pieces:
        by_line.setdefault(p.line, []).append(p)
    girders = [ln for ln in res.lines if ln.role == "girder"]
    assert len(girders) == 3  # grids 1, 2, 3 meet columns at A, B, C
    g1 = [ln for ln in girders if round(ln.p0[1]) == 200][0]
    assert len(by_line[g1.id]) == 2  # A-B and B-C: the beams at x 350 and 650 do not split it
    beam = [ln for ln in res.lines if round(ln.p0[0]) == 350][0]
    assert beam.role == "beam" and beam.level == 2
    assert [p.index for p in by_line[beam.id]] == [1, 2]  # split at girder 2
    assert all(p.support_state == "both" for p in by_line[beam.id])
    assert res.counts["nodes_beam_intersection"] >= 4


def test_a_cantilever_end_is_kept_and_flagged_and_a_floating_line_has_no_support():
    doc = pymupdf.open()
    page = framing_plan(doc, labels=False)
    line(page, (300, 700), (450, 700))  # floating, below everything
    _, _, _, _, _, _, glyphs, lines = _steps(page)
    res = build(lines, glyphs, [])
    states = sorted(
        (p.support_state, _hv(p.a), _hv(p.b))
        for p in res.pieces
        if {round(p.a[1]), round(p.b[1])} in ({400}, {700})
        and max(p.a[0], p.b[0]) > 850
        or round(p.a[1]) == 700
    )
    assert ("none", (300, 700), (450, 700)) in [
        (s, tuple(sorted([a, b]))[0], tuple(sorted([a, b]))[1]) for s, a, b in states
    ]
    assert any(s == "one" for s, _, _ in states)  # the cantilever off C2


def test_a_glyph_touched_by_one_line_is_not_a_support_and_one_at_a_grid_is():
    doc, page = _page()
    line(page, (100, 300), (700, 300))
    column(page, (400, 300))  # a small square on one line only (a tag box, say)
    _, _, _, _, _, _, glyphs, lines = _steps(page)
    res = build(lines, glyphs, [])
    assert res.counts["nodes_glyph"] == 0 and len(res.pieces) == 1
    assert res.pieces[0].support_state == "none"


def test_projected_columns_are_supports_and_merge_with_a_glyph_at_the_same_place():
    doc, page = _page()
    line(page, (100, 300), (700, 300))
    column(page, (700, 300))
    line(page, (700, 100), (700, 500))  # so the glyph at (700, 300) meets two lines
    _, _, _, _, _, _, glyphs, lines = _steps(page)
    res = build(lines, glyphs, [((100.0, 300.0), {"column_member_id": "c1"}), ((703, 301), {})])
    assert res.counts["nodes_projected"] == 1 and res.counts["nodes_glyph"] == 1
    horiz = [p for p in res.pieces if round(p.a[1]) == round(p.b[1]) == 300]
    assert len(horiz) == 1 and horiz[0].support_state == "both"


def test_a_short_overhang_past_the_last_support_is_trimmed_not_a_piece():
    doc, page = _page()
    for x in (200, 500):
        column(page, (x, 300))
        line(page, (x, 200), (x, 400), width=2.0)
    line(page, (195, 300), (508, 300))  # 5 and 8 pt past the columns
    _, _, _, _, _, _, glyphs, lines = _steps(page)
    res = build(lines, glyphs, [])
    horiz = [p for p in res.pieces if round(p.a[1]) == round(p.b[1]) == 300]
    assert len(horiz) == 1 and horiz[0].trimmed_pt > 0
    assert sorted(round(v) for v in (horiz[0].a[0], horiz[0].b[0])) == [200, 500]


def test_seg_intersection_extension():
    assert seg_intersection((0, 0), (10, 0), (15, -5), (15, 5), ext_a=6) is not None
    assert seg_intersection((0, 0), (10, 0), (15, -5), (15, 5), ext_a=4) is None


# ---- step 8: labels -----------------------------------------------------------------------------
def _tl(text, box, angle=0.0):
    return TextLine(text, box, angle)


def test_parallel_label_on_the_piece_wins_over_a_nearer_perpendicular_one():
    pcs = [((100.0, 100.0), (400.0, 100.0)), ((100.0, 300.0), (400.0, 300.0))]
    labels = find_labels(
        [
            _tl('W16X26 <12> C=3/4"', (200, 85, 260, 95)),  # parallel, 10 pt above piece 0
            _tl("W12X14", (395, 105, 405, 135), angle=90.0),  # perpendicular, nearer piece 0 end
        ],
        {},
    )
    got = attach_to_pieces(pcs, labels)
    assert got[0].size_state == "sized" and got[0].label.raw == "W16X26"
    assert got[0].label.studs == 12 and got[0].label.camber_raw == 'C=3/4"'
    assert got[1].size_state == "undefined"


def test_a_label_attaches_to_one_piece_others_are_inferred_or_undefined():
    pcs = [((100.0, 100.0), (300.0, 100.0)), ((100.0, 120.0), (300.0, 120.0))]
    labels = find_labels([_tl("W10X12", (180, 106, 220, 112))], {})  # between both, nearer 0
    got = attach_to_pieces(pcs, labels)
    assert [g.size_state for g in got] == ["sized", "inferred"]
    assert got[1].rule == "nearest_any"


def test_a_label_off_the_end_of_the_piece_is_not_on_it():
    pcs = [((100.0, 100.0), (200.0, 100.0))]
    got = attach_to_pieces(pcs, find_labels([_tl("W10X12", (300, 90, 340, 98))], {}))
    assert got[0].size_state == "undefined"


def test_a_mark_with_one_legend_row_is_a_label():
    legend = {"B1": [("W18X35", "W18X35")], "B2": [("W8X10", "W8X10"), ("W8X13", "W8X13")]}
    labels = find_labels([_tl("B1", (0, 0, 10, 5)), _tl("B2", (0, 20, 10, 25))], legend)
    assert [(lb.kind, lb.mark, lb.canonical) for lb in labels] == [("mark", "B1", "W18X35")]
    got = attach_to_pieces([((-50.0, 8.0), (60.0, 8.0))], labels)
    assert got[0].size_state == "sized" and got[0].rule == "legend_mark"


def test_column_label_is_the_nearest_within_reach():
    labels = find_labels([_tl("HSS6X6X1/4", (110, 90, 150, 98))], {})
    got = attach_to_columns([(100.0, 100.0), (500.0, 500.0)], labels)
    assert [g.size_state for g in got] == ["sized", "undefined"]


def test_studs_and_camber_parsers():
    assert find_studs("W16X26 <12>").count == 12
    assert find_studs("W16X26 (12)") is None
    assert find_studs("<8> and <10>") is None
    assert float(find_camber('C=3/4"').inches) == 0.75
    assert find_camber('C = 1 1/2"').mm == pytest.approx(38.1)
    assert find_camber("C=1'") is None and find_camber("ABC=2") is None
    assert find_camber("C=12'") is None


# ---- steps 9 and 10: pieces ---------------------------------------------------------------------
def test_length_is_support_to_support_times_scale():
    assert length_mm((0, 0), (72, 0), 96.0) == pytest.approx(25.4 * 96)


def test_colour_state_rules():
    assert build_state("sized", "both") == "found"
    assert build_state("inferred", "both") == "needs_review"
    assert build_state("sized", "one") == "needs_review"
    assert build_state("undefined", "both") == "attention"
    assert build_state("sized", "none") == "attention"


def test_stable_ids_ignore_direction_and_tiny_moves():
    a = stable_member_id("s", "Beams", (100.0, 200.0), (300.0, 200.0))
    assert a == stable_member_id("s", "Beams", (300.2, 200.1), (100.1, 199.9))
    assert a != stable_member_id("s", "Beams", (100.0, 200.0), (310.0, 200.0))
    assert a != stable_member_id("t", "Beams", (100.0, 200.0), (300.0, 200.0))
    assert stable_member_id("s", "Column", (5.0, 5.0)).startswith("LF-C-")


# ---- the whole page -----------------------------------------------------------------------------
def test_framing_page_end_to_end():
    doc = pymupdf.open()
    page = framing_plan(doc)
    pb = build_page(page, Setup((40, 40, 960, 760), 96.0, 3000.0, PEN, "framing"))
    c = pb.counts()
    assert pb.notes == ["no_column_plan"]
    assert c["grid_lines"] == 6 and c["grid_crossings"] == 9 and c["nodes_glyph"] == 9
    assert c["beam_lines"] == 5 and c["girders"] == 3 and c["pieces"] == 10
    assert c["pieces_sized"] == 3 and c["pieces_one"] == 1 and c["pieces_none"] == 0
    total = sum(length_mm(p.a, p.b, 96.0) for p in pb.supports.pieces)
    # girders 3 x 600 pt + beams 200 + 200 + 200 + cantilever 100 = 2500 pt
    assert total == pytest.approx(2500 * 25.4 / 72 * 96, rel=1e-3)


def test_column_plan_then_framing_page_with_projected_columns_and_no_glyphs():
    doc = pymupdf.open()
    plan_page = doc.new_page(width=1000, height=800)
    grids(plan_page)
    for x in XS.values():
        for y in YS.values():
            column(plan_page, (x, y))
    plan = build_page(plan_page, Setup((40, 40, 960, 760), 96.0, None, None, "column_plan"))
    assert len(plan.columns) == 9 and plan.notes == ["columns_by_glyph_at_grid"]
    ref = ColumnPlanRef(
        plan.grid_lines, 96.0, [(g.centre, {"column_member_id": "x"}) for g in plan.columns]
    )
    page = framing_plan(doc, with_columns=False)
    pb = build_page(page, Setup((40, 40, 960, 760), 96.0, 3000.0, PEN, "framing"), column_plan=ref)
    c = pb.counts()
    assert pb.registration is not None and pb.registration.ok
    assert c["nodes_projected"] == 9 and c["nodes_glyph"] == 0
    assert c["girders"] == 3 and c["pieces"] == 10


def test_a_framing_page_whose_grids_do_not_register_still_builds_from_girders_and_glyphs():
    doc = pymupdf.open()
    plan_page = doc.new_page(width=1000, height=800)
    grids(plan_page)
    for x in XS.values():
        for y in YS.values():
            column(plan_page, (x, y))
    plan = build_page(plan_page, Setup((40, 40, 960, 760), 96.0, None, None, "column_plan"))
    ref = ColumnPlanRef(plan.grid_lines, 96.0, [(g.centre, {}) for g in plan.columns])
    page = doc.new_page(width=1000, height=800)  # the framing plan without any grid
    for y in YS.values():
        line(page, (XS["A"], y), (XS["C"], y))
    for x in XS.values():
        line(page, (x, YS["1"]), (x, YS["3"]))
        for y in YS.values():
            column(page, (x, y))
    line(page, (350, 200), (350, 400))
    s = Setup((40, 40, 960, 760), 96.0, 3000.0, PEN, "framing")
    pb = build_page(page, s, column_plan=ref)
    assert "no_grid" in pb.notes and "no_registration:too_few_matched" in pb.notes
    c = pb.counts()
    assert c["nodes_projected"] == 0 and c["nodes_glyph"] == 9  # rule (a): two lines meet each
    beam = [p for p in pb.supports.pieces if round(p.a[0]) == round(p.b[0]) == 350]
    assert len(beam) == 1 and beam[0].support_state == "both"  # rule (c): girders hold it
    lone = doc.new_page(width=1000, height=800)  # a single beam between two lone columns
    line(lone, (200, 300), (600, 300))
    column(lone, (200, 300))
    column(lone, (600, 300))
    pb2 = build_page(lone, s, column_plan=ref)
    assert [p.support_state for p in pb2.supports.pieces] == ["none"]  # kept, flagged


def test_build_is_deterministic():
    doc = pymupdf.open()
    page = framing_plan(doc)
    s = Setup((40, 40, 960, 760), 96.0, 3000.0, PEN, "framing")
    a, b = build_page(page, s), build_page(page, s)
    assert [(p.a, p.b, p.start_node, p.end_node) for p in a.supports.pieces] == [
        (p.a, p.b, p.start_node, p.end_node) for p in b.supports.pieces
    ]
    assert a.counts() == b.counts()
    assert math.isclose(sum(p.length_pt for p in a.supports.pieces), 2500, rel_tol=1e-3)


# ---- Phase 11 deviation: crossings by direction ------------------------------------------------
def _letters_both_ways(page):
    for lab, x in zip("ABC", XS.values(), strict=True):
        bubble(page, (x, 80.0), lab)
        pieces(page, (x, 92.0), (x, 720.0))
    for lab, y in zip("DEF", YS.values(), strict=True):
        bubble(page, (80.0, y), lab)
        pieces(page, (92.0, y), (920.0, y))


def test_letter_only_grids_are_split_by_direction_and_cross():
    doc, page = _page()
    _letters_both_ways(page)
    grid = _steps(page)[4]
    # Phase 12b rule "grid_family_by_direction": one letter family on both axes is split, the
    # more vertical lines become the number family, so the registered family rule finds crossings
    assert len(grid) == 6 and {g.family for g in grid} == {"A", "N"}
    assert all((g.family == "N") == (abs(g.p1[0] - g.p0[0]) < 1) for g in grid)
    assert len(crossings(grid)) == 9
    cross = crossings(grid, "direction")
    assert len(cross) == 9
    names = {(c.n_label, c.a_label): _hv(c.point) for c in cross}
    assert names[("B", "E")] == (500, 400)  # (more vertical, more horizontal)
    with pytest.raises(ValueError):
        crossings(grid, "nearest")


def test_direction_rule_ignores_lines_that_are_not_near_perpendicular():
    doc, page = _page()
    bubble(page, (300, 60), "A")
    line(page, (300, 72), (300, 700), width=0.3, color=(0.5, 0.5, 0.5))
    bubble(page, (60, 300), "B")
    line(page, (72, 300), (700, 480), width=0.3, color=(0.5, 0.5, 0.5))  # about 16 degrees off
    grid = _steps(page)[4]
    assert len(grid) == 2 and crossings(grid, "direction") == []


def test_the_build_uses_the_crossing_rule_of_its_setup():
    doc = pymupdf.open()
    page = doc.new_page(width=1000, height=800)
    _letters_both_ways(page)
    for x in XS.values():
        for y in YS.values():
            column(page, (x, y))
    frozen = build_page(page, Setup((40, 40, 960, 760), 96.0, None, None, "column_plan"))
    # Phase 12b: the letter-only grid is split by direction, so the family rule crosses it too
    assert frozen.counts()["grid_crossings"] == 9 and frozen.column_rule == "glyph_at_grid"
    s = Setup((40, 40, 960, 760), 96.0, None, None, "column_plan", crossing_rule="direction")
    dev = build_page(page, s)
    assert dev.counts()["grid_crossings"] == 9 and dev.column_rule == "glyph_at_grid"
    assert "crossing_rule_direction" in dev.notes and len(dev.columns) == 9
