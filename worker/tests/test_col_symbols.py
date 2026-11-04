"""Phase 14b (v2 rules pinned; v3 in test_col_symbols_v3.py): columns from labels, find similar,
real-size filter, symbol families (SYNTHETIC geometry only; scale 1/4" = 1'-0", so 1 real inch =
1.5 pt)."""

from __future__ import annotations

import numpy as np
import pymupdf
import pytest

from src.build.col_symbols import (
    V2_RULES,
    find_symbols,
)
from src.build.segments import parse_page

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
