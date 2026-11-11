"""One bad page must not lose the project's text; NUL characters are stored clean.

Real Postgres (`make up`, `make migrate`). PDFs are synthetic and built here.
"""

import pymupdf
import pytest
from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.review.auto_run import auto_run
from src.text_layer.items import clean_text, extract_page_text
from src.text_reader import job as text_job
from src.text_reader.job import ReadError, read_project

TEXTS = [
    ((60, 700), '1/8" = 1\'-0"', 10),
    ((60, 720), "(2) W12x26 SPAN 12'-6\" B1 FRAMING PLAN NOTES", 10),
    ((60, 740), "T.O.S. EL. 100'-0\"", 10),
]


class FakePage:
    """Just enough of a pymupdf page for extract_page_text: lines of characters."""

    rotation_matrix = pymupdf.Matrix(1, 0, 0, 1, 0, 0)

    def __init__(self, lines: list[str]) -> None:
        self.lines = lines

    def get_text(self, _kind: str) -> dict:
        blocks = []
        for n, text in enumerate(self.lines):
            chars = [
                {"c": ch, "bbox": (10 + 6 * i, 10 + 14 * n, 15 + 6 * i, 22 + 14 * n)}
                for i, ch in enumerate(text)
            ]
            blocks.append({"type": 0, "lines": [{"dir": (1.0, 0.0), "spans": [{"chars": chars}]}]})
        return {"blocks": blocks}


def build(dbp: DbProject, pages: int = 3) -> None:
    doc = new_doc()
    for n in range(pages):
        vector_page(doc, f"S{n + 1}.1", f"FRAMING PLAN {n + 1}", texts=TEXTS)
    dbp.pdf_path.write_bytes(doc.tobytes())
    doc.close()
    dbp.scan()


def args(dbp: DbProject) -> tuple:
    return (dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)


def sources(dbp: DbProject) -> list[str | None]:
    rows = dbp.conn.execute(
        "SELECT text_source FROM sheets WHERE project_id = %s ORDER BY page_index",
        (dbp.project_id,),
    ).fetchall()
    return [r["text_source"] for r in rows]


def count(dbp: DbProject, page_index: int) -> int:
    return len([i for i in dbp.items() if i["page_index"] == page_index])


def reasons(dbp: DbProject, page_index: int) -> list[str]:
    return dbp.conn.execute(
        "SELECT review_reasons FROM sheets WHERE project_id = %s AND page_index = %s",
        (dbp.project_id, page_index),
    ).fetchone()["review_reasons"]


# --- NUL characters ---


def test_clean_text_removes_nul_and_lone_surrogates() -> None:
    assert clean_text("\x00VARIES") == "VARIES"
    assert clean_text("A\x00B\ud800C") == "AB�C"
    assert clean_text("plain") == "plain"


def test_extracted_items_have_no_nul_and_keep_the_unprintable_flag() -> None:
    page = FakePage(["\x00VARIES", 'EQUAL SPACING @ 10" MIN', "\x00"])
    got = extract_page_text(page)  # type: ignore[arg-type]
    assert got.items and all("\x00" not in it.text for it in got.items)
    line = next(it for it in got.items if it.level == "line" and "VARIES" in it.text)
    assert line.text == "VARIES" and line.unprintable == 1  # still flagged
    word = next(it for it in got.items if it.level == "word" and it.text == "VARIES")
    assert word.unprintable == 1
    assert not any(it.text == "" for it in got.items)  # a NUL-only word or line is dropped
    assert got.quality is not None and got.quality < 1.0  # the NUL still lowers the quality


def test_a_page_with_nul_text_is_saved_clean(
    dbp: DbProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    build(dbp)
    real = text_job.extract_page_text
    fake = FakePage(
        ["\x00VARIES", 'EQUAL SPACING @ 10" MIN TO 14" MAX', "BEAM SCHEDULE NOTES FOR THE PLAN"]
    )

    def with_nul(page, catalog):  # type: ignore[no-untyped-def]
        return extract_page_text(fake) if page.number == 1 else real(page, catalog)  # type: ignore[arg-type]

    monkeypatch.setattr(text_job, "extract_page_text", with_nul)
    result = read_project(*args(dbp))
    assert result["pages_read"] == 3 and "page_failures" not in result
    assert sources(dbp) == ["pdf_text"] * 3
    texts = [i["text"] for i in dbp.items() if i["page_index"] == 1]
    assert "VARIES" in texts and all("\x00" not in t for t in texts)
    varies = next(i for i in dbp.items() if i["page_index"] == 1 and i["text"] == "VARIES")
    assert varies["unknown_count"] == 1  # the unprintable flag is kept


# --- one bad page ---


def test_a_page_that_throws_loses_only_itself(
    dbp: DbProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    build(dbp)
    real = text_job.extract_page_text

    def boom(page, catalog):  # type: ignore[no-untyped-def]
        if page.number == 1:
            raise RuntimeError("broken font")
        return real(page, catalog)

    monkeypatch.setattr(text_job, "extract_page_text", boom)
    result = read_project(*args(dbp))
    assert result["pages_read"] == 2 and result["pages_failed"] == 1
    assert result["page_failures"] == ["page 2: reading text: RuntimeError: broken font"]
    assert sources(dbp) == ["pdf_text", "none", "pdf_text"]
    assert count(dbp, 0) > 0 and count(dbp, 1) == 0 and count(dbp, 2) > 0
    assert reasons(dbp, 1) == ["text_read_failed: page 2: reading text: RuntimeError: broken font"]
    assert reasons(dbp, 0) == [] and reasons(dbp, 2) == []
    flagged = dbp.conn.execute(
        "SELECT needs_review FROM sheets WHERE project_id = %s AND page_index = 1",
        (dbp.project_id,),
    ).fetchone()
    assert flagged["needs_review"]

    # read again once it works: the problem is gone and the page has its text
    monkeypatch.setattr(text_job, "extract_page_text", real)
    again = read_project(*args(dbp))
    assert again["pages_read"] == 3 and "page_failures" not in again
    assert sources(dbp) == ["pdf_text"] * 3 and count(dbp, 1) > 0
    assert reasons(dbp, 1) == []


def test_a_page_that_fails_while_saving_is_rolled_back_on_its_own(
    dbp: DbProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    build(dbp)
    real = text_job.legend_rows
    calls = {"n": 0}

    def fail_second(words):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        if calls["n"] == 2:
            raise ValueError("saving went wrong\nDETAIL: page text must not be stored")
        return real(words)

    monkeypatch.setattr(text_job, "legend_rows", fail_second)
    result = read_project(*args(dbp))
    assert result["page_failures"] == ["page 2: saving text: ValueError: saving went wrong"]
    assert sources(dbp) == ["pdf_text", "none", "pdf_text"]
    assert count(dbp, 1) == 0  # its items were inserted before the error and rolled back
    assert count(dbp, 0) > 0 and count(dbp, 2) > 0


def test_every_page_failing_raises_a_message_naming_the_pages(
    dbp: DbProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    build(dbp)

    def boom(page, catalog):  # type: ignore[no-untyped-def]
        raise RuntimeError("no fonts")

    monkeypatch.setattr(text_job, "extract_page_text", boom)
    with pytest.raises(ReadError) as err:
        read_project(*args(dbp))
    assert "no page could be read: page 1: reading text: RuntimeError: no fonts" in str(err.value)
    assert "page 3:" in str(err.value)


def test_auto_run_reports_page_failures_and_still_queues_the_build(
    dbp: DbProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    build(dbp)
    real = text_job.extract_page_text

    def boom(page, catalog):  # type: ignore[no-untyped-def]
        if page.number == 2:
            raise RuntimeError("bad page")
        return real(page, catalog)

    monkeypatch.setattr(text_job, "extract_page_text", boom)
    result = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert result["pages_read"] == 2 and result["pages_failed"] == 1
    assert result["page_failures"] == ["page 3: reading text: RuntimeError: bad page"]
    assert result["auto_build_queued"] == 1


def test_auto_run_error_names_the_step_and_the_page(
    dbp: DbProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    build(dbp, pages=1)

    def boom(page, catalog):  # type: ignore[no-untyped-def]
        raise RuntimeError("oops")

    monkeypatch.setattr(text_job, "extract_page_text", boom)
    with pytest.raises(ReadError) as err:
        auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert str(err.value).startswith("auto run, step read text: no page could be read: page 1:")

    def missing(*_a, **_k):  # type: ignore[no-untyped-def]
        raise KeyError("x")

    monkeypatch.setattr(text_job, "load_entries", missing)
    with pytest.raises(ReadError) as other:
        auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert str(other.value) == "auto run, step read text: KeyError: 'x'"
