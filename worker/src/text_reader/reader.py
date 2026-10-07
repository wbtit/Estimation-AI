"""Read the text of a page: stroke clusters -> glyph matches -> upright lines -> decoded text."""

import hashlib
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from src.text_reader import rules
from src.text_reader.decode import decode_line
from src.text_reader.geometry import describe
from src.text_reader.library import PROPOSED, Entry, Matcher, new_entry
from src.text_reader.lines import Line, assemble
from src.text_reader.ocr import OcrEngine, fold, render_crop
from src.text_reader.strokes import Cluster, extract_clusters


@dataclass
class TextItem:
    x0: float
    y0: float
    x1: float
    y1: float
    orientation: str
    text: str | None
    ocr_text: str | None = None
    methods: list[str] = field(default_factory=lambda: ["glyph"])
    confidence: float | None = None
    agree: bool | None = None
    needs_review: bool = False
    review_reasons: list[str] = field(default_factory=list)
    char_count: int = 0
    unknown_count: int = 0

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x1, self.y1)


@dataclass
class PageRead:
    items: list[TextItem]
    hlines: list[Line]
    vlines: list[Line]
    entry_of: dict[int, Entry]  # id(cluster) -> library entry (any status)
    stats: Counter  # missing keys count as 0


def item_key(sheet_id: str, bbox: tuple[float, float, float, float]) -> str:
    """Stable key of a text item: the sheet and the bbox rounded to 0.5 pt."""
    q = ":".join(str(round(v * 2)) for v in bbox)
    return hashlib.sha256(f"{sheet_id}:{q}".encode()).hexdigest()


def resolve_clusters(
    clusters: list[Cluster],
    matcher: Matcher,
    font_id: str,
    usage: Counter,
    by_hash: dict[str, Entry],
    stats: Counter,
) -> dict[int, Entry]:
    """Match glyph-sized clusters to library entries; unmatched shapes become `proposed` groups."""
    out: dict[int, Entry] = {}
    shapes = set()
    for c in clusters:
        if c.w < rules.DOT_MAX_PT and c.h < rules.DOT_MAX_PT:
            continue  # dots are handled by a size rule, not by shape
        desc = describe(c.strokes)
        shapes.add(desc.key)
        idx = matcher.match(desc)
        if idx is None:
            entry = new_entry(font_id, c.strokes)
            existing = by_hash.get(entry.signature_hash)
            if existing is not None:
                entry = existing
            else:
                by_hash[entry.signature_hash] = entry
                matcher.add(entry)
                stats["new_groups"] += 1
        else:
            entry = matcher.entries[idx]
            by_hash.setdefault(entry.signature_hash, entry)
        usage[entry.signature_hash] += 1
        stats["matched_confirmed" if entry.decodes else "matched_unconfirmed"] += 1
        out[id(c)] = entry
    stats["unique_shapes"] += len(shapes)
    return out


def read_page(
    page: pymupdf.Page,
    matcher: Matcher,
    font_id: str,
    usage: Counter,
    by_hash: dict[str, Entry],
    ocr: OcrEngine | None = None,
) -> PageRead:
    stats: Counter = Counter()
    clusters = extract_clusters(page)
    stats["clusters"] = len(clusters)
    entry_of = resolve_clusters(clusters, matcher, font_id, usage, by_hash, stats)
    hlines, vlines, unassigned = assemble(clusters)
    stats["unassigned_clusters"] = unassigned
    stats["horizontal_lines"] = len(hlines)
    stats["vertical_lines"] = len(vlines)

    def lookup(c: Cluster) -> Entry | None:
        return entry_of.get(id(c))

    items: list[TextItem] = []
    for line in hlines:
        d = decode_line(line, lookup)
        item = TextItem(
            *line.bbox, "horizontal", d.text, char_count=d.char_count, unknown_count=d.unknown_count
        )
        if d.unknown_count:
            item.confidence = rules.CONF_GLYPH_UNKNOWN
            item.needs_review = True
            item.review_reasons.append(rules.REASON_UNKNOWN_GLYPH)
            stats["lines_with_unknown"] += 1
        else:
            item.confidence = rules.CONF_GLYPH_ONLY
        stats["characters"] += d.char_count
        stats["unknown_characters"] += d.unknown_count
        if ocr is not None:
            _crosscheck(item, page, ocr)
        items.append(item)
    for line in vlines:
        items.append(
            TextItem(
                *line.bbox,
                "vertical",
                None,
                methods=[],
                confidence=0.0,
                needs_review=True,
                review_reasons=[rules.REASON_VERTICAL_NOT_READ],
                char_count=len(line.members),
            )
        )
    items.sort(key=lambda i: (round(i.y0, 1), i.x0))
    return PageRead(items, hlines, vlines, entry_of, stats)


def _crosscheck(item: TextItem, page: pymupdf.Page, ocr: OcrEngine) -> None:
    """Add the OCR reading beside the glyph text. The glyph text is never replaced."""
    item.ocr_text = ocr.read(render_crop(page, item.bbox)).strip()
    item.methods.append("ocr")
    if item.unknown_count:
        return  # cannot compare a text with unknown shapes; stays 0.3 / needs_review
    item.agree = fold(item.ocr_text) == fold(item.text or "")
    if item.agree:
        item.confidence = rules.CONF_OCR_AGREES
    else:
        item.confidence = rules.CONF_OCR_DISAGREES
        item.needs_review = True
        item.review_reasons.append(rules.REASON_OCR_DISAGREES)


__all__ = ["PROPOSED", "PageRead", "TextItem", "item_key", "read_page"]
