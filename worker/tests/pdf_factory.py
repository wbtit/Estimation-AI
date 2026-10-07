"""Builds small SYNTHETIC PDFs for tests. Nothing here resembles real project data."""

import pymupdf

LANDSCAPE = (1200, 800)  # points


def new_doc() -> pymupdf.Document:
    return pymupdf.open()


def add_lines(page: pymupdf.Page, count: int = 80) -> None:
    """Vector drawing paths: a grid of lines (enough to count as a vector drawing)."""
    for i in range(count):
        y = 60 + i * 6
        page.draw_line((50, y), (500, y))


def add_title_block(
    page: pymupdf.Page, number: str, title: str | None = None, labelled: bool = True
) -> None:
    """A title block in the bottom-right corner with a large sheet number."""
    w, h = page.rect.width, page.rect.height
    x = w - 220
    if labelled:
        page.insert_text((x, h - 90), "SHEET NO.", fontsize=7)
        page.insert_text((x, h - 60), number, fontsize=24)
        if title is not None:
            page.insert_text((x - 360, h - 90), "SHEET TITLE", fontsize=7)
            page.insert_text((x - 360, h - 70), title, fontsize=12)
    else:
        page.insert_text((x, h - 60), number, fontsize=24)
    for i, small in enumerate(("DATE: 2026-01-01", "DRAWN BY: XX", "CHECKED BY: YY")):
        page.insert_text((x, h - 40 + i * 9), small, fontsize=6)


def vector_page(
    doc: pymupdf.Document,
    number: str | None = None,
    title: str | None = None,
    labelled: bool = True,
    texts: list[tuple[tuple[float, float], str, float]] | None = None,
) -> pymupdf.Page:
    page = doc.new_page(width=LANDSCAPE[0], height=LANDSCAPE[1])
    add_lines(page)
    if number is not None:
        add_title_block(page, number, title, labelled)
    for pos, text, size in texts or []:
        page.insert_text(pos, text, fontsize=size)
    return page


def scanned_page(doc: pymupdf.Document, with_hidden_text: bool = False) -> pymupdf.Page:
    """A page that is one big raster image and has no vector drawing (a scan)."""
    page = doc.new_page(width=LANDSCAPE[0], height=LANDSCAPE[1])
    pix = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 600, 400), False)
    pix.set_rect(pix.irect, (235,))
    page.insert_image(page.rect, pixmap=pix)
    if with_hidden_text:  # like an OCR'd scan: invisible text over the image
        page.insert_text((60, 100), "S030 FRAMING PLAN " * 3, fontsize=14, render_mode=3)
    return page


def blank_page(doc: pymupdf.Document) -> pymupdf.Page:
    return doc.new_page(width=LANDSCAPE[0], height=LANDSCAPE[1])


def save(doc: pymupdf.Document, path: str) -> str:
    doc.save(path)
    doc.close()
    return path


def place(page: pymupdf.Page, displayed_xy: tuple[float, float], text: str, size: float) -> None:
    """Insert horizontal-reading text at a position given in DISPLAYED coordinates.

    Works for rotated pages: the displayed point is mapped back to unrotated page space and the
    text is rotated so it still reads horizontally when the page is shown.
    """
    unrotated = pymupdf.Point(*displayed_xy) * ~page.rotation_matrix
    page.insert_text(unrotated, text, fontsize=size, rotate=page.rotation % 360)


def rotated_vector_page(doc: pymupdf.Document, rotation: int, number: str) -> pymupdf.Page:
    """Displayed landscape 1200x800 (stored portrait 800x1200 + rotation), number bottom-right."""
    page = doc.new_page(width=800, height=1200)
    page.set_rotation(rotation)
    add_lines(page)
    place(page, (980, 740), number, 24)
    for i, small in enumerate(("DATE: 2026-01-01", "DRAWN BY: XX", "CHECKED BY: YY")):
        place(page, (980, 765 + i * 9), small, 6)
    return page
