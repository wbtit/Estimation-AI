"""Text of a page as words and lines in DISPLAYED coordinates (page rotation applied).

PyMuPDF reports text boxes in unrotated page space; on a page with rotation 90/270 that puts
"bottom-right" somewhere else on screen. Every box is mapped with the page's rotation matrix so
position logic (title block, label neighbours) works on what a person sees.
"""

from dataclasses import dataclass

import pymupdf


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass(frozen=True)
class Word:
    text: str
    box: Box


@dataclass(frozen=True)
class Line:
    text: str
    box: Box
    words: tuple[Word, ...]


def displayed_box(rect: pymupdf.Rect, page: pymupdf.Page) -> Box:
    r = pymupdf.Rect(rect) * page.rotation_matrix
    r.normalize()
    return Box(r.x0, r.y0, r.x1, r.y1)


def page_words_and_lines(page: pymupdf.Page) -> tuple[list[Word], list[Line]]:
    """Words and lines of the page's text layer (empty lists when there is none)."""
    raw = page.get_text("words")  # (x0, y0, x1, y1, text, block_no, line_no, word_no)
    words: list[Word] = []
    grouped: dict[tuple[int, int], list[tuple[int, Word]]] = {}
    for x0, y0, x1, y1, text, block_no, line_no, word_no in raw:
        if not text.strip():
            continue
        word = Word(text=text, box=displayed_box(pymupdf.Rect(x0, y0, x1, y1), page))
        words.append(word)
        grouped.setdefault((block_no, line_no), []).append((word_no, word))

    lines: list[Line] = []
    for items in grouped.values():
        ordered = [w for _, w in sorted(items, key=lambda item: item[0])]
        box = Box(
            min(w.box.x0 for w in ordered),
            min(w.box.y0 for w in ordered),
            max(w.box.x1 for w in ordered),
            max(w.box.y1 for w in ordered),
        )
        lines.append(Line(text=" ".join(w.text for w in ordered), box=box, words=tuple(ordered)))
    lines.sort(key=lambda ln: (round(ln.box.y0, 1), ln.box.x0))
    return words, lines
