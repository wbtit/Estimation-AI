from src.pdf_scan.classify import classify
from src.pdf_scan.textlines import Box, Line


def test_single_kind_from_title_is_confident() -> None:
    for title, kind in [
        ("TRELLIS FRAMING PLAN", "plan"),
        ("ROOF FRAMING PLAN", "plan"),
        ("BEAM SCHEDULE", "schedule"),
        ("TYPICAL DETAILS", "detail"),
        ("WALL SECTIONS", "detail"),
        ("GENERAL NOTES", "notes"),
        ("COVER SHEET", "notes"),
        ("SITE PLAN", "other"),
        ("BUILDING ELEVATIONS", "other"),
    ]:
        result = classify(title, [])
        assert (result.kind, result.confidence, result.flags) == (kind, 0.9, []), title
        assert title not in result.reason  # reasons never echo page text


def test_framing_plan_is_not_also_some_other_plan() -> None:
    result = classify("FLOOR FRAMING PLAN", [])
    assert (result.kind, result.confidence) == ("plan", 0.9)


def test_several_kinds_in_one_title_pick_by_priority_and_are_flagged() -> None:
    result = classify("FRAMING PLAN AND DETAILS", [])
    assert (result.kind, result.confidence) == ("plan", 0.5)
    assert result.flags == ["classification_ambiguous"]
    assert classify("STRUCTURAL NOTES AND SCHEDULES", []).kind == "schedule"


def test_no_evidence_is_other_with_zero_confidence_and_a_flag() -> None:
    result = classify(None, [])
    assert (result.kind, result.confidence) == ("other", 0.0)
    assert result.flags == ["classification_no_evidence"]
    assert classify("XYZ 123", []).flags == ["classification_no_evidence"]


def test_view_titles_are_weaker_evidence() -> None:
    one = classify(None, ["MEMBER SCHEDULE"])
    assert (one.kind, one.confidence, one.flags) == (
        "schedule",
        0.6,
        ["low_confidence_classification"],
    )
    two = classify(None, ["FRAMING PLAN LEVEL 1", "FRAMING PLAN LEVEL 2"])
    assert (two.kind, two.confidence, two.flags) == ("plan", 0.75, [])


def test_title_beats_view_titles() -> None:
    result = classify("GENERAL NOTES", ["TRELLIS FRAMING PLAN"])
    assert (result.kind, result.confidence) == ("notes", 0.9)


def test_view_titles_of_different_kinds_are_ambiguous() -> None:
    result = classify(None, ["FRAMING PLAN", "TYPICAL DETAILS"])
    assert (result.kind, result.confidence, result.flags) == (
        "plan",
        0.5,
        ["classification_ambiguous"],
    )


def test_view_title_filter_keeps_large_all_caps_lines_only() -> None:
    from src.pdf_scan.classify import view_titles

    def line(text: str, height: float) -> Line:
        return Line(text=text, box=Box(0, 0, 100, height), words=())

    lines = [line("SEE DETAIL 5", 8), line("see detail 5", 8)] * 5
    lines += [line("TRELLIS FRAMING PLAN", 20), line("Trellis Framing Plan", 20), line("A", 20)]
    assert view_titles(lines) == ["TRELLIS FRAMING PLAN"]
