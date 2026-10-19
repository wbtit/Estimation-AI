"""Phase 12b rules on SYNTHETIC pages only (docs/PHASE12B_PLAN.md section 1)."""

from __future__ import annotations

import math

import pymupdf
from build_factory import XS, YS, bubble, column, line, pieces

from src.build.dimension_scale import scale_from_dimensions, scale_from_ratios
from src.build.grids import crossings
from src.build.labels import attach_to_columns, attach_to_pieces, find_labels
from src.build.page import Setup, build_page
from src.build.page_roles import is_plan_text, page_role, skip_role_name
from src.build.segments import TextLine, crop, page_text_lines, parse_page

PEN = "1.5-2.5|black|solid"
BOX = (0.0, 0.0, 1000.0, 800.0)


def _page():
    doc = pymupdf.open()
    return doc, doc.new_page(width=1000, height=800)


# ---- rule scale_from_dimensions ---------------------------------------------------------------
def _dimension(page, a, b, text):
    """A dimension line with ticks at both ends and its text centred just above it."""
    line(page, a, b, width=0.25)
    for p in (a, b):
        line(page, (p[0] - 3, p[1] + 3), (p[0] + 3, p[1] - 3), width=0.25)
    mx = (a[0] + b[0]) / 2
    page.insert_text((mx - 12, a[1] - 3), text, fontsize=7)


def test_three_dimensions_that_agree_give_the_scale():
    doc, page = _page()
    # 1/8" = 1'-0" (96): 10'-0" = 90 pt, 20'-0" = 180 pt, 15'-0" = 135 pt
    _dimension(page, (100, 200), (190, 200), "10'-0\"")
    _dimension(page, (300, 300), (480, 300), "20'-0\"")
    _dimension(page, (100, 500), (235, 500), "15'-0\"")
    ps = crop(parse_page(page), BOX)
    out = scale_from_dimensions(ps, page_text_lines(page), BOX)
    assert out.rule == "dimensions" and out.ratio == 96.0 and out.agreeing == 3


def test_two_dimensions_are_too_few_and_disagreeing_ones_give_no_scale():
    assert scale_from_ratios([96.0, 96.5]).rule == "too_few"
    assert scale_from_ratios([96.0, 96.4, 48.0, 48.2]).rule == "no_majority"  # a tie
    assert scale_from_ratios([70.0, 70.5, 70.9]).rule == "no_standard"  # not a drawing scale
    assert scale_from_ratios([47.6, 48.0, 48.3, 96.0]).ratio == 48.0


# ---- rules plan_only_roles and pile_plan --------------------------------------------------------
def test_plan_texts_and_page_roles():
    assert is_plan_text("ROOF FRAMING PLAN") and is_plan_text("FOUNDATION PLAN")
    assert not is_plan_text("FRAMING SECTIONS") and not is_plan_text("FOUNDATION PLAN DETAILS")
    assert is_plan_text("ROOF FRAMING")  # framing with no non-plan word
    assert page_role("FRAMING SECTIONS", ["ROOF FRAMING PLAN"], "framing_plan").role is None
    assert page_role("FRAMING SECTIONS", [], "framing_plan").rule == "title_not_a_plan"
    assert page_role(None, ["TYPICAL SECTION", "BEAM DETAIL"], "framing_plan").rule == (
        "no_plan_text"
    )
    r = page_role(None, ["SECOND FLOOR FRAMING PLAN", "SECTION A"], "framing_plan")
    assert r.role == "framing" and not r.pile
    r = page_role("PILE PLAN", [], "foundation_plan")
    assert r.role == "column_plan" and r.pile
    assert page_role("FOUNDATION PLAN", [], "other").role == "column_plan"
    assert skip_role_name("FRAMING SECTIONS") == "Section"


# ---- rule joist_label ---------------------------------------------------------------------------
def test_a_line_labelled_as_a_joist_is_a_joist_and_never_takes_a_beam_size():
    t = [
        TextLine("30K7", (380, 290, 420, 298)),  # on the joist, parallel
        TextLine("W16X26", (380, 330, 420, 338)),  # the beam's label, nearer to it
        TextLine("24G8N8K", (380, 490, 430, 498)),  # a joist girder
    ]
    labels = find_labels(t, {})
    assert [lb.kind for lb in labels] == ["joist", "profile", "joist"]
    out = attach_to_pieces([((200, 300), (600, 300)), ((200, 340), (600, 340)),
                            ((200, 500), (600, 500))], labels)  # fmt: skip
    assert [a.size_state for a in out] == ["joist", "sized", "joist"]
    assert out[1].label.canonical == "W16X26"


# ---- rule grid_family_by_direction --------------------------------------------------------------
def test_one_prefix_on_both_axes_is_split_into_two_families():
    doc, page = _page()
    for k, x in enumerate((200.0, 500.0, 800.0)):
        bubble(page, (x, 80.0), f"E.1{k}")
        pieces(page, (x, 92.0), (x, 720.0))
    for k, y in enumerate((200.0, 400.0, 600.0)):
        bubble(page, (80.0, y), f"E.{k + 5}")
        pieces(page, (92.0, y), (920.0, y))
    pb = build_page(page, Setup((40, 40, 960, 760), 96.0, None, None, "column_plan"))
    assert {g.family for g in pb.grid_lines} == {"A", "N"}
    assert len(crossings(pb.grid_lines)) == 9


# ---- rule column_glyph_shape --------------------------------------------------------------------
def _triangle(page, c, s=8.0):
    sh = page.new_shape()
    sh.draw_polyline(
        [(c[0], c[1] - s / 2), (c[0] + s / 2, c[1] + s / 2), (c[0] - s / 2, c[1] + s / 2)]
    )
    sh.finish(fill=(0, 0, 0), color=(0, 0, 0), closePath=True)
    sh.commit()


def _dot(page, c, d=4.0):
    sh = page.new_shape()
    sh.draw_circle(c, d / 2)
    sh.finish(fill=(0, 0, 0), color=(0, 0, 0))
    sh.commit()


def test_repeated_markers_and_dots_are_not_columns_and_repeated_squares_are():
    doc, page = _page()
    for k in range(6):
        _triangle(page, (150 + 100 * k, 150))
        _dot(page, (150 + 100 * k, 300))
    for k in range(5):
        column(page, (150 + 120 * k, 500), size=8.0)  # 8 pt at 1/8" = 10.7 in: column-like
    pb = build_page(page, Setup(BOX, 96.0, None, None, "column_plan"))
    assert pb.column_rule == "repeated_glyph" and len(pb.columns) == 5
    assert all(round(g.centre[1]) == 500 for g in pb.columns)


def test_without_a_column_like_glyph_there_are_no_columns():
    doc, page = _page()
    for k in range(6):
        _triangle(page, (150 + 100 * k, 150))
    pb = build_page(page, Setup(BOX, 96.0, None, None, "column_plan"))
    assert pb.columns == []


# ---- rules column_label_leader and typical_column_size -----------------------------------------
def test_a_leader_gives_a_column_its_size_and_a_typ_note_sizes_the_same_glyphs():
    labels = find_labels(
        [
            TextLine("HSS8X8X1/2", (600, 100, 660, 108)),
            TextLine("W12X40 COL (TYP)", (100, 600, 180, 608)),
        ],
        {},
    )
    pts = [(300.0, 300.0), (500.0, 300.0), (700.0, 500.0)]
    boxes = [(p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5) for p in pts]
    leaders = [
        (602.0, 109.0, 302.0, 296.0),  # from the HSS label's box to column 1
        (150.0, 599.0, 498.0, 304.0),  # from the TYP label to column 2
    ]
    sig = ["square", "square", "square"]
    out = attach_to_columns(pts, labels, boxes, leaders, sig)
    assert [a.rule for a in out] == ["leader", "leader", "typical_note"]
    assert out[0].label.canonical == "HSS8X8X1/2" and out[2].label.canonical == "W12X40"
    assert out[2].size_state == "inferred"  # needs review


def test_a_beam_size_or_a_joist_next_to_a_column_is_not_its_size():
    labels = find_labels([TextLine("30K7", (300, 280, 330, 288)),
                          TextLine("C12X20.7", (300, 320, 350, 328))], {})  # fmt: skip
    out = attach_to_columns([(310.0, 300.0)], labels)
    assert out[0].size_state == "undefined"


def test_grid_and_columns_unchanged_for_the_factory_column_plan():
    doc, page = _page()
    for lab, x in XS.items():
        bubble(page, (x, 80.0), lab)
        pieces(page, (x, 92.0), (x, 720.0))
    for lab, y in YS.items():
        bubble(page, (80.0, y), lab)
        pieces(page, (92.0, y), (920.0, y))
    for x in XS.values():
        for y in YS.values():
            column(page, (x, y))
    pb = build_page(page, Setup((40, 40, 960, 760), 96.0, None, None, "column_plan"))
    assert pb.column_rule == "glyph_at_grid" and len(pb.columns) == 9
    assert math.isclose(len(pb.supports.nodes), 9)
