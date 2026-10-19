"""Phase 12a build rules on SYNTHETIC pages only: dash_pattern, wall_band, base_plate, column_shape,
grid_marker. Each case has a real beam next to it that must still be found."""

from __future__ import annotations

import math

import pymupdf
from build_factory import line

from src.build.beam_lines import beam_lines, is_dash_pattern
from src.build.page import Setup, build_page

PEN = "1.5-2.5|black|solid"
BOX = (0.0, 0.0, 1000.0, 800.0)
RATIO = 96.0  # 1/8" = 1'-0": 1 ft = 9 pt
FT = 72.0 / RATIO * 12  # pt per real foot


def _page():
    doc = pymupdf.open()
    return doc, doc.new_page(width=1000, height=800)


def _build(page, role="framing", ratio=RATIO):
    return build_page(page, Setup(BOX, ratio, 3000.0, PEN if role == "framing" else None, role))


def _spans(pb):
    return sorted(
        tuple(sorted(((round(ln.p0[0]), round(ln.p0[1])), (round(ln.p1[0]), round(ln.p1[1])))))
        for ln in pb.lines
    )


def _dashes(page, a, b, pattern, gap, width=2.0):
    """A line drawn as separate strokes repeating `pattern` (piece lengths) with `gap` between."""
    length = math.dist(a, b)
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    s, k = 0.0, 0
    while True:
        e = s + pattern[k % len(pattern)]
        if e > length:
            break
        line(page, (a[0] + ux * s, a[1] + uy * s), (a[0] + ux * e, a[1] + uy * e), width)
        s, k = e + gap, k + 1


# ---- rule dash_pattern -------------------------------------------------------------------------
def test_a_long_short_short_dash_line_in_the_beam_pen_stays_out_and_the_beam_beside_it_is_found():
    doc, page = _page()
    _dashes(page, (100, 300), (900, 300), [27.0, 9.0, 9.0], 9.0)  # the job-018 page 5 pattern
    line(page, (100, 340), (900, 340))  # a real beam 40 pt below
    pb = _build(page)
    assert _spans(pb) == [((100, 340), (900, 340))]
    assert pb.counts()["removed_dash_pattern_runs"] == 1


def test_short_dashes_with_wide_gaps_stay_out():
    doc, page = _page()
    _dashes(page, (100, 300), (900, 300), [4.5], 18.0)  # the job-018 page 14 pattern
    line(page, (100, 200), (900, 200))
    lines = beam_lines(*_ps(page), PEN)
    assert [round(ln.p0[1]) for ln in lines] == [200]


def test_a_beam_broken_where_members_cross_it_is_still_one_beam():
    doc, page = _page()
    # pieces of 30 pt with 3 pt gaps (joists crossing): gaps far shorter than the pieces
    _dashes(page, (100, 300), (760, 300), [30.0], 3.0)
    lines = beam_lines(*_ps(page), PEN)
    assert len(lines) == 1 and lines[0].length > 600


def test_the_pattern_needs_regular_gaps_and_few_lengths():
    run = [(k * 20.0, k * 20.0 + 10.0, k) for k in range(6)]  # 10 on, 10 off
    assert is_dash_pattern(run)
    assert not is_dash_pattern(run[:4])  # too few pieces
    ragged = [(0, 10, 0), (12, 22, 1), (40, 50, 2), (52, 62, 3), (90, 100, 4), (101.5, 111.5, 5)]
    assert not is_dash_pattern(ragged)  # gaps 2, 18, 2, 28, 1.5: not regular
    lengths = [3.0, 7.0, 12.0, 17.0, 25.0, 33.0]
    mixed, s = [], 0.0
    for k, ln in enumerate(lengths):
        mixed.append((s, s + ln, k))
        s += ln + 8.0
    assert not is_dash_pattern(mixed)  # six different lengths


def _ps(page):
    from src.build.clean import clean
    from src.build.segments import crop, page_text_lines, parse_page

    ps = crop(parse_page(page), BOX)
    return ps, clean(ps, page_text_lines(page)).keep


# ---- rule wall_band ----------------------------------------------------------------------------
def _wall(page, y, thick_ft=1.0, x0=100.0, x1=900.0, fill="hatch"):
    """A concrete wall: two heavy faces `thick_ft` apart with a fill pattern between them."""
    t = thick_ft * FT
    line(page, (x0, y), (x1, y))
    line(page, (x0, y + t), (x1, y + t))
    if fill == "hatch":  # 45 degree hatch lines, face to face, every 6 pt (thin)
        x = x0
        while x + t <= x1:
            line(page, (x, y + t), (x + t, y), width=0.3)
            x += 6.0
    elif fill == "triangles":  # concrete stipple: small triangles every 12 pt
        x = x0 + 4
        while x + 4 <= x1:
            s = page.new_shape()
            cy = y + t / 2
            s.draw_polyline([(x, cy + 1.5), (x + 2, cy - 1.5), (x + 4, cy + 1.5)])
            s.finish(color=(0, 0, 0), width=0.3, closePath=True)
            s.commit()
            x += 12.0
    elif fill == "solid":  # a filled band, no faces drawn apart from it
        s = page.new_shape()
        s.draw_rect(pymupdf.Rect(x0, y, x1, y + t))
        s.finish(fill=(0.6, 0.6, 0.6), color=None, width=0)
        s.commit()


def test_a_wall_with_hatch_between_its_faces_stays_out_and_the_beam_beside_it_is_found():
    doc, page = _page()
    _wall(page, 300)
    line(page, (100, 290), (900, 290))  # a beam 10 pt from the wall face (no fill between)
    line(page, (100, 500), (900, 500))  # a beam on its own
    pb = _build(page)
    assert _spans(pb) == [((100, 290), (900, 290)), ((100, 500), (900, 500))]
    assert pb.counts()["removed_wall_lines"] == 2


def test_a_wall_with_a_concrete_triangle_pattern_stays_out():
    doc, page = _page()
    _wall(page, 300, thick_ft=1.5, fill="triangles")
    line(page, (100, 500), (900, 500))
    assert _spans(_build(page)) == [((100, 500), (900, 500))]


def test_a_beam_along_a_filled_band_of_wall_thickness_stays_out():
    doc, page = _page()
    _wall(page, 300, fill="solid")
    line(page, (100, 300), (900, 300))  # a face drawn on the band's edge
    line(page, (100, 500), (900, 500))
    assert _spans(_build(page)) == [((100, 500), (900, 500))]


def test_two_parallel_beams_with_nothing_between_are_both_beams():
    doc, page = _page()
    line(page, (100, 300), (900, 300))
    line(page, (100, 309), (900, 309))  # 1 ft apart, no fill: a double line, not a wall
    assert len(_build(page).lines) == 2


# ---- rules base_plate and column_shape (1/4" = 1'-0": 1 ft = 18 pt) ------------------------------
QUARTER = 48.0
QFT = 72.0 / QUARTER * 12


def _ring(page, c, d, n=16):
    """An anchor bolt drawn as CAD exports do: a closed loop of n short straight segments."""
    r = d / 2
    pts = [
        (c[0] + r * math.cos(2 * math.pi * k / n), c[1] + r * math.sin(2 * math.pi * k / n))
        for k in range(n)
    ]
    for k in range(n):
        line(page, pts[k], pts[(k + 1) % n], width=0.3)


def _base_plate(page, c, side_ft=20 / 12, bolt_ft=12 / 12, inner="HSS", pen=True):
    """A base plate (its edges in the beam pen) around a column, 4 bolts at a rectangle's corners
    and the column's outline inside: a small square (HSS) or an I (W)."""
    h = side_ft * QFT / 2
    x, y = c
    corners = [(x - h, y - h), (x + h, y - h), (x + h, y + h), (x - h, y + h)]
    for k in range(4):
        line(page, corners[k], corners[(k + 1) % 4], width=2.0 if pen else 0.3)
    b = bolt_ft * QFT / 2
    for dx in (-b, b):
        for dy in (-b, b):
            _ring(page, (x + dx, y + dy), 1.5)
    s = 0.25 * QFT  # a 6" column outline
    if inner == "HSS":
        sq = [(x - s, y - s), (x + s, y - s), (x + s, y + s), (x - s, y + s)]
        for k in range(4):
            line(page, sq[k], sq[(k + 1) % 4], width=0.5)
    elif inner == "W":
        line(page, (x - s, y - s), (x + s, y - s), width=0.5)
        line(page, (x - s, y + s), (x + s, y + s), width=0.5)
        line(page, (x, y - s), (x, y + s), width=0.5)


def _glyph(page, c, size=6.0):
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(c[0] - size / 2, c[1] - size / 2, c[0] + size / 2, c[1] + size / 2))
    s.finish(fill=(0, 0, 0), color=None, width=0)
    s.commit()


def test_a_base_plate_with_four_bolts_stays_out_of_the_beams_and_the_beam_is_found():
    doc, page = _page()
    for x in (300.0, 600.0):
        _base_plate(page, (x, 400))
    line(page, (300, 300), (600, 300))  # a beam framing nearby, 100 pt above the plates
    pb = _build(page, ratio=QUARTER)
    assert _spans(pb) == [((300, 300), (600, 300))]
    c = pb.counts()
    assert c["base_plates"] == 2 and c["removed_base_plate_lines"] == 8


def test_a_base_plate_is_one_column_at_its_centre_with_the_section_type_of_its_outline():
    doc, page = _page()
    _base_plate(page, (300, 400), inner="HSS")
    _base_plate(page, (600, 400), inner="W")
    _base_plate(page, (800, 600), inner=None)
    _glyph(page, (300, 400), size=4.0)  # a glyph inside the plate is the same column
    pb = _build(page, role="column_plan", ratio=QUARTER)
    cols = sorted((round(g.centre[0]), round(g.centre[1])) for g in pb.columns)
    assert cols == [(300, 400), (600, 400), (800, 600)]
    info = {
        (round(g.centre[0]), round(g.centre[1])): pb.column_info(k)
        for k, g in enumerate(pb.columns)
    }
    assert info[(300, 400)]["section_type"] == "HSS"
    assert info[(600, 400)]["section_type"] == "W"
    assert info[(800, 600)]["section_type"] is None
    assert all(i["rule"] == "base_plate" and i["off_grid"] for i in info.values())  # no grid here
    assert pb.counts()["base_plate_columns"] == 3 and pb.lines == []


def test_base_plate_columns_keep_their_rule_with_uneven_coordinates():
    doc, page = _page()
    x, y, b = 300.0, 400.0, 9.0
    # bolts as real exports draw them: loops of different counts, a little off the exact corners
    for (dx, dy), n, off in zip(
        ((-b, -b), (b, -b), (b, b), (-b, b)),
        (13, 16, 17, 19),
        (0.13, -0.07, 0.21, 0.0),
        strict=True,
    ):
        _ring(page, (x + dx + off, y + dy - off / 2), 1.5, n=n)
    for k, (a, c) in enumerate(((-15, -15), (15, -15), (15, 15), (-15, 15))):
        nxt = ((-15, -15), (15, -15), (15, 15), (-15, 15))[(k + 1) % 4]
        line(page, (x + a, y + c), (x + nxt[0], y + nxt[1]))
    pb = _build(page, role="column_plan", ratio=QUARTER)
    assert len(pb.columns) == 1
    info = pb.column_info(0)
    assert info["rule"] == "base_plate" and info["off_grid"]


def test_a_bolt_drawn_with_a_hole_round_it_is_still_one_plate_and_one_column():
    doc, page = _page()
    _base_plate(page, (300, 400))
    b = 12 / 12 * QFT / 2
    for dx in (-b, b):  # a 3 pt hole round each bolt: a second set of four rings, same centre
        for dy in (-b, b):
            _ring(page, (300 + dx, 400 + dy), 3.0)
    pb = _build(page, role="column_plan", ratio=QUARTER)
    assert pb.counts()["base_plates"] == 1 and len(pb.columns) == 1


def test_three_bolts_or_bolts_of_different_sizes_are_not_a_base_plate():
    doc, page = _page()
    b = 6.0
    for dx, dy in ((-b, -b), (b, -b), (b, b)):
        _ring(page, (300 + dx, 400 + dy), 1.5)
    for (dx, dy), d in zip(((-b, -b), (b, -b), (b, b), (-b, b)), (1.5, 1.5, 1.5, 4.5), strict=True):
        _ring(page, (600 + dx, 400 + dy), d)
    assert _build(page, role="column_plan", ratio=QUARTER).counts()["base_plates"] == 0


def test_an_i_shaped_column_drawn_with_beam_pen_strokes_stays_out():
    doc, page = _page()
    for x in (300.0, 600.0):  # a W14 column to scale: flanges 1'-4" long and 1'-4" apart, a web
        _glyph(page, (x, 400), size=4.0)
        h = 16 / 12 * QFT / 2
        line(page, (x - h, 400 - h), (x + h, 400 - h))
        line(page, (x - h, 400 + h), (x + h, 400 + h))
        line(page, (x, 400 - h), (x, 400 + h), width=0.5)
    line(page, (300, 600), (600, 600))
    pb = _build(page, ratio=QUARTER)
    assert _spans(pb) == [((300, 600), (600, 600))]
    assert pb.counts()["removed_column_shape_lines"] == 4


def test_a_short_beam_ending_at_a_column_is_kept():
    doc, page = _page()
    _glyph(page, (300, 400))
    _glyph(page, (336, 400))
    line(page, (300, 400), (336, 400))  # a 2 ft beam between two columns: they are on the line
    line(page, (100, 600), (900, 600))
    assert len(_build(page, ratio=QUARTER).lines) == 2


# ---- rule grid_marker ---------------------------------------------------------------------------
def _bow_tie(page, c, size=9.0, vertical=True):
    """A grid-line break marker: two filled triangles meeting at the line."""
    x, y = c
    w = size / 3
    for sgn in (-1, 1):
        s = page.new_shape()
        if vertical:
            s.draw_polyline([(x, y), (x + sgn * w, y - size / 2), (x + sgn * w, y + size / 2)])
        else:
            s.draw_polyline([(x, y), (x - size / 2, y + sgn * w), (x + size / 2, y + sgn * w)])
        s.finish(fill=(0, 0, 0), color=(0, 0, 0), width=0.1, closePath=True)
        s.commit()


def test_bow_tie_markers_near_the_bubble_are_not_columns_and_columns_at_crossings_are():
    from build_factory import XS, YS, columns, grids

    doc, page = _page()
    grids(page)
    columns(page)
    for x in XS.values():  # a break marker on each lettered grid line, 30 pt from its bubble
        _bow_tie(page, (x, 122.0))
    pb = _build(page, role="column_plan", ratio=96.0)
    assert len(pb.columns) == 9
    assert all(round(g.centre[1]) in {round(v) for v in YS.values()} for g in pb.columns)
    assert pb.counts()["removed_grid_markers"] >= 3


def test_every_column_of_a_column_plan_is_a_support_even_off_grid_with_no_lines():
    doc, page = _page()
    for c in ((300, 400), (600, 400), (800, 600)):
        _base_plate(page, c, pen=False)
    _glyph(page, (150, 150))
    _glyph(page, (150, 650))
    _glyph(page, (850, 150))
    _glyph(page, (850, 300))  # four equal glyphs, no grid: the repeated-glyph rule
    pb = _build(page, role="column_plan", ratio=QUARTER)
    assert len(pb.columns) == 7 and pb.lines == []
    nodes = [n for n in pb.supports.nodes if n.source == "glyph"]
    assert len(nodes) == 7 and {n.evidence["rule"] for n in nodes} == {"column_plan"}
