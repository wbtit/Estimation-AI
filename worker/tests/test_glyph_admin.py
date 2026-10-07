"""Glyph library lifecycle: constraints, contact sheets, CSV round trip (real Postgres)."""

import csv
from pathlib import Path

import psycopg
import pymupdf
import pytest
from db_fixtures import DbProject, confirm_by_font, vector_text_page
from psycopg.types.json import Jsonb
from stroke_font import draw_text

from src.text_reader import glyph_admin
from src.text_reader.job import read_project


def seed(dbp: DbProject) -> int:
    doc = pymupdf.open()
    page = vector_text_page(doc)
    draw_text(page, "BEAM LEGEND", 60, 80)
    draw_text(page, "B1: HSS6x4x1/4", 60, 110)
    doc.save(str(dbp.pdf_path))
    doc.close()
    dbp.scan()
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, None)
    return len(dbp.library())


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def write_rows(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=glyph_admin.CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)


def snapshot(dbp: DbProject) -> list[tuple]:
    return [(r["signature_hash"], r["label"], r["status"], r["reviewed_by"]) for r in dbp.library()]


# --- constraints -------------------------------------------------------------------------------
def test_a_confirmed_group_needs_a_label_and_a_reviewer(dbp: DbProject) -> None:
    seed(dbp)
    gid = dbp.library()[0]["id"]
    for sql in (
        "UPDATE glyph_library SET status = 'confirmed' WHERE id = %s",
        "UPDATE glyph_library SET status = 'confirmed', label = 'B' WHERE id = %s",
    ):
        with pytest.raises(psycopg.errors.CheckViolation):
            dbp.conn.execute(sql, (gid,))
        dbp.conn.rollback()


def test_a_shape_exists_once_per_font(dbp: DbProject) -> None:
    seed(dbp)
    row = dbp.library()[0]
    with pytest.raises(psycopg.errors.UniqueViolation):
        dbp.conn.execute(
            "INSERT INTO glyph_library (font_id, signature_hash, strokes) VALUES (%s, %s, '[]')",
            (dbp.font_id, row["signature_hash"]),
        )
    dbp.conn.rollback()


# --- contact sheets ----------------------------------------------------------------------------
def test_contact_sheets_show_only_unlabeled_groups(dbp: DbProject, tmp_path: Path) -> None:
    n = seed(dbp)
    sheets = glyph_admin.contact_sheets(dbp.conn, dbp.font_id, tmp_path / "sheets", per_sheet=10)
    assert len(sheets) == -(-n // 10)
    for p in sheets:
        assert p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    confirm_by_font(dbp)
    assert glyph_admin.contact_sheets(dbp.conn, dbp.font_id, tmp_path / "again") == []


# --- CSV round trip ----------------------------------------------------------------------------
def test_export_prefills_ocr_proposals_and_orders_by_frequency(
    dbp: DbProject, tmp_path: Path
) -> None:
    seed(dbp)
    row = dbp.library()[0]
    dbp.conn.execute(
        "UPDATE glyph_library SET votes = %s, proposed_label = 'S' WHERE id = %s",
        (Jsonb({"S": 5, "5": 1}), row["id"]),
    )
    dbp.conn.commit()
    out = tmp_path / "review.csv"
    n = glyph_admin.export_csv(dbp.conn, dbp.font_id, out)
    rows = read_rows(out)
    assert n == len(rows) == len(dbp.library())
    first = next(r for r in rows if r["signature_hash"] == row["signature_hash"])
    assert (first["label"], first["proposed_label"], first["votes"]) == ("S", "S", "S:5|5:1")
    assert first["status"] == "proposed"  # an OCR proposal is not a confirmation
    counts = [int(r["seen_count"]) for r in rows]
    assert counts == sorted(counts, reverse=True)


def test_import_confirms_labels_and_records_who_and_when(dbp: DbProject, tmp_path: Path) -> None:
    seed(dbp)
    out = tmp_path / "review.csv"
    glyph_admin.export_csv(dbp.conn, dbp.font_id, out)
    rows = read_rows(out)
    for r, ch in zip(rows[:3], "ABC", strict=True):
        r["label"], r["status"] = ch, "confirmed"
    write_rows(out, rows)
    result = glyph_admin.import_csv(dbp.conn, out, reviewer="alice")
    assert result.errors == [] and result.applied == 3
    done = {r["signature_hash"]: r for r in dbp.library() if r["status"] == "confirmed"}
    assert {done[r["signature_hash"]]["label"] for r in rows[:3]} == {"A", "B", "C"}
    for r in done.values():
        assert (r["reviewed_by"], r["source"]) == ("alice", "csv_import") and r[
            "reviewed_at"
        ] is not None
    # a second import of the same file changes nothing
    again = glyph_admin.import_csv(dbp.conn, out, reviewer="alice")
    assert (again.applied, again.errors) == (0, [])


def test_only_confirmed_labels_are_used_after_an_import(dbp: DbProject, tmp_path: Path) -> None:
    seed(dbp)
    out = tmp_path / "review.csv"
    glyph_admin.export_csv(dbp.conn, dbp.font_id, out)
    rows = read_rows(out)
    for r in rows:
        r["label"] = "Z"  # a draft label, but the status stays "proposed"
    write_rows(out, rows)
    glyph_admin.import_csv(dbp.conn, out, reviewer="alice")
    read_project(dbp.conn, dbp.config, dbp.project_id, dbp.document_id, dbp.font_id, None)
    texts = [i["text"] for i in dbp.items() if i["text"]]
    assert texts and all("Z" not in t for t in texts)


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda r: r.update(status="approved"), "status must be"),
        (lambda r: r.update(status="confirmed", label=""), "1 to 3 characters"),
        (lambda r: r.update(status="confirmed", label="ABCD"), "1 to 3 characters"),
        (lambda r: r.update(signature_hash="f" * 64), "no glyph"),
    ],
)
def test_a_bad_row_refuses_the_whole_file_and_changes_nothing(
    dbp: DbProject, tmp_path: Path, edit, message: str
) -> None:
    seed(dbp)
    out = tmp_path / "review.csv"
    glyph_admin.export_csv(dbp.conn, dbp.font_id, out)
    rows = read_rows(out)
    rows[0].update(label="A", status="confirmed")  # a valid edit...
    edit(rows[1])  # ...next to an invalid one
    write_rows(out, rows)
    before = snapshot(dbp)
    result = glyph_admin.import_csv(dbp.conn, out, reviewer="alice")
    assert result.applied == 0 and any(message in e for e in result.errors)
    assert snapshot(dbp) == before


def test_duplicate_rows_dry_run_missing_columns_and_reviewer(
    dbp: DbProject, tmp_path: Path
) -> None:
    seed(dbp)
    out = tmp_path / "review.csv"
    glyph_admin.export_csv(dbp.conn, dbp.font_id, out)
    rows = read_rows(out)
    rows[0].update(label="A", status="confirmed")
    before = snapshot(dbp)

    write_rows(out, rows)
    dry = glyph_admin.import_csv(dbp.conn, out, reviewer="alice", dry_run=True)
    assert (
        dry.errors == [] and dry.applied == 1 and snapshot(dbp) == before
    )  # reports, changes nothing

    write_rows(out, [*rows, rows[0]])
    assert any("duplicate row" in e for e in glyph_admin.import_csv(dbp.conn, out, "alice").errors)

    assert glyph_admin.import_csv(dbp.conn, out, reviewer="  ").errors == [
        "a reviewer name is required"
    ]

    out.write_text("font_id,label\nx,y\n")
    assert "missing columns" in glyph_admin.import_csv(dbp.conn, out, "alice").errors[0]
    assert snapshot(dbp) == before


def test_a_confirmed_label_can_be_withdrawn(dbp: DbProject, tmp_path: Path) -> None:
    seed(dbp)
    confirm_by_font(dbp)
    out = tmp_path / "all.csv"
    glyph_admin.export_csv(dbp.conn, dbp.font_id, out, only_unconfirmed=False)
    rows = read_rows(out)
    rows[0]["status"] = "proposed"
    write_rows(out, rows)
    assert glyph_admin.import_csv(dbp.conn, out, reviewer="bob").applied == 1
    changed = next(r for r in dbp.library() if r["signature_hash"] == rows[0]["signature_hash"])
    assert (changed["status"], changed["reviewed_by"]) == ("proposed", "bob")


def test_summary_counts_groups_and_instances(dbp: DbProject) -> None:
    n = seed(dbp)
    s = glyph_admin.summarize(dbp.conn, dbp.font_id)
    assert s["proposed_groups"] == n and "confirmed_groups" not in s
    confirm_by_font(dbp)
    s = glyph_admin.summarize(dbp.conn, dbp.font_id)
    assert s["confirmed_groups"] + s.get("proposed_groups", 0) == n
