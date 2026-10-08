"""Private coverage run of the text-layer parsers: counts only, no strings.

    worker/.venv/bin/python -I worker/tools/text_coverage.py --ids job-002,job-004 \
        --item set-A=/path/a --item set-B=/path/b --map fixtures/private/inventory_map.csv \
        --out fixtures/private/coverage_phase4d.json

This measures COVERAGE, not correctness: how many profile-like, dimension-like and sheet or scale
tokens the parsers accept, and how many they leave unparsed (by generic pattern class). It does
not check any parsed value against the drawing, because there is no ground truth. No page is
rendered or viewed. Nothing printed or written contains file names or text content.
"""

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # the worker package root

import pymupdf  # noqa: E402

from src.pdf_scan.scale import find_scales_in_line, normalize  # noqa: E402
from src.pdf_scan.textlines import page_words_and_lines  # noqa: E402
from src.pdf_scan.textscan import scan_text  # noqa: E402
from src.text_layer.items import extract_page_text  # noqa: E402
from src.text_layer.parsers.dimension import find_dimensions  # noqa: E402
from src.text_layer.parsers.elevation import find_elevations  # noqa: E402
from src.text_layer.parsers.profile import find_profiles  # noqa: E402

LARGE_PT = 1000.0
_PRE = r"(?<![A-Za-z0-9])"
# Loose detectors: what LOOKS like a profile or a dimension, whether or not it parses.
PROFILE_LIKE = re.compile(
    rf"{_PRE}(?P<fam>HSS|WT|MT|ST|HP|MC|PIPE|PL|ROD|W|M|S|C|L)\s*"
    r"(?P<body>[\d.]+(?:[\d\s/.\-\"']*[xX×]\s*[\d.][\d\s/.\-\"']*)*)"
)
ROD_SUFFIX_LIKE = re.compile(rf"{_PRE}[\d./\- ]+\"?\s*(?:Ø|DIA\.?)?\s*(?:[A-Z]+\s+)?ROD\b")
DIMENSION_LIKE = re.compile(
    r"(?<![A-Za-z0-9.])\d[\d\s/.]*(?:['\u2032\u2019][\s\-]*\d[\d\s/.\-]*)?['\"\u2032\u2033\u2019\u201d]+"
)
# Families whose shape needs a separator to count as profile-like (PIPE and ROD need only a number)
NEED_X = {"HSS", "WT", "MT", "ST", "HP", "MC", "PL", "W", "M", "S", "C", "L"}


def _profile_class(fam: str, body: str) -> str:
    dims = len(re.findall(r"[xX×]", body)) + 1
    marks = ("frac" if "/" in body else "") + ("dec" if re.search(r"\.\d", body) else "")
    return f"{fam}:{dims}dims" + (f":{marks}" if marks else "")


def _overlaps(a: tuple[int, int], spans: list[tuple[int, int]]) -> bool:
    return any(a[0] < e and s < a[1] for s, e in spans)


def line_counts(text: str, acc: Counter, unparsed_profile: Counter, unparsed_dim: Counter) -> None:
    clean = normalize(text).replace("''", '"')
    profile_spans = [p.span for p in find_profiles(clean)]
    dim_spans = [d.span for d in find_dimensions(clean)]
    other_spans = [e.span for e in find_elevations(clean)]
    # scale matches cover their own numbers; find their spans by searching their raw text
    for s in find_scales_in_line(clean):
        i = clean.find(s.raw)
        if i >= 0:
            other_spans.append((i, i + len(s.raw)))
    for p in find_profiles(clean):
        acc[f"profiles_parsed_{p.family}"] += 1
    for m in PROFILE_LIKE.finditer(clean):
        fam, body = m.group("fam"), m.group("body")
        if fam in NEED_X and not re.search(r"[xX×]", body):
            continue  # a family letter and a number alone: too loose to call profile-like
        span = (m.start(), m.end())
        acc["profile_like"] += 1
        if _overlaps(span, profile_spans):
            acc["profile_like_parsed"] += 1
        else:
            unparsed_profile[_profile_class(fam, body)] += 1
    for m in ROD_SUFFIX_LIKE.finditer(clean):
        acc["profile_like"] += 1
        if _overlaps((m.start(), m.end()), profile_spans):
            acc["profile_like_parsed"] += 1
        else:
            unparsed_profile["ROD:suffix_form"] += 1
    for m in DIMENSION_LIKE.finditer(clean):
        span = (m.start(), m.end())
        if _overlaps(span, profile_spans):
            continue  # inside a profile (a plate length): counted there
        acc["dimension_like"] += 1
        if _overlaps(span, dim_spans) or _overlaps(span, other_spans):
            acc["dimension_like_parsed"] += 1
        else:
            token = m.group(0)
            ft, inch = bool(re.search(r"['′’]", token)), bool(re.search(r"[\"″”]", token))
            unparsed_dim[
                "feet_inches" if ft and inch else "feet_only" if ft else "inches_only"
            ] += 1


def cover(path: Path) -> dict:
    acc: Counter = Counter()
    up_profile: Counter = Counter()
    up_dim: Counter = Counter()
    with pymupdf.open(path) as doc:
        for page in doc:
            if max(page.rect.width, page.rect.height) < LARGE_PT:
                continue
            acc["pages_large"] += 1
            pt = extract_page_text(page)
            if not pt.usable:
                acc["pages_text_unusable"] += 1
                continue
            acc["pages_text_usable"] += 1
            for item in pt.items:
                if item.level == "line":
                    line_counts(item.text, acc, up_profile, up_dim)
            words, lines = page_words_and_lines(page)
            found = scan_text(words, lines, page.rect.width, page.rect.height)
            acc["pages_sheet_number_found"] += found.sheet_number is not None
            acc["pages_scale_found"] += bool(found.scales)
            acc["pages_scale_unique"] += len(found.scales) == 1
            acc["pages_title_found"] += found.title is not None
            acc["pages_conflict"] += "sheet_number_conflict" in found.reasons

    def share(a: str, b: str) -> float | None:
        return round(acc[a] / acc[b], 4) if acc[b] else None

    out = dict(sorted(acc.items()))
    out.update(
        profile_like_parse_share=share("profile_like_parsed", "profile_like"),
        dimension_like_parse_share=share("dimension_like_parsed", "dimension_like"),
        sheet_number_share=share("pages_sheet_number_found", "pages_text_usable"),
        scale_found_share=share("pages_scale_found", "pages_text_usable"),
        profile_unparsed_by_class=dict(sorted(up_profile.items())),
        dimension_unparsed_by_class=dict(sorted(up_dim.items())),
    )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--item", action="append", required=True)
    ap.add_argument("--map", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    roots = {s.split("=", 1)[0]: Path(s.split("=", 1)[1]) for s in args.item}
    rows = {r["id"]: r for r in csv.DictReader(args.map.open(newline="", encoding="utf-8"))}
    results = {}
    for anon in args.ids.split(","):
        r = rows[anon]
        results[anon] = cover(roots[r["item"]] / r["relative_path"])
        print(anon, "done", flush=True)
    args.out.write_text(json.dumps(results, indent=1))
    print(f"wrote {len(results)} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
