"""Phase 0 profile from callout on the (test) Postgres with SYNTHETIC PDFs: a Build stores the size
labels and each member's profile source; a re-read keeps the rows; no labels change nothing."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pymupdf
import pytest
from build_factory import XS, YS, column, framing_plan, grids
from db_fixtures import DbProject
from psycopg.types.json import Jsonb
from test_build_job import _members, _run, _setup

from src.build.read_labels_job import run_read_labels
from src.queue import Job


@pytest.fixture
def edition(dbp: DbProject, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    name = f"TEST-ED-{uuid.uuid4()}"
    for shape in ("W12X65", "W12X53", "W12X40"):
        dbp.conn.execute(
            "INSERT INTO catalog_shapes (edition, shape_name, family, weight_kg_per_m, properties)"
            " VALUES (%s, %s, 'W', 50, %s)",
            (name, shape, Jsonb({})),
        )
    dbp.conn.commit()
    monkeypatch.setenv("CATALOG_EDITION", name)
    yield name
    dbp.conn.execute("DELETE FROM catalog_shapes WHERE edition = %s", (name,))
    dbp.conn.commit()


def _plan(dbp: DbProject, labels: list[tuple[tuple[float, float], str]]) -> tuple[str, str]:
    doc = pymupdf.open()
    plan = doc.new_page(width=1000, height=800)
    grids(plan)
    for x in XS.values():
        for y in YS.values():
            column(plan, (x, y))
    for at, text in labels:
        plan.insert_text(at, text, fontsize=8)
    framing_plan(doc, with_columns=False)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    rows = dbp.conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
    ).fetchall()
    return str(rows[0]["id"]), str(rows[1]["id"])


def _at(members: list[dict], x: float, y: float) -> dict:
    return min(
        (m for m in members if m["type"] == "column"),
        key=lambda m: (float(m["page_x0"]) - x) ** 2 + (float(m["page_y0"]) - y) ** 2,
    )


def test_a_build_stores_labels_and_each_columns_profile_source(dbp: DbProject, edition) -> None:
    # A1 has its own label (W12x65, valid), B2 an (E) label (W12x53 (E)), C3 none: it takes the TYP
    labels = [
        ((XS["A"] + 20, YS["1"] + 40), "W12x65"),
        ((XS["B"] + 20, YS["2"] + 40), "W12x53 (E)"),
        ((60.0, 740.0), "ALL OTHER COLUMNS W12x40 TYP"),
    ]
    col_sheet, _ = _plan(dbp, labels)
    _setup(dbp, col_sheet, "column_plan")
    _run(dbp, col_sheet)
    ms = _members(dbp, col_sheet)
    a1, b2, c3 = _at(ms, XS["A"], YS["1"]), _at(ms, XS["B"], YS["2"]), _at(ms, XS["C"], YS["3"])
    assert (a1["profile"], a1["profile_source"]) == ("W12X65", "label")
    assert a1["profile_link"]["confidence"] in ("high", "medium") and a1["profile_label_id"]
    assert (b2["profile"], b2["profile_source"]) == ("W12X53", "label")
    assert b2["profile_link"]["existing"] is True
    assert (c3["profile"], c3["profile_source"]) == ("W12X40", "typical")
    assert c3["size_state"] == "inferred"  # amber: needs review
    rows = dbp.conn.execute(
        "SELECT * FROM page_labels WHERE sheet_id = %s ORDER BY canonical", (col_sheet,)
    ).fetchall()
    assert [r["canonical"] for r in rows] == ["W12X40", "W12X53", "W12X65"]
    assert all(r["valid"] for r in rows)
    assert [r["flags"] for r in rows] == [["typical"], ["existing"], []]
    sheet = dbp.conn.execute("SELECT * FROM sheets WHERE id = %s", (col_sheet,)).fetchone()
    assert sheet["labels_read_at"] is not None and sheet["labels_text_lines"] >= 3
    ids = {r["id"] for r in rows}
    # a rebuild keeps the label rows (and so the members' link): no duplicates
    _run(dbp, col_sheet)
    again = dbp.conn.execute(
        "SELECT id FROM page_labels WHERE sheet_id = %s", (col_sheet,)
    ).fetchall()
    assert {r["id"] for r in again} == ids


def test_a_label_not_in_the_catalog_is_stored_invalid(dbp: DbProject, edition) -> None:
    col_sheet, _ = _plan(dbp, [((XS["A"] + 20, YS["1"] + 40), "W12x999")])
    _setup(dbp, col_sheet, "column_plan")
    _run(dbp, col_sheet)
    row = dbp.conn.execute(
        "SELECT valid, canonical FROM page_labels WHERE sheet_id = %s", (col_sheet,)
    ).fetchone()
    assert row["canonical"] == "W12X999" and row["valid"] is False


def test_no_labels_nothing_changes_and_the_page_says_no_text(dbp: DbProject, edition) -> None:
    col_sheet, _ = _plan(dbp, [])
    _setup(dbp, col_sheet, "column_plan")
    _run(dbp, col_sheet)
    ms = [m for m in _members(dbp, col_sheet) if m["type"] == "column"]
    assert ms and all(m["profile"] is None and m["profile_source"] is None for m in ms)
    assert all(m["size_state"] == "undefined" for m in ms)
    sheet = dbp.conn.execute("SELECT * FROM sheets WHERE id = %s", (col_sheet,)).fetchone()
    assert sheet["labels_read_at"] is not None  # read, and there was nothing: the grid text only
    n = dbp.conn.execute(
        "SELECT count(*) AS n FROM page_labels WHERE sheet_id = %s", (col_sheet,)
    ).fetchone()["n"]
    assert n == 0


def test_the_read_labels_job_fills_a_sheet_built_before(dbp: DbProject, edition) -> None:
    col_sheet, _ = _plan(dbp, [((XS["A"] + 20, YS["1"] + 40), "W12x65")])
    _setup(dbp, col_sheet, "column_plan")
    res = run_read_labels(
        dbp.conn, Job("j", "read_labels", {"sheet_id": col_sheet}, 1, 1), dbp.config
    )
    assert res["views"] == 1 and res["labels"] == 1 and res["text_lines"] >= 1
    row = dbp.conn.execute(
        "SELECT canonical, valid, x0 FROM page_labels WHERE sheet_id = %s", (col_sheet,)
    ).fetchone()
    assert row["canonical"] == "W12X65" and row["valid"] is True
    # a second read changes nothing
    again = run_read_labels(
        dbp.conn, Job("j", "read_labels", {"sheet_id": col_sheet}, 1, 1), dbp.config
    )
    assert again["labels"] == 1
    assert (
        dbp.conn.execute(
            "SELECT count(*) AS n FROM page_labels WHERE sheet_id = %s", (col_sheet,)
        ).fetchone()["n"]
        == 1
    )
