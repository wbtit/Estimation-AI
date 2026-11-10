"""Phase 0-14g regression harness: the branch must never be worse than main at finding an example.

Replays clicks through the worker's REAL job function (`src.build.similar_job.run_find_similar`)
on the app's REAL stored data (page_symbols, build_runs, grid_lines, the page-ink cache), once with
this branch's code and once with main's code (taken from `git archive <ref>` into a work folder and
run in a child process, so `src.*` is main's). Read-only: the database is opened READ ONLY, nothing
is written to the database, and a run whose page-ink cache file is missing is skipped (the job would
write it). No project data is stored in this file or printed with names: a project is an id given on
the command line.

    cd worker && .venv/bin/python -m measure.p14g_regress --project <project id>
    cd worker && .venv/bin/python -m measure.p14g_regress --session1
    options: --ref main  --work-dir <folder>  --json <out file>

Clicks: the recorded `find_similar` jobs of the project (their `click` points), or, with
--session1, the estimator's 30 drawn columns of session 1 page 5 (frozen export v1) with the
page's latest stored symbols. Exit 1 when any click that found an example on main finds none here.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parent

Item = dict[str, Any]  # {"sheet_id", "build_run_id", "click": [x, y], "label"}


def _connect(database_url: str):
    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(database_url, row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    return conn


def project_items(conn, project_id: str) -> list[Item]:
    """The distinct clicks of the project's recorded find_similar jobs."""
    sheets = [
        str(r["id"])
        for r in conn.execute("SELECT id FROM sheets WHERE project_id = %s", (project_id,))
    ]
    seen: set[tuple] = set()
    out: list[Item] = []
    for j in conn.execute(
        "SELECT payload FROM jobs WHERE type = 'find_similar' AND payload->>'sheet_id' = ANY(%s)"
        " ORDER BY created_at",
        (sheets,),
    ):
        p = j["payload"]
        key = (p["sheet_id"], p["build_run_id"], tuple(p["click"]))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {"sheet_id": p["sheet_id"], "build_run_id": p["build_run_id"],
             "click": list(p["click"]), "label": f"click {len(out) + 1}"}
        )  # fmt: skip
    return out


def session1_items(conn) -> list[Item]:
    """The 30 drawn columns of session 1 page 5 on the page's latest stored symbols."""
    from measure import p14b_columns as b

    pid = json.loads((b.EXPORT / "manifest.json").read_text())["project_id"]
    pieces = json.loads((b.EXPORT / "pieces_final.json").read_text())
    pages = {s["id"]: s["page_index"] for s in json.loads((b.EXPORT / "sheets.json").read_text())}
    truth = [
        tuple(p["a"])
        for p in pieces
        if pages.get(p["sheet_id"]) == b.PAGE5 and p["added"] and not p["deleted"]
    ]
    sheet = str(
        conn.execute(
            "SELECT id FROM sheets WHERE project_id = %s AND page_index = %s", (pid, b.PAGE5)
        ).fetchone()["id"]
    )
    run = str(
        conn.execute(
            "SELECT build_run_id FROM page_symbols WHERE sheet_id = %s ORDER BY created_at DESC"
            " LIMIT 1",
            (sheet,),
        ).fetchone()["build_run_id"]
    )
    return [
        {"sheet_id": sheet, "build_run_id": run, "click": list(t), "label": f"truth#{k}"}
        for k, t in enumerate(truth)
    ]


def _count(res: dict, t: float) -> int:
    return len([x for x in res["combined"] if x["score"] is None or x["score"] >= t - 1e-9])


def _summ(res: dict) -> dict:
    ex = res.get("example")
    return {
        "found": ex is not None,
        "source": ex["source"] if ex else None,
        "real_in": [round(v, 1) for v in ex["real_in"]] if ex else None,
        "refused": res.get("refused"),
        "warning": res.get("warning"),
        "n06": _count(res, 0.6) if ex else None,
        "n08": _count(res, 0.8) if ex else None,
        "points": [[*c["centre"], c["score"]] for c in res["combined"]] if ex else [],
        "runtime_s": res.get("runtime_s"),
    }


def run_items(database_url: str, upload_dir: Path, items: list[Item]) -> list[dict]:
    """Run each item through the real job function of the `src` package that is importable NOW."""
    from src.build import col_image
    from src.build.similar_job import run_find_similar
    from src.config import WorkerConfig
    from src.queue import Job

    cfg = WorkerConfig(
        database_url=database_url, poll_interval_seconds=2.0, lock_timeout_seconds=600.0,
        worker_id="p14g-regress", upload_dir=upload_dir,
    )  # fmt: skip
    out: list[dict] = []
    with _connect(database_url) as conn:
        for it in items:
            if not col_image.cache_path(upload_dir, it["build_run_id"]).exists():
                out.append({"found": None, "skipped": "no page-ink cache (the job would write it)"})
                continue
            job = Job("regress", "find_similar", {"sheet_id": it["sheet_id"],
                      "build_run_id": it["build_run_id"], "click": it["click"]}, 1, 1)  # fmt: skip
            out.append(_summ(run_find_similar(conn, job, cfg)))
    return out


def _child(src_dir: str, items_file: str, out_file: str, upload_dir: str, database_url: str):
    sys.path.insert(0, src_dir)
    items = json.loads(Path(items_file).read_text())
    res = run_items(database_url, Path(upload_dir), items)
    Path(out_file).write_text(json.dumps(res))


def run_ref(ref: str, work: Path, database_url: str, upload_dir: Path, items: list[Item]):
    """The same items through the job function of git ref `ref` (a child process on its own copy
    of worker/src, so nothing of this branch is imported there)."""
    tree = work / f"ref-{ref.replace('/', '_')}"
    tree.mkdir(parents=True, exist_ok=True)
    tar = subprocess.run(["git", "archive", ref, "worker/src"], cwd=ROOT, capture_output=True,
                         check=True)  # fmt: skip
    subprocess.run(["tar", "-x", "-C", str(tree)], input=tar.stdout, check=True)
    items_file, out_file = work / "items.json", work / f"out-{tree.name}.json"
    items_file.write_text(json.dumps(items))
    subprocess.run(
        [sys.executable, "-I", str(Path(__file__).resolve()), "--child", str(tree / "worker"),
         str(items_file), str(out_file), str(upload_dir), database_url],
        check=True, cwd=WORKER,
    )  # fmt: skip
    return json.loads(out_file.read_text())


def compare(items: list[Item], old: list[dict], new: list[dict]) -> dict:
    rows, reg = [], []
    same = 0
    for it, o, n in zip(items, old, new, strict=True):
        if o.get("found") is None or n.get("found") is None:
            rows.append((it["label"], "skipped", "skipped"))
            continue
        if o["found"] and not n["found"]:
            reg.append(it["label"])
        if (
            o["found"]
            and n["found"]
            and o["real_in"] == n["real_in"]
            and o["source"] == n["source"]
        ):
            same += 1
        rows.append((it["label"], o, n))
    got = [(o, n) for _l, o, n in rows if o != "skipped"]
    return {
        "clicks": len(items),
        "skipped": len(items) - len(got),
        "old_found": sum(1 for o, _n in got if o["found"]),
        "new_found": sum(1 for _o, n in got if n["found"]),
        "regressions": reg,
        "new_only": sum(1 for o, n in got if n["found"] and not o["found"]),
        "same_example": same,
        "new_with_warning": sum(1 for _o, n in got if n["found"] and n.get("warning")),
        "rows": rows,
    }


def _show(r: dict) -> str:
    if not r["found"]:
        return "REFUSED"
    tail = " [warning]" if r["warning"] else ""
    return f"{r['source']} {r['real_in']} n@0.6 {r['n06']} n@0.8 {r['n08']}{tail}"


def main(argv: list[str]) -> int:
    if len(argv) > 1 and argv[1] == "--child":
        _child(*argv[2:7])
        return 0
    ap = argparse.ArgumentParser()
    ap.add_argument("--project")
    ap.add_argument("--session1", action="store_true")
    ap.add_argument("--ref", default="main")
    ap.add_argument("--work-dir")
    ap.add_argument("--json")
    a = ap.parse_args(argv[1:])
    if bool(a.project) == a.session1:
        ap.error("give exactly one of --project <id> or --session1")
    sys.path.insert(0, str(WORKER))
    from src.config import load_config

    cfg = load_config()
    with _connect(cfg.database_url) as conn:
        items = session1_items(conn) if a.session1 else project_items(conn, a.project)
    work = Path(a.work_dir) if a.work_dir else Path(tempfile.mkdtemp(prefix="p14g-regress-"))
    work.mkdir(parents=True, exist_ok=True)
    old = run_ref(a.ref, work, cfg.database_url, cfg.upload_dir, items)
    new = run_items(cfg.database_url, cfg.upload_dir, items)
    res = compare(items, old, new)
    for label, o, n in res["rows"]:
        if o == "skipped":
            print(f"{label}: skipped")
            continue
        flag = "  <-- REGRESSION" if o["found"] and not n["found"] else ""
        print(f"{label}: {a.ref} {_show(o)} | branch {_show(n)}{flag}")
    print(
        f"clicks {res['clicks']} (skipped {res['skipped']}) | {a.ref} found {res['old_found']} |"
        f" branch found {res['new_found']} | found on {a.ref} but not on branch:"
        f" {len(res['regressions'])} | branch only: {res['new_only']} | same example:"
        f" {res['same_example']} | branch examples with the ink warning: {res['new_with_warning']}"
    )
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1, default=str))
    return 1 if res["regressions"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
