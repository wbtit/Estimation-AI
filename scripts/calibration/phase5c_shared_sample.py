"""Phase 5c: 20 sampled members that sit on a shared line, for the OWNER to check by eye.

Writes, under the git-ignored fixtures/private/shots/phase5c_check/, one overlay image per member
(the chosen line in red, the label in blue) and sample.csv with a blank `ok?` column. The question
for the owner: is this label the name of the beam that this line draws? Nothing here grades it.

usage (from worker/):  PYTHONPATH=. .venv/bin/python ../scripts/calibration/phase5c_shared_sample.py <job> <project id> [n=20] [seed=5]
"""

from __future__ import annotations

import csv
import importlib.util
import json
import random
import sys
import urllib.request
from pathlib import Path

import pymupdf

API = "http://127.0.0.1:3000"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "private" / "shots" / "phase5c_check"


def get(path: str):
    return json.loads(urllib.request.urlopen(API + path, timeout=300).read())


def pdf_of(job: str) -> Path:
    spec = importlib.util.spec_from_file_location("cal", ROOT / "scripts/calibration/phase5b_calibrate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.pdf_of(job)


def key(line: dict) -> tuple:
    a = (round(line["p"][0]), round(line["p"][1]))
    b = (round(line["q"][0]), round(line["q"][1]))
    return (a, b) if a <= b else (b, a)


def main(job: str, pid: str, n: int = 20, seed: int = 5) -> None:
    sheets = {s["id"]: s for s in get(f"/api/projects/{pid}/sheets")["sheets"]}
    members = [m for m in get(f"/api/projects/{pid}/members")["members"] if m["link"]["line"] and m["bbox"]]
    groups: dict[tuple, list[dict]] = {}
    for m in members:
        groups.setdefault((m["sheet_id"], key(m["link"]["line"])), []).append(m)
    pool = [(k, m) for k, v in groups.items() if len(v) > 1 for m in v]
    pool.sort(key=lambda t: t[1]["id"])
    random.Random(seed).shuffle(pool)
    pick = pool[:n]
    OUT.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_of(job))
    rows = []
    for i, ((sid, _), m) in enumerate(pick, 1):
        page = doc[sheets[sid]["page_index"]]
        ln, b = m["link"]["line"], m["bbox"]
        shape = page.new_shape()
        shape.draw_line(ln["p"], ln["q"])
        shape.finish(color=(0.9, 0, 0), width=2.5)
        shape.draw_rect(pymupdf.Rect(b["x0"] - 2, b["y0"] - 2, b["x1"] + 2, b["y1"] + 2))
        shape.finish(color=(0, 0.2, 1), width=1.5)
        shape.commit()
        cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
        clip = pymupdf.Rect(cx - 220, cy - 160, cx + 220, cy + 160) & page.rect
        name = f"{i:02d}.png"
        page.get_pixmap(clip=clip, dpi=110).save(OUT / name)
        # undo the overlay on this in-memory page: reopen the document for the next image
        doc.close()
        doc = pymupdf.open(pdf_of(job))
        group = groups[(sid, key(ln))]
        rows.append({
            "n": i,
            "page": sheets[sid]["page_number"],
            "label as read": m["profile_raw"],
            "members on this line": len(group),
            "profiles on this line": len({x["profile"] for x in group}),
            "line length (old: the whole line)": m["length_ft_in"],
            "image": name,
            "ok? (is this label the name of the beam this line draws? y / n / unsure)": "",
        })
    with open(OUT / "sample.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} members written to fixtures/private/shots/phase5c_check/ (sample.csv + {len(rows)} images)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 20, int(sys.argv[4]) if len(sys.argv) > 4 else 5)
