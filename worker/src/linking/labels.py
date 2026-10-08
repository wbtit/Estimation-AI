"""Profile labels and mark labels of a page, with boxes and baseline angle (displayed points).

A profile label is one profile occurrence found by the Phase 4d profile parser in a text-layer line,
located by the character boxes of its span. A mark label is a mark-shaped word that has a legend row
(the caller passes the known marks); a mark without a legend row is not a label here. Lines of
running text (more than 12 words) and the title-block strip are excluded.
"""

import hashlib
import math
import re
from dataclasses import dataclass

import pymupdf

from src.text_layer.parsers.joist import find_joists
from src.text_layer.parsers.marks import MARK_RE
from src.text_layer.parsers.profile import find_profiles

TITLE_X, TITLE_Y = 0.84, 0.88
NOTE_MAX_WORDS = 12


@dataclass(frozen=True)
class Label:
    kind: str  # "profile" | "joist" | "mark"
    text: str  # the string as on the drawing (profile or joist raw, or the mark)
    canonical: str | None  # canonical profile (profile label) or joist designation (joist label)
    bbox: tuple[float, float, float, float]  # displayed points
    angle_deg: float
    quantity_prefix: bool
    key: str  # stable key of this label on its sheet


def label_key(sheet_id: str, kind: str, text: str, bbox: tuple[float, float, float, float]) -> str:
    q = ":".join(str(round(v * 2)) for v in bbox)
    return hashlib.sha256(f"{sheet_id}:{kind}:{text}:{q}".encode()).hexdigest()


def _angle(direction: tuple[float, float], m: pymupdf.Matrix) -> float:
    dx, dy = direction
    ddx, ddy = dx * m.a + dy * m.c, dx * m.b + dy * m.d
    return round(math.degrees(math.atan2(-ddy, ddx)) % 360, 1)


def _union(rects: list[pymupdf.Rect], m: pymupdf.Matrix) -> tuple[float, float, float, float]:
    r = pymupdf.Rect(rects[0])
    for o in rects[1:]:
        r |= o
    r = r * m
    r.normalize()
    return (round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2))


def page_labels(
    page: pymupdf.Page, sheet_id: str, legend_marks: set[str] | None = None
) -> list[Label]:
    m = page.rotation_matrix
    w_, h_ = page.rect.width, page.rect.height
    marks = legend_marks or set()
    out: list[Label] = []
    for block in page.get_text("rawdict")["blocks"]:
        if block["type"] != 0:
            continue
        for ln in block["lines"]:
            chars = [(c["c"], pymupdf.Rect(c["bbox"])) for sp in ln["spans"] for c in sp["chars"]]
            text, rects = "", []
            for ch, r in chars:
                if ch.isspace():
                    if text and not text.endswith(" "):
                        text += " "
                        rects.append(r)
                else:
                    text += ch
                    rects.append(r)
            text = text.rstrip()
            rects = rects[: len(text)]
            if not text:
                continue
            if len(text.split()) > NOTE_MAX_WORDS:
                continue
            angle = _angle(ln["dir"], m)

            def in_title(box: tuple[float, float, float, float]) -> bool:
                return (box[0] + box[2]) / 2 >= TITLE_X * w_ or (
                    box[1] + box[3]
                ) / 2 >= TITLE_Y * h_

            for p in find_profiles(text):
                box = _union(rects[p.span[0] : p.span[1]], m)
                if in_title(box):
                    continue
                prefix = bool(re.search(r"\(\s*\d+\s*\)\s*$", text[: p.span[0]]))
                out.append(
                    Label(
                        "profile",
                        p.raw,
                        p.canonical,
                        box,
                        angle,
                        prefix,
                        label_key(sheet_id, "profile", p.canonical, box),
                    )
                )
            taken = [p.span for p in find_profiles(text)]
            for j in find_joists(text):
                if any(a < j.span[1] and j.span[0] < b for a, b in taken):
                    continue
                box = _union(rects[j.span[0] : j.span[1]], m)
                if in_title(box):
                    continue
                out.append(
                    Label(
                        "joist",
                        j.raw,
                        j.canonical,
                        box,
                        angle,
                        False,
                        label_key(sheet_id, "joist", j.canonical, box),
                    )
                )
            if marks:
                for tok in re.finditer(r"\S+", text):
                    word = tok.group(0).strip(",;:()[]\"'").upper()
                    if word in marks and MARK_RE.match(word):
                        # skip a mark that is part of a profile string already taken as a label
                        box = _union(rects[tok.start() : tok.end()], m)
                        if in_title(box):
                            continue
                        out.append(
                            Label(
                                "mark",
                                word,
                                None,
                                box,
                                angle,
                                False,
                                label_key(sheet_id, "mark", word, box),
                            )
                        )
    return out
