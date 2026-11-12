"""Phase 0 cover details: the `read_details` job (project level).

Payload {project_id, mode}. mode "read" (default): read the text of every page of the project's
stored PDF, extract the details and the drawing index, store them. mode "recheck": only match the
stored index rows against the CURRENT page list (sheet numbers, names and roles a person changed)
and rewrite the flags. A person's edits (project_detail_edits) are never touched; nothing is written
to projects or sheets.
"""

from __future__ import annotations

import time
from typing import Any

import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.details import index as I  # noqa: E741
from src.details.read import cover_pages_of, read_details
from src.details.types import DetailsResult, IndexRow, PageText
from src.pdf_scan.textlines import page_words_and_lines
from src.queue import Job

JOB_TYPE = "read_details"

SHEETS_SQL = """
SELECT s.id, s.page_index, s.width_pt, s.height_pt, s.sheet_number, s.title, s.view_title,
       s.title_block_name, s.name_override, v.role_name, r.behaviour
FROM sheets s
LEFT JOIN build_views v ON v.sheet_id = s.id AND v.position = 1
LEFT JOIN role_names r ON r.name = v.role_name
WHERE s.project_id = %s ORDER BY s.page_index
"""


def page_inputs(conn, project_id: str) -> list[PageText]:
    out = []
    for r in conn.execute(SHEETS_SQL, (project_id,)).fetchall():
        name = r["name_override"] or r["view_title"] or r["title_block_name"] or r["title"]
        out.append(
            PageText(
                r["page_index"],
                float(r["width_pt"] or 0),
                float(r["height_pt"] or 0),
                [],
                r["sheet_number"],
                name,
                r["behaviour"],
                r["role_name"],
                str(r["id"]),
            )  # fmt: skip
        )
    return out


def _store_flags(conn, project_id: str, res: DetailsResult) -> None:
    conn.execute("DELETE FROM drawing_index_flags WHERE project_id = %s", (project_id,))
    for f in res.index_flags:
        conn.execute(
            "INSERT INTO drawing_index_flags (project_id, kind, page_index, sheet_id, index_page,"
            " number, title, detail) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (project_id, f.kind, f.page_index, f.sheet_id, f.index_page, f.number, f.title,
             Jsonb(f.detail)),
        )  # fmt: skip


def _store_rows(conn, project_id: str, rows: list[IndexRow]) -> None:
    conn.execute("DELETE FROM drawing_index_rows WHERE project_id = %s", (project_id,))
    for r in rows:
        conn.execute(
            "INSERT INTO drawing_index_rows (project_id, page_index, number, title, box, rule,"
            " match, matched_page, matched_sheet_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (project_id, r.page_index, r.number, r.title, Jsonb(list(r.box)), r.rule, r.match,
             r.matched_page, r.matched_sheet_id),
        )  # fmt: skip


def read_project(conn, config: WorkerConfig, project_id: str) -> tuple[DetailsResult, dict]:
    pages = page_inputs(conn, project_id)
    f = conn.execute(
        "SELECT stored_path FROM project_files WHERE project_id = %s ORDER BY created_at LIMIT 1",
        (project_id,),
    ).fetchone()
    if f is None:
        raise RuntimeError("the project has no file")
    t0 = time.perf_counter()
    with pymupdf.open(config.upload_dir / f["stored_path"]) as doc:
        by_index = {p.page_index: p for p in pages}
        for i in range(len(doc)):
            if i not in by_index:
                continue
            _words, lines = page_words_and_lines(doc[i])
            by_index[i].lines = lines
    res = read_details(pages)
    return res, {"seconds": round(time.perf_counter() - t0, 3), "pages": len(pages)}


def store_result(conn, project_id: str, res: DetailsResult, info: dict) -> None:
    conn.execute("DELETE FROM project_details WHERE project_id = %s", (project_id,))
    for d in res.fields.values():
        conn.execute(
            "INSERT INTO project_details (project_id, field, value, page_index, box, rule,"
            " confidence, flags, alternatives, agreement) VALUES (%s, %s, %s, %s, %s, %s, %s, %s,"
            " %s, %s)",
            (project_id, d.field, d.value, d.page_index, Jsonb(list(d.box)), d.rule, d.confidence,
             d.flags, Jsonb(d.alternatives), Jsonb(d.agreement) if d.agreement else None),
        )  # fmt: skip
    conn.execute(
        "INSERT INTO project_detail_reads (project_id, cover_pages, no_text_pages, pages, seconds,"
        " repeated) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (project_id) DO UPDATE SET"
        " read_at = now(), cover_pages = EXCLUDED.cover_pages, no_text_pages ="
        " EXCLUDED.no_text_pages, pages = EXCLUDED.pages, seconds = EXCLUDED.seconds,"
        " repeated = EXCLUDED.repeated",
        (project_id, res.cover_pages, res.no_text_pages, info["pages"], info["seconds"],
         Jsonb(res.repeated)),
    )  # fmt: skip
    _store_rows(conn, project_id, res.index_rows)
    _store_flags(conn, project_id, res)


def recheck(conn, project_id: str) -> int:
    """Match the stored index rows against the current page list; rewrite the flags."""
    pages = page_inputs(conn, project_id)
    rows = [
        IndexRow(r["number"], r["title"], r["page_index"], tuple(r["box"]), r["rule"])
        for r in conn.execute(
            "SELECT * FROM drawing_index_rows WHERE project_id = %s ORDER BY page_index, id",
            (project_id,),
        ).fetchall()
    ]
    read = conn.execute(
        "SELECT cover_pages FROM project_detail_reads WHERE project_id = %s", (project_id,)
    ).fetchone()
    cover = set(read["cover_pages"]) if read else set(cover_pages_of(pages))
    for p in pages:  # a role set since the read makes that page a cover page too
        if p.role_name == "Cover / Title page":
            cover.add(p.page_index)
    res = DetailsResult(index_rows=rows)
    res.index_flags = I.check_index(rows, pages, {r.page_index for r in rows}, cover)
    _store_rows(conn, project_id, rows)
    _store_flags(conn, project_id, res)
    return len(res.index_flags)


def run_read_details(conn, job: Job, config: WorkerConfig) -> dict[str, Any]:
    project_id = str(job.payload["project_id"])
    if job.payload.get("mode") == "recheck":
        return {"mode": "recheck", "flags": recheck(conn, project_id)}
    res, info = read_project(conn, config, project_id)
    store_result(conn, project_id, res, info)
    return {
        "mode": "read",
        "fields": len(res.fields),
        "index_rows": len(res.index_rows),
        "flags": len(res.index_flags),
        "no_text_pages": res.no_text_pages,
        **info,
    }
