"""Phase 13b census rules on SYNTHETIC facts, segments and shapes only."""

from __future__ import annotations

import random

import numpy as np

from tools.p13b_miss import (
    classify_beam,
    collinear_span,
    first_lost,
    on_line,
    parallel_partner,
    pen_diff,
    pens_needed,
    shape_type,
    stratified,
)

BASE = {
    "matched": False,
    "c_raw_near": False,
    "ours_near": False,
    "other_raw_near": False,
    "any_raw_near": False,
    "step": None,
    "other_pen_diff": None,
    "geometry": None,
    "merged": False,
    "joist_near": False,
    "strokes_near": False,
}


def f(**kw):
    return {**BASE, **kw}


def test_categories_come_in_the_preregistered_order():
    assert classify_beam(f(matched=True, c_raw_near=True)) == ("matched", None)
    removed = f(c_raw_near=True, any_raw_near=True, other_raw_near=True, step="hatch")
    assert classify_beam(removed) == ("removed_by_cleaning", "hatch")
    other = f(any_raw_near=True, other_raw_near=True, other_pen_diff="width")
    assert classify_beam(other) == ("other_pen", "width")
    # our line near beats an other-pen raw line (the accepted decision)
    assert classify_beam(f(ours_near=True, other_raw_near=True, any_raw_near=True))[0] == (
        "split_or_merged"
    )
    assert classify_beam(f(geometry="broken", strokes_near=True)) == ("not_single_line", "broken")
    assert classify_beam(f(ours_near=True, merged=True, joist_near=True))[1] == "merged"
    assert classify_beam(f(ours_near=True, joist_near=True))[1] == "joist_label"
    assert classify_beam(f(ours_near=True))[1] == "no_piece"
    assert classify_beam(f(strokes_near=True)) == ("no_line_near", "strokes_near")
    assert classify_beam(f()) == ("no_line_near", "nothing_near")


def test_the_step_is_the_first_one_that_loses_everything_near():
    assert first_lost([("crop", False, {}), ("clean", False, {"hatch": 9})]) == "crop"
    stages = [("crop", True, {}), ("clean", False, {"hatch": 5.0, "dimension": 7.0})]
    assert first_lost(stages) == "dimension"
    tie = [("clean", False, {"hatch": 5.0, "text_strokes": 5.0})]
    assert first_lost(tie) == "hatch"
    assert first_lost([("crop", True, {}), ("dashed", False, {})]) == "dashed"
    assert first_lost([("crop", True, {})]) == "other"


def test_pens_needed_is_the_exact_smallest_cover_of_80_percent():
    cover = {"a": {0, 1, 2, 3, 4, 5}, "b": {6, 7}, "c": {8, 9}}
    assert pens_needed(cover, 10) == 2  # a + b = 8 of 10
    assert pens_needed({"a": set(range(8))}, 10) == 1
    assert pens_needed({"a": {0}, "b": {1}}, 10) == "not reachable"
    many = {str(k): {k} for k in range(10)}
    assert pens_needed(many, 10) == "more than 5"
    assert pens_needed({}, 0) == "no marks"
    assert pen_diff("0.5-1|black|solid", "0.5-1|red|dash") == "colour+style"


def test_shape_types():
    sq = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
    assert shape_type(sq, False) == "square"
    assert shape_type([(0, 0), (20, 0), (20, 10), (0, 10)], False) == "rect"
    i12 = [(0, 0), (9, 0), (9, 1), (5, 1), (5, 9), (9, 9), (9, 10), (0, 10), (0, 9), (4, 9)]
    i12 += [(4, 1), (0, 1)]
    assert shape_type(i12, False) == "I"
    assert shape_type(sq, True) == "circle"
    assert shape_type([(0, 0), (5, 0), (3, 4)], False) == "other"


def test_segment_geometry():
    segs = np.asarray(
        [
            (0, 0, 100, 0),  # the line
            (10, 0.4, 40, 0.4),  # on it
            (0, 6, 100, 6),  # parallel 6 pt away: a double line
            (130, 0, 200, 0),  # collinear, 30 pt gap
            (0, 50, 0, 90),  # far, perpendicular
        ],
        dtype=float,
    )
    assert on_line(segs, (0, 0, 100, 0)).tolist() == [True, True, False, False, False]
    assert parallel_partner(segs, 0) and not parallel_partner(segs, 4)
    assert collinear_span(segs, 0) == 200.0
    assert collinear_span(segs[[0, 4]], 0) == 100.0


def test_stratified_sample_moves_unused_slots_to_the_largest_category():
    groups = {
        "a": [{"key": (k,)} for k in range(10)],
        "b": [{"key": (k,)} for k in range(1)],
        "c": [{"key": (k,)} for k in range(5)],
    }
    got = stratified(groups, 9, ("a", "b", "c"), random.Random(13))
    n = {c: sum(1 for x, _ in got if x == c) for c in groups}
    assert n == {"a": 5, "b": 1, "c": 3}
    again = stratified(groups, 9, ("a", "b", "c"), random.Random(13))
    assert got == again
