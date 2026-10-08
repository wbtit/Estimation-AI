"""Per-page analysis: content type (vector or scanned), sheet number/title, classification, scales.

Deterministic. No OCR, no LLM, no invented values: anything that cannot be read stays None and
adds a review reason. Thresholds below are tunable defaults, not measured values.
"""

import re
from dataclasses import dataclass, field

import pymupdf

from src.pdf_scan.pagetype import guess_page_type
from src.pdf_scan.textlines import displayed_box, page_words_and_lines
from src.pdf_scan.textscan import scan_text
from src.text_layer.parsers.profile import find_profiles
from src.text_layer.quality import is_usable, text_quality

MIN_TEXT_CHARS = 20  # fewer non-space characters than this: no real text layer
MIN_VECTOR_PATHS = 50  # fewer drawing paths than this: not a vector drawing
SCANNED_IMAGE_COVERAGE = 0.5  # one image covering this much of the page = raster page
THUMBNAIL_LONG_EDGE_PX = 480


@dataclass
class PageScan:
    page_index: int
    width_pt: float
    height_pt: float
    rotation: int
    page_kind: str  # "vector" | "scanned" | "unknown"
    has_text_layer: bool
    has_vector_paths: bool
    text_char_count: int
    vector_path_count: int
    image_count: int
    image_coverage: float
    sheet_number: str | None
    sheet_number_source: str | None
    title: str | None
    kind: str
    kind_confidence: float
    kind_reason: str
    scales: list[dict[str, object]]
    scale_parsed: str | None
    scale_parsed_ratio: float | None
    review_reasons: list[str] = field(default_factory=list)
    text_quality: float | None = None
    evidence: dict[str, object] | None = None
    page_type_guess: str | None = None
    page_type_reason: str | None = None
    level_guess: str | None = None

    @property
    def needs_review(self) -> bool:
        return bool(self.review_reasons)


def _largest_image_coverage(page: pymupdf.Page) -> tuple[int, float]:
    infos = page.get_image_info()
    page_area = page.rect.width * page.rect.height
    best = 0.0
    for info in infos:
        box = displayed_box(pymupdf.Rect(info["bbox"]), page)
        w = max(0.0, min(box.x1, page.rect.x1) - max(box.x0, page.rect.x0))
        h = max(0.0, min(box.y1, page.rect.y1) - max(box.y0, page.rect.y0))
        best = max(best, (w * h) / page_area if page_area else 0.0)
    return len(infos), min(best, 1.0)


def analyze_page(page: pymupdf.Page) -> PageScan:
    rect = page.rect
    text = page.get_text("text")
    text_chars = len(re.sub(r"\s", "", text))
    path_count = len(page.get_cdrawings())
    image_count, coverage = _largest_image_coverage(page)

    has_text = text_chars >= MIN_TEXT_CHARS
    has_vector = path_count >= MIN_VECTOR_PATHS
    if coverage >= SCANNED_IMAGE_COVERAGE and not has_vector:
        page_kind = "scanned"
    elif has_vector or has_text:
        page_kind = "vector"
    else:
        page_kind = "unknown"

    scan = PageScan(
        page_index=page.number,
        width_pt=rect.width,
        height_pt=rect.height,
        rotation=page.rotation,
        page_kind=page_kind,
        has_text_layer=has_text,
        has_vector_paths=has_vector,
        text_char_count=text_chars,
        vector_path_count=path_count,
        image_count=image_count,
        image_coverage=coverage,
        sheet_number=None,
        sheet_number_source=None,
        title=None,
        kind="other",
        kind_confidence=0.0,
        kind_reason="",
        scales=[],
        scale_parsed=None,
        scale_parsed_ratio=None,
    )

    if page_kind == "scanned":
        # No OCR in v0, and a hidden OCR layer on a raster page is not trusted either.
        scan.kind_reason = "scanned page: unsupported in v0 (no OCR)"
        scan.review_reasons = ["scanned_unsupported_v0"]
        return scan
    if page_kind == "unknown":
        scan.kind_reason = "page has no usable text, vector drawing or page image"
        scan.review_reasons = ["no_usable_content"]
        return scan

    reasons: list[str] = []
    if not has_text:
        reasons.append("no_text_layer")

    # A text layer with broken encodings is not used: nothing is read from it, and the page says so.
    scan.text_quality = text_quality(text) if has_text else None
    usable = has_text and is_usable(scan.text_quality)
    if has_text and not usable:
        reasons.append("text_layer_garbled")
    words, lines = page_words_and_lines(page) if usable else ([], [])

    found = scan_text(words, lines, rect.width, rect.height)
    scan.sheet_number = found.sheet_number
    scan.sheet_number_source = found.sheet_number_source
    scan.title = found.title
    scan.kind = found.kind
    scan.kind_confidence = found.kind_confidence
    scan.kind_reason = found.kind_reason
    scan.scales = found.scales
    scan.scale_parsed = found.scale_parsed
    scan.scale_parsed_ratio = found.scale_parsed_ratio
    scan.evidence = found.evidence if usable else None
    reasons.extend(found.reasons)
    if usable:
        guess = guess_page_type(
            found.title,
            found.view_titles,
            len(find_profiles(re.sub(r"\s+", " ", text))),
            found.kind,
            text_chars,
            path_count,
        )
        scan.page_type_guess, scan.page_type_reason, scan.level_guess = (
            guess.page_type,
            guess.reason,
            guess.level,
        )

    scan.review_reasons = list(dict.fromkeys(reasons))
    return scan


def render_thumbnail_png(page: pymupdf.Page) -> bytes:
    """PNG thumbnail, long edge THUMBNAIL_LONG_EDGE_PX, with the page rotation applied."""
    zoom = THUMBNAIL_LONG_EDGE_PX / max(page.rect.width, page.rect.height)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return pixmap.tobytes("png")
