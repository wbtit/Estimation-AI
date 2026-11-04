"""Step 1: inventory of the takeoff copies and a content match to the drawing documents.

Counts only on stdout; the file-to-job map is written to the git-ignored private folder.
usage (from worker/): PYTHONPATH=. .venv/bin/python -m measure.takeoff.inventory

DEV jobs only: the entries of the locked held-out TEST jobs (measure/jobs.py) are never recomputed,
dropped or changed; they are copied over as they are (merge, not overwrite), and the run stops
before writing if one would differ. The three registers are backed up first.
"""

from __future__ import annotations

import collections
import datetime
import json
import shutil

import pymupdf

from measure.jobs import is_locked, test_jobs
from measure.takeoff.common import (
    PRIVATE,
    TAKEOFFS,
    drawing_documents,
    fingerprint,
    takeoff_files,
)

INVENTORY = TAKEOFFS / "inventory.json"
REGISTERS = (INVENTORY, TAKEOFFS / "PRIVATE_MAP.csv", PRIVATE / "inventory_map.csv")


def merge_inventory(dev: dict[str, dict], old: dict[str, dict], locked) -> dict[str, dict]:
    """The regenerated DEV entries plus every locked entry of `old` exactly as it was."""
    keep = {
        n: i
        for n, i in old.items()
        if is_locked(n, locked) or (i.get("match") and is_locked(i["match"], locked))
    }
    merged = {n: i for n, i in dev.items() if n not in keep}
    merged.update(keep)
    if any(merged.get(n) != i for n, i in keep.items()):
        raise SystemExit("a locked inventory entry would change; nothing written")
    return dict(sorted(merged.items()))


def backup_registers() -> None:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = PRIVATE / "backups" / f"registers-before-inventory-{stamp}"
    out.mkdir(parents=True)
    for f in REGISTERS:
        if f.exists():
            shutil.copy2(f, out / f.name)


def main() -> None:
    files = takeoff_files()
    kinds = collections.Counter(p.suffix.lower() for p in files)
    print(
        "takeoff items:",
        len(files),
        dict(kinds),
        "total MB",
        round(sum(p.stat().st_size for p in files) / 1e6),
    )
    draw = drawing_documents()
    print("drawing documents with a file:", len(draw))
    dfp = {j: fingerprint(p) for j, p in draw.items()}
    dsig = {j: f["sigs"] for j, f in dfp.items()}
    owner: dict[str, set[str]] = collections.defaultdict(set)
    for j, f in dfp.items():
        for h in f["hashes"]:
            if h:
                owner[h].add(j)
    mapping = {}
    for p in files:
        if p.suffix.lower() != ".pdf":
            continue
        f = fingerprint(p)
        with pymupdf.open(p) as d:
            annots = sum(1 for pg in d for _ in (pg.annots() or []))
            enc = d.is_encrypted
        votes: collections.Counter = collections.Counter()
        loose: collections.Counter = collections.Counter()
        hashed = 0
        for k, h in enumerate(f["hashes"]):
            if h:
                hashed += 1
                for j in owner.get(h, ()):
                    votes[j] += 1
                sig = f["sigs"][k]
                for j, dsigs in dsig.items():
                    for ds in dsigs:
                        if ds and len(sig & ds) / len(sig | ds) >= 0.9:
                            loose[j] += 1
                            break
        best = (loose or votes).most_common(1)[0] if (loose or votes) else None
        page_map: dict[str, int] = {}
        if (
            best and best[1] >= 3
        ):  # takeoff page index -> drawing page index (a content match of at least 3 pages)
            for k, sig in enumerate(f["sigs"]):
                if not sig:
                    continue
                for dk, ds in enumerate(dsig[best[0]]):
                    if ds and len(sig & ds) / len(sig | ds) >= 0.9:
                        page_map[str(k)] = dk
                        break
        mapping[p.name] = {
            "pages": f["pages"],
            "pages_with_text": hashed,
            "annotations": annots,
            "match": best[0] if best and best[1] >= 3 else None,
            "matched_pages": best[1] if best else 0,
            "same_page_count": bool(best and dfp[best[0]]["pages"] == f["pages"]),
            "same_page_sizes": bool(best and dfp[best[0]]["sizes"] == f["sizes"]),
            "all_votes": dict(votes),
            "loose_votes": dict(loose),
            "encrypted": enc,
            "page_map": page_map,
        }
        m = mapping[p.name]
        print(
            f"{p.name}: {f['pages']} pages ({hashed} with text), {annots} annotations, "
            f"match {m['match']} on {m['matched_pages']} pages (exact {votes.get(m['match'], 0)}), same page count {m['same_page_count']}, same sizes {m['same_page_sizes']}"
        )
    backup_registers()
    old = json.loads(INVENTORY.read_text()) if INVENTORY.exists() else {}
    locked = test_jobs()
    merged = merge_inventory(mapping, old, locked)
    INVENTORY.write_text(json.dumps(merged, indent=1))
    print("locked entries kept unchanged:", sum(is_locked(n, locked) for n in merged))
    jobs = collections.Counter(m["match"] for m in mapping.values() if m["match"])
    print("jobs with a takeoff:", dict(jobs))
    print("takeoff PDFs matching no job:", sum(1 for m in mapping.values() if not m["match"]))
    print("drawing jobs without a takeoff:", sorted(set(draw) - set(jobs)))


if __name__ == "__main__":
    main()
