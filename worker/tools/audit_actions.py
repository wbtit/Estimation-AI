"""Session preparation step 1: who did what in which project (read-only).

  PYTHONPATH=. .venv/bin/python -m tools.audit_actions [--json PATH]

One row per project: id, purpose, archived, group (a fixed internal prefix list; the project name
itself is never printed), user actions by type, first / last action time and whether any non-system
action exists. People are shown as "owner" (the actor with the most rows) or "other N", never by
name. Then every project and page that holds owner actions; measurement projects are listed apart
(they must not be changed). Runs in a READ ONLY transaction.
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path
from typing import Any

from psycopg.rows import tuple_row

from src.config import load_config
from src.db import connect

PREFIXES = (
    "p12a", "p12b", "p12c", "phase6b", "phase11r", "phase11", "phase12", "measure", "dryrun",
    "synthetic", "demo3", "demo", "pilot", "job",
)  # fmt: skip
MEASUREMENT_PREFIXES = ("p12b", "phase11r", "phase11", "p12c")
SYSTEM = frozenset({"system"})

# (type, SQL giving project_id, sheet_id, who, created_at) per user-action row
SOURCES: dict[str, str] = {
    "count_actions": "SELECT project_id, sheet_id, who, created_at, action FROM count_actions",
    "edits": "SELECT m.project_id, m.sheet_id, e.reviewer, e.created_at, NULL FROM member_edits e"
    " JOIN members m ON m.id = e.member_id WHERE e.field_name <> 'approved'",
    "approvals": "SELECT m.project_id, m.sheet_id, e.reviewer, e.created_at, NULL"
    " FROM member_edits e JOIN members m ON m.id = e.member_id WHERE e.field_name = 'approved'",
    "deselections": "SELECT s.project_id, s.id, d.created_by, d.created_at, NULL"
    " FROM view_deselections d JOIN build_views v ON v.id = d.view_id"
    " JOIN sheets s ON s.id = v.sheet_id",
    "exclusions": "SELECT s.project_id, s.id, x.created_by, x.created_at, NULL"
    " FROM view_exclusions x JOIN build_views v ON v.id = x.view_id"
    " JOIN sheets s ON s.id = v.sheet_id",
    "draws": "SELECT project_id, sheet_id, NULL, created_at, NULL FROM members"
    " WHERE origin = 'manual'",
    "sheet_edits": "SELECT s.project_id, s.id, e.editor, e.created_at, NULL FROM sheet_edits e"
    " JOIN sheets s ON s.id = e.sheet_id",
    "measurements": "SELECT project_id, sheet_id, created_by, created_at, NULL FROM measurements",
    "view_undo": "SELECT project_id, sheet_id, who, created_at, NULL FROM view_undo",
    "pages_saved": "SELECT project_id, id, reviewed_by, reviewed_at, NULL FROM sheets"
    " WHERE reviewed_by IS NOT NULL",
    "build_runs": "SELECT project_id, sheet_id, requested_by, started_at, mode FROM build_runs",
}
COUNT_ONLY = {
    "build_snapshots": "SELECT project_id, count(*) FROM build_snapshots GROUP BY 1",
    "auto_builds": "SELECT project_id, count(*) FROM auto_builds GROUP BY 1",
}


def group_of(name: str) -> str:
    """The fixed internal prefix (or 'other'); never the name."""
    head = name.split("-", 1)[0] if "-" in name else ""
    prefix = head if head in PREFIXES else "other"
    return prefix


def is_measurement(group: str, purpose: str) -> bool:
    return group in MEASUREMENT_PREFIXES or purpose == "evaluation"


def actor_labels(counts: collections.Counter) -> dict[str, str]:
    """owner = the non-system actor with the most rows; others numbered by count, then order."""
    people = sorted((w for w in counts if w and w not in SYSTEM), key=lambda w: (-counts[w], w))
    return {w: ("owner" if i == 0 else f"other {i}") for i, w in enumerate(people)}


def audit(rows: dict[str, list[tuple]], projects: list[dict], extra: dict[str, dict]) -> dict:
    """Pure: the per-project table and the owner page list from the raw rows."""
    who_counts: collections.Counter = collections.Counter()
    for src in rows.values():
        who_counts.update(r[2] for r in src if r[2])
    labels = actor_labels(who_counts)
    out: dict[str, dict[str, Any]] = {}
    for p in projects:
        g = group_of(p["name"])
        out[p["id"]] = {
            "purpose": p["purpose"],
            "archived": p["archived"],
            "group": g,
            "measurement": is_measurement(g, p["purpose"]),
            "counts": collections.Counter(),
            "actors": collections.Counter(),
            "first": None,
            "last": None,
        }
    pages: dict[tuple[str, str], collections.Counter] = collections.defaultdict(collections.Counter)
    for typ, src in rows.items():
        for pid, sid, who, at, sub in src:
            if pid not in out:
                continue
            o = out[pid]
            person = typ == "draws" or (who is not None and who not in SYSTEM)
            key = f"{typ}:{sub}" if typ in ("count_actions", "build_runs") and sub else typ
            o["counts"][key] += 1
            if not person:
                continue
            label = labels.get(who, "owner") if who else "unknown"
            o["actors"][label] += 1
            if at is not None:
                o["first"] = at if o["first"] is None else min(o["first"], at)
                o["last"] = at if o["last"] is None else max(o["last"], at)
            if label == "owner" and sid:
                pages[(pid, sid)][typ] += 1
    for typ, by_project in extra.items():
        for pid, n in by_project.items():
            if pid in out:
                out[pid]["counts"][typ] += n
    for o in out.values():
        o["non_system"] = sum(o["actors"].values()) > 0
    return {"projects": out, "owner_pages": pages, "actors": sorted(set(labels.values()))}


def _fmt(t) -> str:
    return t.strftime("%Y-%m-%d %H:%M") if t else "-"


def report(res: dict, page_index: dict[str, int]) -> str:
    ps = res["projects"]
    L = ["# Action audit (ids only)", "", f"Actors: {', '.join(res['actors'])} (+ system)", ""]
    sections = [
        ("Active projects (not archived)", lambda o: not o["archived"]),
        ("Measurement projects (never changed)", lambda o: o["archived"] and o["measurement"]),
        ("Other archived projects", lambda o: o["archived"] and not o["measurement"]),
    ]
    for title, keep in sections:
        sel = [(pid, o) for pid, o in ps.items() if keep(o)]
        sel.sort(key=lambda x: (not x[1]["non_system"], x[1]["group"], x[0]))
        L += [f"## {title}: {len(sel)}", ""]
        L += ["| project | purpose | group | non-system | actors | first | last | actions |"]
        L += ["|---|---|---|---|---|---|---|---|"]
        for pid, o in sel:
            if not o["non_system"] and not o["counts"]:
                continue
            acts = ", ".join(f"{k} {n}" for k, n in sorted(o["counts"].items()))
            who = ", ".join(f"{k} {n}" for k, n in sorted(o["actors"].items())) or "-"
            L.append(
                f"| {pid} | {o['purpose']} | {o['group']} | {'yes' if o['non_system'] else 'no'}"
                f" | {who} | {_fmt(o['first'])} | {_fmt(o['last'])} | {acts or '-'} |"
            )
        quiet = sum(1 for _, o in sel if not o["non_system"] and not o["counts"])
        L += ["", f"({quiet} more with no rows at all)", ""]
    L += ["## Pages with owner actions", ""]
    by_proj: dict[str, list] = collections.defaultdict(list)
    for (pid, sid), c in res["owner_pages"].items():
        by_proj[pid].append((page_index.get(sid, -1), sid, c))
    for pid in sorted(by_proj, key=lambda p: (ps[p]["measurement"], p)):
        o = ps[pid]
        tag = " **MEASUREMENT: do not change**" if o["measurement"] else ""
        L.append(f"- {pid} ({o['purpose']}, {o['group']}, archived={o['archived']}){tag}")
        for idx, sid, c in sorted(by_proj[pid]):
            what = ", ".join(f"{k} {n}" for k, n in sorted(c.items()))
            L.append(f"  - page {idx + 1} ({sid}): {what}")
    return "\n".join(L) + "\n"


def main(argv: list[str]) -> None:
    config = load_config()
    conn = connect(config.database_url)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")

    def q(sql: str) -> list[tuple]:
        return conn.cursor(row_factory=tuple_row).execute(sql).fetchall()

    projects = [
        {"id": str(r[0]), "name": r[1], "purpose": r[2], "archived": r[3]}
        for r in q("SELECT id, name, purpose, archived FROM projects")
    ]
    rows = {
        k: [(str(r[0]), str(r[1]) if r[1] else None, r[2], r[3], r[4]) for r in q(sql)]
        for k, sql in SOURCES.items()
    }
    extra = {k: {str(r[0]): r[1] for r in q(sql)} for k, sql in COUNT_ONLY.items()}
    page_index = {str(r[0]): r[1] for r in q("SELECT id, page_index FROM sheets")}
    conn.rollback()
    res = audit(rows, projects, extra)
    print(report(res, page_index))
    out = next((a.split("=", 1)[1] for a in argv if a.startswith("--json=")), None)
    if out:
        Path(out).write_text(json.dumps({
            pid: {**o, "counts": dict(o["counts"]), "actors": dict(o["actors"]),
                  "first": _fmt(o["first"]), "last": _fmt(o["last"])}
            for pid, o in res["projects"].items()
        }, indent=1))  # fmt: skip


if __name__ == "__main__":
    main(sys.argv[1:])
