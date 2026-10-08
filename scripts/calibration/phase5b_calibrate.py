"""Phase 5b multi-document calibration of the review colors against the Phase 4e AI gold.

Runs the PRODUCTION flow through the API (project, upload, scan, read_text, views, scale, link job)
for the vector study documents, then compares each proposed link with the Phase 4e gold, for the
VALIDATION half of the labels only. Needs the API and the worker running, and the git-ignored
fixtures/private/study folder and inventory map. It prints only job numbers and counts; results go
to fixtures/private/study/phase5b_calibration.json (git-ignored). The gold is AI-made.

The script plays the person: it picks the whole-sheet view when the sheet has one scale, else a box
around the page's gold labels (+150 pt); it confirms the suggested scale, or types the sheet's most
common scale, or skips the page when the sheet has no scale at all; and it switches a sheet to
"include in takeoff" when the page type guess is not a framing plan. Every such step is counted.

usage:  python scripts/calibration/phase5b_calibrate.py [job-004 job-005 ...]
"""

from __future__ import annotations

import collections
import csv
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "fixtures" / "private" / "study"
API = os.environ.get("CALIBRATION_API", "http://127.0.0.1:3000")
WHO = "calibration-harness"
JOBS = ["job-004", "job-005", "job-008", "job-009", "job-010", "job-020"]  # job-002/016: raster
OUT_NAME = os.environ.get("CALIBRATION_OUT", "phase5b_calibration.json")
SUFFIX = os.environ.get("CALIBRATION_SUFFIX", "b")  # a new suffix makes a fresh project
MARGIN = 150.0
LINE_TOL = 1.0


# -- tiny HTTP helpers ------------------------------------------------------------------------
def call(method: str, path: str, body: object | None = None, raw: tuple[bytes, str] | None = None):
    data, headers = None, {}
    if raw is not None:
        data, headers = raw[0], {"content-type": raw[1]}
    elif body is not None:
        data, headers = json.dumps(body).encode(), {"content-type": "application/json"}
    req = urllib.request.Request(API + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            text = r.read()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "message": e.read().decode()[:300]}


def multipart(filename: str, content: bytes) -> tuple[bytes, str]:
    b = "----cal" + uuid.uuid4().hex
    head = (
        f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode()
    return head + content + f"\r\n--{b}--\r\n".encode(), f"multipart/form-data; boundary={b}"


def pdf_of(job: str) -> Path:
    for r in csv.DictReader(open(ROOT / "fixtures" / "private" / "inventory_map.csv")):
        if r["id"] != job:
            continue
        for base in (Path.home() / "Downloads", ROOT / "fixtures" / "private"):
            p = base / r["relative_path"]
            if p.exists():
                return p
        hits = glob.glob(str(Path.home() / "Downloads" / "**" / Path(r["relative_path"]).name), recursive=True)
        if hits:
            return Path(hits[0])
    raise SystemExit(f"{job}: PDF not found")


def db_status(sql: str, args: tuple) -> list:
    """Job status straight from the database (URL read from .env and never printed)."""
    import psycopg

    url = ""
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
    with psycopg.connect(url) as conn:
        return list(conn.execute(sql, args).fetchall())


def wait_job(job_id: str, what: str, timeout: float = 3600) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        rows = db_status("SELECT status, error FROM jobs WHERE id = %s", (job_id,))
        if rows and rows[0][0] in ("completed", "done"):
            return
        if rows and rows[0][0] == "failed":
            raise SystemExit(f"{what} failed: {str(rows[0][1])[:200]}")
        time.sleep(2)
    raise SystemExit(f"{what} timed out")


# -- study data -------------------------------------------------------------------------------
def load_study(job: str) -> dict:
    split = json.loads((STUDY / "split.json").read_text())
    cands = json.loads((STUDY / "labels_candidates.json").read_text())
    sample = {}
    for j, d in json.loads((STUDY / "labels_sample.json").read_text()).items():
        for lab in d["sample"]:
            sample[lab["label_id"]] = lab
    gold = json.loads((STUDY / job / "gold.json").read_text())
    classes = json.loads((STUDY / job / "structural_classes.json").read_text())
    labels = {}
    for lid, g in gold.items():
        s = sample[lid]
        labels[lid] = {
            "page": s["page"] + 1,
            "bbox": s["bbox"],
            "split": split[lid],
            "gold": g["gold"],
            "gold_line": None,
            "cands": cands[lid]["candidates"],
        }
        if g["gold"].isdigit():
            c = cands[lid]["candidates"][int(g["gold"]) - 1]
            labels[lid]["gold_line"] = (c["p"], c["q"])
    study_results = json.loads((STUDY / "validation_results.json").read_text())["per_doc"]["frozen"][job]
    return {"labels": labels, "classes": classes, "study": study_results}


def same_line(line: dict, gold: tuple) -> bool:
    (gp, gq), (p, q) = gold, (line["p"], line["q"])

    def close(a, b):
        return abs(a[0] - b[0]) <= LINE_TOL and abs(a[1] - b[1]) <= LINE_TOL

    return (close(p, gp) and close(q, gq)) or (close(p, gq) and close(q, gp))


# -- the flow ---------------------------------------------------------------------------------
def ensure_project(job: str) -> str:
    projects = call("GET", "/api/projects")["projects"]
    for p in projects:
        if p["name"] == f"{job} (calibration {SUFFIX})" and p.get("document"):
            return p["id"]
    p = call("POST", "/api/projects", {"name": f"{job} (calibration {SUFFIX})"})
    path = pdf_of(job)
    r = call("POST", f"/api/projects/{p['id']}/pdf", raw=multipart(f"{job}.pdf", path.read_bytes()))
    if r.get("_error"):
        raise SystemExit(f"{job}: upload failed {r}")
    return p["id"]


def wait_scan(pid: str) -> None:
    while True:
        d = call("GET", f"/api/projects/{pid}")["document"]
        if d["scan_status"] == "done":
            return
        if d["scan_status"] == "failed":
            raise SystemExit(f"scan failed: {d['scan_error']}")
        time.sleep(3)


def ensure_text(pid: str) -> None:
    sheets = call("GET", f"/api/projects/{pid}/sheets")["sheets"]
    for s in sheets:
        if s["page"]["kind"] == "vector":
            n = call("GET", f"/api/projects/{pid}/sheets/{s['id']}/text-items")["count"]
            if n > 0:
                return
    r = call("POST", f"/api/projects/{pid}/read-text", {})
    if r.get("_error") == 409 and "job_id" in str(r):
        raise SystemExit("a text read is already running; run again later")
    wait_job(r["job_id"], "read_text")


def show_and_confirm(pid: str, sheet_id: str, vid: str, classes: list[str] | None) -> str:
    """Show the line classes of the view (the worker suggests one), then confirm explicitly: the
    suggestion when `classes` is None, else the given classes. Returns what happened."""
    r = call("POST", f"/api/projects/{pid}/views/{vid}/classes")
    if r.get("_error"):
        return f"classes job refused: {str(r)[:80]}"
    wait_job(r["job_id"], "classes_view")
    view = next(v for v in call("GET", f"/api/projects/{pid}/sheets/{sheet_id}/views")["views"] if v["id"] == vid)
    chosen = classes if classes else view["structural_classes"]
    if not chosen:
        return "no suggestion and no classes given: not confirmed"
    call("PATCH", f"/api/projects/{pid}/views/{vid}", {"who": WHO, "structural_classes": chosen})
    return "confirmed the suggestion" if classes is None else "confirmed the study classes"


def run_link(pid: str, vid: str) -> dict:
    r = call("POST", f"/api/projects/{pid}/views/{vid}/link")
    if r.get("_error"):
        return {"error": r}
    wait_job(r["job_id"], "link_view")
    return {}


def prepare_pages(pid: str, job: str, data: dict) -> dict:
    sheets = {s["page_number"]: s for s in call("GET", f"/api/projects/{pid}/sheets")["sheets"]}
    pages = sorted({lab["page"] for lab in data["labels"].values()})
    log: dict[int, dict] = {}
    for pg in pages:
        sh = sheets[pg]
        entry: dict = {"page_type": sh["page_type"]["effective"]}
        # every sheet needs an explicit decision (Phase 5c): the harness decides "include" for the gold pages
        # and records whether that went against the page type guess
        if sh["takeoff"]["decision"] != "include":
            call("PATCH", f"/api/projects/{pid}/sheets/{sh['id']}/takeoff", {"value": "include", "editor": WHO})
            entry["explicit_decision"] = "include"
            if sh["takeoff"]["suggestion"] != "include":
                entry["switched_to_include"] = True  # against the guess
        views = call("GET", f"/api/projects/{pid}/sheets/{sh['id']}/views")["views"]
        if views:
            v = views[0]
        else:
            bbs = [lab["bbox"] for lab in data["labels"].values() if lab["page"] == pg]
            if sh["whole_sheet"]["available"]:
                v = call("POST", f"/api/projects/{pid}/sheets/{sh['id']}/views", {"whole_sheet": True, "who": WHO})
                entry["view"] = "whole_sheet"
            else:
                box = {
                    "x0": max(0, min(b[0] for b in bbs) - MARGIN),
                    "y0": max(0, min(b[1] for b in bbs) - MARGIN),
                    "x1": min(sh["page"]["width_pt"], max(b[2] for b in bbs) + MARGIN),
                    "y1": min(sh["page"]["height_pt"], max(b[3] for b in bbs) + MARGIN),
                }
                v = call("POST", f"/api/projects/{pid}/sheets/{sh['id']}/views", {"box": box, "who": WHO})
                entry["view"] = "box_around_labels"
        entry["scales_on_sheet"] = len(sh["scales_found"])
        if not v["scale"]["confirmed"]:
            sug = v.get("suggestion")
            if sug:
                call("PATCH", f"/api/projects/{pid}/views/{v['id']}", {"who": WHO, "scale": {"action": "confirm_suggestion"}})
                entry["scale"] = f"detected ({sug['where']})" + (" ambiguous" if sug["ambiguous"] else "")
            else:
                ratios = [s for s in sh["scales_found"] if s.get("ratio")]
                if ratios:
                    best = max(ratios, key=lambda s: s["count"])
                    call("PATCH", f"/api/projects/{pid}/views/{v['id']}", {"who": WHO, "scale": {"action": "set", "ratio": best["ratio"]}})
                    entry["scale"] = "typed (most common scale on the sheet)"
                elif os.environ.get("CALIBRATION_ASSUME_SCALE"):
                    # parity only: the rule does not depend on the scale; lengths are not meaningful
                    call("PATCH", f"/api/projects/{pid}/views/{v['id']}", {"who": WHO, "scale": {"action": "set", "ratio": float(os.environ["CALIBRATION_ASSUME_SCALE"])}})
                    entry["scale"] = "typed (assumed, parity only: the sheet has no scale)"
                else:
                    entry["scale"] = "skipped (no scale on the sheet)"
        else:
            src = v["scale"]["source"]
            entry["scale"] = "already confirmed (" + ("detected" if src == "detected_text" else "typed") + ")"
            entry["view"] = "existing: " + str(v.get("name"))
        entry["view_id"] = v["id"]
        entry["sheet_id"] = sh["id"]
        log[pg] = entry
    return log


def snapshot(pid: str) -> list[dict]:
    return call("GET", f"/api/projects/{pid}/members?include_deleted=true")["members"]


def compare(data: dict, members: list[dict], sheet_of: dict) -> dict:
    page_of_sheet = {v["sheet_id"]: pg for pg, v in sheet_of.items()}
    by_page = collections.defaultdict(list)
    for m in members:
        by_page[page_of_sheet.get(m["sheet_id"])].append(m)
    rows = []
    for lid, lab in data["labels"].items():
        if lab["split"] != "validation":
            continue
        cx, cy = (lab["bbox"][0] + lab["bbox"][2]) / 2, (lab["bbox"][1] + lab["bbox"][3]) / 2
        best = None
        for m in by_page.get(lab["page"], []):
            b = m["bbox"]
            if not b:
                continue
            d = abs((b["x0"] + b["x1"]) / 2 - cx) + abs((b["y0"] + b["y1"]) / 2 - cy)
            if d < 4 and (best is None or d < best[0]):
                best = (d, m)
        row = {"id": lid, "page": lab["page"], "gold": lab["gold"]}
        if lab["gold"] == "not_member_label":
            row["excluded"] = True  # the study leaves these out of top-1
        if best is None:
            row["state"] = "not_in_view"
        else:
            m = best[1]
            row["color"] = m["status"]["color"]
            row["system_color"] = m["system"]["color"] if m["system"] else None
            row["shared_line"] = bool(m["shared_line"] and not m["shared_line"]["resolved"])
            if m["status"]["color"] == "unlinked":
                row["state"] = "unlinked"
            else:
                row["state"] = "linked"
                gl = lab["gold_line"]
                row["correct"] = bool(gl and m["link"]["line"] and same_line(m["link"]["line"], gl))
        rows.append(row)
    return {"rows": rows}


def whole_page_mix(members: list[dict], sheet_of: dict) -> dict:
    page_of_sheet = {v["sheet_id"]: pg for pg, v in sheet_of.items()}
    mix = collections.Counter()
    for m in members:
        if m["sheet_id"] not in page_of_sheet or m["deleted"] or m["not_member"]:
            continue
        c = m["status"]["color"]
        if c == "unlinked":
            mix["unlinked"] += 1
        else:
            mix[c] += 1
            if m.get("length_shared"):
                mix["length_not_trusted (shared line)"] += 1
            sl = m["shared_line"]
            if sl and sl.get("duplicate_of"):
                mix["true_duplicate_candidate"] += 1
            if m.get("existing"):
                mix["existing"] += 1
    return dict(mix)


def run_job(job: str) -> dict:
    data = load_study(job)
    pid = ensure_project(job)
    wait_scan(pid)
    ensure_text(pid)
    log = prepare_pages(pid, job, data)
    prior = (json.loads((STUDY / OUT_NAME).read_text()).get(job, {}).get("pages", {})
             if (STUDY / OUT_NAME).exists() else {})
    for pg, entry in log.items():  # keep what the first run recorded about pages that were already prepared
        old = prior.get(str(pg))
        if old and entry["scale"].startswith("already confirmed") and not old["scale"].startswith("skipped"):
            entry.update({k: old[k] for k in ("scale", "view", "switched_to_include") if k in old})
    result: dict = {"project": pid, "pages": {str(k): {kk: vv for kk, vv in v.items() if kk not in ("view_id", "sheet_id")} for k, v in log.items()}}
    result["study"] = {"n": data["study"]["n"], "correct": data["study"]["correct"]}
    for run in ("suggested_classes", "study_classes"):
        for pg, entry in log.items():
            if entry["scale"].startswith("skipped"):
                continue
            cls = data["classes"].get(str(pg - 1), {}).get("structural") if run == "study_classes" else None
            how = show_and_confirm(pid, entry["sheet_id"], entry["view_id"], cls)
            entry.setdefault("classes", {})[run] = how
            err = run_link(pid, entry["view_id"])
            if err:
                entry.setdefault("link_error", str(err)[:120])
        members = snapshot(pid)
        cmp = compare(data, members, log)
        cmp["page_mix"] = whole_page_mix(members, log)
        result[run] = cmp
    return result


def summarise(job: str, res: dict) -> None:
    print(f"\n== {job}  (study: {res['study']['correct']}/{res['study']['n']} correct)")
    print("   pages:", {p: v["scale"] + " / " + v.get("view", "existing view") for p, v in res["pages"].items()})
    for run in ("suggested_classes", "study_classes"):
        rows = [r for r in res[run]["rows"] if not r.get("excluded")]
        correct = sum(1 for r in rows if r.get("correct"))
        states = collections.Counter(r["state"] for r in rows)
        print(f"   {run}: labels {len(rows)}, top-1 correct {correct}, {dict(states)}; whole pages {res[run]['page_mix']}")


if __name__ == "__main__":
    jobs = sys.argv[1:] or JOBS
    out_path = STUDY / OUT_NAME
    allres = json.loads(out_path.read_text()) if out_path.exists() else {}
    for job in jobs:
        allres[job] = run_job(job)
        out_path.write_text(json.dumps(allres, indent=1))
        summarise(job, allres[job])
