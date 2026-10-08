"""EXPLORATORY, post-hoc, not tuned and not part of the registered scoring.

For labels whose gold is `missing`: does a leader (from the label, through connected lines) end at a
small closed shape of column size (4-60 pt, aspect 0.6-1.67)? And is such a shape close to the label
(within 40 pt) even without a leader? Counts per document; used only to propose rule-set v1.
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import columns  # noqa: E402
import common  # noqa: E402
import leaders  # noqa: E402

SNAP = 6.0
MAX_LEN = 250.0
NEAR_PT = 40.0


def main() -> None:
    sample = json.loads((common.STUDY / "labels_sample.json").read_text())
    out: dict[str, dict] = {}
    for job, d in sample.items():
        gold = json.loads((common.doc_dir(job) / "gold.json").read_text())
        acc: Counter = Counter()
        pages: dict[int, tuple] = {}
        for lab in d["sample"]:
            g = gold[lab["label_id"]]["gold"]
            if g != "missing":
                continue
            acc["gold_missing"] += 1
            p = lab["page"]
            if p not in pages:
                shapes = columns.detect_shapes(job, p)
                pseudo = []
                for k, s in enumerate(shapes, 1):
                    x0, y0, x1, y1 = s["bbox"]
                    for a, b in (
                        ((x0, y0), (x1, y0)),
                        ((x1, y0), (x1, y1)),
                        ((x1, y1), (x0, y1)),
                        ((x0, y1), (x0, y0)),
                    ):
                        pseudo.append({"cand": k, "p": list(a), "q": list(b)})
                pages[p] = (shapes, pseudo, leaders.PageIndex(job, p))
            shapes, pseudo, idx = pages[p]
            if not shapes:
                acc["no_shapes_on_page"] += 1
                continue
            hit = leaders.find_leader_target(idx, lab["bbox"], pseudo, SNAP, MAX_LEN)
            acc["leader_ends_at_column_like_shape"] += hit is not None
            bx0, by0, bx1, by1 = lab["bbox"]
            near = any(
                max(s["bbox"][0] - bx1, bx0 - s["bbox"][2], 0) ** 2
                + max(s["bbox"][1] - by1, by0 - s["bbox"][3], 0) ** 2
                <= NEAR_PT**2
                for s in shapes
            )
            acc["column_like_shape_within_40pt"] += near
        out[job] = dict(acc)
        print(job, dict(acc))
    (common.STUDY / "exploratory_columns.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
