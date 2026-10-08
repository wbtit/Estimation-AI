"""Page type and level guesses (keyword rules; always a guess)."""

import pytest
from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.pdf_scan.pagetype import guess_level, guess_page_type


@pytest.mark.parametrize(
    ("title", "views", "profiles", "expected"),
    [
        ("LEVEL 6 - FRAMING PLAN - CAB FLOOR", [], 0, "framing_plan"),
        ("ROOF FRAMING PLAN", [], 3, "framing_plan"),
        ("SECOND FLOOR PLAN", [], 0, "framing_plan"),
        ("FOUNDATION PLAN", [], 12, "foundation_plan"),
        ("FOOTING AND PILE LAYOUT", [], 0, "foundation_plan"),
        ("BUILDING ELEVATIONS", [], 5, "elevation"),
        ("TYPICAL DETAILS", [], 20, "detail"),
        ("FRAMING SECTIONS", [], 9, "framing_plan"),  # a framing keyword wins over section
        ("WIDE FLANGE SECTIONS", [], 0, "detail"),
        ("COLUMN SCHEDULE", [], 0, "schedule_legend"),
        ("LEGEND AND SYMBOLS", [], 0, "schedule_legend"),
        ("GENERAL NOTES", [], 0, "general_notes"),
        ("COVER SHEET", [], 0, "general_notes"),
        ("SITE UTILITIES", [], 0, "other"),
    ],
)
def test_title_keywords(title: str, views: list[str], profiles: int, expected: str) -> None:
    assert guess_page_type(title, views, profiles).page_type == expected


def test_view_titles_decide_when_there_is_no_title() -> None:
    g = guess_page_type(None, ["ROOF FRAMING PLAN", "SECTION AT GRID A"], 4)
    assert g.page_type == "framing_plan" and "view titles" in g.reason and "also detail" in g.reason


def test_a_sheet_with_a_foundation_and_a_framing_view_is_a_framing_plan_with_a_note() -> None:
    g = guess_page_type("PLANS", ["FOUNDATION PLAN", "FLOOR FRAMING PLAN"], 10)
    assert g.page_type == "framing_plan" and "also foundation_plan" in g.reason


def test_profile_counts_alone_give_only_a_weak_guess_for_plan_like_sheets() -> None:
    weak = guess_page_type(None, [], 30, "plan")
    assert weak.page_type == "framing_plan" and "weak guess" in weak.reason
    assert guess_page_type(None, [], 30, "other").page_type == "other"  # not plan-like: no guess
    assert guess_page_type(None, [], 3, "plan").page_type == "other"


def test_a_text_heavy_page_with_few_paths_is_a_weak_notes_guess() -> None:
    g = guess_page_type(None, [], 2, text_chars=15000, vector_paths=900)
    assert g.page_type == "general_notes" and "weak guess" in g.reason
    assert guess_page_type(None, [], 2, text_chars=15000, vector_paths=40000).page_type == "other"
    assert guess_page_type(None, [], 2, text_chars=500, vector_paths=900).page_type == "other"
    # a title keyword always wins over the text-volume fallback
    assert (
        guess_page_type("FOUNDATION PLAN", [], 0, text_chars=15000).page_type == "foundation_plan"
    )


def test_reasons_name_rules_and_never_the_title_text() -> None:
    g = guess_page_type("ACME TOWER ROOF FRAMING PLAN", [], 0)
    assert "acme" not in g.reason.lower() and "tower" not in g.reason.lower()
    assert g.reason == "title match floor/roof plan, framing"


@pytest.mark.parametrize(
    ("text", "level"),
    [
        ("LEVEL 6 - FRAMING PLAN", "Level 6"),
        ("LVL 2 FRAMING", "Level 2"),
        ("SECOND FLOOR FRAMING PLAN", "Second floor"),
        ("FLOOR 3 PLAN", "Floor 3"),
        ("ROOF FRAMING PLAN", "Roof"),
        ("MEZZANINE PLAN", "Mezzanine"),
        ("FOUNDATION PLAN", None),
        ("GENERAL NOTES", None),
    ],
)
def test_level_phrases(text: str, level: str | None) -> None:
    assert guess_level([text]) == level


def test_the_scan_stores_the_guesses_and_the_page_frame(dbp: DbProject) -> None:
    doc = new_doc()
    vector_page(doc, "S4.1", "SECOND FLOOR FRAMING PLAN", texts=[((60, 700), "W12x26 W14x30", 10)])
    vector_page(
        doc, "S0.1", "GENERAL NOTES", texts=[((60, 700), "ALL STEEL SHALL BE A992 GRADE 50", 10)]
    )
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    rows = dbp.conn.execute(
        "SELECT page_type_guess, page_type_reason, level_guess, plan_frame FROM sheets"
        " WHERE project_id = %s ORDER BY page_index",
        (dbp.project_id,),
    ).fetchall()
    assert [r["page_type_guess"] for r in rows] == ["framing_plan", "general_notes"]
    assert rows[0]["level_guess"] == "Second floor" and rows[1]["level_guess"] is None
    assert "title match" in rows[0]["page_type_reason"]
    assert rows[0]["plan_frame"] == {"width_pt": 1200.0, "height_pt": 800.0, "rotation": 0}
