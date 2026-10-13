"""Phase 6c Part B: the blind human sample (60 symbols, fixed seed, at most 6 per job).

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_census sample
  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_sample fill <labels.json>

Files go to fixtures/private/shots/phase6c/ (git-ignored): `sample-NN.png` (named by number only),
`samples.csv` with blank owner columns and a separate `provisional_ai_label` column that is NOT
ground truth, and `categories.txt`.
"""

from __future__ import annotations

import csv
import io
import json
import sys

import pymupdf
from PIL import Image, ImageDraw

from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff import phase6c_lib as L
from tools.takeoff.common import PRIVATE, TAKEOFFS
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf

OUT = PRIVATE / "shots" / "phase6c"
CATEGORIES = [
    "member drawn but not extracted",
    "column/post symbol (not a line)",
    "ring placed beside member",
    "ring on text/label",
    "raster area",
    "other/unclear",
]
NEAR_PT, WIDE_PT = 120.0, 480.0
BLUE, GREEN, LIGHT, ORANGE = (30, 60, 255), (0, 150, 0), (140, 210, 140), (255, 140, 0)


def render(page, cx, cy, half, zoom):
    clip = pymupdf.Rect(cx - half, cy - half, cx + half, cy + half) & page.rect
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    return img, clip


def overlay(img, clip, zoom, x, y, lines, suggested, prims, ring=True, raw=True, extracted=True):
    d = ImageDraw.Draw(img, "RGBA")

    def px(p):
        return ((p[0] - clip.x0) * zoom, (p[1] - clip.y0) * zoom)

    if raw:
        for pts in prims:
            if len(pts) >= 2:
                d.line([px(p) for p in pts], fill=ORANGE + (170,), width=1)
    if extracted:
        for ln in lines:
            if max(ln.x0, ln.x1) < clip.x0 or min(ln.x0, ln.x1) > clip.x1:
                continue
            if max(ln.y0, ln.y1) < clip.y0 or min(ln.y0, ln.y1) > clip.y1:
                continue
            col = GREEN + (230,) if ln.klass in suggested else LIGHT + (200,)
            d.line([px((ln.x0, ln.y0)), px((ln.x1, ln.y1))], fill=col, width=2)
    if ring:
        cx, cy = px((x, y))
        r = 7 * zoom
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=BLUE + (255,), width=3)
    return img


def window_prims(page, m, x, y, half):
    out = []
    lo_x, hi_x, lo_y, hi_y = x - half, x + half, y - half, y + half
    for d in page.get_drawings(extended=True):
        if d.get("type") not in ("s", "f", "fs"):
            continue
        r = pymupdf.Rect(d["rect"]) * m
        r.normalize()
        if r.x1 < lo_x or r.x0 > hi_x or r.y1 < lo_y or r.y0 > hi_y:
            continue
        for it in d["items"]:
            _, pts, closed = L.item_shape(it, m)
            if pts:
                out.append(pts + ([pts[0]] if closed else []))
    return out


def make_sheet(doc, dp: int, x: float, y: float, title: str):
    page = doc[dp]
    m = page.rotation_matrix
    size = (page.rect.width, page.rect.height)
    b = whole_sheet_box(*size)
    box = (b["x0"], b["y0"], b["x1"], b["y1"])
    lines = page_lines(page)
    suggested = suggest_classes(class_table(lines_in_box(lines, box, size)))
    z_near, z_wide = 5.0, 1.5
    clean, c1 = render(page, x, y, NEAR_PT / 2, z_near)
    clean = overlay(clean, c1, z_near, x, y, [], suggested, [], raw=False, extracted=False)
    near, c2 = render(page, x, y, NEAR_PT / 2, z_near)
    near = overlay(
        near, c2, z_near, x, y, lines, suggested, window_prims(page, m, x, y, NEAR_PT / 2)
    )
    wide, c3 = render(page, x, y, WIDE_PT / 2, z_wide)
    wide = overlay(
        wide, c3, z_wide, x, y, lines, suggested, window_prims(page, m, x, y, WIDE_PT / 2)
    )
    h = max(clean.height, near.height, wide.height) + 22
    sheet = Image.new("RGB", (clean.width + near.width + wide.width + 40, h), (255, 255, 255))
    ox = 0
    for im in (clean, near, wide):
        sheet.paste(im, (ox, 22))
        ox += im.width + 20
    ImageDraw.Draw(sheet).text(
        (4, 4),
        f"{title}   left: drawing, blue ring = estimator symbol   middle and right: "
        "green = lines we extracted (class used), light green = other extracted lines, "
        "orange = raw drawing primitives",
        fill=(0, 0, 0),
    )
    return sheet


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = json.loads((TAKEOFFS / "phase6c_census.json").read_text())
    pop = [(p["job"], p["tp"], r["idx"]) for p in data["pages"] for r in p["symbols"] if r["pop"]]
    chosen = L.select_sample(pop)
    pages = {(p["job"], p["tp"]): p for p in data["pages"]}
    suspect = {}
    for job, ps in json.loads((TAKEOFFS / "phase6c_frame_all.json").read_text()).items():
        for p in ps:
            if p["best_offset"]:
                suspect[(job, p["takeoff_page"])] = p["drawing_page"] + p["best_offset"]
    runs = json.loads(RUNS.read_text())
    conn = connect()
    docs: dict[str, pymupdf.Document] = {}
    rows = []
    for n, (job, tp, idx) in enumerate(chosen, 1):
        pg = pages[(job, tp)]
        s = next(r for r in pg["symbols"] if r["idx"] == idx)
        if job not in docs:
            docs[job] = pymupdf.open(stored_pdf(conn, runs[job]["project_id"]))
        x, y = s["x"], s["y"]
        make_sheet(docs[job], pg["dp"], x, y, f"sample {n:02d}").save(OUT / f"sample-{n:02d}.png")
        note = ""
        if (job, tp) in suspect:
            alt = suspect[(job, tp)]
            make_sheet(docs[job], alt, x, y, f"sample {n:02d} (alternative page)").save(
                OUT / f"sample-{n:02d}-alt.png"
            )
            note = (
                "page map suspect: the marked-up page matches drawing page "
                f"{alt + 1} better than page {pg['dp'] + 1}; see sample-{n:02d}-alt.png"
            )
        rows.append([f"{n:02d}", job, pg["dp"] + 1, round(x, 1), round(y, 1), "", "", "", note])
    with open(OUT / "samples.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "sample",
                "job",
                "page",
                "x_pt",
                "y_pt",
                "owner_label",
                "owner_notes",
                "provisional_ai_label (NOT ground truth)",
                "page_map_note",
            ]
        )
        w.writerows(rows)
    (OUT / "categories.txt").write_text(
        "Fixed categories for the owner_label column:\n"
        + "\n".join(f"- {c}" for c in CATEGORIES)
        + "\n"
    )
    print(len(rows), "samples written to", OUT)


def fill(path: str) -> None:
    labels = json.loads(open(path).read())
    rows = list(csv.reader(open(OUT / "samples.csv")))
    for r in rows[1:]:
        r[7] = labels.get(r[0], "")
    csv.writer(open(OUT / "samples.csv", "w", newline="")).writerows(rows)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "fill":
        fill(sys.argv[2])
    else:
        main()
