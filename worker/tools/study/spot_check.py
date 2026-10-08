"""Write the 10% human spot-check list of the AI-annotated gold links (fixed seed 4999).

Columns: label_id, job, page, split, ai_gold, ai_class, ai_certainty, overlay (path), human_gold
(blank, for the owner), human_agrees (blank). Also validates every gold file (keys, allowed codes).
"""

import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402

CODES = {"1", "2", "3", "4", "5", "6", "none", "group", "missing", "not_member_label"}
CLASSES = {"on_line", "above_or_below", "rotated_parallel", "leader", "other"}


def main() -> None:
    sample = json.loads((common.STUDY / "labels_sample.json").read_text())
    split = json.loads((common.STUDY / "split.json").read_text())
    rows = []
    bad = 0
    for job, d in sample.items():
        gold = json.loads((common.doc_dir(job) / "gold.json").read_text())
        ids = {x["label_id"]: x for x in d["sample"]}
        assert set(gold) == set(ids), f"{job}: gold keys differ from the sample"
        for lid, g in gold.items():
            bad += str(g["gold"]) not in CODES or g.get("class") not in CLASSES
            rows.append({"label_id": lid, "job": job, "page": ids[lid]["page"], "split": split[lid],
                         "ai_gold": g["gold"], "ai_class": g.get("class"), "ai_certainty": g.get("certainty"),
                         "overlay": str(common.doc_dir(job) / "overlays" / f"{lid}.png"),
                         "human_gold": "", "human_agrees": ""})  # fmt: skip
    rows.sort(key=lambda r: r["label_id"])
    pick = random.Random(4999).sample(rows, round(0.10 * len(rows)))
    pick.sort(key=lambda r: r["label_id"])
    out = common.STUDY / "human_spot_check.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(pick)
    print("gold labels", len(rows), "invalid codes or classes", bad, "spot check rows", len(pick))
    from collections import Counter

    print(
        "gold codes:",
        dict(
            Counter(str(r["ai_gold"]) if not str(r["ai_gold"]).isdigit() else "line" for r in rows)
        ),
    )
    print("certainty:", dict(Counter(r["ai_certainty"] for r in rows)))


if __name__ == "__main__":
    main()
