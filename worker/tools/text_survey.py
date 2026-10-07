"""Read-only survey of text-layer drawing PDFs: generic pattern COUNTS from text and path data.

    worker/.venv/bin/python -I worker/tools/text_survey.py --ids job-002,job-004 \
        --item set-A=/path/a --item set-B=/path/b --map fixtures/private/inventory_map.csv \
        --out fixtures/private/survey_phase4c.json

No page is rendered or viewed, nothing is OCR'd, no model is called. Text is matched against generic
regular expressions and only counts are kept. Prints anonymous ids and numbers only; no names,
titles or text. Text coordinates are mapped through the page rotation matrix like the paths.
"""

import argparse
import csv
import json
import math
import re
import statistics
import sys
import unicodedata
from collections import Counter
from pathlib import Path

import numpy as np
import pymupdf

LARGE_PT = 1000.0
MAX_PAGES = 20
TITLE_X, TITLE_Y = 0.84, 0.88  # title-block-like region: right 16% or bottom 12% of the page

X = r"\s?[Xx]\s?"
PROFILE = {
    "W": rf"\bW\s?\d{{1,2}}{X}\d{{1,3}}(?:\.\d+)?\b",
    "HSS": rf"\bHSS\s?\d+(?:\.\d+)?{X}\d+(?:\.\d+)?(?:{X}\d+(?:/\d+|\.\d+)?)?",
    "L": rf"\bL\s?\d+(?:\.\d+)?{X}\d+(?:\.\d+)?(?:{X}\d+(?:/\d+|\.\d+)?)?",
    "C": rf"\bC\s?\d{{1,2}}{X}\d+(?:\.\d+)?\b",
    "MC": rf"\bMC\s?\d{{1,2}}{X}\d+(?:\.\d+)?\b",
    "WT": rf"\bWT\s?\d+(?:\.\d+)?{X}\d+(?:\.\d+)?\b",
    "S": rf"\bS\s?\d{{1,2}}{X}\d+(?:\.\d+)?\b",
    "HP": rf"\bHP\s?\d{{1,2}}{X}\d+\b",
    "PL": rf"\bPL\s?(?:\d+/\d+|\d+(?:\.\d+)?)(?:{X}\d+)?",
    "PIPE": r"\bPIPE\b",
    "ROD": r"\b(?:THREADED\s+ROD|ALL\s?THREAD|ROD)\b",
}
PROFILE_RE = {k: re.compile(v) for k, v in PROFILE.items()}
DIM_RE = re.compile(r"\b\d+'\s?-\s?\d{1,2}(?:\s\d{1,2}/\d{1,2})?\"?")
SCALE_RE = re.compile(r"\d+(?:/\d+)?\s?\"\s?=\s?\d+\s?'")
NTS_RE = re.compile(r"\bN\.?T\.?S\.?\b")
MARK_RE = re.compile(r"^[A-Z]{1,2}\d{1,3}$")
SHEET_RE = re.compile(r"^[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?[A-Z]?$")
SHEET_DOT_RE = re.compile(r"^[A-Z]{1,3}\d{1,2}\.\d{1,2}$")
GRID_TOKEN_RE = re.compile(r"^(?:[A-Z]|\d{1,2})$")
CALLOUT_SHEET_RE = re.compile(r"^[A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?$")
HEADER_WORDS = ("MARK", "SIZE", "QTY", "LENGTH", "WEIGHT", "ELEV", "PROFILE")

CIRCLE_R_MIN, CIRCLE_R_MAX = 5.0, 30.0
CIRCLE_RMS, CIRCLE_ARC = 0.03, 300.0
LONG_LINE_PT, THIN_MAX_PT = 150.0, 1.0
DASH_MIN, DASH_MAX, DASH_RUN_MIN = 1.0, 12.0, 4
WIDTH_BUCKETS = [(0.1, "<0.1"), (0.25, "0.1-0.25"), (0.5, "0.25-0.5"), (1.0, "0.5-1"),
                 (1.5, "1-1.5"), (2.5, "1.5-2.5"), (1e9, ">2.5")]  # fmt: skip


# --- helpers -----------------------------------------------------------------------------------
def printable(ch: str) -> bool:
    return ch.isprintable() and unicodedata.category(ch) != "Co" and ch != "�"


def width_bucket(w: float) -> str:
    for hi, name in WIDTH_BUCKETS:
        if w < hi:
            return name
    return ">2.5"


def colour_class(c) -> str:
    if c is None:
        return "none"
    r, g, b = (list(c) + [0, 0, 0])[:3] if len(c) == 3 else (c[0], c[0], c[0])
    if max(r, g, b) < 0.15:
        return "black"
    if max(r, g, b) - min(r, g, b) < 0.1:
        return "grey"
    if r > 0.6 and g < 0.4 and b < 0.4:
        return "red"
    if g > 0.6 and r < 0.4 and b < 0.4:
        return "green"
    if b > 0.6 and r < 0.4 and g < 0.4:
        return "blue"
    return "other"


def bezier(p0, p1, p2, p3, n=6):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t**2, t**3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))  # fmt: skip
    return out


def path_points(items) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for it in items:
        k = it[0]
        if k == "l":
            pts += [tuple(it[1]), tuple(it[2])]
        elif k == "c":
            pts += bezier(it[1], it[2], it[3], it[4])
        elif k == "re":
            r = pymupdf.Rect(it[1])
            pts += [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)]
    return pts


def fit_circle(pts: np.ndarray):
    x, y = pts[:, 0], pts[:, 1]
    a = np.c_[2 * x, 2 * y, np.ones(len(x))]
    (cx, cy, c), *_ = np.linalg.lstsq(a, x**2 + y**2, rcond=None)
    r = math.sqrt(max(c + cx**2 + cy**2, 0.0))
    if r == 0:
        return cx, cy, 0.0, 9.0, 0.0
    res = np.hypot(x - cx, y - cy) - r
    ang = np.sort(np.arctan2(y - cy, x - cx))
    gaps = np.diff(np.r_[ang, ang[0] + 2 * math.pi])
    return cx, cy, r, float(np.sqrt((res**2).mean()) / r), 360 - math.degrees(float(gaps.max()))


def is_circle(pts: np.ndarray):
    if len(pts) < 8:
        return None
    cx, cy, r, rms, arc = fit_circle(pts)
    if CIRCLE_R_MIN <= r <= CIRCLE_R_MAX and rms < CIRCLE_RMS and arc >= CIRCLE_ARC:
        return cx, cy, r
    return None


def segment_circles(
    segs: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float]]:
    """Circles made of many separate short single-line paths joined end to end."""
    n = len(segs)
    if n < 8:
        return []
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    grid: dict[tuple[int, int], list[int]] = {}
    for i, s in enumerate(segs):
        for x, y in ((s[0], s[1]), (s[2], s[3])):
            grid.setdefault((int(x // 2), int(y // 2)), []).append(i)
    for ids in grid.values():
        for a in ids[1:]:
            parent[find(a)] = find(ids[0])
    comps: dict[int, list[int]] = {}
    for i in range(n):
        comps.setdefault(find(i), []).append(i)
    out = []
    for ids in comps.values():
        if 8 <= len(ids) <= 200:
            pts = np.array([(segs[i][k], segs[i][k + 1]) for i in ids for k in (0, 2)])
            c = is_circle(pts)
            if c:
                out.append(c)
    return out


def dash_chains(segs: list[tuple[float, float, float, float]]):
    """Chains (>= DASH_RUN_MIN) of equal short collinear segments at a regular gap."""
    if len(segs) < DASH_RUN_MIN:
        return None
    arr = np.array(segs)
    flip = (arr[:, 2] < arr[:, 0]) | ((arr[:, 2] == arr[:, 0]) & (arr[:, 3] < arr[:, 1]))
    arr[flip] = arr[flip][:, [2, 3, 0, 1]]
    length = np.hypot(arr[:, 2] - arr[:, 0], arr[:, 3] - arr[:, 1])
    ang = np.arctan2(arr[:, 3] - arr[:, 1], arr[:, 2] - arr[:, 0])
    cell = 30.0
    grid: dict[tuple[int, int], list[int]] = {}
    for i, (x, y) in enumerate(arr[:, :2]):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(i)
    nxt: dict[int, int] = {}
    taken: set[int] = set()
    for i in range(len(arr)):
        ex, ey = arr[i, 2], arr[i, 3]
        gx, gy = int(ex // cell), int(ey // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j == i or j in taken or i in nxt:
                        continue
                    vx, vy = arr[j, 0] - ex, arr[j, 1] - ey
                    if vx * math.cos(ang[i]) + vy * math.sin(ang[i]) <= 0:
                        continue  # only forward: a chain never links backwards
                    gap = math.hypot(vx, vy)
                    if not 0.2 * length[i] <= gap <= 2.5 * length[i]:
                        continue
                    if abs(length[j] - length[i]) > 0.15 * length[i] + 0.2:
                        continue
                    if abs(math.atan2(math.sin(ang[j] - ang[i]), math.cos(ang[j] - ang[i]))) > 0.03:
                        continue
                    if abs(-vx * math.sin(ang[i]) + vy * math.cos(ang[i])) > 0.4:
                        continue
                    nxt[i] = j
                    taken.add(j)
    prev = {j: i for i, j in nxt.items()}
    chains = []
    for start in (i for i in range(len(arr)) if i not in prev):
        chain, cur = [start], start
        while cur in nxt:
            cur = nxt[cur]
            chain.append(cur)
        if len(chain) >= DASH_RUN_MIN:
            chains.append(chain)
    return chains, arr, length


# --- per page ----------------------------------------------------------------------------------
def page_text(page: pymupdf.Page, acc: Counter) -> list:
    """Text quality and pattern counts. Returns the words with displayed centres."""
    m = page.rotation_matrix
    w_, h_ = page.rect.width, page.rect.height
    lines = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for ln in b["lines"]:
            text = "".join(sp["text"] for sp in ln["spans"])
            if not text.strip():
                continue
            acc["chars"] += len(text)
            acc["chars_printable"] += sum(1 for ch in text if printable(ch))
            dx, dy = ln["dir"]
            rotated = abs(dx * m.b + dy * m.d) > 0.2
            acc["lines"] += 1
            acc["lines_rotated"] += rotated
            r = pymupdf.Rect(ln["bbox"]) * m
            cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
            title = cx >= TITLE_X * w_ or cy >= TITLE_Y * h_
            lines.append((text.strip(), cx, cy, title))
    words = []
    for w in page.get_text("words"):
        r = pymupdf.Rect(w[:4]) * m
        words.append(((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.x0, r.height, w[4]))
    acc["words"] += len(words)
    for text, _, _, title in lines:
        region = "title" if title else "plan"
        up = text.upper()
        for k, rx in PROFILE_RE.items():
            n = len(rx.findall(up))
            if n:
                acc[f"profile_{k}"] += n
                acc[f"member_{region}"] += n
        acc["dimension_strings"] += len(DIM_RE.findall(text))
        acc["scale_ratio_strings"] += len(SCALE_RE.findall(text))
        acc["nts_strings"] += len(NTS_RE.findall(up))
        for tok in up.split():
            tok = tok.strip(",;:()")
            if MARK_RE.match(tok):
                acc["mark_like_tokens"] += 1
            if SHEET_RE.match(tok) and (
                "." in tok or "-" in tok or sum(c.isdigit() for c in tok) >= 3
            ):
                acc["sheet_like_tokens"] += 1
                if SHEET_DOT_RE.match(tok):
                    acc["sheet_dot_form_tokens"] += 1
    plan_words = sum(1 for w in words if not (w[0] >= TITLE_X * w_ or w[1] >= TITLE_Y * h_))
    title_words = len(words) - plan_words
    acc["pages_text_only_in_title_region"] += plan_words < 5 and title_words > 0
    return words


def detect_tables(words: list, acc: Counter) -> None:
    """Rows and columns of aligned text cells; header keywords counted from the first rows."""
    if len(words) < 12:
        return
    heights = [w[3] for w in words if w[3] > 0]
    if not heights:
        return
    h = statistics.median(heights)
    ws = sorted(words, key=lambda w: (w[1], w[2]))
    rows: list[list] = []
    for w in ws:
        if rows and abs(rows[-1][0][1] - w[1]) <= 0.5 * h:
            rows[-1].append(w)
        else:
            rows.append([w])
    row_cells = []
    for row in rows:
        row.sort(key=lambda w: w[2])
        cells, last_x1 = [], None
        for w in row:
            x1 = w[2] + len(w[4]) * h * 0.55
            if last_x1 is None or w[2] - last_x1 > 0.6 * h:
                cells.append([w[2], [w[4]]])
            else:
                cells[-1][1].append(w[4])
            last_x1 = x1
        row_cells.append((row[0][1], cells))
    run: list = []

    def close(run: list) -> None:
        if len(run) < 4:
            return
        bins = Counter()
        for _, cells in run:
            for x in {round(c[0] / 3) for c in cells}:
                bins[x] += 1
        cols = [x for x, n in bins.items() if n >= 0.6 * len(run)]
        if len(cols) < 3:
            return
        acc["tables_detected"] += 1
        above = [rc for rc in row_cells if 0 < run[0][0] - rc[0] <= 2.4 * h][-1:]
        head = " ".join(
            " ".join(" ".join(c[1]) for c in cells) for _, cells in above + run[:3]
        ).upper()
        found = sum(1 for k in HEADER_WORDS if re.search(rf"\b{k}", head))
        acc["tables_with_any_header_keyword"] += found >= 1
        acc["tables_with_header_keywords"] += found >= 2

    prev_y = None
    for y, cells in row_cells:
        if len(cells) >= 3 and (prev_y is None or y - prev_y <= 2.4 * h or not run):
            if run and y - run[-1][0] > 2.4 * h:
                close(run)
                run = []
            run.append((y, cells))
        else:
            close(run)
            run = []
        prev_y = y
    close(run)
    for w in words:
        t = w[4].upper().strip(":")
        if t in HEADER_WORDS or t in ("ELEVATION", "QUANTITY"):
            acc[f"header_word_{t}"] += 1


def page_geometry(page: pymupdf.Page, words: list, acc: Counter, widths: Counter,
                  colours: Counter, layers: set) -> None:  # fmt: skip
    m = page.rotation_matrix
    circles: list[tuple[float, float, float]] = []
    short: list[tuple[float, float, float, float]] = []
    long_lines: list[tuple[float, float, float, float]] = []
    for d in page.get_cdrawings():
        if d.get("type") not in ("s", "fs"):
            continue
        w = d.get("width") or 0.0
        widths[width_bucket(w)] += 1
        colours[colour_class(d.get("color"))] += 1
        if d.get("layer"):
            layers.add(d["layer"])
            acc["paths_with_layer"] += 1
        if not (d.get("dashes") or "[] 0").startswith("[]"):
            acc["real_dash_paths"] += 1
        items = d["items"]
        for it in items:
            if it[0] == "l":
                p, q = pymupdf.Point(it[1]) * m, pymupdf.Point(it[2]) * m
                ln = math.dist(p, q)
                if len(items) == 1 and DASH_MIN <= ln <= DASH_MAX:
                    short.append((p.x, p.y, q.x, q.y))
                if ln >= LONG_LINE_PT and w <= THIN_MAX_PT:
                    long_lines.append((p.x, p.y, q.x, q.y))
        rect = pymupdf.Rect(d["rect"])
        if (
            len(items) >= 2
            and 2 * CIRCLE_R_MIN <= max(rect.width, rect.height) <= 2.2 * CIRCLE_R_MAX
        ):
            pts = np.array([tuple(pymupdf.Point(p) * m) for p in path_points(items)])
            c = is_circle(pts)
            if c:
                circles.append(c)
    seg_circ = segment_circles([s for s in short if math.dist(s[:2], s[2:]) <= 12.0])
    acc["circles_from_separate_segments"] += len(seg_circ)
    uniq: list[tuple[float, float, float]] = []
    for c in circles + seg_circ:
        if not any(
            math.hypot(c[0] - u[0], c[1] - u[1]) < 1.0 and abs(c[2] - u[2]) < 1.0 for u in uniq
        ):
            uniq.append(c)
    acc["circles"] += len(uniq)
    result = dash_chains(short)
    chain_lines: list[tuple[float, float, float, float]] = []
    if result:
        chains, arr, length = result
        for c in chains:
            a, b = arr[c[0]], arr[c[-1]]
            if math.dist(a[:2], b[2:]) >= LONG_LINE_PT:
                chain_lines.append((a[0], a[1], b[2], b[3]))
    acc["chained_dash_lines_long"] += len(chain_lines)
    ll = np.array(long_lines).reshape(-1, 4)
    cl = np.array(chain_lines).reshape(-1, 4)

    def attached(lines: np.ndarray, cx: float, cy: float, r: float) -> int:
        if not len(lines):
            return 0
        x0, y0, x1, y1 = lines[:, 0], lines[:, 1], lines[:, 2], lines[:, 3]
        dx, dy = x1 - x0, y1 - y0
        L2 = np.maximum(dx * dx + dy * dy, 1e-9)
        t = np.clip(((cx - x0) * dx + (cy - y0) * dy) / L2, 0, 1)
        near = np.hypot(x0 + t * dx - cx, y0 + t * dy - cy)
        perp = np.abs(dx * (cy - y0) - dy * (cx - x0)) / np.sqrt(L2)
        return int(((near <= 1.5 * r) & (perp <= 0.35 * r)).sum())

    for cx, cy, r in uniq:
        inside = [w for w in words if math.hypot(w[0] - cx, w[1] - cy) < 0.9 * r]
        toks = [w[4] for w in inside]
        if not toks:
            acc["circles_no_text"] += 1
            continue
        grid_like = False
        if len(toks) == 1 and len(toks[0]) <= 4:
            acc["circles_one_short_token"] += 1
            if GRID_TOKEN_RE.match(toks[0].upper()):
                acc["bubbles_grid_like"] += 1
                grid_like = True
            else:
                acc["circles_one_token_other"] += 1
        elif len(toks) == 2:
            acc["circles_two_tokens"] += 1
            a, b = sorted(inside, key=lambda w: w[1])
            stacked = abs(a[1] - b[1]) > abs(a[0] - b[0])
            if stacked and CALLOUT_SHEET_RE.match(b[4].upper()) and len(b[4]) >= 2:
                acc["bubbles_callout_like"] += 1
        else:
            acc["circles_many_tokens"] += 1
        if grid_like:
            solid, chained = attached(ll, cx, cy, r), attached(cl, cx, cy, r)
            acc["grid_line_attachments_solid"] += solid
            acc["grid_line_attachments_chained"] += chained
            acc["grid_bubbles_with_a_line"] += (solid + chained) > 0
    if result:
        acc["dash_chains"] += len(chains)
        acc["dash_chain_segments"] += sum(len(c) for c in chains)
        for c in chains:
            gaps = [math.dist(arr[a, 2:4], arr[b, :2]) for a, b in zip(c, c[1:], strict=False)]
            lens = [length[i] for i in c]
            if (
                gaps
                and np.mean(gaps) > 0
                and np.std(gaps) / np.mean(gaps) < 0.2
                and np.std(lens) / np.mean(lens) < 0.15
            ):
                acc["dash_chains_regular"] += 1


def sampled(idx: list[int]) -> list[int]:
    if len(idx) <= MAX_PAGES:
        return idx
    return [idx[round(i * (len(idx) - 1) / (MAX_PAGES - 1))] for i in range(MAX_PAGES)]


def survey(path: Path) -> dict:
    acc: Counter = Counter()
    widths: Counter = Counter()
    colours: Counter = Counter()
    layers: set = set()
    with pymupdf.open(path) as doc:
        large = [i for i, p in enumerate(doc) if max(p.rect.width, p.rect.height) >= LARGE_PT]
        pages = sampled(large)
        referenced = False
        ocgs = doc.get_ocgs() or {}
        per_page_words = []
        for i in pages:
            page = doc[i]
            words = page_text(page, acc)
            per_page_words.append(len(words))
            detect_tables(words, acc)
            page_geometry(page, words, acc, widths, colours, layers)
            if ocgs and b"/OC" in page.read_contents():
                referenced = True
        n_ocg = len(ocgs)
    out = {
        "pages_total": len(large),
        "pages_measured": len(pages),
        "words_per_page_median": int(statistics.median(per_page_words)) if per_page_words else 0,
        "printable_char_share": round(acc["chars_printable"] / acc["chars"], 4)
        if acc["chars"]
        else None,
        "rotated_line_share": round(acc["lines_rotated"] / acc["lines"], 4)
        if acc["lines"]
        else None,
        "member_plan_hits": acc["member_plan"],
        "member_title_hits": acc["member_title"],
        "member_plan_to_title_ratio": (
            round(acc["member_plan"] / acc["member_title"], 2) if acc["member_title"] else None
        ),
        "ocg_layers": n_ocg,
        "layer_referenced_by_content": referenced if n_ocg else None,
        "distinct_layers_used_by_paths": len(layers),
        "stroke_width_hist": dict(widths),
        "stroke_colour_hist": dict(colours),
    }
    for k, v in sorted(acc.items()):
        if k not in ("chars", "chars_printable", "lines", "lines_rotated", "words"):
            out[k] = v
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--item", action="append", required=True)
    ap.add_argument("--map", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    roots = {s.split("=", 1)[0]: Path(s.split("=", 1)[1]) for s in args.item}
    wanted = args.ids.split(",")
    rows = {r["id"]: r for r in csv.DictReader(args.map.open(newline="", encoding="utf-8"))}
    results = {}
    for anon in wanted:
        r = rows[anon]
        results[anon] = survey(roots[r["item"]] / r["relative_path"])
        print(anon, "done", flush=True)
    args.out.write_text(json.dumps(results, indent=1))
    print(f"wrote {len(results)} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
