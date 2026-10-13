"""Phase 5u W3 / M7: does the number of size labels on a page equal the number of circle count symbols?

Registered in docs/PHASE5U_PREREGISTRATION.md (addition W1 to W3). Counts only; no text is printed or stored.
n_circle = Polygon annotations with 8 vertices; n_sym = 3 or 8 vertices; n_lbl = profile occurrences in text-layer line
items whose centre is outside the right 13% of the page; n_lbl_W = the W family subset.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.m7_study
"""

from __future__ import annotations

import collections
import json

import pymupdf

from src.text_layer.items import extract_page_text
from src.text_layer.parsers.profile import find_profiles
from tools.takeoff.common import TAKEOFFS

STRIP = 0.13
BANDS = ["equal", "<=10%", "<=25%", "<=50%", ">50%"]
VIEWED = {"takeoff-10.pdf": {19, 23, 15, 20, 12, 16}}


def band(r: float) -> str:
    if r == 0:
        return BANDS[0]
    for lim, name in zip((0.10, 0.25, 0.50), BANDS[1:4], strict=True):
        if r <= lim:
            return name
    return BANDS[4]


def page_counts(page: pymupdf.Page) -> dict | None:
    n_sym = n_circle = 0
    for a in page.annots() or []:
        if a.type[1] == "Polygon":
            nv = len(a.vertices or [])
            if nv == 8:
                n_circle += 1
                n_sym += 1
            elif nv == 3:
                n_sym += 1
    if n_sym == 0:
        return None
    try:
        a = page.first_annot
        while a:
            a = page.delete_annot(a)
    except Exception:  # noqa: BLE001
        pass
    pt = extract_page_text(page)
    if not pt.has_text_layer:
        return {"text": False, "n_sym": n_sym, "n_circle": n_circle}
    w = page.rect.width
    n_lbl = n_w = 0
    for it in pt.items:
        if it.level != "line":
            continue
        cx = (it.bbox[0] + it.bbox[2]) / 2
        if cx > (1 - STRIP) * w:
            continue
        for p in find_profiles(it.text):
            n_lbl += 1
            n_w += p.family == "W"
    return {"text": True, "n_sym": n_sym, "n_circle": n_circle, "n_lbl": n_lbl, "n_lbl_W": n_w}


def main() -> None:
    inv = json.load(open(TAKEOFFS / "inventory.json"))
    pages = []
    for name, v in inv.items():
        job = v.get("match")
        if not job:
            continue
        with pymupdf.open(TAKEOFFS / name) as doc:
            for i, pg in enumerate(doc):
                c = page_counts(pg)
                if c:
                    pages.append({"job": job, "file": name, "page": i + 1, **c})
    (TAKEOFFS / "m7.json").write_text(json.dumps(pages, indent=1))
    usable = [p for p in pages if p["text"]]
    print("pages with count symbols:", len(pages), "| with a text layer:", len(usable))
    no_circle = [p for p in usable if p["n_circle"] == 0]
    rated = [p for p in usable if p["n_circle"] > 0]
    print("no circle symbols:", len(no_circle), "| with circles (in the bands):", len(rated))

    def table(sel, label):
        for key in ("n_lbl", "n_lbl_W"):
            c = collections.Counter(band(abs(p[key] - p["n_circle"]) / p["n_circle"]) for p in sel)
            print(
                f"  {label} {key}: " + ", ".join(f"{b} {c.get(b, 0)}" for b in BANDS),
                f"(pages {len(sel)})",
            )

    table(rated, "pooled")
    jobs = collections.defaultdict(list)
    for p in rated:
        jobs[p["job"]].append(p)
    for j in sorted(jobs):
        table(jobs[j], j)
    viewed = [p for p in rated if p["page"] in VIEWED.get(p["file"], ())]
    table(viewed, "viewed job-018 pages")
    for p in viewed:
        print("   page", p["page"], {k: p[k] for k in ("n_sym", "n_circle", "n_lbl", "n_lbl_W")})
    tot_c = sum(p["n_circle"] for p in rated)
    print(
        "sum over rated pages: circles",
        tot_c,
        "labels",
        sum(p["n_lbl"] for p in rated),
        "W labels",
        sum(p["n_lbl_W"] for p in rated),
    )


if __name__ == "__main__":
    main()
