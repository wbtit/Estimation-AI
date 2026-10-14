"""Estimator markups for comparison: tag, prefix, kind from the project mapping (synthetic)."""

import pymupdf

from tools.takeoff.import_markups import kind_for_mark, page_symbols, prefix_of


def test_prefix_and_kind_from_the_mapping():
    mapping = {"B": "Beams", "HR": "Hangers"}
    assert prefix_of("B12") == "B" and prefix_of("hr-3") == "HR" and prefix_of("TYP") is None
    assert kind_for_mark("B12", mapping) == "Beams"
    assert kind_for_mark("HR 4", mapping) == "Hangers"
    assert kind_for_mark("Q7", mapping) is None  # a prefix nobody mapped: no kind, no guess
    assert kind_for_mark(None, mapping) is None


def test_symbols_take_the_text_of_their_reply_linked_tag():
    doc = pymupdf.open()
    page = doc.new_page(width=400, height=300)
    sym = page.add_polygon_annot([(100, 100), (110, 100), (105, 92)])
    tag = page.add_freetext_annot(pymupdf.Rect(115, 90, 160, 104), "B12")
    doc.xref_set_key(tag.xref, "IRT", f"{sym.xref} 0 R")
    page.add_polygon_annot([(200, 200), (210, 200), (205, 192)])  # a symbol with no tag
    page.add_polygon_annot(
        [(0, 0), (10, 0), (10, 10), (5, 12), (0, 10)]
    )  # 5 vertices: not a symbol
    got = sorted(page_symbols(doc, page), key=lambda s: s["x"])
    assert [s["mark"] for s in got] == ["B12", None]
    assert abs(got[0]["x"] - 105) < 0.01
