"""Kind detection: synthetic strings only."""

from db_fixtures import DbProject

from src.review.kinds import (
    AMBIGUOUS,
    SCOPE,
    TABLE,
    detect_kind,
    joist_kind,
    match_text,
)


def kind(text: str) -> str | None:
    r = match_text(text)
    return None if r is None else (r.kind or f"?{r.status}")


def test_the_priority_order_puts_specific_words_before_general_ones() -> None:
    assert kind("VERTICAL BRACE W/ BEAM") == "Vertical Brace"  # not Beams
    assert kind("embed angle at column") == "Embeds Angle"  # not Embed Plate, not Column
    assert kind("embed plate") == "Embed Plate/Bearing Plates"
    assert kind("HORIZ. BRACING") == "Horizontal Brace"
    assert kind("dock stair frame") == "Dock Stair"  # not Stair
    assert kind("steel column") == "Column" and kind("roof beam") == "Beams"
    assert kind("wall rail") == "Handrail/Wallrails"  # not Wall


def test_keywords_match_at_the_start_of_a_word_only() -> None:
    assert kind("2 beams") == "Beams" and kind("posts") == "Posts/Pipe"
    assert kind("composite deck") is None  # "post" inside a word
    assert kind("aggregate") is None  # "gate" inside a word
    assert kind("message") is None and kind("passage") is None  # "sag" inside a word
    assert kind("") is None and match_text(None) is None


def test_a_bare_brace_rail_or_ladder_is_ambiguous_and_names_its_candidates() -> None:
    r = match_text("BRACE")
    assert r is not None and r.status == "ambiguous" and r.kind is None
    assert "Vertical Brace" in r.candidates
    assert kind("rail") == "?ambiguous" and kind("ladder") == "?ambiguous"
    assert kind("kicker brace") == "Kicker/Knee Brace"  # a specific word wins over the bare one


def test_first_source_wins_and_the_source_is_stored() -> None:
    r = detect_kind("W12x26 COLUMN", ["beam"], "girt", "truss")
    assert (r.kind, r.source, r.where, r.keyword) == ("Column", "keyword", "same_line", "column")
    r = detect_kind("W12x26", ["no words", "see beam note", "column"], None, None)
    assert (r.kind, r.source, r.where) == ("Beams", "keyword", "near")  # nearest line first
    r = detect_kind("W12x26", ["nothing"], "purlin schedule", "truss plan")
    assert (r.kind, r.source) == ("Girt & Purlin", "legend")
    r = detect_kind("W12x26", [], None, "TRUSS FRAMING")
    assert (r.kind, r.source, r.where) == ("Truss", "sheet_context", "sheet_title")


def test_no_keyword_leaves_the_kind_empty_never_defaulted() -> None:
    r = detect_kind("W12x26", ["B1", "see sheet S4"], None, "SECOND FLOOR FRAMING PLAN")
    assert (r.kind, r.status, r.source) == (None, "missing", None)


def test_an_excluded_kind_in_a_nearby_line_is_ignored_but_counts_in_the_own_line() -> None:
    assert detect_kind("W12x26", ["cont. at wall"]).kind is None
    assert detect_kind("W12x26", ["bearing wall"]).kind == "Embed Plate/Bearing Plates"
    assert detect_kind("24K7 joist").kind == "Joist"
    assert detect_kind("W12x26 wall angle").kind == "Wall"  # the own line is trusted
    assert joist_kind().kind == "Joist" and joist_kind().where == "designation"


def test_evidence_carries_no_page_text_only_the_keyword_and_where() -> None:
    ev = detect_kind("secret text with a truss word").evidence()
    assert ev == {
        "status": "set",
        "source": "keyword",
        "keyword": "truss",
        "where": "same_line",
        "candidates": [],
    }


def test_the_table_covers_the_scope_list_without_repeats() -> None:
    names = [k for k, _, _ in TABLE]
    assert len(names) == len(set(names))
    assert [s for _, s, _ in TABLE].count("main") == 21
    assert all(c in SCOPE for _, cands in AMBIGUOUS for c in cands)


def test_the_kind_names_are_exactly_the_member_kinds_of_the_database(dbp: DbProject) -> None:
    rows = dbp.conn.execute("SELECT kind, scope FROM member_kinds").fetchall()
    assert len(rows) == 36
    db = {r["kind"]: r["scope"] for r in rows}
    assert {k: s for k, s in SCOPE.items()} == {k: v for k, v in db.items()}
    assert sorted(db.values()).count("main") == 21 and sorted(db.values()).count("misc") == 12
