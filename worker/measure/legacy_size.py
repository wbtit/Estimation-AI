"""The page size the measurement harnesses were run with, FROZEN (fix/crop-anywhere, 2026-11-06).

Before that fix `src.build.propose.displayed_size` swapped width and height on a page with rotation
90/270, but PyMuPDF's `page.rect` already has the rotation applied, so rotated pages were mis-sized
(the app now uses the unswapped size). The harnesses in measure/ keep the old function so their
recorded numbers still reproduce; numbers on ROTATED dev pages are therefore suspect, and a
re-measure with the fix is a separate, pre-registered task (docs/SPEC.md Decision Log).
"""

from __future__ import annotations

import pymupdf


def displayed_size(page: pymupdf.Page) -> tuple[float, float]:
    """The pre-fix size: (height, width) of page.rect on a rotated page (wrong; kept frozen)."""
    w, h = page.rect.width, page.rect.height
    return (h, w) if page.rotation in (90, 270) else (w, h)
