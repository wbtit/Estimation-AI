"""Structure only of a spreadsheet: sheet count, rows, columns, and the generic header words of row 1.
No cell value below the header row is read or printed (a pricing-like file's values belong to a later phase)."""

from __future__ import annotations

import re
import sys
import zipfile
from xml.etree import ElementTree as ET

GENERIC = {
    "material",
    "size",
    "description",
    "qty",
    "quantity",
    "length",
    "weight",
    "total",
    "cost",
    "item",
    "mark",
    "type",
    "grade",
    "unit",
    "units",
    "price",
    "rate",
    "lbs/ft",
    "bill of material",
    "estimate",
    "list",
    "steel",
    "plate",
    "misc",
}
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def structure(path: str) -> dict:
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheets = [s.get("name") for s in wb.find("m:sheets", NS)]
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
        shared = [
            "".join(t.text or "" for t in si.iter("{%s}t" % NS["m"]))
            for si in sst.findall("m:si", NS)
        ]
    out = {"sheets": len(sheets), "per_sheet": []}
    names = [n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n)]
    for n in sorted(names):
        root = ET.fromstring(z.read(n))
        rows = root.findall(".//m:sheetData/m:row", NS)
        ncols = max((len(r.findall("m:c", NS)) for r in rows), default=0)
        header = []
        if rows:
            for c in rows[0].findall("m:c", NS):
                v = c.find("m:v", NS)
                if v is None:
                    continue
                txt = shared[int(v.text)] if c.get("t") == "s" else v.text
                header.append(txt)
        # only generic words are kept; any other header text (a title, a project name) is dropped here
        generic = sorted(
            {w for h in header for w in re.findall(r"[a-z/]+", h.lower()) if w in GENERIC}
        )
        out["per_sheet"].append(
            {
                "rows": len(rows),
                "columns": ncols,
                "header_cells": len(header),
                "header_words": generic,
            }
        )
    return out


if __name__ == "__main__":
    s = structure(sys.argv[1])
    print("sheets:", s["sheets"])
    for i, sh in enumerate(s["per_sheet"], 1):
        print(
            f"  sheet {i}: {sh['rows']} rows, {sh['columns']} columns, header row has {sh['header_cells']} cells"
        )
        print("   header words:", [w for w in sh["header_words"]][:20])
