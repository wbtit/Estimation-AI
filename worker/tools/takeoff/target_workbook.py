"""Phase 5u W1: aggregates of the estimator's finished takeoff workbook (main-steel sheet only).

Reads ONLY the cells of the ten registered columns of the sheet whose header row has them; no other sheet and no other
column is read. Nothing from the workbook except generic codes (shape family, grade) and counts is printed or stored in git.
The row data goes to the git-ignored fixtures/private/target/rows.json for the later steps.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m tools.takeoff.target_workbook [workbook.xlsx]
"""

from __future__ import annotations

import collections
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from src.text_layer.parsers.profile import find_profiles
from tools.takeoff.common import PRIVATE, TAKEOFFS

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
HEADER_WORDS = {
    "ref": "reference dwg",
    "qty": "quantity",
    "shape": "shape",
    "size": "size",
    "name": "name",
    "len_ft": "length (ft",
    "len_in": "length (in",
    "unit_w": "unit w",
    "total_w": "total w",
    "grade": "grade",
}
SECTION_WORDS = {
    "beams": ("beam",),
    "columns": ("column",),
    "braces": ("brace", "bracing"),
    "joists": ("joist",),
    "misc": ("misc",),
}


def _col(ref: str) -> str:
    return re.match(r"[A-Z]+", ref).group(0)


def read_main_sheet(path: Path, sheet_no: int | None = 1) -> dict:
    z = zipfile.ZipFile(path)
    sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
    shared = ["".join(t.text or "" for t in si.iter(M + "t")) for si in sst.findall(M + "si")]
    sheets = [n for n in sorted(z.namelist()) if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)]
    # find the sheet that has the registered header words in its first 25 rows (booleans only)
    chosen = None
    for n in sheets if sheet_no is None else [f"xl/worksheets/sheet{sheet_no}.xml"]:
        root = ET.fromstring(z.read(n))
        rows = root.findall(".//" + M + "row")
        cols: dict[str, str] = {}
        hdr_row = None
        for r in rows[:25]:
            hits: dict[str, str] = {}
            for c in r.findall(M + "c"):
                v = c.find(M + "v")
                if v is None:
                    continue
                t = str(shared[int(v.text)] if c.get("t") == "s" else v.text).lower()
                for k, w in HEADER_WORDS.items():
                    if w in t and k not in hits:
                        hits[k] = _col(c.get("r"))
            if len(hits) > len(cols):
                cols, hdr_row = hits, int(r.get("r"))
        if len(cols) == len(HEADER_WORDS):
            chosen = (n, rows, cols, hdr_row)
            break
    if chosen is None:
        raise SystemExit("no sheet has all registered header words")
    n, rows, cols, hdr_row = chosen
    by_col = {v: k for k, v in cols.items()}
    out_rows = []
    for r in rows:
        rn = int(r.get("r"))
        if rn <= hdr_row:
            continue
        rec: dict = {"row": rn}
        for c in r.findall(M + "c"):
            k = by_col.get(_col(c.get("r")))
            if not k:
                continue
            v = c.find(M + "v")
            if v is None:
                continue
            rec[k] = shared[int(v.text)] if c.get("t") == "s" else v.text
        out_rows.append(rec)
    return {"sheet": n, "cols": cols, "header_row": hdr_row, "rows": out_rows}


def num(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def band(v: float | None, edges: list[float], labels: list[str]) -> str:
    if v is None:
        return "missing"
    for e, lab in zip(edges, labels, strict=False):
        if v < e:
            return lab
    return labels[-1]


def norm_ref(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def classify_name(s: str | None) -> str:
    t = (s or "").strip()
    if not t:
        return "empty"
    if find_profiles(t):
        return "profile-like"
    if re.fullmatch(r"[0-9]+", t):
        return "digits only"
    if re.fullmatch(r"[A-Za-z]+[-.]?[0-9]+[A-Za-z]?", t):
        return "letters+digits"
    return "other"


def study(path: Path) -> dict:
    d = read_main_sheet(
        path
    )  # sheet 1: the only sheet that was identified as the main-steel sheet; others are never opened
    rows = d["rows"]
    data = [r for r in rows if num(r.get("qty")) is not None]
    labels = [
        r
        for r in rows
        if num(r.get("qty")) is None and any(k in r for k in ("ref", "name", "size", "shape"))
    ]
    res: dict = {
        "sheet_rows_total": len(rows),
        "header_words_present": sorted(d["cols"]),
        "data_rows": len(data),
        "label_rows": len(labels),
    }
    # sections by keyword on label rows (label text is used in memory only)
    sec = collections.Counter()
    for r in labels:
        txt = " ".join(str(r.get(k, "")) for k in ("ref", "name", "size", "shape")).lower()
        hit = [s for s, kws in SECTION_WORDS.items() if any(k in txt for k in kws)]
        sec[hit[0] if hit else "other"] += 1
    res["label_rows_by_class"] = dict(sec)
    # rows by SHAPE family code
    res["shape_codes"] = dict(
        collections.Counter((r.get("shape") or "empty").strip() for r in data)
    )
    refs = {norm_ref(str(r["ref"])) for r in data if r.get("ref")}
    res["distinct_refs"] = len(refs)
    res["name_classes"] = dict(collections.Counter(classify_name(r.get("name")) for r in data))
    res["qty_bands"] = dict(
        collections.Counter(
            band(num(r.get("qty")), [2, 5, 10, 25, 1e18], ["1", "2-4", "5-9", "10-24", "25+"])
            for r in data
        )
    )
    tot = []
    for r in data:
        ft, inch = num(r.get("len_ft")), num(r.get("len_in"))
        tot.append(None if ft is None and inch is None else (ft or 0.0) + (inch or 0.0) / 12)
    res["length_bands_ft"] = dict(
        collections.Counter(
            band(v, [5, 10, 20, 40, 1e18], ["<5", "5-10", "10-20", "20-40", "40+"]) for v in tot
        )
    )
    res["share_with_unit_w"] = round(
        sum(num(r.get("unit_w")) is not None for r in data) / max(1, len(data)), 3
    )
    res["grades"] = dict(collections.Counter((r.get("grade") or "empty").strip() for r in data))
    ok = bad = nc = 0
    for r, L in zip(data, tot, strict=True):
        q, u, t = num(r.get("qty")), num(r.get("unit_w")), num(r.get("total_w"))
        if None in (q, u, t, L):
            nc += 1
        elif t and abs(t - q * L * u) / t <= 0.01:
            ok += 1
        else:
            bad += 1
    res["total_w_check"] = {"within_1pct": ok, "beyond": bad, "not_checkable": nc}
    # grouping: how unique are Size, Name, Name+Size among data rows
    n = max(1, len(data))
    res["unique_share"] = {
        k: round(len({r.get(k) for r in data}) / n, 3) for k in ("size", "name", "ref")
    }
    res["unique_share"]["name+size"] = round(
        len({(r.get("name"), r.get("size")) for r in data}) / n, 3
    )
    res["rows_with_name"] = sum(bool(r.get("name")) for r in data)
    outdir = PRIVATE / "target"
    outdir.mkdir(exist_ok=True)
    (outdir / "rows.json").write_text(json.dumps({"cols": d["cols"], "rows": rows}))
    return res


if __name__ == "__main__":
    p = Path(sys.argv[1]) if len(sys.argv) > 1 else TAKEOFFS / "takeoff-22.xlsx"
    print(json.dumps(study(p), indent=1))
