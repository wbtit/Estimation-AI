"""Phase 13c measurement rules on SYNTHETIC marks and lines only."""

from __future__ import annotations

from tools.p13c_fixes import CONFIGS, intended_pen, lowered, outside, prf

H = ((0.0, 100.0, 400.0, 100.0), "heavy")
T = ((0.0, 300.0, 400.0, 300.0), "thin")
T2 = ((0.0, 110.0, 400.0, 110.0), "thin")


def test_intended_pen_counts_marks_near_each_pen():
    marks = [(10.0, 105.0), (50.0, 120.0), (90.0, 290.0)]
    assert intended_pen(marks, [H, T], "thin") == "heavy"  # heavy near 2 marks, thin near 1
    # a pen counts a mark once however many of its lines are near
    assert intended_pen([(10.0, 105.0)], [H, T2, T2], None) == "heavy"  # tie 1:1, name order
    assert intended_pen([(10.0, 105.0)], [H, T2], "thin") == "thin"  # tie: the auto pen wins
    assert intended_pen([(10.0, 200.0)], [H, T], "heavy") is None


def test_guard_precision_and_crop_helpers():
    assert lowered({"a": 3, "b": 2, "c": 0}, {"a": 2, "b": 2, "c": 1}) == ["a"]
    assert prf(3, 6, 12) == (0.5, 0.25) and prf(0, 0, 0) == (None, None)
    assert outside((5.0, 5.0), (10, 0, 20, 20)) and not outside((10.0, 0.0), (10, 0, 20, 20))


def test_configurations_are_the_preregistered_ones():
    main = [c for c, v in CONFIGS.items() if v[4]]
    assert main == ["A", "F1-auto", "F1-D", "F2", "F3", "F4", "ALL", "ALL-D"]
    assert CONFIGS["A"] == ("auto", False, (), 1.0, True)
    assert CONFIGS["ALL"][:3] == (
        "f1",
        True,
        ("wall_same_pen", "column_strokes", "column_off_grid"),
    )
    assert {CONFIGS[c][3] for c in CONFIGS if "gap" in c} == {2.0, 3.0}
