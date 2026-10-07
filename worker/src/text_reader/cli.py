"""Glyph library CLI. Run from the worker directory:

python -m src.text_reader.cli contact-sheets --font-id F [--out DIR]
python -m src.text_reader.cli export-csv --font-id F --out FILE [--all]
python -m src.text_reader.cli import-csv --file FILE --reviewer NAME [--dry-run]
python -m src.text_reader.cli revoke-labels --who NAME [--font-id F] [--dry-run]
python -m src.text_reader.cli summary --font-id F
python -m src.text_reader.cli vote --pdf FILE --font-id F [--ground-truth FILE]   (needs OCR extra)
python -m src.text_reader.cli truth-template --pdf FILE [--out FILE]
python -m src.text_reader.cli truth-accept [--truth FILE]
python -m src.text_reader.cli evaluate --pdf FILE --font-id F [--truth FILE] [--ocr]
"""

import argparse
import sys
from pathlib import Path

from src.config import load_config
from src.db import connect
from src.text_reader import glyph_admin, harness
from src.text_reader.library import load_entries

PRIVATE = Path("fixtures/private")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.text_reader.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("contact-sheets", help="PNG sheets of unlabeled glyph groups")
    p.add_argument("--font-id", required=True)
    p.add_argument("--out", type=Path, default=PRIVATE / "glyph_sheets")
    p.add_argument("--per-sheet", type=int, default=48)
    p.add_argument("--limit", type=int)
    p.add_argument("--no-guess", action="store_true", help="hide the OCR guess (shape only)")
    p.add_argument("--dpi", type=int, default=100)

    p = sub.add_parser("revoke-labels", help="un-confirm all labels confirmed by one reviewer")
    p.add_argument("--who", required=True)
    p.add_argument("--font-id")
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("export-csv", help="write the review CSV (OCR proposals pre-filled)")
    p.add_argument("--font-id", required=True)
    p.add_argument("--out", type=Path, default=PRIVATE / "glyph_review.csv")
    p.add_argument("--all", action="store_true", help="include confirmed groups")

    p = sub.add_parser("import-csv", help="apply your label/status edits")
    p.add_argument("--file", type=Path, default=PRIVATE / "glyph_review.csv")
    p.add_argument("--reviewer", required=True)
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("summary", help="counts of proposed and confirmed groups")
    p.add_argument("--font-id", required=True)

    p = sub.add_parser("vote", help="propose labels by OCR majority vote (optional OCR extra)")
    p.add_argument("--pdf", type=Path, required=True)
    p.add_argument("--font-id", required=True)
    p.add_argument("--ground-truth", type=Path, default=harness.DEFAULT_TRUTH)

    p = sub.add_parser("truth-template", help="write a stratified 60-line ground-truth template")
    p.add_argument("--pdf", type=Path, required=True)
    p.add_argument("--out", type=Path, default=harness.DEFAULT_TRUTH)
    p.add_argument(
        "--regenerate", action="store_true", help="replace a template with no truth filled"
    )

    p = sub.add_parser("truth-accept", help="copy reviewed drafts and corrections into truth_text")
    p.add_argument("--truth", type=Path, default=harness.DEFAULT_TRUTH)

    p = sub.add_parser("evaluate", help="accuracy against your ground truth")
    p.add_argument("--pdf", type=Path, required=True)
    p.add_argument("--font-id", required=True)
    p.add_argument("--truth", type=Path, default=harness.DEFAULT_TRUTH)
    p.add_argument("--ocr", action="store_true")

    args = ap.parse_args(argv)
    config = load_config()

    if args.cmd == "truth-template":
        try:
            res = harness.write_template(args.pdf, args.out, regenerate=args.regenerate)
        except FileExistsError as err:
            print(err, file=sys.stderr)
            return 1
        print(f"wrote {res['total']} lines to {args.out} (truth_text left blank for you to fill)")
        print(f"per category: {res['per_category']}")
        print(f"shortfall (filled with random lines): {res['shortfall'] or 'none'}")
        return 0

    if args.cmd == "truth-accept":
        if not args.truth.exists():
            print(f"{args.truth} does not exist", file=sys.stderr)
            return 1
        c = harness.truth_accept(args.truth)
        print(
            f"accepted as is: {c['accepted']}, corrected: {c['corrected']}, "
            f"left empty (excluded from scoring): {c['left_empty']}, "
            f"already filled (unchanged): {c['already_filled']}"
        )
        return 0

    with connect(config.database_url) as conn:
        if args.cmd == "contact-sheets":
            paths = glyph_admin.contact_sheets(
                conn,
                args.font_id,
                args.out,
                args.per_sheet,
                args.limit,
                show_guess=not args.no_guess,
                dpi=args.dpi,
            )
            print(f"wrote {len(paths)} sheet(s) to {args.out}")
        elif args.cmd == "revoke-labels":
            n = glyph_admin.revoke_labels(conn, args.who, args.font_id, args.dry_run)
            print(f"{'would revoke' if args.dry_run else 'revoked'} {n} label(s) by {args.who}")
        elif args.cmd == "export-csv":
            n = glyph_admin.export_csv(conn, args.font_id, args.out, only_unconfirmed=not args.all)
            print(f"wrote {n} rows to {args.out}")
        elif args.cmd == "import-csv":
            res = glyph_admin.import_csv(conn, args.file, args.reviewer, args.dry_run)
            for e in res.errors:
                print(f"error: {e}", file=sys.stderr)
            if res.errors:
                print("refusing to import: nothing was changed", file=sys.stderr)
                return 1
            verb = "would apply" if args.dry_run else "applied"
            print(f"{verb} {res.applied}, unchanged {res.unchanged}")
        elif args.cmd == "summary":
            print(glyph_admin.summarize(conn, args.font_id))
        elif args.cmd == "vote":
            from src.text_reader.ocr import RapidOcrEngine
            from src.text_reader.vote import vote_pdf

            result = vote_pdf(
                conn,
                args.pdf,
                args.font_id,
                RapidOcrEngine(),
                harness.exclusions(args.ground_truth),
            )
            print(result)
        elif args.cmd == "evaluate":
            if not args.truth.exists():
                print(f"{args.truth} does not exist; run truth-template first", file=sys.stderr)
                return 1
            engine = None
            if args.ocr:
                from src.text_reader.ocr import RapidOcrEngine

                engine = RapidOcrEngine()
            entries = load_entries(conn, args.font_id)
            report = harness.evaluate(args.pdf, args.truth, entries, args.font_id, engine)
            harness.save_report(report, PRIVATE / "harness_report.json")
            for k, v in report.items():
                print(f"{k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
