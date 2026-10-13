"""Shared helpers: paths, drawing-document list, text fingerprints. Read-only."""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[3]
PRIVATE = ROOT / "fixtures" / "private"
TAKEOFFS = PRIVATE / "takeoffs"


def drawing_documents() -> dict[str, Path]:
    """job id -> PDF path of the unique drawing documents (kept ones plus job-001)."""
    out: dict[str, Path] = {}
    home = Path.home() / "Downloads"
    for raw in csv.DictReader(open(PRIVATE / "inventory_map.csv")):
        r = {k.strip(): (v or "").strip() for k, v in raw.items()}  # the file is column-padded
        if r["status"] != "kept":
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


def takeoff_files() -> list[Path]:
    return sorted(
        p
        for p in TAKEOFFS.glob("takeoff-*")
        if p.suffix.lower() in {".pdf", ".xlsx", ".csv", ".xml"}
    )


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
