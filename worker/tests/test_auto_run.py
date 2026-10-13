"""auto_run: the whole pipeline after the scan, with guesses left as flags (synthetic PDFs)."""

from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page
from test_link_job import build_pdf

from src.review.auto_run import auto_run, most_frequent_scale, whole_sheet_box


def test_most_frequent_scale_needs_a_ratio_and_prefers_the_higher_count() -> None:
    scales = [
        {"raw": '1/8" = 1\'-0"', "kind": "ratio", "ratio": 96, "count": 2},
        {"raw": '1/4" = 1\'-0"', "kind": "ratio", "ratio": 48, "count": 5},
        {"raw": "NTS", "kind": "nts", "ratio": None, "count": 9},
    ]
    assert most_frequent_scale(scales)["ratio"] == 48
    assert most_frequent_scale([scales[2]]) is None and most_frequent_scale([]) is None


def test_whole_sheet_box_matches_the_api_margins() -> None:
    assert whole_sheet_box(1000, 800) == {"x0": 25.0, "y0": 20.0, "x1": 860.0, "y1": 780.0}


def test_the_pipeline_makes_a_view_guesses_and_links_without_any_confirmation(
    dbp: DbProject,
) -> None:
    build_pdf(dbp)
    dbp.scan()
    result = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert result["sheets_in_takeoff"] == 1 and result["views_created"] == 1
    assert result["views_linked"] == 1 and result["members_created"] > 0
    view = dbp.conn.execute(
        "SELECT v.* FROM sheet_views v JOIN sheets s ON s.id = v.sheet_id WHERE s.project_id = %s",
        (dbp.project_id,),
    ).fetchone()
    assert view["auto_created"] is True and view["created_by"] == "system"
    assert view["classes_confirmed"] is False and view["structural_classes"]
    assert view["scale_confirmed"] is False  # a guess stays a flag
    members = dbp.conn.execute(
        "SELECT * FROM members WHERE project_id = %s", (dbp.project_id,)
    ).fetchall()
    assert len(members) == result["members_created"]


def test_a_second_run_keeps_the_view_and_everything_a_person_did(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    dbp.conn.execute(
        "UPDATE sheet_views SET scale_ratio = 48, scale_confirmed = TRUE, scale_source ="
        " 'user_confirmed', classes_confirmed = TRUE"
    )
    first = dbp.conn.execute(
        "SELECT id FROM members WHERE project_id = %s ORDER BY id LIMIT 1", (dbp.project_id,)
    ).fetchone()["id"]
    dbp.conn.execute("UPDATE members SET review_status = 'approved' WHERE id = %s", (first,))
    dbp.conn.commit()
    again = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert "views_created" not in again and again.get("members_created", 0) == 0
    assert again["members_kept"] >= 1
    view = dbp.conn.execute("SELECT * FROM sheet_views").fetchone()
    assert float(view["scale_ratio"]) == 48 and view["scale_confirmed"] is True


def test_every_vector_sheet_is_in_by_default_even_a_detail_sheet(dbp: DbProject) -> None:
    doc = new_doc()
    vector_page(doc, "S5.1", "DETAILS", texts=[((100, 100), "W12x26", 10)])
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    result = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert result["sheets_in_takeoff"] == 1 and result["views_created"] == 1


def test_a_sheet_a_person_excluded_is_left_alone(dbp: DbProject) -> None:
    import json

    build_pdf(dbp)
    dbp.scan()
    sheet = dbp.conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s", (dbp.project_id,)
    ).fetchone()
    dbp.conn.execute(
        "INSERT INTO sheet_edits (sheet_id, field_name, original_value, corrected_value, editor)"
        " VALUES (%s, 'takeoff', 'null', %s, 'tester')",
        (sheet["id"], json.dumps("exclude")),
    )
    dbp.conn.commit()
    result = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert result["sheets_out_of_takeoff"] == 1 and "views_created" not in result
    assert dbp.conn.execute("SELECT 1 FROM sheet_views").fetchone() is None


def test_a_raster_sheet_is_out_by_default(dbp: DbProject) -> None:
    from pdf_factory import scanned_page

    doc = new_doc()
    scanned_page(doc)
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    result = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    assert result["sheets_not_vector"] == 1 and "views_created" not in result
