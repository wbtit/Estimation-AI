"""Phase 5u K: workbook rows by kind (the owner's scope vocabulary). Registered keyword table, first match wins.

Counts only; no workbook text is printed. usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.kind_study
"""

from __future__ import annotations

import collections
import json

from tools.takeoff.common import PRIVATE
from tools.takeoff.target_workbook import num

MAIN = "main"
MISC = "misc"
EXCL = "excluded"
AMBIG = "ambiguous"

# (kind, group, keywords) in the registered priority order
TABLE: list[tuple[str, str, tuple[str, ...]]] = [
    ("Dock Stair", MISC, ("dock stair",)),
    ("Stair", MISC, ("stair",)),
    ("Roof Ladder", MISC, ("roof ladder",)),
    ("Pit Ladder", MISC, ("pit ladder",)),
    ("Ship Ladder/Cage Ladder", MISC, ("ship ladder", "cage")),
    ("Guardrail", MISC, ("guardrail", "guard rail")),
    ("Handrail/Wallrails", MISC, ("handrail", "hand rail", "wallrail", "wall rail")),
    ("Landing Frame", MISC, ("landing",)),
    ("Bollard", MISC, ("bollard",)),
    ("Gates", MISC, ("gate",)),
    ("Grating", MISC, ("grating",)),
    ("Bike Rack", MISC, ("bike",)),
    ("Curved Beam/Rolled Beam", MAIN, ("curved", "rolled")),
    ("Truss", MAIN, ("truss",)),
    ("Girt & Purlin", MAIN, ("girt", "purlin")),
    ("Lintel/Brick Veneer Supports", MAIN, ("lintel", "brick", "veneer")),
    ("Deck edge Angle / Bent plate", MAIN, ("deck edge", "edge angle", "bent plate")),
    ("Kicker/Knee Brace", MAIN, ("kicker", "knee")),
    ("Horizontal Brace", MAIN, ("horizontal brace", "horiz")),
    ("Vertical Brace", MAIN, ("vertical brace", "x-brace", "chevron")),
    ("Embeds Angle", MAIN, ("embed angle", "embeds angle")),
    ("Embed Plate/Bearing Plates", MAIN, ("embed", "bearing plate", "bearing")),
    ("RTU Frame/Roof Hatch Frame", MAIN, ("rtu", "hatch")),
    ("Roof Drain Frame", MAIN, ("drain",)),
    ("Dock Levellers", MAIN, ("dock level", "leveller", "leveler")),
    ("Sag rod", MAIN, ("sag",)),
    ("Turn Buckle", MAIN, ("turn buckle", "turnbuckle")),
    ("Outriggers", MAIN, ("outrigger",)),
    ("Hangers", MAIN, ("hanger",)),
    ("Misc. Attachments", MAIN, ("attachment",)),
    ("Posts/Pipe", MAIN, ("post", "pipe")),
    ("Column", MAIN, ("column",)),
    ("Beams", MAIN, ("beam",)),
    ("Joist", EXCL, ("joist",)),
    ("Wall", EXCL, ("wall",)),
    ("brace, direction not stated", AMBIG, ("brace", "bracing")),
    ("rail, kind not stated", AMBIG, ("rail",)),
    ("ladder, kind not stated", AMBIG, ("ladder",)),
]


def kind_of(text: str | None) -> tuple[str, str]:
    t = (text or "").lower()
    for kind, group, kws in TABLE:
        if any(k in t for k in kws):
            return kind, group
    return "unmapped", "unmapped"


def study() -> dict:
    d = json.load(open(PRIVATE / "target" / "rows.json"))
    rows, before_total = d["rows"], True
    by_kind_rows: collections.Counter = collections.Counter()
    by_kind_pieces: collections.Counter = collections.Counter()
    sec = collections.Counter()
    for r in rows:
        q = num(r.get("qty"))
        if "TOTAL" in str(r.get("grade", "")).upper():
            before_total = False
        if q is None:
            # label rows are mapped by the same keywords
            t = " ".join(str(r.get(k, "")) for k in ("ref", "name", "size", "shape"))
            if t.strip():
                sec[kind_of(t)[0]] += 1
            continue
        if "TOTAL" in str(r.get("grade", "")).upper():
            continue
        kind, group = kind_of(r.get("name"))
        part = "before_total" if before_total else "after_total"
        by_kind_rows[(part, kind, group)] += 1
        by_kind_pieces[(part, kind, group)] += q
    res: dict = {"label_rows_by_kind": dict(sec)}
    for part in ("before_total", "after_total"):
        kinds = {
            f"{k} [{g}]": {"rows": n, "pieces": by_kind_pieces[(p, k, g)]}
            for (p, k, g), n in by_kind_rows.items()
            if p == part
        }
        groups: dict = collections.defaultdict(lambda: {"rows": 0, "pieces": 0})
        for (p, _k, g), n in by_kind_rows.items():
            if p == part:
                groups[g]["rows"] += n
                groups[g]["pieces"] += by_kind_pieces[(p, _k, g)]
        res[part] = {"kinds": kinds, "groups": dict(groups)}
    return res


if __name__ == "__main__":
    r = study()
    print(json.dumps(r, indent=1))
