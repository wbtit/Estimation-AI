"""STEP 4a: extract profile labels on the plan pages, sample with a fixed seed, split DESIGN/VALIDATION.

Registered in docs/PHASE4E_PREREGISTRATION.md: up to 40 labels per document,
`random.Random(4000 + job number).sample` over labels sorted by (page, y0, x0); the split is
`random.Random(seed + 500)` shuffling the sample, first half DESIGN. Writes labels_sample.json and
split.json to fixtures/private/study/ BEFORE any gold link exists. stdout: counts only.
"""

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
import labels  # noqa: E402

N_PER_DOC = 40


def main() -> None:
    sel = json.loads((common.STUDY / "selection.json").read_text())
    out: dict[str, dict] = {}
    split: dict[str, str] = {}
    for job in sel["documents"]:
        pool, excl = [], {"note_line": 0, "title_strip": 0}
        for page in sel["selection"][job]["plan_pages"]:
            lab, ex = labels.page_labels(job, page)
            pool += lab
            for k, v in ex.items():
                excl[k] += v
        pool.sort(key=lambda d: (d["page"], d["bbox"][1], d["bbox"][0]))
        for k, d in enumerate(pool):
            d["label_id"] = f"{job}-p{d['page']}-{k:03d}"
        seed = 4000 + int(job.split("-")[1])
        sample = random.Random(seed).sample(pool, min(N_PER_DOC, len(pool)))
        sample.sort(key=lambda d: d["label_id"])
        shuffled = list(sample)
        random.Random(seed + 500).shuffle(shuffled)
        half = len(shuffled) // 2
        for i, d in enumerate(shuffled):
            d["split"] = "design" if i < half else "validation"
            split[d["label_id"]] = d["split"]
        out[job] = {"seed": seed, "pool": len(pool), "excluded": excl, "sample": sample}
        print(job, "labels", len(pool), "sampled", len(sample), "design", half,
              "validation", len(sample) - half, "excluded", excl)  # fmt: skip
    (common.STUDY / "labels_sample.json").write_text(json.dumps(out, indent=1))
    (common.STUDY / "split.json").write_text(json.dumps(split, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
