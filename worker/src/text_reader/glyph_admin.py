"""Glyph library administration: contact sheets for review, CSV round trip, OCR vote application.

Only a person confirms labels (status `confirmed` needs a reviewer). OCR votes add a proposed label
and counts, nothing more.
"""

import csv
import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.text_reader.ocr import proposed_label

CSV_FIELDS = [
    "font_id",
    "signature_hash",
    "status",
    "label",
    "proposed_label",
    "votes",
    "seen_count",
    "note",
]
STATUSES = ("proposed", "confirmed")


def _votes_text(votes: dict) -> str:
    return "|".join(f"{ch}:{n}" for ch, n in sorted(votes.items(), key=lambda kv: (-kv[1], kv[0])))


def vote_purity(votes: dict) -> float | None:
    total = sum(votes.values())
    return max(votes.values()) / total if total else None


# --- contact sheets ----------------------------------------------------------------------------
def contact_sheets(
    conn: psycopg.Connection,
    font_id: str,
    out_dir: Path,
    per_sheet: int = 48,
    limit: int | None = None,
    show_guess: bool = True,
    dpi: int = 100,
) -> list[Path]:
    """PNG sheets of the glyph groups that have no confirmed label, most frequent first."""
    rows = conn.execute(
        "SELECT signature_hash, strokes, proposed_label, votes, seen_count FROM glyph_library"
        " WHERE font_id = %s AND status <> 'confirmed' ORDER BY seen_count DESC, signature_hash"
        + (" LIMIT %s" if limit else ""),
        (font_id, limit) if limit else (font_id,),
    ).fetchall()
    out_dir.mkdir(parents=True, exist_ok=True)
    cols, tile_w, tile_h = 8, 110, 120
    rows_per = -(-per_sheet // cols)
    paths: list[Path] = []
    for sheet_no, start in enumerate(range(0, len(rows), per_sheet), 1):
        doc = pymupdf.open()
        page = doc.new_page(width=cols * tile_w, height=rows_per * tile_h)
        for k, r in enumerate(rows[start : start + per_sheet]):
            ox, oy = (k % cols) * tile_w, (k // cols) * tile_h
            page.draw_rect(
                pymupdf.Rect(ox + 1, oy + 1, ox + tile_w - 1, oy + tile_h - 1),
                color=(0.8, 0.8, 0.8),
                width=0.5,
            )
            box = 70.0
            for stroke in r["strokes"]:
                pts = [pymupdf.Point(ox + 20 + x * box, oy + 12 + y * box) for x, y in stroke]
                if len(pts) == 1:
                    pts = [pts[0], pts[0] + (0.1, 0)]
                page.draw_polyline(pts, color=(0, 0, 0), width=1.4)
            purity = vote_purity(r["votes"])
            page.insert_text(
                (ox + 4, oy + 95),
                f"#{start + k + 1} {r['signature_hash'][:8]} n={r['seen_count']}",
                fontsize=7,
            )
            guess = (
                f"ocr: {r['proposed_label']} {purity:.0%}"
                if r["proposed_label"] and purity
                else "ocr: -"
            )
            if show_guess:
                page.insert_text((ox + 4, oy + 106), guess, fontsize=7, color=(0.7, 0, 0))
        path = out_dir / f"unlabeled_{font_id}_{sheet_no:03d}.png"
        page.get_pixmap(dpi=dpi, alpha=False).save(str(path))
        doc.close()
        paths.append(path)
    return paths


# --- CSV round trip ----------------------------------------------------------------------------
def export_csv(
    conn: psycopg.Connection, font_id: str, path: Path, only_unconfirmed: bool = True
) -> int:
    rows = conn.execute(
        "SELECT signature_hash, status, label, proposed_label, votes, seen_count FROM glyph_library"
        " WHERE font_id = %s" + (" AND status <> 'confirmed'" if only_unconfirmed else "") +
        " ORDER BY seen_count DESC, signature_hash",
        (font_id,),
    ).fetchall()  # fmt: skip
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "font_id": font_id,
                    "signature_hash": r["signature_hash"],
                    "status": r["status"],
                    "label": r["label"]
                    or r["proposed_label"]
                    or "",  # pre-filled with the OCR proposal
                    "proposed_label": r["proposed_label"] or "",
                    "votes": _votes_text(r["votes"]),
                    "seen_count": r["seen_count"],
                    "note": "",
                }
            )
    return len(rows)


@dataclass
class ImportResult:
    applied: int = 0
    unchanged: int = 0
    errors: list[str] = field(default_factory=list)


def import_csv(
    conn: psycopg.Connection, path: Path, reviewer: str, dry_run: bool = False
) -> ImportResult:
    """Apply label/status edits. All or nothing: any invalid row refuses the whole file."""
    result = ImportResult()
    if not reviewer.strip():
        result.errors.append("a reviewer name is required")
        return result
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = {"font_id", "signature_hash", "status", "label"} - set(reader.fieldnames or [])
        if missing:
            result.errors.append(f"missing columns: {', '.join(sorted(missing))}")
            return result
        rows = list(reader)
    seen: set[tuple[str, str]] = set()
    plan: list[tuple[str, str, str | None, str]] = []  # id, status, label, previous status
    for n, row in enumerate(rows, start=2):  # line 1 is the header
        key = (row["font_id"].strip(), row["signature_hash"].strip())
        label = (row["label"] or "").strip()
        status = (row["status"] or "").strip()
        if key in seen:
            result.errors.append(f"line {n}: duplicate row for {key[1][:12]}")
            continue
        seen.add(key)
        if status not in STATUSES:
            result.errors.append(f"line {n}: status must be one of {STATUSES}, got {status!r}")
            continue
        if status == "confirmed" and not 1 <= len(label) <= 3:
            result.errors.append(f"line {n}: a confirmed label must be 1 to 3 characters")
            continue
        if label and len(label) > 3:
            result.errors.append(f"line {n}: label longer than 3 characters")
            continue
        db = conn.execute(
            "SELECT id, status, label FROM glyph_library"
            " WHERE font_id = %s AND signature_hash = %s",
            key,
        ).fetchone()
        if db is None:
            result.errors.append(f"line {n}: no glyph {key[1][:12]} in font {key[0]!r}")
            continue
        if db["status"] == status and (db["label"] or "") == label:
            result.unchanged += 1
            continue
        plan.append((str(db["id"]), status, label or None, db["status"]))
    if result.errors:
        return result
    if dry_run:
        result.applied = len(plan)  # how many rows a real import would change
        return result
    with conn.cursor() as cur:
        for gid, status, label, _ in plan:
            cur.execute(
                "UPDATE glyph_library SET label = %s, status = %s, source = 'csv_import',"
                " reviewed_by = %s, reviewed_at = NOW() WHERE id = %s",
                (label, status, reviewer.strip(), gid),
            )
    conn.commit()
    result.applied = len(plan)
    return result


# --- OCR votes ---------------------------------------------------------------------------------
def apply_votes(conn: psycopg.Connection, font_id: str, votes: dict[str, Counter]) -> int:
    """Merge OCR votes into the library and set the proposed label. Never confirms or relabels."""
    changed = 0
    with conn.cursor() as cur:
        for h, counter in sorted(votes.items()):
            row = cur.execute(
                "SELECT id, votes, status, label FROM glyph_library"
                " WHERE font_id = %s AND signature_hash = %s",
                (font_id, h),
            ).fetchone()
            if row is None:
                continue
            merged = Counter({k: int(v) for k, v in row["votes"].items()})
            merged.update(counter)
            source = "csv_import" if row["status"] == "confirmed" or row["label"] else "ocr_vote"
            cur.execute(
                "UPDATE glyph_library SET votes = %s, proposed_label = %s,"
                " source = CASE WHEN status = 'confirmed' THEN source ELSE %s END WHERE id = %s",
                (Jsonb(dict(merged)), proposed_label(merged), source, row["id"]),
            )
            changed += 1
    conn.commit()
    return changed


def summarize(conn: psycopg.Connection, font_id: str) -> dict[str, int]:
    rows = conn.execute(
        "SELECT status, count(*) AS n, COALESCE(sum(seen_count), 0) AS seen FROM glyph_library"
        " WHERE font_id = %s GROUP BY status",
        (font_id,),
    ).fetchall()
    out = {f"{r['status']}_groups": int(r["n"]) for r in rows}
    out.update({f"{r['status']}_instances": int(r["seen"]) for r in rows})
    return out


def dump_json(obj: object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, default=str))


# --- revoking a reviewer's labels --------------------------------------------------------------
def revoke_labels(
    conn: psycopg.Connection, who: str, font_id: str | None = None, dry_run: bool = False
) -> int:
    """Un-confirm every label confirmed by `who`: back to proposed, label and review cleared.

    OCR votes and the proposed label are kept. Returns how many groups were (or would be) revoked.
    """
    if not who.strip():
        raise ValueError("who is required")
    where = "status = 'confirmed' AND reviewed_by = %s" + (" AND font_id = %s" if font_id else "")
    args: tuple = (who.strip(), font_id) if font_id else (who.strip(),)
    n = conn.execute(f"SELECT count(*) AS n FROM glyph_library WHERE {where}", args).fetchone()["n"]
    if not dry_run and n:
        conn.execute(
            "UPDATE glyph_library SET status = 'proposed', label = NULL, reviewed_by = NULL,"
            f" reviewed_at = NULL, source = 'ocr_vote' WHERE {where}",
            args,
        )
        conn.commit()
    return int(n)
