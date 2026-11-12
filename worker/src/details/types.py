"""Plain data of the project-details reader (Phase 0 cover details). No database, no PDF."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.pdf_scan.textlines import Box, Line

BoxT = tuple[float, float, float, float]


def box_t(b: Box) -> BoxT:
    return (round(b.x0, 1), round(b.y0, 1), round(b.x1, 1), round(b.y1, 1))


def union(boxes: list[Box]) -> BoxT:
    return (
        round(min(b.x0 for b in boxes), 1),
        round(min(b.y0 for b in boxes), 1),
        round(max(b.x1 for b in boxes), 1),
        round(max(b.y1 for b in boxes), 1),
    )


@dataclass
class PageText:
    """One page as the reader sees it. `lines` come from the page's text layer (displayed boxes)."""

    page_index: int
    width: float
    height: float
    lines: list[Line]
    sheet_number: str | None = None
    name: str | None = None  # the page name as the card shows it (override, view title, title)
    role_behaviour: str | None = None  # framing | column_plan | none | None (no role)
    role_name: str | None = None
    sheet_id: str | None = None


@dataclass
class Cand:
    """One candidate value of a field with where it came from."""

    field: str
    value: str
    page_index: int
    box: BoxT
    rule: str
    confidence: str  # high | medium | low
    flags: list[str] = field(default_factory=list)

    def json(self) -> dict:
        return {
            "value": self.value,
            "page_index": self.page_index,
            "box": list(self.box),
            "rule": self.rule,
            "confidence": self.confidence,
        }


@dataclass
class Detail:
    """The chosen value of a field, its alternatives and why it was chosen."""

    field: str
    value: str
    page_index: int
    box: BoxT
    rule: str
    confidence: str
    flags: list[str] = field(default_factory=list)
    alternatives: list[dict] = field(default_factory=list)
    agreement: dict | None = None


@dataclass
class IndexRow:
    number: str
    title: str
    page_index: int
    box: BoxT
    rule: str  # same_line | two_cell
    match: str = "none"  # exact | equivalent | none
    matched_page: int | None = None
    matched_sheet_id: str | None = None


@dataclass
class IndexFlag:
    kind: str
    detail: dict
    page_index: int | None = None  # our page the flag is about (jump target)
    sheet_id: str | None = None
    index_page: int | None = None
    number: str | None = None
    title: str | None = None


@dataclass
class DetailsResult:
    fields: dict[str, Detail] = field(default_factory=dict)
    cover_pages: list[int] = field(default_factory=list)
    no_text_pages: list[int] = field(default_factory=list)
    index_rows: list[IndexRow] = field(default_factory=list)
    index_flags: list[IndexFlag] = field(default_factory=list)
    repeated: list[dict] = field(default_factory=list)
