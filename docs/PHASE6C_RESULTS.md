# Phase 6c results: two jobs with no matches, what sits under the missed symbols, scope against detection

Pre-registration: `docs/PHASE6C_PREREGISTRATION.md` (committed before any measurement). This phase is a DIAGNOSTIC: no count rule was built, nothing was trained, the frozen linking code is untouched, no LLM, nothing pushed. Part D (housekeeping) is NOT done: it needs the owner's approval in chat (see the end).

## 0. A correction to Phase 6b (read this first)
In the Phase 6b tool the test "a line within 24 pt of the symbol" uses only the structural lines of the worker's SUGGESTED class of the view, not every extracted line. So the 2,078 symbols (47.5%) that `docs/PHASE6B_RESULTS.md` calls "no extracted line within 24 pt" are, exactly, "no line of the suggested class within 24 pt". The extractor keeps many lines of other classes near most of them (section 3). The Phase 6b conclusions that were built on the wording ("the lines are not where the estimators count", the third row of its decision table) are therefore not supported as written; section 6 gives the revised reading. The Phase 6b figures themselves (P, R, F1, pages equal) are unchanged and correct. The population was reproduced exactly from the stored PDFs: 2,078 symbols, 0 disagreements with the stored Phase 6b flags.

## 1. Part A: job-006 (zero pieces)
Stage trace on the PDF the API stored for the job (read-only, all 11 pages; counts per page):

| stage | result |
|---|---|
| 1 stored PDF | opens; 11 pages; rotation 270 on all |
| 2 text layer | 69 to 193 text lines per page (database holds the same); source `pdf_text`, quality 1.0 on every page |
| 3 label parse (profile labels) | **0 on every page**, before and after the view box |
| 4 view | a whole-sheet view exists on every page, a suggested class is set |
| 5 lines | 3,000 to 49,915 extracted lines per page; 12 to 3,902 structural lines of the suggested class |
| 6 link | 0 labels, so 0 candidates, 0 proposals |
| 7 members | 0 rows; the scan and auto-run jobs both completed with no error |

**The stage where pieces disappear is label parse (stage 3), because there are no profile labels in the text layer.** The page text holds the sheet titles, grid bubbles and callout tags (fonts Arial, Times, Garamond and a CAD lettering font); the beam sizes the estimators count are drawn as stroked letters, not text. On page 6 the stroke reader finds 8,932 character clusters and 310 text lines, none readable: the glyph library holds 864 entries and 0 are confirmed (all `proposed`), so every glyph decodes as unknown. The text reader's rule is one reader per page: a page with a usable PDF text layer uses it (`pdf_text`) and the stroke reader is not run. Both conditions apply to this job.

**This is not a coding bug**; it is the designed either-or reader rule meeting a drawing set that mixes real text with stroked lettering. So nothing was fixed and nothing was re-run. What it would take (not done): run the stroke reader on pages whose text layer has no profile label, and have a person confirm glyphs of that lettering font. Size of the effect: job-006 holds 246 of the 382 symbols on pages where the label-first basis made no piece (16 pages in all, 6 of them job-006); the other 10 pages are in 8 other jobs and were not traced.

## 2. Part A: job-014 (27 pieces, none within 12 pt)
- **Frame is not the cause.** For all 8 pages with symbols, and for all 136 pages of the 16 jobs: the marked-up page and the stored page have the same size, rotation and MediaBox and CropBox. On 6 of the 8 pages the text of the two files aligns exactly (105 to 205 words, shift 0.0 pt, scale 1.0, residual 0.0).
- **Page index map is uncertain on 2 of the 8 pages (38 of 117 symbols, 32%).** For takeoff pages 7 and 10 the Phase 5t map says drawing pages 6 and 9, while the text alignment prefers pages 7 and 10 (164 and 204 matching words at shift 0, against 162 and 201 at a constant shift of (193.2, 53.2) and (145.0, -7.2) pt: neighbouring sheets that carry the same words). A geometry test settles neither: on page 7 the symbols fit the mapped page far better than the text-preferred one (27 of 28 against 0, oracle class, label-first); on page 10 the text-preferred page fits better (3 against 0). **I therefore call these pages uncertain, not wrong.**
- **All 4 jobs with such cases (post hoc audit, all jobs):** the same text test disagrees with the map on 13 mapped pages (job-005: 6, job-006: 2, job-014: 2, job-019: 3), 142 symbols, 3.2% of the 4,373. A geometry test on those 13 pages is mixed (the mapped page fits better on some, the text-preferred page on others, ties on most). The Phase 6b figures are kept; a corrected-map census is given as a sensitivity in section 3 and changes nothing material.
- **Why no match.** The suggested class on each page (for example a 0.5 to 1 pt solid class with 145 lines on page 7) is not where the linked labels' members are: the 27 pieces lie 28 to 1,960 pt from the nearest symbol and none is within 12 pt. With the best class per page chosen after seeing their symbols (oracle, an upper bound), label-first reaches 27 of 28 symbols of page 7 through 36 pieces, so the members ARE found by a different class; on all the other pages together the oracle finds only 6 matches (of 89 symbols). **Cause: class choice (the suggested class is wrong for this job); the symbol-to-page map is uncertain on 2 pages; a part is unknown.**

## 3. Part B: census of what sits under the missed symbols
Population: the 2,078 symbols with no line of the SUGGESTED class within 24 pt (4,373 symbols in all). All counts come from `get_drawings()` on the stored PDFs. Exclusive categories in the pre-registered order (0, a, c, b, d).

| category | all 2,078 | without the two largest jobs (1,639) | corrected-map sensitivity (2,038) |
|---|---|---|---|
| 0 an extracted line of another class within 24 pt | 1,459 (70.2%) | 1,070 (65.3%) | 1,434 (70.4%) |
| a geometry the extractor drops within 24 pt | 120 (5.8%) | 118 (7.2%) | 111 (5.4%) |
| c image region | 108 (5.2%) | 108 (6.6%) | 108 (5.3%) |
| b only text within 24 pt | 28 (1.3%) | 19 (1.2%) | 34 (1.7%) |
| d nothing within 24 pt | 363 (17.5%) | 324 (19.8%) | 351 (17.2%) |

Per job (shares of that job's missed symbols; n in brackets):

| job | n | 0 | a | c | b | d |
|---|---|---|---|---|---|---|
| job-002 | 81 | 67.9% | 0 | 32.1% | 0 | 0 |
| job-003 | 81 | 69.1% | 7.4% | 0 | 0 | 23.5% |
| job-004 | 42 | 78.6% | 0 | 0 | 4.8% | 16.7% |
| job-005 | 178 | 29.2% | 14.0% | 46.1% | 2.2% | 8.4% |
| job-006 | 208 | 56.2% | 1.9% | 0 | 0 | 41.8% |
| job-008 | 67 | 67.2% | 6.0% | 0 | 1.5% | 25.4% |
| job-010 | 56 | 78.6% | 7.1% | 0 | 0 | 14.3% |
| job-011 | 32 | 100% | 0 | 0 | 0 | 0 |
| job-012 | 267 | 92.5% | 0.4% | 0 | 1.5% | 5.6% |
| job-013 | 102 | 79.4% | 3.9% | 0 | 0 | 16.7% |
| job-014 | 114 | 69.3% | 3.5% | 0 | 0 | 27.2% |
| job-015 | 172 | 82.6% | 0.6% | 0 | 2.9% | 14.0% |
| job-017 | 250 | 78.8% | 9.6% | 0 | 3.6% | 8.0% |
| job-018 | 238 | 64.3% | 11.8% | 0 | 1.3% | 22.7% |
| job-019 | 67 | 79.1% | 1.5% | 0 | 0 | 19.4% |
| job-020 | 123 | 59.3% | 11.4% | 0 | 0 | 29.3% |

Details:
- **Category 0.** Nearest extracted line at most 6 pt: 713 (49%); 6 to 12 pt: 335 (23%); 12 to 24 pt: 411 (28%); median 6 extracted lines within 24 pt. The nearest line is a thin class in 75% of cases (width under 0.5 pt: 1,092 of 1,459); heavy lines (1 pt and more) in 11%.
- **Category a (120).** Nearest dropped primitive: filled shape 103, curve 13, quad 4. Over all primitives within 24 pt of the 890 symbols that have any dropped primitive: 16,094 dropped (filled non-thin shapes 9,090 = 56%; degenerate stroked lines under 0.05 pt, drawn dots, 6,190 = 38%; curves 571; quads 243). Stroke or fill: fill-only 9,090; stroke 6,983; both 21. 9,334 of the dropped primitives belong to paths of more than 20 items (hatch or detail fills).
- **Category c (108).** All in two jobs (job-005: 82, job-002: 26): raster pictures placed inside vector pages. 165 symbols lie inside an image region in all (the overlap flag); no symbol is inside a page-sized background image.
- **Category d (363).** 12 lie outside the whole-sheet view box. Job-006 holds 87 of them (24%).
- **Overlapping flags (not additive):** text within 24 pt for 803 of the 2,078 (38.6%); inside an image region 165; any dropped primitive 890; any kept primitive 1,460.
- **Form XObjects.** The content-stream scan found forms on 2 of the 4 pages checked (206 small ones on one, 1 on the other); only 5 of the 16,094 dropped primitives and 0 symbols lie inside one. Form XObjects are not a factor on these drawings. The scan is approximate for unusual streams.
- **Control (post hoc, NOT pre-registered): how informative is "a line is nearby"?** 21,865 random points on the same pages (5 per symbol, fixed seed): an extracted line of any class lies within 6 / 12 / 24 pt for 28% / 41% / 56% of random points, against 52% / 71% / 86% for their symbols; a line of the suggested class within 6 / 12 / 24 pt for 6% / 10% / 17% of random points, against 35% (12 pt) and 52.5% (24 pt) of their symbols. So their symbols are clearly closer to structure than chance, but on these dense drawings a line of some class is within 24 pt of more than half of ALL points, and category 0 is a weak statement on its own.

## 4. The blind sample (60 symbols, seed 6003, at most 6 per job)
Files in `fixtures/private/shots/phase6c/` (git-ignored): `sample-01.png` to `sample-60.png` (each: left the drawing with the blue ring, middle a 120 pt window with extracted lines in green and raw primitives in orange, right a 480 pt window); `sample-32-alt.png`, `sample-34-alt.png`, `sample-43-alt.png`, `sample-46-alt.png` (the text-preferred page for the four samples whose page map is uncertain); `samples.csv` (columns: sample, job, page, x_pt, y_pt, **owner_label (blank)**, **owner_notes (blank)**, **provisional_ai_label (NOT ground truth)**, page_map_note); `categories.txt` (the six fixed categories). The jobs in the sample: 15 of 16 (the seeded selection did not draw job-011).

My provisional labels (NOT ground truth; I viewed all 60 pictures):

| my provisional label | samples |
|---|---|
| other/unclear (ring in blank space, on a dimension arrow or beside a callout) | 21 (35%) |
| ring placed beside member | 15 (25%) |
| member drawn but not extracted | 10 (17%) |
| column/post symbol (not a line) | 8 (13%) |
| raster area | 3 (5%) |
| ring on text/label | 3 (5%) |

Against the census category of the same symbols: category c (3 samples) are all raster; category d (12) are 10 other/unclear and 2 beside a member; category 0 (42) split into beside member 12, member drawn but not extracted 10, other/unclear 10, column/post 8, text 2; the one category a and two category b samples are other or text. Reading, with the caveat that these labels are mine: **about half of category 0 sits on or next to a member-like drawing (22 of 42), the rest is blank space, a column or post symbol, or text; and about a third of the whole sample has nothing the extractor could use.** Where the owner's labels differ from mine, the owner's labels are the reference.

## 5. Part C: scope against detection (pre-registered definition)
A page is "marked-everything" when our linked-line piece count (line with label, suggested class) is at least 1 and their symbol count is at least 0.8 times that count. Recall = matched at 12 pt / their symbols; figures come from the stored Phase 6b matches.

| pages | pages (jobs) | their symbols | line with label: pieces, P, R | label-first P, R | line-first P, R |
|---|---|---|---|---|---|
| all | 136 (16) | 4,373 | 3,062, 0.29, 0.20 | 0.20, 0.21 | 0.10, 0.29 |
| **marked-everything (>= 0.8)** | **94 (15)** | **3,308** | **1,900, 0.33, 0.19** | 0.23, 0.20 | 0.11, 0.27 |
| other (< 0.8) | 26 (10) | 683 | 1,162, 0.21, 0.36 | 0.15, 0.37 | 0.09, 0.49 |
| no piece of ours | 16 | 382 | | | |

Sensitivity (fixed in advance): at 0.5: 110 pages, 3,884 symbols, line-with-label recall 0.22 (other 10 pages 0.17); at 1.0: 85 pages, 2,809 symbols, recall 0.15 (other 35 pages 0.40). **On the pages where the estimators marked at least as much as we linked, recall is not higher (0.15 to 0.22); it is higher (0.36 to 0.40) on pages where they marked less than we drew.** Scope (they mark only part of what is drawn) therefore does not explain the low recall; position and detection do. Caveat fixed in advance: the selection uses our own count, so these are not random pages.

## 6. Proven, likely, unknown
**Proven (measured here):**
- The Phase 6b statement "no extracted line within 24 pt" was "no line of the suggested class". Of the 2,078, 70% have an extracted line of another class within 24 pt (49% of those within 6 pt, most often a thin class); 5.8% have only geometry the extractor drops (almost all filled shapes); 5.2% sit on a raster picture inside a vector page (two jobs); 1.3% only text; 17.5% nothing within 24 pt.
- But on these dense pages a random point has an extracted line within 24 pt 56% of the time, so "a line is nearby" is weak evidence by itself; their symbols are 1.5 to 1.7 times as often near any line (24 and 12 pt), and 3.3 times as often near a suggested-class line (12 pt), as a random point.
- job-006 gives no pieces because its beam sizes are stroked lettering that the text reader does not read (text layer present, stroke reader not run, no confirmed glyphs). Not a bug.
- job-014: frame and rotation are fine; the page map is uncertain on 2 of 8 pages; the suggested class is wrong for the job's members.
- Scope does not explain the misses (section 5).
- The pre-registered reading guide: categories 0 and a together are 76% of the missed symbols (more than half); b, c and d together are 24%.

**Likely (supported, not proven):**
- A large part of the misses is a class and linking problem inside geometry the extractor already keeps (members drawn in thin or dashed classes), not missing extraction; the first-order fix would be choosing lines by the labels instead of one class per page. This is supported by the sample (about half of category 0 on or beside a member) and by job-014, but the labels are mine and the oracle class on page 7 is an upper bound.
- Roughly 30 to 35% of the missed symbols have nothing structural to find (blank space, dimension arrows, callouts, pictures): a ceiling for any geometry method.
- Column and post symbols (rings beside column or footing marks) are a separate case from beams: 8 of the 60 samples.

**Unknown:**
- The owner's own labels of the 60 samples (blank in `samples.csv`).
- What the rings in blank space stand for (35% of the sample).
- Whether the 13 uncertain page-map cases are real map errors (the two tests disagree).
- How many of the other 10 pages with zero pieces have the same cause as job-006.
- Whether a larger match radius would recover the "ring placed beside member" cases (15 of 60): not tested.

## 7. What this means for the next build (not started)
The Phase 6b recommendation (study a shape detector, not a line rule) rested on the 47.5% figure and is weakened: most missed symbols have lines nearby. The evidence now points at (1) per-view class choice (the suggested class is wrong in some jobs; the oracle gain was small on average but decisive on job-014 page 7), (2) the either-or reader rule for stroked lettering (job-006) and (3) linking beyond the suggested class. None is built. The decision for the owner is which to measure first (see below).

## 8. Part D: not done, waiting for approval
- Read-only preview of the empty duplicate measurement project (row counts per table), delete only if every count is zero.
- Switch the display count basis to "one piece per linked line" (owner decision 4) with tests and a Decision Log entry.
Neither was started.

## Tests and checks
New tools: `worker/tools/takeoff/phase6c_lib.py`, `phase6c_census.py`, `phase6c_sample.py`, `phase6c_trace.py`, `phase6c_rescore.py`, `phase6c_scope.py`, `phase6c_control.py`; synthetic tests `worker/tests/test_phase6c_lib.py` (10 tests: distances, the extractor rule, category order, stream scan with a stray token, Form XObject region on plain and rotated pages, fixed sample). Lint clean (ruff check and format, eslint, tsc, prettier). Last full run: API 484 passed (40 files, with the database), worker 515 passed, web 46 passed.
