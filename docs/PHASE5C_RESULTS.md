# Phase 5c results

Branch `phase-5c` (from `phase-5b`), local only. Baseline before any change: lint clean; API 399, worker 456, web 14 tests, all passing. After the last item: lint clean; **API 419, worker 458, web 14, all passing** (see item 1 for the repeated runs). The frozen rule (`phase4e-v1-frozen`), its candidate selection and its confidence thresholds were not touched.

## Item 1. The flaky scale-flag test: test data collision, not a production bug
- **Cause:** seven cases of `sheets-route.test.ts` gave their test sheet a **random page index in 25..1024**. Page indexes are unique per project (`sheets_project_page_index_uq`), so a draw could equal another draw or one of the fixed indexes 40, 41, 42, 90 used by other cases: a duplicate key error from the test helper, a different test each time. Chance per run: about **4.8%** (computed). This matches what was seen (the Phase 5b failures were in the cases that use indexes 40 to 42).
- **Evidence:** the file alone failed **1 run in 60** before the fix (run 21: `duplicate key value violates unique constraint "sheets_project_page_index_uq"`); with the random draw forced to a colliding value the failure is reproducible on demand (7 failures). After the fix (a counter from 201 up): **0 failures in 100 runs alone**, and **0 failures in 50 runs of the full API suite (35 files, 419 tests)** on the final code of this phase.
- **What I read:** the scale-override route (`PATCH .../scale-override`) locks the sheet row (`FOR UPDATE`), writes the sheet and the edit in one transaction, and returns the new state; nothing in it is racy, so no production change was made. An earlier full-suite loop that I started was invalid (it ran while I was changing code) and is not counted.

## Item 2a. What the shared lines are made of (measured before any change; counts only)
Script: `scripts/calibration/phase5c_shared_lines.py` (reads the PDF and the stored members). A "drawn segment" is an ORIGINAL path segment before the merge of touching collinear segments (gap 1.0 pt, offset 0.6 pt).

| | job-005 (the 28 lines of Phase 5b) |
|---|---|
| shared lines | 28 (113 members) |
| made of ONE drawn segment | **28** |
| merged by the worker from several pieces (n_src > 1) | **0** |
| seams between drawn segments | **0** |
| members whose label projects inside the (single) segment | 113 of 113 |
| members alone on their drawn segment | **0** of 113 |

Over the six vector study documents (123 shared lines): **113 are one drawn segment, 10 have several**; 16 were merged from several pieces (mostly the same segment drawn twice). The 41 seams that exist (job-008: 20, job-009: 15, job-020: 6) sit at: a perpendicular structural line **20**, nowhere identifiable **18**, a column-sized closed shape **2**, a grid line **1**.

Other places a person would cut a long line (extra measurements, not seams): perpendicular structural lines or column-sized shapes on the line separate **2 of the 113** job-005 members (111 still share the stretch between two supports); small filled single-item marker shapes (6 to 10 pt) sit on the line at the member ends of the stair framing: 36 cut points, **27 of the 113** members end up alone between markers, 5 of the 28 lines are fully separated, 8 have none; the same marker count on the other five documents is **0**.

**Finding:** the fused-line theory is wrong. The merge step is not the cause, there are no seams to cut at, and the one convention that does mark member ends (stair framing markers) exists in one document only. I did not find a better general fix, so nothing was built for 2c (no `plan_geometry_segment`, no seam rule). Looking at 5 sampled members, the long heavy lines in the stair areas do carry several real members with markers between them, while other labels may simply have the wrong line as their nearest candidate (the Phase 4e "no correct candidate" case). That is what the owner's check below decides.

## Item 2b. New semantics (reverses Phase 5b)
Members on a shared line stay amber and grouped but their pieces count; their length is `length_shared` and is left out of the length totals, shown apart as pieces ("length not trusted"). A typed length is trusted. Only a true duplicate candidate (same line, same canonical profile, labels overlapping or closer than 2 label heights) stays outside the main total until a person says "separate members" or merges it; a merge now moves only the member it is applied to.

**job-005 totals** (the four views of the Phase 5b test project, the four pages decided "include" by the harness; 35 pages):

| | Phase 5b before its change | Phase 5b after | Phase 5c |
|---|---|---|---|
| pieces in the main total | 163 | 93 | **163** |
| of those, pieces whose length is NOT trusted (shared line) | all 163 counted with whole-line length | 93 with whole-line length | **98** (the other 65 have a trusted length: 640'-4 5/16" in all) |
| held out as possible duplicates | 0 | 70 | **0** (true duplicate candidates) |
| red, excluded | 27 | 27 | 27 |
| existing / unlinked labels | 0 / 0 | 0 / 0 | 0 / 0 |
| sheets undecided | n/a | n/a | **31 of 35** (without the four decisions the totals are 0) |

Across the six calibration documents (24 gold pages, study classes): 362 of 909 members have a length that is not trusted; **3 true duplicate candidates** (all job-020).

## Items 3, 4 and 5 (what changed)
- **3:** a `classes_view` job only suggests the classes; the link job (worker and API) refuses until a person confirmed them; the screen shows swatches with the suggestion preselected and one Confirm button, and marks views that wait. Tests: worker (suggestion is not a confirmation; a confirmed choice is never replaced) and API (refused before, accepted after).
- **4:** every sheet is undecided until a person decides include or exclude; the page type guess is only preselected as a guess; undecided and excluded sheets are not in the totals and the link job refuses them; the takeoff and the Excel show "N sheets undecided" and list them; decisions are sheet edits with who and when and undo goes back one at a time.
- **5:** member state "existing steel" (profile and trusted length kept, in no total, own block by sheet, own Excel sheet, in the corrections export, with undo); "not a member" keeps four reasons and the takeoff and Excel summary show labels per reason.

## Item 6. Docs only
`docs/TAKEOFF_COMPARE_PLAN.md`: wanted fields, matching, metrics, unknowns, timed-review protocol. No takeoff file was read or imported; `fixtures/private/takeoffs/` does not exist.

## Item 7. Re-measurement (same six documents, same VALIDATION labels, fresh projects, the harness shows and confirms the classes and decides every sheet explicitly)
**Nothing regressed:** the label-level result of every one of the 240 label runs (120 validation labels, of which 116 are scored, x two class modes) is identical to Phase 5b (same state, same color, same system color, same correct/incorrect).

| Parity: top-1 on the validation labels | study | production (study classes) | production (suggested classes) |
|---|---|---|---|
| job-004 | 8/20 | 8/20 | 3/20 |
| job-005 | 17/20 | 18/20 | 18/20 |
| job-008 | 9/20 | 9/20 | 9/20 |
| job-009 | 11/20 | 12/20 | 11/20 |
| job-010 | 8/16 | 8/16 | 8/16 |
| job-020 | 13/20 | 13/20 | 13/20 |
| **pooled** | **66/116** | **68/116** | **62/116** |

Color against the gold (study classes; right / linked): green 10/11, amber 51/75, red 7/20, unlinked 10, not in view 0 (per document: see the Phase 5b table, unchanged). Color mix on the 24 gold pages (909 members): green 60, amber 546, red 226, unlinked 77; 362 with a length not trusted; 3 true duplicate candidates. The AI-made gold and the harness acting as a person are the same limits as in Phase 5b: no human spot check exists yet.

The harness made 24 sheet decisions (6 against the page type guess) and 48 class confirmations (24 views, two runs); the scale was detected on 19 pages, typed on 5 (one assumed for parity only).

## What the owner must check
`fixtures/private/shots/phase5c_check/`: **20 members** sampled (seed 5) from the 113 on the job-005 shared lines, one overlay image each (the line in red, the label boxed in blue) and `sample.csv` with a blank `ok?` column. Question: **is this label the name of the beam this line draws? (y / n / unsure)** It is not a check of a new length (none was built); it decides what the shared lines are (OPEN_QUESTIONS 59). I have not graded any of them.

## What did not work or was not done
- 2c (a segment-based length) was not built: the evidence does not support it.
- Lengths of members on shared lines are still not trusted, so on job-005 the takeoff has 163 pieces but a trusted length for 65 of them only.
- The class suggestion is still wrong on job-004 (3/20 against 8/20); the person must now confirm it but nothing tells them it is poor (question 62).
- A correction to Phase 5b: its whole-page color mix said "1,148 members"; the possible duplicates were counted twice and the right total is 909 (also corrected in `docs/PHASE5B_RESULTS.md`).
