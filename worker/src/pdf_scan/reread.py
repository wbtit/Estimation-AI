"""Re-read the sheet numbers of a stored project with the title-block reading (Phase 9).

Only the number columns of `sheets` are touched (sheet_number, sheet_number_source,
sheet_number_old, sheet_number_old_source, sheet_number_flag); nothing else of a scan is redone.
`apply=False` (the default) is a preview: it reports how many sheets would change and writes
nothing. `only_missing=True` writes only fill-ins: a sheet that had no number gets the new reading;
a stored number is never overwritten (Phase 10, owner decision 123). The per-page changes are
returned under "changes" (for the private review file); they are never logged.
Counts only in the result and in logs (no sheet number is logged).
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg
import pymupdf

from src.config import WorkerConfig
from src.pdf_scan.textlines import page_words_and_lines
from src.pdf_scan.textscan import scan_text

log = logging.getLogger("worker.reread")


def reread_sheet_numbers(
    conn: psycopg.Connection,
    config: WorkerConfig,
    project_id: str,
    *,
    apply: bool = False,
    only_missing: bool = False,
) -> dict[str, Any]:
    file = conn.execute(
        "SELECT stored_path FROM project_files WHERE project_id = %s", (project_id,)
    ).fetchone()
    if file is None:
        raise ValueError("project has no stored PDF")
    pdf = config.upload_dir / file["stored_path"]
    if not pdf.is_file():
        raise ValueError("stored PDF is missing")
    sheets = conn.execute(
        "SELECT id, page_index, sheet_number, sheet_number_source, sheet_number_flag"
        " FROM sheets WHERE project_id = %s ORDER BY page_index",
        (project_id,),
    ).fetchall()
    out = {
        "applied": apply,
        "sheets": len(sheets),
        "unchanged": 0,
        "number_changed": 0,
        "number_read_where_none": 0,
        "title_block": 0,
        "fallback_old": 0,
        "no_number": 0,
        "flag_only": 0,
        "written": 0,
        "changes": [],
    }
    with pymupdf.open(pdf) as doc:
        for s in sheets:
            page = doc[s["page_index"]]
            words, lines = page_words_and_lines(page)
            found = scan_text(words, lines, page.rect.width, page.rect.height)
            out["title_block"] += found.sheet_number_flag == "title_block"
            out["fallback_old"] += found.sheet_number_flag == "fallback_old"
            out["no_number"] += found.sheet_number is None
            if found.sheet_number != s["sheet_number"]:
                key = "number_read_where_none" if s["sheet_number"] is None else "number_changed"
                out[key] += 1
                out["changes"].append(
                    {
                        "page_index": s["page_index"],
                        "kind": key,
                        "old": s["sheet_number"],
                        "new": found.sheet_number,
                    }
                )
            elif found.sheet_number_flag != s["sheet_number_flag"]:
                out["flag_only"] += 1
            else:
                out["unchanged"] += 1
            fill_in = s["sheet_number"] is None and found.sheet_number is not None
            if apply and (not only_missing or fill_in):
                out["written"] += 1
                conn.execute(
                    "UPDATE sheets SET sheet_number = %s, sheet_number_source = %s,"
                    " sheet_number_old = %s, sheet_number_old_source = %s, sheet_number_flag = %s"
                    " WHERE id = %s",
                    (
                        found.sheet_number,
                        found.sheet_number_source,
                        found.sheet_number_old,
                        found.sheet_number_old_source,
                        found.sheet_number_flag,
                        s["id"],
                    ),
                )
    if apply:
        conn.commit()
    log.info("reread sheet numbers: %s", {k: v for k, v in out.items() if k != "changes"})
    return out
