"""Phase 5u V1a: colour of the takeoff markups crossed with subtype and with the shape class of the tag.

Counts only. The tag text itself is never stored or printed; only its shape class.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.colour_study
"""

from __future__ import annotations

import collections
import json
import re

import pymupdf

from tools.takeoff.common import TAKEOFFS, takeoff_files


def colour_key(c) -> str:
    if not c:
        return "none"
    return "/".join(f"{round(float(v), 2):.2f}" for v in c)


def tag_class(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return "none"
    if len(t) > 12 or "\n" in t or " " in t:
        return "long"
    if re.fullmatch(r"[A-Za-z]+", t):
        return "letters"
    if re.fullmatch(r"[0-9]+", t):
        return "digits"
    if re.fullmatch(r"[A-Za-z]+[-.]?[0-9]+[A-Za-z]?|[0-9]+[-.]?[A-Za-z]+", t):
        return "letters+digits"
    return "other"


def study_file(path) -> dict:
    res = {
        "stroke_by_subtype": collections.Counter(),
        "fill_by_subtype": collections.Counter(),
        "stroke_by_tag": collections.Counter(),
        "stroke_by_subtype_tag": collections.Counter(),
    }
    with pymupdf.open(path) as doc:
        for page in doc:
            for a in page.annots() or []:
                st = a.type[1]
                col = a.colors or {}
                s = colour_key(col.get("stroke"))
                f = colour_key(col.get("fill"))
                tc = tag_class(a.info.get("content"))
                res["stroke_by_subtype"][f"{s}|{st}"] += 1
                res["fill_by_subtype"][f"{f}|{st}"] += 1
                res["stroke_by_tag"][f"{s}|{tc}"] += 1
                res["stroke_by_subtype_tag"][f"{s}|{st}|{tc}"] += 1
    return {k: dict(v) for k, v in res.items()}


def main() -> None:
    out = {p.name: study_file(p) for p in takeoff_files() if p.suffix == ".pdf"}
    (TAKEOFFS / "colour_study.json").write_text(json.dumps(out, indent=1))
    pooled: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in out.values():
        for k, v in r.items():
            pooled[k].update(v)
    for k in ("stroke_by_subtype", "fill_by_subtype"):
        print(k)
        for key, n in pooled[k].most_common(25):
            print(f"  {n:6d}  {key}")
    nfiles = collections.Counter()
    for r in out.values():
        for c in {key.split("|")[0] for key in r["stroke_by_subtype"]}:
            nfiles[c] += 1
    print("stroke colours: files using each")
    for c, n in nfiles.most_common(15):
        print(f"  {n:3d} files  {c}")


if __name__ == "__main__":
    main()
