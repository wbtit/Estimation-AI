"""Phase 14c (v3 rules, docs/PHASE14C_PREREGISTRATION.md): the five column families, single and
double outlines, grid pieces, a solid shape as a clicked example only, profile to symbol (SYNTHETIC
geometry only; scale 1/4" = 1'-0", so 1 real inch = 1.5 pt)."""

from __future__ import annotations

import numpy as np
import pymupdf
import pytest

from src.build.col_symbols import (
    V2_RULES,
    V3_RULES,
    cross_check,
    find_callouts,
    find_symbols,
    grid_pieces,
    label_columns,
)
from src.build.grids import Bubble
from src.build.page import Setup
from src.build.segments import TextLine, parse_page
from tests.test_col_symbols import CROP, IN, RATIO, c_shape, cross_shape, i_shape, rect, seg

FLAGS = frozenset({"col_labels", "col_similar", "col_real_size"})


@pytest.fixture
def page():
    doc = pymupdf.open()
    yield doc.new_page(width=1000, height=800)
    doc.close()


def rounded(page, x, y, w, h, r=0.08, fill=None):
    """r = corner radius as a share of the short side (an HSS corner is about 2 walls: 6-8%)."""
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(x, y, x + w, y + h), radius=r)
    s.finish(color=(0, 0, 0), fill=fill, width=0.5)
    s.commit()


def circle(page, c, r, fill=None):
    s = page.new_shape()
    s.draw_circle(c, r)
    s.finish(color=(0, 0, 0), fill=fill, width=0.5)
    s.commit()


def syms(page, rules=V3_RULES, bubbles=()):
    ps = parse_page(page)
    keep = np.ones(len(ps), dtype=bool)
    return find_symbols(ps, keep, CROP, [], list(bubbles), RATIO, True, rules=rules)


def at(symbols, x, y):
    s = min(symbols, key=lambda s: abs(s.centre[0] - x) + abs(s.centre[1] - y))
    assert abs(s.centre[0] - x) + abs(s.centre[1] - y) < 3, (x, y)
    return s.family, s.solid


def test_the_five_families_with_single_and_double_outlines(page):
    rect(page, 50, 50, 12 * IN, 12 * IN)  # square, single
    rect(page, 150, 50, 12 * IN, 12 * IN)  # square, double (a wall inside)
    rect(page, 150 + 0.5 * IN, 50 + 0.5 * IN, 11 * IN, 11 * IN)
    rounded(page, 250, 50, 12 * IN, 12 * IN)  # square, rounded corners, double
    rounded(page, 250 + 0.5 * IN, 50 + 0.5 * IN, 11 * IN, 11 * IN)
    rect(page, 350, 50, 12 * IN, 8 * IN)  # rectangular, single
    rounded(page, 450, 50, 12 * IN, 8 * IN)  # rectangular, rounded, double
    rounded(page, 450 + 0.5 * IN, 50 + 0.5 * IN, 11 * IN, 7 * IN)
    circle(page, (580, 59), 6 * IN)  # round, single
    circle(page, (680, 59), 6 * IN)  # round, double (concentric)
    circle(page, (680, 59), 5.5 * IN)
    i_shape(page, 50, 250)  # W
    i_shape(page, 150, 250 + 1 * IN)  # W with cover plates beyond both flanges
    rect(page, 150, 250, 14 * IN, 1 * IN)
    rect(page, 150, 250 + 15 * IN, 14 * IN, 1 * IN)
    s = syms(page)
    assert at(s, 59, 59) == ("hss_square", None)
    assert at(s, 159, 59) == ("hss_square", None)
    assert at(s, 259, 59) == ("hss_square", None)
    assert at(s, 359, 56) == ("hss_rect", None)
    assert at(s, 459, 56) == ("hss_rect", None)
    assert at(s, 580, 59) == ("hss_round", None)
    assert at(s, 680, 59) == ("hss_round", None)
    assert at(s, 60.5, 260.5) == ("w_shape", None)
    assert at(s, 160.5, 262) == ("w_cover_plates", None)
    # v2 took any curved outline as round
    assert at(syms(page, V2_RULES), 259, 59)[0] == "hss_round"


def test_rounded_corners_stay_a_square_until_the_sides_are_short(page):
    """Prereg 14c 2.1 (amended order): straight sides of at least 25% make a rounded rectangle; a
    square rounded almost to a circle is round."""
    rounded(page, 50, 50, 12 * IN, 12 * IN, r=0.2)  # straight sides 60%
    rounded(page, 150, 50, 12 * IN, 12 * IN, r=0.45)  # straight sides 10%
    s = syms(page)
    assert at(s, 59, 59)[0] == "hss_square"
    assert at(s, 159, 59)[0] == "hss_round"


def test_square_and_rectangle_split_at_aspect_1_1(page):
    rect(page, 50, 50, 12 * IN, 13.1 * IN)  # 1.092
    rect(page, 150, 50, 12 * IN, 13.5 * IN)  # 1.125
    s = syms(page)
    assert at(s, 59, 59.8)[0] == "hss_square"
    assert at(s, 159, 60.1)[0] == "hss_rect"


def test_every_other_shape_is_unknown_and_solids_are_marked(page):
    cross_shape(page, 50, 50)  # cruciform
    bx, by = 150, 50  # welded box ring
    rect(page, bx, by, 14 * IN, 1 * IN)
    rect(page, bx, by + 13 * IN, 14 * IN, 1 * IN)
    rect(page, bx, by + 1 * IN, 1 * IN, 12 * IN)
    rect(page, bx + 13 * IN, by + 1 * IN, 1 * IN, 12 * IN)
    c_shape(page, 300, 50, opening="left")  # 2C back to back
    c_shape(page, 300 + 4 * IN, 50, opening="right")
    for k in range(3):  # built-up 3W
        i_shape(page, 400 + k * 8 * IN, 50, b=8 * IN, d=10 * IN)
    i_shape(page, 50, 250)  # plates beside the web, not beyond the flanges
    rect(page, 50 - 1 * IN, 250, 1 * IN, 14 * IN)
    rect(page, 50 + 14 * IN, 250, 1 * IN, 14 * IN)
    rect(page, 200, 250, 12 * IN, 12 * IN, fill=(0, 0, 0))  # solid square
    rect(page, 300, 250, 12 * IN, 8 * IN, fill=(0, 0, 0))  # solid rectangle
    circle(page, (409, 259), 6 * IN, fill=(0, 0, 0))  # solid round
    s = syms(page)
    for x, y in ((60.5, 60.5), (160.5, 60.5), (306, 59), (418, 57.5), (60.5, 260.5)):
        assert at(s, x, y) == ("unknown", None), (x, y)
    assert at(s, 209, 259) == ("unknown", "square")
    assert at(s, 309, 256) == ("unknown", "rect")
    assert at(s, 409, 259) == ("unknown", "round")


def dashed(page, a, b, dash=6.0, gap=0.8):
    """A grid line drawn as short pieces (as some drawings export dashes)."""
    (x0, y0), (x1, y1) = a, b
    n = np.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / n, (y1 - y0) / n
    t = 0.0
    while t < n:
        e = min(t + dash, n)
        seg(page, (x0 + ux * t, y0 + uy * t), (x0 + ux * e, y0 + uy * e))
        t = e + gap


def test_a_column_on_a_dashed_grid_crossing_is_kept_only_with_grid_strip(page):
    dashed(page, (100, 300), (700, 300))  # grid A
    dashed(page, (400, 60), (400, 560))  # grid 1
    bubbles = [Bubble(-1, (88, 300), 10, "A"), Bubble(-2, (400, 48), 10, "1")]
    rect(page, 391, 291, 12 * IN, 12 * IN)  # an HSS square centred on the crossing
    rect(page, 591, 291, 12 * IN, 12 * IN)  # and one on grid A only
    v3 = syms(page, V3_RULES, bubbles)
    assert [(round(s.centre[0]), round(s.centre[1]), s.family) for s in v3] == [
        (400, 300, "hss_square"),
        (600, 300, "hss_square"),
    ]
    off = syms(page, V3_RULES - {"grid_strip"}, bubbles)
    assert not any(abs(s.centre[0] - 400) < 3 and abs(s.centre[1] - 300) < 3 for s in off)
    # the closed outlines are never grid pieces
    ps = parse_page(page)
    gone = grid_pieces(ps, np.ones(len(ps), dtype=bool), bubbles)
    shapes = {sh.id: sh for sh in ps.shapes}
    assert gone and all(not shapes[int(ps.shape_id[i])].closed for i in gone)


def test_a_solid_shape_is_an_example_only_when_clicked(page):
    for x in (200, 400, 600):
        rect(page, x, 200, 12 * IN, 12 * IN, fill=(0, 0, 0))  # solid squares
    rect(page, 200, 400, 12 * IN, 12 * IN)  # a hollow square: another family
    rect(page, 400, 400, 8 * IN, 8 * IN, fill=(0, 0, 0))  # solid, another size
    circle(page, (609, 409), 6 * IN, fill=(0, 0, 0))  # solid round
    text = [TextLine("HSS12X12X3/8 (TYP.)", (300, 90, 400, 98))]
    seg(page, (300, 98), (209, 199))  # a label pointing at a solid square
    ps = parse_page(page)
    keep = np.ones(len(ps), dtype=bool)
    auto = label_columns(ps, keep, CROP, text, [], RATIO, FLAGS, rules=V3_RULES)
    assert auto.hits == [] and auto.callouts_with_leader == 1  # never a label example
    click = label_columns(ps, keep, CROP, [], [], RATIO, FLAGS, [(412, 206)], V3_RULES)
    assert sorted((round(h.symbol.centre[0]), h.source) for h in click.hits) == [
        (209, "similar"), (409, "click"), (609, "similar")
    ]  # fmt: skip
    assert all(h.symbol.solid == "square" and h.flag is None for h in click.hits)
    off = label_columns(
        ps, keep, CROP, [], [], RATIO, FLAGS, [(412, 206)], V3_RULES - {"click_solid"}
    )
    assert off.hits == [] and off.note == "click one column to find similar"


def test_profile_to_symbol_and_the_cross_check():
    cs = find_callouts(
        [
            TextLine("W14X90 W/ PL 3/4X16", (0, 0, 80, 8)),
            TextLine("W12X40", (200, 0, 240, 8)),
            TextLine("COVER PLATES", (200, 10, 260, 18)),
            TextLine("W10X33", (400, 0, 440, 8)),
        ],
        five=True,
    )
    assert [c.profile_family for c in cs] == ["W-cover", "W-cover", "W"]
    assert cross_check("W-cover", "w_shape", True) is None
    assert cross_check("W", "w_cover_plates", True) is None
    assert cross_check("HSS-square", "hss_rect", True) == "label HSS-square, drawn hss_rect"
    assert cross_check("PIPE", "hss_round", True) is None
    assert cross_check("HSS-round", "hss_square", True) == "label HSS-round, drawn hss_square"
    assert cross_check("2C", "w_shape", True) is None  # not one of the five: no flag
    assert cross_check("PL", "hss_square", True) is None


def test_the_engine_defaults_to_v3_and_v2_stays_reproducible(page):
    assert Setup(CROP, RATIO, None, None, "column_plan").col_rules == V3_RULES
    rect(page, 200, 200, 12 * IN, 12 * IN, fill=(0, 0, 0))
    assert [s.family for s in syms(page, V2_RULES)] == ["hss_filled"]
    assert [(s.family, s.solid) for s in syms(page)] == [("unknown", "square")]


def test_find_similar_shared_solid_click_cases():
    """The same solid-click cases the API's Find similar is tested with (fixtures/synthetic)."""
    import json
    from pathlib import Path

    from src.build.col_symbols import Symbol, same_kind

    path = Path(__file__).resolve().parents[2] / "fixtures/synthetic/find-similar-cases.json"

    def sym(d):
        a, b = d["real_in"]
        return Symbol(
            [], [], (0, 0, 1, 1), d["family"], ((4,), True), 0.0, a, b, True, False, d["solid"]
        )

    for c in json.loads(path.read_text())["solid_click_cases"]:
        assert same_kind(sym(c["symbol"]), sym(c["example"]), solid=True) == c["match"], c
