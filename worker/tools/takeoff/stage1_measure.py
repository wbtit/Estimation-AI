"""Phase 6a step 6: page-level count comparison of the automatic pipeline against the estimators' symbols.

Pre-registered in docs/PHASE6A_PREREGISTRATION.md (committed before any real drawing was run). For each
matched takeoff the CLEAN drawing is uploaded through the API, the worker runs the pipeline with no
human action, and the pieces are compared per page with the count symbols (Polygon, 3 or 8 vertices)
of the marked-up page. Counts only; no job names, drawing text or tag text is printed or stored.
usage (API on 127.0.0.1:3000 and the worker running; from worker/):
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.stage1_measure [job-0NN ...]
"""

from __future__ import annotations

import collections
import json
import statistics
import sys
import time
import urllib.request
import uuid
from pathlib import Path

import pymupdf

from tools.takeoff.common import TAKEOFFS, drawing_documents

API = "http://127.0.0.1:3000"
POLL_S = 3.0
MAX_WAIT_S = 3600.0


# ---- pure comparison helpers (unit-tested with synthetic numbers) -------------------------------
def agrees(ours: int, theirs: int) -> dict[str, bool]:
    """The three registered per-page bars (B1, B2, B3)."""
    return {
        "equal": ours == theirs,
        "within1": abs(ours - theirs) <= 1,
        "within20": theirs >= 1 and abs(ours - theirs) <= 0.2 * theirs,
    }


def page_colour_class(colours: collections.Counter) -> str:
    """green page: at least 90% of drawn pieces green; red page: at least 10% red; else amber page."""
    n = sum(colours.values())
    if n == 0:
        return "no pieces"
    if colours.get("red", 0) / n >= 0.10:
        return "red page"
    if colours.get("green", 0) / n >= 0.90:
        return "green page"
    return "amber page"


def share(flags: list[bool]) -> float | None:
    return None if not flags else sum(flags) / len(flags)


def summarise(pages: list[dict]) -> dict:
    """B1 to B7 over page records {theirs, ours, ours_in_total, left_out, colour_class, ...}."""
    out: dict = {}
    for label, sel in (
        ("their_pages", [p for p in pages if p["theirs"] >= 1]),
        ("all_mapped_pages", pages),
    ):
        ag = [agrees(p["ours"], p["theirs"]) for p in sel]
        out[label] = {
            "pages": len(sel),
            "equal": share([a["equal"] for a in ag]),
            "within1": share([a["within1"] for a in ag]),
            "within20": share([a["within20"] for a in ag]),
            "ours": sum(p["ours"] for p in sel),
            "ours_in_total": sum(p["ours_in_total"] for p in sel),
            "theirs": sum(p["theirs"] for p in sel),
        }
    t = out["their_pages"]
    t["ratio"] = None if t["theirs"] == 0 else t["ours"] / t["theirs"]
    t["ratio_in_total"] = None if t["theirs"] == 0 else t["ours_in_total"] / t["theirs"]
    theirs_pages = [p for p in pages if p["theirs"] >= 1]
    out["left_out_pages"] = sum(1 for p in theirs_pages if p["left_out"])
    out["extra_pages"] = sum(1 for p in pages if p["theirs"] == 0 and p["ours"] >= 1)
    by_class: dict[str, dict] = {}
    for cls in ("green page", "amber page", "red page", "no pieces"):
        sel = [p for p in theirs_pages if p["colour_class"] == cls]
        ag = [agrees(p["ours"], p["theirs"]) for p in sel]
        by_class[cls] = {
            "pages": len(sel),
            "equal": share([a["equal"] for a in ag]),
            "within1": share([a["within1"] for a in ag]),
            "within20": share([a["within20"] for a in ag]),
        }
    out["by_page_colour"] = by_class
    shape = {}
    for name, ours_key, theirs_key in (
        ("linear_vs_circles", "ours_linear", "theirs_circles"),
        ("columns_vs_triangles", "ours_column", "theirs_triangles"),
    ):
        sel = [p for p in theirs_pages if not p["left_out"]]
        ag = [agrees(p[ours_key], p[theirs_key]) for p in sel]
        shape[name] = {
            "pages": len(sel),
            "equal": share([a["equal"] for a in ag]),
            "within1": share([a["within1"] for a in ag]),
        }
    out["shape_groups"] = shape
    return out


# ---- the run ------------------------------------------------------------------------------------
def call(method: str, path: str, body: bytes | None = None, headers: dict | None = None):
    req = urllib.request.Request(API + path, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = r.read()
    return json.loads(text) if text else None


def upload(pdf: Path, name: str) -> str:
    project = call(
        "POST",
        "/api/projects",
        json.dumps({"name": name}).encode(),
        {"content-type": "application/json"},
    )
    boundary = "----m" + uuid.uuid4().hex
    head = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="drawing.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode()
    body = head + pdf.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    call(
        "POST",
        f"/api/projects/{project['id']}/pdf",
        body,
        {"content-type": f"multipart/form-data; boundary={boundary}"},
    )
    return project["id"]


def wait_done(project_id: str) -> None:
    t0 = time.time()
    while time.time() - t0 < MAX_WAIT_S:
        p = call("GET", f"/api/projects/{project_id}")
        doc = p.get("document") or {}
        if doc.get("scan_status") == "failed":
            raise RuntimeError("scan failed")
        if doc.get("scan_status") == "done":
            f = call("GET", f"/api/projects/{project_id}/flags")
            run = f.get("last_run")
            if run and run["status"] == "completed":
                return
            if run and run["status"] == "failed":
                raise RuntimeError("pipeline failed")
        time.sleep(POLL_S)
    raise RuntimeError("timeout")


def their_counts(page: pymupdf.Page) -> tuple[int, int, int]:
    circles = triangles = 0
    for a in page.annots() or []:
        if a.type[1] == "Polygon":
            nv = len(a.vertices or [])
            circles += nv == 8
            triangles += nv == 3
    return circles + triangles, circles, triangles


def our_page_records(project_id: str) -> dict[int, dict]:
    sheets = call("GET", f"/api/projects/{project_id}/sheets")["sheets"]
    members = call("GET", f"/api/projects/{project_id}/members")["members"]
    by_sheet: dict[str, list[dict]] = collections.defaultdict(list)
    for m in members:
        by_sheet[m["sheet_id"]].append(m)
    out = {}
    for s in sheets:
        drawn = [
            m
            for m in by_sheet.get(s["id"], [])
            if not m["deleted"]
            and m["merged_into"] is None
            and m["not_member"] is None
            and not m["existing"]
            and m["counting"] == "counted"
            and m["status"]["color"] != "unlinked"
        ]
        colours = collections.Counter(m["status"]["color"] for m in drawn)
        out[s["page_index"]] = {
            "included": bool(s.get("takeoff", {}).get("included")),
            "ours": len(drawn),
            "ours_in_total": sum(1 for m in drawn if m["status"]["color"] != "red"),
            "ours_linear": sum(1 for m in drawn if m["symbol_group"] == "linear"),
            "ours_column": sum(1 for m in drawn if m["symbol_group"] == "column"),
            "colours": dict(colours),
            "colour_class": page_colour_class(colours),
        }
    return out


def run_job(job: str, takeoff: Path, info: dict, drawing: Path) -> dict:
    t0 = time.time()
    pid = upload(drawing, f"measure-{job}")
    wait_done(pid)
    call("GET", f"/api/projects/{pid}/tables")  # the tables the estimator would see
    minutes = (time.time() - t0) / 60
    ours = our_page_records(pid)
    pages = []
    with pymupdf.open(takeoff) as tdoc:
        for tp, dp in sorted((int(k), v) for k, v in info["page_map"].items()):
            theirs, circles, triangles = their_counts(tdoc[tp])
            o = ours.get(dp)
            if o is None:
                continue
            pages.append(
                {
                    "job": job,
                    "page": dp,
                    "theirs": theirs,
                    "theirs_circles": circles,
                    "theirs_triangles": triangles,
                    "ours": o["ours"],
                    "ours_in_total": o["ours_in_total"],
                    "ours_linear": o["ours_linear"],
                    "ours_column": o["ours_column"],
                    "colour_class": o["colour_class"],
                    "left_out": not o["included"] and o["ours"] == 0,
                }
            )
    n_pages = len(ours)
    return {
        "job": job,
        "project_id": pid,
        "minutes": round(minutes, 2),
        "drawing_pages": n_pages,
        "pages": pages,
    }


def main(argv: list[str]) -> None:
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    draws = drawing_documents()
    results = []
    for name, info in sorted(inv.items()):
        job = info.get("match")
        if not job or (argv and job not in argv):
            continue
        r = run_job(job, TAKEOFFS / name, info, draws[job])
        results.append(r)
        print(
            f"{job}: {r['drawing_pages']} drawing pages, {len(r['pages'])} mapped pages, {r['minutes']} min",
            flush=True,
        )
        (TAKEOFFS / "stage1_measure.json").write_text(json.dumps(results, indent=1))
    pages = [p for r in results for p in r["pages"]]
    summary = summarise(pages)
    largest = max(results, key=lambda r: r["drawing_pages"], default=None)
    summary["minutes"] = {
        "largest_job_pages": largest and largest["drawing_pages"],
        "largest_job_minutes": largest and largest["minutes"],
        "median_minutes": statistics.median([r["minutes"] for r in results]) if results else None,
        "per_job": [(r["job"], r["drawing_pages"], r["minutes"]) for r in results],
    }
    (TAKEOFFS / "stage1_measure.json").write_text(
        json.dumps({"jobs": results, "summary": summary}, indent=1)
    )
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
