"""Copy a project as a clean pilot project (pilot preparation, step 3).

What is copied: the project settings (a new id and the given name, count mode OFF), the PDF (a new
stored copy, so deleting one project never removes the other's file) and the page thumbnails, every
sheet with its stored columns and sheet decisions (`sheet_edits`, e.g. in or out of the takeoff),
its views (box, scale, line classes), its extracted lines (`sheet_lines`), its text items, the
legend rows, the project's grade rules, and every member the SYSTEM made (origin other than
`manual`) with its stored values and its count state reset to an undecided suggestion.

What is NOT copied: members a person added (manual, including count clicks), every member edit
(person corrections), the count action log, measurements, pipeline job rows and the project's prefix
mapping. The source project is only read.

`apply=False` is a preview (counts only, nothing written). The copy runs in ONE transaction.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql

from src.config import WorkerConfig

# tables keyed by project / sheet that are copied, in insert order
SHEET_TABLES = ("sheet_edits", "sheet_views", "sheet_lines", "text_items")
NOT_COPIED = ("member_edits", "count_actions", "measurements", "project_prefix_kinds")


def source_counts(conn: psycopg.Connection, project_id: str) -> dict[str, int]:
    """Row counts of everything that belongs to a project (to preview and to prove it unchanged)."""
    one = lambda q: conn.execute(q, (project_id,)).fetchone()["n"]  # noqa: E731
    sheets = "SELECT id FROM sheets WHERE project_id = %s"
    members = "SELECT id FROM members WHERE project_id = %s"
    return {
        "project_files": one("SELECT count(*) n FROM project_files WHERE project_id = %s"),
        "sheets": one("SELECT count(*) n FROM sheets WHERE project_id = %s"),
        "sheet_edits": one(f"SELECT count(*) n FROM sheet_edits WHERE sheet_id IN ({sheets})"),
        "sheet_views": one(f"SELECT count(*) n FROM sheet_views WHERE sheet_id IN ({sheets})"),
        "sheet_lines": one(f"SELECT count(*) n FROM sheet_lines WHERE sheet_id IN ({sheets})"),
        "text_items": one(f"SELECT count(*) n FROM text_items WHERE sheet_id IN ({sheets})"),
        "legend_rows": one("SELECT count(*) n FROM legend_rows WHERE project_id = %s"),
        "project_grade_rules": one(
            "SELECT count(*) n FROM project_grade_rules WHERE project_id = %s"
        ),
        "members": one("SELECT count(*) n FROM members WHERE project_id = %s"),
        "members_system": one(
            "SELECT count(*) n FROM members WHERE project_id = %s AND origin <> 'manual'"
        ),
        "members_manual": one(
            "SELECT count(*) n FROM members WHERE project_id = %s AND origin = 'manual'"
        ),
        "member_edits": one(f"SELECT count(*) n FROM member_edits WHERE member_id IN ({members})"),
        "count_actions": one("SELECT count(*) n FROM count_actions WHERE project_id = %s"),
        "measurements": one("SELECT count(*) n FROM measurements WHERE project_id = %s"),
        "project_prefix_kinds": one(
            "SELECT count(*) n FROM project_prefix_kinds WHERE project_id = %s"
        ),
    }


def content_hash(conn: psycopg.Connection, project_id: str) -> dict[str, str]:
    """md5 of the project's own rows (members, sheets, member edits), to prove nothing changed."""
    q = lambda body: conn.execute(body, (project_id,)).fetchone()["h"]  # noqa: E731
    return {
        "members": q(
            "SELECT md5(coalesce(string_agg(m::text, '|' ORDER BY m.id), '')) h"
            " FROM members m WHERE m.project_id = %s"
        ),
        "sheets": q(
            "SELECT md5(coalesce(string_agg(s::text, '|' ORDER BY s.id), '')) h"
            " FROM sheets s WHERE s.project_id = %s"
        ),
        "member_edits": q(
            "SELECT md5(coalesce(string_agg(e::text, '|' ORDER BY e.id), '')) h FROM member_edits e"
            " WHERE e.member_id IN (SELECT id FROM members WHERE project_id = %s)"
        ),
    }


def _columns(conn: psycopg.Connection, table: str) -> list[str]:
    return [
        r["column_name"]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position",
            (table,),
        )
    ]


def _copy(
    conn: psycopg.Connection,
    table: str,
    where: sql.Composable,
    overrides: dict[str, sql.Composable],
    params: dict[str, Any],
) -> int:
    """INSERT INTO table SELECT ... FROM table AS s WHERE <where>, each column taken as is unless
    an override expression is given. Returns the number of rows."""
    cols = _columns(conn, table)
    exprs = [overrides.get(c, sql.SQL("s.") + sql.Identifier(c)) for c in cols]
    q = sql.SQL("INSERT INTO {t} ({cols}) SELECT {exprs} FROM {t} AS s WHERE {where}").format(
        t=sql.Identifier(table),
        cols=sql.SQL(", ").join(map(sql.Identifier, cols)),
        exprs=sql.SQL(", ").join(exprs),
        where=where,
    )
    return conn.execute(q, params).rowcount


def copy_project(
    conn: psycopg.Connection,
    config: WorkerConfig,
    source_id: str,
    name: str,
    *,
    apply: bool = False,
) -> dict[str, Any]:
    src = conn.execute("SELECT id FROM projects WHERE id = %s", (source_id,)).fetchone()
    if src is None:
        raise ValueError("source project not found")
    if conn.execute("SELECT 1 FROM projects WHERE name = %s", (name,)).fetchone():
        raise ValueError("a project with that name already exists")
    counts = source_counts(conn, source_id)
    plan = {
        "will_copy": {
            k: counts[k]
            for k in (
                "project_files",
                "sheets",
                "sheet_edits",
                "sheet_views",
                "sheet_lines",
                "text_items",
                "legend_rows",
                "project_grade_rules",
            )
        }
        | {"members (system-made)": counts["members_system"]},
        "will_not_copy": {
            "members a person added": counts["members_manual"],
            **{k: counts[k] for k in NOT_COPIED},
        },
    }
    if not apply:
        return {"applied": False, **plan}

    new_id = str(uuid.uuid4())
    file = conn.execute(
        "SELECT stored_path FROM project_files WHERE project_id = %s", (source_id,)
    ).fetchone()
    p: dict[str, Any] = {"src": uuid.UUID(source_id), "dst": uuid.UUID(new_id), "name": name}
    new_pdf = None
    conn.commit()  # end the reads above, so the copy below is one top-level transaction
    with conn.transaction():
        conn.execute(
            "CREATE TEMP TABLE map_sheet ON COMMIT DROP AS"
            " SELECT id AS old, gen_random_uuid() AS new FROM sheets WHERE project_id = %s",
            (source_id,),
        )
        conn.execute(
            "CREATE TEMP TABLE map_view ON COMMIT DROP AS SELECT v.id AS old,"
            " gen_random_uuid() AS new FROM sheet_views v JOIN map_sheet m ON m.old = v.sheet_id"
        )
        conn.execute(
            "CREATE TEMP TABLE map_legend ON COMMIT DROP AS SELECT id AS old,"
            " gen_random_uuid() AS new FROM legend_rows WHERE project_id = %s",
            (source_id,),
        )
        now = sql.SQL("now()")
        dst = sql.Placeholder("dst")
        _copy(
            conn,
            "projects",
            sql.SQL("s.id = {}").format(sql.Placeholder("src")),
            {
                "id": dst,
                "name": sql.Placeholder("name"),
                "count_mode": sql.SQL("false"),
                "created_at": now,
                "updated_at": now,
            },
            p,
        )
        if file is not None:
            new_pdf = f"{new_id}/{uuid.uuid4()}.pdf"
            p["pdf"] = new_pdf
            _copy(
                conn,
                "project_files",
                sql.SQL("s.project_id = {}").format(sql.Placeholder("src")),
                {
                    "id": sql.SQL("gen_random_uuid()"),
                    "project_id": dst,
                    "stored_path": sql.Placeholder("pdf"),
                    "created_at": now,
                    "updated_at": now,
                },
                p,
            )
        sheet_new = sql.SQL("(SELECT new FROM map_sheet WHERE old = s.id)")
        _copy(
            conn,
            "sheets",
            sql.SQL("s.project_id = {}").format(sql.Placeholder("src")),
            {
                "id": sheet_new,
                "project_id": dst,
                # thumbnails are copied under the new project's folder (same relative name)
                "thumbnail_path": sql.SQL(
                    "CASE WHEN s.thumbnail_path LIKE {src}::text || '/%%'"
                    " THEN {dst}::text || substr(s.thumbnail_path, length({src}::text) + 1)"
                    " ELSE s.thumbnail_path END"
                ).format(src=sql.Placeholder("src"), dst=dst),
            },
            p,
        )
        in_sheets = sql.SQL("s.sheet_id IN (SELECT old FROM map_sheet)")
        sheet_of = sql.SQL("(SELECT new FROM map_sheet WHERE old = s.sheet_id)")
        _copy(
            conn,
            "sheet_edits",
            in_sheets,
            {"id": sql.SQL("gen_random_uuid()"), "sheet_id": sheet_of},
            p,
        )
        _copy(
            conn,
            "sheet_views",
            in_sheets,
            {"id": sql.SQL("(SELECT new FROM map_view WHERE old = s.id)"), "sheet_id": sheet_of},
            p,
        )
        _copy(conn, "sheet_lines", in_sheets, {"sheet_id": sheet_of}, p)
        _copy(
            conn,
            "text_items",
            in_sheets,
            {"id": sql.SQL("gen_random_uuid()"), "sheet_id": sheet_of},
            p,
        )
        _copy(
            conn,
            "legend_rows",
            sql.SQL("s.project_id = {}").format(sql.Placeholder("src")),
            {
                "id": sql.SQL("(SELECT new FROM map_legend WHERE old = s.id)"),
                "project_id": dst,
                "sheet_id": sheet_of,
            },
            p,
        )
        _copy(
            conn,
            "project_grade_rules",
            sql.SQL("s.project_id = {}").format(sql.Placeholder("src")),
            {"id": sql.SQL("gen_random_uuid()"), "project_id": dst},
            p,
        )
        null = sql.SQL("NULL")
        _copy(
            conn,
            "members",
            sql.SQL("s.project_id = {} AND s.origin <> 'manual'").format(sql.Placeholder("src")),
            {
                "id": sql.SQL("gen_random_uuid()"),
                "project_id": dst,
                "sheet_id": sheet_of,
                "plan_sheet_id": sql.SQL("(SELECT new FROM map_sheet WHERE old = s.plan_sheet_id)"),
                "view_id": sql.SQL("(SELECT new FROM map_view WHERE old = s.view_id)"),
                "legend_row_id": sql.SQL(
                    "(SELECT new FROM map_legend WHERE old = s.legend_row_id)"
                ),
                # a clean start: every system piece is an undecided suggestion
                "count_state": sql.SQL("'suggested'"),
                "count_source": null,
                "click_x": null,
                "click_y": null,
                "click_at": null,
                "snapped": null,
                "snapped_line": null,
                "snapped_distance_pt": null,
                "size_source": null,
                "size_evidence": null,
                "created_at": now,
                "updated_at": now,
            },
            p,
        )
        # the files last, inside the transaction: a failure here rolls the rows back
        if file is not None:
            src_dir = config.upload_dir / source_id
            dst_dir = config.upload_dir / new_id
            dst_dir.mkdir(parents=True, exist_ok=False)
            shutil.copy2(config.upload_dir / file["stored_path"], config.upload_dir / new_pdf)
            thumbs = src_dir / "thumbs"
            if thumbs.is_dir():
                shutil.copytree(thumbs, dst_dir / "thumbs")
    copied = source_counts(conn, new_id)
    return {"applied": True, "project_id": new_id, **plan, "copied": copied}


def remove_copy_files(config: WorkerConfig, project_id: str) -> None:
    """Test helper: remove the files a copy wrote."""
    d = Path(config.upload_dir) / project_id
    if d.is_dir():
        shutil.rmtree(d)
