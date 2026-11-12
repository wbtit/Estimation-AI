"""Phase 0 profile from callout: label reading, links, TYP rule (shared case file with the API)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.build.labels import Attached, attach_to_columns, attach_to_pieces, find_labels
from src.build.profile_labels import (
    CatalogIndex,
    PageLabel,
    link_point,
    read_page_labels,
    resolve_profile,
    typical_for,
)
from src.build.segments import TextLine
from src.text_layer.parsers.profile import CatalogMatcher

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures/synthetic/profile-link-cases.json").read_text()
)["cases"]


def _label(d: dict) -> PageLabel:
    x, y = d["x"], d["y"]
    flags = ("typical",) if d["typical"] else ()
    return PageLabel(
        d["canonical"], d["canonical"], d["canonical"], d["family"], "profile",
        (x - 10, y - 4, x + 10, y + 4), flags, valid=d.get("valid", True),
        leaders=[tuple(p) for p in d["leaders"]],
    )  # fmt: skip


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    labels = [_label(d) for d in case["labels"]]
    point = tuple(case["point"])
    if case["fn"] == "resolve":
        got = resolve_profile(point, labels, case["example"])
        exp = case["expect"]
        assert got["source"] == exp["source"] and got["profile"] == exp["canonical"]
        assert (got["link"] or {}).get("note") == exp["note"]
        return
    if case["fn"] == "link":
        box = tuple(case["box"]) if case["box"] else None
        got = link_point(point, box, labels)
    else:
        got = typical_for(point, labels, "column")
    exp = case["expect"]
    assert got.method == exp["method"]
    assert (got.label.canonical if got.label else None) == exp["canonical"]
    if "confidence" in exp:
        assert got.confidence == exp["confidence"]
    if "competitor" in exp:
        assert got.competitor == exp["competitor"]


def _catalog() -> CatalogIndex:
    c = CatalogIndex(None)
    c.matcher = CatalogMatcher(["W12X26", "W12X65", "HSS12X12X3/8", "L3X3X1/4"])
    c.weights = {"W12X26": 38.7, "W12X65": 96.7, "HSS12X12X3/8": 5.0, "L3X3X1/4": 1.0}
    return c


@pytest.mark.parametrize(
    "text",
    ["W12x26", "W12X26", "W 12 x 26", "W12 X 26", "W12x26 (E)", "(E) W12x26", "W12x26 TYP"],
)
def test_spellings_normalise_to_one_catalog_profile(text):
    out = read_page_labels([TextLine(text, (0, 0, 40, 8))], None, _catalog())
    assert [lb.canonical for lb in out] == ["W12X26"]
    assert out[0].valid and out[0].catalog_name == "W12X26"


def test_hss_decimal_spelling_and_fraction_agree():
    a = read_page_labels([TextLine("HSS12X12X3/8", (0, 0, 40, 8))], None, _catalog())[0]
    b = read_page_labels([TextLine("HSS 12x12x.375", (0, 0, 40, 8))], None, _catalog())[0]
    assert a.canonical == b.canonical == "HSS12X12X3/8" and a.valid and b.valid


def test_a_profile_not_in_the_catalog_is_invalid_not_dropped():
    lb = read_page_labels([TextLine("W12X999", (0, 0, 40, 8))], None, _catalog())[0]
    assert lb.canonical == "W12X999" and not lb.valid and lb.catalog_name is None
    assert not read_page_labels([TextLine("W12x26", (0, 0, 40, 8))], None, CatalogIndex(None))[
        0
    ].valid


def test_flags_existing_typical_joist_and_tag():
    out = read_page_labels(
        [
            TextLine("W12X26 (E)", (0, 0, 40, 8)),
            TextLine("W12X65 TYPICAL", (0, 20, 40, 28)),
            TextLine("BP1 W12X26", (0, 40, 40, 48)),
            TextLine("18K5", (0, 60, 40, 68)),
        ],
        None,
        _catalog(),
    )
    assert out[0].existing and not out[0].typical
    assert out[1].typical and not out[1].existing
    assert out[2].tag == "BP1"
    assert out[3].kind == "joist" and out[3].family == "JOIST" and "joist" in out[3].flags


def test_leader_ends_are_stored_with_the_label():
    seg = [(30.0, 4.0, 90.0, 4.0)]  # starts at the label's right edge, ends 50 pt away
    lb = read_page_labels([TextLine("W12X26", (0, 0, 30, 8))], seg, _catalog())[0]
    assert lb.leaders == [(90.0, 4.0)]


def test_source_label_typical_and_none_in_attach():
    labels = find_labels(
        [TextLine("W12X65", (150, 90, 190, 98)), TextLine("W12X53 TYP", (400, 90, 460, 98))], {}
    )
    out = attach_to_columns([(170.0, 110.0), (440.0, 300.0), (900.0, 900.0)], labels)
    # (440,300) and (900,900) are > 60 pt from both labels: they take the nearest TYP label
    assert [a.source for a in out] == ["label", "typical", "typical"]
    far = out[2]
    assert far.label.canonical == "W12X53" and far.size_state == "inferred"
    assert out[0].confidence == "high" and "nearest label" in out[0].reason
    assert isinstance(out[0], Attached) and out[0].evidence()["size"]["confidence"] == "high"


def test_a_beam_without_a_label_takes_the_nearest_beam_typ_label():
    # W labels are not used as beam TYP labels: a W note cannot be told from a column note
    labels = find_labels(
        [TextLine("L3X3X1/4 TYP", (0, 90, 60, 98)), TextLine("W16X26 TYP", (0, 190, 60, 198))], {}
    )
    out = attach_to_pieces([((200.0, 300.0), (400.0, 300.0))], labels)
    assert out[0].source == "typical" and out[0].label.canonical == "L3X3X1/4"
    assert out[0].size_state == "inferred"


def test_typ_scope_is_one_setting(monkeypatch):
    monkeypatch.setattr("src.build.profile_config.TYP_SCOPE", "glyph_signature")
    labels = find_labels([TextLine("W12X53 TYP", (400, 90, 460, 98))], {})
    out = attach_to_columns([(900.0, 900.0)], labels, signatures=["a"])
    assert out[0].rule == "typical_note"  # the earlier signature rule: the only signature
