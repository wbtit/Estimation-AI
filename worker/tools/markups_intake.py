"""Phase 12e: intake of new estimator markups as a LOCKED held-out TEST set (read-only analysis).

  PYTHONPATH=. .venv/bin/python -m tools.markups_intake place [--apply]
  PYTHONPATH=. .venv/bin/python -m tools.markups_intake inventory
  PYTHONPATH=. .venv/bin/python -m tools.markups_intake report   # the doc again from the JSON

`place` pairs each estimator markup in fixtures/MARKUPS/<markup folder> with its drawing set in the
folder whose name holds "ORIGINAL" (same page count, then most pages with the same text hash without
annotations; a tie or no shared page leaves it unpaired), gives the pairs the next job ids (in the
order of the markup file names) and checks duplicates against every existing drawing and takeoff
PDF (SHA-256, and "likely": the same page count and the same set of sheet numbers, or two thirds of
the pages with the same text). Without --apply it is a preview (counts and ids only). With --apply
it moves the drawings to fixtures/private/markups/job-0NN.pdf and the markups to
fixtures/private/takeoffs/takeoff-NN.pdf (the names the existing loaders read:
`drawing_documents()` through inventory_map.csv, and the takeoff loader through inventory.json and
PRIVATE_MAP.csv; the three registers are backed up first), makes them read-only, and writes the
original names only to the git-ignored fixtures/private/markups/MAPPING.json.

`inventory` reads the placed files (never writes them) and writes the git-ignored
fixtures/private/eval/markups_intake.json (full detail, raw text included), the local-only
docs/MARKUPS_INTAKE.md (job ids and firm ids only) and fixtures/private/markups/heldout_test.lock
(ids and SHA-256 of the jobs that are not duplicates of an existing job). Prints counts only.

Kinds of count symbols come only from the prefixes the owner named for this task (MARK_KINDS); any
other prefix is listed as unmapped, never guessed (no company-wide mapping exists yet).
"""

from __future__ import annotations

import collections
import csv
import datetime
import hashlib
import json
import re
import shutil
import stat
import sys
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from src.pdf_scan.analyze import analyze_page
from tools.bbmeasure import measure_ratio
from tools.takeoff.colour_study import colour_key
from tools.takeoff.common import PRIVATE, ROOT, TAKEOFFS, drawing_documents, fingerprint
from tools.takeoff.import_markups import page_symbols
from tools.takeoff.prefix_inventory import prefix_of

SOURCE = ROOT / "fixtures" / "MARKUPS"
DEST = PRIVATE / "markups"
MAPPING = DEST / "MAPPING.json"
LOCK = DEST / "heldout_test.lock"
OUT = PRIVATE / "eval" / "markups_intake.json"
DOC = ROOT / "docs" / "MARKUPS_INTAKE.md"
INVENTORY_MAP = PRIVATE / "inventory_map.csv"
TAKEOFF_INV = TAKEOFFS / "inventory.json"
TAKEOFF_MAP = TAKEOFFS / "PRIVATE_MAP.csv"
ITEM = "set-C"  # the inventory_map.csv item of this intake (set-A, set-B are the earlier ones)

# Owner-named prefixes for this task (B = beam, C = column, VB / HB = braces). Nothing else.
MARK_KINDS = {"B": "beam", "C": "column", "VB": "brace", "HB": "brace"}
KINDS = ("column", "beam", "brace")
# The words of a summary-box line that name a kind (the label is kept raw in the private JSON).
SUMMARY_KIND_WORDS = (("column", "COLUMN"), ("beam", "BEAM"), ("brace", "BRAC"))
SUMMARY_PAIR = re.compile(r"([A-Za-z][A-Za-z /&.()']*?)\s*[-:=]\s*(\d+)(?:\s*~\s*(\d+))?")
SUMMARY_FALLBACK = re.compile(r"ESTIMATED\s+BY|INCLU(?:DES|SIONS)", re.I)
YELLOW_MIN_RG, YELLOW_MAX_B = 0.9, 0.6
LIKELY_SHARED_PAGES = 2 / 3  # share of the smaller document's text pages with the same text hash
RATIO_MERGE = 0.01  # calibrations within 1% are one scale

# --- pure rules (synthetic tests in tests/test_markups_intake.py) -------------------------------


def is_yellow(rgb: tuple[float, ...] | list[float] | None) -> bool:
    return (
        bool(rgb)
        and len(rgb) >= 3
        and min(rgb[0], rgb[1]) >= YELLOW_MIN_RG
        and rgb[2] <= YELLOW_MAX_B
    )


def mark_kind(prefix: str | None) -> str | None:
    return MARK_KINDS.get(prefix or "")


def summary_kind(label: str) -> str:
    up = label.upper()
    for kind, word in SUMMARY_KIND_WORDS:
        if word in up:
            return kind
    return "other"


def parse_summary(text: str) -> list[dict]:
    """`Columns-70, Beams-163` -> one entry per pair; `37~20` keeps both numbers and is flagged."""
    out = []
    for m in SUMMARY_PAIR.finditer(text or ""):
        label = re.sub(r"\s+", " ", m.group(1)).strip(" /&.")
        if not label:
            continue
        out.append(
            {
                "label": label,
                "kind": summary_kind(label),
                "n": int(m.group(2)),
                "alt": int(m.group(3)) if m.group(3) else None,
            }
        )
    return out


def summary_counts(pairs: list[dict]) -> dict[str, int]:
    c: collections.Counter = collections.Counter()
    for p in pairs:
        c[p["kind"]] += p["n"]
    return dict(c)


def merge_ratios(values: list[float]) -> list[float]:
    out: list[float] = []
    for r in sorted(values):
        if not out or abs(r - out[-1]) / out[-1] > RATIO_MERGE:
            out.append(r)
    return [round(v, 3) for v in out]


FIRM_ID = re.compile(r"^firm-[A-Z]{1,2}$")


def firm_label(value: str | None) -> str:
    """The report's firm: the hand-filled id, firm-? when empty; a value that is not an id (a
    name typed by mistake) is never printed."""
    if not value:
        return "firm-?"
    return value if FIRM_ID.match(value) else "firm-? (not an id)"


def firm_manual(mapping: dict) -> dict[str, str | None]:
    return {j: info.get("firm_manual") for j, info in mapping["jobs"].items()}


@dataclass
class Doc:
    path: Path
    pages: int
    hashes: list[str | None]


def pair(markups: list[Doc], drawings: list[Doc]) -> tuple[dict[int, int], list[int]]:
    """markup index -> drawing index: the same page count and the most equal page hashes (at least
    one); a tie, no shared page or a drawing already taken leaves the markup unpaired."""
    out: dict[int, int] = {}
    unpaired = []
    taken: set[int] = set()
    for i, m in enumerate(markups):
        mh = {h for h in m.hashes if h}
        scores = sorted(
            (
                (len(mh & {h for h in d.hashes if h}), j)
                for j, d in enumerate(drawings)
                if d.pages == m.pages
            ),
            reverse=True,
        )
        ok = scores and scores[0][0] > 0 and (len(scores) == 1 or scores[1][0] < scores[0][0])
        if ok and scores[0][1] not in taken:
            out[i] = scores[0][1]
            taken.add(scores[0][1])
        else:
            unpaired.append(i)
    return out, unpaired


def shared_share(a: list[str | None], b: list[str | None]) -> float:
    sa, sb = {h for h in a if h}, {h for h in b if h}
    return len(sa & sb) / min(len(sa), len(sb)) if sa and sb else 0.0


# --- files ---------------------------------------------------------------------------------------


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _doc(p: Path) -> Doc:
    f = fingerprint(p)
    return Doc(p, f["pages"], f["hashes"])


def _source_folders() -> tuple[Path, Path]:
    dirs = sorted(d for d in SOURCE.iterdir() if d.is_dir())
    draw = [d for d in dirs if "ORIGINAL" in d.name.upper()]
    mark = [d for d in dirs if "ORIGINAL" not in d.name.upper()]
    if len(draw) != 1 or len(mark) != 1:
        raise SystemExit(
            f"expected one drawing and one markup folder, found {len(draw)} and {len(mark)}"
        )
    return mark[0], draw[0]


def _pdfs(d: Path) -> list[Path]:
    return sorted(
        (p for p in d.iterdir() if p.suffix.lower() == ".pdf"), key=lambda p: p.name.lower()
    )


def _next_job_number() -> int:
    rows = [
        {k.strip(): (v or "").strip() for k, v in r.items()}
        for r in csv.DictReader(open(INVENTORY_MAP))
    ]
    ids = [int(r["id"].split("-")[1]) for r in rows if r["id"].startswith("job-")]
    return max(ids) + 1


def _next_takeoff_number() -> int:
    nums = [
        int(m.group(1))
        for p in TAKEOFFS.glob("takeoff-*")
        if (m := re.match(r"takeoff-(\d+)", p.name))
    ]
    return max(nums) + 1


def sheet_numbers(p: Path) -> list[str | None]:
    with pymupdf.open(p) as doc:
        return [analyze_page(pg).sheet_number for pg in doc]


def duplicates(new: dict[str, Doc], existing: dict[str, Doc]) -> dict[str, list[dict]]:
    """Per new job: exact (SHA-256) and likely duplicates among the existing and the other new."""
    sha_new = {j: sha256(d.path) for j, d in new.items()}
    sha_old = {k: sha256(d.path) for k, d in existing.items()}
    sheets: dict[str, list] = {}

    def sheets_of(key: str, d: Doc) -> list:
        if key not in sheets:
            sheets[key] = sheet_numbers(d.path)
        return sheets[key]

    out: dict[str, list[dict]] = {j: [] for j in new}
    others = {
        **{("existing", k): d for k, d in existing.items()},
        **{("new", k): d for k, d in new.items()},
    }
    for j, d in new.items():
        for (where, k), o in others.items():
            if where == "new" and k == j:
                continue
            exact = sha_new[j] == (sha_old.get(k) if where == "existing" else sha_new[k])
            share = shared_share(d.hashes, o.hashes)
            same_sheets = False
            if d.pages == o.pages:
                a = {s for s in sheets_of(f"new:{j}", d) if s}
                b = {s for s in sheets_of(f"{where}:{k}", o) if s}
                same_sheets = bool(a) and a == b
            if exact or same_sheets or share >= LIKELY_SHARED_PAGES:
                out[j].append(
                    {
                        "with": k,
                        "where": where,
                        "exact": exact,
                        "same_page_count_and_sheets": same_sheets,
                        "shared_text_pages": round(share, 3),
                    }
                )
    return out


def existing_docs() -> dict[str, Doc]:
    out = {j: _doc(p) for j, p in drawing_documents().items()}
    for p in sorted(TAKEOFFS.glob("takeoff-*.pdf")):
        out[p.stem] = _doc(p)
    return out


def _page_map(markup: Path, drawing: Path) -> dict[str, int]:
    """The takeoff loader's page map (tools/takeoff/inventory.py rule: word-set Jaccard >= 0.9)."""
    fm, fd = fingerprint(markup), fingerprint(drawing)
    out: dict[str, int] = {}
    for k, sig in enumerate(fm["sigs"]):
        if not sig:
            continue
        for dk, ds in enumerate(fd["sigs"]):
            if ds and len(sig & ds) / len(sig | ds) >= 0.9:
                out[str(k)] = dk
                break
    return out


def place(apply: bool) -> None:
    mdir, ddir = _source_folders()
    marks, draws = [_doc(p) for p in _pdfs(mdir)], [_doc(p) for p in _pdfs(ddir)]
    pairs, unpaired = pair(marks, draws)
    print(f"markups {len(marks)} | drawings {len(draws)}", end=" | ")
    print(f"paired {len(pairs)} | unpaired {len(unpaired)}")
    if unpaired or len(pairs) != len(draws):
        raise SystemExit("not every markup has exactly one drawing; nothing moved")
    j0, t0 = _next_job_number(), _next_takeoff_number()
    plan = []
    for n, i in enumerate(sorted(pairs)):
        plan.append(
            {
                "job": f"job-{j0 + n:03d}",
                "takeoff": f"takeoff-{t0 + n:02d}.pdf",
                "markup": marks[i],
                "drawing": draws[pairs[i]],
            }
        )
    new = {r["job"]: r["drawing"] for r in plan}
    dups = duplicates(new, existing_docs())
    for r in plan:
        d = [(x["where"], x["with"], "exact" if x["exact"] else "likely") for x in dups[r["job"]]]
        print(
            f"{r['job']} <- drawing {r['drawing'].pages} pages, markup -> {r['takeoff']};", end=""
        )
        print(f" duplicates: {d or 'none'}")
    if not apply:
        print("preview only: nothing moved (run with --apply)")
        return
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bdir = PRIVATE / "backups" / f"registers-before-intake-{stamp}"
    bdir.mkdir(parents=True)
    for f in (INVENTORY_MAP, TAKEOFF_INV, TAKEOFF_MAP):
        shutil.copy2(f, bdir / f.name)
    DEST.mkdir(parents=True, exist_ok=True)
    inv = json.loads(TAKEOFF_INV.read_text())
    # firm_names (firm id -> real name) and each job's firm_manual are filled by hand
    mapping: dict = {"source": "fixtures/MARKUPS", "jobs": {}, "firm_names": {}}
    for r in plan:
        dpath, tpath = DEST / f"{r['job']}.pdf", TAKEOFFS / r["takeoff"]
        if dpath.exists() or tpath.exists():
            raise SystemExit(f"{r['job']}: target exists; stopped")
        shutil.move(r["drawing"].path, dpath)
        shutil.move(r["markup"].path, tpath)
        for p in (dpath, tpath):
            p.chmod(p.stat().st_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
        mapping["jobs"][r["job"]] = {
            "drawing_original": f"{ddir.name}/{r['drawing'].path.name}",
            "markup_original": f"{mdir.name}/{r['markup'].path.name}",
            "drawing": f"markups/{dpath.name}",
            "markup": f"takeoffs/{tpath.name}",
            "drawing_sha256": sha256(dpath),
            "markup_sha256": sha256(tpath),
            "firm_manual": None,
        }
        with open(INVENTORY_MAP, "a") as f:
            f.write(
                f"{r['job']}, {ITEM} , markups/{dpath.name}, kept, , \r\n"
            )  # CRLF like the file
        with open(TAKEOFF_MAP, "a") as f:
            f.write(
                f"{r['takeoff']}, {mdir.name}/{r['markup'].path.name}, {tpath.stat().st_size},"
                f" {mapping['jobs'][r['job']]['markup_sha256']}\r\n"
            )
        pm = _page_map(tpath, dpath)
        with pymupdf.open(tpath) as d:
            annots = sum(1 for pg in d for _ in (pg.annots() or []))
            enc = d.is_encrypted
        inv[r["takeoff"]] = {
            "pages": r["markup"].pages,
            "pages_with_text": sum(1 for h in r["markup"].hashes if h),
            "annotations": annots,
            "match": r["job"],
            "matched_pages": len(pm),
            "same_page_count": True,
            "same_page_sizes": fingerprint(tpath)["sizes"] == fingerprint(dpath)["sizes"],
            "all_votes": {},
            "loose_votes": {},
            "encrypted": enc,
            "page_map": pm,
            "intake": "phase12e",
        }
    TAKEOFF_INV.write_text(json.dumps(inv, indent=1))
    mapping["duplicates"] = dups
    MAPPING.write_text(json.dumps(mapping, indent=1))
    print(
        f"moved {2 * len(plan)} files, read-only; registers backed up to {bdir.relative_to(ROOT)}"
    )


# --- inventory -----------------------------------------------------------------------------------


def _drawing(job: str, path: Path) -> dict:
    pages = []
    with pymupdf.open(path) as doc:
        for pg in doc:
            s = analyze_page(pg)
            pages.append(
                {
                    "page_index": pg.number,
                    "page_kind": s.page_kind,
                    "text": "real"
                    if s.has_text_layer
                    else ("none_on_vector" if s.page_kind == "vector" else "none"),
                    "vector_paths": s.vector_path_count,
                    "text_chars": s.text_char_count,
                    "sheet_number": s.sheet_number,
                    "title": s.title,
                    "page_type_guess": s.page_type_guess,
                    "scale_parsed_ratio": s.scale_parsed_ratio,
                }
            )
    return {"pages": pages}


def _markup(path: Path) -> dict:
    out: dict = {
        "pages": [],
        "annotation_types": collections.Counter(),
        "subjects": collections.Counter(),
        "summary": None,
        "summary_candidates": [],
    }
    with pymupdf.open(path) as doc:

        def resolve(x: int) -> str:
            return doc.xref_object(x, compressed=False)

        yellow, fallback = [], []
        for pg in doc:
            prefixes: collections.Counter = collections.Counter()
            colours: collections.Counter = collections.Counter()
            ratios = []
            for a in pg.annots() or []:
                out["annotation_types"][a.type[1]] += 1
                out["subjects"][a.info.get("subject") or ""] += 1
                obj = doc.xref_object(a.xref, compressed=False)
                for key in ("/BBMeasure", "/Measure"):
                    r = measure_ratio(obj, resolve, key)
                    if r:
                        ratios.append(r)
                if a.type[1] == "Polygon":
                    colours[colour_key(a.colors.get("stroke"))] += 1
                if a.type[1] == "FreeText" and doc.xref_get_key(a.xref, "IRT")[0] == "null":
                    text = a.info.get("content") or ""
                    cand = {"page_index": pg.number, "text": text, "pairs": parse_summary(text)}
                    if is_yellow(a.colors.get("stroke")) and cand["pairs"]:
                        yellow.append(cand)
                    elif pg.number == 0 and SUMMARY_FALLBACK.search(text):
                        fallback.append(cand)
            t, v = doc.xref_get_key(pg.xref, "VP")
            if t != "null":
                vp = v if t == "array" else resolve(int(v.split()[0]))
                for m in re.finditer(r"(\d+)\s+0\s+R", vp):
                    r = measure_ratio(resolve(int(m.group(1))), resolve)
                    if r:
                        ratios.append(r)
                r = measure_ratio(vp, resolve)
                if r:
                    ratios.append(r)
            syms = page_symbols(doc, pg)
            for s in syms:
                prefixes["(no tag)" if s["mark"] is None else prefix_of(s["mark"])] += 1
            out["pages"].append(
                {
                    "page_index": pg.number,
                    "symbols": len(syms),
                    "prefixes": dict(prefixes),
                    "polygon_colours": dict(colours),
                    "calibrations": merge_ratios(ratios),
                }
            )
        best = None
        if yellow:
            best = max(
                yellow,
                key=lambda c: (
                    sum(p["kind"] != "other" for p in c["pairs"]),
                    len(c["pairs"]),
                    -c["page_index"],
                ),
            )
            best = {**best, "rule": "yellow_freetext"}
        elif fallback:
            best = {**max(fallback, key=lambda c: len(c["pairs"])), "rule": "front_sheet_keywords"}
        out["summary"] = best
        out["summary_candidates"] = [{**c, "rule": "yellow_freetext"} for c in yellow] + [
            {**c, "rule": "front_sheet_keywords"} for c in fallback
        ]
    out["annotation_types"] = dict(out["annotation_types"])
    out["subjects"] = dict(out["subjects"])
    return out


def _job(job: str, info: dict, dups: list[dict]) -> dict:
    d = _drawing(job, PRIVATE / info["drawing"])
    m = _markup(PRIVATE / info["markup"])
    page_map = {
        int(k): v
        for k, v in json.loads(TAKEOFF_INV.read_text())[Path(info["markup"]).name][
            "page_map"
        ].items()
    }
    marked = []
    sym_kinds: collections.Counter = collections.Counter()
    unmapped: collections.Counter = collections.Counter()
    for p in m["pages"]:
        if not p["symbols"]:
            continue
        dp = page_map.get(p["page_index"])
        dpage = d["pages"][dp] if dp is not None else None
        marked.append(
            {
                "markup_page": p["page_index"],
                "drawing_page": dp,
                "sheet_number": dpage["sheet_number"] if dpage else None,
                "title": dpage["title"] if dpage else None,
                "symbols": p["symbols"],
            }
        )
        for prefix, n in p["prefixes"].items():
            k = mark_kind(prefix)
            if k:
                sym_kinds[k] += n
            else:
                unmapped[prefix] += n
    summary = m["summary"]
    s_counts = summary_counts(summary["pairs"]) if summary else {}
    disagree = {
        k: {"summary": s_counts.get(k, 0), "symbols": sym_kinds.get(k, 0)}
        for k in KINDS
        if summary and s_counts.get(k, 0) != sym_kinds.get(k, 0)
    }
    kinds_pages = collections.Counter(p["page_kind"] for p in d["pages"])
    text_pages = collections.Counter(p["text"] for p in d["pages"])
    return {
        "job": job,
        "pages": len(d["pages"]),
        "drawing_bytes": (PRIVATE / info["drawing"]).stat().st_size,
        "markup_bytes": (PRIVATE / info["markup"]).stat().st_size,
        "page_kinds": dict(kinds_pages),
        "text": dict(text_pages),
        "marked_pages": marked,
        "symbol_kinds": dict(sym_kinds),
        "unmapped_prefixes": dict(unmapped),
        "summary": summary,
        "summary_counts": s_counts,
        "summary_odd": [p for p in (summary or {}).get("pairs", []) if p["alt"] is not None],
        "summary_vs_symbols": disagree,
        "calibrated_pages": sum(1 for p in m["pages"] if p["calibrations"]),
        "calibrations": {
            p["page_index"]: p["calibrations"] for p in m["pages"] if p["calibrations"]
        },
        "annotation_types": m["annotation_types"],
        "subjects": m["subjects"],
        "polygon_colours": dict(
            sum(
                (collections.Counter(p["polygon_colours"]) for p in m["pages"]),
                collections.Counter(),
            )
        ),
        "summary_candidates": m["summary_candidates"],
        "duplicates": dups,
        "drawing_pages": d["pages"],
    }


def inventory() -> None:
    mapping = json.loads(MAPPING.read_text())
    jobs = []
    for job, info in sorted(mapping["jobs"].items()):
        r = _job(job, info, mapping["duplicates"].get(job, []))
        dup_existing = [x for x in r["duplicates"] if x["where"] == "existing"]
        earlier_new = [x for x in r["duplicates"] if x["where"] == "new" and x["with"] < job]
        r["duplicate_flag"] = (
            "existing" if dup_existing else ("new (kept the earlier id)" if earlier_new else "")
        )
        r["usable_answer_key"] = bool(r["symbol_kinds"]) and not r["duplicate_flag"]
        jobs.append(r)
        print(f"{job}: {r['pages']} pages, marked {len(r['marked_pages'])},", end=" ")
        print(
            f"symbols {r['symbol_kinds']}, unmapped {sum(r['unmapped_prefixes'].values())},",
            end=" ",
        )
        dup = r["duplicate_flag"] or "no"
        print(f"summary {'yes' if r['summary'] else 'no'}, dup {dup}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(jobs, indent=1, default=str))
    locked = [r for r in jobs if r["duplicate_flag"] == ""]
    LOCK.write_text(
        json.dumps(
            {
                "set": "held-out TEST (phase 12e intake)",
                "rule": "no tuning, threshold choice or rule change may look at their detection"
                " results; only used to report pre-registered measures",
                "jobs": {
                    r["job"]: {
                        "drawing_sha256": mapping["jobs"][r["job"]]["drawing_sha256"],
                        "markup": mapping["jobs"][r["job"]]["markup"],
                        "markup_sha256": mapping["jobs"][r["job"]]["markup_sha256"],
                    }
                    for r in locked
                },
                "left_out_as_duplicates": [r["job"] for r in jobs if r["duplicate_flag"]],
            },
            indent=1,
        )
    )
    DOC.write_text(report(jobs, firm_manual(mapping)))
    print(f"jobs {len(jobs)} | locked {len(locked)}", end=" | ")
    print(f"wrote {OUT.relative_to(ROOT)}, {DOC.relative_to(ROOT)}, {LOCK.relative_to(ROOT)}")


def _row(r: dict) -> str:
    sym, s = r["symbol_kinds"], r["summary_counts"]
    box = r["summary"]
    rule = {"yellow_freetext": "yellow", "front_sheet_keywords": "front sheet"}.get(
        (box or {}).get("rule"), ""
    )
    cells = [
        r["job"],
        str(r["pages"]),
        f"{r['page_kinds'].get('vector', 0)} / {r['page_kinds'].get('scanned', 0)}",
        f"{r['text'].get('real', 0)} / {r['pages'] - r['text'].get('real', 0)}",
        str(len(r["marked_pages"])),
        " / ".join(str(sym.get(k, 0)) for k in KINDS)
        + f" / {sum(r['unmapped_prefixes'].values())}",
        f"yes, p{box['page_index'] + 1} ({rule})" if box else "no",
        (" / ".join(str(s.get(k, 0)) for k in (*KINDS, "other")) if box else "—")
        + (" (odd: ~)" if r["summary_odd"] else ""),
        str(r["calibrated_pages"]),
        r["firm"],
        r["duplicate_flag"] or "no",
    ]
    return "| " + " | ".join(cells) + " |"


INTRO = """\
# Markups intake (Phase 12e): the locked held-out TEST set

Local only (docs/ is not in git). Job ids and firm ids only; names are in the git-ignored
fixtures/private/markups/MAPPING.json. Read-only analysis by
`worker/tools/markups_intake.py`; the detection engine was not run on these jobs.

Files: drawing `fixtures/private/markups/job-0NN.pdf` (listed in inventory_map.csv, item
set-C, so `drawing_documents()` finds it); markup
`fixtures/private/takeoffs/takeoff-NN.pdf` (job-036 = takeoff-23 ... job-049 =
takeoff-36; in inventory.json with match and page_map, and in PRIVATE_MAP.csv). All
read-only. Locked list: fixtures/private/markups/heldout_test.lock.

Rules: symbol kinds only from the owner-named prefixes B (beam), C (column), VB / HB
(brace); every other prefix is unmapped (no company-wide mapping exists yet). Summary
box: a yellow FreeText with count pairs, else a front-sheet FreeText with ESTIMATED BY /
INCLUDES / INCLUSIONS. Firm: the hand-filled `firm_manual` of each job in MAPPING.json
(an id such as firm-A), else firm-?; never detected or guessed. The private `firm_names`
map (id -> name) is never read here.
Text none = a vector page without a text layer (text drawn as paths, or no text).
"""


NOTES = """\
## Notes

- Braces: the summary boxes list braces on most jobs, but brace COUNT symbols (VB / HB
  polygons) exist only on job-049; on the other jobs braces are not marked as count symbols
  with these prefixes. The brace column is therefore not an answer key on those jobs.
- job-036 has count symbols only under unmapped prefixes and a summary box with other kinds
  only: not usable as a column / beam answer key.
- Page maps: a markup page without a text layer has no page-map entry (the existing loader
  rule); 19 such pages in 3 jobs.
- Lock in code (tools/jobs.py): the shared loaders (`drawing_documents()`,
  `takeoff_files()`, `takeoff_inventory()`) return DEV jobs only; the locked jobs only with
  `--include-test --prereg <document>`, which prints a warning. tools/takeoff/inventory.py
  keeps the locked entries of inventory.json unchanged when it regenerates the file.
"""


HEADER = (
    "| Job | Pages | Vector / scanned | Text real / none | Marked pages"
    " | Symbols C / B / Br / unmapped | Summary box (rule) | Summary C / B / Br / other"
    " | Calibrated pages | Firm | Duplicate |"
)


def report(jobs: list[dict], manual: dict[str, str | None]) -> str:
    jobs = [{**r, "firm": firm_label(manual.get(r["job"]))} for r in jobs]
    lines = [
        INTRO,
        HEADER,
        "|---|---|---|---|---|---|---|---|---|---|---|",
        *(_row(r) for r in jobs),
        "",
        totals(jobs),
        "",
        NOTES,
    ]
    return "\n".join(lines) + "\n"


def _count(jobs: list[dict], pred) -> int:
    return sum(1 for r in jobs if pred(r))


def totals(jobs: list[dict]) -> str:
    kinds: collections.Counter = collections.Counter()
    unmapped: collections.Counter = collections.Counter()
    for r in jobs:
        kinds.update(r["symbol_kinds"])
        unmapped.update(r["unmapped_prefixes"])
    firms = sorted({r["firm"] for r in jobs})
    named = [f for f in firms if FIRM_ID.match(f)]
    unresolved = _count(jobs, lambda r: not FIRM_ID.match(r["firm"]))
    per_firm = ", ".join(f"{f} {_count(jobs, lambda r, f=f: r['firm'] == f)}" for f in firms)
    usable = [r["job"] for r in jobs if r["usable_answer_key"]]
    not_usable = [r["job"] for r in jobs if not r["usable_answer_key"]]
    disagree = [r for r in jobs if r["summary_vs_symbols"]]
    diffs = "; ".join(
        r["job"]
        + " "
        + ", ".join(
            f"{k} {v['summary']} vs {v['symbols']}" for k, v in r["summary_vs_symbols"].items()
        )
        for r in disagree
    )
    dups = [f"{r['job']} {r['duplicate_flag']}" for r in jobs if r["duplicate_flag"]]
    pages = sum(r["pages"] for r in jobs)
    scanned = sum(r["page_kinds"].get("scanned", 0) for r in jobs)
    no_text = sum(r["pages"] - r["text"].get("real", 0) for r in jobs)
    no_text_jobs = _count(jobs, lambda r: r["pages"] > r["text"].get("real", 0))

    def rule_n(rule: str) -> int:
        return _count(jobs, lambda r: (r["summary"] or {}).get("rule") == rule)

    out = [
        "## Totals",
        "",
        f"- Jobs: {len(jobs)}; pages {pages}: scanned (raster) {scanned}; vector pages without a"
        f" real text layer {no_text} (in {no_text_jobs} jobs).",
        f"- Firms of record: {len(named)} distinct"
        + (
            f", plus {unresolved} job(s) without a hand-filled firm id (firm-?)"
            if unresolved
            else ""
        )
        + f"; jobs per firm: {per_firm}.",
        f"- Count marks: columns {kinds.get('column', 0)}, beams {kinds.get('beam', 0)},"
        f" braces {kinds.get('brace', 0)}; unmapped {sum(unmapped.values())} over"
        f" {len(unmapped)} prefixes (incl. symbols without a tag).",
        f"- Marked pages: {sum(len(r['marked_pages']) for r in jobs)}; markup pages with an"
        f" estimator calibration: {sum(r['calibrated_pages'] for r in jobs)}.",
        f"- Summary box found: {_count(jobs, lambda r: r['summary'])} of {len(jobs)} (yellow"
        f" {rule_n('yellow_freetext')}, front sheet {rule_n('front_sheet_keywords')});"
        f" with an odd value (~) {_count(jobs, lambda r: r['summary_odd'])}.",
        f"- Summary box differs from the symbol count (column, beam or brace):"
        f" {len(disagree)} job(s)" + (f": {diffs}" if disagree else "") + ".",
        f"- Duplicates: {len(dups)}" + (f" ({', '.join(dups)})" if dups else "") + ".",
        f"- Usable as answer keys (column or beam or brace symbols, not a duplicate):"
        f" {len(usable)} of {len(jobs)}"
        + (f"; not usable: {', '.join(not_usable)}" if not_usable else "")
        + ".",
    ]
    return "\n".join(out)


def main(argv: list[str]) -> None:
    if not argv or argv[0] not in ("place", "inventory", "report"):
        print(__doc__)
        return
    if argv[0] == "place":
        place("--apply" in argv)
    elif argv[0] == "report":  # the doc again from the saved JSON (no re-read of the PDFs)
        DOC.write_text(
            report(json.loads(OUT.read_text()), firm_manual(json.loads(MAPPING.read_text())))
        )
    else:
        inventory()


if __name__ == "__main__":
    main(sys.argv[1:])
