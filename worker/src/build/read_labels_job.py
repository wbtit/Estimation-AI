"""Phase 0 profile from callout: read and store the size labels of a sheet (job type `read_labels`).

Payload {sheet_id}. For every view of the sheet (the whole page when a view has no box) the text
lines inside the view become `page_labels` rows (src/build/profile_store.py), with the leader lines
and the AISC catalog check. Used for sheets built before the labels were stored, so the profile
search and Find similar can read them. Read-only on the drawing and on members.
"""

from __future__ import annotations

import time
from typing import Any

import pymupdf

from src.build.profile_labels import CatalogIndex
from src.build.profile_store import store_labels
from src.build.segments import crop, page_text_lines, parse_page
from src.build.views import load_views
from src.config import WorkerConfig
from src.queue import Job

JOB_TYPE = "read_labels"


def view_texts(conn, sheet_id: str, page: dict[str, Any], pg) -> list[tuple[Any, list, list]]:
    """For every view of the sheet: (view, the text lines inside it, the segments inside it). The
    whole page when a view has no box. Read-only."""
    w, h = float(page["width_pt"]), float(page["height_pt"])
    text = page_text_lines(pg)
    ps_all = parse_page(pg)
    out = []
    for view in load_views(conn, sheet_id):
        box = view.row["box"]
        region = (
            (float(box["x0"]), float(box["y0"]), float(box["x1"]), float(box["y1"]))
            if box
            else (0.0, 0.0, w, h)
        )
        inside = [
            t
            for t in text
            if region[0] <= t.centre[0] <= region[2] and region[1] <= t.centre[1] <= region[3]
        ]
        ps = crop(ps_all, region)
        segs = [tuple(map(float, r)) for r in ps.seg] if len(ps) else []
        out.append((view, inside, segs, len(text)))
    return out


def run_read_labels(conn, job: Job, config: WorkerConfig) -> dict[str, Any]:
    sheet_id = str(job.payload["sheet_id"])
    page = conn.execute(
        "SELECT s.*, f.stored_path FROM sheets s JOIN project_files f"
        " ON f.project_id = s.project_id WHERE s.id = %s",
        (sheet_id,),
    ).fetchone()
    if page is None:
        raise RuntimeError("sheet not found")
    t0 = time.perf_counter()
    catalog = CatalogIndex(conn)
    out: dict[str, Any] = {"views": 0, "labels": 0, "text_lines": 0}
    with pymupdf.open(config.upload_dir / page["stored_path"]) as doc:
        for view, inside, segs, total in view_texts(conn, sheet_id, page, doc[page["page_index"]]):
            labels, _ids = store_labels(conn, sheet_id, str(view.id), inside, segs, total, catalog)
            out["views"] += 1
            out["labels"] += len(labels)
            out["text_lines"] = total
    out["seconds"] = round(time.perf_counter() - t0, 3)
    return out
