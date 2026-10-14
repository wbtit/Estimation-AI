"""sheet_lines job: payload tests and a round trip on the (test) Postgres; synthetic PDFs."""

import json

import pytest
from db_fixtures import DbProject
from pdf_factory import new_doc, vector_page

from src.linking.lines import Line, page_lines
from src.review.sheet_lines_job import MIN_SNAP_PT, SheetLinesError, lines_payload, sheet_lines


def line(x0, y0, x1, y1, width=1.0, colour="black", dashed=False) -> Line:
    return Line(x0, y0, x1, y1, width, colour, dashed, 1)


def test_payload_keeps_every_class_and_drops_tiny_lines():
    lines = [
        line(0, 0, 100, 0, width=2.0),
        line(0, 10, 100, 10, width=0.25),
        line(0, 20, 100, 20, width=0.25, dashed=True),
        line(5, 5, 6, 5),  # 1 pt: a dot, not a snap target
    ]
    classes, rows, version = lines_payload(lines)
    assert len(rows) == 3 and len(classes) == 3
    assert {r[4] for r in rows} == {0, 1, 2}  # every class is represented, none is picked
    assert all(len(r) == 6 for r in rows)
    assert min((r[2] - r[0]) ** 2 + (r[3] - r[1]) ** 2 for r in rows) ** 0.5 >= MIN_SNAP_PT
    assert len(version) == 16


def test_payload_is_deterministic_and_version_follows_content():
    a = [line(0, 0, 100, 0), line(0, 10, 100, 10)]
    b = list(reversed(a))
    assert lines_payload(a) == lines_payload(b)
    assert lines_payload(a)[2] != lines_payload([line(0, 0, 100, 0)])[2]


def test_payload_on_a_real_page_has_all_widths():
    doc = new_doc()
    page = doc.new_page(width=400, height=300)
    page.draw_line((10, 10), (200, 10), width=2.0)
    page.draw_line((10, 30), (200, 30), width=0.3)
    classes, rows, _ = lines_payload(page_lines(page))
    assert len(rows) == 2 and len(classes) == 2


def build_pdf(dbp: DbProject) -> None:
    doc = new_doc()
    page = vector_page(doc, "S4.1", "FRAMING PLAN", texts=[((60, 700), "W12x26", 10)])
    page.draw_line((100, 120), (700, 120), width=2.0)
    page.draw_line((100, 300), (700, 300), width=0.3)
    dbp.pdf_path.write_bytes(doc.tobytes())


def test_the_job_writes_one_row_and_rewrites_it(dbp: DbProject) -> None:
    build_pdf(dbp)
    dbp.scan()
    sheet_id = dbp.conn.execute(
        "SELECT id FROM sheets WHERE project_id = %s AND page_index = 0", (dbp.project_id,)
    ).fetchone()["id"]
    out = sheet_lines(dbp.conn, dbp.config, str(sheet_id))
    row = dbp.conn.execute("SELECT * FROM sheet_lines WHERE sheet_id = %s", (sheet_id,)).fetchone()
    assert row["n_lines"] == out["lines"] > 0 and row["version"] == out["version"]
    lines = row["lines"]
    assert any(
        abs(r[0] - 100) < 0.5 and abs(r[2] - 700) < 0.5 and abs(r[1] - 120) < 0.5 for r in lines
    )
    assert json.loads(json.dumps(row["classes"])) == row["classes"]
    again = sheet_lines(dbp.conn, dbp.config, str(sheet_id))  # idempotent: same version, one row
    assert again["version"] == out["version"]
    assert (
        dbp.conn.execute(
            "SELECT count(*) AS n FROM sheet_lines WHERE sheet_id = %s", (sheet_id,)
        ).fetchone()["n"]
        == 1
    )


def test_unknown_sheet_is_an_error(dbp: DbProject) -> None:
    with pytest.raises(SheetLinesError):
        sheet_lines(dbp.conn, dbp.config, "00000000-0000-0000-0000-000000000000")
