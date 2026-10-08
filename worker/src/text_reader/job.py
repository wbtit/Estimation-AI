"""The `read_text` job: read the text of every vector sheet of a project and store text items.

Payload: {"project_id": "<uuid>", "document_id": "<uuid>", "font_id": "<optional>",
"catalog_edition": "<optional>"}.
Per page, one reader and never both: a page with a real, usable PDF text layer is read from it
(method `pdf_text`); any other vector page goes to the glyph reader (confirmed labels only). The
choice and the text quality are stored on the sheet (`text_source`, `text_quality`).
Rebuilds the project's text_items in one transaction and records glyph usage (new shapes become
`proposed` library entries; labels and statuses are never touched here). Logs counts only.
"""

import logging
from collections import Counter
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.queue import Job
from src.text_layer.catalog import load_catalog
from src.text_layer.items import PageText, extract_page_text, pdf_item_key
from src.text_layer.quality import GARBLED_BELOW
from src.text_reader.library import Entry, Matcher, load_entries
from src.text_reader.ocr import OcrEngine, RapidOcrEngine
from src.text_reader.reader import item_key, read_page

log = logging.getLogger("worker.text")

JOB_TYPE = "read_text"

_DELETE_ITEMS = (
    "DELETE FROM text_items WHERE sheet_id IN (SELECT id FROM sheets WHERE project_id = %s)"
)
_INSERT_ITEM = """
INSERT INTO text_items (sheet_id, item_key, x0, y0, x1, y1, orientation, text, ocr_text, methods,
                        confidence, agree, needs_review, review_reasons, char_count, unknown_count,
                        font_id)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (sheet_id, item_key) DO NOTHING
"""
_INSERT_PDF_ITEM = """
INSERT INTO text_items (sheet_id, item_key, x0, y0, x1, y1, orientation, text, methods, confidence,
                        needs_review, review_reasons, char_count, unknown_count, font_id,
                        angle_deg, level, parsed)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, ARRAY['pdf_text'], %s, %s, %s, %s, %s, 'pdf_text',
        %s, %s, %s)
ON CONFLICT (sheet_id, item_key) DO NOTHING
"""
_SET_SOURCE = "UPDATE sheets SET text_source = %s, text_quality = %s WHERE id = %s"
_UPSERT_GLYPH = """
INSERT INTO glyph_library (font_id, signature_hash, strokes, seen_count) VALUES (%s, %s, %s, %s)
ON CONFLICT (font_id, signature_hash)
DO UPDATE SET seen_count = glyph_library.seen_count + EXCLUDED.seen_count
"""


class ReadError(Exception):
    """A read failure with a message that is safe to store (no page text)."""


def run_read_text(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    project_id = str(job.payload.get("project_id", ""))
    document_id = str(job.payload.get("document_id", ""))
    font_id = str(job.payload.get("font_id") or config.glyph_font_id)
    edition = job.payload.get("catalog_edition")
    ocr: OcrEngine | None = RapidOcrEngine() if config.ocr_crosscheck_enabled else None
    return read_project(
        conn, config, project_id, document_id, font_id, ocr, str(edition) if edition else None
    )


def read_project(
    conn: psycopg.Connection,
    config: WorkerConfig,
    project_id: str,
    document_id: str,
    font_id: str,
    ocr: OcrEngine | None = None,
    catalog_edition: str | None = None,
) -> dict[str, Any]:
    rows = conn.execute(
        "SELECT s.id, s.page_index, s.page_kind, s.has_text_layer, f.stored_path FROM sheets s"
        " JOIN project_files f ON f.project_id = s.project_id"
        " WHERE s.project_id = %s AND f.id = %s ORDER BY s.page_index",
        (project_id, document_id),
    ).fetchall()
    if not rows:
        raise ReadError("no scanned sheets for this document; run the scan first")
    pdf_path = config.upload_dir / rows[0]["stored_path"]
    if not pdf_path.is_file():
        raise ReadError("stored PDF is missing")
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as err:
        raise ReadError("PDF could not be opened") from err

    entries = load_entries(conn, font_id)
    matcher = Matcher(entries)
    by_hash: dict[str, Entry] = {e.signature_hash: e for e in entries}
    usage: Counter = Counter()
    totals: Counter = Counter()
    catalog, _catalog_note = load_catalog(conn, catalog_edition)
    sheet_items: list[tuple[str, Any]] = []
    pdf_pages: list[tuple[str, PageText]] = []
    sources: list[tuple[str, str, float | None]] = []  # sheet id, text_source, text_quality
    with doc:
        for row in rows:
            sheet_id = str(row["id"])
            if row["page_kind"] != "vector":
                totals["pages_skipped"] += 1
                sources.append((sheet_id, "none", None))
                continue
            page = doc[row["page_index"]]
            page_text = extract_page_text(page, catalog) if row["has_text_layer"] else None
            if page_text is not None and page_text.usable:
                pdf_pages.append((sheet_id, page_text))
                sources.append((sheet_id, "pdf_text", page_text.quality))
                totals["pages_read"] += 1
                totals["pages_pdf_text"] += 1
                log.info("read page %s from the text layer: %s items", row["page_index"] + 1,
                         len(page_text.items))  # fmt: skip
                continue
            if page_text is not None:
                totals["pages_garbled_text_layer"] += 1
            read = read_page(page, matcher, font_id, usage, by_hash, ocr)
            sheet_items.append((sheet_id, read.items))
            sources.append((sheet_id, "glyph", page_text.quality if page_text else None))
            totals["pages_read"] += 1
            totals["pages_glyph"] += 1
            totals.update(read.stats)
            log.info("read page %s: %s lines", row["page_index"] + 1, len(read.items))

    with conn.cursor() as cur:
        cur.execute(_DELETE_ITEMS, (project_id,))
        for sheet_id, items in sheet_items:
            for it in items:
                cur.execute(
                    _INSERT_ITEM,
                    (
                        sheet_id, item_key(sheet_id, it.bbox), it.x0, it.y0, it.x1, it.y1,
                        it.orientation, it.text, it.ocr_text, it.methods, it.confidence, it.agree,
                        it.needs_review, it.review_reasons, it.char_count,
                        it.unknown_count, font_id,
                    ),
                )  # fmt: skip
        for sheet_id, page_text in pdf_pages:
            for it in page_text.items:
                suspect = it.quality < GARBLED_BELOW
                cur.execute(
                    _INSERT_PDF_ITEM,
                    (
                        sheet_id, pdf_item_key(sheet_id, it.level, it.bbox), *it.bbox,
                        it.orientation, it.text, it.quality, suspect,
                        ["text_encoding_suspect"] if suspect else [],
                        len("".join(it.text.split())), it.unprintable,
                        it.angle_deg, it.level, Jsonb(it.parsed) if it.parsed else None,
                    ),
                )  # fmt: skip
        for sheet_id, source, quality in sources:
            cur.execute(_SET_SOURCE, (source, quality, sheet_id))
        for h, n in sorted(usage.items()):
            strokes = Jsonb([[list(p) for p in s] for s in by_hash[h].strokes])
            cur.execute(_UPSERT_GLYPH, (font_id, h, strokes, n))
    conn.commit()
    return {k: int(v) for k, v in sorted(totals.items())}
