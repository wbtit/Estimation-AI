"""Phase 6c Part A: stage-by-stage trace of one project (read-only).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_trace job-006
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_trace job-014 --frame

Counts per page at each stage (text layer, label parse, view, lines, link, members) from the PDF
the API stored and the database rows; the first stage that drops to zero is the cause. The
frame check (job-014) compares the marked-up page with the stored page. Nothing is written to
the database.
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import Counter

import psycopg
import pymupdf

from src.config import load_config
from src.linking.candidates import candidates_for
from src.linking.labels import page_labels
from src.linking.lines import page_lines
from src.linking.rules import propose
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff.common import TAKEOFFS

RUNS = TAKEOFFS / "phase6b_projects.json"


def connect() -> psycopg.Connection:
    cfg = load_config()
    return psycopg.connect(cfg.database_url, row_factory=psycopg.rows.dict_row)


def stored_pdf(conn: psycopg.Connection, project_id: str):
    row = conn.execute(
        "SELECT stored_path FROM project_files WHERE project_id = %s", (project_id,)
    ).fetchone()
    return load_config().upload_dir / row["stored_path"]


def trace_page(conn, doc, sheet: dict, view: dict | None) -> dict:
    page = doc[sheet["page_index"]]
    size = (page.rect.width, page.rect.height)
    out: dict = {"page": sheet["page_index"], "rotation": page.rotation, "size": size}
    # 2. text layer
    raw = page.get_text("rawdict")
    lines = [ln for b in raw["blocks"] if b["type"] == 0 for ln in b["lines"]]
    out["text_lines"] = len(lines)
    out["text_chars"] = sum(len(sp["chars"]) for ln in lines for sp in ln["spans"])
    out["db_text_lines"] = conn.execute(
        "SELECT count(*) AS n FROM text_items WHERE sheet_id = %s AND level = 'line'",
        (sheet["id"],),
    ).fetchone()["n"]
    # 3. labels
    box_d = whole_sheet_box(*size)
    box = (box_d["x0"], box_d["y0"], box_d["x1"], box_d["y1"])
    legend = {
        r["mark"]
        for r in conn.execute(
            "SELECT mark FROM legend_rows WHERE project_id = %s", (sheet["project_id"],)
        )
    }
    labels = page_labels(page, str(sheet["id"]), legend)
    out["labels_all"] = len(labels)
    out["labels_by_kind"] = dict(Counter(lb.kind for lb in labels))
    in_box = [
        lb
        for lb in labels
        if box[0] <= (lb.bbox[0] + lb.bbox[2]) / 2 <= box[2]
        and box[1] <= (lb.bbox[1] + lb.bbox[3]) / 2 <= box[3]
    ]
    out["labels_in_box"] = len(in_box)
    # 4. view
    out["view"] = None
    if view is not None:
        out["view"] = {
            "box": view["box"],
            "scale_ratio": None if view["scale_ratio"] is None else float(view["scale_ratio"]),
            "classes": list(view["structural_classes"]),
        }
    # 5. lines
    all_lines = page_lines(page)
    in_view = lines_in_box(all_lines, box, size)
    table = class_table(in_view)
    suggested = suggest_classes(table)
    out["lines_all"] = len(all_lines)
    out["lines_in_view"] = len(in_view)
    out["suggested"] = suggested
    classes = (list(view["structural_classes"]) if view else []) or suggested
    structural = [ln for ln in in_view if ln.klass in classes]
    out["structural"] = len(structural)
    # 6. link
    props = [propose(candidates_for(lb.bbox, lb.angle_deg, structural)) for lb in in_box]
    out["with_candidate"] = sum(1 for p in props if p.ranked)
    out["with_best"] = sum(1 for p in props if p.best is not None)
    # 7. members
    out["members_db"] = conn.execute(
        "SELECT count(*) AS n FROM members WHERE sheet_id = %s", (sheet["id"],)
    ).fetchone()["n"]
    return out


def jobs_state(conn, project_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT type, status, attempts, error, result FROM jobs"
        " WHERE payload->>'project_id' = %s ORDER BY created_at",
        (project_id,),
    ).fetchall()
    return [
        {
            "type": r["type"],
            "status": r["status"],
            "attempts": r["attempts"],
            "error": (r["error"] or "")[:200],
        }
        for r in rows
    ]


def trace_job(job: str) -> dict:
    runs = json.loads(RUNS.read_text())
    pid = runs[job]["project_id"]
    conn = connect()
    path = stored_pdf(conn, pid)
    sheets = conn.execute(
        "SELECT * FROM sheets WHERE project_id = %s ORDER BY page_index", (pid,)
    ).fetchall()
    views = {
        str(v["sheet_id"]): v
        for v in conn.execute(
            "SELECT v.* FROM sheet_views v JOIN sheets s ON s.id = v.sheet_id"
            " WHERE s.project_id = %s ORDER BY v.created_at",
            (pid,),
        )
    }
    pages = []
    with pymupdf.open(path) as doc:
        for sh in sheets:
            pages.append(trace_page(conn, doc, sh, views.get(str(sh["id"]))))
    return {"job": job, "pages": pages, "jobs": jobs_state(conn, pid)}


# ---- job-014: frame check -----------------------------------------------------------------------
def words(page: pymupdf.Page) -> dict[str, list[tuple[float, float]]]:
    m = page.rotation_matrix
    out: dict[str, list[tuple[float, float]]] = {}
    for x0, y0, x1, y1, w, *_ in page.get_text("words"):
        w = w.strip()
        if len(w) < 4:
            continue
        p = pymupdf.Point((x0 + x1) / 2, (y0 + y1) / 2) * m
        out.setdefault(w, []).append((p.x, p.y))
    return out


def align(a: dict, b: dict) -> dict:
    """Translation and scale of page a to page b from words that occur once on each page."""
    common = [w for w in a if w in b and len(a[w]) == 1 and len(b[w]) == 1]
    if len(common) < 4:
        return {"matches": len(common)}
    pa = [a[w][0] for w in common]
    pb = [b[w][0] for w in common]
    dx = statistics.median(q[0] - p[0] for p, q in zip(pa, pb, strict=True))
    dy = statistics.median(q[1] - p[1] for p, q in zip(pa, pb, strict=True))
    ratios = []
    for i in range(0, len(pa) - 1, 2):
        da = ((pa[i][0] - pa[i + 1][0]) ** 2 + (pa[i][1] - pa[i + 1][1]) ** 2) ** 0.5
        db = ((pb[i][0] - pb[i + 1][0]) ** 2 + (pb[i][1] - pb[i + 1][1]) ** 2) ** 0.5
        if da > 50:
            ratios.append(db / da)
    resid = statistics.median(
        abs(q[0] - p[0] - dx) + abs(q[1] - p[1] - dy) for p, q in zip(pa, pb, strict=True)
    )
    return {
        "matches": len(common),
        "dx": round(dx, 2),
        "dy": round(dy, 2),
        "scale": round(statistics.median(ratios), 4) if ratios else None,
        "residual": round(resid, 2),
    }


def frame_check(job: str) -> dict:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    runs = json.loads(RUNS.read_text())
    conn = connect()
    path = stored_pdf(conn, runs[job]["project_id"])
    res = []
    for name, info in sorted(inv.items()):
        if info.get("match") != job:
            continue
        with pymupdf.open(TAKEOFFS / name) as tdoc, pymupdf.open(path) as ddoc:
            for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
                tpage, dpage = tdoc[tp], ddoc[dp]
                n_sym = sum(
                    1
                    for a in tpage.annots() or []
                    if a.type[1] == "Polygon" and len(a.vertices or []) in (3, 8)
                )
                if not n_sym:
                    continue
                rec = {
                    "takeoff_page": tp,
                    "drawing_page": dp,
                    "symbols": n_sym,
                    "t": [
                        list(tpage.rect),
                        tpage.rotation,
                        list(tpage.mediabox),
                        list(tpage.cropbox),
                    ],
                    "d": [
                        list(dpage.rect),
                        dpage.rotation,
                        list(dpage.mediabox),
                        list(dpage.cropbox),
                    ],
                }
                tw = words(tpage)
                best = None
                rec["by_offset"] = {}
                for off in range(-2, 3):
                    j = dp + off
                    if not 0 <= j < len(ddoc):
                        continue
                    al = align(tw, words(ddoc[j]))
                    rec["by_offset"][off] = al
                    if best is None or al["matches"] > best[1]:
                        best = (off, al["matches"])
                rec["best_offset"] = best[0] if best else None
                res.append(rec)
    return {"job": job, "pages": res}


if __name__ == "__main__":
    job = sys.argv[1]
    data = frame_check(job) if "--frame" in sys.argv else trace_job(job)
    out = TAKEOFFS / f"phase6c_{'frame' if '--frame' in sys.argv else 'trace'}_{job}.json"
    out.write_text(json.dumps(data, default=list, indent=1))
    print(json.dumps(data, default=list)[:6000])
