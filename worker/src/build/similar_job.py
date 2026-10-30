"""Phase 14d: the app's image-based Find similar as a worker job (type `find_similar`).

The API queues one job per preview (FIND_SIMILAR_IMAGE on) with the clicked column's page point
and the Build whose candidate symbols are stored (page_symbols); this runs the search the
measurement runs (src/build/col_image.search) on the page's cleaned ink, cached at Build time
(Phase 14e; a miss renders it with that Build's grid lines and saves it), once at the slider's
floor (0.60), and stores the example, the matches with their scores, the settings and the timings
on the job. Read-only on the drawing data; deterministic.
"""

from __future__ import annotations

import time
from typing import Any

import pymupdf

from src.build.col_image import (
    SEARCH_THRESHOLD,
    Settings,
    cache_path,
    load_raster,
    render,
    save_raster,
    search,
)
from src.config import WorkerConfig
from src.queue import Job

JOB_TYPE = "find_similar"


def run_find_similar(conn, job: Job, config: WorkerConfig) -> dict[str, Any]:
    p = job.payload
    sheet_id, run_id = str(p["sheet_id"]), str(p["build_run_id"])
    click = (float(p["click"][0]), float(p["click"][1]))
    sym = conn.execute(
        "SELECT symbols, ratio, rules FROM page_symbols WHERE build_run_id = %s", (run_id,)
    ).fetchone()
    if sym is None:
        raise ValueError("the page's symbols are not stored: build the page first")
    run = conn.execute("SELECT inputs FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    crop = (run["inputs"] or {}).get("crop") if run else None
    if not crop:
        raise ValueError("the Build has no crop")
    page = conn.execute(
        "SELECT s.page_index, f.stored_path FROM sheets s"
        " JOIN project_files f ON f.project_id = s.project_id WHERE s.id = %s",
        (sheet_id,),
    ).fetchone()
    if page is None:
        raise ValueError("sheet not found")
    grid = [
        ((float(r["x0"]), float(r["y0"])), (float(r["x1"]), float(r["y1"])))
        for r in conn.execute(
            "SELECT x0, y0, x1, y1 FROM grid_lines WHERE build_run_id = %s ORDER BY label, id",
            (run_id,),
        )
    ]
    box = (float(crop["x0"]), float(crop["y0"]), float(crop["x1"]), float(crop["y1"]))
    ratio = float(sym["ratio"])
    settings = Settings(threshold=SEARCH_THRESHOLD)
    t0 = time.perf_counter()
    # Phase 14e: the cleaned ink rendered at Build time; a miss renders it and saves it
    path = cache_path(config.upload_dir, run_id)
    r = load_raster(path)
    hit = r is not None and r.crop == box
    if not hit:
        with pymupdf.open(config.upload_dir / page["stored_path"]) as doc:
            r = render(doc[int(page["page_index"])], box, ratio, grid, settings)
        save_raster(path, r)
    t1 = time.perf_counter()
    res = search(r, ratio, click, list(sym["symbols"]), settings)
    t2 = time.perf_counter()
    combined = [
        {"centre": [round(v, 2) for v in c["centre"]], "source": c["source"],
         "score": c["score"], "rotation": c["rotation"]}
        for c in res.combined
    ]  # fmt: skip
    return {
        "example": res.example,
        "note": res.note,
        "vector": len(res.vector),
        "image": len(res.image),
        "combined": combined,
        "runtime_s": round(t2 - t0, 3),
        "cache": {"hit": hit, "load_or_render_s": round(t1 - t0, 3), "search_s": round(t2 - t1, 3)},
        "settings": {"image": True, "search_threshold": SEARCH_THRESHOLD, "rules": sym["rules"]},
    }
