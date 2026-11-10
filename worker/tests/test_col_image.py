"""Phase 14d image-based Find similar (SYNTHETIC geometry only; scale 1/16" = 1'-0" as session 1
page 5: 1 real inch = 0.375 pt)."""

from __future__ import annotations

import numpy as np
import pymupdf
import pytest

from src.build.col_image import Settings, combine, find_similar
from src.build.col_symbols import V3_RULES, find_symbols, symbol_json
from src.build.segments import parse_page

RATIO = 192.0
IN = 72.0 / RATIO
CROP = (20.0, 20.0, 580.0, 380.0)


def seg(page, a, b, width=0.5):
    s = page.new_shape()
    s.draw_line(a, b)
    s.finish(color=(0, 0, 0), width=width)
    s.commit()


def rect(page, x, y, w, h):
    s = page.new_shape()
    s.draw_rect(pymupdf.Rect(x, y, x + w, y + h))
    s.finish(color=(0, 0, 0), width=0.5)
    s.commit()


def loose_square(page, cx, cy, side=12 * IN):
    """A square drawn as 4 loose corner strokes: each side is broken in the middle by a gap wider
    than the vector rules' 1 pt join, so no closed outline forms."""
    h = side / 2
    arm = 0.35 * side
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = cx + sx * h, cy + sy * h
        seg(page, (x, y), (x - sx * arm, y))
        seg(page, (x, y), (x, y - sy * arm))


def symbols(page):
    ps = parse_page(page)
    keep = np.ones(len(ps), dtype=bool)
    syms = find_symbols(ps, keep, CROP, [], [], RATIO, True, rules=V3_RULES)
    return [symbol_json(s) for s in syms]


@pytest.fixture
def page():
    doc = pymupdf.open()
    yield doc.new_page(width=600, height=400)
    doc.close()


def draw_scene(page):
    seg(page, (30, 200), (570, 200), width=0.8)  # a wall line the squares touch
    xs = (100, 180, 260, 340, 420)
    for x in xs:
        loose_square(page, x, 200 - 6 * IN)  # sitting on the wall line
    for k in range(0, 300, 8):  # a dashed grid line through the 3rd square
        seg(page, (260, 40 + k), (260, 40 + k + 5))
    for x in (120, 160, 200):  # tick marks along the wall: too small
        seg(page, (x, 200), (x, 204))
    loose_square(page, 500, 120, side=24 * IN)  # twice the size: not similar
    rect(page, 100, 300, 12 * IN, 6 * IN)  # a closed rectangle (another shape)
    return xs


def test_loose_corner_squares_are_found_by_image_and_not_by_vector(page):
    xs = draw_scene(page)
    syms = symbols(page)
    grid = [((260.0, 40.0), (260.0, 345.0))]
    res = find_similar(page, CROP, RATIO, (100, 200 - 6 * IN), syms, grid)
    assert res.example is not None and res.example["source"] == "ink"
    assert res.vector == []  # no vector symbol: the corners never close
    got = sorted(round(h.centre[0]) for h in res.image)
    assert got == list(xs), got  # the 24 in square, the ticks and the rectangle are rejected
    assert all(abs(h.centre[1] - (200 - 6 * IN)) < 1.5 for h in res.image)
    assert all(abs(h.real_in[1] - 12) <= 1.8 for h in res.image)
    assert [c["source"] for c in res.combined] == ["image"] * 5
    assert res.runtime_s < 2.0


def test_a_rotated_example_is_found_at_90_degrees(page):
    for x in (100, 200):
        rect(page, x, 100, 12 * IN, 6 * IN)  # horizontal 12 x 6
    rect(page, 300, 100, 6 * IN, 12 * IN)  # the same shape turned 90 degrees
    syms = symbols(page)
    res = find_similar(page, CROP, RATIO, (100 + 6 * IN, 100 + 3 * IN), syms, [])
    assert res.example["source"] == "vector" and res.example["family"] == "hss_rect"
    assert {h.rotation for h in res.image} == {0, 90}
    assert len(res.image) == 3
    # the vector rule (sorted sides) finds all three too: combined keeps one per position
    assert len(res.vector) == 3 and len(res.combined) == 3
    assert {c["source"] for c in res.combined} == {"vector"}


def test_the_search_is_deterministic_and_nothing_under_the_click_is_no_example(page):
    draw_scene(page)
    syms = symbols(page)
    a = find_similar(page, CROP, RATIO, (100, 200 - 6 * IN), syms, [])
    b = find_similar(page, CROP, RATIO, (100, 200 - 6 * IN), syms, [])
    assert [(h.centre, h.score) for h in a.image] == [(h.centre, h.score) for h in b.image]
    none = find_similar(page, CROP, RATIO, (550, 370), syms, [])
    # Phase 0-14g: nothing within the snap radius is a refusal that says where to click
    assert none.example is None and none.refused == "click_closer"
    assert none.note and none.note.startswith("click closer to the column symbol")


def test_thresholds_and_the_edge_variant_run(page):
    draw_scene(page)
    syms = symbols(page)
    click = (100, 200 - 6 * IN)
    n = [len(find_similar(page, CROP, RATIO, click, syms, [], Settings(threshold=t)).image)
         for t in (0.6, 0.7, 0.8)]  # fmt: skip
    assert n[0] >= n[1] >= n[2]
    edges = find_similar(page, CROP, RATIO, click, syms, [], Settings(edges=True))
    assert edges.example is not None


def test_combine_deduplicates_by_position():
    got = combine([(10.0, 10.0)], [((14.0, 10.0), 0.9, 0), ((40.0, 10.0), 0.7, 90)], 12.0)
    assert got == [
        {"centre": [10.0, 10.0], "source": "vector", "score": None, "rotation": 0},
        {"centre": [40.0, 10.0], "source": "image", "score": 0.7, "rotation": 90},
    ]


def test_the_fast_search_equals_the_14d_search_and_the_filter_equals_a_search(page):
    """Phase 14e: tiles + suppression give the 14d hits; strictness t over one search at 0.60 is
    the search at t (combined in score order)."""
    import math

    from src.build import col_image as ci

    draw_scene(page)
    syms = symbols(page)
    grid = [((260.0, 40.0), (260.0, 345.0))]
    r = ci.render(page, CROP, RATIO, grid, Settings())
    click = (100, 200 - 6 * IN)
    box = ci.ink_example(r, click, RATIO)
    for t in (0.6, 0.7, 0.8):
        new = ci.image_matches(r, box, RATIO, Settings(threshold=t))
        old = ci.image_matches_14d(r, box, RATIO, Settings(threshold=t))
        assert [(round(h.centre[0], 3), round(h.centre[1], 3), h.rotation) for h in new] == [
            (round(h.centre[0], 3), round(h.centre[1], 3), h.rotation) for h in old
        ]
        assert all(
            math.isclose(a.score, b.score, abs_tol=1e-4) for a, b in zip(new, old, strict=True)
        )
    low = ci.search(r, RATIO, click, syms, Settings(threshold=0.6))
    for t in (0.7, 0.8, 0.9):
        assert (
            ci.strict(low.combined, t)
            == ci.search(r, RATIO, click, syms, Settings(threshold=t)).combined
        )


def test_the_cache_round_trip(tmp_path, page):
    from src.build import col_image as ci

    draw_scene(page)
    r = ci.render(page, CROP, RATIO, [], Settings())
    path = ci.cache_path(tmp_path, "run-1")
    assert ci.load_raster(path) is None  # a miss
    ci.save_raster(path, r)
    got = ci.load_raster(path)
    assert got is not None and (got.clean == r.clean).all()
    assert (got.z, got.origin, got.crop) == (r.z, r.origin, r.crop)
