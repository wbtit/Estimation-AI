"""Legend rows: a mark followed by a profile, from text-layer words."""

from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.review.legend import WordBox, legend_rows
from src.text_reader.job import read_project


def row(*texts: str, y: float = 100.0, x: float = 50.0, gap: float = 6.0) -> list[WordBox]:
    out, cx = [], x
    for t in texts:
        w = len(t) * 5.0
        out.append(WordBox(t, cx, y, cx + w, y + 8.0))
        cx += w + gap
    return out


def test_a_mark_then_a_profile_is_a_legend_row() -> None:
    rows = legend_rows(row("B1:", "HSS6x4x1/4", "FLAT"))
    assert [(r.mark, r.designation_raw, r.profile, r.remarks_raw) for r in rows] == [
        ("B1", "HSS6x4x1/4", "HSS6X4X1/4", "FLAT")
    ]


def test_separators_and_spacing_variants() -> None:
    assert [r.mark for r in legend_rows(row("C2", "=", "W 12 x 26"))] == ["C2"]
    assert [r.profile for r in legend_rows(row("B3", "-", "L3x3x1/4"))] == ["L3X3X1/4"]


def test_a_profile_without_a_mark_or_far_from_it_is_not_a_row() -> None:
    assert legend_rows(row("W12x26", "TYP")) == []
    assert (
        legend_rows(row("B1", "NOTE", "SEE", "ALSO", "W12x26")) == []
    )  # more than 2 tokens between
    assert legend_rows(row("BEAM", "W12x26")) == []  # BEAM is not mark-shaped


def test_words_far_apart_on_one_text_row_do_not_form_a_row() -> None:
    far = row("B1") + row("W12x26", x=900.0)
    assert legend_rows(far) == []


def test_table_rows_on_separate_lines_are_separate_rows() -> None:
    words = row("B1", "W12x26", y=100) + row("B2", "W14x30", y=120) + row("B1", "W12x26", y=300)
    rows = legend_rows(words)
    assert [(r.mark, r.profile) for r in rows] == [
        ("B1", "W12X26"),
        ("B2", "W14X30"),
    ]  # duplicates dropped


def test_read_text_stores_legend_rows_per_project(dbp: DbProject) -> None:
    doc = new_doc()
    vector_page(
        doc,
        "S0.1",
        "GENERAL NOTES",
        texts=[
            ((60, 600), "B1: HSS6x4x1/4", 10),
            ((60, 620), "B2: W12x26", 10),
            ((60, 640), "B1: W8x10", 10),
        ],
    )
    dbp.pdf_path.write_bytes(doc.tobytes())
    dbp.scan()
    totals = read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    rows = dbp.conn.execute(
        "SELECT mark, designation_raw, profile FROM legend_rows WHERE project_id = %s"
        " ORDER BY mark, designation_raw",
        (dbp.project_id,),
    ).fetchall()
    assert [(r["mark"], r["profile"]) for r in rows] == [
        ("B1", "HSS6X4X1/4"),
        ("B1", "W8X10"),
        ("B2", "W12X26"),
    ]
    assert totals["legend_rows"] == 3
    # reading again replaces the rows
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id)
    count = dbp.conn.execute(
        "SELECT count(*) AS n FROM legend_rows WHERE project_id = %s", (dbp.project_id,)
    ).fetchone()["n"]
    assert count == 3
