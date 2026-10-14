"""Read-only preview of one project: row counts per table (nothing is changed or deleted).

  PYTHONPATH=. .venv/bin/python -m tools.project_preview <project id prefix>

A project may be removed only when EVERY count below is zero (the owner's rule); this tool never
deletes. The project row itself, its file record, its sheets and its jobs all count.
"""

from __future__ import annotations

import sys

from tools.takeoff.phase6c_trace import connect

QUERIES = {
    "projects": "SELECT count(*) AS n FROM projects WHERE id = %(p)s",
    "project_files": "SELECT count(*) AS n FROM project_files WHERE project_id = %(p)s",
    "project_grade_rules": "SELECT count(*) AS n FROM project_grade_rules WHERE project_id = %(p)s",
    "sheets": "SELECT count(*) AS n FROM sheets WHERE project_id = %(p)s",
    "sheet_views": (
        "SELECT count(*) AS n FROM sheet_views v JOIN sheets s ON s.id = v.sheet_id"
        " WHERE s.project_id = %(p)s"
    ),
    "sheet_edits": (
        "SELECT count(*) AS n FROM sheet_edits e JOIN sheets s ON s.id = e.sheet_id"
        " WHERE s.project_id = %(p)s"
    ),
    "text_items": (
        "SELECT count(*) AS n FROM text_items t JOIN sheets s ON s.id = t.sheet_id"
        " WHERE s.project_id = %(p)s"
    ),
    "legend_rows": "SELECT count(*) AS n FROM legend_rows WHERE project_id = %(p)s",
    "members": "SELECT count(*) AS n FROM members WHERE project_id = %(p)s",
    "member_edits": (
        "SELECT count(*) AS n FROM member_edits e JOIN members m ON m.id = e.member_id"
        " WHERE m.project_id = %(p)s"
    ),
    "jobs": "SELECT count(*) AS n FROM jobs WHERE payload->>'project_id' = %(ps)s",
}


def preview(prefix: str) -> dict[str, int]:
    conn = connect()
    rows = conn.execute(
        "SELECT id FROM projects WHERE id::text LIKE %s", (prefix + "%",)
    ).fetchall()
    if len(rows) != 1:
        raise SystemExit(f"prefix matches {len(rows)} projects; give a longer prefix")
    pid = rows[0]["id"]
    return {
        name: conn.execute(q, {"p": pid, "ps": str(pid)}).fetchone()["n"]
        for name, q in QUERIES.items()
    }


if __name__ == "__main__":
    counts = preview(sys.argv[1])
    for name, n in counts.items():
        print(f"{name:20s} {n}")
    print("all zero:", all(n == 0 for n in counts.values()))
