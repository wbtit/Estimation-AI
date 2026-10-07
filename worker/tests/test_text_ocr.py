"""OCR cross-check and OCR-vote logic, tested with fake engines (no model needed)."""

import socket
from collections import Counter

import numpy as np
import pymupdf
import pytest
from db_fixtures import DbProject, vector_text_page
from stroke_font import draw_text, new_doc_page

from src.text_reader import glyph_admin, rules
from src.text_reader.library import Matcher, load_entries
from src.text_reader.lines import assemble
from src.text_reader.ocr import collect_votes, fold, proposed_label, render_crop
from src.text_reader.reader import read_page, resolve_clusters
from src.text_reader.strokes import extract_clusters

FONT = "test-font"


class Scripted:
    """An OCR engine that answers from a script, one answer per call."""

    def __init__(self, answers: list[str]):
        self.answers = list(answers)
        self.calls = 0

    def read(self, image: np.ndarray) -> str:
        assert image.ndim == 3 and image.shape[2] == 3
        self.calls += 1
        return self.answers.pop(0)


def page_with(*texts: str):
    _, page = new_doc_page(800, 600)
    for k, t in enumerate(texts):
        draw_text(page, t, 50, 50 + k * 40)
    return page


def confirmed():
    from stroke_font import confirmed_library

    return confirmed_library(FONT)


def read(page, entries, ocr=None):
    matcher = Matcher(entries)
    return read_page(page, matcher, FONT, Counter(), {e.signature_hash: e for e in entries}, ocr)


# --- cross-check -------------------------------------------------------------------------------
def test_agreement_raises_confidence_and_never_changes_the_glyph_text() -> None:
    r = read(page_with("B2", "HSS6x4x1/4"), confirmed(), Scripted(["B2", "hss6x4x1/4"]))
    for item, truth in zip(r.items, ["B2", "HSS6x4x1/4"], strict=True):
        assert item.text == truth and item.agree is True
        assert item.confidence == rules.CONF_OCR_AGREES and not item.needs_review
        assert item.methods == ["glyph", "ocr"]


def test_agreement_ignores_case_and_spaces() -> None:
    r = read(page_with("B2 CONT"), confirmed(), Scripted(["b2cont"]))
    assert r.items[0].agree is True and r.items[0].ocr_text == "b2cont"
    assert fold(" b 2 ") == "B2"


def test_disagreement_flags_review_and_keeps_the_glyph_text() -> None:
    r = read(page_with("B2"), confirmed(), Scripted(["82"]))
    (item,) = r.items
    assert item.text == "B2" and item.ocr_text == "82"  # the OCR reading sits beside it
    assert item.agree is False and item.needs_review
    assert item.review_reasons == [rules.REASON_OCR_DISAGREES]
    assert item.confidence == rules.CONF_OCR_DISAGREES


def test_lines_with_unknown_shapes_are_not_compared() -> None:
    r = read(page_with("B2"), [], Scripted(["B2"]))  # empty library: both characters unknown
    (item,) = r.items
    assert item.text == "??" and item.ocr_text == "B2"
    assert item.agree is None and item.confidence == rules.CONF_GLYPH_UNKNOWN
    assert item.review_reasons == [rules.REASON_UNKNOWN_GLYPH]  # OCR did not rescue it


def test_vertical_text_is_not_sent_to_ocr() -> None:
    _, page = new_doc_page(800, 600)
    draw_text(page, "B2", 50, 50)
    draw_text(page, "LATTICE", 300, 400, vertical=True)
    engine = Scripted(["B2"])
    read_page(page, Matcher(confirmed()), FONT, Counter(), {}, engine)
    assert engine.calls == 1


def test_without_an_engine_nothing_is_cross_checked() -> None:
    (item,) = read(page_with("B2"), confirmed()).items
    assert (item.ocr_text, item.agree, item.methods) == (None, None, ["glyph"])


def test_the_crop_is_a_white_margined_rgb_image_of_the_line() -> None:
    page = page_with("B2")
    (item,) = read(page, confirmed()).items
    img = render_crop(page, item.bbox)
    assert img.dtype == np.uint8 and img.shape[2] == 3
    assert (img[:40] == 255).all() and (img[:, :40] == 255).all()  # the margin
    assert (img < 128).any()  # and there is ink inside


# --- votes -------------------------------------------------------------------------------------
def prepared(page):
    """Clusters resolved against an empty library, so every shape is a proposed group."""
    matcher = Matcher([])
    by_hash: dict = {}
    clusters = extract_clusters(page)
    entry_of = resolve_clusters(clusters, matcher, FONT, Counter(), by_hash, Counter())
    hlines, _, _ = assemble(clusters)
    return hlines, (lambda c: entry_of.get(id(c))), entry_of


def test_votes_follow_the_characters_one_to_one() -> None:
    page = page_with("B2", "B1")
    hlines, entry_of, _ = prepared(page)
    votes, stats = collect_votes(page, hlines, entry_of, Scripted(["B2", "B1"]))
    assert stats["voting"] == 2
    by_label = {proposed_label(c): c for c in votes.values()}
    assert set(by_label) == {"B", "2", "1"}
    assert sum(c["B"] for c in votes.values()) == 2  # B drawn twice, one group, two votes
    assert max(sum(c.values()) for c in votes.values()) == 2


def test_the_majority_wins_and_a_tie_proposes_nothing() -> None:
    page = page_with("B2", "B2", "B2")
    hlines, entry_of, _ = prepared(page)
    votes, _ = collect_votes(page, hlines, entry_of, Scripted(["B2", "B2", "82"]))
    b_votes = next(c for c in votes.values() if "B" in c)
    assert b_votes == Counter({"B": 2, "8": 1}) and proposed_label(b_votes) == "B"
    assert proposed_label(Counter({"B": 2, "8": 2})) is None and proposed_label(Counter()) is None


def test_letters_vote_case_insensitively() -> None:
    page = page_with("6x4")
    hlines, entry_of, _ = prepared(page)
    votes, _ = collect_votes(page, hlines, entry_of, Scripted(["6X4"]))
    assert {proposed_label(c) for c in votes.values()} == {"6", "X", "4"}


def test_lines_vote_only_when_the_ocr_length_matches() -> None:
    page = page_with("B2")
    hlines, entry_of, _ = prepared(page)
    votes, stats = collect_votes(page, hlines, entry_of, Scripted(["B"]))
    assert votes == {} and stats["length_mismatch"] == 1 and stats["voting"] == 0


def test_lines_with_small_marks_or_unmatched_clusters_do_not_vote() -> None:
    page = page_with("B2.")
    hlines, entry_of, _ = prepared(page)
    engine = Scripted(["B2."])
    votes, stats = collect_votes(page, hlines, entry_of, engine)
    assert votes == {} and stats["has_marks"] == 1 and engine.calls == 0
    page = page_with("B2")
    hlines, _, _ = prepared(page)
    votes, stats = collect_votes(page, hlines, lambda c: None, Scripted(["B2"]))
    assert votes == {} and stats["no_entry"] == 1


def test_lines_in_the_ground_truth_file_never_vote() -> None:
    page = page_with("B2", "B1")
    hlines, entry_of, _ = prepared(page)
    excluded = [hlines[0].bbox]
    engine = Scripted(["B1"])
    votes, stats = collect_votes(page, hlines, entry_of, engine, exclude=excluded)
    assert stats["excluded"] == 1 and engine.calls == 1 and stats["voting"] == 1


def test_apply_votes_proposes_but_never_confirms_or_relabels(dbp: DbProject) -> None:
    doc = pymupdf.open()
    page = vector_text_page(doc)
    draw_text(page, "B2", 60, 80)
    doc.save(str(dbp.pdf_path))
    doc.close()
    dbp.scan()
    from src.text_reader.job import read_project

    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, None)
    lib = dbp.library()
    a, b = lib[0], lib[1]
    dbp.conn.execute(
        "UPDATE glyph_library SET label = 'Q', status = 'confirmed', reviewed_by = 'tester',"
        " reviewed_at = NOW(), source = 'csv_import' WHERE id = %s",
        (b["id"],),
    )
    dbp.conn.commit()
    changed = glyph_admin.apply_votes(
        dbp.conn,
        dbp.font_id,
        {
            a["signature_hash"]: Counter({"B": 3, "8": 1}),
            b["signature_hash"]: Counter({"2": 2}),
            "0" * 64: Counter({"X": 1}),  # not in the library: ignored
        },
    )
    assert changed == 2
    rows = {r["signature_hash"]: r for r in dbp.library()}
    first = rows[a["signature_hash"]]
    assert (first["proposed_label"], first["status"], first["label"], first["source"]) == (
        "B",
        "proposed",
        None,
        "ocr_vote",
    )
    assert first["votes"] == {"B": 3, "8": 1}
    second = rows[b["signature_hash"]]  # a confirmed group keeps its label, status and source
    assert (second["label"], second["status"], second["source"]) == ("Q", "confirmed", "csv_import")
    assert second["votes"] == {"2": 2}
    # votes accumulate across runs
    glyph_admin.apply_votes(dbp.conn, dbp.font_id, {a["signature_hash"]: Counter({"B": 1})})
    assert {r["signature_hash"]: r for r in dbp.library()}[a["signature_hash"]]["votes"] == {
        "B": 4,
        "8": 1,
    }
    entries = load_entries(dbp.conn, dbp.font_id)
    assert [e for e in entries if e.decodes] == [
        e for e in entries if e.label == "Q"
    ]  # only the person's label decodes


# --- the optional real engine ------------------------------------------------------------------
def test_the_real_engine_reads_text_and_makes_no_network_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pytest.importorskip("rapidocr_onnxruntime")
    from src.text_reader.ocr import RapidOcrEngine

    def refuse(*_a, **_k):
        raise AssertionError("OCR attempted a network connection")

    engine = RapidOcrEngine()  # models load from the installed package
    page = page_with("HSS6x4x1/4")
    (item,) = read(page, confirmed()).items
    image = render_crop(page, item.bbox)
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    text = engine.read(image)
    assert isinstance(text, str)
    r = read(page, confirmed(), engine)
    assert r.items[0].ocr_text is not None and r.items[0].text == "HSS6x4x1/4"
