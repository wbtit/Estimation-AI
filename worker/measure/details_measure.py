"""Cover details measurement (read-only): tick tables for the owner, then the score.

    cd worker && .venv/bin/python -m measure.details_measure run --projects <ids.json> [--out DIR]
    cd worker && .venv/bin/python -m measure.details_measure score --dir DIR

Pre-registration: worker/prereg/PHASE0_COVER_DETAILS_PREREGISTRATION.md.

`run`: for each project of the list (full project ids from measure.details_candidates) the reader
runs on the project's stored PDF and the app's stored sheet data (`src.details.job.read_project`,
the job's own code; NOTHING is written to the database). Per project it writes `DIR/<project
id>.md`, a tick table with the REAL values (field, value, source page, rule, confidence, a column
to write y or n) and the index check (rows, flags, a column to write y or n), and prints counts and
timing only. The tables contain real values, so DIR is under fixtures/private/ (git-ignored) and is
never printed.
`score`: reads the ticked tables and reports fields found / correct, wrong fields with HIGH
confidence, fields the owner marked missing, index rows matched and flags confirmed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parent
sys.path.insert(0, str(WORKER))
DEFAULT_OUT = ROOT / "fixtures" / "private" / "details"


# Addendum 2: the owner's tick tables carry only these four fields (the reader reads more).
SHOWN = {
    "project_name": "project name",
    "owner": "client",
    "location": "location",
    "building_type": "building type (suggested)",
}


def _esc(v: object) -> str:
    return str(v).replace("|", "/").replace("\n", " ")


def table(pid: str, res, info: dict, names: dict[int, str | None]) -> str:
    out = [f"# Project {pid[:8]} — cover details (tick the last column: y = right, n = wrong)", ""]
    out.append(
        f"Cover pages: {[p + 1 for p in res.cover_pages]} · pages {info['pages']} · "
        f"fields of this table: {', '.join(f'{k} = {v}' for k, v in SHOWN.items())} · "
        f"read in {info['seconds']} s · "
        f"no text on cover pages: {[p + 1 for p in res.no_text_pages]}"
    )
    out += [
        "",
        "## Fields",
        "",
        "| field | value | page | rule | confidence | right? |",
        "|---|---|---|---|---|---|",
    ]
    for d in (res.fields[k] for k in SHOWN if k in res.fields):
        flag = " (conflict)" if "conflict" in d.flags else ""
        out.append(
            f"| {d.field} | {_esc(d.value)} | {d.page_index + 1} | {d.rule} |"
            f" {d.confidence}{flag} |  |"
        )
    out += [
        "",
        "Of the four fields, those that are on the cover but were left empty (write them here, one "
        "per line):",
        "",
        "- ",
        "",
    ]
    out += [
        "## Drawing index rows (right? = the row is read correctly)",
        "",
        "| number | title | matched page | match | right? |",
        "|---|---|---|---|---|",
    ]
    for r in res.index_rows:
        mp = "" if r.matched_page is None else r.matched_page + 1
        out.append(f"| {r.number} | {_esc(r.title)} | {mp} | {r.match} |  |")
    out += ["", "## Index flags (real? = the flag is a real problem)", "",
            "| kind | about | real? |", "|---|---|---|"]  # fmt: skip
    for f in res.index_flags:
        about = " ".join(str(x) for x in (f.number, f.title, f.detail) if x)
        out.append(f"| {f.kind} | {_esc(about)} | |")
    return "\n".join(out) + "\n"


def run(args: argparse.Namespace) -> int:
    import psycopg
    from dotenv import load_dotenv
    from psycopg.rows import dict_row

    from src.details.job import read_project

    load_dotenv(ROOT / ".env")
    conn = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    cfg = SimpleNamespace(upload_dir=ROOT / os.environ.get("UPLOAD_DIR", "uploads"))
    projects = json.loads(Path(args.projects).read_text())
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = []
    for p in projects:
        pid = p["project_id"]
        t0 = time.perf_counter()
        res, info = read_project(conn, cfg, pid)
        total = time.perf_counter() - t0
        (out_dir / f"{pid[:8]}.md").write_text(table(pid, res, info, {}))
        by_conf = Counter(res.fields[k].confidence for k in SHOWN if k in res.fields)
        flags = Counter(f.kind for f in res.index_flags)
        matched = sum(r.match != "none" for r in res.index_rows)
        summary.append(
            {
                "project": pid[:8],
                "pages": info["pages"],
                "seconds": round(total, 2),
                "seconds_per_page": round(total / max(1, info["pages"]), 4),
                "fields_found": sum(k in res.fields for k in SHOWN),
                "by_confidence": dict(by_conf),
                "shown_fields": [k for k in SHOWN if k in res.fields],
                "conflicts": sum(
                    "conflict" in res.fields[k].flags for k in SHOWN if k in res.fields
                ),
                "no_text_cover_pages": len(res.no_text_pages),
                "index_rows": len(res.index_rows),
                "index_rows_matched": matched,
                "flags": dict(flags),
            }
        )
    print(json.dumps(summary, indent=1))
    if args.json:
        Path(args.json).write_text(json.dumps(summary, indent=1))
    return 0


ROW = re.compile(r"^\|(.+)\|\s*$")


def _section(lines: list[str], title: str) -> list[list[str]]:
    rows, on = [], False
    for ln in lines:
        if ln.startswith("## "):
            on = ln.startswith(f"## {title}")
            continue
        m = ROW.match(ln)
        if on and m and not set(ln.replace("|", "").strip()) <= set("-: "):
            cells = [c.strip() for c in m.group(1).split("|")]
            if cells and cells[0] not in ("field", "number", "kind"):
                rows.append(cells)
    return rows


def score(args: argparse.Namespace) -> int:
    per = []
    for path in sorted(Path(args.dir).glob("*.md")):
        lines = path.read_text().splitlines()
        fields = _section(lines, "Fields")
        rows = _section(lines, "Drawing index rows")
        flags = _section(lines, "Index flags")
        ticked = [r for r in fields if r[-1].lower() in ("y", "n")]
        right = [r for r in ticked if r[-1].lower() == "y"]
        wrong = [r for r in ticked if r[-1].lower() == "n"]
        high_wrong = [r[0] for r in wrong if r[4].startswith("high")]
        missing = [
            ln for ln in lines
            if ln.strip().startswith("- ") and ln.strip() not in ("-", "- ")
        ]  # fmt: skip
        rticked = [r for r in rows if r[-1].lower() in ("y", "n")]
        matched = [r for r in rows if r[3] in ("exact", "equivalent")]
        ftick = [r for r in flags if r[-1].lower() in ("y", "n")]
        per.append(
            {
                "project": path.stem,
                "fields_found": len(fields),
                "ticked": len(ticked),
                "correct": len(right),
                "wrong": len(wrong),
                "wrong_high_confidence": high_wrong,
                "missing_marked": len(missing),
                "index_rows": len(rows),
                "index_rows_read_right": sum(r[-1].lower() == "y" for r in rticked),
                "index_rows_matched": len(matched),
                "flags": len(flags),
                "flags_real": sum(r[-1].lower() == "y" for r in ftick),
                "flags_false": sum(r[-1].lower() == "n" for r in ftick),
            }
        )
    t = lambda k: sum(p[k] for p in per)  # noqa: E731
    total = {
        "projects": len(per),
        "fields_found": t("fields_found"),
        "fields_ticked": t("ticked"),
        "fields_correct": t("correct"),
        "percent_correct_of_ticked": round(100 * t("correct") / t("ticked"), 1)
        if t("ticked")
        else None,
        "projects_over_1_wrong_high": [
            p["project"] for p in per if len(p["wrong_high_confidence"]) > 1
        ],
        "wrong_high_confidence_total": sum(len(p["wrong_high_confidence"]) for p in per),
        "missing_marked": t("missing_marked"),
        "index_rows": t("index_rows"),
        "index_rows_matched": t("index_rows_matched"),
        "percent_index_rows_matched": round(100 * t("index_rows_matched") / t("index_rows"), 1)
        if t("index_rows")
        else None,
        "flags_real": t("flags_real"),
        "flags_false": t("flags_false"),
    }
    print(json.dumps({"total": total, "per_project": per}, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--projects", required=True)
    r.add_argument("--out", default=str(DEFAULT_OUT))
    r.add_argument("--json")
    s = sub.add_parser("score")
    s.add_argument("--dir", default=str(DEFAULT_OUT))
    a = ap.parse_args()
    return run(a) if a.cmd == "run" else score(a)


if __name__ == "__main__":
    raise SystemExit(main())
