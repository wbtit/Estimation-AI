"""Shared helpers for tests that use the real Postgres (run `make up` and `make migrate`)."""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import psycopg
import pytest
from pdf_factory import add_lines

from src.config import WorkerConfig, load_config
from src.db import connect
from src.pdf_scan.job import run_scan_pdf
from src.queue import Job


@dataclass
class DbProject:
    conn: psycopg.Connection
    config: WorkerConfig
    project_id: str
    document_id: str
    pdf_path: Path
    font_id: str

    def job(self, attempts: int = 1) -> Job:
        return Job(
            id=str(uuid.uuid4()),
            type="x",
            payload={
                "project_id": self.project_id,
                "document_id": self.document_id,
                "font_id": self.font_id,
            },
            attempts=attempts,
            max_attempts=3,
        )

    def scan(self) -> None:
        run_scan_pdf(self.conn, self.job(), self.config)

    def items(self) -> list[dict]:
        return list(
            self.conn.execute(
                "SELECT t.*, s.page_index FROM text_items t JOIN sheets s ON s.id = t.sheet_id"
                " WHERE s.project_id = %s ORDER BY s.page_index, t.y0, t.x0",
                (self.project_id,),
            ).fetchall()
        )

    def library(self) -> list[dict]:
        return list(
            self.conn.execute(
                "SELECT * FROM glyph_library WHERE font_id = %s"
                " ORDER BY seen_count DESC, signature_hash",
                (self.font_id,),
            ).fetchall()
        )


def make_db_project(tmp_path: Path) -> Iterator[DbProject]:
    base = load_config()
    config = WorkerConfig(
        database_url=base.database_url,
        poll_interval_seconds=base.poll_interval_seconds,
        lock_timeout_seconds=base.lock_timeout_seconds,
        worker_id="test-worker",
        upload_dir=tmp_path,
    )
    font_id = f"test-font-{uuid.uuid4()}"
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
        yield DbProject(conn, config, project_id, document_id, pdf_path, font_id)
        conn.rollback()
        conn.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        conn.execute("DELETE FROM glyph_library WHERE font_id = %s", (font_id,))
        conn.commit()


@pytest.fixture
def dbp(tmp_path: Path) -> Iterator[DbProject]:
    yield from make_db_project(tmp_path)


def vector_text_page(doc, width: float = 1200, height: float = 800):
    """A page with enough long thin lines to count as a vector drawing (the reader ignores them)."""
    page = doc.new_page(width=width, height=height)
    add_lines(page)
    return page


def confirm_by_font(dbp: DbProject, skip: str = "") -> dict[str, str]:
    """Act as the person who reviews the groups: label each library group with the font character
    it matches, and confirm it. `skip` leaves those characters unlabeled. Returns {hash: label}."""
    from stroke_font import GLYPHS, LIBRARY_LABELS

    from src.text_reader.geometry import CHAMFER_TOL, HAUSDORFF_TOL, describe, distances

    refs = {ch: describe(GLYPHS[ch]) for ch in LIBRARY_LABELS}
    labels: dict[str, str] = {}
    for row in dbp.library():
        d = describe([[(x, y) for x, y in s] for s in row["strokes"]])
        for ch, ref in refs.items():
            c, h = distances(ref.points[None], d.points)
            if c[0] <= CHAMFER_TOL and h[0] <= HAUSDORFF_TOL and ch not in skip:
                dbp.conn.execute(
                    "UPDATE glyph_library SET label = %s, status = 'confirmed',"
                    " source = 'csv_import', reviewed_by = 'tester', reviewed_at = NOW()"
                    " WHERE id = %s",
                    (ch, row["id"]),
                )
                labels[row["signature_hash"]] = ch
                break
    dbp.conn.commit()
    return labels
