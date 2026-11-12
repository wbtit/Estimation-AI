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
from dataclasses import dataclass, field
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.review.legend import WordBox, legend_rows
from src.text_layer.catalog import load_catalog
from src.text_layer.items import PageText, extract_page_text, pdf_item_key
from src.text_layer.quality import GARBLED_BELOW
from src.text_reader.library import Entry, Matcher, load_entries
from src.text_reader.ocr import OcrEngine
from src.text_reader.reader import item_key, read_page

log = logging.getLogger("worker.text")


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
_DELETE_LEGEND = "DELETE FROM legend_rows WHERE project_id = %s"
_INSERT_LEGEND = """
INSERT INTO legend_rows (project_id, sheet_id, mark, designation_raw, profile, remarks_raw, source)
VALUES (%s, %s, %s, %s, %s, %s, %s)
"""
_CLEAR_READ_PROBLEMS = """
UPDATE sheets SET review_reasons = ARRAY(SELECT r FROM unnest(review_reasons) AS r
                                          WHERE r NOT LIKE 'text_read_failed: %%'),
                  needs_review = needs_review AND EXISTS (
                      SELECT 1 FROM unnest(review_reasons) AS r
                      WHERE r NOT LIKE 'text_read_failed: %%')
WHERE project_id = %s AND review_reasons::text LIKE '%%text_read_failed: %%'
"""
_MARK_READ_PROBLEM = (
    "UPDATE sheets SET needs_review = true,"
    " review_reasons = array_append(review_reasons, 'text_read_failed: ' || %s) WHERE id = %s"
)
_SET_SOURCE = "UPDATE sheets SET text_source = %s, text_quality = %s WHERE id = %s"
_UPSERT_GLYPH = """
INSERT INTO glyph_library (font_id, signature_hash, strokes, seen_count) VALUES (%s, %s, %s, %s)
ON CONFLICT (font_id, signature_hash)
DO UPDATE SET seen_count = glyph_library.seen_count + EXCLUDED.seen_count
"""


class ReadError(Exception):
    """A read failure with a message that is safe to store (no page text)."""


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
    failures: dict[str, tuple[int, str]] = {}  # sheet id -> (page number, "step: reason")
    reads: list[_PageRead] = []
    with doc:
        for row in rows:
            sheet_id = str(row["id"])
            number = int(row["page_index"]) + 1
            if row["page_kind"] != "vector":
                totals["pages_skipped"] += 1
                reads.append(_PageRead(sheet_id, number, "none", None))
                continue
            page_usage: Counter = Counter()
            page_stats: Counter = Counter()
            try:
                page = doc[row["page_index"]]
                page_text = extract_page_text(page, catalog) if row["has_text_layer"] else None
                if page_text is not None and page_text.usable:
                    reads.append(_PageRead(sheet_id, number, "pdf_text", page_text.quality,
                                           pdf=page_text))  # fmt: skip
                    page_stats["pages_pdf_text"] += 1
                    log.info("read page %s from the text layer: %s items", number,
                             len(page_text.items))  # fmt: skip
                else:
                    if page_text is not None:
                        page_stats["pages_garbled_text_layer"] += 1
                    read = read_page(page, matcher, font_id, page_usage, by_hash, ocr)
                    reads.append(_PageRead(sheet_id, number, "glyph",
                                           page_text.quality if page_text else None,
                                           glyph=read.items, usage=page_usage))  # fmt: skip
                    page_stats["pages_glyph"] += 1
                    page_stats.update(read.stats)
                    log.info("read page %s: %s lines", number, len(read.items))
            except Exception as err:  # one bad page must not lose the others
                log.warning("page %s: reading text failed (%s)", number, type(err).__name__)
                failures[sheet_id] = (number, f"reading text: {reason_of(err)}")
                reads.append(_PageRead(sheet_id, number, "none", None))
                continue
            reads[-1].stats = page_stats

    vector_pages = sum(1 for r in reads if r.source != "none") + len(failures)
    with conn.cursor() as cur:
        cur.execute(_DELETE_ITEMS, (project_id,))
        cur.execute(_DELETE_LEGEND, (project_id,))
        cur.execute(_CLEAR_READ_PROBLEMS, (project_id,))
    for r in reads:
        if r.sheet_id in failures:
            _set_source(conn, r)
            continue
        try:
            with conn.transaction():  # a savepoint: a failing page is rolled back on its own
                _save_page(conn, project_id, r, font_id)
        except Exception as err:
            log.warning("page %s: saving text failed (%s)", r.number, type(err).__name__)
            failures[r.sheet_id] = (r.number, f"saving text: {reason_of(err)}")
            r.source, r.quality, r.stats = "none", None, Counter()
            _set_source(conn, r)
            continue
        if r.source != "none":
            totals["pages_read"] += 1
        totals.update(r.stats)
        usage.update(r.usage)
    with conn.cursor() as cur:
        for sheet_id, (number, message) in failures.items():
            cur.execute(_MARK_READ_PROBLEM, (f"page {number}: {message}", sheet_id))
        for h, n in sorted(usage.items()):
            strokes = Jsonb([[list(p) for p in st] for st in by_hash[h].strokes])
            cur.execute(_UPSERT_GLYPH, (font_id, h, strokes, n))
    conn.commit()
    result: dict[str, Any] = {k: int(v) for k, v in sorted(totals.items())}
    if failures:
        ordered = sorted(failures.values())
        result["pages_failed"] = len(ordered)
        result["page_failures"] = [f"page {n}: {m}" for n, m in ordered]
        if vector_pages and len(failures) >= vector_pages:
            shown = "; ".join(result["page_failures"][:3])
            more = f" (+{len(ordered) - 3} more)" if len(ordered) > 3 else ""
            raise ReadError(f"no page could be read: {shown}{more}")
    return result


@dataclass
class _PageRead:
    """One page read in memory, saved on its own so a bad page cannot lose the others."""

    sheet_id: str
    number: int
    source: str  # "pdf_text" | "glyph" | "none"
    quality: float | None
    pdf: PageText | None = None
    glyph: list[Any] = field(default_factory=list)
    usage: Counter = field(default_factory=Counter)
    stats: Counter = field(default_factory=Counter)


def reason_of(err: BaseException) -> str:
    """A reason safe to store: the error type and its first line only (never page text)."""
    first = (str(err).splitlines() or [""])[0].strip()[:200]
    return f"{type(err).__name__}: {first}" if first else type(err).__name__


def _set_source(conn: psycopg.Connection, r: _PageRead) -> None:
    conn.execute(_SET_SOURCE, (r.source, r.quality, r.sheet_id))


def _save_page(conn: psycopg.Connection, project_id: str, r: _PageRead, font_id: str) -> None:
    with conn.cursor() as cur:
        for it in r.glyph:
            cur.execute(
                _INSERT_ITEM,
                (
                    r.sheet_id, item_key(r.sheet_id, it.bbox), it.x0, it.y0, it.x1, it.y1,
                    it.orientation, it.text, it.ocr_text, it.methods, it.confidence, it.agree,
                    it.needs_review, it.review_reasons, it.char_count,
                    it.unknown_count, font_id,
                ),
            )  # fmt: skip
        if r.pdf is not None:
            for it in r.pdf.items:
                suspect = it.quality < GARBLED_BELOW
                cur.execute(
                    _INSERT_PDF_ITEM,
                    (
                        r.sheet_id, pdf_item_key(r.sheet_id, it.level, it.bbox), *it.bbox,
                        it.orientation, it.text, it.quality, suspect,
                        ["text_encoding_suspect"] if suspect else [],
                        len("".join(it.text.split())), it.unprintable,
                        it.angle_deg, it.level, Jsonb(it.parsed) if it.parsed else None,
                    ),
                )  # fmt: skip
            words = [WordBox(it.text, *it.bbox) for it in r.pdf.items if it.level == "word"]
            for row in legend_rows(words):
                cur.execute(
                    _INSERT_LEGEND,
                    (
                        project_id, r.sheet_id, row.mark, row.designation_raw, row.profile,
                        row.remarks_raw, Jsonb({"bbox": list(row.bbox)}),
                    ),
                )  # fmt: skip
                r.stats["legend_rows"] += 1
        cur.execute(_SET_SOURCE, (r.source, r.quality, r.sheet_id))
