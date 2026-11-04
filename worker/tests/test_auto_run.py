"""auto_run: after the scan it reads the text of the pages and queues auto mode (synthetic PDFs)."""

from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.review.auto_run import auto_run, whole_sheet_box


def build_pdf(dbp: DbProject) -> None:
    doc = new_doc()
    page = vector_page(
        doc,
        "S4.1",
        "SECOND FLOOR FRAMING PLAN",
        texts=[
            ((60, 700), "B1: HSS6x4x1/4", 10),
            ((60, 716), "B2: W12x26", 10),
            ((60, 732), "B2: W14x30", 10),
        ],
    )
    # heavy beams (width 2): six labelled ones 100 pt apart and three far away (9 lines in all)
    for k in range(6):
        y = 120 + 100 * k
        page.draw_line((100, y), (700, y), width=2.0)
        page.insert_text((300, y - 6), "W12x26", fontsize=8)
    for y in (100, 300, 500):
        page.draw_line((820, y), (1020, y), width=2.0)
    page.insert_text((300, 273), "W16x31", fontsize=8)  # halfway between two beams: a tie
    page.insert_text((1100, 600), "W10x12", fontsize=8)  # outside the view box
    page.insert_text((600, 114), "B1", fontsize=8)  # a mark with a legend row, just above a beam
    page.insert_text((650, 214), "B2", fontsize=8)  # a mark with two different legend rows
    dbp.pdf_path.write_bytes(doc.tobytes())


def test_whole_sheet_box_matches_the_api_margins() -> None:
    assert whole_sheet_box(1000, 800) == {"x0": 25.0, "y0": 20.0, "x1": 860.0, "y1": 780.0}


def test_by_default_the_pipeline_reads_the_text_and_creates_no_members(dbp: DbProject) -> None:
    # pieces come only from a person's Build; auto mode (suggestions only) is queued next
    build_pdf(dbp)
    dbp.scan()
    result = auto_run(dbp.conn, dbp.config, dbp.project_id, dbp.document_id)
    n = dbp.conn.execute(
        "SELECT count(*) AS n FROM members WHERE project_id = %s", (dbp.project_id,)
    ).fetchone()["n"]
    assert n == 0
    items = dbp.conn.execute(
        "SELECT count(*) AS n FROM text_items t JOIN sheets s ON s.id = t.sheet_id"
        " WHERE s.project_id = %s",
        (dbp.project_id,),
    ).fetchone()["n"]
    assert items > 0  # the label text is still read and stored
    assert result["auto_build_queued"] == 1
