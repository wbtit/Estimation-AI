"""Phase 12b rules through auto mode on the test database, SYNTHETIC pages only: pile plans store
kind Piles, a second column plan's columns are duplicates, joists are kind Joist."""

from __future__ import annotations

import pymupdf
from build_factory import XS, YS, column, framing_plan, grids, line
from db_fixtures import DbProject

from src.build.auto import auto_build


def _project(dbp: DbProject, pages: list[tuple[str, str]], joist: bool = False) -> list[str]:
    """Pages: (page type guess, title). Column plans get grids and nine columns; framing pages
    are the factory framing plan (with a 30K7 line beside the first girder when `joist`)."""
    doc = pymupdf.open()
    for guess, _ in pages:
        if guess == "foundation_plan":
            p = doc.new_page(width=1000, height=800)
            grids(p)
            for x in XS.values():
                for y in YS.values():
                    column(p, (x, y))
        else:
            p = framing_plan(doc, with_columns=False)
            line(p, (250, 400), (250, 600))
            line(p, (450, 400), (450, 600))
            if joist:
                line(p, (200, 300), (800, 300))
                p.insert_text((480, 296), "30K7", fontsize=8)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    ids = [
        str(r["id"])
        for r in dbp.conn.execute(
            "SELECT id FROM sheets WHERE project_id = %s ORDER BY page_index", (dbp.project_id,)
        )
    ]
    for sid, (guess, title) in zip(ids, pages, strict=True):
        dbp.conn.execute(
            "UPDATE sheets SET page_type_guess = %s, title = %s, scale_parsed_ratio = 96,"
            " scale_parsed = '1/8\" = 1''-0\"', scale_override_ratio = NULL WHERE id = %s",
            (guess, title, sid),
        )
    dbp.conn.commit()
    return ids


def _members(dbp: DbProject, sid: str) -> list[dict]:
    return dbp.conn.execute(
        "SELECT * FROM members WHERE sheet_id = %s AND build_run_id IS NOT NULL", (sid,)
    ).fetchall()


def test_a_pile_plan_stores_its_glyphs_as_piles(dbp: DbProject) -> None:
    (pid,) = _project(dbp, [("foundation_plan", "PILE PLAN")])
    out = auto_build(dbp.conn, dbp.config, dbp.project_id)
    assert out["pile_plans"] == 1
    kinds = {m["kind"] for m in _members(dbp, pid)}
    assert kinds == {"Piles"} and len(_members(dbp, pid)) == 9
    role = dbp.conn.execute(
        "SELECT role_name FROM build_views WHERE sheet_id = %s", (pid,)
    ).fetchone()["role_name"]
    assert role == "Pile plan"


def test_the_second_column_plan_with_the_same_grid_has_duplicate_columns(dbp: DbProject) -> None:
    a, b = _project(dbp, [("foundation_plan", "FOUNDATION PLAN"),
                          ("foundation_plan", "ANCHOR BOLT PLAN")])  # fmt: skip
    auto_build(dbp.conn, dbp.config, dbp.project_id)
    first, second = _members(dbp, a), _members(dbp, b)
    assert len(first) == len(second) == 9
    assert all(not (m["kind_evidence"] or {}).get("duplicate_of") for m in first)
    dup = [m["kind_evidence"] for m in second]
    assert all(e.get("duplicate_rule") == "grid_labels" for e in dup)
    assert {e["duplicate_of"] for e in dup} == {str(m["id"]) for m in first}
    run = dbp.conn.execute("SELECT counts FROM build_runs WHERE sheet_id = %s", (b,)).fetchone()[
        "counts"
    ]
    assert run["duplicate_columns"] == 9


def test_a_joist_line_is_kind_joist_with_no_size(dbp: DbProject) -> None:
    plan, framing = _project(dbp, [("foundation_plan", "FOUNDATION PLAN"),
                                   ("framing_plan", "ROOF FRAMING PLAN")], joist=True)  # fmt: skip
    auto_build(dbp.conn, dbp.config, dbp.project_id)
    joists = [m for m in _members(dbp, framing) if m["kind"] == "Joist"]
    assert joists and all(m["profile"] is None and m["type"] == "joist" for m in joists)
    assert all(m["profile_raw"] == "30K7" for m in joists)
    beams = [m for m in _members(dbp, framing) if m["kind"] == "Beams"]
    assert beams and not any((m["profile"] or "").endswith("K7") for m in beams)


def test_a_detail_sheet_titled_framing_sections_is_not_built(dbp: DbProject) -> None:
    plan, sections = _project(dbp, [("foundation_plan", "FOUNDATION PLAN"),
                                    ("framing_plan", "FRAMING SECTIONS")])  # fmt: skip
    out = auto_build(dbp.conn, dbp.config, dbp.project_id)
    assert out["not_a_plan"] == 1 and out["built"] == 1
    assert _members(dbp, sections) == []
    role = dbp.conn.execute(
        "SELECT role_name FROM build_views WHERE sheet_id = %s", (sections,)
    ).fetchone()["role_name"]
    assert role == "Section"
