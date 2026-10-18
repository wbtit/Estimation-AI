"""Pilot copy of a project: what is copied, what is not, the source is unchanged (synthetic)."""

from __future__ import annotations

import json

import pytest
from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.review.copy_project import content_hash, copy_project, source_counts


def build(dbp: DbProject) -> dict[str, str]:
    doc = new_doc()
    vector_page(doc, "S4.1", "FRAMING PLAN", texts=[((60, 700), "W12x26", 10)])
    vector_page(doc, "S4.2", "ROOF PLAN")
    doc.save(str(dbp.pdf_path))
    doc.close()
    dbp.scan()
    c = dbp.conn
    sheets = [
        r["id"]
        for r in c.execute(
            "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
        )
    ]
    view = c.execute(
        "INSERT INTO sheet_views (sheet_id, box, scale_ratio, scale_source, scale_confirmed)"
        " VALUES (%s, %s, 96, 'user_confirmed', true) RETURNING id",
        (sheets[0], json.dumps({"x0": 0, "y0": 0, "x1": 1200, "y1": 800})),
    ).fetchone()["id"]
    c.execute(
        "INSERT INTO sheet_lines (sheet_id, classes, lines, n_lines, version)"
        " VALUES (%s, '[\"a\"]', '[[0,0,1,1,0,1,1,0]]', 1, 'v')",
        (sheets[0],),
    )
    c.execute(
        "INSERT INTO sheet_edits (sheet_id, field_name, original_value, corrected_value, editor)"
        " VALUES (%s, 'takeoff', 'null', '\"include\"', 'x')",
        (sheets[0],),
    )
    v1 = c.execute(
        "SELECT id FROM build_views WHERE sheet_id = %s AND position = 1", (sheets[0],)
    ).fetchone()["id"]
    v2 = c.execute(
        "INSERT INTO build_views (sheet_id, position, name, box, role_name, column_plan_view_id)"
        ' VALUES (%s, 2, \'View 2\', \'{"x0":0,"y0":0,"x1":9,"y1":9}\', \'Framing plan\', %s)'
        " RETURNING id",
        (sheets[0], v1),
    ).fetchone()["id"]
    c.execute(
        "INSERT INTO view_pens (view_id, position, pen_class, source) VALUES"
        " (%s, 1, '1-1.5|black|solid', 'person'), (%s, 2, '0.5-1|black|solid', 'person')",
        (v2, v2),
    )
    c.execute(
        "INSERT INTO view_exclusions (view_id, box, status) VALUES (%s, '{}', 'accepted')", (v2,)
    )
    c.execute(
        "INSERT INTO view_deselections (view_id, x0, y0, x1, y1, created_by)"
        " VALUES (%s, 0, 0, 1, 1, 'x')",
        (v2,),
    )
    legend = c.execute(
        "INSERT INTO legend_rows (project_id, sheet_id, mark, designation_raw, source)"
        " VALUES (%s, %s, 'B1', 'W12x26', '{}') RETURNING id",
        (dbp.project_id, sheets[0]),
    ).fetchone()["id"]
    ids = {}
    for key, origin in (("sys", "extracted"), ("man", "manual")):
        ids[key] = str(
            c.execute(
                "INSERT INTO members (project_id, sheet_id, view_id, plan_sheet_id, legend_row_id,"
                " member_id, origin, type, field_sources, field_confidence, count_state,"
                " build_view_id)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, 'beam', '{}', '{}', %s, %s) RETURNING id",
                (
                    dbp.project_id,
                    sheets[0],
                    view,
                    sheets[0],
                    legend,
                    f"M-{key}",
                    origin,
                    "confirmed" if origin == "manual" else "suggested",
                    v2,
                ),
            ).fetchone()["id"]
        )
    c.execute(
        "INSERT INTO member_edits (member_id, field_name, original_value, corrected_value,"
        " review_status, reviewer) VALUES (%s, 'count_state', '\"suggested\"', '\"confirmed\"',"
        " 'edited', 'x')",
        (ids["sys"],),
    )
    c.execute(
        "INSERT INTO count_actions (project_id, sheet_id, member_id, action, who)"
        " VALUES (%s, %s, %s, 'accept', 'x')",
        (dbp.project_id, sheets[0], ids["sys"]),
    )
    c.commit()
    return {"sheet0": str(sheets[0]), "view": str(view), "legend": str(legend), **ids}


def test_preview_writes_nothing(dbp: DbProject):
    build(dbp)
    before = source_counts(dbp.conn, dbp.project_id)
    plan = copy_project(dbp.conn, dbp.config, dbp.project_id, "pilot-test-preview")
    assert plan["applied"] is False
    assert plan["will_copy"]["members (system-made)"] == 1
    assert plan["will_not_copy"]["members a person added"] == 1
    assert plan["will_not_copy"]["member_edits"] == 1
    assert plan["will_not_copy"]["count_actions"] == 1
    assert (
        dbp.conn.execute(
            "SELECT count(*) n FROM projects WHERE name = 'pilot-test-preview'"
        ).fetchone()["n"]
        == 0
    )
    assert source_counts(dbp.conn, dbp.project_id) == before


def test_copy_is_clean_and_the_source_is_unchanged(dbp: DbProject):
    ids = build(dbp)
    dbp.conn.execute("UPDATE projects SET archived = true WHERE id = %s", (dbp.project_id,))
    dbp.conn.commit()
    before = source_counts(dbp.conn, dbp.project_id)
    h_before = content_hash(dbp.conn, dbp.project_id)
    r = copy_project(dbp.conn, dbp.config, dbp.project_id, "pilot-test-copy", apply=True)
    new = r["project_id"]
    try:
        assert source_counts(dbp.conn, dbp.project_id) == before
        assert content_hash(dbp.conn, dbp.project_id) == h_before
        got = r["copied"]
        for k in (
            "sheets",
            "sheet_edits",
            "sheet_views",
            "sheet_lines",
            "text_items",
            "legend_rows",
            "build_views",
            "view_pens",
            "view_exclusions",
            "view_deselections",
        ):
            assert got[k] == before[k], k
        assert got["members"] == 1 and got["members_manual"] == 0
        assert got["member_edits"] == 0 and got["count_actions"] == 0 and got["measurements"] == 0
        p = dbp.conn.execute(
            "SELECT name, count_mode, archived FROM projects WHERE id = %s", (new,)
        ).fetchone()
        assert p == {"name": "pilot-test-copy", "count_mode": False, "archived": False}
        m = dbp.conn.execute(
            "SELECT m.count_state, m.count_source, s.project_id AS sheet_project,"
            " v.sheet_id = m.sheet_id AS view_on_sheet, l.project_id AS legend_project,"
            " m.plan_sheet_id = m.sheet_id AS plan_sheet"
            " FROM members m JOIN sheets s ON s.id = m.sheet_id"
            " JOIN sheet_views v ON v.id = m.view_id JOIN legend_rows l ON l.id = m.legend_row_id"
            " WHERE m.project_id = %s",
            (new,),
        ).fetchone()
        assert m["count_state"] == "suggested" and m["count_source"] is None
        assert str(m["sheet_project"]) == new and str(m["legend_project"]) == new
        assert m["view_on_sheet"] and m["plan_sheet"]
        # build views: one per page plus the second, links remapped inside the copy
        assert got["build_views"] == before["build_views"] == 3
        bv = dbp.conn.execute(
            "SELECT v.position, s.project_id, p.sheet_id = v.sheet_id AS plan_same_sheet,"
            " (SELECT count(*) FROM members m WHERE m.build_view_id = v.id) AS members"
            " FROM build_views v JOIN sheets s ON s.id = v.sheet_id"
            " LEFT JOIN build_views p ON p.id = v.column_plan_view_id"
            " WHERE s.project_id = %s AND v.position = 2",
            (new,),
        ).fetchone()
        assert bv == {
            "position": 2,
            "project_id": bv["project_id"],
            "plan_same_sheet": True,
            "members": 1,
        }
        assert str(bv["project_id"]) == new
        stored = dbp.conn.execute(
            "SELECT stored_path FROM project_files WHERE project_id = %s", (new,)
        ).fetchone()["stored_path"]
        assert stored.startswith(new + "/")
        assert (dbp.config.upload_dir / stored).read_bytes() == dbp.pdf_path.read_bytes()
        thumbs = dbp.conn.execute(
            "SELECT thumbnail_path FROM sheets"
            " WHERE project_id = %s AND thumbnail_path IS NOT NULL",
            (new,),
        ).fetchall()
        for t in thumbs:
            assert t["thumbnail_path"].startswith(new + "/")
            assert (dbp.config.upload_dir / t["thumbnail_path"]).is_file()
        # the source's own rows still point to the source
        assert (
            str(
                dbp.conn.execute(
                    "SELECT sheet_id FROM members WHERE id = %s", (ids["sys"],)
                ).fetchone()["sheet_id"]
            )
            == ids["sheet0"]
        )
        with pytest.raises(ValueError):
            copy_project(dbp.conn, dbp.config, dbp.project_id, "pilot-test-copy", apply=True)
    finally:
        dbp.conn.rollback()
        dbp.conn.execute("DELETE FROM projects WHERE id = %s", (new,))
        dbp.conn.commit()
