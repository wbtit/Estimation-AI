"""OCR majority-vote label proposals over a whole PDF (private, optional).

Needs the optional OCR package. Lines that overlap the ground-truth file never vote. Only proposes:
labels are confirmed by the owner through the CSV import.
"""

from collections import Counter
from pathlib import Path
from typing import Any

import psycopg
import pymupdf

from src.text_reader.glyph_admin import apply_votes
from src.text_reader.library import Entry, Matcher, load_entries
from src.text_reader.lines import assemble
from src.text_reader.ocr import OcrEngine, collect_votes
from src.text_reader.reader import resolve_clusters
from src.text_reader.strokes import extract_clusters

_UPSERT = (
    "INSERT INTO glyph_library (font_id, signature_hash, strokes, seen_count)"
    " VALUES (%s, %s, %s, %s)"
    " ON CONFLICT (font_id, signature_hash)"
    " DO UPDATE SET seen_count = glyph_library.seen_count + EXCLUDED.seen_count"
)


def vote_pdf(
    conn: psycopg.Connection,
    pdf_path: Path,
    font_id: str,
    engine: OcrEngine,
    exclude: dict[int, list[tuple]] | None = None,
) -> dict[str, Any]:
    from psycopg.types.json import Jsonb

    entries = load_entries(conn, font_id)
    matcher = Matcher(entries)
    by_hash: dict[str, Entry] = {e.signature_hash: e for e in entries}
    usage: Counter = Counter()
    votes: dict[str, Counter] = {}
    totals: Counter = Counter()
    with pymupdf.open(pdf_path) as doc:
        for i, page in enumerate(doc):
            clusters = extract_clusters(page)
            entry_of = resolve_clusters(clusters, matcher, font_id, usage, by_hash, Counter())
            hlines, _, _ = assemble(clusters)
            page_votes, st = collect_votes(
                page, hlines, lambda c, m=entry_of: m.get(id(c)), engine, (exclude or {}).get(i + 1)
            )
            for h, counter in page_votes.items():
                votes.setdefault(h, Counter()).update(counter)
            totals.update(st)
    with conn.cursor() as cur:
        for h, n in sorted(usage.items()):
            strokes = Jsonb([[list(p) for p in s] for s in by_hash[h].strokes])
            cur.execute(_UPSERT, (font_id, h, strokes, n))
    conn.commit()
    changed = apply_votes(conn, font_id, votes)
    return {**{k: int(v) for k, v in totals.items()}, "glyph_groups_with_votes": changed}
