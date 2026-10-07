"""A tiny SYNTHETIC monoline stroke font for tests. Made up; it resembles no real font.

Glyphs are lists of polylines in a cell 4 units wide and 6 units tall (y grows downward). Most
characters are several separate strokes, like the real thing, so clustering has to merge them.
"""

import pymupdf

from src.text_reader.geometry import Strokes
from src.text_reader.library import Entry, new_entry

_CIRCLE = [(1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0)]
_P = [(0, 6), (0, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)]

GLYPHS: dict[str, Strokes] = {
    "A": [[(0, 6), (2, 0), (4, 6)], [(0.9, 4), (3.1, 4)]],
    "B": [
        [(0, 0), (0, 6)],
        [(0, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)],
        [(0, 3), (3, 3), (4, 4), (4, 5), (3, 6), (0, 6)],
    ],
    "C": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5)]],
    "D": [[(0, 0), (0, 6)], [(0, 0), (2.5, 0), (4, 1.5), (4, 4.5), (2.5, 6), (0, 6)]],
    "E": [[(4, 0), (0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    "F": [[(4, 0), (0, 0), (0, 6)], [(0, 3), (3, 3)]],
    "G": [
        [(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5)],
        [(4, 5), (4, 3), (2.5, 3)],
    ],
    "H": [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    "I": [[(2, 0), (2, 6)]],
    "J": [[(4, 0), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "K": [[(0, 0), (0, 6)], [(4, 0), (0, 3.5)], [(1, 3), (4, 6)]],
    "L": [[(0, 0), (0, 6), (4, 6)]],
    "M": [[(0, 6), (0, 0), (2, 3), (4, 0), (4, 6)]],
    "N": [[(0, 6), (0, 0), (4, 6), (4, 0)]],
    "O": [_CIRCLE],
    "P": [_P],
    "Q": [_CIRCLE, [(2, 4), (4, 6.8)]],
    "R": [_P, [(2, 3), (4, 6)]],
    "S": [
        [
            (4, 1),
            (3, 0),
            (1, 0),
            (0, 1),
            (0, 2),
            (1, 3),
            (3, 3),
            (4, 4),
            (4, 5),
            (3, 6),
            (1, 6),
            (0, 5),
        ]
    ],
    "T": [[(0, 0), (4, 0)], [(2, 0), (2, 6)]],
    "U": [[(0, 0), (0, 5), (1, 6), (3, 6), (4, 5), (4, 0)]],
    "V": [[(0, 0), (2, 6), (4, 0)]],
    "W": [[(0, 0), (1, 6), (2, 3), (3, 6), (4, 0)]],
    "X": [[(0, 0), (4, 6)], [(4, 0), (0, 6)]],
    "Y": [[(0, 0), (2, 3), (4, 0)], [(2, 3), (2, 6)]],
    "Z": [[(0, 0), (4, 0), (0, 6), (4, 6)]],
    "0": [
        [(1.6, 0), (2.4, 0), (3.2, 1), (3.2, 5), (2.4, 6), (1.6, 6), (0.8, 5), (0.8, 1), (1.6, 0)]
    ],
    "1": [[(0.8, 1.2), (2, 0), (2, 6)]],
    "2": [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (0, 6), (4, 6)]],
    "3": [[(0, 0), (4, 0), (2, 2.5)], [(2, 2.5), (3.5, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "4": [[(3, 6), (3, 0), (0, 4), (4, 4)]],
    "5": [[(4, 0), (0, 0), (0, 3), (3, 3), (4, 4), (4, 5), (3, 6), (0, 6)]],
    "6": [
        [(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3), (0, 3.5)]
    ],
    "7": [[(0, 0), (4, 0), (1.5, 6)]],
    "8": [
        [(1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1, 3), (0, 2), (0, 1), (1, 0)],
        [(1, 3), (3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5), (0, 4), (1, 3)],
    ],
    "9": [
        [(0, 5), (1, 6), (3, 6), (4, 5), (4, 1), (3, 0), (1, 0), (0, 1), (0, 2), (1, 3), (4, 2.5)]
    ],
    "/": [[(0, 6), (4, 0)]],
    "-": [[(0.5, 3), (3.5, 3)]],
    "=": [[(0.5, 2.2), (3.5, 2.2)], [(0.5, 3.8), (3.5, 3.8)]],
    "'": [[(2, 0), (1.6, 1.4)]],
    ".": [[(0, 5.4), (0.6, 5.4), (0.6, 6), (0, 6), (0, 5.4)]],
    ":": [
        [(0, 1.4), (0.6, 1.4), (0.6, 2), (0, 2), (0, 1.4)],
        [(0, 5.4), (0.6, 5.4), (0.6, 6), (0, 6), (0, 5.4)],
    ],
}

SIZE = 1.1  # points per unit: a 6-unit character is 6.6 pt tall
LOWER_SCALE = 0.65  # lower case letters are drawn as the upper case glyph at this height
GAP = 1.0  # units between glyphs
SPACE = 3.0  # units of a space character (a word gap is then 0.67 of the character height)
STROKE_WIDTH = 0.84

LIBRARY_LABELS = [c for c in GLYPHS if c not in ".:="]  # dots and "=" are handled by fixed rules


def _bounds(strokes: Strokes) -> tuple[float, float]:
    xs = [x for s in strokes for x, _ in s]
    return min(xs), max(xs)


def glyph(ch: str) -> tuple[Strokes, float]:
    """Strokes (unit coordinates, baseline at y=6) and the advance of a character."""
    if ch.islower():
        base = GLYPHS[ch.upper()]
        strokes = [[(x * LOWER_SCALE, 6 - (6 - y) * LOWER_SCALE) for x, y in s] for s in base]
    else:
        strokes = GLYPHS[ch]
    x0, x1 = _bounds(strokes)
    return strokes, x1 + GAP


def draw_text(
    page: pymupdf.Page,
    text: str,
    x: float,
    y: float,
    size: float = SIZE,
    vertical: bool = False,
    underline: bool = False,
    colour: tuple[float, float, float] = (0, 0, 0),
) -> tuple[float, float, float, float]:
    """Draw text with its top-left at (x, y) in DISPLAYED coordinates. Returns its bbox.

    Vertical text reads bottom to top (rotated 90 degrees counter-clockwise).
    """
    inverse = ~page.rotation_matrix
    cursor = 0.0
    xs: list[float] = []
    ys: list[float] = []

    def put(strokes: Strokes, dx: float) -> None:
        for s in strokes:
            pts = []
            for gx, gy in s:
                if vertical:
                    px, py = x + gy * size, y - (dx + gx) * size
                else:
                    px, py = x + (dx + gx) * size, y + gy * size
                xs.append(px)
                ys.append(py)
                pts.append(pymupdf.Point(px, py) * inverse)
            if len(pts) == 1:
                pts = [pts[0], pts[0]]
            page.draw_polyline(pts, color=colour, width=STROKE_WIDTH)

    for ch in text:
        if ch == " ":
            cursor += SPACE
            continue
        strokes, adv = glyph(ch)
        put(strokes, cursor)
        cursor += adv
    if underline and not vertical:
        end = cursor - GAP
        step = 10.0 / size  # segments of 10 pt, like real underlines split into pieces
        a = 0.0
        while a < end:
            b = min(a + step, end)
            put([[(a, 7.2), (b, 7.2)]], 0.0)
            a = b
    return min(xs), min(ys), max(xs), max(ys)


def confirmed_library(font_id: str = "test-font") -> list[Entry]:
    """Confirmed library entries for the synthetic font (what a person would have labeled)."""
    return [new_entry(font_id, GLYPHS[ch], label=ch, status="confirmed") for ch in LIBRARY_LABELS]


def new_doc_page(
    width: float = 600, height: float = 400, rotation: int = 0
) -> tuple[pymupdf.Document, pymupdf.Page]:
    """A page whose DISPLAYED size is width x height, optionally stored rotated."""
    doc = pymupdf.open()
    if rotation in (90, 270):
        page = doc.new_page(width=height, height=width)
    else:
        page = doc.new_page(width=width, height=height)
    page.set_rotation(rotation)
    return doc, page
