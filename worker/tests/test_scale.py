"""Scale parsing: shared vectors (also run by the TypeScript override validator) and line search."""

import json
from pathlib import Path

import pytest

from src.pdf_scan.scale import distinct_scales, find_scales_in_line, normalize, parse_scale_exact

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures/synthetic/scale-cases.json").read_text()
)
Q, A, D = chr(0x201D), chr(0x2019), chr(0x2013)  # typographic quote, apostrophe, en dash


@pytest.mark.parametrize("case", CASES["valid"], ids=lambda c: c["input"])
def test_shared_valid_vectors(case: dict) -> None:
    scale = parse_scale_exact(case["input"])
    assert scale is not None
    assert scale.kind == case["kind"]
    if case["ratio"] is None:
        assert scale.ratio is None
    else:
        assert scale.ratio == pytest.approx(case["ratio"], rel=1e-9)


@pytest.mark.parametrize("text", CASES["invalid"])
def test_shared_invalid_vectors(text: str) -> None:
    assert parse_scale_exact(text) is None


def test_ratio_is_real_over_drawn() -> None:
    assert parse_scale_exact('1/8" = 1\'-0"').ratio == 96  # type: ignore[union-attr]
    assert parse_scale_exact('1/4" = 1\'-0"').ratio == 48  # type: ignore[union-attr]
    assert parse_scale_exact("NTS").ratio is None  # type: ignore[union-attr]


def test_typographic_quotes_and_dashes_are_normalized() -> None:
    text = f"1/8{Q} = 1{A}{D}0{Q}"
    assert normalize(text) == '1/8" = 1\'-0"'
    scale = parse_scale_exact(text)
    assert scale is not None and scale.raw == '1/8" = 1\'-0"' and scale.ratio == 96


def test_find_in_running_text() -> None:
    found = find_scales_in_line('TYPICAL BEAM DETAIL   1/4" = 1\'-0"   SEE NOTE 3')
    assert [(s.kind, s.ratio) for s in found] == [("ratio", 48)]
    assert found[0].raw == '1/4" = 1\'-0"'


def test_bare_ratio_needs_the_word_scale() -> None:
    assert find_scales_in_line("NOTE 1:2 SEE SHEET") == []
    assert [s.ratio for s in find_scales_in_line("SCALE 1:50")] == [50]


def test_nts_is_not_found_inside_other_words() -> None:
    assert find_scales_in_line("DETAIL (NTS)")[0].kind == "nts"
    assert find_scales_in_line("PLANTS AND SEATS") == []
    assert find_scales_in_line("INTS 12") == []


def test_several_scales_in_one_line_keep_their_order() -> None:
    found = find_scales_in_line('1/8" = 1\'-0"    1/4" = 1\'-0"')
    assert [s.ratio for s in found] == [96, 48]


def test_distinct_scales_dedupes_and_counts() -> None:
    result = distinct_scales(
        ['PLAN 1/8" = 1\'-0"', "OTHER", 'VIEW 1/8" = 1\'-0"', 'DETAIL 1/4" = 1\'-0"', "(NTS)"]
    )
    assert result == [
        {"raw": '1/8" = 1\'-0"', "kind": "ratio", "ratio": 96.0, "count": 2},
        {"raw": '1/4" = 1\'-0"', "kind": "ratio", "ratio": 48.0, "count": 1},
        {"raw": "NTS", "kind": "nts", "ratio": None, "count": 1},
    ]
