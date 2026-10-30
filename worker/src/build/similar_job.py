"""Phase 14d: the app's image-based Find similar as a worker job (type `find_similar`).

The API queues one job per preview (FIND_SIMILAR_IMAGE on) with the clicked column's page point
and the Build whose candidate symbols are stored (page_symbols); this runs the same function the
measurement runs (src/build/col_image.find_similar) on the page's crop with that Build's grid
lines, and stores the example, the vector / image / combined matches, the settings and the runtime
on the job. Read-only on the drawing data; deterministic.
"""

from __future__ import annotations

from typing import Any

import pymupdf

from src.build.col_image import THRESHOLD, Settings, find_similar
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
    settings = Settings(threshold=float(p.get("threshold", THRESHOLD)))
    with pymupdf.open(config.upload_dir / page["stored_path"]) as doc:
        res = find_similar(
            doc[int(page["page_index"])], box, float(sym["ratio"]), click, list(sym["symbols"]),
            grid, settings,
        )  # fmt: skip
    hits = {(round(h.centre[0], 2), round(h.centre[1], 2)): h for h in res.image}
    combined = []
    for c in res.combined:
        h = hits.get((round(c["centre"][0], 2), round(c["centre"][1], 2)))
        combined.append({"centre": [round(v, 2) for v in c["centre"]], "source": c["source"],
                         "rotation": h.rotation if h else 0})  # fmt: skip
    return {
        "example": res.example,
        "note": res.note,
        "vector": len(res.vector),
        "image": len(res.image),
        "combined": combined,
        "runtime_s": round(res.runtime_s, 3),
        "settings": {"image": True, "threshold": settings.threshold, "rules": sym["rules"]},
    }
