"""Phase 14a backfill: the view title and title-block name of existing pages (sheet_names).

  PYTHONPATH=. .venv/bin/python -m tools.sheet_names (--project ID | --non-evaluation) [--apply]

Reads each page's stored text lines and drawn lines; without --apply nothing is written (a dry
run). With --apply it writes only the name columns of the sheets (migration 028). Evaluation
(measurement) projects are never read or written. Prints ids and counts only, never the text.
"""

from __future__ import annotations

import json
import sys
from collections import Counter

from src.build.sheet_names import RULES_VERSION, read_project, store
from src.config import load_config
from src.db import connect


def main(argv: list[str]) -> None:
    opts = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
    flags = {a for a in argv if a.startswith("--") and "=" not in a}
    apply = "--apply" in flags
    conn = connect(load_config().database_url)
    if opts.get("project"):
        projects = conn.execute(
            "SELECT id, purpose, archived FROM projects WHERE id = %s AND purpose <> 'evaluation'",
            (opts["project"],),
        ).fetchall()
    elif "--non-evaluation" in flags:
        projects = conn.execute(
            "SELECT id, purpose, archived FROM projects WHERE purpose <> 'evaluation' ORDER BY id"
        ).fetchall()
    else:
        print(__doc__)
        raise SystemExit(2)
    total: Counter[str] = Counter()
    per_project = []
    for p in projects:
        c: Counter[str] = Counter()
        sheets = conn.execute(
            "SELECT * FROM sheets WHERE project_id = %s ORDER BY page_index", (p["id"],)
        ).fetchall()
        read = read_project(conn, sheets)
        for s in sheets:
            names = read[str(s["id"])]
            c["pages"] += 1
            c["with_view_title"] += names.view_title is not None
            c["with_several_view_titles"] += len(names.view_titles) > 1
            c["with_title_block_name"] += names.title_block_name is not None
            c[f"title_block_rule_{names.title_block_rule}"] += names.title_block_name is not None
            c["card_name_from_view_title"] += names.view_title is not None
            c["card_name_from_title_block"] += (
                names.view_title is None and names.title_block_name is not None
            )
            c["no_name"] += names.view_title is None and names.title_block_name is None
            c["view_title_scale_and_underline"] += any(
                v.scale and v.underlined for v in names.view_titles
            )
            if apply:
                store(conn, str(s["id"]), names)
        if apply:
            conn.commit()
        else:
            conn.rollback()
        total.update(c)
        per_project.append(
            {"project": str(p["id"])[:8], "purpose": p["purpose"], "archived": p["archived"], **c}
        )
    print(
        json.dumps(
            {"rules": RULES_VERSION, "applied": apply, "projects": per_project, "total": total},
            indent=1,
        )
    )


if __name__ == "__main__":
    main(sys.argv[1:])
