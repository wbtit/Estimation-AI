"""Private accuracy harness for the text reader.

Compares decoded text with a ground-truth CSV the owner fills in
(fixtures/private/ground_truth_text.csv). Without that file it only writes a template of random
upright lines for the owner to fill; it never fills truth itself. Thresholds are never chosen on
this set; the library is built from groups the owner confirms, and `vote` excludes these lines.
"""

import csv
import json
import random
from collections import Counter
from pathlib import Path
from typing import Any

import pymupdf

from src.text_reader.library import Entry, Matcher
from src.text_reader.lines import assemble
from src.text_reader.ocr import OcrEngine, _iou
from src.text_reader.reader import read_page
from src.text_reader.strokes import extract_clusters
from src.text_reader.structure import CATEGORIES as STRUCTURE_CATEGORIES
from src.text_reader.structure import categorize_lines, page_geometry
from src.text_reader.targets import CATEGORIES, categorize

TRUTH_FIELDS = [
    "line_id", "page", "x0", "y0", "x1", "y1", "crop_file", "category", "draft_text", "review",
    "correction", "truth_text", "truth_source", "notes",
]  # fmt: skip
SAMPLE_CATEGORIES = ("random", *STRUCTURE_CATEGORIES)
DEFAULT_TRUTH = Path("fixtures/private/ground_truth_text.csv")
MIN_IOU = 0.5
TARGETED_PER_CATEGORY = 5
RANDOM_LINES = 30


def sample_lines(
    pdf_path: Path,
    n_random: int = RANDOM_LINES,
    per_category: int = TARGETED_PER_CATEGORY,
    seed: int = 0,
    min_chars: int = 3,
) -> tuple[list[tuple[int, tuple, str]], dict[str, int]]:
    """A stratified, reproducible sample of upright lines: (page 1-based, bbox, category).

    Targeted lines are chosen by page STRUCTURE only (structure.py), never by what they say.
    A category with too few lines is topped up with random lines; the shortfall is returned.
    """
    pool: list[tuple[int, tuple, str | None]] = []
    with pymupdf.open(pdf_path) as doc:
        for i, page in enumerate(doc):
            hlines, _, _ = assemble(extract_clusters(page))
            cats = categorize_lines(hlines, page_geometry(page), page.rect.width, page.rect.height)
            pool += [
                (i + 1, tuple(round(v, 2) for v in ln.bbox), cat)
                for ln, cat in zip(hlines, cats, strict=True)
                if len(ln.members) >= (2 if cat else min_chars)
            ]
    pool.sort(key=lambda t: (t[0], t[1]))
    rng = random.Random(seed)
    chosen: list[tuple[int, tuple, str]] = []
    taken: set[tuple[int, tuple]] = set()
    shortfall: dict[str, int] = {}
    for cat in STRUCTURE_CATEGORIES:
        cands = [t for t in pool if t[2] == cat]
        rng.shuffle(cands)
        got = cands[:per_category]
        for page_no, bbox, _ in got:
            chosen.append((page_no, bbox, cat))
            taken.add((page_no, bbox))
        if len(got) < per_category:
            shortfall[cat] = per_category - len(got)
    rest = [t for t in pool if (t[0], t[1]) not in taken and t[2] is None]
    rng.shuffle(rest)
    n_fill = n_random + sum(shortfall.values())
    chosen += [(p, b, "random") for p, b, _ in rest[:n_fill]]
    chosen.sort(key=lambda t: (t[0], t[1]))
    return chosen, shortfall


def _truth_filled(path: Path) -> int:
    """Rows with any truth, draft or correction; a file that is not a template counts as all."""
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if "truth_text" not in [(f or "").strip() for f in reader.fieldnames or []]:
            return 10**9
        rows = [{(k or "").strip(): (v or "") for k, v in r.items()} for r in reader]
    return sum(
        1
        for r in rows
        if any(r.get(k, "").strip() for k in ("truth_text", "draft_text", "correction"))
    )


def write_template(
    pdf_path: Path,
    path: Path = DEFAULT_TRUTH,
    seed: int = 0,
    regenerate: bool = False,
) -> dict[str, Any]:
    """Write the template (truth_text blank) and crops; returns counts per category.

    An existing file is replaced only with regenerate=True and only if no truth_text is filled.
    """
    if path.exists():
        if not regenerate:
            raise FileExistsError(f"{path} already exists; refusing to overwrite your ground truth")
        if _truth_filled(path):
            raise FileExistsError(f"{path} has filled truth_text rows; refusing to overwrite")
    crops = path.parent / "ground_truth_crops"
    crops.mkdir(parents=True, exist_ok=True)
    for old in crops.glob("line_*.png"):
        old.unlink()
    lines, shortfall = sample_lines(pdf_path, seed=seed)
    counts: Counter = Counter()
    with pymupdf.open(pdf_path) as doc, path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=TRUTH_FIELDS)
        w.writeheader()
        for k, (page_no, bbox, cat) in enumerate(lines, 1):
            counts[cat] += 1
            name = f"line_{k:03d}_p{page_no}.png"
            clip = pymupdf.Rect(bbox[0] - 1, bbox[1] - 1, bbox[2] + 1, bbox[3] + 1)
            doc[page_no - 1].get_pixmap(dpi=400, clip=clip, alpha=False).save(str(crops / name))
            w.writerow(
                {
                    "line_id": f"L{k:03d}", "page": page_no, "x0": bbox[0], "y0": bbox[1],
                    "x1": bbox[2], "y1": bbox[3], "crop_file": f"ground_truth_crops/{name}",
                    "category": cat, "truth_text": "", "notes": "",
                }
            )  # fmt: skip
    return {"total": len(lines), "per_category": dict(counts), "shortfall": shortfall}


def _read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        raw = list(csv.DictReader(fh))
    return [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in raw]


def _write_rows(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=TRUTH_FIELDS, extrasaction="ignore", restval="")
        w.writeheader()
        w.writerows(rows)


def set_drafts(path: Path, drafts: dict[str, str], notes: dict[str, str] | None = None) -> int:
    """Write an AI draft reading into draft_text (and optional notes). Never touches truth_text.

    Refuses to replace a draft on a row that already has truth_text or a review mark.
    """
    rows = _read_rows(path)
    n = 0
    for r in rows:
        if r["line_id"] not in drafts:
            continue
        if r.get("truth_text") or r.get("review") or r.get("correction"):
            raise ValueError(f"{r['line_id']} already has truth or a review; not overwriting")
        r["draft_text"] = drafts[r["line_id"]]
        if notes and r["line_id"] in notes:
            r["notes"] = notes[r["line_id"]]
        n += 1
    _write_rows(path, rows)
    return n


SOURCE_ACCEPTED = "ai_draft_accepted"
SOURCE_CORRECTED = "ai_draft_corrected"


def truth_accept(path: Path) -> dict[str, int]:
    """Turn the owner's review into truth_text.

    review == 'ok'  -> draft_text is copied into truth_text (accepted as is)
    correction text -> the correction becomes truth_text (it wins over 'ok')
    neither         -> the row is left as it is and stays out of scoring when truth_text is empty
    A truth_text that is already filled is only replaced by a typed correction.
    """
    rows = _read_rows(path)
    counts = {"accepted": 0, "corrected": 0, "left_empty": 0, "already_filled": 0}
    for r in rows:
        correction = r.get("correction", "")
        ok = r.get("review", "").lower() == "ok"
        if correction:
            r["truth_text"], r["truth_source"] = correction, SOURCE_CORRECTED
            counts["corrected"] += 1
        elif ok and r.get("draft_text"):
            if r.get("truth_text"):
                counts["already_filled"] += 1
                continue
            r["truth_text"], r["truth_source"] = r["draft_text"], SOURCE_ACCEPTED
            counts["accepted"] += 1
        elif not r.get("truth_text"):
            counts["left_empty"] += 1
    backup = path.with_suffix(path.suffix + ".bak")
    backup.write_bytes(path.read_bytes())
    _write_rows(path, rows)
    return counts


def read_truth(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as fh:
        raw = list(csv.DictReader(fh))
    rows = [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in raw]
    for r in rows:
        r.setdefault("category", "")
        r["page"] = int(r["page"])
        r["bbox"] = tuple(float(r[k]) for k in ("x0", "y0", "x1", "y1"))
    return rows


def exclusions(path: Path | None) -> dict[int, list[tuple]]:
    """Ground-truth line rectangles per page (1-based), to keep them out of OCR voting."""
    if path is None or not path.exists():
        return {}
    out: dict[int, list[tuple]] = {}
    for r in read_truth(path):
        out.setdefault(r["page"], []).append(r["bbox"])
    return out


def _norm(text: str) -> str:
    return " ".join(text.split())


def evaluate(
    pdf_path: Path,
    truth_path: Path,
    entries: list[Entry],
    font_id: str,
    ocr: OcrEngine | None = None,
) -> dict[str, Any]:
    rows = read_truth(truth_path)
    labeled = [r for r in rows if _norm(r["truth_text"])]
    matcher = Matcher(entries)
    by_hash = {e.signature_hash: e for e in matcher.entries}
    items_by_page: dict[int, list] = {}
    with pymupdf.open(pdf_path) as doc:
        for page_no in sorted({r["page"] for r in labeled}):
            read = read_page(doc[page_no - 1], matcher, font_id, Counter(), by_hash, ocr)
            items_by_page[page_no] = [i for i in read.items if i.orientation == "horizontal"]

    stats: Counter = Counter()
    cat_total: Counter = Counter()
    cat_exact: Counter = Counter()
    sam_total: Counter = Counter()
    sam_exact: Counter = Counter()
    sam_matched: Counter = Counter()
    sam_unknown: Counter = Counter()
    sam_chars: Counter = Counter()
    chars = unknown = 0
    for r in labeled:
        truth = _norm(r["truth_text"])
        cat = categorize(truth)
        cat_total[cat] += 1
        scat = r.get("category") or "uncategorised"
        sam_total[scat] += 1
        best, best_iou = None, 0.0
        for it in items_by_page.get(r["page"], []):
            v = _iou(r["bbox"], it.bbox)
            if v > best_iou:
                best, best_iou = it, v
        if best is None or best_iou < MIN_IOU:
            stats["not_found"] += 1
            continue
        stats["matched"] += 1
        sam_matched[scat] += 1
        decoded = _norm(best.text or "")
        chars += len(decoded.replace(" ", ""))
        unknown += best.unknown_count
        sam_unknown[scat] += best.unknown_count
        sam_chars[scat] += len(decoded.replace(" ", ""))
        stats["lines_with_unknown"] += best.unknown_count > 0
        if decoded == truth:
            stats["exact"] += 1
            cat_exact[cat] += 1
            sam_exact[scat] += 1
        if best.agree is not None:
            stats["ocr_compared"] += 1
            stats["ocr_agrees"] += bool(best.agree)
        if best.ocr_text is not None:
            stats["ocr_read"] += 1
            stats["ocr_exact_vs_truth"] += _norm(best.ocr_text) == truth
    n = len(labeled)
    m = stats["matched"]
    sources = Counter(r.get("truth_source", "") for r in labeled)
    ai_rows = sources[SOURCE_ACCEPTED] + sources[SOURCE_CORRECTED]

    def rate(a: int, b: int) -> float | None:
        return round(a / b, 4) if b else None

    return {
        "draft_source": "AI, verified by human" if ai_rows else "human",
        "rows_accepted_as_is": sources[SOURCE_ACCEPTED],
        "rows_corrected": sources[SOURCE_CORRECTED],
        "rows_typed_by_owner": n - ai_rows,
        "rows_in_file": len(rows),
        "rows_labeled": n,
        "rows_blank": len(rows) - n,
        "matched_to_a_decoded_line": m,
        "not_found": stats["not_found"],
        "exact_match_rate_of_labeled": rate(stats["exact"], n),
        "exact_match_rate_of_matched": rate(stats["exact"], m),
        "unknown_char_rate": rate(unknown, chars),
        "lines_with_unknown_rate": rate(stats["lines_with_unknown"], m),
        "ocr_agreement_rate": rate(stats["ocr_agrees"], stats["ocr_compared"]),
        "ocr_lines_compared": stats["ocr_compared"],
        "ocr_exact_vs_truth_rate": rate(stats["ocr_exact_vs_truth"], stats["ocr_read"]),
        "per_sample_category": {
            c: {
                "labeled": sam_total[c],
                "matched": sam_matched[c],
                "exact": sam_exact[c],
                "exact_rate": rate(sam_exact[c], sam_total[c]),
                "unknown_char_rate": rate(sam_unknown[c], sam_chars[c]),
            }
            for c in (*SAMPLE_CATEGORIES, "uncategorised")
            if sam_total[c]
        },
        "per_category": {
            c: {"labeled": cat_total[c], "exact": cat_exact[c]} for c in CATEGORIES if cat_total[c]
        },
    }


def save_report(report: dict[str, Any], path: Path) -> None:
    path.write_text(json.dumps(report, indent=1))
