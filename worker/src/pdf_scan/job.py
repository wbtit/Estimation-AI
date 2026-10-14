"""The `scan_pdf` job: scan an uploaded PDF page by page and store the results.

Payload: {"project_id": "<uuid>", "document_id": "<uuid>"} (a project_files row).
Writes: thumbnails under UPLOAD_DIR/<project>/thumbs/, one sheets row per page (upserted on
(project_id, page_index), so a re-scan never touches user overrides or edit history),
project_files progress, and the project status (scanning -> scanned | scan_failed).
Logs counts only, never page text (titles can contain client names).
"""

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.pdf_scan.analyze import PageScan, analyze_page, render_thumbnail_png
from src.queue import Job

log = logging.getLogger("worker.scan")

JOB_TYPE = "scan_pdf"


class ScanError(Exception):
    """A scan failure with a message that is safe to store and show (no page text)."""


_UPSERT_SHEET = """
INSERT INTO sheets (
    project_id, page_index, sheet_number, title, kind, kind_confidence, kind_reason,
    width_pt, height_pt, rotation, page_kind, has_text_layer, has_vector_paths,
    text_char_count, vector_path_count, image_count, image_coverage, sheet_number_source,
    scales, scale_parsed, scale_parsed_ratio, scale_source, needs_review, review_reasons,
    thumbnail_path, text_quality, scan_evidence, page_type_guess, page_type_reason, level_guess,
    plan_frame, sheet_number_old, sheet_number_old_source, sheet_number_flag, scanned_at
) VALUES (
    %(project_id)s, %(page_index)s, %(sheet_number)s, %(title)s, %(kind)s, %(kind_confidence)s,
    %(kind_reason)s, %(width_pt)s, %(height_pt)s, %(rotation)s, %(page_kind)s,
    %(has_text_layer)s, %(has_vector_paths)s, %(text_char_count)s, %(vector_path_count)s,
    %(image_count)s, %(image_coverage)s, %(sheet_number_source)s, %(scales)s, %(scale_parsed)s,
    %(scale_parsed_ratio)s, %(scale_source)s, %(needs_review)s, %(review_reasons)s,
    %(thumbnail_path)s, %(text_quality)s, %(scan_evidence)s, %(page_type_guess)s,
    %(page_type_reason)s, %(level_guess)s, %(plan_frame)s, %(sheet_number_old)s,
    %(sheet_number_old_source)s, %(sheet_number_flag)s, NOW()
)
ON CONFLICT (project_id, page_index) DO UPDATE SET
    sheet_number = EXCLUDED.sheet_number, title = EXCLUDED.title, kind = EXCLUDED.kind,
    kind_confidence = EXCLUDED.kind_confidence, kind_reason = EXCLUDED.kind_reason,
    width_pt = EXCLUDED.width_pt, height_pt = EXCLUDED.height_pt, rotation = EXCLUDED.rotation,
    page_kind = EXCLUDED.page_kind, has_text_layer = EXCLUDED.has_text_layer,
    has_vector_paths = EXCLUDED.has_vector_paths, text_char_count = EXCLUDED.text_char_count,
    vector_path_count = EXCLUDED.vector_path_count, image_count = EXCLUDED.image_count,
    image_coverage = EXCLUDED.image_coverage, sheet_number_source = EXCLUDED.sheet_number_source,
    scales = EXCLUDED.scales, scale_parsed = EXCLUDED.scale_parsed,
    scale_parsed_ratio = EXCLUDED.scale_parsed_ratio,
    -- a manual override stays the effective scale source; scale_override* is never written here
    scale_source = CASE WHEN sheets.scale_override IS NOT NULL THEN 'manual'
                        ELSE EXCLUDED.scale_source END,
    needs_review = EXCLUDED.needs_review, review_reasons = EXCLUDED.review_reasons,
    thumbnail_path = EXCLUDED.thumbnail_path, text_quality = EXCLUDED.text_quality,
    scan_evidence = EXCLUDED.scan_evidence, page_type_guess = EXCLUDED.page_type_guess,
    page_type_reason = EXCLUDED.page_type_reason, level_guess = EXCLUDED.level_guess,
    plan_frame = EXCLUDED.plan_frame, sheet_number_old = EXCLUDED.sheet_number_old,
    sheet_number_old_source = EXCLUDED.sheet_number_old_source,
    sheet_number_flag = EXCLUDED.sheet_number_flag, scanned_at = NOW()
"""


def _with_duplicate_flags(scans: list[PageScan]) -> None:
    """Flag every page whose sheet number also appears on another page."""
    counts: dict[str, int] = {}
    for s in scans:
        if s.sheet_number:
            counts[s.sheet_number] = counts.get(s.sheet_number, 0) + 1
    for s in scans:
        if s.sheet_number and counts[s.sheet_number] > 1:
            s.review_reasons = [*s.review_reasons, "duplicate_sheet_number"]


def _row(project_id: str, scan: PageScan, thumbnail_path: str) -> dict[str, Any]:
    values = asdict(scan)
    values.update(
        project_id=project_id,
        scales=Jsonb(scan.scales),
        scale_source="pdf_text" if scan.scale_parsed else None,
        needs_review=scan.needs_review,
        thumbnail_path=thumbnail_path,
        scan_evidence=Jsonb(scan.evidence) if scan.evidence else None,
        plan_frame=Jsonb(
            {"width_pt": scan.width_pt, "height_pt": scan.height_pt, "rotation": scan.rotation}
        ),
    )
    return values


def _mark_failed(conn: psycopg.Connection, project_id: str, document_id: str, message: str) -> None:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE project_files SET scan_status = 'failed', scan_error = %s WHERE id = %s",
            (message[:500], document_id),
        )
        cur.execute("UPDATE projects SET status = 'scan_failed' WHERE id = %s", (project_id,))
    conn.commit()


def run_scan_pdf(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    project_id = str(job.payload.get("project_id", ""))
    document_id = str(job.payload.get("document_id", ""))
    try:
        return _scan(conn, project_id, document_id, config, bool(job.payload.get("auto_run")))
    except Exception as err:
        # Only after the last allowed attempt does the scan count as failed for the user.
        if job.attempts >= job.max_attempts:
            message = (
                str(err) if isinstance(err, ScanError) else f"scan failed ({type(err).__name__})"
            )
            _mark_failed(conn, project_id, document_id, message)
        raise


def _scan(
    conn: psycopg.Connection,
    project_id: str,
    document_id: str,
    config: WorkerConfig,
    auto_run: bool = False,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT stored_path FROM project_files WHERE id = %s AND project_id = %s",
            (document_id, project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise ScanError("document not found")
        cur.execute(
            "UPDATE project_files SET scan_status = 'scanning', scan_error = NULL WHERE id = %s",
            (document_id,),
        )
        cur.execute("UPDATE projects SET status = 'scanning' WHERE id = %s", (project_id,))
    conn.commit()

    pdf_path = config.upload_dir / row["stored_path"]
    if not pdf_path.is_file():
        raise ScanError("stored PDF is missing")
    try:
        doc = pymupdf.open(pdf_path)
    except Exception as err:
        raise ScanError("PDF could not be opened") from err
    with doc:
        if doc.needs_pass:
            raise ScanError("PDF is encrypted")
        page_count = doc.page_count
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE project_files SET page_count = %s, pages_scanned = 0 WHERE id = %s",
                (page_count, document_id),
            )
        conn.commit()

        thumbs_dir = config.upload_dir / project_id / "thumbs"
        thumbs_dir.mkdir(parents=True, exist_ok=True)
        scans: list[tuple[PageScan, str]] = []
        for index in range(page_count):
            page = doc[index]
            scan = analyze_page(page)
            relative = Path(project_id) / "thumbs" / f"page-{index + 1:04d}.png"
            (config.upload_dir / relative).write_bytes(render_thumbnail_png(page))
            scans.append((scan, relative.as_posix()))
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE project_files SET pages_scanned = %s WHERE id = %s",
                    (index + 1, document_id),
                )
            conn.commit()
            log.info("scanned page %s of %s", index + 1, page_count)

    _with_duplicate_flags([s for s, _ in scans])
    with conn.cursor() as cur:
        for scan, thumb in scans:
            cur.execute(_UPSERT_SHEET, _row(project_id, scan, thumb))
        cur.execute(
            "UPDATE project_files SET scan_status = 'done', pages_scanned = %s, "
            "scanned_at = NOW() WHERE id = %s",
            (page_count, document_id),
        )
        cur.execute("UPDATE projects SET status = 'scanned' WHERE id = %s", (project_id,))
        if auto_run:  # Phase 6a: the pipeline runs on its own after the scan (flags, not gates)
            cur.execute(
                "INSERT INTO jobs (type, payload) VALUES ('auto_run', %s)",
                (Jsonb({"project_id": project_id, "document_id": document_id}),),
            )
    conn.commit()

    kinds = [s.page_kind for s, _ in scans]
    return {
        "pages": page_count,
        "vector": kinds.count("vector"),
        "scanned": kinds.count("scanned"),
        "unknown": kinds.count("unknown"),
        "needs_review": sum(1 for s, _ in scans if s.needs_review),
    }
