"""Shared helpers: paths, drawing-document list, text fingerprints. Read-only.

The loaders return DEV jobs only; the locked held-out TEST jobs (measure/jobs.py) only with
`include_test=True` (a command line: --include-test --prereg <document>)."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import pymupdf

from measure.jobs import is_locked, test_jobs

ROOT = Path(__file__).resolve().parents[3]
PRIVATE = ROOT / "fixtures" / "private"
TAKEOFFS = PRIVATE / "takeoffs"


def drawing_documents(include_test: bool = False) -> dict[str, Path]:
    """job id -> PDF path of the unique drawing documents (kept ones plus job-001); DEV jobs only
    unless `include_test`."""
    locked = None if include_test else test_jobs()
    out: dict[str, Path] = {}
    home = Path.home() / "Downloads"
    for raw in csv.DictReader(open(PRIVATE / "inventory_map.csv")):
        r = {k.strip(): (v or "").strip() for k, v in raw.items()}  # the file is column-padded
        if r["status"] != "kept" or (locked and is_locked(r["id"], locked)):
            continue
        for base in (home, PRIVATE):
            p = base / r["relative_path"]
            if p.exists():
                out[r["id"]] = p
                break
        else:
            hits = sorted(home.glob("**/" + Path(r["relative_path"]).name))
            hits = [
                h
                for h in hits
                if "takeoff" not in h.name.lower() and not str(h).startswith(str(TAKEOFFS))
            ]
            if hits:
                out[r["id"]] = hits[0]
    if (PRIVATE / "job-001.pdf").exists():
        out["job-001"] = PRIVATE / "job-001.pdf"
    return dict(sorted(out.items()))


def takeoff_files(include_test: bool = False) -> list[Path]:
    """The estimators' takeoff files; DEV jobs only unless `include_test`."""
    locked = None if include_test else test_jobs()
    return sorted(
        p
        for p in TAKEOFFS.glob("takeoff-*")
        if p.suffix.lower() in {".pdf", ".xlsx", ".csv", ".xml"}
        and not (locked and is_locked(p.name, locked))
    )


PAGE_MAP_INDEX = "index"  # same page count: page N -> page N
PAGE_MAP_TEXT_HASH = "text_hash"  # different page counts: the stored content match


def takeoff_inventory(include_test: bool = False) -> dict[str, dict]:
    """takeoffs/inventory.json (takeoff file -> match, page_map, ...); without the entries of the
    locked jobs (by file name or by match) unless `include_test`. `page_map` is the effective map
    (`effective_page_map`)."""
    inv = json.loads((TAKEOFFS / "inventory.json").read_text())
    if not include_test:
        locked = test_jobs()
        inv = {
            n: i
            for n, i in inv.items()
            if not is_locked(n, locked) and not (i.get("match") and is_locked(i["match"], locked))
        }
    return {n: with_page_map(i) for n, i in inv.items()}


def effective_page_map(info: dict) -> tuple[dict[str, int], str]:
    """(markup page -> drawing page, rule). A markup with the same page count as its drawing maps
    page N to page N (every page, also those without text, and near-identical sheets stay apart);
    only when the counts differ is the stored text-hash map used (Phase 13a)."""
    if info.get("match") and info.get("same_page_count") and info.get("pages"):
        return {str(k): k for k in range(int(info["pages"]))}, PAGE_MAP_INDEX
    return dict(info.get("page_map") or {}), PAGE_MAP_TEXT_HASH


def with_page_map(info: dict) -> dict:
    """The entry with its effective `page_map` (the stored one is kept as `page_map_text_hash`)."""
    pm, rule = effective_page_map(info)
    return {
        **info,
        "page_map": pm,
        "page_map_rule": rule,
        "page_map_text_hash": info.get("page_map"),
    }


def page_words(page: pymupdf.Page) -> list[str]:
    """Words of the text layer WITHOUT annotations (annotations are removed from the in-memory page only)."""
    try:
        a = page.first_annot
        while a:
            a = page.delete_annot(a)
    except Exception:  # noqa: BLE001 - a page whose annotations cannot be removed is hashed with them
        pass
    return sorted(w[4] for w in page.get_text("words"))


def page_hash(page: pymupdf.Page) -> str | None:
    """Hash of the sorted words of the text layer of a page; None for a page without text."""
    words = page_words(page)
    if len(words) < 5:
        return None
    return hashlib.sha1("\n".join(words).encode()).hexdigest()


def page_signature(page: pymupdf.Page) -> frozenset[str] | None:
    words = page_words(page)
    return frozenset(words) if len(words) >= 5 else None


def fingerprint(path: Path) -> dict:
    with pymupdf.open(path) as doc:
        sizes = [(round(p.rect.width), round(p.rect.height)) for p in doc]
        sigs = [page_signature(p) for p in doc]
    hashes = [
        hashlib.sha1("\n".join(sorted(s_)).encode()).hexdigest() if s_ else None for s_ in sigs
    ]
    return {"pages": len(sizes), "sizes": sizes, "hashes": hashes, "sigs": sigs}
