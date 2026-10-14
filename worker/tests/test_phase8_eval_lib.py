"""Synthetic tests for the Phase 8 quantity evaluation helpers (no workbook, no drawings)."""

from __future__ import annotations

from tools.takeoff import phase8_eval_lib as E


def test_canonical_size():
    assert E.canonical_size("HSS", "12X12X3/8") == "HSS12X12X3/8"
    assert E.canonical_size("WF", "12X26") == "W12X26"
    assert E.canonical_size("c", " 10 x 15.3 ") == "C10X15.3"
    assert E.canonical_size("PL", '3/8"X10"X1\'-0"') == 'PL:3/8"X10"X1\'-0"'
    assert E.canonical_size(None, "MEMBERS") is None
    assert E.canonical_size("HSS", "LINE PIPE") is None
    assert E.canonical_size("ZZ", "12X12") is None


def test_ref_tokens_take_the_sheet_part():
    assert E.ref_tokens("2/S1-01, 1/S2-01,1/S2-06") == ["S101", "S201", "S206"]
    assert E.ref_tokens("3/A-501\n") == ["A501"]
    assert E.ref_tokens("") == [] and E.ref_tokens(None) == [] and E.ref_tokens("no slash") == []


def test_corner_mapping_needs_exactly_one_page():
    sizes = {0: (1000, 800), 1: (1000, 800), 2: (1000, 800)}
    corner = ("S1-01", 800, 700, 900, 720)
    mid = ("S1-01", 100, 100, 160, 120)  # a cross-reference in the body of another page
    lines = {0: [corner], 1: [mid], 2: [("S2-01", 810, 710, 900, 730)]}
    got = E.map_tokens(["S101", "S201", "S999"], lines, sizes)
    assert got == {"S101": 0, "S201": 2, "S999": None}
    both = {0: [corner], 1: [("S1-01", 820, 705, 900, 725)], 2: []}
    assert E.map_tokens(["S101"], both, sizes) == {"S101": None}  # two pages: not guessed


def test_group_metrics():
    theirs = {"A": 10, "B": 5, "C": 3}
    ours = {"A": 10, "B": 6, "D": 2}
    m = E.group_metrics(theirs, ours)
    assert m["theirs_keys"]["n"] == 3
    assert abs(m["theirs_keys"]["exact"] - 1 / 3) < 1e-9
    assert abs(m["theirs_keys"]["within1"] - 2 / 3) < 1e-9  # A exact, B off by 1
    assert abs(m["theirs_keys"]["within20"] - 2 / 3) < 1e-9  # A, B (1 <= 1.0)
    assert m["union_keys"]["n"] == 4
    assert abs(m["error_rate"] - (0 + 1 + 3 + 2) / 18) < 1e-9
    assert m["missed"] == {"n": 1, "share_of_theirs_qty": 3 / 18}
    assert m["extra"]["n"] == 1 and abs(m["extra"]["share_of_ours_qty"] - 2 / 18) < 1e-9


def test_group_metrics_empty_and_zero_keys():
    assert E.group_metrics({}, {})["theirs_keys"]["n"] == 0
    m = E.group_metrics({"A": 0}, {"A": 0})
    assert m["union_keys"]["n"] == 0


def test_weight_error_leaves_unweighted_sizes_out_of_both_sums():
    w = {"A": 10.0, "B": 20.0}
    r = E.weight_error({"A": 4, "B": 1, "PL:x": 9}, {"A": 5, "B": 1, "Z": 7}, w)
    assert r["theirs"] == 60.0 and r["ours"] == 70.0
    assert abs(r["signed"] - 1 / 6) < 1e-9 and abs(r["absolute"] - 1 / 6) < 1e-9
    assert r["sizes_without_weight"] == ["PL:x", "Z"]
    assert E.weight_error({}, {}, w)["signed"] is None


def test_reading():
    assert E.reading(0.8, 0.05) == "usable as a first draft"
    assert E.reading(0.8, 0.2) == "partial"
    assert E.reading(0.5, 0.25) == "partial"
    assert E.reading(0.3, 0.05) == "not usable"
    assert E.reading(None, None) == "not usable"
