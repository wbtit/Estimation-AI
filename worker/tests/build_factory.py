"""SYNTHETIC framing and column plans for the line-first build tests (made-up geometry only).

Layout (displayed points, page 1000 x 800):
  grid letters A, B, C on vertical lines x = 200, 500, 800 (bubbles at the top, y = 80)
  grid numbers 1, 2, 3 on horizontal lines y = 200, 400, 600 (bubbles on the left, x = 80)
  grid lines: thin grey dash-dot drawn as pieces, from the bubble to the far side
  columns: filled 10 pt squares at the nine crossings
  girders (heavy black, 2 pt): along grids 1, 2 and 3 from A to C, each drawn as one line
  beams (heavy black): vertical at x = 350 and x = 650 from grid 1 to grid 2 (each with a size
    label to its right, read upwards), and at x = 350 from grid 2 to grid 3 drawn in two pieces
    with a 20 pt gap
  a dashed beam (hidden, 2 pt black in 6 pt dashes) at x = 650 from grid 2 to grid 3
  a cantilever (heavy black) from column C2 to the right, x = 800 to 900, y = 400
"""

from __future__ import annotations

import pymupdf

W, H = 1000, 800
XS = {"A": 200.0, "B": 500.0, "C": 800.0}
YS = {"1": 200.0, "2": 400.0, "3": 600.0}
GRID_COLOUR = (0.5, 0.5, 0.5)
HEAVY = 2.0


def line(page, a, b, width=HEAVY, color=(0, 0, 0), dashes=None):
    s = page.new_shape()
    s.draw_line(a, b)
    s.finish(width=width, color=color, dashes=dashes, closePath=False)
    s.commit()


def pieces(page, a, b, dash=24.0, gap=6.0, dot=2.0, width=0.3, color=GRID_COLOUR):
    """A dash-dot line drawn as separate segments (how CAD exports draw it)."""
    import math

    length = math.dist(a, b)
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    s = 0.0
    while s < length:
        e = min(s + dash, length)
        line(page, (a[0] + ux * s, a[1] + uy * s), (a[0] + ux * e, a[1] + uy * e), width, color)
        s = e + gap
        if s + dot < length:
            c, d = s + dot, s
            line(page, (a[0] + ux * d, a[1] + uy * d), (a[0] + ux * c, a[1] + uy * c), width, color)
        s += dot + gap


def bubble(page, c, label, r=12.0):
    s = page.new_shape()
    s.draw_circle(c, r)
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()
    page.insert_text((c[0] - 3.5, c[1] + 3.5), label, fontsize=10)


def column(page, c, size=10.0):
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(c[0] - size / 2, c[1] - size / 2, c[0] + size / 2, c[1] + size / 2))
    s.finish(fill=(0, 0, 0), color=None, width=0)
    s.commit()


def grids(page, with_bubbles=True):
    for lab, x in XS.items():
        if with_bubbles:
            bubble(page, (x, 80.0), lab)
        pieces(page, (x, 92.0), (x, 720.0))
    for lab, y in YS.items():
        if with_bubbles:
            bubble(page, (80.0, y), lab)
        pieces(page, (92.0, y), (920.0, y))


def columns(page):
    for x in XS.values():
        for y in YS.values():
            column(page, (x, y))


def framing_plan(doc, with_columns=True, with_grid=True, labels=True) -> pymupdf.Page:
    page = doc.new_page(width=W, height=H)
    if with_grid:
        grids(page)
    if with_columns:
        columns(page)
    for y in YS.values():  # girders A to C
        line(page, (XS["A"], y), (XS["C"], y))
    line(page, (350, 200), (350, 400))  # beams between girders 1 and 2
    line(page, (650, 200), (650, 400))
    line(page, (350, 400), (350, 490))  # beam 2-3 at x 350, two pieces, 20 pt gap
    line(page, (350, 510), (350, 600))
    line(page, (650, 400), (650, 600), dashes="[6 4] 0")  # PDF dash array (a hidden beam)
    for k in range(20):  # the same kind of hidden line drawn as separate short dashes
        y0 = 405 + k * 9.5
        if y0 + 6 <= 598:
            line(page, (680, y0), (680, y0 + 6))
    line(page, (800, 400), (900, 400))  # cantilever off column C2
    if labels:
        # text along the vertical beams (reads upwards)
        page.insert_text((362, 330), 'W16X26 <12> C=3/4"', fontsize=8, rotate=90)
        page.insert_text((662, 330), "W14X22", fontsize=8, rotate=90)
        page.insert_text((420, 192), "W24X55", fontsize=8)  # above girder 1, bay A-B
    return page
