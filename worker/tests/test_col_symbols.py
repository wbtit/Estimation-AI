"""Phase 14b (v2 rules pinned; v3 in test_col_symbols_v3.py): columns from labels, find similar,
real-size filter, symbol families (SYNTHETIC geometry only; scale 1/4" = 1'-0", so 1 real inch =
1.5 pt)."""

from __future__ import annotations

import numpy as np
import pymupdf
import pytest

from src.build.col_symbols import (
    STUD_KIND,
    V2_RULES,
    cross_check,
    find_callouts,
    find_symbols,
    label_columns,
)
from src.build.page import Setup, build_page
from src.build.segments import TextLine, parse_page

RATIO = 48.0
IN = 72.0 / RATIO  # points per real inch
CROP = (0.0, 0.0, 1000.0, 800.0)


def poly(page, pts, fill=None, width=0.5):
    s = page.new_shape()
    s.draw_polyline([*pts, pts[0]])
    s.finish(color=(0, 0, 0), fill=fill, width=width, closePath=True)
    s.commit()


def seg(page, a, b, width=0.5):
    s = page.new_shape()
    s.draw_line(a, b)
    s.finish(color=(0, 0, 0), width=width, closePath=False)
    s.commit()


def rect(page, x, y, w, h, fill=None):
    poly(page, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], fill)


def i_shape(page, x, y, b=14 * IN, d=14 * IN, tf=1.5 * IN, tw=1.5 * IN):
    m = x + b / 2
    poly(page, [
        (x, y), (x + b, y), (x + b, y + tf), (m + tw / 2, y + tf), (m + tw / 2, y + d - tf),
        (x + b, y + d - tf), (x + b, y + d), (x, y + d), (x, y + d - tf), (m - tw / 2, y + d - tf),
        (m - tw / 2, y + tf), (x, y + tf),
    ])  # fmt: skip


def cross_shape(page, x, y, s=14 * IN, t=2 * IN):
    a, b = x + (s - t) / 2, x + (s + t) / 2
    c, d = y + (s - t) / 2, y + (s + t) / 2
    poly(page, [
        (a, y), (b, y), (b, c), (x + s, c), (x + s, d), (b, d), (b, y + s), (a, y + s), (a, d),
        (x, d), (x, c), (a, c),
    ])  # fmt: skip


def c_shape(page, x, y, w=4 * IN, h=12 * IN, t=1 * IN, opening="right"):
    if opening == "right":
        pts = [(x, y), (x + w, y), (x + w, y + t), (x + t, y + t), (x + t, y + h - t),
               (x + w, y + h - t), (x + w, y + h), (x, y + h)]  # fmt: skip
    else:
        pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y + h - t),
               (x + w - t, y + h - t), (x + w - t, y + t), (x, y + t)]  # fmt: skip
    poly(page, pts)


def symbols_of(page, text=(), real_size=True, rules=V2_RULES):
    ps = parse_page(page)
    return find_symbols(
        ps, np.ones(len(ps), dtype=bool), CROP, list(text), [], RATIO, real_size, rules=rules
    )


def family_at(page, x, y):
    syms = symbols_of(page)
    return min(syms, key=lambda s: abs(s.centre[0] - x) + abs(s.centre[1] - y)).family


@pytest.fixture
def page():
    doc = pymupdf.open()
    yield doc.new_page(width=1000, height=800)
    doc.close()


def test_each_symbol_family_is_recognised(page):
    rect(page, 50, 50, 12 * IN, 12 * IN)  # hss_square
    rect(page, 150, 50, 12 * IN, 6 * IN)  # hss_rect
    s = page.new_shape()
    s.draw_circle((270, 60), 6 * IN)  # hss_round
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    rect(page, 350, 50, 12 * IN, 12 * IN, fill=(0.6, 0.6, 0.6))  # hss_filled
    i_shape(page, 450, 50)  # w_shape
    cross_shape(page, 550, 50)  # cruciform
    # W with cover plates: an I and two plates on its flange faces
    i_shape(page, 650, 50 + 1 * IN)
    rect(page, 650, 50, 14 * IN, 1 * IN)
    rect(page, 650, 50 + 15 * IN, 14 * IN, 1 * IN)
    # built-up 3W: three I outlines side by side, touching
    for k in range(3):
        i_shape(page, 50 + k * 8 * IN, 250, b=8 * IN, d=10 * IN)
    # 3 plates: two flange plates and a web plate between them
    rect(page, 200, 250, 12 * IN, 1 * IN)
    rect(page, 200, 250 + 11 * IN, 12 * IN, 1 * IN)
    rect(page, 200 + 5.5 * IN, 250 + 1 * IN, 1 * IN, 10 * IN)
    # welded box: four plates in a ring
    bx, by = 350, 250
    rect(page, bx, by, 14 * IN, 1 * IN)
    rect(page, bx, by + 13 * IN, 14 * IN, 1 * IN)
    rect(page, bx, by + 1 * IN, 1 * IN, 12 * IN)
    rect(page, bx + 13 * IN, by + 1 * IN, 1 * IN, 12 * IN)
    # box with web: a ring with a plate across the middle
    bx = 500
    rect(page, bx, by, 14 * IN, 1 * IN)
    rect(page, bx, by + 13 * IN, 14 * IN, 1 * IN)
    rect(page, bx, by + 1 * IN, 1 * IN, 12 * IN)
    rect(page, bx + 13 * IN, by + 1 * IN, 1 * IN, 12 * IN)
    rect(page, bx + 1 * IN, by + 6.5 * IN, 12 * IN, 1 * IN)
    # 2C back to back: webs touching
    c_shape(page, 650, 250, opening="left")
    c_shape(page, 650 + 4 * IN, 250, opening="right")
    # 2C toe to toe with lacing
    c_shape(page, 50, 450, opening="right")
    c_shape(page, 50 + 10 * IN, 450, opening="left")
    seg(page, (50 + 4 * IN, 450 + 1 * IN), (50 + 10 * IN, 450 + 6 * IN))
    seg(page, (50 + 4 * IN, 450 + 11 * IN), (50 + 10 * IN, 450 + 6 * IN))
    # double laced: two channels back outward, lacing between
    c_shape(page, 250, 450, opening="left")
    c_shape(page, 250 + 10 * IN, 450, opening="right")
    seg(page, (250 + 4 * IN, 450 + 1 * IN), (250 + 10 * IN, 450 + 6 * IN))
    seg(page, (250 + 4 * IN, 450 + 11 * IN), (250 + 10 * IN, 450 + 6 * IN))
    # open-stroke W: two flanges and a web
    seg(page, (450, 450), (450 + 12 * IN, 450))
    seg(page, (450, 450 + 12 * IN), (450 + 12 * IN, 450 + 12 * IN))
    seg(page, (450 + 6 * IN, 450), (450 + 6 * IN, 450 + 12 * IN))
    want = {
        (59, 59): "hss_square",
        (159, 54.5): "hss_rect",
        (270, 60): "hss_round",
        (359, 59): "hss_filled",
        (460.5, 60.5): "w_shape",
        (560.5, 60.5): "cruciform",
        (660.5, 62): "w_cover_plates",
        (68, 257.5): "built_up_3w",
        (209, 259): "built_up_3plates",
        (360.5, 260.5): "welded_box",
        (510.5, 260.5): "box_with_web",
        (656, 259): "2c_back_to_back",
        (60.5, 459): "2c_toe_laced",
        (260.5, 459): "double_laced",
        (459, 459): "w_shape",
    }
    got = {k: family_at(page, *k) for k in want}
    assert got == want


def test_the_real_size_filter_drops_ticks_tiny_and_huge_marks(page):
    rect(page, 100, 100, 12 * IN, 12 * IN)  # a 12 in column: kept
    rect(page, 200, 100, 2 * IN, 2 * IN)  # 2 in: too small
    rect(page, 300, 100, 40 * IN, 40 * IN)  # 40 in: too large
    for k in range(6):  # ticks along a wall line: no short side
        seg(page, (100 + 20 * k, 400), (100 + 20 * k, 400 + 8 * IN))
    syms = symbols_of(page)
    assert [(round(s.real_sides[0]), round(s.real_sides[1])) for s in syms] == [(12, 12)]
    # without the flag the point window applies (the 40 in square is 60 pt: out; 2 in = 3 pt: in)
    assert len(symbols_of(page, real_size=False)) == 2


def test_follow_the_label_find_similar_and_typ(page):
    text = [
        TextLine("HSS12X12X3/8 VERTICAL STUDS", (300, 90, 420, 98)),
        TextLine("TO SUPPORT PANELS (TYP.)", (300, 100, 410, 108)),
    ]
    rect(page, 200, 200, 12 * IN, 12 * IN)  # the example the arrow points to
    seg(page, (300, 104), (250, 150))  # leader: two segments
    seg(page, (250, 150), (209, 199))
    tri = page.new_shape()  # an arrowhead at the symbol
    tri.draw_polyline([(209, 199), (206, 194), (212, 194), (209, 199)])
    tri.finish(color=(0, 0, 0), fill=(0, 0, 0), width=0.3, closePath=True)
    tri.commit()
    for x in (400, 600, 800):  # similar squares along the wall
        rect(page, x, 200, 12 * IN, 12 * IN)
    rect(page, 400, 400, 12.5 * IN, 12.5 * IN)  # within 1 in: similar
    rect(page, 600, 400, 8 * IN, 8 * IN)  # another size: not similar
    rect(page, 800, 400, 12 * IN, 6 * IN)  # another family: not similar
    for k in range(5):  # wall ticks
        seg(page, (100 + 30 * k, 600), (100 + 30 * k, 606))
    ps = parse_page(page)
    flags = frozenset({"col_labels", "col_similar", "col_real_size"})
    res = label_columns(ps, np.ones(len(ps), dtype=bool), CROP, text, [], RATIO, flags)
    assert res.callouts == 1 and res.callouts_with_leader == 1
    assert len(res.examples) == 1 and res.examples[0].kind == STUD_KIND
    assert res.examples[0].symbol.family == "hss_square"
    got = sorted((round(h.symbol.centre[0]), round(h.symbol.centre[1]), h.source) for h in res.hits)
    assert got == [(209, 209, "label"), (409, 209, "similar"), (409, 409, "similar"),
                   (609, 209, "similar"), (809, 209, "similar")]  # fmt: skip
    assert {h.profile for h in res.hits} == {"HSS12X12X3/8"}
    assert all(h.kind == STUD_KIND and h.flag is None for h in res.hits)
    # sensitivity: TYP on the example's row only (the 409, 409 match is off the row)
    assert sorted(h.profile_on_row for h in res.hits) == [False, True, True, True, True]


def test_no_example_proposes_nothing_and_a_click_is_an_example(page):
    for x in (200, 400, 600):
        rect(page, x, 200, 12 * IN, 12 * IN)
    ps = parse_page(page)
    flags = frozenset({"col_labels", "col_similar", "col_real_size"})
    keep = np.ones(len(ps), dtype=bool)
    res = label_columns(ps, keep, CROP, [], [], RATIO, flags)
    assert res.hits == [] and res.note == "click one column to find similar"
    res = label_columns(ps, keep, CROP, [], [], RATIO, flags, clicks=[(412, 206)])
    assert [h.source for h in res.hits] == ["similar", "click", "similar"]
    assert all(h.profile is None for h in res.hits)


def test_without_typ_a_match_gets_no_profile(page):
    text = [TextLine("W14X90", (300, 90, 340, 98))]
    i_shape(page, 200, 200)
    seg(page, (300, 98), (215, 199))
    i_shape(page, 400, 200)
    ps = parse_page(page)
    flags = frozenset({"col_labels", "col_similar", "col_real_size"})
    res = label_columns(ps, np.ones(len(ps), dtype=bool), CROP, text, [], RATIO, flags)
    assert [(h.source, h.profile, h.kind) for h in res.hits] == [
        ("label", "W14X90", "Column"),
        ("similar", None, "Column"),
    ]


def test_cross_check_flags_a_label_that_disagrees_with_the_drawing():
    assert cross_check("HSS-square", "w_shape") == "label HSS-square, drawn w_shape"
    assert cross_check("W", "w_cover_plates") is None
    assert cross_check("PIPE", "hss_filled") is None
    assert cross_check("HSS-round", "unknown") is None
    assert cross_check(None, "hss_rect") is None


def test_callout_blocks_kinds_and_typ():
    cs = find_callouts(
        [
            TextLine("W12X40", (0, 0, 40, 8)),
            TextLine("COL. TYP", (0, 10, 40, 18)),
            TextLine("HSS6X6X1/4 POST", (200, 0, 280, 8)),
            TextLine("2C10X15.3", (400, 0, 450, 8)),
            TextLine("PL 3/4 BOX", (600, 0, 650, 8)),
            TextLine("L4X4X1/4", (800, 0, 840, 8)),
        ]
    )
    assert [(c.profile_family, c.kind, c.typical) for c in cs] == [
        ("W", "Column", True),
        ("HSS-square", STUD_KIND, False),
        ("2C", "Column", False),
        ("PL", "Column", False),
    ]


def test_build_page_uses_examples_only_under_the_flags(page):
    text = [TextLine("HSS12X12X3/8 (TYP.)", (300, 90, 400, 98))]
    rect(page, 200, 200, 12 * IN, 12 * IN)
    seg(page, (300, 98), (209, 199))
    rect(page, 400, 200, 12 * IN, 12 * IN)
    setup = Setup(CROP, RATIO, None, None, "column_plan")
    off = build_page(page, setup, text)
    assert off.col_result is None
    on = build_page(
        page,
        Setup(CROP, RATIO, None, None, "column_plan",
              flags=frozenset({"col_labels", "col_similar", "col_real_size"})),
        text,
    )  # fmt: skip
    assert len(on.columns) == 2 and on.column_rule == "col_examples"
    assert on.column_info(0)["family"] == "hss_square"
    assert on.column_info(1)["profile"] == "HSS12X12X3/8"


def test_v2_arrowheads_by_paper_size_and_unknown_symbols_never_match(page):
    # at 1/16" = 1'-0" an 8 pt arrowhead is 21 real inches: only the paper-size rule removes it
    ratio = 192.0
    inch = 72.0 / ratio
    text = [TextLine("HSS12X12X3/8 STUDS (TYP.)", (300, 90, 420, 98))]
    rect(page, 200, 200, 12 * inch, 12 * inch)
    seg(page, (300, 98), (202, 196))
    tri = page.new_shape()
    tri.draw_polyline([(202, 196), (196, 188), (204, 188), (202, 196)])
    tri.finish(color=(0, 0, 0), fill=(0, 0, 0), width=0.3, closePath=True)
    tri.commit()
    rect(page, 400, 200, 12 * inch, 12 * inch)
    for x in (600, 650):  # two open-stroke groups of the same signature ("unknown")
        seg(page, (x, 400), (x + 8, 400))
        seg(page, (x + 8, 400), (x + 8, 410))
    ps = parse_page(page)
    keep = np.ones(len(ps), dtype=bool)
    flags = frozenset({"col_labels", "col_similar", "col_real_size"})
    v1 = label_columns(ps, keep, CROP, text, [], ratio, flags, rules=frozenset())
    assert v1.examples and v1.examples[0].symbol.family == "unknown"  # the arrowhead
    v2 = label_columns(ps, keep, CROP, text, [], ratio, flags, rules=V2_RULES)
    assert [h.symbol.family for h in v2.hits] == ["hss_square", "hss_square"]
    clicked = label_columns(
        ps, keep, CROP, [], [], ratio, flags, clicks=[(604, 403)], rules=V2_RULES
    )
    assert clicked.hits == []  # a click on an unknown symbol is no example under v2


def test_find_similar_shared_cases():
    """The same cases the API's Find similar is tested with (fixtures/synthetic)."""
    import json
    from pathlib import Path

    from src.build.col_symbols import Symbol, same_kind

    path = Path(__file__).resolve().parents[2] / "fixtures/synthetic/find-similar-cases.json"

    def sym(d):
        a, b = d["real_in"]
        return Symbol([], [], (0, 0, 1, 1), d["family"], ((4,), False), 0.0, a, b, False, False)

    for c in json.loads(path.read_text())["cases"]:
        assert same_kind(sym(c["symbol"]), sym(c["example"])) == c["match"], c
