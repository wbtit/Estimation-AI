"""Phase 13a pen rules on SYNTHETIC marks and lines only."""

from __future__ import annotations

from tools.p13a_pen import (
    best_pen,
    click_pen,
    gap_closed,
    precision_recall,
    reading_order,
    right_pen,
    within,
)

H = ((0.0, 100.0, 400.0, 100.0), "heavy")  # a horizontal line at y = 100
T = ((0.0, 300.0, 400.0, 300.0), "thin")  # another at y = 300


def test_reading_order_is_top_then_left():
    assert reading_order([(50, 200), (10, 200), (90, 20)]) == [(90, 20), (10, 200), (50, 200)]


def test_click_takes_the_nearest_line_within_36_pt_and_tries_up_to_3_marks():
    # first mark (top) is 30 pt off the heavy line: first-try hit
    assert click_pen([(100, 130), (100, 290)], [H, T]) == ("heavy", 1)
    # the first two marks are far from any line, the third is 10 pt off the thin line
    marks = [(100, 160), (100, 200), (100, 290), (100, 101)]
    assert click_pen(marks[:3], [H, T]) == ("thin", 3)
    # only the first 3 in reading order count: (100, 101) comes first here and hits
    assert click_pen(marks, [H, T]) == ("heavy", 1)
    # every try misses: fall back (None)
    assert click_pen([(100, 160), (100, 200), (100, 240)], [H, T]) == (None, None)
    assert click_pen([], [H]) == (None, None)
    assert click_pen([(100, 140)], [H], radius=48.0) == ("heavy", 1)


def test_the_oracle_ties_go_to_the_auto_pen_then_the_name():
    assert best_pen({"a": 10, "b": 12, "c": 9}, 11, "c") == "a"  # a and b 1 off, c 2 off
    assert best_pen({"a": 10, "b": 12}, 11, None) == "a"  # tie 1 vs 1: name order
    assert best_pen({"a": 10, "b": 12}, 11, "b") == "b"  # tie: the auto pen wins
    assert best_pen({}, 5, "a") is None


def test_right_pen_bars_gap_and_precision():
    assert right_pen([(10, 101), (20, 102), (30, 299)], [H, T], 36.0) == "heavy"
    assert right_pen([(10, 200)], [H, T], 36.0) is None
    assert within(12, 10) and not within(13, 10) and not within(0, 0)
    assert gap_closed(5, 8, 11) == 0.5 and gap_closed(5, 5, 5) is None
    assert precision_recall(10, 4, 12) == (0.5, 0.6)
    assert precision_recall(0, 0, 0) == (None, None)
