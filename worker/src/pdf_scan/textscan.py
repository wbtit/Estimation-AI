"""What the text layer says about a page: sheet number, title, scales, classification, evidence.

Pure over already-extracted words and lines. Every value comes with where it was found, the rule
that found it and a confidence (rule-based constants, not measured probabilities). Conflicting or
uncertain values are reported as review reasons and listed under `conflicts`; nothing is guessed.
"""

from dataclasses import dataclass, field
from typing import Any

from src.pdf_scan.classify import classify, view_titles
from src.pdf_scan.scale import distinct_scales, find_scales_in_line
from src.pdf_scan.sheet_id import TITLE_BLOCK_NUMBER_RE, find_sheet_id
from src.pdf_scan.textlines import Line, Word

CONF_NUMBER_LABEL = 0.9
CONF_NUMBER_REGION = 0.7
CONF_NUMBER_CONFLICT = 0.4
CONF_TITLE = 0.8
CONF_SCALE_SINGLE = 0.85
CONF_SCALE_MULTIPLE = 0.5


@dataclass
class TextScan:
    sheet_number: str | None = None
    sheet_number_source: str | None = None
    # Phase 9: the earlier reading kept when the title-block reading replaced it with another value,
    # and how the shown number was found ('title_block', or 'fallback_old' when the earlier reading
    # is shown because no title-block number was found)
    sheet_number_old: str | None = None
    sheet_number_old_source: str | None = None
    sheet_number_flag: str | None = None
    title: str | None = None
    kind: str = "other"
    kind_confidence: float = 0.0
    kind_reason: str = ""
    scales: list[dict[str, object]] = field(default_factory=list)
    scale_parsed: str | None = None
    scale_parsed_ratio: float | None = None
    reasons: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    view_titles: list[str] = field(default_factory=list)  # for the page type guess; never stored


def _bbox(box: Any) -> dict[str, float]:
    return {
        "x0": round(box.x0, 2),
        "y0": round(box.y0, 2),
        "x1": round(box.x1, 2),
        "y1": round(box.y1, 2),
    }


def _locate_number(words: list[Word], number: str) -> Word | None:
    """The largest word whose cleaned text is the sheet number (where it was read from)."""
    best: Word | None = None
    for w in words:
        token = w.text.strip().strip(".,;:()[]").upper()
        if token == number and TITLE_BLOCK_NUMBER_RE.match(token):
            if best is None or w.box.height > best.box.height:
                best = w
    return best


def scan_text(words: list[Word], lines: list[Line], page_w: float, page_h: float) -> TextScan:
    out = TextScan()
    # the title-block reading is preferred; the earlier reading is the fallback (and is kept when
    # it differs), with a flag
    sheet = find_sheet_id(words, lines, page_w, page_h, title_block=True)
    earlier = find_sheet_id(words, lines, page_w, page_h)
    if sheet.number is None and earlier.number is not None:
        out.sheet_number_flag = "fallback_old"
        out.sheet_number, out.sheet_number_source = earlier.number, earlier.number_source
        sheet = earlier  # the earlier reading is shown, so its flags and alternatives apply
    else:
        out.sheet_number, out.sheet_number_source = sheet.number, sheet.number_source
        if sheet.number is not None:
            out.sheet_number_flag = "title_block"
            if earlier.number is not None and earlier.number != sheet.number:
                out.sheet_number_old = earlier.number
                out.sheet_number_old_source = earlier.number_source
    out.title = sheet.title
    reasons = list(sheet.flags)
    conflicts: list[dict[str, Any]] = []
    evidence: dict[str, Any] = {"method": "pdf_text", "conflicts": conflicts}

    if out.sheet_number:
        located = _locate_number(words, out.sheet_number)
        conflict = "sheet_number_conflict" in sheet.flags
        confidence = (
            CONF_NUMBER_CONFLICT
            if conflict
            else CONF_NUMBER_LABEL
            if sheet.number_source == "label"
            else CONF_NUMBER_REGION
        )
        evidence["sheet_number"] = {
            "value": out.sheet_number,
            "rule": out.sheet_number_source,
            "confidence": confidence,
            "bbox": _bbox(located.box) if located else None,
            "reading": out.sheet_number_flag,
            "earlier_value": out.sheet_number_old,
        }
        if conflict:
            conflicts.append(
                {"field": "sheet_number", "values": [out.sheet_number, *sheet.alternatives]}
            )
    else:
        evidence["sheet_number"] = None
    evidence["title"] = (
        {"value": sheet.title, "rule": "title_label", "confidence": CONF_TITLE}
        if sheet.title
        else None
    )

    titles = view_titles(lines)
    out.view_titles = titles
    result = classify(sheet.title, titles)
    out.kind, out.kind_confidence, out.kind_reason = result.kind, result.confidence, result.reason
    reasons.extend(result.flags)
    evidence["classification"] = {
        "kind": result.kind,
        "confidence": result.confidence,
        "reason": result.reason,
    }

    out.scales = distinct_scales([ln.text for ln in lines])
    boxes: dict[tuple[str, float | None], Any] = {}
    for ln in lines:
        for s in find_scales_in_line(ln.text):
            boxes.setdefault((s.kind, s.ratio), ln.box)
    single = len(out.scales) == 1
    evidence["scales"] = [
        {
            "raw": s["raw"],
            "kind": s["kind"],
            "ratio": s["ratio"],
            "count": s["count"],
            "confidence": CONF_SCALE_SINGLE if single else CONF_SCALE_MULTIPLE,
            "bbox": _bbox(boxes[(str(s["kind"]), s["ratio"])]),  # type: ignore[arg-type]
        }
        for s in out.scales
    ]
    if single:
        out.scale_parsed = str(out.scales[0]["raw"])
        ratio = out.scales[0]["ratio"]
        out.scale_parsed_ratio = float(ratio) if isinstance(ratio, (int, float)) else None
    elif not out.scales:
        reasons.append("scale_not_found")
    else:
        reasons.append("multiple_scales")
        conflicts.append({"field": "scale", "values": [str(s["raw"]) for s in out.scales]})

    out.reasons = list(dict.fromkeys(reasons))
    out.evidence = evidence
    return out
