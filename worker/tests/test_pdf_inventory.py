"""The read-only inventory tool, on synthetic PDFs generated here (no real drawings)."""

import sys
from pathlib import Path

import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import pdf_inventory as inv  # noqa: E402
from stroke_font import draw_text  # noqa: E402


def make(path: Path, build, width: float = 3000, height: float = 2000, producer: str = "") -> Path:
    doc = pymupdf.open()
    page = doc.new_page(width=width, height=height)
    build(page)
    if producer:
        doc.set_metadata({"producer": producer})
    doc.save(str(path))
    doc.close()
    return path


def test_producer_categories_are_generic() -> None:
    assert inv.producer_category({"producer": "Bluebeam Stamp 21"}) == "Bluebeam"
    assert inv.producer_category({"creator": "AutoCAD 2020 - DWG To PDF"}) == "AutoCAD"
    assert inv.producer_category({"producer": "Something Else"}) == "other"
    assert inv.producer_category({}) == "unknown"


def test_page_size_classes() -> None:
    assert inv.size_class(612, 792) == "letter" and inv.size_class(842, 595) == "a4"
    assert inv.size_class(3024, 2160) == "large" and inv.size_class(300, 300) == "other"


def test_a_real_dash_pattern_is_counted_as_real(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.draw_line((100, 100), (900, 100), dashes="[8 4] 0", width=1)

    row = inv.inspect(make(tmp_path / "a.pdf", build), "job-x", "t")
    assert row["real_dash_paths"] == 1 and row["exploded_dash_segments"] == 0
    assert row["dash_kind"] == "real"


def test_exploded_dashes_are_counted_and_a_lone_line_is_not(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        for k in range(10):  # ten 8 pt segments with a 4 pt gap, each its own path
            page.draw_line((100 + k * 12, 100), (108 + k * 12, 100), width=1)
        page.draw_line((100, 300), (108, 300), width=1)  # a single short line
        page.draw_line((100, 500), (108, 500), width=1)
        page.draw_line((300, 500), (308, 500), width=1)  # two far apart: not a run

    row = inv.inspect(make(tmp_path / "b.pdf", build), "job-x", "t")
    assert row["exploded_dash_segments"] == 10 and row["dash_kind"] == "exploded"
    assert row["real_dash_paths"] == 0


def test_circles_with_a_short_label_are_counted(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.draw_circle((200, 200), 15, width=1)
        page.insert_text((195, 205), "A", fontsize=12)  # a text-layer label inside
        page.draw_circle((400, 200), 15, width=1)  # empty circle
        page.draw_circle((600, 200), 15, width=1)
        page.insert_text((570, 205), "LONG LABEL TEXT", fontsize=8)  # too long to be a bubble

    row = inv.inspect(make(tmp_path / "c.pdf", build), "job-x", "t")
    assert row["circles"] == 3 and row["labelled_circles"] == 1


def test_an_outlined_label_inside_a_circle_counts_without_a_text_layer(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.draw_circle((200, 200), 14, width=1)
        draw_text(page, "B", 197, 196, size=0.7)  # stroked paths, no text layer

    row = inv.inspect(make(tmp_path / "d.pdf", build), "job-x", "t")
    assert row["circles"] == 1 and row["labelled_circles"] == 1
    assert row["text_layer"] == "no"


def test_text_layer_and_type_guess(tmp_path: Path) -> None:
    doc = pymupdf.open()
    for _ in range(3):
        page = doc.new_page(width=612, height=792)
        for k in range(60):
            page.insert_text((50, 50 + k * 11), "ITEM DESCRIPTION QTY UNIT PRICE TOTAL", fontsize=8)
    doc.save(str(tmp_path / "e.pdf"))
    row = inv.inspect(tmp_path / "e.pdf", "job-x", "t")
    assert row["type_guess"] == "estimate/takeoff document" and row["text_layer"] == "yes"
    assert (
        row["page_size_class"] == "letter" and row["circles"] == ""
    )  # no geometry for non drawings


def test_a_raster_only_page_is_flagged(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 300, 200), False)
        pix.clear_with(200)
        page.insert_image(page.rect, pixmap=pix)

    row = inv.inspect(make(tmp_path / "f.pdf", build), "job-x", "t")
    assert row["raster_only"] == "yes" and row["text_layer"] == "no"
    assert row["vector_no_text_pages"] == 0


def test_an_unreadable_file_is_an_error_class_not_a_crash(tmp_path: Path) -> None:
    bad = tmp_path / "g.pdf"
    bad.write_bytes(b"not a pdf")
    row = inv.inspect(bad, "job-x", "t")
    assert row["error"] and row["pages"] == ""


def test_output_never_contains_file_names(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    root = tmp_path / "SecretFolderName"
    root.mkdir()
    make(root / "Acme Corp Floor Plan.pdf", lambda p: p.draw_circle((100, 100), 10))
    out = tmp_path / "out"
    sys.argv = ["x", "--item", f"set-X={root}", "--out", str(out)]
    assert inv.main() == 0
    printed = capsys.readouterr().out
    assert "Acme" not in printed and "Secret" not in printed and "job-002" in printed
    assert "Acme" in (out / "inventory_map.csv").read_text()  # the mapping file is the only place
    assert "Acme" not in (out / "inventory.csv").read_text()


def test_labelled_circles_are_found_on_a_rotated_page(tmp_path: Path) -> None:
    def build(page: pymupdf.Page) -> None:
        page.set_rotation(270)
        inv_m = ~page.rotation_matrix  # draw in displayed coordinates
        centre = pymupdf.Point(400, 300)
        page.draw_circle(centre * inv_m, 15, width=1)
        page.insert_text(pymupdf.Point(396, 304) * inv_m, "A", fontsize=12)

    row = inv.inspect(make(tmp_path / "h.pdf", build), "job-x", "t")
    assert row["circles"] == 1 and row["labelled_circles"] == 1
