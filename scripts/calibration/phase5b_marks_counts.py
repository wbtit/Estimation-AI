"""Counts of marks, legend rows and schedule rows for one project (Phase 5b item 9). Counts only.

Needs the API running and the project's text read. Uses the worker's own parsers so the counts are
what the production legend builder sees.

usage (from worker/):  .venv/bin/python ../scripts/calibration/phase5b_marks_counts.py <project id>
"""

from __future__ import annotations

import collections
import json
import sys
import urllib.request

from src.review.legend import WordBox, _segments, legend_rows
from src.text_layer.parsers.marks import MARK_RE
from src.text_layer.parsers.profile import find_profiles

API = "http://127.0.0.1:3000"


def get(path: str):
    return json.loads(urllib.request.urlopen(API + path, timeout=300).read())


def clean(token: str) -> str:
    return token.strip(",;:()[]\"'=-").upper()


def main(pid: str) -> None:
    sheets = get(f"/api/projects/{pid}/sheets")["sheets"]
    legend = get(f"/api/projects/{pid}/legend")["rows"]
    by_mark: dict[str, set[str]] = collections.defaultdict(set)
    for r in legend:
        by_mark[r["mark"]].add(r["profile"] or r["designation_raw"])
    types = collections.Counter(s["page_type"]["effective"] for s in sheets)
    print("pages by type:", dict(types))
    plan_occ = collections.Counter()
    schedule_pages = []
    mention_pages: list[int] = []
    row_stats = collections.Counter()
    for s in sheets:
        if s["page"]["kind"] != "vector":
            continue
        items = get(f"/api/projects/{pid}/sheets/{s['id']}/text-items")["items"]
        words = [WordBox(i["text"], *(i["bbox"][k] for k in ("x0", "y0", "x1", "y1"))) for i in items if i["level"] == "word"]
        lines = [i["text"].upper() for i in items if i["level"] == "line"]
        eff = s["page_type"]["effective"]
        if eff == "framing_plan":
            for w in words:
                t = clean(w.text)
                if MARK_RE.match(t) and not find_profiles(w.text):
                    plan_occ[t] += 1
        mentions = any("COLUMN" in ln for ln in lines) and any("SCHEDULE" in ln for ln in lines)
        if mentions:
            mention_pages.append(s["page_number"])
        # a column schedule page: the page type guess says schedule/legend AND the words COLUMN and SCHEDULE are on it
        is_column_schedule = mentions and eff == "schedule_legend"
        if is_column_schedule:
            schedule_pages.append(s["page_number"])
            parsed = {(r.mark, r.designation_raw) for r in legend_rows(words)}
            for seg in _segments(words):
                toks = [clean(w.text) for w in seg]
                has_mark = any(MARK_RE.match(t) for t in toks)
                if not has_mark or len(seg) < 2:
                    continue
                if find_profiles(" ".join(w.text for w in seg)):
                    row_stats["rows with a mark and a profile on the same text row"] += 1
                else:
                    row_stats["rows with a mark and no profile on the same text row (mark-only)"] += 1
            row_stats["legend rows built from these pages"] += len(parsed)
    distinct = list(plan_occ)
    linked = sum(1 for m in distinct if len(by_mark.get(m, ())) == 1)
    ambiguous = sum(1 for m in distinct if len(by_mark.get(m, ())) > 1)
    nolegend = sum(1 for m in distinct if not by_mark.get(m))
    print(f"mark-shaped words on framing plan pages: {sum(plan_occ.values())} occurrences, {len(distinct)} distinct marks")
    print(f"legend rows in the document: {len(legend)} rows, {len(by_mark)} distinct marks")
    print(f"distinct plan marks: linked (one designation) {linked}, ambiguous (several) {ambiguous}, no legend row {nolegend}")
    print(f"pages with the words COLUMN and SCHEDULE (any page type): {len(mention_pages)}")
    print(f"column schedule pages (schedule/legend by the page type guess AND those words): {len(schedule_pages)} -> pages {schedule_pages}")
    print("schedule-page rows:", dict(row_stats))
    members = get(f"/api/projects/{pid}/members?include_deleted=true")["members"]
    mm = [m for m in members if m["mark"]]
    print(f"members made from marks in the reviewed views: {len(mm)}", dict(collections.Counter(m["mark_ref"]["status"] for m in mm)))


if __name__ == "__main__":
    main(sys.argv[1])
