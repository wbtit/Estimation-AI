"""Phase 6c Part C: recall on 'marked-everything' pages, from the stored Phase 6b results.

  PYTHONPATH=. .venv/bin/python -m tools.takeoff.phase6c_scope

A page is selected when our linked-line piece count (line with label, suggested class) is at least
1 and their symbol count is at least THRESHOLD times that count (0.8 primary; 0.5 and 1.0 as
fixed sensitivity values). No new matching: matched counts at 12 pt come from the 6b file.
"""

from __future__ import annotations

import json

from tools.takeoff.common import TAKEOFFS
from tools.takeoff.phase6b_lib import prf

THRESHOLDS = (0.8, 0.5, 1.0)
BASES = ("line_with_label", "label_first", "line_first")


def pick(pages: list[dict], threshold: float) -> tuple[list[dict], list[dict], list[dict]]:
    """(selected, other, no_pieces) pages."""
    sel, other, none = [], [], []
    for p in pages:
        ours = p["bases"]["line_with_label"]["suggested"]["pieces"]
        if ours < 1:
            none.append(p)
        elif p["theirs"] >= threshold * ours:
            sel.append(p)
        else:
            other.append(p)
    return sel, other, none


def figures(pages: list[dict]) -> dict:
    theirs = sum(p["theirs"] for p in pages)
    out = {"pages": len(pages), "jobs": len({p["job"] for p in pages}), "theirs": theirs}
    for b in BASES:
        s = [p["bases"][b]["suggested"] for p in pages]
        pieces = sum(x["pieces"] for x in s)
        matched = sum(x["matched_12"] for x in s)
        pr, rc, f1 = prf(matched, pieces, theirs)
        out[b] = {"pieces": pieces, "matched12": matched, "P": pr, "R": rc, "F1": f1}
    return out


def main() -> dict:
    d = json.loads((TAKEOFFS / "phase6b_study.json").read_text())
    pages = d["pages"]
    res: dict = {"all": figures(pages), "by_threshold": {}}
    for t in THRESHOLDS:
        sel, other, none = pick(pages, t)
        res["by_threshold"][str(t)] = {
            "selected": figures(sel),
            "other": figures(other),
            "no_pieces": {"pages": len(none), "theirs": sum(p["theirs"] for p in none)},
        }
    (TAKEOFFS / "phase6c_scope.json").write_text(json.dumps(res, indent=1))
    return res


if __name__ == "__main__":
    r = main()

    def fmt(x):
        return "-" if x is None else f"{x:.2f}"

    def row(name, f):
        lw, lf, fl = f["line_with_label"], f["label_first"], f["line_first"]
        print(
            f"{name:22s} pages {f['pages']:3d} jobs {f['jobs']:2d} theirs {f['theirs']:5d} | "
            f"lwl pcs {lw['pieces']:5d} P {fmt(lw['P'])} R {fmt(lw['R'])} | "
            f"lf pcs {lf['pieces']:5d} P {fmt(lf['P'])} R {fmt(lf['R'])} | "
            f"first pcs {fl['pieces']:5d} P {fmt(fl['P'])} R {fmt(fl['R'])}"
        )

    row("all pages", r["all"])
    for t, v in r["by_threshold"].items():
        row(f"selected (>= {t})", v["selected"])
        row(f"other   (<  {t})", v["other"])
        print("  no pieces:", v["no_pieces"])
