"""Phase 0-14g: the example lookup lands on the symbol (SYNTHETIC geometry only; scale
1/16" = 1'-0", 1 real inch = 0.375 pt)."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import pymupdf
import pytest

from src.build import col_image as ci
from src.build.col_image import Blob, Settings, render, search, search_angles, vector_example

RATIO = 192.0
IN = 72.0 / RATIO
CROP = (20.0, 20.0, 580.0, 380.0)
ROOT = Path(__file__).resolve().parents[2]


def seg(page, a, b, width=0.5):
    s = page.new_shape()
    s.draw_line(a, b)
    s.finish(color=(0, 0, 0), width=width)
    s.commit()


def square(page, cx, cy, side, turn=0.0):
    """A closed square outline of four strokes, turned `turn` degrees about its centre."""
    h = side / 2
    t = math.radians(turn)
    pts = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = sx * h, sy * h
        pts.append((cx + x * math.cos(t) - y * math.sin(t), cy + x * math.sin(t) + y * math.cos(t)))
    for k in range(4):
        seg(page, pts[k], pts[(k + 1) % 4])


@pytest.fixture
def page():
    doc = pymupdf.open()
    yield doc.new_page(width=600, height=400)
    doc.close()


def raster(page):
    return render(page, CROP, RATIO, [], Settings())


def test_one_snap_radius_for_every_part():
    shared = json.loads((ROOT / "schema" / "column-snap.json").read_text())["snap_radius_pt"]
    assert shared == 14
    assert ci.SNAP_RADIUS_PT == ci.CLICK_PT == float(shared)
    # the API and the web keep no copy of the number
    api = (ROOT / "api/src/review/find-similar.ts").read_text()
    assert "CLICK_PT = SNAP_RADIUS_PT" in api and "CLICK_PT = 12" not in api
    web = (ROOT / "web/src/lib/column-snap.ts").read_text()
    assert "snap_radius_pt" in web and not re.search(r"\b14\b", web.replace("0-14g", ""))


def test_a_stored_symbol_within_the_radius_is_the_example_and_beyond_it_is_not():
    sym = {"family": "hss_square", "box": [100.0, 100.0, 106.0, 106.0], "centre": [103.0, 103.0],
           "real_in": [16.0, 16.0], "rotation_deg": 0.0, "solid": None}  # fmt: skip
    assert vector_example((103.0 + 13.9, 103.0), [sym]) is sym
    assert vector_example((103.0 + 14.5, 103.0), [sym]) is None
    near, far = dict(sym, centre=[110.0, 103.0]), dict(sym, centre=[103.0, 90.0])
    assert vector_example((103.0, 103.0), [far, near]) is near  # two inside: the nearest


def test_an_off_centre_click_on_ink_snaps_to_the_squares_centre(page):
    cx, cy = 200.0, 200.0
    square(page, cx, cy, 20 * IN)
    r = raster(page)
    res = search(r, RATIO, (cx + 3.0, cy - 2.5), [], Settings())
    assert res.example is not None and res.example["source"] == "ink"
    assert res.snap["source"] == "ink"
    assert math.dist(res.snap["centre"], (cx, cy)) < 0.6
    assert res.snap["distance"] == pytest.approx(math.hypot(3.0, 2.5), abs=0.7)
    assert res.example["angle"] == 0.0 and len(res.example["rect"]) == 4


def test_ink_that_is_not_a_column_symbol_is_refused_with_the_message(page):
    square(page, 300.0, 200.0, 60 * IN)  # 60 in: beyond the largest column symbol
    r = raster(page)
    res = search(r, RATIO, (300.0 - 30 * IN, 200.0), [], Settings())  # on its left side
    assert res.example is None and res.refused == "click_closer"
    assert "click closer to the column symbol" in (res.note or "")
    empty = search(r, RATIO, (50.0, 50.0), [], Settings())
    assert empty.example is None and empty.refused == "click_closer"


def test_blob_refusal_rules():
    def blob(sides, fill=0.9, edge=False):
        return Blob((0.0, 0.0), 0.0, sides, (0, 0, 1, 1), (0, 0, 1, 1), [], [], sides, fill, edge)

    assert ci.blob_refusal(blob((12.0, 12.0))) is None
    assert ci.blob_refusal(blob((2.0, 40.0))) == "size"  # longer than the largest symbol
    assert ci.blob_refusal(blob((1.0, 6.0))) == "size"  # thinner than the smallest
    assert ci.blob_refusal(blob((4.0, 30.0))) == "aspect"  # a bar, not a column
    assert ci.blob_refusal(blob((12.0, 12.0), fill=ci.BLOB_FILL_MIN - 0.01)) == "fill"
    assert ci.blob_refusal(blob((12.0, 12.0), edge=True)) == "touches_edge"


def test_a_diagonal_stored_symbol_is_found_with_its_angle_and_the_markers_are_turned(page):
    side = 20 * IN
    for x in (100.0, 200.0, 300.0, 400.0):
        square(page, x, 120.0, side, turn=40.0)  # four columns turned 40 degrees
    square(page, 250.0, 280.0, side, turn=0.0)  # one upright square of the same size
    r = raster(page)
    half = side * math.cos(math.radians(5.0)) * 0.78  # the stored symbol's axis-aligned box
    box = [100 - half, 120 - half, 100 + half, 120 + half]
    sym = {"family": "hss_square", "solid": None, "box": box, "centre": [100.0, 120.0],
           "real_in": [20.0, 20.0], "rotation_deg": 40.0}  # fmt: skip
    # a click 3 pt off the stored symbol's centre: the stored symbol is the example (its own turn)
    res = search(r, RATIO, (103.0, 122.0), [sym], Settings(threshold=0.6), grid=None)
    assert res.example is not None and res.example["source"] == "vector"
    assert res.example["angle"] == pytest.approx(40.0, abs=2.0)
    assert res.snap["source"] == "symbol" and math.dist(res.snap["centre"], (100.0, 120.0)) < 1.0
    assert 40.0 in [round(a) for a in res.angles] and 130.0 in [round(a) for a in res.angles]
    found = {(round(h.centre[0] / 10) * 10, round(h.centre[1] / 10) * 10): h for h in res.image}
    for x in (200, 300, 400):  # the other turned columns: the same turn as the example
        assert (x, 120) in found, sorted(found)
        assert found[(x, 120)].rotation == 0
    # the upright square is a column of the same size, turned 40 degrees less than the example
    up = found[(250, 280)]
    assert up.rotation == pytest.approx(140.0, abs=2.5)


def test_an_ink_example_is_always_mains_read_and_the_blob_only_supplies_the_snap_centre(page):
    """By construction: the example, the template and the matches are main's (ink_example, angles
    0 and 90 on an orthogonal page); a checked blob only adds the point the column moves to."""
    for x in (100.0, 200.0, 300.0):
        square(page, x, 150.0, 20 * IN)
    fused_diamond(page, 450.0, 150.0)
    r = raster(page)
    s = Settings(threshold=0.6)
    for click in ((103.0, 152.0), (456.0, 150.0)):  # a clean column, then one fused to linework
        res = search(r, RATIO, click, [], s)
        ib = ci.ink_example(r, click, RATIO)  # main's example logic
        assert ib is not None and res.example is not None and res.example["source"] == "ink"
        b0, b1 = r.pt(ib[0], ib[1]), r.pt(ib[2], ib[3])
        assert res.example["box"] == pytest.approx([b0[0], b0[1], b1[0], b1[1]])
        assert res.example["angle"] == 0.0 and res.angles == [0.0, 90.0]
        main_hits = ci.image_matches(r, ib, RATIO, s)  # main's search: angles 0 and 90
        assert [(h.centre, h.score, h.rotation) for h in res.image] == [
            (h.centre, h.score, h.rotation) for h in main_hits
        ]
    clean = search(r, RATIO, (103.0, 152.0), [], s)
    assert clean.warning is None and clean.snap["source"] == "ink"  # checked: may move the column
    assert math.dist(clean.snap["centre"], (100.0, 150.0)) < 0.6
    fused = search(r, RATIO, (456.0, 150.0), [], s)
    assert fused.warning == "unchecked_ink" and fused.snap is None  # not checked: stays put


def test_the_search_angles():
    ortho = [((0.0, 0.0), (500.0, 0.0)), ((0.0, 50.0), (500.0, 50.0)), ((0.0, 0.0), (0.0, 300.0)),
             ((90.0, 0.0), (90.0, 300.0))]  # fmt: skip
    assert search_angles(ortho) == [0.0, 90.0]
    assert search_angles(None) == [0.0, 90.0]
    skew = [((0.0, 0.0), (300.0, 300.0)), ((0.0, 40.0), (300.0, 340.0)),  # 45 degrees
            ((300.0, 0.0), (0.0, 300.0)), ((300.0, 40.0), (0.0, 340.0))]  # fmt: skip
    assert search_angles(skew) == [0.0, 90.0, 45.0, 135.0]
    near_axis = [((0.0, 0.0), (500.0, 6.0)), ((0.0, 50.0), (500.0, 56.0))]  # 0.7 degrees
    assert search_angles(near_axis) == [0.0, 90.0]  # within 2 degrees of 0: one angle
    assert search_angles(None, 40.0) == [0.0, 90.0, 40.0, 130.0]  # the example's own angle
    assert search_angles(None, 1.0) == [0.0, 90.0]  # upright: no extra
    # no grid: the page's long-line directions stand in
    assert search_angles([], 0.0, lambda: [30.0]) == [0.0, 90.0, 30.0, 120.0]
    assert search_angles(ortho, 0.0, lambda: [30.0]) == [0.0, 90.0]  # a grid wins over the fallback


def test_long_line_directions_of_a_page(page):
    for k in range(3):  # three long 45 degree lines (100 pt = 267 in real: long)
        seg(page, (50.0 + k * 40, 50.0), (250.0 + k * 40, 250.0))
    seg(page, (30.0, 300.0), (200.0, 300.0))  # one long horizontal line (shorter in total length)
    got = ci.long_line_angles(page, CROP, RATIO)
    assert any(abs(a - 45.0) < 1.0 for a in got)


# ---- never worse than main (owner decision 2026-11-10: refuse only where main refused) ----------


def fused_diamond(page, cx, cy):
    """A 30 in square turned 45 degrees (a diamond) with a long diagonal line through it: the ink
    of the column and the line are one blob much larger than a column symbol."""
    square(page, cx, cy, 30 * IN, turn=45.0)
    seg(page, (cx - 90.0, cy - 90.0), (cx + 90.0, cy + 90.0))  # along one diagonal of the diamond
    seg(page, (cx - 90.0, cy + 90.0), (cx + 90.0, cy - 90.0))  # and along the other


def test_a_column_fused_to_long_linework_still_gets_main_s_example_with_a_warning(page):
    cx, cy = 200.0, 200.0
    fused_diamond(page, cx, cy)
    r = raster(page)
    blob = ci.ink_blob(r, (cx + 3.0, cy), RATIO)
    assert blob is not None and ci.blob_refusal(blob) is not None  # the checked read refuses it
    res = search(r, RATIO, (cx + 3.0, cy), [], Settings())
    assert res.refused is None and res.example is not None  # main found one: so does the branch
    assert res.warning == "unchecked_ink"
    assert res.snap is None  # an unchecked read never moves the column
    assert res.example["source"] == "ink" and res.example["angle"] == 0.0


def test_refusal_only_where_main_refused(page, monkeypatch):
    """Over many clicks on mixed scenes: an example on main (radius 12 pt, the ink read of main)
    is an example on the branch; a refusal on the branch is a refusal on main."""
    fused_diamond(page, 120.0, 120.0)
    square(page, 300.0, 120.0, 20 * IN)  # a clean column
    square(page, 450.0, 120.0, 60 * IN)  # far too large
    seg(page, (30.0, 300.0), (570.0, 300.0))  # a long horizontal line, nothing else near
    r = raster(page)
    spots = [
        (120.0, 120.0),
        (300.0, 120.0),
        (450.0 - 30 * IN, 120.0),
        (200.0, 300.0),
        (500.0, 60.0),
    ]
    dirs = [(math.cos(math.radians(a)), math.sin(math.radians(a))) for a in range(0, 360, 45)]
    clicks = [(x + d * ux, y + d * uy) for x, y in spots for d in (0.0, 3.0, 6.0, 10.0, 13.0)
              for ux, uy in dirs]  # fmt: skip
    checked = 0
    for click in clicks:
        monkeypatch.setattr(ci, "CLICK_PT", 12.0)  # main's radius
        main_found = (
            vector_example(click, []) is not None or ci.ink_example(r, click, RATIO) is not None
        )
        monkeypatch.setattr(ci, "CLICK_PT", ci.SNAP_RADIUS_PT)
        res = search(r, RATIO, click, [], Settings())
        if main_found:
            assert res.example is not None, click
            checked += 1
        if res.example is None:
            assert not main_found, click
    assert checked > 20  # the scene really exercises the rule
