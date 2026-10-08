"""Run the deterministic parsers over a text item and return JSON-friendly results.

Line items carry profiles, dimensions, elevation notes and scales; word items carry mark
candidates and sheet numbers. A mark candidate is never a member claim.
"""

from typing import Any

from src.pdf_scan.scale import find_scales_in_line
from src.text_layer.parsers.dimension import find_dimensions
from src.text_layer.parsers.elevation import find_elevations
from src.text_layer.parsers.marks import find_mark_candidates
from src.text_layer.parsers.profile import CatalogMatcher, find_profiles
from src.text_layer.parsers.sheet import find_sheet_numbers

Catalog = CatalogMatcher


def annotate_line(text: str, catalog: Catalog | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in find_profiles(text):
        entry = p.to_json()
        entry["validation"] = (catalog or CatalogMatcher(None)).validate(p).to_json()
        out.append(entry)
    scales = [
        {"kind": "scale", "raw": s.raw, "scale_kind": s.kind, "ratio": s.ratio}
        for s in find_scales_in_line(text)
    ]
    elevations = [e.to_json() for e in find_elevations(text)]
    # A dimension that is the value of an elevation note or part of a scale is reported there only.
    covered = [str(x["raw"]) for x in (*scales, *elevations)]
    for d in find_dimensions(text):
        if not any(d.raw in c for c in covered):
            out.append(d.to_json())
    out.extend(elevations)
    out.extend(scales)
    return out


def annotate_word(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [s.to_json() for s in find_sheet_numbers(text)]
    out.extend(m.to_json() for m in find_mark_candidates(text))
    return out
