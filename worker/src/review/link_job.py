"""The `link_view` job: propose members and links for one view of a sheet.

Payload: {"view_id": "<uuid>"}. Phase 6a (flags instead of gates): the scale and the line classes
of the view are used as they stand, confirmed or only guessed (an unconfirmed scale, or classes
that are only a suggestion, are flags the screen shows; no scale means no plan coordinates), and
the sheet must be in the takeoff: a person's decision, else by default from the page type. Steps:
reconstruct the page lines, tabulate
the stroke classes inside the view, take profile labels and legend-linked mark labels inside the
view, and propose for each the best of its nearest structural lines with the frozen Phase 4e rule.
Members are upserted by label key; a member a person has touched (reviewed, edited, or with any
edit row) is never changed. Logs counts only, never page text.
"""

import hashlib
import logging
import math
from collections import Counter
from typing import Any

import psycopg
import pymupdf
from psycopg.types.json import Jsonb

from src.config import WorkerConfig
from src.linking import RULE_VERSION
from src.linking.candidates import candidates_for
from src.linking.labels import Label, page_labels
from src.linking.lines import page_lines
from src.linking.rules import Proposal, propose
from src.linking.structural import class_table, lines_in_box
from src.queue import Job
from src.review.kinds import NEAR_RADIUS_PT, KindResult, detect_kind, joist_kind
from src.review.sheet_state import sheet_included

log = logging.getLogger("worker.link")

JOB_TYPE = "link_view"
MM_PER_PT = 25.4 / 72.0
TOP_N = 3
MAX_STORED_LINES = 6000  # click targets for the review screen
MIN_STORED_LINE_PT = 12.0


class LinkError(Exception):
    """A failure with a message that is safe to store (no page text)."""


def member_id_for(label_key: str) -> str:
    return "M-" + hashlib.sha1(label_key.encode()).hexdigest()[:12]


def plan_xy(
    box: tuple[float, float, float, float], ratio: float, x: float, y: float
) -> tuple[float, float]:
    """Plan frame of a view: origin lower-left of the box, x right, y up, millimetres."""
    k = MM_PER_PT * ratio
    return ((x - box[0]) * k, (box[3] - y) * k)


def candidates_json(proposal: Proposal) -> list[dict[str, Any]]:
    return [
        {
            "rank": i,
            "p": [round(r.candidate.line.x0, 2), round(r.candidate.line.y0, 2)],
            "q": [round(r.candidate.line.x1, 2), round(r.candidate.line.y1, 2)],
            "score": round(r.score, 2),
            "dist": round(r.candidate.dist, 2),
            "rel_angle": round(r.candidate.rel_angle, 1),
            "klass": r.candidate.line.klass,
        }
        for i, r in enumerate(proposal.ranked[:TOP_N], 1)
    ]


def _inside(
    box: tuple[float, float, float, float], bbox: tuple[float, float, float, float]
) -> bool:
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    return box[0] <= cx <= box[2] and box[1] <= cy <= box[3]


def run_link_view(conn: psycopg.Connection, job: Job, config: WorkerConfig) -> dict[str, Any]:
    view_id = str(job.payload.get("view_id", ""))
    return link_view(conn, config, view_id)


def link_view(conn: psycopg.Connection, config: WorkerConfig, view_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT v.*, s.project_id, s.page_index, s.width_pt, s.height_pt, f.stored_path"
        " FROM sheet_views v JOIN sheets s ON s.id = v.sheet_id"
        " JOIN project_files f ON f.project_id = s.project_id WHERE v.id = %s",
        (view_id,),
    ).fetchone()
    if row is None:
        raise LinkError("view not found")
    sheet = conn.execute("SELECT * FROM sheets WHERE id = %s", (row["sheet_id"],)).fetchone()
    if sheet is None or not sheet_included(conn, sheet):
        raise LinkError("the sheet is not in the takeoff (excluded by a person or by default)")
    if not row["structural_classes"]:
        raise LinkError("no line class is chosen or suggested for this view")
    ratio = None if row["scale_ratio"] is None else float(row["scale_ratio"])
    box_json = row["box"]
    box = (
        float(box_json["x0"]),
        float(box_json["y0"]),
        float(box_json["x1"]),
        float(box_json["y1"]),
    )
    pdf_path = config.upload_dir / row["stored_path"]
    if not pdf_path.is_file():
        raise LinkError("stored PDF is missing")
    sheet_id, project_id = str(row["sheet_id"]), str(row["project_id"])

    with pymupdf.open(pdf_path) as doc:
        page = doc[row["page_index"]]
        size = (page.rect.width, page.rect.height)
        in_view = lines_in_box(page_lines(page), box, size)
        table = class_table(in_view)
        classes = list(row["structural_classes"])  # the person's choice, never replaced
        legend = _legend_by_mark(conn, project_id)
        labels = [lb for lb in page_labels(page, sheet_id, set(legend)) if _inside(box, lb.bbox)]
    structural = [ln for ln in in_view if ln.klass in classes]

    conn.execute(
        "UPDATE sheet_views SET structural_lines = %s WHERE id = %s",
        (
            Jsonb(
                [
                    [round(ln.x0, 2), round(ln.y0, 2), round(ln.x1, 2), round(ln.y1, 2)]
                    for ln in structural[:MAX_STORED_LINES]
                    if ln.length >= MIN_STORED_LINE_PT
                ]
            ),
            view_id,
        ),
    )
    conn.execute(
        "UPDATE sheet_views SET class_table = %s WHERE id = %s",
        (
            Jsonb(
                [
                    {"key": s.key, "lines": s.lines, "length_pt": round(s.length_pt, 1)}
                    for s in table
                ]
            ),
            view_id,
        ),
    )

    text_lines = _text_lines(conn, sheet_id)
    sheet_title = sheet["title"] if sheet is not None else None
    totals: Counter = Counter()
    keys: set[str] = set()
    for lb in labels:
        proposal = propose(candidates_for(lb.bbox, lb.angle_deg, structural))
        fields = _member_fields(lb, proposal, legend, box, ratio)
        if fields is None:
            totals["skipped"] += 1
            continue
        kind = _kind_for(lb, text_lines, legend, sheet_title)
        fields.update(kind=kind.kind, kind_source=kind.source, kind_evidence=kind.evidence())
        totals[f"kind_{kind.status}"] += 1
        keys.add(lb.key)
        totals[f"confidence_{proposal.confidence}"] += 1
        _upsert(conn, project_id, sheet_id, view_id, lb, fields, totals)
    totals["removed"] += _remove_stale(conn, project_id, view_id, keys)
    assign_tags(conn, sheet_id)
    conn.commit()
    for key in (
        "created",
        "updated",
        "kept_reviewed",
        "removed",
        "skipped",
        "confidence_high",
        "confidence_medium",
        "confidence_low",
        "kind_set",
        "kind_ambiguous",
        "kind_missing",
    ):
        totals.setdefault(key, 0)
    totals["labels"] = len(labels)
    totals["structural_lines"] = len(structural)
    log.info("linked view: %s labels, %s structural lines", len(labels), len(structural))
    return {k: int(v) for k, v in sorted(totals.items())}


def _text_lines(conn: psycopg.Connection, sheet_id: str) -> list[tuple[Any, str]]:
    """The text lines of the sheet ((x0, y0, x1, y1), text) from the text layer."""
    rows = conn.execute(
        "SELECT x0, y0, x1, y1, text FROM text_items WHERE sheet_id = %s AND level = 'line'"
        " AND text IS NOT NULL",
        (sheet_id,),
    ).fetchall()
    return [
        ((float(r["x0"]), float(r["y0"]), float(r["x1"]), float(r["y1"])), r["text"]) for r in rows
    ]


def _rect_distance(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    dx = max(a[0] - b[2], b[0] - a[2], 0.0)
    dy = max(a[1] - b[3], b[1] - a[3], 0.0)
    return math.hypot(dx, dy)


def _kind_for(
    lb: Label,
    lines: list[tuple[Any, str]],
    legend: dict[str, list[dict[str, Any]]],
    sheet_title: str | None,
) -> KindResult:
    """The member kind from the label's surroundings (src/review/kinds.py has the rules)."""
    if lb.kind == "joist":
        return joist_kind()
    cx, cy = (lb.bbox[0] + lb.bbox[2]) / 2, (lb.bbox[1] + lb.bbox[3]) / 2
    same, near = [], []
    for bbox, text in lines:
        if bbox[0] <= cx <= bbox[2] and bbox[1] <= cy <= bbox[3]:
            same.append(text)
        else:
            d = _rect_distance(lb.bbox, bbox)
            if d <= NEAR_RADIUS_PT:
                near.append((d, text))
    near.sort(key=lambda t: t[0])
    legend_text = None
    if lb.kind == "mark":
        rows = legend.get(lb.text, [])
        legend_text = " ".join(f"{r['designation_raw']} {r.get('remarks_raw') or ''}" for r in rows)
    return detect_kind(" ".join(same), [t for _, t in near[:12]], legend_text or None, sheet_title)


def _legend_by_mark(conn: psycopg.Connection, project_id: str) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for r in conn.execute(
        "SELECT id, mark, designation_raw, remarks_raw, profile FROM legend_rows"
        " WHERE project_id = %s ORDER BY created_at, id",
        (project_id,),
    ):
        out.setdefault(r["mark"], []).append(r)
    return out


def _member_fields(
    lb: Label,
    proposal: Proposal,
    legend: dict[str, list[dict[str, Any]]],
    box: tuple[float, float, float, float],
    ratio: float | None,
) -> dict[str, Any] | None:
    f: dict[str, Any] = {
        "mark": None,
        "profile_raw": None,
        "profile": None,
        "mark_ref_status": None,
        "legend_row_id": None,
        "source_bbox": {"x0": lb.bbox[0], "y0": lb.bbox[1], "x1": lb.bbox[2], "y1": lb.bbox[3]},
    }
    if lb.kind == "profile":
        f["profile_raw"], f["profile"] = lb.text, lb.canonical
    elif lb.kind == "joist":
        # a joist designation is kept as written and is never matched to the AISC catalog
        f["profile_raw"] = lb.text
    else:
        rows = legend.get(lb.text, [])
        designations = {r["profile"] or r["designation_raw"] for r in rows}
        f["mark"] = lb.text
        if len(designations) == 1:
            r = rows[0]
            f.update(
                profile_raw=r["designation_raw"],
                profile=r["profile"],
                mark_ref_status="linked",
                legend_row_id=r["id"],
            )
        elif len(designations) > 1:
            f["mark_ref_status"] = "ambiguous"
        else:
            return None  # a mark with no legend row is not a label
    best = proposal.best
    f["link_confidence"] = proposal.confidence
    f["link_margin"] = None if proposal.margin is None else round(proposal.margin, 2)
    f["link_candidates"] = candidates_json(proposal)
    f["link_rule"] = RULE_VERSION
    if best is None or ratio is None:
        f.update(
            plan_start_x_mm=None, plan_start_y_mm=None, plan_end_x_mm=None, plan_end_y_mm=None,
            plan_bbox=None, plan_scale_ratio=None, plan_method=None, length_source=None,
        )  # fmt: skip
        if best is not None:  # no scale: the line is still proposed, only its plan frame is not
            a, b, c, d = best.candidate.line.bbox
            f["plan_bbox"] = {"x0": a, "y0": b, "x1": c, "y1": d}
    else:
        ln = best.candidate.line
        sx, sy = plan_xy(box, ratio, ln.x0, ln.y0)
        ex, ey = plan_xy(box, ratio, ln.x1, ln.y1)
        a, b, c, d = ln.bbox
        f.update(
            plan_start_x_mm=round(sx, 1), plan_start_y_mm=round(sy, 1),
            plan_end_x_mm=round(ex, 1), plan_end_y_mm=round(ey, 1),
            plan_bbox={"x0": a, "y0": b, "x1": c, "y1": d},
            plan_scale_ratio=ratio, plan_method="pdf_geometry", length_source="plan_geometry",
        )  # fmt: skip
    return f


_PROPOSAL_COLUMNS = (
    "mark", "profile_raw", "profile", "mark_ref_status", "legend_row_id", "source_bbox",
    "link_confidence", "link_margin", "link_candidates", "link_rule", "plan_start_x_mm",
    "plan_start_y_mm", "plan_end_x_mm", "plan_end_y_mm", "plan_bbox", "plan_scale_ratio",
    "plan_method", "length_source", "kind", "kind_source", "kind_evidence",
)  # fmt: skip
_JSON_COLUMNS = {"source_bbox", "link_candidates", "plan_bbox", "kind_evidence"}


def _values(fields: dict[str, Any]) -> list[Any]:
    return [
        Jsonb(fields[c]) if c in _JSON_COLUMNS and fields[c] is not None else fields[c]
        for c in _PROPOSAL_COLUMNS
    ]


def _touched(conn: psycopg.Connection, member_pk: str, review_status: str) -> bool:
    if review_status != "unreviewed":
        return True
    return (
        conn.execute(
            "SELECT 1 FROM member_edits WHERE member_id = %s LIMIT 1", (member_pk,)
        ).fetchone()
        is not None
    )


def _upsert(
    conn: psycopg.Connection,
    project_id: str,
    sheet_id: str,
    view_id: str,
    lb: Label,
    fields: dict[str, Any],
    totals: Counter,
) -> None:
    existing = conn.execute(
        "SELECT id, review_status FROM members WHERE project_id = %s AND label_key = %s",
        (project_id, lb.key),
    ).fetchone()
    if existing is None:
        cols = ", ".join(_PROPOSAL_COLUMNS)
        marks = ", ".join(["%s"] * len(_PROPOSAL_COLUMNS))
        conn.execute(
            "INSERT INTO members (project_id, sheet_id, view_id, plan_sheet_id, member_id, origin,"
            f" type, label_key, quantity, {cols})"
            f" VALUES (%s, %s, %s, %s, %s, 'extracted', %s, %s, 1, {marks})",
            [
                project_id,
                sheet_id,
                view_id,
                sheet_id,
                member_id_for(lb.key),
                "joist" if lb.kind == "joist" else "beam",
                lb.key,
                *_values(fields),
            ],
        )
        totals["created"] += 1
        return
    if _touched(conn, str(existing["id"]), existing["review_status"]):
        totals["kept_reviewed"] += 1
        return
    sets = ", ".join(f"{c} = %s" for c in _PROPOSAL_COLUMNS)
    # a changed kind gives the piece a new tag (prefix and number), assigned after the upserts
    reset = (
        "tag_prefix = CASE WHEN kind IS DISTINCT FROM %s THEN NULL ELSE tag_prefix END,"
        " tag_number = CASE WHEN kind IS DISTINCT FROM %s THEN NULL ELSE tag_number END,"
    )
    conn.execute(
        f"UPDATE members SET view_id = %s, {reset} {sets} WHERE id = %s",
        [view_id, fields["kind"], fields["kind"], *_values(fields), existing["id"]],
    )
    totals["updated"] += 1


def assign_tags(conn: psycopg.Connection, sheet_id: str) -> int:
    """Give every member of the sheet that has no tag its prefix and a running number.

    The prefix is the kind's abbreviation (the owner's list, when loaded) else the provisional
    prefix; a member with no kind has no prefix and its own running numbers. Numbers are per sheet
    and prefix, in reading order (top to bottom, left to right), continue after the highest number
    in use, and are never reused or changed for a member that already has one.
    """
    rows = conn.execute(
        "SELECT m.id, m.kind, COALESCE(k.abbreviation, k.provisional_prefix) AS prefix"
        " FROM members m LEFT JOIN member_kinds k ON k.kind = m.kind"
        " WHERE m.sheet_id = %s AND m.tag_number IS NULL AND m.review_status <> 'rejected'"
        " ORDER BY (m.source_bbox->>'y0')::float NULLS LAST,"
        " (m.source_bbox->>'x0')::float NULLS LAST, m.id",
        (sheet_id,),
    ).fetchall()
    used: dict[str | None, int] = {}
    for r in conn.execute(
        "SELECT m.tag_prefix AS p, MAX(m.tag_number) AS n FROM members m"
        " WHERE m.sheet_id = %s AND m.tag_number IS NOT NULL GROUP BY m.tag_prefix",
        (sheet_id,),
    ):
        used[r["p"]] = int(r["n"])
    for r in rows:
        prefix = r["prefix"]
        used[prefix] = used.get(prefix, 0) + 1
        conn.execute(
            "UPDATE members SET tag_prefix = %s, tag_number = %s WHERE id = %s",
            (prefix, used[prefix], r["id"]),
        )
    return len(rows)


def _remove_stale(conn: psycopg.Connection, project_id: str, view_id: str, keep: set[str]) -> int:
    rows = conn.execute(
        "SELECT id, label_key, review_status FROM members WHERE project_id = %s AND view_id = %s"
        " AND origin = 'extracted' AND label_key IS NOT NULL",
        (project_id, view_id),
    ).fetchall()
    removed = 0
    for r in rows:
        if r["label_key"] in keep or _touched(conn, str(r["id"]), r["review_status"]):
            continue
        conn.execute("DELETE FROM members WHERE id = %s", (r["id"],))
        removed += 1
    return removed


__all__ = ["JOB_TYPE", "LinkError", "assign_tags", "link_view", "run_link_view"]
