"""Positioned text items (words and lines) from a page's PDF text layer.

Boxes are in DISPLAYED coordinates (page rotation applied), origin top-left, points. The baseline
angle is measured on the displayed page (degrees counter-clockwise, 0 = left to right), so a page
stored rotated does not make its upright text look rotated. Rotated text is kept and flagged by
`angle_deg`; it is not dropped.
"""

import hashlib
import math
from dataclasses import dataclass

import pymupdf

from src.text_layer.annotate import Catalog, annotate_line, annotate_word
from src.text_layer.quality import MIN_TEXT_CHARS, bad_char_count, is_usable, text_quality

UPRIGHT_TOL_DEG = 2.0  # within this of 0: upright
VERTICAL_TOL_DEG = 5.0  # within this of 90 or 270: orientation "vertical"


@dataclass
class PdfTextItem:
    level: str  # "word" | "line"
    text: str
    bbox: tuple[float, float, float, float]
    angle_deg: float
    orientation: str  # "horizontal" | "vertical"
    quality: float
    unprintable: int
    parsed: list[dict] | None = None

    @property
    def rotated(self) -> bool:
        a = self.angle_deg % 360
        return min(a, 360 - a) > UPRIGHT_TOL_DEG


@dataclass
class PageText:
    items: list[PdfTextItem]
    chars: int  # non-space characters on the page
    quality: float | None  # page text quality (None without text)

    @property
    def has_text_layer(self) -> bool:
        return self.chars >= MIN_TEXT_CHARS

    @property
    def usable(self) -> bool:
        return self.has_text_layer and is_usable(self.quality)


def pdf_item_key(sheet_id: str, level: str, bbox: tuple[float, float, float, float]) -> str:
    """Stable key of a pdf_text item: the sheet, the level and the bbox rounded to 0.5 pt."""
    q = ":".join(str(round(v * 2)) for v in bbox)
    return hashlib.sha256(f"{sheet_id}:{level}:{q}".encode()).hexdigest()


def _angle(direction: tuple[float, float], m: pymupdf.Matrix) -> float:
    dx, dy = direction
    ddx, ddy = dx * m.a + dy * m.c, dx * m.b + dy * m.d
    return round(math.degrees(math.atan2(-ddy, ddx)) % 360, 1)


def _orientation(angle: float) -> str:
    return (
        "vertical" if min(abs(angle - 90), abs(angle - 270)) <= VERTICAL_TOL_DEG else "horizontal"
    )


def _box(rects: list[pymupdf.Rect], m: pymupdf.Matrix) -> tuple[float, float, float, float]:
    r = pymupdf.Rect(rects[0])
    for other in rects[1:]:
        r |= other
    r = r * m
    r.normalize()
    return (round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2))


def extract_page_text(page: pymupdf.Page, catalog: Catalog | None = None) -> PageText:
    """Words and lines of the text layer with quality, angle and deterministic parser output."""
    m = page.rotation_matrix
    items: list[PdfTextItem] = []
    total = bad = 0
    for block in page.get_text("rawdict")["blocks"]:
        if block["type"] != 0:
            continue
        for ln in block["lines"]:
            chars = [(c["c"], pymupdf.Rect(c["bbox"])) for sp in ln["spans"] for c in sp["chars"]]
            text = "".join(c for c, _ in chars)
            if not text.strip():
                continue
            visible = [c for c, _ in chars if not c.isspace()]
            total += len(visible)
            line_bad = bad_char_count("".join(visible))
            bad += line_bad
            angle = _angle(ln["dir"], m)
            orientation = _orientation(angle)
            line_text = text.strip()
            line_quality = round(1 - line_bad / len(visible), 4) if visible else 1.0
            items.append(
                PdfTextItem(
                    "line",
                    line_text,
                    _box([r for c, r in chars if not c.isspace()], m),
                    angle,
                    orientation,
                    line_quality,
                    line_bad,
                    annotate_line(line_text, catalog) or None,
                )
            )
            word: list[tuple[str, pymupdf.Rect]] = []
            for c, r in [*chars, (" ", pymupdf.Rect())]:
                if c.isspace():
                    if word:
                        w_text = "".join(ch for ch, _ in word)
                        w_bad = bad_char_count(w_text)
                        items.append(
                            PdfTextItem(
                                "word",
                                w_text,
                                _box([rr for _, rr in word], m),
                                angle,
                                orientation,
                                round(1 - w_bad / len(w_text), 4),
                                w_bad,
                                annotate_word(w_text) or None,
                            )
                        )
                        word = []
                else:
                    word.append((c, r))
    quality = round(1 - bad / total, 4) if total else text_quality("")
    return PageText(items, total, quality)
