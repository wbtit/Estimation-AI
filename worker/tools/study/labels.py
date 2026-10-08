"""Profile labels of a page with their boxes, baseline angle and generic context flags.

A label is one profile occurrence (the Phase 4d profile parser) in a text-layer line, located by
the character boxes of its span. Lines of running text (long notes) and the title-block strip are
excluded; the counts of exclusions are kept. Nothing here stores or prints the text itself except
the canonical profile string (a generic steel string).
"""

import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import pymupdf  # noqa: E402
from src.text_layer.parsers.profile import find_profiles  # noqa: E402

TITLE_X, TITLE_Y = 0.84, 0.88
NOTE_MAX_WORDS = 12  # a line with more words than this is running text, not a member label
GROUP_WORDS = re.compile(r"\bTYP\b|\bTYPICAL\b|\bSIM\b|\bSIMILAR\b|\bU\.?N\.?O\.?\b|\bEA\b|\bEACH\b", re.I)
QTY_BEFORE = re.compile(r"\(\s*\d+\s*\)\s*$")
CAMBER_AFTER = re.compile(r"^\s*\(\s*\d+(?:\s*\d/\d|/\d+)?\s*\"?\s*\)")


def _angle(direction: tuple[float, float], m: pymupdf.Matrix) -> float:
    dx, dy = direction
    ddx, ddy = dx * m.a + dy * m.c, dx * m.b + dy * m.d
    return round(math.degrees(math.atan2(-ddy, ddx)) % 360, 1)


def _union(rects: list[pymupdf.Rect], m: pymupdf.Matrix) -> list[float]:
    r = pymupdf.Rect(rects[0])
    for o in rects[1:]:
        r |= o
    r = r * m
    r.normalize()
    return [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)]


def page_labels(job: str, page_idx: int) -> tuple[list[dict], dict]:
    """(labels, exclusion counts) of one page."""
    excl = {"note_line": 0, "title_strip": 0}
    labels: list[dict] = []
    with common.open_doc(job) as doc:
        page = doc[page_idx]
        m = page.rotation_matrix
        w_, h_ = page.rect.width, page.rect.height
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
                found = find_profiles(text)
                if not found:
                    continue
                angle = _angle(ln["dir"], m)
                line_box = _union([r for r in rects], m)
                n_words = len(text.split())
                cx, cy = (line_box[0] + line_box[2]) / 2, (line_box[1] + line_box[3]) / 2
                for p in found:
                    box = _union(rects[p.span[0] : p.span[1]], m)
                    mx, my = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                    if n_words > NOTE_MAX_WORDS:
                        excl["note_line"] += 1
                        continue
                    if mx >= TITLE_X * w_ or my >= TITLE_Y * h_:
                        excl["title_strip"] += 1
                        continue
                    before, after = text[: p.span[0]], text[p.span[1] :]
                    labels.append(
                        {
                            "job": job, "page": page_idx, "bbox": box, "canonical": p.canonical,
                            "family": p.family, "angle_deg": angle, "line_bbox": line_box,
                            "line_words": n_words,
                            "group_note_in_line": bool(GROUP_WORDS.search(text)),
                            "quantity_prefix": bool(QTY_BEFORE.search(before)),
                            "camber_suffix": bool(CAMBER_AFTER.search(after)),
                            "profiles_in_line": len(found),
                        }
                    )  # fmt: skip
    return labels, excl
