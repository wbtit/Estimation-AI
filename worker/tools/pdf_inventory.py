"""Read-only inventory of a set of PDFs: counts and flags only.

Run isolated, from a directory that is not the data directory:
    worker/.venv/bin/python -I worker/tools/pdf_inventory.py \
        --item set-A=/path/to/folder --item set-B=/path/to/other --out fixtures/private

It never prints or writes file names, titles, firm names or text content to stdout. The only place a
file name is written is `<out>/inventory_map.csv` (anonymous id -> relative path), which must live
in a git-ignored folder. It does not extract, OCR or decode text: text is only COUNTED (characters
per page, words inside a circle). PDFs are opened read-only; nothing is executed or copied.
"""

import argparse
import csv
import hashlib
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pymupdf

LARGE_PAGE_PT = 1000.0  # larger side: a drawing sheet (about 14 in and up)
LETTER_A4_TOL_PT = 15.0
TEXT_PAGE_MIN_CHARS = 20
VECTOR_HEAVY_MIN_PATHS = 2000
RASTER_MIN_COVER = 0.70
RASTER_MAX_PATHS = 200
GEOMETRY_PAGES = 6  # pages sampled (evenly spaced) for circles and dashes
CIRCLE_R_MIN, CIRCLE_R_MAX = 5.0, 30.0
CIRCLE_RMS, CIRCLE_ARC = 0.03, 300.0
MAX_LABEL_CHARS = 3
INNER_PATH_MAX = 8
DASH_LEN_MIN, DASH_LEN_MAX = 1.0, 12.0
DASH_RUN_MIN = 4
ESTIMATE_MIN_MEDIAN_CHARS = 500

FIELDS = [
    "id", "item", "file_mb", "pages", "page_size_class", "distinct_sizes", "max_side_pt",
    "text_pages", "sampled_pages", "median_chars_per_page", "text_layer", "vector_no_text_pages",
    "outlined_text_likely", "raster_pages", "raster_with_text_pages", "raster_only",
    "ocg_layers", "layer_referenced", "producer_category", "type_guess",
    "geom_pages_sampled", "circles", "labelled_circles", "real_dash_paths",
    "exploded_dash_segments", "dash_kind", "duplicate_of", "error",
]  # fmt: skip


def producer_category(meta: dict) -> str:
    text = f"{meta.get('producer') or ''} {meta.get('creator') or ''}".lower()
    if not text.strip():
        return "unknown"
    if "autocad" in text or "autodesk" in text or "dwg" in text:
        return "AutoCAD"
    if "bluebeam" in text:
        return "Bluebeam"
    return "other"


def size_class(w: float, h: float) -> str:
    a, b = sorted((w, h))
    if abs(a - 612) < LETTER_A4_TOL_PT and abs(b - 792) < LETTER_A4_TOL_PT:
        return "letter"
    if abs(a - 595) < LETTER_A4_TOL_PT and abs(b - 842) < LETTER_A4_TOL_PT:
        return "a4"
    return "large" if b >= LARGE_PAGE_PT else "other"


def _bezier(p0, p1, p2, p3, n=6):
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
            pts += _bezier(it[1], it[2], it[3], it[4])
        elif k == "re":
            r = pymupdf.Rect(it[1])
            pts += [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)]
        elif k == "qu":
            q = pymupdf.Quad(it[1])
            pts += [tuple(q.ul), tuple(q.ur), tuple(q.lr), tuple(q.ll), tuple(q.ul)]
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


def sampled_pages(n: int) -> list[int]:
    if n <= GEOMETRY_PAGES:
        return list(range(n))
    return sorted({round(i * (n - 1) / (GEOMETRY_PAGES - 1)) for i in range(GEOMETRY_PAGES)})


def geometry(page: pymupdf.Page, text_words: list) -> dict:
    """Circles with a short label, and dash kinds, from path geometry. Nothing is decoded."""
    matrix = page.rotation_matrix
    circles: list[tuple[float, float, float]] = []
    small: list[tuple[float, float]] = []  # centres of small stroked paths (outlined glyph strokes)
    real_dash = 0
    segs: list[tuple[float, float, float, float]] = []  # short single-line stroked paths
    for d in page.get_cdrawings():
        if d.get("type") not in ("s", "fs"):
            continue
        dashes = d.get("dashes") or "[] 0"
        if not dashes.startswith("[]"):
            real_dash += 1
        items = d["items"]
        rect = pymupdf.Rect(d["rect"])
        size = max(rect.width, rect.height)
        if len(items) == 1 and items[0][0] == "l":
            p, q = pymupdf.Point(items[0][1]) * matrix, pymupdf.Point(items[0][2]) * matrix
            length = math.dist(p, q)
            if DASH_LEN_MIN <= length <= DASH_LEN_MAX:
                segs.append((p.x, p.y, q.x, q.y))
        if size < CIRCLE_R_MIN * 2:
            c = pymupdf.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2) * matrix
            small.append((c.x, c.y))
            continue
        if size > CIRCLE_R_MAX * 2.2 or len(items) < 2:
            continue
        pts = np.array([tuple(pymupdf.Point(p) * matrix) for p in path_points(items)])
        if len(pts) < 12:
            continue
        cx, cy, r, rms, arc = fit_circle(pts)
        if CIRCLE_R_MIN <= r <= CIRCLE_R_MAX and rms < CIRCLE_RMS and arc >= CIRCLE_ARC:
            circles.append((cx, cy, r))
    # merge near-duplicate circles (fill + stroke drawn twice)
    uniq: list[tuple[float, float, float]] = []
    for c in circles:
        if not any(
            math.hypot(c[0] - u[0], c[1] - u[1]) < 1.0 and abs(c[2] - u[2]) < 1.0 for u in uniq
        ):
            uniq.append(c)
    small_arr = np.array(small).reshape(-1, 2)
    labelled = 0
    for cx, cy, r in uniq:
        words = [w for w in text_words if _inside(w, cx, cy, r, matrix)]
        n_chars = sum(len(w[4]) for w in words)
        if words and n_chars <= MAX_LABEL_CHARS:
            labelled += 1
            continue
        if not words and len(small_arr):
            inner = int((np.hypot(small_arr[:, 0] - cx, small_arr[:, 1] - cy) < 0.8 * r).sum())
            if 1 <= inner <= INNER_PATH_MAX:
                labelled += 1
    return {
        "circles": len(uniq),
        "labelled": labelled,
        "real_dash": real_dash,
        "exploded": exploded_dash_segments(segs),
    }


def _inside(word, cx, cy, r, matrix) -> bool:
    # words from get_text are in displayed coordinates already
    wx, wy = (word[0] + word[2]) / 2, (word[1] + word[3]) / 2
    return math.hypot(wx - cx, wy - cy) < 0.9 * r


def exploded_dash_segments(segs: list[tuple[float, float, float, float]]) -> int:
    """Short collinear single-line paths chained end to end at a regular gap: count the segments
    that belong to chains of at least DASH_RUN_MIN (dashes that were exploded into separate lines).
    """
    if len(segs) < DASH_RUN_MIN:
        return 0
    arr = np.array(segs)
    # orient each segment left to right (or bottom to top for verticals)
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
                    if j == i or j in taken:
                        continue
                    vx, vy = arr[j, 0] - ex, arr[j, 1] - ey
                    gap = math.hypot(vx, vy)
                    if not 0.2 * length[i] <= gap <= 2.5 * length[i]:
                        continue
                    if abs(length[j] - length[i]) > 0.15 * length[i] + 0.2:
                        continue
                    if abs(math.atan2(math.sin(ang[j] - ang[i]), math.cos(ang[j] - ang[i]))) > 0.03:
                        continue
                    if abs(-vx * math.sin(ang[i]) + vy * math.cos(ang[i])) > 0.4:  # perpendicular
                        continue
                    nxt[i] = j
                    taken.add(j)
    prev = {j: i for i, j in nxt.items()}
    counted = 0
    for start in (i for i in range(len(arr)) if i not in prev):
        chain, cur = 1, start
        while cur in nxt:
            cur = nxt[cur]
            chain += 1
        if chain >= DASH_RUN_MIN:
            counted += chain
    return counted


def inspect(path: Path, anon: str, item: str) -> dict:
    row: dict = {k: "" for k in FIELDS}
    row.update(id=anon, item=item, file_mb=round(path.stat().st_size / 1e6, 2))
    try:
        doc = pymupdf.open(path)
    except Exception as err:  # never print the name; the error class is enough
        row["error"] = type(err).__name__
        return row
    with doc:
        if doc.needs_pass:
            row["error"] = "encrypted"
            return row
        n = doc.page_count
        sizes = []
        chars, paths, cover = [], [], []
        sample = set(sampled_pages(n))
        for idx, page in enumerate(doc):
            sizes.append((round(page.rect.width), round(page.rect.height)))
            chars.append(len(page.get_text("text").replace("\n", "").replace(" ", "")))
            # path counts are the slow part: measured on the sampled pages only
            paths.append(len(page.get_cdrawings()) if idx in sample else -1)
            area = page.rect.width * page.rect.height or 1.0
            cover.append(
                min(
                    1.0,
                    sum(pymupdf.Rect(i["bbox"]).get_area() for i in page.get_image_info()) / area,
                )
            )
        classes = Counter(size_class(w, h) for w, h in sizes)
        main_class = classes.most_common(1)[0][0]
        has_text = [c >= TEXT_PAGE_MIN_CHARS for c in chars]
        # vector and raster flags use the sampled pages (path counts exist only there)
        s_idx = sorted(sample)
        ns = len(s_idx)
        vec_no_text = [(not has_text[i]) and paths[i] >= VECTOR_HEAVY_MIN_PATHS for i in s_idx]
        raster = [cover[i] >= RASTER_MIN_COVER and paths[i] < RASTER_MAX_PATHS for i in s_idx]
        raster_text = [r and has_text[i] for r, i in zip(raster, s_idx, strict=True)]
        frac = lambda flags: sum(flags) / ns  # noqa: E731
        frac_all = lambda flags: sum(flags) / n  # noqa: E731
        ocgs = doc.get_ocgs() or {}
        referenced = False
        if ocgs:
            for page in doc:
                if b"/OC" in page.read_contents():
                    referenced = True
                    break
                if any(
                    doc.xref_get_key(img[0], "OC")[0] != "null"
                    for img in page.get_images(full=True)
                ):
                    referenced = True
                    break
        median_chars = int(statistics.median(chars))
        large_frac = sum(1 for w, h in sizes if size_class(w, h) == "large") / n
        small_frac = sum(1 for w, h in sizes if size_class(w, h) in ("letter", "a4")) / n
        if large_frac >= 0.5:
            guess = "drawing set"
        elif small_frac >= 0.5 and median_chars >= ESTIMATE_MIN_MEDIAN_CHARS:
            guess = "estimate/takeoff document"
        else:
            guess = "unclear"
        row.update(
            pages=n,
            page_size_class=main_class,
            distinct_sizes=len(set(sizes)),
            max_side_pt=max(max(s) for s in sizes),
            text_pages=sum(has_text),
            median_chars_per_page=median_chars,
            text_layer="yes" if frac_all(has_text) >= 0.9 else "partial" if any(has_text) else "no",
            sampled_pages=ns,
            vector_no_text_pages=sum(vec_no_text),
            outlined_text_likely="yes" if frac(vec_no_text) >= 0.5 else "no",
            raster_pages=sum(raster),
            raster_with_text_pages=sum(raster_text),
            raster_only="yes" if frac(raster) >= 0.9 else "no",
            ocg_layers=len(ocgs),
            layer_referenced=("yes" if referenced else "no") if ocgs else "n/a",
            producer_category=producer_category(doc.metadata or {}),
            type_guess=guess,
        )
        if guess == "drawing set":
            totals = Counter()
            pages = sampled_pages(n)
            for idx in pages:
                page = doc[idx]
                g = geometry(page, page.get_text("words"))
                totals.update(g)
            row.update(
                geom_pages_sampled=len(pages),
                circles=totals["circles"],
                labelled_circles=totals["labelled"],
                real_dash_paths=totals["real_dash"],
                exploded_dash_segments=totals["exploded"],
                dash_kind=(
                    "both" if totals["real_dash"] and totals["exploded"]
                    else "real" if totals["real_dash"]
                    else "exploded" if totals["exploded"]
                    else "none"
                ),
            )  # fmt: skip
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--item", action="append", required=True, help="LABEL=FOLDER (repeatable)")
    ap.add_argument("--out", type=Path, required=True, help="git-ignored output folder")
    ap.add_argument("--first-id", type=int, default=2)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows, mapping = [], []
    seen: dict[str, str] = {}  # content hash -> first id (a repeated file is flagged, not skipped)
    n = args.first_id
    for spec in args.item:
        label, folder = spec.split("=", 1)
        root = Path(folder)
        others: Counter = Counter()
        files = []
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            if p.suffix.lower() == ".pdf":
                files.append(p)
            else:
                others[p.suffix.lower() or "(none)"] += 1
        print(f"{label}: {len(files)} PDFs; other file types: {dict(others) or 'none'}")
        for p in files:
            anon = f"job-{n:03d}"
            n += 1
            mapping.append({"id": anon, "item": label, "relative_path": str(p.relative_to(root))})
            row = inspect(p, anon, label)
            digest = hashlib.sha256(p.read_bytes()).hexdigest()
            row["duplicate_of"] = seen.setdefault(digest, anon) if digest in seen else ""
            seen.setdefault(digest, anon)
            rows.append(row)
            print(f"  {anon} done", flush=True)
    with (args.out / "inventory_map.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "item", "relative_path"])
        w.writeheader()
        w.writerows(mapping)
    with (args.out / "inventory.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
