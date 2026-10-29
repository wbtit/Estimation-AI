"""Phase 13c rules behind flags (F1 pen score, F2 wall, F3 crop, F4 columns) on SYNTHETIC
geometry only."""

from __future__ import annotations

import math

import numpy as np

from src.build.beam_lines import BeamLine
from src.build.clean import Cleaned
from src.build.columns import Glyph, off_grid_columns, stroke_glyphs
from src.build.grids import Bubble, GridLine
from src.build.not_beams import _Page, is_wall_face
from src.build.propose import (
    best_structural_pen,
    cuts_grid,
    grid_sets,
    main_grid_box,
    score_pens,
    union_box,
)
from src.build.segments import PageSegments, Shape
from src.review.line_roles import HATCH, HEAVY

# --- F1 -------------------------------------------------------------------------------------------


def test_structural_score_prefers_framing_over_dimension_and_grid_pens():
    grid = [(x, -20.0, x, 220.0) for x in (0.0, 100.0, 200.0)] + [
        (-20.0, y, 220.0, y) for y in (0.0, 200.0)
    ]
    beams = [(0.0, y, 200.0, y) for y in range(20, 190, 20)]  # 9 beams grid to grid
    dims = [(400.0 + 3 * k, 300.0 + 7 * k, 450.0 + 3 * k, 330.0 + 7 * k) for k in range(9)]
    lines = {"heavy": beams, "thin": dims, "grid": list(grid) * 2}
    scores = score_pens(lines, grid, [], [(395.0, 290.0, 480.0, 400.0)], dims)
    assert "grid" not in scores  # every line lies on a grid line
    assert scores["heavy"]["score"] == 1.0
    assert scores["thin"]["score"] < 0.5
    assert best_structural_pen(scores) == "heavy"
    assert best_structural_pen({}) is None
    tie = {
        "b": {"score": 0.5, "length": 10.0},
        "a": {"score": 0.5, "length": 10.0},
        "c": {"score": 0.5, "length": 12.0},
    }
    assert best_structural_pen(tie) == "c"


# --- F2 -------------------------------------------------------------------------------------------

RATIO = 48.0  # 1 real inch = 1.5 pt


def _wall(gap_pt: float, partner_width: float = 0.7, member: bool = False):
    segs = [(0.0, 0.0, 300.0, 0.0, 0.7), (0.0, gap_pt, 300.0, gap_pt, partner_width)]
    roles = [HEAVY, HEAVY]
    for x in range(10, 300, 15):  # hatch between the faces
        segs.append((float(x), 1.0, x + 8.0, gap_pt - 1.0, 0.2))
        roles.append(HATCH)
    if member:  # a member of another pen drawn inside the band
        segs.append((0.0, gap_pt / 2, 300.0, gap_pt / 2, 1.2))
        roles.append(HEAVY)
    ps = PageSegments(size=(400.0, 400.0))
    ps.seg = np.asarray([s[:4] for s in segs], dtype=float)
    ps.width = np.asarray([s[4] for s in segs], dtype=float)
    ps.colour = ["black"] * len(segs)
    ps.pdf_dashed = np.zeros(len(segs), dtype=bool)
    ps.shape_id = np.arange(len(segs))
    cl = Cleaned(np.ones(len(segs), dtype=bool), np.asarray(roles), {})
    ln = BeamLine(0, (0.0, 0.0), (300.0, 0.0), [0], [], False)
    return ln, ps, cl


def _is_wall(gap_pt, same_pen, **kw) -> bool:
    ln, ps, cl = _wall(gap_pt, **kw)
    return is_wall_face(ln, _Page.of(ps, cl, pens=same_pen), RATIO, same_pen)


def test_f2_needs_same_pen_faces_a_typical_spacing_and_no_member_inside():
    assert _is_wall(12.0, False) and _is_wall(12.0, True)  # 8 in, same pen: a wall in both
    # the partner is another pen: the old rule removes the line, F2 keeps it
    assert _is_wall(12.0, False, partner_width=1.2) and not _is_wall(12.0, True, partner_width=1.2)
    # 20 in apart: inside the old 4 to 24 in, outside F2's 5.5 to 16.5 in
    assert _is_wall(30.0, False) and not _is_wall(30.0, True)
    # a member of another pen inside the band keeps the line under F2
    assert not _is_wall(12.0, True, member=True)


# --- F3 -------------------------------------------------------------------------------------------


def _g(label, p0, p1, bubble=None):
    fam = "N" if label[0].isdigit() else "A"
    bs = [Bubble(0, bubble, 8.0, label)] if bubble else []
    return GridLine(label, fam, p0, p1, bs)


def _grid():
    main = [_g(n, (x, 50.0), (x, 400.0), (x, 40.0)) for n, x in (("1", 100.0), ("2", 200.0))]
    main += [_g(a, (50.0, y), (350.0, y), (40.0, y)) for a, y in (("A", 100.0), ("B", 300.0))]
    main += [_g("3", (300.0, 50.0), (300.0, 400.0), (300.0, 40.0))]
    detail = [
        _g("1", (1000.0, 50.0), (1000.0, 150.0), (1000.0, 40.0)),
        _g("A", (950.0, 100.0), (1100.0, 100.0), (940.0, 100.0)),
    ]
    return main + detail


def test_f3_main_grid_box_ignores_a_detail_grid_and_never_shrinks_the_crop():
    grid = _grid()
    sets = grid_sets(grid)
    assert [len(s) for s in sets] == [5, 2]
    box = main_grid_box(grid, (2000.0, 1000.0))
    # main grid: bubbles from 32, lines to x 350 / y 400, + 36 pt, clipped at 0; the detail grid
    # at x 940 to 1100 is not in it
    assert box == (0.0, 0.0, 386.0, 436.0)
    person = (90.0, 60.0, 500.0, 420.0)
    assert union_box(person, box) == (0.0, 0.0, 500.0, 436.0)
    assert union_box(person, None) == person
    assert cuts_grid(person, grid)  # the bubbles at y = 40 are outside the person's crop
    assert not cuts_grid((0.0, 0.0, 600.0, 600.0), grid)
    assert main_grid_box([], (10.0, 10.0)) is None


# --- F4 -------------------------------------------------------------------------------------------


def _strokes(polys: list[list[tuple[float, float]]]) -> PageSegments:
    """Every edge of every outline as its own open stroke."""
    ps = PageSegments(size=(500.0, 500.0))
    rows = []
    for poly in polys:
        for a, b in zip(poly, poly[1:] + poly[:1], strict=True):
            rows.append((*a, *b))
    ps.seg = np.asarray(rows, dtype=float)
    ps.width = np.full(len(rows), 0.5)
    ps.colour = ["black"] * len(rows)
    ps.pdf_dashed = np.zeros(len(rows), dtype=bool)
    ps.shape_id = np.arange(len(rows))
    ps.shapes = [
        Shape(i, [(r[0], r[1]), (r[2], r[3])], False, "s", False, (r[0], r[1], r[2], r[3]), 0.5)
        for i, r in enumerate(rows)
    ]
    return ps


def _glyphs(polys, gap=1.0):
    ps = _strokes(polys)
    return stroke_glyphs(
        ps, np.ones(len(ps), dtype=bool), (0.0, 0.0, 500.0, 500.0), [], [], [], [], gap
    )


SQUARE = [(10.0, 10.0), (20.0, 10.0), (20.0, 20.0), (10.0, 20.0)]
I_SHAPE = [
    (100, 0), (110, 0), (110, 2), (106, 2), (106, 10), (110, 10),
    (110, 12), (100, 12), (100, 10), (104, 10), (104, 2), (100, 2),
]  # fmt: skip
CIRCLE = [
    (206 + 6 * math.cos(k * math.pi / 8), 206 + 6 * math.sin(k * math.pi / 8)) for k in range(16)
]


def test_f4_open_strokes_close_into_square_i_and_circle():
    got = _glyphs([SQUARE, [(float(x), float(y)) for x, y in I_SHAPE], CIRCLE])
    assert sorted(g.outline for g in got) == ["I", "circle", "square"]
    assert all(g.shape_ids for g in got)  # never mistaken for a base-plate column
    # an open hook (3 sides) is not a glyph
    hook = _strokes([SQUARE])
    keep = np.ones(len(hook), dtype=bool)
    keep[3] = False
    assert stroke_glyphs(hook, keep, (0.0, 0.0, 500.0, 500.0), [], [], [], []) == []
    # corners 2 pt apart close only with a larger end gap
    gapped = [(10.0, 10.0), (20.0, 10.0)], [(22.0, 10.0), (22.0, 20.0)]
    ps = PageSegments(size=(50.0, 50.0))
    rows = [(*gapped[0][0], *gapped[0][1]), (*gapped[1][0], *gapped[1][1])]
    rows += [(22.0, 20.0, 10.0, 20.0), (10.0, 20.0, 10.0, 10.0)]
    ps.seg = np.asarray(rows)
    ps.width = np.full(4, 0.5)
    ps.colour = ["black"] * 4
    ps.pdf_dashed = np.zeros(4, dtype=bool)
    ps.shape_id = np.arange(4)
    ps.shapes = [Shape(i, [], False, "s", False, r, 0.5) for i, r in enumerate(rows)]
    keep = np.ones(4, dtype=bool)
    box = (0.0, 0.0, 50.0, 50.0)
    assert stroke_glyphs(ps, keep, box, [], [], [], [], 1.0) == []
    assert [g.outline for g in stroke_glyphs(ps, keep, box, [], [], [], [], 3.0)] == [
        "square"
    ]  # 12 x 10


def _sq(x, y, w, h, at):
    return Glyph([1], (x, y, x + w, y + h), "s", 4, at, None, False, "square")


def test_f4_off_grid_glyph_joins_when_it_matches_the_column_symbol():
    chosen = [_sq(100.0 * k, 0.0, 10.0, 10.0, True) for k in range(4)]
    near_size = _sq(500.0, 500.0, 10.6, 10.4, False)
    too_big = _sq(600.0, 500.0, 14.0, 14.0, False)
    rect = Glyph([2], (700.0, 500.0, 720.0, 510.0), "s", 4, False, None, False, "rect")
    out = off_grid_columns(chosen + [near_size, too_big, rect], chosen, {})
    assert out == [near_size]
    assert off_grid_columns([near_size], chosen[:3], {}) == []  # fewer than 4: no symbol
