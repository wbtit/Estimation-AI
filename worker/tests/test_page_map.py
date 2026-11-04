"""Markup page -> drawing page (Phase 13a): index when the page counts match, else the text-hash
map. SYNTHETIC PDFs only."""

from __future__ import annotations

import pymupdf

from measure.takeoff.common import (
    PAGE_MAP_INDEX,
    PAGE_MAP_TEXT_HASH,
    effective_page_map,
    with_page_map,
)
from tools.markups_intake import _page_map

SHEET = "GENERAL NOTES STEEL BEAMS W12X26 TYP GRID A B C 1 2 3 FRAMING PLAN LEVEL 2 SCALE 1/8"


def _pdf(path, texts):
    doc = pymupdf.open()
    for t in texts:
        page = doc.new_page(width=600, height=400)
        page.insert_text((40, 60), t, fontsize=9)
    doc.save(path)


def test_two_near_identical_sheets_stay_apart_with_equal_page_counts(tmp_path):
    # sheets 1 and 2 differ by one word: the text-hash rule maps both markup pages to drawing page 0
    texts = [SHEET + " S101", SHEET + " S102"]
    _pdf(tmp_path / "drawing.pdf", texts)
    _pdf(tmp_path / "markup.pdf", texts)
    old = _page_map(tmp_path / "markup.pdf", tmp_path / "drawing.pdf")
    assert old == {"0": 0, "1": 0}
    info = {"match": "job-901", "pages": 2, "same_page_count": True, "page_map": old}
    assert effective_page_map(info) == ({"0": 0, "1": 1}, PAGE_MAP_INDEX)
    entry = with_page_map(info)
    assert entry["page_map"] == {"0": 0, "1": 1} and entry["page_map_text_hash"] == old


def test_different_page_counts_keep_the_text_hash_map():
    info = {"match": "job-902", "pages": 3, "same_page_count": False, "page_map": {"0": 4, "2": 7}}
    assert effective_page_map(info) == ({"0": 4, "2": 7}, PAGE_MAP_TEXT_HASH)
    # no match: nothing is invented
    assert effective_page_map({"pages": 2, "same_page_count": True}) == ({}, PAGE_MAP_TEXT_HASH)


def test_pages_without_text_are_mapped_by_index():
    info = {"match": "job-903", "pages": 3, "same_page_count": True, "page_map": {"0": 0}}
    assert effective_page_map(info)[0] == {"0": 0, "1": 1, "2": 2}
