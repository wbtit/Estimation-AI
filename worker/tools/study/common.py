"""Shared helpers for the Phase 4e association study (research code, not production).

Paths: documents are found through the private map (`fixtures/private/inventory_map.csv`), which
holds the only copy of the id -> file name mapping. Study outputs go to `fixtures/private/study/`
(git-ignored). Nothing here prints file names or text content.
"""

import csv
import sys
from pathlib import Path

WORKER = Path(__file__).resolve().parents[2]
REPO = WORKER.parent
sys.path.insert(0, str(WORKER))

import pymupdf  # noqa: E402

PRIVATE = REPO / "fixtures" / "private"
STUDY = PRIVATE / "study"
ROOTS = {
    "set-A": Path("/home/gpuserver1/Downloads/SAMPLE-07-08-2026-20261007T131309Z-1-001"),
    "set-B": Path("/home/gpuserver1/Downloads/estimation drawing set -01-20261007T131310Z-1-001"),
}
LARGE_PT = 1000.0


def doc_rows() -> dict[str, dict]:
    with (PRIVATE / "inventory_map.csv").open(newline="", encoding="utf-8") as fh:
        return {r["id"]: r for r in csv.DictReader(fh)}


def inventory_rows() -> dict[str, dict]:
    with (PRIVATE / "inventory.csv").open(newline="", encoding="utf-8") as fh:
        return {r["id"]: r for r in csv.DictReader(fh)}


def pdf_path(job_id: str) -> Path:
    r = doc_rows()[job_id]
    return ROOTS[r["item"]] / r["relative_path"]


def open_doc(job_id: str) -> pymupdf.Document:
    return pymupdf.open(pdf_path(job_id))


def large_pages(doc: pymupdf.Document) -> list[int]:
    return [i for i, p in enumerate(doc) if max(p.rect.width, p.rect.height) >= LARGE_PT]


def doc_dir(job_id: str) -> Path:
    d = STUDY / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d
