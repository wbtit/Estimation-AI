"""Phase 12e intake rules on SYNTHETIC data only (no real drawing or markup)."""

from __future__ import annotations

from pathlib import Path

import pymupdf

from tools.markups_intake import (
    Doc,
    _markup,
    firm_of,
    is_yellow,
    mark_kind,
    merge_ratios,
    normalise_firm,
    pair,
    parse_summary,
    shared_share,
    summary_counts,
)


def test_summary_pairs_kinds_and_the_tilde_oddity():
    pairs = parse_summary("Columns-70, Beams-163\nBraces = 12\nLintels: 37~20")
    assert [(p["kind"], p["n"], p["alt"]) for p in pairs] == [
        ("column", 70, None),
        ("beam", 163, None),
        ("brace", 12, None),
        ("other", 37, 20),
    ]
    assert summary_counts(pairs) == {"column": 70, "beam": 163, "brace": 12, "other": 37}
    assert parse_summary("") == [] and parse_summary("no numbers here") == []


def test_yellow_and_the_named_prefixes_only():
    assert is_yellow((1, 1, 0)) and is_yellow([1.0, 1.0, 0.5])
    assert not is_yellow((0, 1, 0)) and not is_yellow((1, 0.7, 0.5)) and not is_yellow(None)
    assert [mark_kind(p) for p in ("B", "C", "VB", "HB", "KB", "L", None)] == [
        "beam",
        "column",
        "brace",
        "brace",
        None,
        None,
        None,
    ]


def test_firm_names_are_normalised_and_generic_lines_dropped():
    assert normalise_firm("Acme Structural Engineers, Inc.") == "ACME STRUCTURAL ENGINEERS"
    assert normalise_firm("ACME STRUCTURAL ENGINEERS LLC") == "ACME STRUCTURAL ENGINEERS"
    assert normalise_firm("STRUCTURAL ENGINEER OF RECORD") is None  # generic words only
    assert normalise_firm("Structural Engineers 123 Main St") is None  # digits: an address
    assert (
        normalise_firm("THE ENGINEER SHALL REVIEW ALL SHOP DRAWINGS BEFORE ANY WORK BEGINS") is None
    )


def test_the_firm_repeats_on_half_the_sheets_structural_first():
    firm = "ACME STRUCTURAL ENGINEERS"
    other = "BETA ENGINEERING"
    pages = [[firm, other]] * 3 + [["FOUNDATION PLAN", "ZED STRUCTURAL GROUP"]] + [[other]] * 2
    assert firm_of(pages) == (firm, "structural", 3)
    # a STRUCTURAL line on one page of six does not repeat: the other keyword wins
    pages = [[other]] * 5 + [["ZED STRUCTURAL GROUP"]]
    assert firm_of(pages) == (other, "other_keyword", 5)
    # with two or more S-sheets only those count
    pages = [
        [firm],
        [firm],
        ["GAMMA ARCHITECTS INC"],
        ["GAMMA ARCHITECTS INC"],
        ["GAMMA ARCHITECTS INC"],
    ]
    assert firm_of(pages, ["S-1", "S-2", "A-1", "A-2", "A-3"]) == (firm, "structural", 2)
    assert firm_of([[], []]) == (None, None, 0)


def test_pairing_needs_the_same_page_count_and_a_unique_best_match():
    m = [Doc(Path("m1"), 3, ["a", "b", None]), Doc(Path("m2"), 2, ["x", "y"])]
    d = [Doc(Path("d1"), 2, ["x", "y"]), Doc(Path("d2"), 3, ["a", "b", "c"])]
    assert pair(m, d) == ({0: 1, 1: 0}, [])
    tie = [Doc(Path("d1"), 2, ["x"]), Doc(Path("d2"), 2, ["y"])]
    assert pair([Doc(Path("m"), 2, ["x", "y"])], tie) == ({}, [0])
    assert pair([Doc(Path("m"), 2, ["q"])], tie) == ({}, [0])
    assert shared_share(["a", "b", None], ["a", "b", "c", "d"]) == 1.0
    assert merge_ratios([48.0, 48.2, 96.0]) == [48.0, 96.0]


def _annot_markup(path: Path, yellow: bool) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    text = "Columns-2, Beams-1" if yellow else "ESTIMATED BY: X\nINCLUDES: Columns-2, Beams-1"
    box = page.add_freetext_annot(pymupdf.Rect(20, 20, 200, 80), text)
    if yellow:
        doc.xref_set_key(box.xref, "C", "[1 1 0]")
    for i, tag in enumerate(("C1", "C2", "B1")):
        x = 100 + 80 * i
        pts = (
            [(x, 200), (x + 10, 220), (x - 10, 220)]
            if tag[0] == "C"
            else [
                (x + dx, 200 + dy)
                for dx, dy in ((0, -8), (6, -6), (8, 0), (6, 6), (0, 8), (-6, 6), (-8, 0), (-6, -6))
            ]
        )
        poly = page.add_polygon_annot(pts)
        reply = page.add_freetext_annot(pymupdf.Rect(x + 12, 190, x + 40, 205), tag)
        doc.xref_set_key(reply.xref, "IRT", f"{poly.xref} 0 R")
    doc.save(path)


def test_summary_box_rules_and_symbol_prefixes(tmp_path):
    p = tmp_path / "yellow.pdf"
    _annot_markup(p, yellow=True)
    m = _markup(p)
    assert m["summary"]["rule"] == "yellow_freetext"
    assert summary_counts(m["summary"]["pairs"]) == {"column": 2, "beam": 1}
    assert m["pages"][0]["symbols"] == 3 and m["pages"][0]["prefixes"] == {"C": 2, "B": 1}
    q = tmp_path / "front.pdf"
    _annot_markup(q, yellow=False)
    assert _markup(q)["summary"]["rule"] == "front_sheet_keywords"
