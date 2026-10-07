"""scan_pdf job against the real Postgres (run `make up` and `make migrate` first).

PDFs are synthetic and built here. Each test creates its own project and removes it afterwards.
"""

import logging
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import psycopg
import pymupdf
import pytest
from pdf_factory import new_doc, scanned_page, vector_page

from src.config import WorkerConfig, load_config
from src.db import connect
from src.pdf_scan.job import ScanError, run_scan_pdf
from src.queue import Job

SCALE_18 = '1/8" = 1\'-0"'
SCALE_14 = '1/4" = 1\'-0"'
SECRET_TITLE = "TRELLIS FRAMING PLAN"


@dataclass
class Setup:
    conn: psycopg.Connection
    config: WorkerConfig
    project_id: str
    document_id: str
    pdf_path: Path

    def job(self, attempts: int = 1, max_attempts: int = 3) -> Job:
        return Job(
            id=str(uuid.uuid4()),
            type="scan_pdf",
            payload={"project_id": self.project_id, "document_id": self.document_id},
            attempts=attempts,
            max_attempts=max_attempts,
        )

    def sheets(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM sheets WHERE project_id = %s ORDER BY page_index", (self.project_id,)
        ).fetchall()
        return list(rows)


@pytest.fixture
def setup(tmp_path: Path) -> Iterator[Setup]:
    base = load_config()
    config = WorkerConfig(
        database_url=base.database_url,
        poll_interval_seconds=base.poll_interval_seconds,
        lock_timeout_seconds=base.lock_timeout_seconds,
        worker_id="test-worker",
        upload_dir=tmp_path,
    )
    with connect(config.database_url) as conn:
        project_id = str(
            conn.execute(
                "INSERT INTO projects (name, status) VALUES (%s, 'scanning') RETURNING id",
                (f"test-project-{uuid.uuid4()}",),
            ).fetchone()["id"]
        )
        relative = f"{project_id}/source.pdf"
        document_id = str(
            conn.execute(
                "INSERT INTO project_files (project_id, original_filename, stored_path, sha256,"
                " size_bytes) VALUES (%s, 'job-001.pdf', %s, %s, 1) RETURNING id",
                (project_id, relative, "0" * 64),
            ).fetchone()["id"]
        )
        conn.commit()
        pdf_path = tmp_path / relative
        pdf_path.parent.mkdir(parents=True)
        yield Setup(conn, config, project_id, document_id, pdf_path)
        conn.rollback()
        conn.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        conn.commit()


def write_sample_pdf(path: Path) -> None:
    doc = new_doc()
    vector_page(doc, "S030", SECRET_TITLE, texts=[((60, 500), SCALE_18, 14)])  # page 1
    vector_page(  # page 2: details, two scales
        doc,
        "S4.1",
        "TYPICAL DETAILS",
        texts=[((60, 500), SCALE_14, 12), ((400, 500), SCALE_18, 12)],
    )
    scanned_page(doc)  # page 3
    vector_page(doc)  # page 4: vector drawing, no text layer
    vector_page(doc, "S030", "GENERAL NOTES", texts=[((60, 500), "NTS", 12)])  # page 5: duplicate
    doc.save(str(path))
    doc.close()


def test_scan_stores_one_sheet_per_page_with_results(setup: Setup) -> None:
    write_sample_pdf(setup.pdf_path)
    result = run_scan_pdf(setup.conn, setup.job(), setup.config)
    # every page needs review: p1 and p5 share a sheet number, p2 has several scales, p3 is
    # scanned, p4 has no text layer
    assert result == {"pages": 5, "vector": 4, "scanned": 1, "unknown": 0, "needs_review": 5}

    rows = setup.sheets()
    assert [r["page_index"] for r in rows] == [0, 1, 2, 3, 4]
    p1, p2, p3, p4, p5 = rows

    assert (p1["sheet_number"], p1["kind"], float(p1["kind_confidence"])) == ("S030", "plan", 0.9)
    assert p1["title"] == SECRET_TITLE and p1["sheet_number_source"] == "label"
    assert (p1["scale_parsed"], float(p1["scale_parsed_ratio"]), p1["scale_source"]) == (
        SCALE_18,
        96.0,
        "pdf_text",
    )
    assert p1["page_kind"] == "vector" and p1["has_text_layer"] and p1["has_vector_paths"]
    assert (float(p1["width_pt"]), float(p1["height_pt"]), p1["rotation"]) == (1200.0, 800.0, 0)
    assert "duplicate_sheet_number" in p1["review_reasons"]  # page 5 has the same number

    assert (p2["sheet_number"], p2["kind"]) == ("S4.1", "detail")
    assert [(e["ratio"], e["count"]) for e in p2["scales"]] == [(48.0, 1), (96.0, 1)]
    assert p2["scale_parsed"] is None and p2["review_reasons"] == ["multiple_scales"]
    assert p2["needs_review"]

    assert p3["page_kind"] == "scanned" and p3["review_reasons"] == ["scanned_unsupported_v0"]
    assert p3["sheet_number"] is None

    assert p4["page_kind"] == "vector" and not p4["has_text_layer"]
    assert "no_text_layer" in p4["review_reasons"] and p4["sheet_number"] is None

    assert (p5["sheet_number"], p5["kind"], p5["scale_parsed"]) == ("S030", "notes", "NTS")
    assert "duplicate_sheet_number" in p5["review_reasons"]


def test_scan_writes_thumbnails_and_progress_and_project_status(setup: Setup) -> None:
    write_sample_pdf(setup.pdf_path)
    run_scan_pdf(setup.conn, setup.job(), setup.config)

    for row in setup.sheets():
        thumb = setup.config.upload_dir / row["thumbnail_path"]
        assert thumb.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    document = setup.conn.execute(
        "SELECT page_count, pages_scanned, scan_status, scan_error"
        " FROM project_files WHERE id = %s",
        (setup.document_id,),
    ).fetchone()
    assert document == {
        "page_count": 5,
        "pages_scanned": 5,
        "scan_status": "done",
        "scan_error": None,
    }
    status = setup.conn.execute("SELECT status FROM projects WHERE id = %s", (setup.project_id,))
    assert status.fetchone()["status"] == "scanned"


def test_rescan_updates_in_place_and_keeps_user_overrides_and_history(setup: Setup) -> None:
    write_sample_pdf(setup.pdf_path)
    run_scan_pdf(setup.conn, setup.job(), setup.config)
    page2 = setup.sheets()[1]

    setup.conn.execute(
        "UPDATE sheets SET scale_override = %s, scale_override_ratio = 48, scale_source = 'manual'"
        " WHERE id = %s",
        (SCALE_14, page2["id"]),
    )
    setup.conn.execute(
        "INSERT INTO sheet_edits (sheet_id, field_name, original_value, corrected_value, editor)"
        " VALUES (%s, 'scale_override', 'null', %s, 'tester')",
        (page2["id"], '"1/4 inch"'),
    )
    setup.conn.commit()

    run_scan_pdf(setup.conn, setup.job(), setup.config)
    rows = setup.sheets()
    assert len(rows) == 5  # upsert, no duplicates
    again = rows[1]
    assert again["id"] == page2["id"]
    assert (again["scale_override"], float(again["scale_override_ratio"])) == (SCALE_14, 48.0)
    assert again["scale_source"] == "manual"
    assert again["scale_parsed"] is None  # the extracted value is unchanged
    edits = setup.conn.execute(
        "SELECT count(*) AS n FROM sheet_edits WHERE sheet_id = %s", (page2["id"],)
    )
    assert edits.fetchone()["n"] == 1


def test_scan_logs_counts_only_never_page_text(
    setup: Setup, caplog: pytest.LogCaptureFixture
) -> None:
    write_sample_pdf(setup.pdf_path)
    with caplog.at_level(logging.DEBUG):
        run_scan_pdf(setup.conn, setup.job(), setup.config)
    assert caplog.records
    for record in caplog.records:
        assert SECRET_TITLE not in record.getMessage()
        assert "TYPICAL DETAILS" not in record.getMessage()


def failed_state(setup: Setup) -> tuple[str, str | None, str]:
    document = setup.conn.execute(
        "SELECT scan_status, scan_error FROM project_files WHERE id = %s", (setup.document_id,)
    ).fetchone()
    project = setup.conn.execute("SELECT status FROM projects WHERE id = %s", (setup.project_id,))
    return document["scan_status"], document["scan_error"], project.fetchone()["status"]


def test_missing_file_fails_only_after_the_last_attempt(setup: Setup) -> None:
    with pytest.raises(ScanError, match="stored PDF is missing"):
        run_scan_pdf(setup.conn, setup.job(attempts=1, max_attempts=3), setup.config)
    assert failed_state(setup) == ("scanning", None, "scanning")  # will be retried

    with pytest.raises(ScanError):
        run_scan_pdf(setup.conn, setup.job(attempts=3, max_attempts=3), setup.config)
    assert failed_state(setup) == ("failed", "stored PDF is missing", "scan_failed")


def test_corrupt_and_encrypted_pdfs_fail_with_safe_messages(setup: Setup) -> None:
    setup.pdf_path.write_bytes(b"%PDF-1.4\nthis is not a real pdf\n")
    with pytest.raises(ScanError, match="could not be opened"):
        run_scan_pdf(setup.conn, setup.job(attempts=3), setup.config)
    assert failed_state(setup)[1] == "PDF could not be opened"

    doc = new_doc()
    vector_page(doc, "S030", "TITLE")
    doc.save(
        str(setup.pdf_path), encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="pw"
    )
    doc.close()
    with pytest.raises(ScanError, match="encrypted"):
        run_scan_pdf(setup.conn, setup.job(attempts=3), setup.config)
    assert failed_state(setup) == ("failed", "PDF is encrypted", "scan_failed")


def test_unknown_document_is_an_error(setup: Setup) -> None:
    job = Job(
        id="j",
        type="scan_pdf",
        payload={"project_id": setup.project_id, "document_id": str(uuid.uuid4())},
        attempts=1,
        max_attempts=3,
    )
    with pytest.raises(ScanError, match="document not found"):
        run_scan_pdf(setup.conn, job, setup.config)
