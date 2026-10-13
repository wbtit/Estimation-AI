"""Phase 6c Part A: re-score one job in-process with an explicit takeoff-to-drawing page map.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_rescore job-014 6:6 7:7 9:9 10:10 ...

All profile labels with a best line count as pieces (no review-status filter, no API), the three
bases of Phase 6b, suggested class and the per-page oracle class (best F1 at 12 pt), pooled over the
given pages. Used to show what a corrected page map would change for one job; the Phase 6b figure
is not replaced.
"""

from __future__ import annotations

import json
import sys

import pymupdf

from src.linking.labels import page_labels
from src.linking.lines import page_lines
from src.linking.structural import class_table, lines_in_box, suggest_classes
from src.review.auto_run import whole_sheet_box
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_lib import prf
from tools.takeoff.phase6b_study import BASES, bases_for, f1_at12, score_pieces, their_symbols
from tools.takeoff.phase6c_trace import RUNS, connect, stored_pdf


def page_scores(tpage, dpage, sheet_id: str, marks: set[str]) -> dict:
    syms = their_symbols(tpage)
    xy = [(s["x"], s["y"]) for s in syms]
    size = (dpage.rect.width, dpage.rect.height)
    b = whole_sheet_box(*size)
    box = (b["x0"], b["y0"], b["x1"], b["y1"])
    in_view = lines_in_box(page_lines(dpage), box, size)
    table = class_table(in_view)
    suggested = suggest_classes(table)
    labels = [
        lb
        for lb in page_labels(dpage, sheet_id, marks)
        if box[0] <= (lb.bbox[0] + lb.bbox[2]) / 2 <= box[2]
        and box[1] <= (lb.bbox[1] + lb.bbox[3]) / 2 <= box[3]
    ]

    def run(classes):
        return bases_for(labels, [ln for ln in in_view if ln.klass in classes], {})

    out = {"theirs": len(xy), "suggested": {}, "oracle": {}}
    main = run(suggested)
    best = {}
    for k in BASES:
        sc = score_pieces(xy, main[k])
        out["suggested"][k] = (sc["pieces"], sc["matched_12"])
        best[k] = (sc, f1_at12(sc, len(xy)))
    for c in (c for c in table if c.lines >= 3 and [c.key] != suggested):
        res = run([c.key])
        for k in BASES:
            sc = score_pieces(xy, res[k])
            f = f1_at12(sc, len(xy))
            if (f, -abs(sc["pieces"] - len(xy))) > (
                best[k][1],
                -abs(best[k][0]["pieces"] - len(xy)),
            ):
                best[k] = (sc, f)
    for k in BASES:
        out["oracle"][k] = (best[k][0]["pieces"], best[k][0]["matched_12"])
    return out


def pooled(rows: list[dict], mode: str) -> dict:
    res = {}
    theirs = sum(r["theirs"] for r in rows)
    for k in BASES:
        pieces = sum(r[mode][k][0] for r in rows)
        matched = sum(r[mode][k][1] for r in rows)
        p, r_, f = prf(matched, pieces, theirs)
        res[k] = {"pieces": pieces, "matched12": matched, "P": p, "R": r_, "F1": f}
    return res


if __name__ == "__main__":
    job = sys.argv[1]
    pairs = [tuple(int(v) for v in a.split(":")) for a in sys.argv[2:]]
    runs = json.loads(RUNS.read_text())
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    name = next(n for n, i in inv.items() if i.get("match") == job)
    conn = connect()
    pid = runs[job]["project_id"]
    pdf = stored_pdf(conn, pid)
    sheets = {
        r["page_index"]: str(r["id"])
        for r in conn.execute("SELECT id, page_index FROM sheets WHERE project_id = %s", (pid,))
    }
    marks = {
        r["mark"]
        for r in conn.execute("SELECT mark FROM legend_rows WHERE project_id = %s", (pid,))
    }
    rows = []
    with pymupdf.open(TAKEOFFS / name) as t, pymupdf.open(pdf) as d:
        for tp, dp in pairs:
            rows.append(page_scores(t[tp], d[dp], sheets[dp], marks))
    print(
        json.dumps(
            {"suggested": pooled(rows, "suggested"), "oracle": pooled(rows, "oracle")}, indent=1
        )
    )
