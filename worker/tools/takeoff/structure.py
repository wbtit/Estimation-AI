"""Step 2: structure of the markups in the takeoff PDFs. Counts and generic key names only.

Never prints or stores comment text, subject strings, author names, layer names or colours' names.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.structure [takeoff-NN.pdf ...]
"""

from __future__ import annotations

import collections
import json
import re
import sys

import pymupdf

from src.text_layer.parsers.dimension import find_dimensions
from src.text_layer.parsers.profile import find_profiles
from tools.takeoff.common import TAKEOFFS, takeoff_files

# keys that are named in the PDF specification or by the Bluebeam software; any other key is only counted
KNOWN_KEYS = {
    "Subtype",
    "Rect",
    "Contents",
    "Subj",
    "T",
    "C",
    "IC",
    "CA",
    "CreationDate",
    "M",
    "NM",
    "P",
    "F",
    "AP",
    "Vertices",
    "L",
    "LE",
    "BS",
    "Border",
    "RD",
    "DA",
    "DS",
    "RC",
    "IT",
    "RT",
    "IRT",
    "QuadPoints",
    "Measure",
    "BSIColumnData",
    "AreaHi",
    "SlopeType",
    "PitchRun",
    "GroupNesting",
    "Sequence",
    "IID",
    "Index",
    "FillOpacity",
    "Rotate",
    "BM",
    "Popup",
    "OC",
    "Q",
    "W",
    "S",
    "CL",
    "LL",
    "LLE",
    "Cap",
    "CP",
    "BE",
    "Path",
    "InkList",
    "Name",
    "Parent",
    "State",
    "StateModel",
    "ExData",
    "Measurement",
    "Lang",
    "Layer",
}


def annot_info(doc: pymupdf.Document, a: pymupdf.Annot) -> dict:
    obj = doc.xref_object(a.xref, compressed=False)
    keys = set(re.findall(r"^\s*/([A-Za-z0-9_]+)", obj, re.M))
    contents = a.info.get("content") or ""
    subj = a.info.get("subject") or ""
    texts = [contents, subj]
    dims = [d for t in texts for d in find_dimensions(t)]
    profs = [p for t in texts for p in find_profiles(t)]
    return {
        "subtype": a.type[1],
        "keys": keys,
        "has_contents": bool(contents.strip()),
        "has_subject": bool(subj.strip()),
        "has_color": "C" in keys,
        "has_created": "CreationDate" in keys,
        "has_layer": "OC" in keys,
        "has_measure": "Measure" in keys or "Measurement" in keys,
        "has_custom": "BSIColumnData" in keys,
        "n_vertices": len(a.vertices or []) if a.vertices else 0,
        "text_has_length": bool(dims),
        "text_has_profile": bool(profs),
        "profile_in_contents": bool(find_profiles(contents)),
        "profile_in_subject": bool(find_profiles(subj)),
    }


def study_file(path) -> dict:
    out: dict = {
        "pages": 0,
        "annots": 0,
        "by_subtype": collections.Counter(),
        "per_page_max": 0,
        "fields": collections.defaultdict(collections.Counter),
        "keys": collections.Counter(),
        "unknown_keys": 0,
    }
    with pymupdf.open(path) as doc:
        out["pages"] = len(doc)
        for page in doc:
            n = 0
            for a in page.annots() or []:
                n += 1
                i = annot_info(doc, a)
                st = i["subtype"]
                out["by_subtype"][st] += 1
                f = out["fields"][st]
                f["n"] += 1
                for k in (
                    "has_contents",
                    "has_subject",
                    "has_color",
                    "has_created",
                    "has_layer",
                    "has_measure",
                    "has_custom",
                    "text_has_length",
                    "text_has_profile",
                    "profile_in_contents",
                    "profile_in_subject",
                ):
                    f[k] += int(i[k])
                if i["n_vertices"] >= 2:
                    f["vertices>=2"] += 1
                for k in i["keys"]:
                    if k in KNOWN_KEYS:
                        out["keys"][k] += 1
                    else:
                        out["unknown_keys"] += 1
            out["annots"] += n
            out["per_page_max"] = max(out["per_page_max"], n)
    return out


def main(argv: list[str]) -> None:
    files = (
        [TAKEOFFS / a for a in argv] if argv else [p for p in takeoff_files() if p.suffix == ".pdf"]
    )
    allres = {}
    for p in files:
        r = study_file(p)
        allres[p.name] = {
            k: (
                dict(v)
                if isinstance(v, collections.Counter)
                else {a: dict(b) for a, b in v.items()}
                if k == "fields"
                else v
            )
            for k, v in r.items()
        }
        print(
            f"{p.name}: {r['pages']} pages, {r['annots']} annotations (max {r['per_page_max']} on a page), subtypes {dict(r['by_subtype'])}"
        )
    (TAKEOFFS / "structure.json").write_text(json.dumps(allres, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
