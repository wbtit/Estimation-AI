"""read_details on the (test) Postgres with a SYNTHETIC PDF: cover, index, title blocks; storing, a
re-read, the index re-check after a person renames a sheet, edits untouched."""

from __future__ import annotations

import pymupdf
from db_fixtures import DbProject

import src.details.read as read_mod
from src.details.job import recheck, run_read_details
from src.queue import Job

W, H = 792, 612
INDEX = [
    ("S101", "FOUNDATION PLAN"),
    ("S102", "FRAMING PLAN"),
    ("S103", "ROOF PLAN"),
    ("S104", "DETAILS"),
]


def _pdf(dbp: DbProject, cover_text=True) -> list[str]:
    doc = pymupdf.open()
    cover = doc.new_page(width=W, height=H)
    if cover_text:
        cover.insert_text((60, 80), "PROJECT: Riverside Warehouse", fontsize=14)
        cover.insert_text((60, 110), "OWNER", fontsize=8)
        cover.insert_text((60, 124), "Acme Holdings LLC", fontsize=11)
        cover.insert_text((60, 150), "JOB NO.: 24-0173", fontsize=10)
        cover.insert_text((60, 170), "1200 Harbor Blvd", fontsize=10)
        cover.insert_text((60, 184), "Portland, OR 97201", fontsize=10)
        cover.insert_text((60, 204), "ISSUED FOR BID  03/14/2024", fontsize=10)
        for k, (n, t) in enumerate(INDEX):
            cover.insert_text((400, 100 + 16 * k), f"{n}  {t}", fontsize=10)
    for n, t in INDEX:
        pg = doc.new_page(width=W, height=H)
        pg.insert_text((560, 560), "Riverside Warehouse", fontsize=12)
        pg.insert_text((560, 575), "24-0173", fontsize=9)
        pg.insert_text((560, 592), n, fontsize=14)
        pg.insert_text((100, 300), t, fontsize=20)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    ids = [
        str(r["id"])
        for r in dbp.conn.execute(
            "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
        )
    ]
    for sid, (n, t) in zip(ids[1:], INDEX, strict=True):  # deterministic numbers and names
        dbp.conn.execute(
            "UPDATE sheets SET sheet_number = %s, title = %s WHERE id = %s", (n, t, sid)
        )
    dbp.conn.commit()
    return ids


def _run(dbp: DbProject, mode: str = "read") -> dict:
    out = run_read_details(
        dbp.conn,
        Job("j", "read_details", {"project_id": dbp.project_id, "mode": mode}, 1, 1),
        dbp.config,
    )
    dbp.conn.commit()
    return out


def _fields(dbp: DbProject) -> dict:
    return {
        r["field"]: r
        for r in dbp.conn.execute(
            "SELECT * FROM project_details WHERE project_id = %s", (dbp.project_id,)
        )
    }


def test_the_index_check_is_switched_off_by_default(dbp: DbProject) -> None:
    """The owner removed the drawing index check: a read finds the fields, writes no index rows."""
    _pdf(dbp)
    out = _run(dbp)
    assert out["fields"] >= 6 and out["index_rows"] == 0 and out["flags"] == 0
    for table in ("drawing_index_rows", "drawing_index_flags"):
        n = dbp.conn.execute(
            f"SELECT count(*) AS n FROM {table} WHERE project_id = %s", (dbp.project_id,)
        ).fetchone()["n"]
        assert n == 0


def test_read_stores_fields_with_source_rule_and_confidence(dbp: DbProject, monkeypatch) -> None:
    monkeypatch.setattr(read_mod, "INDEX_CHECK", True)  # the switched-off code still works
    _pdf(dbp)
    out = _run(dbp)
    assert out["fields"] >= 6 and out["index_rows"] == 4 and out["flags"] == 0
    f = _fields(dbp)
    assert f["project_name"]["value"] == "Riverside Warehouse"
    assert f["project_name"]["page_index"] == 0 and f["project_name"]["rule"] == "same_line"
    assert (
        f["project_name"]["agreement"]["state"] == "agree"
        and f["project_name"]["confidence"] == "high"
    )
    assert f["owner"]["value"] == "Acme Holdings LLC" and f["owner"]["rule"] == "below"
    assert f["project_number"]["value"] == "24-0173"
    assert f["address"]["value"] == "1200 Harbor Blvd Portland, OR 97201"
    assert f["issue_status"]["value"] == "ISSUED FOR BID" and f["date"]["value"] == "03/14/2024"
    assert len(f["owner"]["box"]) == 4
    read = dbp.conn.execute(
        "SELECT * FROM project_detail_reads WHERE project_id = %s", (dbp.project_id,)
    ).fetchone()
    assert (
        read["cover_pages"] == [0] and read["no_text_pages"] == [] and read["seconds"] is not None
    )
    rows = dbp.conn.execute(
        "SELECT number, match, matched_page FROM drawing_index_rows"
        " WHERE project_id = %s ORDER BY number",
        (dbp.project_id,),
    ).fetchall()
    assert [(r["number"], r["match"], r["matched_page"]) for r in rows] == [
        ("S101", "exact", 1),
        ("S102", "exact", 2),
        ("S103", "exact", 3),
        ("S104", "exact", 4),
    ]


def test_a_reread_keeps_a_persons_edit_and_the_recheck_follows_a_renamed_sheet(
    dbp: DbProject, monkeypatch
) -> None:
    monkeypatch.setattr(read_mod, "INDEX_CHECK", True)
    ids = _pdf(dbp)
    _run(dbp)
    dbp.conn.execute(
        "INSERT INTO project_detail_edits (project_id, field, before, after, kind, who) VALUES"
        " (%s, 'owner', '{\"value\": \"Acme Holdings LLC\"}',"
        " '{\"value\": \"Acme Co\"}', 'edit', 'tester')",
        (dbp.project_id,),
    )
    dbp.conn.commit()
    _run(dbp)  # a re-read replaces the machine values only
    assert (
        dbp.conn.execute(
            "SELECT count(*) AS n FROM project_detail_edits WHERE project_id = %s",
            (dbp.project_id,),
        ).fetchone()["n"]
        == 1
    )
    # a person changes a sheet number and a role: the recheck flags it, the sheet is untouched
    dbp.conn.execute("UPDATE sheets SET sheet_number = 'S9.99' WHERE id = %s", (ids[3],))
    dbp.conn.execute(
        "UPDATE build_views SET role_name = 'Framing plan' WHERE sheet_id = %s AND position = 1",
        (ids[1],),
    )
    dbp.conn.commit()
    n = recheck(dbp.conn, dbp.project_id)
    dbp.conn.commit()
    kinds = {
        r["kind"]
        for r in dbp.conn.execute(
            "SELECT kind FROM drawing_index_flags WHERE project_id = %s", (dbp.project_id,)
        )
    }
    assert n == len(kinds) or n >= 2
    assert "number_mismatch" in kinds and "role_disagreement" in kinds
    assert (
        dbp.conn.execute("SELECT sheet_number FROM sheets WHERE id = %s", (ids[3],)).fetchone()[
            "sheet_number"
        ]
        == "S9.99"
    )
    out = _run(dbp, "recheck")
    assert out["mode"] == "recheck"


def test_a_cover_with_no_text_stores_no_fields_and_says_so(dbp: DbProject) -> None:
    _pdf(dbp, cover_text=False)
    out = _run(dbp)
    assert out["no_text_pages"] == [0]
    f = _fields(dbp)
    assert "owner" not in f and "address" not in f and "issue_status" not in f
    read = dbp.conn.execute(
        "SELECT no_text_pages FROM project_detail_reads WHERE project_id = %s", (dbp.project_id,)
    ).fetchone()
    assert read["no_text_pages"] == [0]
    assert (
        dbp.conn.execute(
            "SELECT count(*) AS n FROM drawing_index_rows WHERE project_id = %s", (dbp.project_id,)
        ).fetchone()["n"]
        == 0
    )
