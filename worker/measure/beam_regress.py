"""Review 4 beam regression harness: single-line pages must build IDENTICALLY to the base commit.

Replays the REAL build path (`src.build.page.build_page`) on the app's REAL stored data (the
page's PDF, and the view's stored crop, scale, beam pens, exclude boxes and deselections; read-only
database), once with this branch's code and once with a base ref's code (`git archive <ref>` into a
work folder, run in a child process so `src.*` is the ref's). The style is never passed, so this
branch runs its single-line path: every beam line, piece, support state and label must equal the
base's. No project data is stored here or printed with names: pages are sheet ids.

    cd worker && .venv/bin/python -m measure.beam_regress --ref origin/phase0-review3-fixes
    options: --ids <sheet id prefixes, comma separated>  --exclude <ids>  --work-dir <folder>
             --json <out file>  --forced-double

Pages by default: the distinct (PDF hash, page) framing views of REAL projects that have a beam pen,
a confirmed scale and a box (copies of one drawing are run once).

--forced-double (this branch only): every thin pen of those pages is also run through the pairing
with style double and a required centreline, and the pairs made are reported per page. On a
single-line drawing that must be zero: a pair on a page a person calls single-line is a false pair.
Exit 1 when any page differs from the base.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

WORKER = Path(__file__).resolve().parents[1]
ROOT = WORKER.parent
SELECT_PAGES = """
SELECT DISTINCT ON (f.sha256, s.page_index) s.id AS sheet_id, s.project_id, s.page_index,
       f.stored_path, f.sha256, v.id AS view_id
FROM build_views v
JOIN sheets s ON s.id = v.sheet_id
JOIN projects p ON p.id = s.project_id
JOIN project_files f ON f.project_id = s.project_id
JOIN role_names r ON r.name = v.role_name AND r.behaviour = %(behaviour)s
WHERE (p.purpose = 'real' OR s.id::text LIKE ANY(%(extra)s))
  AND v.scale_ratio IS NOT NULL AND v.box IS NOT NULL
  AND (%(behaviour)s <> 'framing' OR EXISTS (SELECT 1 FROM view_pens vp WHERE vp.view_id = v.id))
ORDER BY f.sha256, s.page_index, s.created_at, v.position
"""


def _connect(database_url: str):
    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(database_url, row_factory=dict_row)
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    return conn


def select_pages(
    conn,
    ids: list[str],
    exclude: list[str],
    extra: list[str] | None = None,
    behaviour: str = "framing",
) -> list[dict]:
    """`extra`: sheet id prefixes of pages of NON-real projects to include too (e.g. session 1)."""
    rows = conn.execute(
        SELECT_PAGES, {"extra": [e + "%" for e in (extra or [])], "behaviour": behaviour}
    ).fetchall()
    out = []
    for r in rows:
        sid = str(r["sheet_id"])
        if ids and not any(sid.startswith(i) for i in ids):
            continue
        if any(sid.startswith(e) for e in exclude):
            continue
        out.append(
            {
                "sheet_id": sid,
                "view_id": str(r["view_id"]),
                "page_index": r["page_index"],
                "stored_path": r["stored_path"],
                "behaviour": behaviour,
            }  # fmt: skip
        )
    return out


def run_pages(database_url: str, upload_dir: Path, pages: list[dict], forced: bool) -> list[dict]:
    """Build each page with the `src` package importable NOW; one summary dict per page."""
    import pymupdf

    from src.build.page import Setup, build_page
    from src.build.views import load_views

    out: list[dict] = []
    with _connect(database_url) as conn:
        for pg in pages:
            sheet = conn.execute("SELECT * FROM sheets WHERE id = %s", (pg["sheet_id"],)).fetchone()
            view = next(v for v in load_views(conn, pg["sheet_id"]) if v.id == pg["view_id"])
            box = view.row["box"]
            crop = (float(box["x0"]), float(box["y0"]), float(box["x1"]), float(box["y1"]))
            pens = tuple(p["pen_class"] for p in view.pens)
            role = pg.get("behaviour", "framing")
            setup = Setup(
                crop, float(view.row["scale_ratio"]), None, pens[0] if pens else None, role,
                pens=pens, excludes=tuple(view.excludes), deselected=tuple(view.deselected),
                column_mode="click_first",
            )  # fmt: skip
            res: dict[str, Any] = {"sheet_id": pg["sheet_id"], "pens": list(pens)}
            with pymupdf.open(upload_dir / pg["stored_path"]) as doc:
                page = doc[sheet["page_index"]]
                pb = build_page(page, setup)
                res["lines"] = [
                    [round(v, 2) for v in (*ln.p0, *ln.p1)] + [len(ln.seg_ids)] for ln in pb.lines
                ]
                res["pieces"] = [
                    [round(v, 2) for v in (*p.a, *p.b)]
                    + [p.support_state, a.size_state, a.label.canonical if a.label else None]
                    for p, a in zip(pb.supports.pieces, pb.piece_labels, strict=True)
                ]
                # Phase 0 profile from callout: the label each column took (state, profile)
                res["columns"] = [
                    [round(g.centre[0], 1), round(g.centre[1], 1), a.size_state,
                     a.label.canonical if a.label else None]
                    for g, a in zip(pb.columns, pb.column_labels, strict=True)
                ]  # fmt: skip
                res["notes"] = list(pb.notes)
                res["counts"] = {
                    k: v for k, v in pb.counts().items() if not k.startswith("double_")
                }
                if forced:
                    res["forced_double"] = _forced(page, setup)
            out.append(res)
    return out


def _forced(page, setup) -> dict:
    """The pairing run with style double on every thin pen of the page (this branch only)."""
    from src.build.beam_lines import beam_lines
    from src.build.clean import clean
    from src.build.double_line import BeamStyle, centrelines, is_thin_pen, pair_lines
    from src.build.segments import crop, page_text_lines, parse_page

    text = [t for t in page_text_lines(page) if _in(t.centre, setup.crop)]
    ps = crop(parse_page(page), setup.crop)
    cleaned = clean(ps, text)
    dashed = centrelines(ps)
    thin = [p for p in setup.beam_pens() if is_thin_pen(p)]
    pairs = amber = unpaired = 0
    for pen in thin:
        res = pair_lines(
            beam_lines(ps, cleaned.keep, pen), BeamStyle("double", None, None, True),
            setup.ratio, dashed,
        )  # fmt: skip
        pairs += len(res.pairs)
        amber += sum(bool(p.amber) for p in res.pairs)
        unpaired += len(res.unpaired)
    return {"thin_pens": len(thin), "pairs": pairs, "amber": amber, "unpaired": unpaired}


def sweep(database_url: str, upload_dir: Path, ids: list[str]) -> list[dict]:
    """Forced double on every thin solid black pen of pages chosen by sheet id (no stored setup
    needed): pairs made, amber, unpaired. The scale is the page's confirmed or parsed one, else
    96 (recorded). On a single-line drawing every number of `pairs` must be zero."""
    import pymupdf

    from src.build.beam_lines import beam_lines
    from src.build.clean import clean
    from src.build.double_line import BeamStyle, centrelines, pair_lines
    from src.build.segments import crop, page_text_lines, parse_page

    out = []
    with _connect(database_url) as conn:
        for pref in ids:
            r = conn.execute(
                "SELECT s.id, s.page_index, s.width_pt, s.height_pt, s.scale_override_ratio,"
                " s.scale_parsed_ratio, f.stored_path FROM sheets s JOIN project_files f"
                " ON f.project_id = s.project_id WHERE s.id::text LIKE %s",
                (pref + "%",),
            ).fetchone()
            ratio = float(r["scale_override_ratio"] or r["scale_parsed_ratio"] or 96)
            with pymupdf.open(upload_dir / r["stored_path"]) as doc:
                page = doc[r["page_index"]]
                box = (0.0, 0.0, float(r["width_pt"]), float(r["height_pt"]))
                ps = crop(parse_page(page), box)
                cleaned = clean(ps, page_text_lines(page))
                dashed = centrelines(ps)
                row = {"sheet_id": str(r["id"])[:8], "ratio": ratio, "pens": {}}
                for pen in ("0.1-0.25|black|solid", "0.25-0.5|black|solid"):
                    lines = beam_lines(ps, cleaned.keep, pen)
                    res = pair_lines(lines, BeamStyle("double", None, None, True), ratio, dashed)
                    row["pens"][pen] = {
                        "lines": len(lines), "pairs": len(res.pairs),
                        "amber": sum(bool(p.amber) for p in res.pairs),
                    }  # fmt: skip
            out.append(row)
    return out


def _in(p, box) -> bool:
    return box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]


def _child(src_dir: str, pages_file: str, out_file: str, upload_dir: str, url: str, forced: str):
    sys.path.insert(0, src_dir)
    pages = json.loads(Path(pages_file).read_text())
    res = run_pages(url, Path(upload_dir), pages, forced == "1")
    Path(out_file).write_text(json.dumps(res))


def run_ref(ref: str, work: Path, url: str, upload_dir: Path, pages: list[dict]) -> list[dict]:
    """The same pages through the code of git ref `ref` (a child process on its own worker/src)."""
    tree = work / f"ref-{ref.replace('/', '_')}"
    tree.mkdir(parents=True, exist_ok=True)
    tar = subprocess.run(
        ["git", "archive", ref, "worker/src", "schema"], cwd=ROOT, capture_output=True, check=True
    )
    subprocess.run(["tar", "-x", "-C", str(tree)], input=tar.stdout, check=True)
    pages_file, out_file = work / "pages.json", work / f"out-{tree.name}.json"
    pages_file.write_text(json.dumps(pages))
    subprocess.run(
        [sys.executable, "-I", str(Path(__file__).resolve()), "--child", str(tree / "worker"),
         str(pages_file), str(out_file), str(upload_dir), url, "0"],
        check=True, cwd=WORKER,
    )  # fmt: skip
    return json.loads(out_file.read_text())


def compare(old: list[dict], new: list[dict]) -> dict:
    diff = []
    for o, n in zip(old, new, strict=True):
        keys = [
            k for k in ("lines", "pieces", "columns", "notes", "counts") if o.get(k) != n.get(k)
        ]
        if keys:
            diff.append({"sheet_id": o["sheet_id"], "differs": keys})
    return {"pages": len(old), "identical": len(old) - len(diff), "different": diff}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ref", default="origin/phase0-review3-fixes")
    ap.add_argument("--ids", default="")
    ap.add_argument("--exclude", default="")
    ap.add_argument("--extra", default="", help="sheet id prefixes of non-real projects to add")
    ap.add_argument("--work-dir")
    ap.add_argument("--json")
    ap.add_argument("--forced-double", action="store_true")
    ap.add_argument("--behaviour", default="framing", choices=["framing", "column_plan"])
    ap.add_argument("--sweep", default="", help="sheet id prefixes: forced double on thin pens")
    args = ap.parse_args(argv)
    import os

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    url = os.environ["DATABASE_URL"]
    upload_dir = ROOT / os.environ.get("UPLOAD_DIR", "uploads")
    if args.sweep:
        rows = sweep(url, upload_dir, [x for x in args.sweep.split(",") if x])
        for row in rows:
            print("  sweep", row["sheet_id"], "ratio", row["ratio"], row["pens"])
        if args.json:
            Path(args.json).write_text(json.dumps(rows, indent=1))
        return 1 if any(p["pairs"] for r in rows for p in r["pens"].values()) else 0
    with _connect(url) as conn:
        pages = select_pages(
            conn,
            [x for x in args.ids.split(",") if x],
            [x for x in args.exclude.split(",") if x],
            [x for x in args.extra.split(",") if x],
            args.behaviour,
        )
    work = Path(args.work_dir) if args.work_dir else Path(tempfile.mkdtemp(prefix="beam-regress-"))
    old = run_ref(args.ref, work, url, upload_dir, pages)
    sys.path.insert(0, str(WORKER))
    new = run_pages(url, upload_dir, pages, args.forced_double)
    result = compare(old, new)
    if args.forced_double:
        rows = [(n["sheet_id"][:8], n["forced_double"]) for n in new]
        result["forced_double"] = rows
        result["forced_double_pages_with_pairs"] = [r for r in rows if r[1]["pairs"]]
    n_diff = len(result["different"])
    print(f"pages {result['pages']}  identical {result['identical']}  different {n_diff}")
    for d in result["different"]:
        print("  DIFF", d["sheet_id"][:8], d["differs"])
    if args.forced_double:
        for sid, f in result["forced_double"]:
            print("  forced-double", sid, f)
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1))
    return 1 if result["different"] else 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--child":
        _child(*sys.argv[2:8])
    else:
        raise SystemExit(main())
