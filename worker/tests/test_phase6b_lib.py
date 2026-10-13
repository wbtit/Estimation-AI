"""Phase 6b helpers: synthetic geometry only."""

import numpy as np

from tools.takeoff.phase6b_lib import (
    Piece,
    distinct_lines,
    greedy_match,
    line_key,
    line_segment_class,
    lines_near_point,
    merge_lines,
    page_agreement,
    piece_miss_reason,
    point_rect_distance,
    point_segment_distance,
    prf,
    same_line,
    split_remains,
    symbol_miss_reason,
    verdict,
)


def test_distances_to_a_segment_and_to_a_box() -> None:
    assert point_segment_distance(5, 3, (0, 0, 10, 0)) == 3
    assert point_segment_distance(-4, 3, (0, 0, 10, 0)) == 5  # beyond the end: to the end point
    assert point_segment_distance(1, 1, (2, 2, 2, 2)) == 2**0.5  # a zero-length segment
    assert point_rect_distance(5, 5, (0, 0, 10, 10)) == 0
    assert point_rect_distance(13, 14, (0, 0, 10, 10)) == 5


def test_greedy_matching_is_one_to_one_by_distance_and_deterministic() -> None:
    pieces = [Piece(line=(0, 0, 10, 0)), Piece(line=(0, 20, 10, 20))]
    syms = [(5, 4), (5, 9), (5, 40)]
    m = greedy_match(syms, pieces, 12)
    # symbol 0 (4 pt) takes piece 0; symbol 1 is 9 pt from piece 0 (taken) and 11 pt from piece 1
    assert sorted((s, p) for s, p, _ in m) == [(0, 0), (1, 1)]
    assert greedy_match(syms, pieces, 6) == [(0, 0, 4.0)]
    assert greedy_match([(5, 5)], [Piece(line=(0, 0, 10, 0))], 4) == []
    # two symbols on one piece: only one is matched
    assert len(greedy_match([(2, 1), (8, 1)], [Piece(line=(0, 0, 10, 0))], 12)) == 1
    # a piece with no line uses its label box
    assert greedy_match([(15, 5)], [Piece(line=None, box=(0, 0, 10, 10))], 6) == [(0, 0, 5.0)]


def test_precision_recall_f1_and_the_page_agreement_bars() -> None:
    p, r, f = prf(6, 10, 8)
    assert (p, r) == (0.6, 0.75) and abs(f - 2 * 0.6 * 0.75 / 1.35) < 1e-9
    assert prf(0, 0, 5) == (None, 0.0, None) and prf(0, 3, 0) == (0.0, None, None)
    assert page_agreement(10, 10)["equal"] and page_agreement(11, 10)["within1"]
    assert page_agreement(12, 10) == {"equal": False, "within1": False, "within20": True}
    assert page_agreement(1, 0)["within20"] is False


def test_the_registered_bars() -> None:
    assert verdict(0.5, 0.6, 0.6) == "worth building on"
    assert verdict(0.49, 0.9, 0.9) == "promising"
    assert verdict(0.3, 0.4, 0.4) == "promising"
    assert verdict(0.29, 0.9, 0.9) == "not enough"
    assert verdict(0.9, 0.59, 0.9) == "promising"
    assert verdict(0.9, 0.39, 0.9) == "not enough"
    assert verdict(None, 0.9, 0.9) == "not enough"


def test_merging_joins_collinear_pieces_within_the_gap_and_leaves_the_rest() -> None:
    lines = [(0, 0, 100, 0), (108, 0.5, 200, 0.5), (300, 0, 400, 0), (0, 50, 100, 52)]
    got = merge_lines(lines)
    assert sorted((round(s[0]), round(s[2]), n) for s, n in got) == [
        (0, 100, 1),  # the line 2 degrees off the axis stays alone
        (0, 200, 2),  # gap 8 pt, offset 0.5 pt, same angle: joined
        (300, 400, 1),  # gap 100 pt: not joined
    ]
    # a gap of 13 pt is not joined, an overlap is
    assert len(merge_lines([(0, 0, 50, 0), (63, 0, 100, 0)])) == 2
    assert len(merge_lines([(0, 0, 60, 0), (40, 0, 100, 0)])) == 1
    # three pieces chain into one
    assert merge_lines([(0, 0, 10, 0), (15, 0, 30, 0), (35, 0, 60, 0)])[0][1] == 3
    # a parallel line 3 pt away is not collinear
    assert len(merge_lines([(0, 0, 50, 0), (55, 3, 100, 3)])) == 2


def test_split_remains_and_the_symbol_line_class() -> None:
    a, b = (0, 0, 50, 0), (80, 0, 130, 0)  # gap 30 pt: stays split
    assert split_remains(a, [a, b]) and not split_remains(a, [a, (300, 0, 350, 0)])
    merged = [((0, 0, 200, 0), 2), (a, 1)]
    assert line_segment_class((100, 3), merged) == "merged"
    assert line_segment_class((10, 5), [(a, 1), (b, 1)]) == "split remains"
    assert line_segment_class((10, 5), [(a, 1)]) == "single"
    assert line_segment_class((10, 50), [(a, 1)]) is None


def test_distinct_lines_collapse_labels_that_share_a_line_and_keep_the_worst_colour() -> None:
    ps = [
        Piece(line=(0, 0, 10, 0), colour="green", key="a"),
        Piece(line=(0.3, 0.2, 10.1, 0), colour="red", key="b"),  # the same line within 0.6 pt
        Piece(line=(0, 5, 10, 5), colour="amber", key="c"),
    ]
    out = distinct_lines(ps)
    assert [(p.colour, p.extra["labels"]) for p in out] == [("red", 2), ("amber", 1)]
    assert same_line((0, 0, 10, 0), (10, 0, 0, 0)) and not same_line((0, 0, 10, 0), (0, 2, 10, 2))


def test_miss_reasons_follow_the_registered_order() -> None:
    line = (0, 0, 10, 0)
    k = line_key(line)
    args = dict(pieces_near_used=False, pieces_near_far=False)
    assert (
        symbol_miss_reason(raster=True, lines_near=[line], reach={k}, linked={k}, **args)
        == "raster page"
    )
    assert symbol_miss_reason(
        raster=False, lines_near=[], reach=set(), linked=set(), **args
    ).startswith("no extracted")
    assert symbol_miss_reason(
        raster=False, lines_near=[line], reach=set(), linked=set(), **args
    ).startswith("unlinked")
    assert symbol_miss_reason(
        raster=False, lines_near=[line], reach={k}, linked=set(), **args
    ).startswith("linked elsewhere")
    used = dict(pieces_near_used=True, pieces_near_far=False)
    assert (
        symbol_miss_reason(raster=False, lines_near=[line], reach={k}, linked={k}, **used)
        == "other: several symbols on one linked line"
    )
    far = dict(pieces_near_used=False, pieces_near_far=True)
    assert symbol_miss_reason(
        raster=False, lines_near=[line], reach={k}, linked={k}, **far
    ).startswith("other: linked piece")
    assert line_key((10, 0, 0, 0)) == line_key((0, 0, 10, 0))


def test_piece_miss_reasons_and_lines_near_point() -> None:
    assert piece_miss_reason(page_has_symbols=False, shared=True, symbol_within_24=True).startswith(
        "page has no"
    )
    assert piece_miss_reason(page_has_symbols=True, shared=True, symbol_within_24=False).startswith(
        "extra piece"
    )
    assert piece_miss_reason(
        page_has_symbols=True, shared=False, symbol_within_24=False
    ).startswith("no symbol")
    assert piece_miss_reason(page_has_symbols=True, shared=False, symbol_within_24=True) == "other"
    segs = np.array([[0.0, 0.0, 10.0, 0.0], [0.0, 30.0, 10.0, 30.0]])
    assert lines_near_point(5, 5, segs, 24) == [(0.0, 0.0, 10.0, 0.0)]
    assert lines_near_point(5, 5, np.zeros((0, 4)), 24) == []
