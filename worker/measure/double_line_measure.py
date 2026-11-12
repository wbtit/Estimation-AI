"""Review 4 measurement of double-line beams on a stored page (read-only; ids only).

Pre-registration: worker/prereg/PHASE0_DOUBLE_LINE_BEAMS_PREREGISTRATION.md (+ addendum).

    cd worker && .venv/bin/python -m measure.double_line_measure --sheet <sheet id prefix>
        --ratio <scale ratio> [--pen <pen class>] [--click x,y] [--truth <json of final pieces>]
        [--style double|both] [--json out]

The REAL build path (`build_page`) runs twice on the page's stored PDF: "before" (today's engine,
no style) and "after" (the learned style). The learned style is what the pen pick would store: the
click is given, or (default) the midpoint of the longest line of the pen that learns "double". The
page box is the whole page unless the sheet has a stored view box. Output per run: beam lines,
pieces, pairs, amber, unpaired thin lines, doubled (a found piece with a parallel found partner
inside the learned gap), junk (short pieces < 60 pt, and pieces near a callout), and, with --truth
(a json list of {"a": [x, y], "b": [x, y]} final pieces in page points): matched / recall / doubled
truth beams / unmatched found (short, long) / total length error. Matching (pre-registered): angle
within 3 deg, midpoint offset <= 6 pt perpendicular, overlap >= 50 % of the truth length, one
to one, best overlap first.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parent
sys.path.insert(0, str(WORKER))

SHORT_PT = 60.0


def _ang(a, b) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def _adiff(x: float, y: float) -> float:
    d = abs(x - y) % 180.0
    return min(d, 180.0 - d)


def _overlap_perp(p, q) -> tuple[float, float, float]:
    """(overlap along p, midpoint offset of q from p, angle diff) of two segments."""
    pa, pb = p
    qa, qb = q
    ln = math.dist(pa, pb) or 1.0
    ux, uy = (pb[0] - pa[0]) / ln, (pb[1] - pa[1]) / ln
    t = sorted(
        [(qa[0] - pa[0]) * ux + (qa[1] - pa[1]) * uy, (qb[0] - pa[0]) * ux + (qb[1] - pa[1]) * uy]
    )
    ov = max(0.0, min(ln, t[1]) - max(0.0, t[0]))
    mx, my = (qa[0] + qb[0]) / 2 - pa[0], (qa[1] + qb[1]) / 2 - pa[1]
    return ov, abs(-uy * mx + ux * my), _adiff(_ang(pa, pb), _ang(qa, qb))


def match(truth: list[dict], found: list[tuple]) -> dict:
    """One-to-one matching of found pieces to truth pieces (pre-registered rule)."""
    cands = []
    for i, t in enumerate(truth):
        ta, tb = tuple(t["a"]), tuple(t["b"])
        tl = math.dist(ta, tb) or 1.0
        for j, (fa, fb) in enumerate(found):
            ov, off, da = _overlap_perp((ta, tb), (fa, fb))
            if da <= 3.0 and off <= 6.0 and ov >= 0.5 * tl:
                cands.append((-ov, i, j))
    cands.sort()
    ti, fj, pairs = set(), set(), []
    for _, i, j in cands:
        if i in ti or j in fj:
            continue
        ti.add(i)
        fj.add(j)
        pairs.append((i, j))
    # doubled: a truth beam that two or more found pieces cover (matched or not)
    cover: dict[int, int] = {}
    for _, i, _j in cands:
        cover[i] = cover.get(i, 0) + 1
    doubled = sum(1 for n in cover.values() if n >= 2)
    tl = sum(math.dist(*map(tuple, (t["a"], t["b"]))) for t in truth)
    fl = sum(math.dist(*found[j]) for _i, j in pairs)
    per = [
        abs(math.dist(*found[j]) - math.dist(tuple(truth[i]["a"]), tuple(truth[i]["b"])))
        / (math.dist(tuple(truth[i]["a"]), tuple(truth[i]["b"])) or 1.0)
        for i, j in pairs
    ]
    un = [found[j] for j in range(len(found)) if j not in fj]
    return {
        "truth": len(truth),
        "found": len(found),
        "correct": len(pairs),
        "recall": round(len(pairs) / len(truth), 3) if truth else None,
        "doubled": doubled,
        "unmatched_found": len(un),
        "unmatched_short": sum(1 for a, b in un if math.dist(a, b) < SHORT_PT),
        "unmatched_long": sum(1 for a, b in un if math.dist(a, b) >= SHORT_PT),
        "total_length_error": round(abs(fl - tl) / tl, 4) if tl else None,
        "median_piece_error": round(sorted(per)[len(per) // 2], 4) if per else None,
    }


def stray(pb) -> int:
    """Short pieces (< 60 pt) with no support and no size label: the junk the callout and
    section-mark lines make (reported; a filter is proposed, not applied)."""
    return sum(
        1
        for p, a in zip(pb.supports.pieces, pb.piece_labels, strict=True)
        if p.length_pt < SHORT_PT and p.support_state == "none" and a.size_state == "undefined"
    )


def doubled_found(pieces: list[tuple], gmin: float, gmax: float) -> int:
    """Found pieces with a parallel found partner inside the gap band (a pair left as two beams)."""
    n = 0
    for i, p in enumerate(pieces):
        for q in pieces[i + 1 :]:
            ov, off, da = _overlap_perp(p, q)
            if da <= 1.5 and gmin <= off <= gmax and ov >= 0.7 * min(math.dist(*p), math.dist(*q)):
                n += 1
                break
    return n


def run(args: argparse.Namespace) -> dict[str, Any]:
    import psycopg
    import pymupdf
    from dotenv import load_dotenv
    from psycopg.rows import dict_row

    from src.build.beam_lines import beam_lines
    from src.build.clean import clean
    from src.build.double_line import BeamStyle, centrelines, learn_style
    from src.build.page import Setup, build_page
    from src.build.segments import crop, page_text_lines, parse_page

    load_dotenv(ROOT / ".env")
    conn = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    r = conn.execute(
        "SELECT s.id, s.page_index, s.width_pt, s.height_pt, f.stored_path FROM sheets s"
        " JOIN project_files f ON f.project_id = s.project_id WHERE s.id::text LIKE %s",
        (args.sheet + "%",),
    ).fetchone()
    doc = pymupdf.open(ROOT / os.environ.get("UPLOAD_DIR", "uploads") / r["stored_path"])
    page = doc[r["page_index"]]
    box = (0.0, 0.0, float(r["width_pt"]), float(r["height_pt"]))
    text = page_text_lines(page)
    ps = crop(parse_page(page), box)
    cleaned = clean(ps, text)
    dashed = centrelines(ps)
    pens = [args.pen] if args.pen else [f"{w}|black|solid" for w in ("0.25-0.5", "0.1-0.25")]
    best = None
    for pen in pens:
        lines = beam_lines(ps, cleaned.keep, pen)
        if args.click:
            click = tuple(float(v) for v in args.click.split(","))
        else:  # the pick: the midpoint of the longest line that learns "double"
            click = None
            for ln in sorted(lines, key=lambda x: -x.length):
                mid = ((ln.p0[0] + ln.p1[0]) / 2, (ln.p0[1] + ln.p1[1]) / 2)
                got = learn_style(lines, mid, pen, args.ratio, dashed)
                if got.style == "double":
                    click = mid
                    break
        if click is None:
            continue
        learned = learn_style(lines, click, pen, args.ratio, dashed)
        if learned.style == "double" and (best is None or len(lines) > best[3]):
            best = (pen, click, learned, len(lines))
    out: dict[str, Any] = {"sheet": str(r["id"])[:8], "ratio": args.ratio}
    pen_used = best[0] if best else pens[0]
    out["pen"] = pen_used
    setup0 = Setup(
        box, args.ratio, None, pen_used, "framing", pens=(pen_used,), column_mode="click_first"
    )
    before = build_page(page, setup0, text=text)
    bp = [(p.a, p.b) for p in before.supports.pieces]
    out["before"] = {"beam_lines": len(before.lines), "pieces": len(bp)}
    if best is None:
        out["learned"] = "no double-line style learned for the thin pens"
        return out
    _, click, learned, _n = best
    out["learned"] = {"style": learned.style, "gap_pt": round(learned.gap_min_pt, 2),
                      "click": [round(click[0], 1), round(click[1], 1)]}  # fmt: skip
    style = BeamStyle(args.style, learned.gap_min_pt, learned.gap_max_pt, True)
    setup1 = Setup(box, args.ratio, None, pen_used, "framing", pens=(pen_used,),
                   column_mode="click_first", beam_style=style)  # fmt: skip
    after = build_page(page, setup1, text=text)
    ap = [(p.a, p.b) for p in after.supports.pieces]
    g = learned.gap_min_pt
    amber, n_pairs = after.double_line.get("pairs_amber", 0), after.double_line.get("pairs", 0)
    out["before"]["doubled_found"] = doubled_found(bp, 0.4 * g, 1.6 * g)
    out["before"]["stray_short_pieces"] = stray(before)
    out["before"]["short_pieces"] = sum(1 for a, b in bp if math.dist(a, b) < SHORT_PT)
    out["after"] = {
        "beam_lines": len(after.lines),
        "pieces": len(ap),
        **after.double_line,
        "doubled_found": doubled_found(ap, 0.4 * g, 1.6 * g),
        "short_pieces": sum(1 for a, b in ap if math.dist(a, b) < SHORT_PT),
        "stray_short_pieces": stray(after),
        "amber_pairs_share": round(amber / max(1, n_pairs), 3),
    }
    if args.truth:
        truth = json.loads(Path(args.truth).read_text())
        out["before"]["vs_truth"] = match(truth, bp)
        out["after"]["vs_truth"] = match(truth, ap)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sheet", required=True)
    ap.add_argument("--ratio", type=float, required=True)
    ap.add_argument("--pen")
    ap.add_argument("--click")
    ap.add_argument("--truth")
    ap.add_argument("--style", default="double", choices=["double", "both"])
    ap.add_argument("--json")
    args = ap.parse_args()
    res = run(args)
    print(json.dumps(res, indent=1))
    if args.json:
        Path(args.json).write_text(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
