# Phase 9 Part B: can the 16 Bluebeam markups give quantity ground truth?

Read-only. Definitions were fixed before the run in `docs/PHASE9_PREREGISTRATION.md` (committed first). Tools: `worker/tools/takeoff/phase9_lib.py`, `phase9_markups.py` (fields), `phase9_derived.py` (derived route and totals); synthetic tests in `worker/tests/test_phase9_lib.py`. Counts and patterns only: no annotation text, subject string, author, layer name or file name is in this document. Per-file summaries are in the git-ignored `fixtures/private/takeoffs/phase9_fields.json` and `phase9_derived.json`.

## Answer
**No, not for sizes. The markups carry no steel size in any field. They are count-and-place evidence at best.** Pre-registered rule (a whole-value size on at least 50% of the count symbols or their tags in at least 10 of 16 files): **not met by any field** (best: 0.1%). No secondary candidate qualified either (Highlights 17% whole-value, Squares 2.5%). So no size tables were built from a field.
The derived route (size taken from our text layer next to each symbol) agrees with the finished takeoff of job-018 on 37% of their sizes within 20%, the weight is 59% low: **not usable**, no better than counting labels (Phase 8: 32%, 33% low).
Seen the other way, the symbols do hold a great deal of the estimator's piece count: 372 symbols on our pages of job-018 against 463 pieces in the finished takeoff (0.80). That is evidence about where and how many, not which size.

## B1. Fields present (16 files, 20,835 markups; 4,373 count symbols lie on pages that map to a page of ours)
Count symbol = Polygon with 3 or 8 vertices (5,323 in all files, 4,373 on mapped pages). Tag = FreeText (5,528). 4,873 tags are linked to a symbol by the reply-to entry, 368 more by "nearest symbol within 60 pt", 287 are not linked.

| subtype (all files) | markups | Subject filled | Contents filled | rich text | any size, whole value (Subject / Contents) | any size, contained in text (Contents) |
|---|---|---|---|---|---|---|
| Polygon, count symbol | 5,323 | 100% | 2.9% | = Contents | 0% / 0% | 0% |
| Polygon, other | 1,402 | 100% | 72% | = Contents | 0% / 0% | 0% |
| FreeText (tag) | 5,528 | 100% | 100% | = Contents | 0% / **0.1%** (6 markups) | 0.1% |
| Square | 5,769 | 47% | 52% | empty | 0% / 2.5% | 3.5% |
| Highlight | 597 | 100% | 93% | 1.7% | 0% / **17.1%** | 37.2% |
| Line | 1,500 | 100% | 16% | = Contents | 0% / 0% | 0% |
| Ink | 591 | 100% | 6% | empty | 0% / 0% | 0% |
| Circle | 119 | 100% | 0% | empty | 0% / 0% | 0% |

- **Subject** is a Bluebeam tool name (7 to 52 distinct short values across the whole set per subtype): never a size.
- **Contents of a tag** is a mark code, unique per symbol (5,345 distinct among 5,528): **letters followed by a number on 4,841 of the 4,873 reply-linked tags (99.3%)**. It is not a size. The 14 most common prefixes (one to three letters; the letters are not listed here) cover 96.5% of them; the largest two cover 64%.
- **Custom columns** (15 slots, `BSIColumnData`; slot names are not stored in the PDF): the only slots filled on symbols and tags are slot 08 (the text `0`) and slot 13 (the text `0.00`), both on 3,344 symbols and nowhere else with another value; slot 00 holds one numeric value on 174 symbols (one file). **No slot holds a size or a varying quantity.** (Correction of the Phase 5t reading "looks like a quantity of 1 per symbol": the two numeric slots are constant zero defaults; a symbol means one piece by convention, not by data.)
- **Layer entry**: on 1.4% of tags and 5.5% of non-count polygons, none elsewhere. **Author** is filled on 100%.
- **Colour** (stroke and fill): count symbols use 4 to 16 distinct colour pairs per file (median 11).
- **Highlights**: 597 markups in 10 of 16 files; 37% of their comments contain a size and 17% are a size alone (21% and 45% on mapped pages). They mark a label the estimator wanted to point at; a highlight is not a count of pieces. Only 2 of the 10 files have more than half of their highlights carrying a whole-value size.

Same table for the 4,373 symbols and 4,573 tags on mapped pages: the same pattern (symbols 0.5% filled contents, tags 100%, no size on any).

## B1 exploratory (post-hoc, not pre-registered): colour and mark prefix
On the 4,841 reply-linked tags with a letters-and-number code, the prefix letters equal the most common prefix of the **same page and the same symbol colour** on **99.6%** of the 4,441 tags that sit in a (page, colour) group of five or more (373 groups); by Subject instead of colour: 86.7% (4,691 tags in 243 groups). Reading: estimators use one colour per kind of member and the mark letters follow the colour. This is evidence for **kind** (what a symbol is), not for size. Groups of fewer than five are left out because a group of one is trivially pure. One set of jobs; the meaning of a letter (beam, column, ...) is the estimators' and is not mapped here.

## B2. Derived route: size from our text layer, count and place from the markup
Each count symbol on a mapped page takes the canonical size of the nearest size text line of the drawing PDF within 80 pt (the copilot's nearest-label rule), quantity 1. Size text lines: PyMuPDF lines containing a steel size of the registered pattern classes.

| | symbols on our pages | with a size within 80 pt | without |
|---|---|---|---|
| all 16 jobs | 4,373 | 2,824 (64.6%) | 1,549 |
| range by job | 56 to 992 | job-006: 0 of 246 (stroke lettering, no text layer); job-014: 6 of 117; job-002: 82 of 88 | |
| job-018 | 372 | 227 (61%) | 145 |

950 further symbols lie on takeoff pages that map to no page of ours and are not used.

### Cross-check, job-018 (the only job with a finished quantity takeoff; one project, wide uncertainty)
Ground truth as in Phase 8 (profile rows, main steel, 463 pieces in 19 sizes; weights are counts times AISC unit weight, edition aisc-v16.0). Inch and foot marks are removed from both sides before comparing plate sizes (a formatting difference found when the first run showed plates as missing; the result did not change).

| | derived (markups + our labels) | Phase 8 linked count | Phase 8 naive labels |
|---|---|---|---|
| their sizes exact | 21% | | |
| within ±1 | 32% | | |
| **within 20%** | **37%** | 21% | 32% |
| quantity error rate | 58% | | |
| ours total / theirs total | 227 / 463 | | |
| their sizes we never find | 5 (25% of their pieces) | | |
| sizes we add that they do not have | 1 (5% of ours) | | |
| weight error (signed) | **-59%** | -49% | -33% |
| reading (Phase 8 bars) | **not usable** | not usable | not usable |

Per sheet (the 7 pages that hold only single-page rows): 50% of (page, size) keys within 20% (n = 18), but ours 190 against theirs 139: single-page rows are a biased subset (a row on several pages cannot be split).

### Total count, no size needed (job-018)
- Symbols on our pages 372 (350 on pages that the workbook references) against 463 pieces: **ratio 0.80** (0.76 on referenced pages).
- On the 7 pages with single-page rows only: symbols 229 against 139 (rows spread over more pages are missing from the sum, so this over-reads): 1 page exact, 2 within 20%, of 7.
- Largest sizes of theirs and ours (family, theirs, ours): HSS 110 / 64, HSS 62 / **0**, HSS 55 / 33, HSS 45 / 8, W 28 / **0**, HSS 27 / 8, HSS 23 / 23, W 19 / 22, W 15 / 16. The 62-piece size is not found even with the estimators' own symbols next to our labels (Part C asks why).

## What is proven, likely, unknown
- **Proven (counts above):** no annotation field of these 16 files holds a steel size on a count symbol or tag; the custom columns hold constant defaults; mark codes are letters plus number; colour tracks the mark prefix; the derived route does not beat naive label counting on the one job where it can be checked.
- **Likely:** the markups are good evidence of how many pieces were counted and where (0.80 of the pieces on job-018), and of kind (colour, prefix). A symbol-per-piece reading is consistent with the data but one symbol may stand for several (the 62-piece size has rows of 26 to 30).
- **Unknown:** whether symbols equal pieces on other jobs (no other finished takeoff); what the prefix letters mean; whether the 145 unsized symbols on job-018 are on labels our reader misses or on members that carry no label near them; the 950 symbols on pages outside our document.
- **Limits:** one job for any quantity agreement; the 80 pt rule is the copilot's, not tuned; the sized fraction depends on our text layer (stroke-lettered jobs get none).
