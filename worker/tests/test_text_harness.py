"""Accuracy harness and CLI. The ground truth used here is synthetic and lives in tmp_path."""

import csv
from pathlib import Path

import pymupdf
import pytest
from db_fixtures import DbProject
from stroke_font import LIBRARY_LABELS, confirmed_library, draw_text
from test_glyph_admin import seed, write_rows

from src.text_reader import glyph_admin, harness
from src.text_reader.cli import main
from src.text_reader.library import new_entry
from src.text_reader.targets import categorize

FONT = "test-font"
LINES = ["B2", "S4.1", "HSS6x4x1/4", "BEAM"]


def make_pdf(path: Path) -> list[tuple]:
    doc = pymupdf.open()
    page = doc.new_page(width=800, height=600)
    boxes = []
    for k, text in enumerate(LINES):
        boxes.append(draw_text(page, text, 60, 60 + k * 50))
    other = doc.new_page(width=800, height=600)
    draw_text(other, "FLAT TYP", 60, 60)
    doc.save(str(path))
    doc.close()
    return boxes


class Scripted:
    def __init__(self, answers):
        self.answers = list(answers)

    def read(self, image):
        return self.answers.pop(0)


def library_without(chars: str):
    from stroke_font import GLYPHS

    return [
        new_entry(FONT, GLYPHS[c], label=c, status="confirmed")
        for c in LIBRARY_LABELS
        if c not in chars
    ]


def write_truth(path: Path, boxes, truths, cats=None) -> None:
    cats = cats or ["random"] * len(boxes)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=harness.TRUTH_FIELDS)
        w.writeheader()
        for k, (b, t, c) in enumerate(zip(boxes, truths, cats, strict=True)):
            w.writerow(
                {"line_id": f"L{k}", "page": 1, "x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3],
                 "crop_file": "", "category": c, "truth_text": t, "notes": ""}
            )  # fmt: skip


# --- template ----------------------------------------------------------------------------------
def structured_pdf(path: Path) -> None:
    """A page with one line of each structural kind (all text synthetic) plus random lines."""
    doc = pymupdf.open()
    page = doc.new_page(width=900, height=600)
    inv = ~page.rotation_matrix
    # callout: text inside a circle
    page.draw_circle(pymupdf.Point(100, 100) * inv, 12, color=(0, 0, 0), width=0.7)
    draw_text(page, "A1", 94, 96, size=0.7)
    # scale: a line containing '='
    draw_text(page, "SCALE = ONE", 200, 80)
    # legend: a colon after two characters
    draw_text(page, "B1: WIDE", 200, 140)
    # dimension: text between two arrowheads
    for x in (300.0, 400.0):
        tri = [pymupdf.Point(x, 230), pymupdf.Point(x + (4 if x < 350 else -4), 228),
               pymupdf.Point(x + (4 if x < 350 else -4), 232)]  # fmt: skip
        page.draw_polyline([p * inv for p in [*tri, tri[0]]], color=None, fill=(0, 0, 0))
    draw_text(page, "1234", 335, 224)
    # mark: two characters on a thick member line
    page.draw_line(pymupdf.Point(100, 330) * inv, pymupdf.Point(300, 330) * inv, width=1.5)
    draw_text(page, "B7", 190, 320)
    # sheet: a tall title in the bottom right corner
    draw_text(page, "PLAN", 780, 480, size=2.0)
    for k in range(8):
        draw_text(page, f"RAND{k}", 60, 400 + k * 22)
    doc.save(str(path))
    doc.close()


def test_the_template_is_stratified_blank_and_reproducible(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    structured_pdf(pdf)
    out = tmp_path / "gt" / "ground_truth_text.csv"
    res = harness.write_template(pdf, out, seed=0)
    rows = harness.read_truth(out)
    assert res["total"] == len(rows)
    for cat in ("callout", "scale", "legend", "dimension", "mark", "sheet"):
        assert res["per_category"][cat] == 1, (cat, res)
    assert res["per_category"]["random"] == res["total"] - 6
    assert set(res["shortfall"]) == {"callout", "scale", "legend", "dimension", "mark", "sheet"}
    assert all(v == 4 for v in res["shortfall"].values())  # asked for 5, only 1 exists
    assert all(r["truth_text"] == "" and r["category"] for r in rows)  # never pre-filled
    assert all((out.parent / r["crop_file"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" for r in rows)
    again = tmp_path / "gt2.csv"
    harness.write_template(pdf, again, seed=0)
    assert [(r["bbox"], r["category"]) for r in harness.read_truth(again)] == [
        (r["bbox"], r["category"]) for r in rows
    ]


def test_the_template_never_overwrites_your_ground_truth(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    structured_pdf(pdf)
    out = tmp_path / "ground_truth_text.csv"
    out.write_text("precious")
    with pytest.raises(FileExistsError):
        harness.write_template(pdf, out)
    with pytest.raises(FileExistsError):  # regenerate does not help over a non-template
        harness.write_template(pdf, out, regenerate=True)
    assert out.read_text() == "precious"


def test_regenerate_replaces_a_blank_template_but_refuses_a_filled_one(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    structured_pdf(pdf)
    out = tmp_path / "ground_truth_text.csv"
    harness.write_template(pdf, out)
    with pytest.raises(FileExistsError):
        harness.write_template(pdf, out)  # exists, no regenerate
    harness.write_template(pdf, out, seed=3, regenerate=True)  # blank: allowed
    rows = list(csv.DictReader(out.open(newline="", encoding="utf-8")))
    rows[0]["truth_text"] = "B7"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=harness.TRUTH_FIELDS)
        w.writeheader()
        w.writerows(rows)
    before = out.read_text()
    with pytest.raises(FileExistsError):
        harness.write_template(pdf, out, regenerate=True)
    assert out.read_text() == before


def test_read_truth_strips_padding(tmp_path: Path) -> None:
    path = tmp_path / "padded.csv"
    path.write_text(
        "line_id , page,x0,y0,x1,y1,crop_file,category ,truth_text,notes\n"
        "L1 , 1 ,1,2,3,4,c.png, mark ,  B2 ,\n"
    )
    (row,) = harness.read_truth(path)
    assert row["page"] == 1 and row["category"] == "mark" and row["truth_text"] == "B2"


# --- metrics -----------------------------------------------------------------------------------
def test_metrics_are_computed_from_your_truth_only(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(
        truth,
        [*boxes, (700, 500, 750, 520), boxes[0]],
        ["B2", "S4.1", "HSS6x4x1/4", "BEAN", "NOWHERE", ""],
    )
    report = harness.evaluate(pdf, truth, library_without("4"), FONT)
    assert report["rows_in_file"] == 6 and report["rows_labeled"] == 5 and report["rows_blank"] == 1
    assert report["not_found"] == 1 and report["matched_to_a_decoded_line"] == 4
    assert (
        report["exact_match_rate_of_labeled"] == 0.2
    )  # only B2: S4.1 and HSS lack the digit 4, BEAM != BEAN
    assert report["exact_match_rate_of_matched"] == 0.25
    # decoded: B2 / S?.1 / HSS6x?x1/? / BEAM  ->  3 unknown of 20 characters, 2 of 4 lines
    assert report["unknown_char_rate"] == 0.15 and report["lines_with_unknown_rate"] == 0.5
    assert report["ocr_agreement_rate"] is None  # no engine was given
    cats = report["per_category"]
    assert report["per_sample_category"]["random"]["labeled"] == 5
    assert report["per_sample_category"]["random"]["exact"] == 1
    assert cats == {
        "designation": {"labeled": 1, "exact": 0},
        "sheet_number": {"labeled": 1, "exact": 0},
        "mark": {"labeled": 1, "exact": 1},
        "other": {"labeled": 2, "exact": 0},
    }


def test_a_fully_labeled_library_decodes_exactly_and_ocr_agreement_is_reported(
    tmp_path: Path,
) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(truth, boxes, LINES)
    engine = Scripted(["B2", "S4.1", "hss6x4x1/9", "BEAM"])
    report = harness.evaluate(pdf, truth, confirmed_library(FONT), FONT, engine)
    assert report["exact_match_rate_of_labeled"] == 1.0 and report["unknown_char_rate"] == 0.0
    assert report["ocr_lines_compared"] == 4 and report["ocr_agreement_rate"] == 0.75
    assert (
        report["ocr_exact_vs_truth_rate"] == 0.75
    )  # three of the four OCR strings are exactly right


def test_accuracy_is_reported_per_sample_category(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(
        truth, boxes, ["B2", "S4.1", "HSS6x4x1/4", "BEAN"], ["mark", "sheet", "random", "random"]
    )
    report = harness.evaluate(pdf, truth, confirmed_library(FONT), FONT)
    per = report["per_sample_category"]
    assert per["mark"] == {
        "labeled": 1,
        "matched": 1,
        "exact": 1,
        "exact_rate": 1.0,
        "unknown_char_rate": 0.0,
    }
    assert per["sheet"]["exact_rate"] == 1.0
    assert (
        per["random"]["labeled"] == 2
        and per["random"]["exact"] == 1
        and per["random"]["exact_rate"] == 0.5
    )


def test_an_empty_library_reads_everything_as_unknown(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(truth, boxes, LINES)
    report = harness.evaluate(pdf, truth, [], FONT)
    assert report["exact_match_rate_of_labeled"] == 0.0 and report["lines_with_unknown_rate"] == 1.0


def test_exclusions_give_the_truth_rectangles_per_page(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(truth, boxes[:2], ["B2", "S4.1"])
    assert harness.exclusions(truth) == {1: [tuple(b) for b in boxes[:2]]}
    assert harness.exclusions(tmp_path / "missing.csv") == {} and harness.exclusions(None) == {}


@pytest.mark.parametrize(
    ("text", "category"),
    [
        ("HSS6x4x1/4", "designation"),
        ("W18X35", "designation"),
        ("12'-6\"", "dimension"),
        ('3"', "dimension"),
        ('1/8" = 1\'-0"', "scale"),
        ("NTS", "scale"),
        ("S4.1", "sheet_number"),
        ("S030", "sheet_number"),
        ("B2", "mark"),
        ("B1 CONT", "mark"),
        ("BEAM LEGEND", "other"),
    ],
)
def test_target_categories(text: str, category: str) -> None:
    assert categorize(text) == category


# --- CLI ---------------------------------------------------------------------------------------
def test_cli_truth_template_and_refusal(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    pdf = tmp_path / "x.pdf"
    make_pdf(pdf)
    out = tmp_path / "ground_truth_text.csv"
    assert main(["truth-template", "--pdf", str(pdf), "--out", str(out)]) == 0
    printed = capsys.readouterr().out
    assert "truth_text left blank" in printed and "per category" in printed
    assert main(["truth-template", "--pdf", str(pdf), "--out", str(out)]) == 1
    assert "refusing to overwrite" in capsys.readouterr().err


def test_cli_import_refuses_a_bad_file_and_applies_a_good_one(
    dbp: DbProject, tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    seed(dbp)
    out = tmp_path / "review.csv"
    glyph_admin.export_csv(dbp.conn, dbp.font_id, out)
    rows = list(csv.DictReader(out.open(newline="", encoding="utf-8")))
    rows[0].update(label="A", status="confirmed")
    rows[1].update(status="approved")
    write_rows(out, rows)
    assert main(["import-csv", "--file", str(out), "--reviewer", "alice"]) == 1
    err = capsys.readouterr().err
    assert "status must be" in err and "nothing was changed" in err
    rows[1].update(status="proposed", label="")
    write_rows(out, rows)
    assert main(["import-csv", "--file", str(out), "--reviewer", "alice", "--dry-run"]) == 0
    assert "would apply 1" in capsys.readouterr().out
    assert main(["import-csv", "--file", str(out), "--reviewer", "alice"]) == 0
    assert "applied 1" in capsys.readouterr().out
    assert [r["label"] for r in dbp.library() if r["status"] == "confirmed"] == ["A"]


def test_cli_contact_sheets_and_summary(
    dbp: DbProject, tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    n = seed(dbp)
    assert (
        main(
            [
                "contact-sheets",
                "--font-id",
                dbp.font_id,
                "--out",
                str(tmp_path / "s"),
                "--per-sheet",
                "8",
            ]
        )
        == 0
    )
    assert f"wrote {-(-n // 8)} sheet(s)" in capsys.readouterr().out
    assert main(["summary", "--font-id", dbp.font_id]) == 0
    assert f"'proposed_groups': {n}" in capsys.readouterr().out


# --- AI draft, human review, truth-accept ---------------------------------------------------------
def _read(path: Path) -> list[dict]:
    return list(csv.DictReader(path.open(newline="", encoding="utf-8")))


def _write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=harness.TRUTH_FIELDS, restval="")
        w.writeheader()
        w.writerows(rows)


def _template(tmp_path: Path) -> Path:
    pdf = tmp_path / "x.pdf"
    structured_pdf(pdf)
    out = tmp_path / "ground_truth_text.csv"
    harness.write_template(pdf, out)
    return out


def test_drafts_go_into_draft_text_and_never_into_truth(tmp_path: Path) -> None:
    out = _template(tmp_path)
    ids = [r["line_id"] for r in _read(out)][:3]
    assert harness.set_drafts(out, {ids[0]: "A", ids[1]: "B"}, {ids[1]: "unclear"}) == 2
    rows = {r["line_id"]: r for r in _read(out)}
    assert rows[ids[0]]["draft_text"] == "A" and rows[ids[1]]["notes"] == "unclear"
    assert all(r["truth_text"] == "" and r["review"] == "" for r in rows.values())
    with pytest.raises(FileExistsError):  # a template with drafts is protected from regeneration
        harness.write_template(tmp_path / "x.pdf", out, regenerate=True)


def test_truth_accept_copies_ok_rows_and_takes_corrections(tmp_path: Path) -> None:
    out = _template(tmp_path)
    ids = [r["line_id"] for r in _read(out)][:5]
    harness.set_drafts(out, {i: f"D{k}" for k, i in enumerate(ids)})
    rows = _read(out)
    rows[0]["review"] = "OK"  # case does not matter
    rows[1]["correction"] = "FIXED"
    rows[2].update(review="ok", correction="BOTH")  # a typed correction wins
    rows[3]["review"] = "no"  # anything but ok accepts nothing
    _write(out, rows)  # row 4 has neither
    counts = harness.truth_accept(out)
    assert counts == {
        "accepted": 1, "corrected": 2, "left_empty": len(rows) - 3, "already_filled": 0
    }  # fmt: skip
    got = _read(out)
    assert [(r["truth_text"], r["truth_source"]) for r in got[:5]] == [
        ("D0", "ai_draft_accepted"),
        ("FIXED", "ai_draft_corrected"),
        ("BOTH", "ai_draft_corrected"),
        ("", ""),
        ("", ""),
    ]
    assert out.with_suffix(".csv.bak").exists()


def test_the_report_names_its_draft_source_and_counts_accepted_and_corrected(
    tmp_path: Path,
) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(truth, boxes, ["", "", *LINES[2:]], ["mark", "mark", "random", "random"])
    rows = _read(truth)
    rows[0].update(draft_text="B2", review="ok")
    rows[1].update(draft_text="S4.1", correction="S4.1")
    _write(truth, rows)
    harness.truth_accept(truth)
    report = harness.evaluate(pdf, truth, confirmed_library(FONT), FONT)
    assert report["draft_source"] == "AI, verified by human"
    assert report["rows_accepted_as_is"] == 1 and report["rows_corrected"] == 1
    assert report["rows_typed_by_owner"] == 2 and report["rows_labeled"] == 4


def test_a_report_without_ai_rows_says_human(tmp_path: Path) -> None:
    pdf = tmp_path / "x.pdf"
    boxes = make_pdf(pdf)
    truth = tmp_path / "truth.csv"
    write_truth(truth, boxes, LINES)
    report = harness.evaluate(pdf, truth, confirmed_library(FONT), FONT)
    assert report["draft_source"] == "human" and report["rows_typed_by_owner"] == 4


def test_cli_truth_accept_reports_counts(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    out = _template(tmp_path)
    rows = _read(out)
    rows[0].update(draft_text="X", review="ok")
    _write(out, rows)
    assert main(["truth-accept", "--truth", str(out)]) == 0
    assert "accepted as is: 1, corrected: 0" in capsys.readouterr().out
    assert main(["truth-accept", "--truth", str(tmp_path / "missing.csv")]) == 1
