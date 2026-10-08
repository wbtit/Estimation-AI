"""Generic word and pattern counts from the text layer, per document (counts only, no strings).

    text_counts.py --jobs job-002,job-004 --out fixtures/private/study/text_counts.json
Counts joist designations (K, LH, DLH series are not AISC shapes), deck and stud notes, camber,
TYP/SIM/UNO notes, quantity prefixes, elevation notes and generic miscellaneous-steel words.
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
from src.pdf_scan.scale import normalize  # noqa: E402
from src.text_layer.parsers.elevation import find_elevations  # noqa: E402
from src.text_layer.parsers.profile import find_profiles  # noqa: E402

PATTERNS = {
    "joist_k_series": r"\b\d{1,2}K\d{1,2}\b",
    "joist_lh_series": r"\b\d{2}LH\d{2}\b",
    "joist_dlh_series": r"\b\d{2}DLH\d{2}\b",
    "word_joist": r"\bJOISTS?\b",
    "deck_word": r"\bDECK(?:ING)?\b",
    "deck_gauge": r"\b\d{2}\s?GA\b",
    "stud_note": r"\bSTUDS?\b",
    "camber_word": r"\bCAMBER\b",
    "typ_sim_uno": r"\bTYP\b|\bSIM\b|\bU\.?N\.?O\.?\b",
    "quantity_prefix_profile": r"\(\d+\)\s*(?:W|M|S|HP|C|MC|L|WT|HSS|PL)\s?\d",
    "brace_word": r"\bBRAC(?:E|ES|ED|ING)\b",
    "stair_word": r"\bSTAIRS?\b",
    "handrail_word": r"\b(?:HANDRAIL|GUARDRAIL|RAILING)S?\b",
    "lintel_word": r"\bLINTELS?\b",
    "embed_word": r"\bEMBEDS?\b",
    "column_word": r"\bCOLUMNS?\b",
    "schedule_word": r"\bSCHEDULE\b",
    "legend_word": r"\bLEGEND\b",
}
RX = {k: re.compile(v, re.IGNORECASE) for k, v in PATTERNS.items()}


def count_doc(job: str) -> dict:
    acc: Counter = Counter()
    with common.open_doc(job) as doc:
        for i in common.large_pages(doc):
            text = normalize(doc[i].get_text("text").replace("\n", " "))
            acc["pages"] += 1
            for k, rx in RX.items():
                n = len(rx.findall(text))
                acc[k] += n
                acc[f"pages_with_{k}"] += n > 0
            acc["profiles"] += len(find_profiles(text))
            acc["elevation_notes"] += len(find_elevations(text))
    return dict(acc)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    out = {j: count_doc(j) for j in args.jobs.split(",")}
    args.out.write_text(json.dumps(out, indent=1))
    for j, c in out.items():
        print(j, {k: v for k, v in c.items() if not k.startswith("pages_with")})


if __name__ == "__main__":
    main()
