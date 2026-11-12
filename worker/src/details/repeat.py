"""Text that repeats in the same title-block position on most sheets (Phase 0 cover details).

The project name, the project number, the firms and the address are printed again on every
sheet, at the same place; the sheet number and the sheet title are not. For each group of sheets of
one page size, a text counts when it sits in the same cell (3 % of the page, neighbours merged)
on at least `MIN_SHEETS` sheets and on at least `MIN_SHARE` of the group. Only the title-block
region is read
(bottom-right corner and right strip, as `pdf_scan.sheet_id`).
"""

from __future__ import annotations

import re
from collections import defaultdict
from statistics import median

from src.details.types import PageText, box_t
from src.pdf_scan.sheet_id import TITLE_BLOCK_CORNER, TITLE_BLOCK_STRIP

MIN_SHEETS = 3
MIN_SHARE = 0.6
CELL = 0.03
MIN_CHARS = 4


def norm(text: str) -> str:
    """Upper case, punctuation to spaces, one space: how two texts are compared."""
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", text.upper())).strip()


def in_title_block(cx: float, cy: float, pw: float, ph: float) -> bool:
    corner = cx >= TITLE_BLOCK_CORNER[0] * pw and cy >= TITLE_BLOCK_CORNER[1] * ph
    return corner or cx >= TITLE_BLOCK_STRIP * pw


def size_class(p: PageText) -> tuple[int, int]:
    return (round(p.width / 36), round(p.height / 36))


def repeated_texts(pages: list[PageText], skip: set[int] | None = None) -> list[dict]:
    """[{text, norm, pages, share, page_index, box, height}] best first."""
    skip = skip or set()
    groups: dict[tuple[int, int], list[PageText]] = defaultdict(list)
    for p in pages:
        if p.page_index not in skip and p.lines:
            groups[size_class(p)].append(p)
    out: list[dict] = []
    for sheets in groups.values():
        if len(sheets) < MIN_SHEETS:
            continue
        seen: dict[str, dict[tuple[int, int], dict[int, tuple]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        for p in sheets:
            for ln in p.lines:
                if not in_title_block(ln.box.cx, ln.box.cy, p.width, p.height):
                    continue
                n = norm(ln.text)
                if len(n) < MIN_CHARS:
                    continue
                cell = (int(ln.box.cx / p.width / CELL), int(ln.box.cy / p.height / CELL))
                seen[n][cell][p.page_index] = (ln.text, box_t(ln.box), ln.box.height)
        for n, cells in seen.items():
            best = None
            for cx, cy in cells:
                near: dict[int, tuple] = {}
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        near.update(cells.get((cx + dx, cy + dy), {}))
                if best is None or len(near) > len(best):
                    best = near
            assert best is not None
            if len(best) >= MIN_SHEETS and len(best) / len(sheets) >= MIN_SHARE:
                first = best[min(best)]
                out.append(
                    {
                        "text": first[0].strip(),
                        "norm": n,
                        "pages": len(best),
                        "share": round(len(best) / len(sheets), 3),
                        "page_index": min(best),
                        "box": list(first[1]),
                        "height": round(median(v[2] for v in best.values()), 1),
                    }
                )
    out.sort(key=lambda r: (-r["share"], -r["height"], r["norm"]))
    return out
