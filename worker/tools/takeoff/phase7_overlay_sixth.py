"""Phase 7: the sixth held-out overlay.

The registered rule (6 pages, one per job, pages with at least 20 symbols) can give only 5 held-out
images: only 5 of the 6 held-out jobs have such a page. The sixth image is a second page of one of
those jobs, drawn with seed 7402 from the eligible pages that were not drawn. Written after the single
held-out run (the frozen driver is not touched); draws an image only, scores nothing.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase7_overlay_sixth
"""

from __future__ import annotations

import json
import random

import pymupdf

from tools.takeoff import phase7_cgrammar_run as R
from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_study import their_symbols

SEED = 7402


def main() -> None:
    if not R.LOCK.exists():
        raise SystemExit("refused: the single held-out run has not been done")
    taken = {
        (i["job"], i["page"] - 1) for i in json.loads((R.SHOTS / "INDEX-held-out.json").read_text())
    }
    eligible = []
    for it in R.pages_of("held-out"):
        with pymupdf.open(TAKEOFFS / it["file"]) as t:
            n = len(their_symbols(t[it["tp"]]))
        if n >= R.OVERLAY_MIN_SYMBOLS and (it["job"], it["dp"]) not in taken:
            eligible.append(it)
    eligible.sort(key=lambda it: (it["job"], it["dp"]))
    pick = random.Random(SEED).choice(eligible)
    out = R.SHOTS / "held-out-06.png"
    R.draw_overlay(R.Loader(), pick, out)
    index = json.loads((R.SHOTS / "INDEX-held-out.json").read_text())
    index.append(
        {
            "file": out.name,
            "job": pick["job"],
            "page": pick["dp"] + 1,
            "note": "second page, seed 7402",
        }
    )
    (R.SHOTS / "INDEX-held-out.json").write_text(json.dumps(index, indent=1))
    print(out.name, pick["job"], pick["dp"] + 1)


if __name__ == "__main__":
    main()
