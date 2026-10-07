"""Optional OCR cross-check. Off by default; never the source of truth; no network.

The real engine (rapidocr-onnxruntime, in the optional `ocr` dependency group) is imported only
when an engine is constructed. The logic below works with any object that has
`read(image) -> str`, which is how it is tested without the model.
"""

from collections import Counter
from collections.abc import Callable
from typing import Protocol

import numpy as np
import pymupdf

from src.text_reader.library import Entry
from src.text_reader.lines import Line

CROP_DPI = 400
CROP_PAD_PT = 1.0
CROP_MARGIN_PX = 40


class OcrEngine(Protocol):
    def read(self, image: np.ndarray) -> str: ...


class OcrUnavailableError(RuntimeError):
    pass


class RapidOcrEngine:
    """Local ONNX OCR. Models ship inside the pip package; nothing is downloaded or sent."""

    def __init__(self) -> None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError as err:
            raise OcrUnavailableError(
                "OCR cross-check is enabled but the optional package is not installed "
                "(run make setup-ocr)"
            ) from err
        self._engine = RapidOCR()

    def read(self, image: np.ndarray) -> str:
        result, _ = self._engine(image)
        if not result:
            return ""
        ordered = sorted(result, key=lambda r: r[0][0][0])
        return " ".join(str(r[1]) for r in ordered)


def render_crop(
    page: pymupdf.Page, bbox: tuple[float, float, float, float], dpi: int = CROP_DPI
) -> np.ndarray:
    """RGB crop of a region given in DISPLAYED coordinates, with a white margin."""
    x0, y0, x1, y1 = bbox
    clip = pymupdf.Rect(x0 - CROP_PAD_PT, y0 - CROP_PAD_PT, x1 + CROP_PAD_PT, y1 + CROP_PAD_PT)
    pix = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    return np.pad(
        img,
        ((CROP_MARGIN_PX, CROP_MARGIN_PX), (CROP_MARGIN_PX, CROP_MARGIN_PX), (0, 0)),
        constant_values=255,
    )


def fold(text: str) -> str:
    """Comparison form: upper case, no whitespace."""
    return "".join(text.upper().split())


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def collect_votes(
    page: pymupdf.Page,
    lines: list[Line],
    entry_of: Callable[..., Entry | None],
    engine: OcrEngine,
    exclude: list[tuple[float, float, float, float]] | None = None,
) -> tuple[dict[str, Counter], dict[str, int]]:
    """Per-glyph OCR votes: {signature_hash: Counter(char)}, plus counters for reporting.

    Conservative: a line votes only if it has no attached small marks, every character cluster
    already has a library entry, and the OCR string (spaces removed) has exactly one character per
    cluster. Letters are counted case-insensitively. Lines overlapping `exclude` (the ground-truth
    file) never vote, so the labeled evaluation set stays separate.
    """
    votes: dict[str, Counter] = {}
    stats = {
        "lines": 0,
        "voting": 0,
        "length_mismatch": 0,
        "no_entry": 0,
        "has_marks": 0,
        "excluded": 0,
    }
    for line in lines:
        stats["lines"] += 1
        if exclude and any(_iou(line.bbox, r) > 0.1 for r in exclude):
            stats["excluded"] += 1
            continue
        if line.marks:
            stats["has_marks"] += 1
            continue
        entries = [entry_of(c) for c in line.members]
        if any(e is None for e in entries):
            stats["no_entry"] += 1
            continue
        text = "".join(engine.read(render_crop(page, line.bbox)).split())
        if len(text) != len(entries):
            stats["length_mismatch"] += 1
            continue
        stats["voting"] += 1
        for e, ch in zip(entries, text, strict=True):
            assert e is not None
            votes.setdefault(e.signature_hash, Counter())[ch.upper() if ch.isalpha() else ch] += 1
    return votes, stats


def proposed_label(counter: Counter) -> str | None:
    """The majority character, or None on a tie or no votes."""
    top = counter.most_common(2)
    if not top or (len(top) == 2 and top[0][1] == top[1][1]):
        return None
    return top[0][0]
