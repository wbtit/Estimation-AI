"""Aggregate counts from the private inventory CSV. Prints counts only, never names.

worker/.venv/bin/python -I worker/tools/pdf_inventory_summary.py fixtures/private/inventory.csv
"""

import csv
import sys
from collections import Counter

COLUMNS = [
    "type_guess", "page_size_class", "text_layer", "outlined_text_likely", "raster_only",
    "producer_category", "layer_referenced", "dash_kind",
]  # fmt: skip


def main(path: str) -> int:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    print(f"PDFs: {len(rows)}  (unreadable: {sum(1 for r in rows if r['error'])})")
    for item in sorted({r["item"] for r in rows}):
        print(f"  {item}: {sum(1 for r in rows if r['item'] == item)}")
    ok = [r for r in rows if not r["error"]]
    for col in COLUMNS:
        counts = Counter(r[col] or "-" for r in ok)
        print(f"{col}: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    layered = [r for r in ok if r["ocg_layers"] not in ("", "0")]
    print(f"with optional-content layers: {len(layered)}")
    drawings = [r for r in ok if r["type_guess"] == "drawing set"]
    labelled = sum(1 for r in drawings if int(r["labelled_circles"] or 0) > 0)
    circles = sum(1 for r in drawings if int(r["circles"] or 0) > 0)
    repeats = sum(1 for r in ok if r["duplicate_of"])
    print(f"drawing sets: {len(drawings)}")
    print(f"  with labelled circles on sampled pages: {labelled}")
    print(f"  with circles of any kind: {circles}")
    print(f"files that repeat the content of an earlier file: {repeats}")
    print(f"total pages: {sum(int(r['pages']) for r in ok)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
