"""Move byte-identical PDFs out of the way (never delete), flag near-duplicates, list what is left.

    worker/.venv/bin/python -I worker/tools/dedupe_inputs.py \
        --item set-A=/path/a --item set-B=/path/b \
        --map fixtures/private/inventory_map.csv --inventory fixtures/private/inventory.csv \
        --prefer-dir fixtures/private --moved-to /path/_duplicates_removed_YYYYMMDD \
        --estimator-csv /path/unique_files_for_estimators.csv [--dry-run]

Byte-identical files (same sha256) form a group; ONE is kept: a copy that also lives in
--prefer-dir if there is one (then every file of the group in the item folders is moved), else the
first by full path. The others are MOVED into --moved-to with their folder structure; nothing is
deleted and the preferred directory is never modified. Files that the inventory describes with the
same signature but whose bytes differ are NOT moved: they are listed as near-duplicates.

stdout shows counts only. Real file names are written only to the estimator CSV (and the private
map, which already holds them). Only .pdf files are considered.
"""

import argparse
import csv
import hashlib
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import pymupdf

SIGNATURE_FIELDS = (
    "pages", "page_size_class", "text_pages", "median_chars_per_page", "circles",
    "labelled_circles", "exploded_dash_segments", "ocg_layers", "producer_category",
)  # fmt: skip
ESTIMATOR_FIELDS = [
    "job_id", "folder", "file_name", "pages", "size_mb", "producer_category", "duplicates_of",
    "near_duplicate_of", "takeoff_file", "pricing_file", "notes",
]  # fmt: skip


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def producer_category(meta: dict) -> str:
    text = f"{meta.get('producer') or ''} {meta.get('creator') or ''}".lower()
    if not text.strip():
        return "unknown"
    if "autocad" in text or "autodesk" in text or "dwg" in text:
        return "AutoCAD"
    if "bluebeam" in text:
        return "Bluebeam"
    return "other"


def plan(
    entries: list[dict], preferred: dict[str, str]
) -> tuple[dict[str, dict], dict[str, list[str]]]:
    """entries: {id, path (Path), sha}. preferred: sha -> id of a preferred external copy.

    Returns (status per id: {"status", "duplicate_of_job"}, groups per kept key: [moved ids]).
    """
    by_hash: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_hash[e["sha"]].append(e)
    status: dict[str, dict] = {}
    moved_of: dict[str, list[str]] = {}
    for digest, group in by_hash.items():
        group.sort(key=lambda e: str(e["path"]))
        if digest in preferred:
            keeper_id = preferred[digest]
            movers = group
        else:
            keeper_id = group[0]["id"]
            status[keeper_id] = {"status": "kept", "duplicate_of_job": ""}
            movers = group[1:]
        for e in movers:
            status[e["id"]] = {"status": "moved", "duplicate_of_job": keeper_id}
        if movers:
            moved_of[keeper_id] = [e["id"] for e in movers]
    return status, moved_of


def near_duplicates(kept_ids: list[str], inventory: dict[str, dict]) -> dict[str, list[str]]:
    """Kept files with the same inventory signature (different bytes): id -> the other ids."""
    groups: dict[tuple, list[str]] = defaultdict(list)
    for i in kept_ids:
        row = inventory.get(i)
        if row and not row.get("error"):
            groups[tuple(row[f] for f in SIGNATURE_FIELDS)].append(i)
    out: dict[str, list[str]] = {}
    for ids in groups.values():
        if len(ids) > 1:
            for i in ids:
                out[i] = [j for j in ids if j != i]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--item", action="append", required=True)
    ap.add_argument("--map", type=Path, required=True)
    ap.add_argument("--inventory", type=Path, required=True)
    ap.add_argument("--prefer-dir", type=Path, required=True)
    ap.add_argument("--moved-to", type=Path, required=True)
    ap.add_argument("--estimator-csv", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    roots = {s.split("=", 1)[0]: Path(s.split("=", 1)[1]) for s in args.item}
    with args.map.open(newline="", encoding="utf-8") as fh:
        map_rows = list(csv.DictReader(fh))
    with args.inventory.open(newline="", encoding="utf-8") as fh:
        inventory = {r["id"]: r for r in csv.DictReader(fh)}

    entries = []
    for r in map_rows:
        p = roots[r["item"]] / r["relative_path"]
        entries.append({"id": r["id"], "path": p, "sha": sha256(p), "row": r})
    preferred: dict[str, str] = {}
    external: dict[str, Path] = {}
    for p in sorted(args.prefer_dir.glob("*.pdf")):
        preferred[sha256(p)] = p.stem
        external[p.stem] = p

    status, moved_of = plan(entries, preferred)
    kept_ids = [i for i, s in status.items() if s["status"] == "kept"]
    near = near_duplicates(kept_ids, inventory)
    for i in near:
        status[i]["status"] = "near-duplicate"

    counts = defaultdict(int)
    for s in status.values():
        counts[s["status"]] += 1
    print(
        f"files: {len(entries)}  kept: {counts['kept']}  moved: {counts['moved']}  "
        f"near-duplicate: {counts['near-duplicate']}  duplicate groups: {len(moved_of)}  "
        f"groups kept outside the item folders: {sum(1 for k in moved_of if k in external)}"
    )
    print("near-duplicate job ids:", ", ".join(sorted(near)) or "none")
    if args.dry_run:
        return 0

    by_id = {e["id"]: e for e in entries}
    moved_to: dict[str, str] = {}
    for i, s in status.items():
        if s["status"] != "moved":
            continue
        e = by_id[i]
        dest = args.moved_to / e["row"]["relative_path"]
        if dest.exists():
            raise SystemExit(f"destination exists for {i}; nothing more was moved")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(e["path"]), str(dest))
        moved_to[i] = str(Path(e["row"]["relative_path"]))
    print(f"moved {len(moved_to)} files")

    # the map gets a status column; the original columns are unchanged
    fields = [*map_rows[0].keys(), "status", "duplicate_of_job", "moved_to"]
    for r in map_rows:
        s = status[r["id"]]
        r.update(
            status=s["status"],
            duplicate_of_job=s["duplicate_of_job"],
            moved_to=moved_to.get(r["id"], ""),
        )
    with args.map.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(map_rows)

    # one row per kept file (and per preferred external copy that stands for a moved group)
    rows = []
    for keeper_id in sorted(
        set(moved_of) | {i for i, s in status.items() if s["status"] != "moved"}
    ):
        if keeper_id in external:
            p = external[keeper_id]
            with pymupdf.open(p) as doc:
                pages, cat = doc.page_count, producer_category(doc.metadata or {})
            folder, name = str(p.parent), p.name
        else:
            e = by_id[keeper_id]
            inv = inventory.get(keeper_id, {})
            pages, cat = inv.get("pages", ""), inv.get("producer_category", "")
            rel = Path(e["row"]["relative_path"])
            folder, name = str(rel.parent), rel.name
            p = e["path"]
        moved_names = [
            Path(by_id[m]["row"]["relative_path"]).name for m in moved_of.get(keeper_id, [])
        ]
        near_names = [Path(by_id[j]["row"]["relative_path"]).name for j in near.get(keeper_id, [])]
        rows.append(
            {
                "job_id": keeper_id, "folder": folder, "file_name": name, "pages": pages,
                "size_mb": round(p.stat().st_size / 1e6, 2), "producer_category": cat,
                "duplicates_of": "; ".join(moved_names), "near_duplicate_of": "; ".join(near_names),
                "takeoff_file": "", "pricing_file": "", "notes": "",
            }
        )  # fmt: skip
    with args.estimator_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=ESTIMATOR_FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"estimator list rows: {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
