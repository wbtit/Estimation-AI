"""The private coverage tool, on synthetic PDFs (no real drawings)."""

import sys
from collections import Counter
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import text_coverage as tc  # noqa: E402


def counts(*lines: str) -> tuple[Counter, Counter, Counter]:
    acc, up_p, up_d = Counter(), Counter(), Counter()
    for line in lines:
        tc.line_counts(line, acc, up_p, up_d)
    return acc, up_p, up_d


def test_parsed_profiles_are_counted_and_unparsed_ones_are_classed_without_strings() -> None:
    acc, up_p, _ = counts("W12x26 AND HSS6x4x1/4", "L3x3 ANGLE", "L4x4x TYP")
    assert acc["profile_like"] == 4 and acc["profile_like_parsed"] == 2
    assert acc["profiles_parsed_W"] == 1 and acc["profiles_parsed_HSS"] == 1
    assert dict(up_p) == {"L:2dims": 2}  # classes, not strings


def test_a_family_letter_and_a_number_alone_is_not_profile_like() -> None:
    acc, up_p, _ = counts("SEE NOTE S4 AND C2, W12 AT GRID 3")
    assert acc["profile_like"] == 0 and not up_p


def test_rods_and_pipes_need_only_a_number() -> None:
    acc, up_p, _ = counts("PIPE 4 STD", "ROD 3/4", '3/4" THREADED ROD', "PIPE")
    assert acc["profile_like"] == 3 and acc["profile_like_parsed"] == 3 and not up_p


def test_dimension_like_tokens_split_into_parsed_and_unparsed_classes() -> None:
    acc, _, up_d = counts(
        "12'-6\" AND 3'-0\" AND 5' AND 6\"", "T.O.S. EL. 100'-0\"", '1/8" = 1\'-0"'
    )
    assert acc["dimension_like"] == 7 and acc["dimension_like_parsed"] == 7 and not up_d
    acc, _, up_d = counts("12'-6/0\" X", "12 '' AND 4'x")
    assert acc["dimension_like"] >= 1  # odd shapes are counted as dimension-like
    assert sum(up_d.values()) == acc["dimension_like"] - acc["dimension_like_parsed"]


def test_a_plate_length_is_counted_with_its_profile_not_as_a_dimension() -> None:
    acc, _, _ = counts("PL1/2x8x1'-6\"")
    assert acc["profile_like_parsed"] == 1 and acc["dimension_like"] == 0


def test_cover_reports_counts_only(tmp_path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=1500, height=1100)  # a large page
    page.insert_text((60, 700), '1/8" = 1\'-0"', fontsize=10)
    page.insert_text((60, 720), "W12x26 AT 12'-6\" ACME SECRET", fontsize=10)
    page.insert_text((1250, 1000), "SHEET NO.", fontsize=7)
    page.insert_text((1250, 1030), "S4.1", fontsize=24)
    small = doc.new_page(width=612, height=792)  # not a drawing sheet: ignored
    small.insert_text((50, 100), "W14x90 12'-0\" SOME TEXT TO MAKE A LAYER", fontsize=10)
    pdf = tmp_path / "x.pdf"
    doc.save(str(pdf))
    out = tc.cover(pdf)
    assert out["pages_large"] == 1 and out["pages_text_usable"] == 1
    assert out["sheet_number_share"] == 1.0 and out["scale_found_share"] == 1.0
    assert out["profile_like"] == 1 and out["profile_like_parse_share"] == 1.0
    assert out["dimension_like_parse_share"] == 1.0
    flat = str(out)
    assert "ACME" not in flat and "SECRET" not in flat and "W12" not in flat
