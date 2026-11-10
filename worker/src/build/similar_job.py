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
    long_line_angles,
    render,
    save_raster,
    search,
)
from src.config import WorkerConfig
from src.queue import Job

JOB_TYPE = "find_similar"


def _box_of(c: Any) -> tuple[float, float, float, float]:
    return (float(c["x0"]), float(c["y0"]), float(c["x1"]), float(c["y1"]))


def resolve_inputs(conn, sheet_id: str, run_id: str) -> dict[str, Any]:
    """What Find similar needs from the page, wherever the page was built (Phase 0 column capture:
    it works on ANY built page; a framing build stores no column symbols and no ink cache).

    - symbols: the run's stored column symbols; none stored: [] (the example is then main's ink
      read, which needs no stored symbol);
    - ratio: the stored one, else the view's scale, else the page's;
    - crop and grid: the Build's own when it has them (a column plan), else those of the view's
      latest finished run, else the view's box, else the whole page;
    - cache_run: the run whose page-ink cache is used (a miss renders it once).
    """
    sym = conn.execute(
        "SELECT symbols, ratio, rules FROM page_symbols WHERE build_run_id = %s", (run_id,)
    ).fetchone()
    run = conn.execute("SELECT inputs, view_id FROM build_runs WHERE id = %s", (run_id,)).fetchone()
    view_id = run["view_id"] if run else None
    latest = conn.execute(
        "SELECT id, inputs FROM build_runs WHERE sheet_id = %s AND status = 'done'"
        " AND view_id IS NOT DISTINCT FROM %s::uuid AND (inputs->'crop') IS NOT NULL"
        " ORDER BY finished_at DESC NULLS LAST LIMIT 1",
        (sheet_id, view_id),
    ).fetchone()
    own_crop = (run["inputs"] or {}).get("crop") if run else None
    if sym is not None and own_crop:
        cache_run, crop, crop_source = run_id, own_crop, "the run"
    elif latest is not None:
        cache_run, crop = str(latest["id"]), (latest["inputs"] or {}).get("crop")
        crop_source = "the view's latest finished run"
    elif own_crop:
        cache_run, crop, crop_source = run_id, own_crop, "the run"
    else:
        cache_run, crop, crop_source = run_id, None, None
    view = conn.execute(
        "SELECT box, scale_ratio FROM build_views WHERE sheet_id = %s"
        " AND (id = %s::uuid OR (%s::uuid IS NULL AND position = 1)) ORDER BY position LIMIT 1",
        (sheet_id, view_id, view_id),
    ).fetchone()
    if not crop and view and view["box"]:
        crop, crop_source = view["box"], "the view's box"
    sheet = conn.execute(
        "SELECT width_pt, height_pt, build_scale_ratio, scale_parsed_ratio, scale_override_ratio"
        " FROM sheets WHERE id = %s",
        (sheet_id,),
    ).fetchone()
    if not crop and sheet:
        crop = {"x0": 0, "y0": 0, "x1": float(sheet["width_pt"]), "y1": float(sheet["height_pt"])}
        crop_source = "the whole page"
    if not crop:
        raise ValueError("the page has no box to search")
    ratio, ratio_source = None, None
    for src, val in (
        ("the stored symbols", sym["ratio"] if sym else None),
        ("the view", view["scale_ratio"] if view else None),
        ("the page", sheet["build_scale_ratio"] if sheet else None),
        ("the page override", sheet["scale_override_ratio"] if sheet else None),
        ("the page", sheet["scale_parsed_ratio"] if sheet else None),
    ):
        if val:
            ratio, ratio_source = float(val), src
            break
    if ratio is None:
        raise ValueError("no_scale: the page has no scale yet; set it in the page setup")
    grid = [
        ((float(r["x0"]), float(r["y0"])), (float(r["x1"]), float(r["y1"])))
        for r in conn.execute(
            "SELECT x0, y0, x1, y1 FROM grid_lines WHERE build_run_id = %s ORDER BY label, id",
            (cache_run,),
        )
    ]
    return {
        "symbols": list(sym["symbols"]) if sym else [],
        "rules": sym["rules"] if sym else "",
        "symbols_stored": sym is not None,
        "ratio": ratio,
        "ratio_source": ratio_source,
        "box": _box_of(crop),
        "crop_source": crop_source,
        "grid": grid,
        "cache_run": cache_run,
        "latest_run": str(latest["id"]) if latest is not None else None,
        "view_id": view_id,
    }


def clean_stale_cache(
    conn, config: WorkerConfig, sheet_id: str, keep_runs: set[str], view_id
) -> list[str]:
    """After a cache is written, the page-ink cache files of the view's OTHER runs go (as a
    column-plan Build does), EXCEPT `keep_runs`: the one just written and the view's latest run
    (an older run's click must never delete the newer Build's cache). Only the app's own cache
    files: the paths, by `cache_path`, of build runs of this sheet and view, nothing else.
    Returns the file names removed."""
    removed: list[str] = []
    for row in conn.execute(
        "SELECT id FROM build_runs WHERE sheet_id = %s AND view_id IS NOT DISTINCT FROM %s::uuid",
        (sheet_id, view_id),
    ):
        if str(row["id"]) in keep_runs:
            continue
        path = cache_path(config.upload_dir, str(row["id"]))
        if path.exists():
            path.unlink(missing_ok=True)
            removed.append(path.name)
    return removed


def run_find_similar(conn, job: Job, config: WorkerConfig) -> dict[str, Any]:
    p = job.payload
    sheet_id, run_id = str(p["sheet_id"]), str(p["build_run_id"])
    click = (float(p["click"][0]), float(p["click"][1]))
    inp = resolve_inputs(conn, sheet_id, run_id)
    page = conn.execute(
        "SELECT s.page_index, f.stored_path FROM sheets s"
        " JOIN project_files f ON f.project_id = s.project_id WHERE s.id = %s",
        (sheet_id,),
    ).fetchone()
    if page is None:
        raise ValueError("sheet not found")
    grid, box, ratio = inp["grid"], inp["box"], inp["ratio"]
    sym = {"symbols": inp["symbols"], "rules": inp["rules"]}
    settings = Settings(threshold=SEARCH_THRESHOLD)
    t0 = time.perf_counter()
    # Phase 14e: the cleaned ink rendered at Build time; a miss renders it and saves it
    path = cache_path(config.upload_dir, inp["cache_run"])
    r = load_raster(path)
    hit = r is not None and r.crop == box
    removed: list[str] = []
    if not hit:
        with pymupdf.open(config.upload_dir / page["stored_path"]) as doc:
            r = render(doc[int(page["page_index"])], box, ratio, grid, settings)
        save_raster(path, r)
        keep = {inp["cache_run"], *([inp["latest_run"]] if inp["latest_run"] else [])}
        removed = clean_stale_cache(conn, config, sheet_id, keep, inp["view_id"])
    t1 = time.perf_counter()

    def long_lines() -> list[float]:
        # Phase 0-14g: a page with no grid lines searches the directions of its long lines
        with pymupdf.open(config.upload_dir / page["stored_path"]) as doc:
            return long_line_angles(doc[int(page["page_index"])], box, ratio)

    user_box = p.get("box")  # Phase 0-column-capture: the box the person shows [x0, y0, x1, y1]
    box_t = tuple(float(v) for v in user_box) if user_box else None
    res = search(
        r, ratio, click, list(sym["symbols"]), settings, grid=grid, fallback=long_lines, box=box_t
    )
    t2 = time.perf_counter()
    combined = [
        {"centre": [round(v, 2) for v in c["centre"]], "source": c["source"],
         "score": c["score"], "rotation": c["rotation"]}
        for c in res.combined
    ]  # fmt: skip
    return {
        "example": res.example,
        "note": res.note,
        "refused": res.refused,
        "warning": res.warning,
        "snap": res.snap,
        "angles": res.angles,
        "vector": len(res.vector),
        "image": len(res.image),
        "combined": combined,
        "runtime_s": round(t2 - t0, 3),
        "cache": {
            "hit": hit,
            "load_or_render_s": round(t1 - t0, 3),
            "search_s": round(t2 - t1, 3),
            "removed": removed,
        },
        "inputs": {
            "symbols_stored": inp["symbols_stored"],
            "ratio_source": inp["ratio_source"],
            "crop_source": inp["crop_source"],
            "cache_run": inp["cache_run"],
        },
        "settings": {"image": True, "search_threshold": SEARCH_THRESHOLD, "rules": sym["rules"]},
    }
