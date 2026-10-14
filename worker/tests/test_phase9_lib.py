"""Synthetic tests of the Phase 9 helpers (size patterns, PDF strings, summaries, lines)."""

from __future__ import annotations

import pytest

from tools.takeoff import phase9_lib as P


@pytest.mark.parametrize(
    "value,cls",
    [
        ("W12x26", "wide-flange"),
        ("w 14 X 22", "wide-flange"),
        ("HP10x42", "wide-flange"),
        ("C10x15.3", "channel"),
        ("MC8x18.7", "channel"),
        ("L3x3x1/4", "angle"),
        ("L 3-1/2 x 3 x 5/16", "angle"),
        ("HSS6x6x3/8", "hollow"),
        ("HSS 6.625x0.280", "hollow"),
        ("TS4x4x1/4", "hollow"),
        ("PIPE 6 STD", "pipe"),
        ("PL 1/2 x 12", "plate-bar"),
        ('PL1/2"x12"x1\'-0"', "plate-bar"),
    ],
)
def test_whole_value_sizes(value, cls):
    assert cls in P.size_classes(value, whole=True)


@pytest.mark.parametrize(
    "value",
    ["", "B12", "Polygon", "12x26", "W12", "NOTE: SEE W12x26 AT GRID", "PL", "Count 3", "LEVEL 2"],
)
def test_not_a_whole_value_size(value):
    assert P.size_classes(value, whole=True) == set()


def test_contains_and_boundaries():
    assert "wide-flange" in P.size_classes("(2) W12x26 @ 4'-0\" O.C.", whole=False)
    # letters before the family do not count (no W inside a word)
    assert P.size_classes("SHOW10x20", whole=False) == set()
    assert P.size_classes("TYP", whole=False) == set()
    assert P.size_classes(None, whole=True) == set()


def test_dims_only_is_separate():
    assert P.dims_only("12x26", whole=True)
    assert not P.dims_only("W12x26", whole=True)
    assert P.dims_only("USE 12x26 HERE", whole=False)
    assert not P.dims_only("12", whole=True)


def test_canonical_from_text_matches_the_phase8_form():
    assert P.canonical_from_text("beam w12 x 26 typ") == "W12X26"
    assert P.canonical_from_text("HSS 12x12x3/8 col") == "HSS12X12X3/8"
    assert P.canonical_from_text("L3x3x1/4") == "L3X3X1/4"
    assert P.canonical_from_text("PL 1/2 x 12") == "PL:1/2X12"
    assert P.canonical_from_text("nothing here") is None


def test_parse_pdf_strings():
    assert P.parse_pdf_strings("[()()(0)(a b)(x\\)y)(n(e)st)]") == [
        "",
        "",
        "0",
        "a b",
        "x)y",
        "n(e)st",
    ]
    assert P.parse_pdf_strings("[<4142>(c)]") == ["AB", "c"]
    assert P.parse_pdf_strings("[<FEFF00570031>]") == ["W1"]
    assert P.parse_pdf_strings(None) == []
    assert P.parse_pdf_strings("[(a\\nb)]") == ["a\nb"]


def test_rich_text_plain():
    assert P.rich_text_plain("<body><p>W12x26 &amp; <b>typ</b></p></body>") == "W12x26 & typ"
    assert P.rich_text_plain(None) == ""


def test_value_kind():
    assert [P.value_kind(v) for v in (None, " ", "12", "-0.5", "B12", "two words here")] == [
        "empty",
        "empty",
        "numeric",
        "numeric",
        "short code",
        "text",
    ]


def test_summarize_values_returns_counts_only():
    s = P.summarize_values(["W12x26", "W12x26", "", "B1", "see W8x10 note", None, "12"])
    assert s["n"] == 7 and s["filled"] == 5 and s["distinct"] == 4
    assert s["any_whole"] == 2 and s["any_contains"] == 3
    assert s["whole"] == {"wide-flange": 2}
    assert s["kinds"]["numeric"] == 1 and s["kinds"]["text"] == 1
    assert not any(isinstance(v, str) and "W12" in v for v in s.values())


def test_merge_summaries_and_qualifies():
    a = P.summarize_values(["W12x26", "W8x10"])
    b = P.summarize_values(["x", "W6x9"])
    m = P.merge_summaries([a, b])
    assert m["n"] == 4 and m["any_whole"] == 3 and m["whole"]["wide-flange"] == 3
    shares = {"f1": 0.9, "f2": 0.4, "f3": None, "f4": 0.5}
    assert P.qualifies(shares, share=0.5, min_files=2)
    assert not P.qualifies(shares, share=0.5, min_files=3)


def test_parallel_lines_in_region():
    anchor = [0, 0, 100, 0]
    lines = [
        anchor,
        [0, 50, 100, 50],  # parallel, 50 across
        [0, 400, 100, 400],  # too far for 300
        [0, 20, 30, 20],  # too short (30 < 50)
        [50, -10, 50, 90],  # perpendicular
        [0, 10, 100, 12],  # 1.1 degrees: parallel enough
        [0, 10, 100, 40],  # 16.7 degrees: not parallel
        [500, 20, 600, 20],  # parallel but beside, outside the along extent
    ]
    assert P.parallel_lines_in_region(anchor, lines, 300) == 3
    assert P.parallel_lines_in_region(anchor, lines, 600) == 4
    assert P.parallel_lines_in_region(anchor, lines, 30) == 2
    klass = [1, 1, 1, 1, 1, 2, 1, 1]
    assert P.parallel_lines_in_region(anchor, lines, 300, klass=klass, anchor_klass=1) == 2


def test_parallel_lines_zero_length_anchor():
    assert P.parallel_lines_in_region([5, 5, 5, 5], [[0, 0, 10, 0]], 100) == 0


def test_ratio_band():
    assert P.ratio_band(1.0) == "in band"
    assert P.ratio_band(0.5) == "below"
    assert P.ratio_band(2) == "above"
    assert P.ratio_band(None) == "n/a"


def test_assign_nearest_label_within_radius():
    from tools.takeoff.phase9_derived import assign, size_key

    labels = [("W12X26", 100.0, 100.0), ("HSS6X6X3/8", 150.0, 100.0)]
    got = assign([(110, 100), (140, 100), (400, 400), (100, 190)], labels, 80.0)
    assert got == ["W12X26", "HSS6X6X3/8", None, None]  # (100, 190) is 90 pt from the nearest label
    assert assign([(100, 181)], labels, 80.0) == [None]  # 81 pt away from the nearest label
    assert size_key('PL:3/4"X12"X1\'-0"') == "PL:3/4X12X1-0"
