"""The read-only text survey, on synthetic PDFs generated here (no real drawings)."""

import sys
from collections import Counter
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import text_survey as ts  # noqa: E402


def doc_with(path: Path, build, rotation: int = 0) -> Path:
    doc = pymupdf.open()
    page = doc.new_page(width=3000, height=2000)
    if rotation:
        page.set_rotation(rotation)
    build(page)
    doc.save(str(path))
    doc.close()
    return path


def test_member_patterns_are_counted_by_region(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        for k, t in enumerate(
            ["W12x26", "HSS6x4x1/4", "L3x3x1/4", "C10x15.3", "PL 1/2 x 8", "TYP"]
        ):
            page.insert_text((300, 300 + k * 30), t, fontsize=10)  # body of the plan
        page.insert_text((2700, 300), "W8x10", fontsize=10)  # title block (right 16%)
        page.insert_text((300, 1900), "HSS4x4x1/4", fontsize=10)  # title block (bottom 12%)

    out = ts.survey(doc_with(tmp_path / "a.pdf", build))
    assert out["member_plan_hits"] == 5 and out["member_title_hits"] == 2
    assert out["member_plan_to_title_ratio"] == 2.5
    assert out["profile_W"] == 2 and out["profile_HSS"] == 2 and out["profile_PL"] == 1


def test_marks_dimensions_scales_and_sheet_numbers(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        text = 'B1 B2 12\'-6" 3/16" = 1\'-0" S4.1 S-401 NTS BEAM'
        page.insert_text((300, 300), text, fontsize=10)

    out = ts.survey(doc_with(tmp_path / "b.pdf", build))
    assert out["mark_like_tokens"] == 2 and out["dimension_strings"] >= 1
    assert out["scale_ratio_strings"] == 1 and out["nts_strings"] == 1
    assert out["sheet_like_tokens"] == 2 and out["sheet_dot_form_tokens"] == 1


def test_text_quality_flags_private_use_characters(tmp_path: Path) -> None:
    assert ts.printable("A") and not ts.printable("") and not ts.printable("�")

    def build(page: pymupdf.Page) -> None:
        page.insert_text((300, 300), "HELLO WORLD", fontsize=10)
        page.insert_text((300, 400), "SIDEWAYS", fontsize=10, rotate=90)

    out = ts.survey(doc_with(tmp_path / "c.pdf", build))
    assert out["printable_char_share"] == 1.0 and out["rotated_line_share"] == 0.5


def test_a_rotated_page_does_not_count_as_rotated_text(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.insert_text((300, 300), "HELLO WORLD ONE", fontsize=10)
        page.insert_text((300, 400), "HELLO WORLD TWO", fontsize=10)

    out = ts.survey(doc_with(tmp_path / "d.pdf", build, rotation=90))
    assert out["rotated_line_share"] == 1.0  # the text really is sideways on the displayed page


def test_grid_bubbles_callouts_and_attached_lines(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        for k, label in enumerate(["A", "B", "12"]):
            cx = 500 + k * 400
            page.draw_circle((cx, 300), 15, width=1)
            page.insert_text((cx - 4, 304), label, fontsize=10)
            page.draw_line((cx, 315), (cx, 1500), width=0.5)  # grid line leaving the bubble
        page.draw_circle((500, 800), 15, width=1)  # a callout: two stacked tokens
        page.insert_text((496, 798), "3", fontsize=6)
        page.insert_text((490, 808), "S4.1", fontsize=6)
        page.draw_circle((500, 1000), 15, width=1)  # empty circle

    out = ts.survey(doc_with(tmp_path / "e.pdf", build))
    assert out["circles"] == 5 and out["circles_no_text"] == 1
    assert out["circles_one_short_token"] == 3 and out["bubbles_grid_like"] == 3
    assert out["bubbles_callout_like"] == 1
    assert out["grid_bubbles_with_a_line"] == 3 and out["grid_line_attachments_solid"] == 3
    assert out["grid_line_attachments_chained"] == 0


def test_a_grid_line_drawn_as_chained_dashes_counts_as_attached(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.draw_circle((500, 300), 15, width=1)
        page.insert_text((496, 304), "A", fontsize=10)
        for k in range(60):  # a 700 pt line made of 8 pt dashes with 4 pt gaps
            y = 316 + k * 12
            page.draw_line((500, y), (500, y + 8), width=0.3)

    out = ts.survey(doc_with(tmp_path / "j.pdf", build))
    assert out["chained_dash_lines_long"] == 1
    assert out["grid_line_attachments_chained"] == 1 and out["grid_line_attachments_solid"] == 0
    assert out["grid_bubbles_with_a_line"] == 1


def test_a_circle_made_of_separate_short_segments_is_found(tmp_path: Path) -> None:
    import math

    def build(page: pymupdf.Page) -> None:
        n = 24
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            page.draw_line(
                (600 + 15 * math.cos(a0), 600 + 15 * math.sin(a0)),
                (600 + 15 * math.cos(a1), 600 + 15 * math.sin(a1)),
                width=1,
            )
        page.insert_text((596, 604), "C", fontsize=10)

    out = ts.survey(doc_with(tmp_path / "f.pdf", build))
    assert out["circles_from_separate_segments"] == 1 and out["bubbles_grid_like"] == 1


def test_dashes_real_and_chained_and_linework_histograms(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.draw_line((300, 300), (1200, 300), dashes="[8 4] 0", width=0.7)
        for k in range(12):
            page.draw_line((300 + k * 12, 500), (308 + k * 12, 500), width=0.3, color=(1, 0, 0))

    out = ts.survey(doc_with(tmp_path / "g.pdf", build))
    assert out["real_dash_paths"] == 1 and out["dash_chains"] == 1
    assert out["dash_chain_segments"] == 12 and out["dash_chains_regular"] == 1
    assert out["stroke_width_hist"] == {"0.5-1": 1, "0.25-0.5": 12}
    assert out["stroke_colour_hist"] == {"black": 1, "red": 12}


def test_a_schedule_table_with_header_keywords_is_detected(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        rows = [["MARK", "SIZE", "QTY", "LENGTH"]] + [
            [f"B{k}", "HSS6x4", str(k), "12'-0"] for k in range(1, 7)
        ]
        for r, row in enumerate(rows):
            for c, cell in enumerate(row):
                page.insert_text((300 + c * 120, 300 + r * 14), cell, fontsize=8)
        page.insert_text((300, 900), "A LONE NOTE LINE WITH SOME WORDS", fontsize=8)
        page.insert_text((300, 286), "ITEM SCHEDULE", fontsize=8)  # a title above the header row

    out = ts.survey(doc_with(tmp_path / "h.pdf", build))
    assert out["tables_detected"] == 1 and out["tables_with_header_keywords"] == 1
    assert out["tables_with_any_header_keyword"] == 1
    assert out["header_word_MARK"] == 1 and out["header_word_QTY"] == 1


def test_output_has_no_text_or_names(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.insert_text((300, 300), "ACME SECRET W12x26", fontsize=10)

    out = ts.survey(doc_with(tmp_path / "i.pdf", build))
    flat = str(out)
    assert "ACME" not in flat and "SECRET" not in flat
    assert all(isinstance(v, (int, float, bool, dict, type(None))) for v in out.values())


def test_pages_beyond_the_cap_are_sampled() -> None:
    idx = list(range(100))
    s = ts.sampled(idx)
    assert len(s) == ts.MAX_PAGES and s[0] == 0 and s[-1] == 99
    assert ts.sampled(list(range(5))) == [0, 1, 2, 3, 4]
    assert Counter(ts.width_bucket(w) for w in (0.05, 0.3, 3.0)) == Counter(
        {"<0.1": 1, "0.25-0.5": 1, ">2.5": 1}
    )
