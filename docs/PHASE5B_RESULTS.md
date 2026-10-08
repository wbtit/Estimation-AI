# Phase 5b results

Branch `phase-5b` (from `phase-5-review-v1`). Baseline before any change: lint clean, API 352, worker 453, web 11 tests, all passing. After the last item: lint clean, **API 399, worker 456, web 14, all passing** (one unexplained intermittent failure of a scale-flag test in `sheets-route.test.ts` was seen twice in the first five runs after item 7 and not in the next 26 runs; see OPEN_QUESTIONS 58).

The Phase 5 numbers were optimistic: job-005 is the easiest study document (study validation top-1 85% there, 44% pooled over all eight), and its 40 gold labels were half DESIGN labels. Nothing in this phase retunes the frozen rule (`phase4e-v1-frozen`) or the color thresholds. The gold is AI-made; there is no human spot check yet.

## 1. Double counting (job-005 views, before the fix)
- 190 members on **105 distinct chosen lines**. Members per line: 1 -> 77 lines, 2 -> 8, 3 -> 4, 4 -> 4, 5 -> 4, 6 -> 7, 7 -> 1. **28 lines carry more than one member (113 members).** Page 29 holds most (27 of the 28 groups sit on page 29 and 14).
- By structure: in 111 of the 113 the labels have **different profiles** on one line; 2 are the same profile with a label turned more than 5 degrees from the line; **0** are two close, aligned labels with the same profile (which would be true double counting). Shared lines are longer (median 432 pt against 266 pt for lines with one member), 17 of 28 are longer than 400 pt, and in 21 of 28 the labels are spread over more than half of the line.
- So most of it is **not** one beam counted twice: a long drawn line carries labels for several beams, and each member gets the whole line length. The count of members is probably closer to right than the lengths (OPEN_QUESTIONS 48).
- After the fix, the same views: main total 93 pieces (was 163 non-red), 70 pieces held as "possible duplicates (shared line)", 27 red excluded; green fell from 69 to 18 because shared-line members are amber until a person decides. On all six documents (study classes) 40 of 106 linked gold labels sit on a shared line and 20 of those 40 (50%) are right, against 48 of 66 (73%) for labels alone.

## 8. Multi-document calibration (production flow, VALIDATION labels only)
Documents: job-004, 005, 008, 009, 010, 020 (job-002 and job-016 are raster and were skipped). 116 validation labels with a gold line, not-a-member labels left out as the study does. The harness acted as a person (whole-sheet view when the sheet has one scale, else a box around the page's gold labels; confirm the suggested scale, else type the sheet's most common scale; switch the sheet to "include in takeoff" when needed).

**Parity with the Phase 4e study (study's line classes confirmed on each view):**

| document | study top-1 | production top-1 |
|---|---|---|
| job-004 | 8/20 | 8/20 |
| job-005 | 17/20 | 18/20 |
| job-008 | 9/20 | 9/20 |
| job-009 | 11/20 | 12/20 |
| job-010 | 8/16 | 8/16 |
| job-020 | 13/20 | 13/20 |
| **pooled** | **66/116** | **68/116** |

They match on four documents and differ by one label on two. The four differing labels are all near-ties (the first two candidates score within 0.3 pt of each other, all `low` confidence), where the order of equal scores decides; three went the production way and one the study way. Parity holds for the rule. With the **suggested** line classes instead of the study's, production gets 62/116: the only loss is job-004 (3/20 instead of 8/20), a sheet with wood and steel linework where the heaviest-class suggestion picks the wrong class.

**Color of the proposal against the gold, per document and pooled (study classes; cells = right / linked):**

| document | labels | top-1 | green | amber | red | unlinked | not in view |
|---|---|---|---|---|---|---|---|
| job-004 | 20 | 8 (40%) | 0/0 | 8/13 | 0/6 | 1 | 0 |
| job-005 | 20 | 18 (90%) | 4/4 | 13/15 | 1/1 | 0 | 0 |
| job-008 | 20 | 9 (45%) | 0/0 | 9/12 | 0/1 | 7 | 0 |
| job-009 | 20 | 12 (60%) | 6/7 | 1/5 | 5/7 | 1 | 0 |
| job-010 | 16 | 8 (50%) | 0/0 | 8/16 | 0/0 | 0 | 0 |
| job-020 | 20 | 13 (65%) | 0/0 | 12/14 | 1/5 | 1 | 0 |
| **pooled** | **116** | **68 (59%)** | **10/11** | **51/75** | **7/20** | **10 (9%)** | **0** |

- All 10 unlinked labels have gold `missing` or `group` (no correct line existed), so no correct line was left unlinked.
- **Green is rare:** pooled whole-page mix (every member on the 24 pages, study classes): **60 green, 546 amber (239 of them possible duplicates), 226 red, 77 unlinked** (1,148 in all). On job-005 alone: 12 green of 269. Amber is mostly shared lines and medium confidence.
- **The colors are less reliable on the other documents than on job-005.** Green was 4/4 right on job-005 and 6/7 on job-009 but there is almost no green elsewhere (0 on four documents), and red is only 35% right (7/20), so red is not a good "wrong" signal either. Amber is 68% right. The pooled top-1 is 59% on these six documents (the 44% of the study includes the two raster documents, which score 0).
- Scale and view handling, per page (24 pages): scale **detected** 19 (3 of them flagged ambiguous), **typed** 5 (the sheet's most common scale: job-005 pages 14 and 15, job-020 pages 5 and 6; job-009 page 16 has no scale on the sheet and was assumed, for parity only), skipped 0; view: whole sheet 9, box around the labels 15 (no single scale on the sheet); switched to "include in takeoff" 6 of 24.

Re-run: `scripts/calibration/phase5b_calibrate.py` and `scripts/calibration/phase5b_report.py` (counts only; results stay in the git-ignored study folder).

## 9. Marks, legends and columns on job-010
- 140 mark-shaped words on 12 framing pages, 23 distinct marks; **1 legend row** in the document. Distinct plan marks: 1 linked, 0 ambiguous, **22 no legend row**. Members made from marks in the reviewed views: 6, all linked (all from the one legend row).
- Column schedule pages: the words COLUMN and SCHEDULE are on 9 pages; 3 pages are guessed schedule/legend and have the words, but **none holds the column schedule**. The only column schedule is on **1 page** (a foundation plan sheet). Rows on the 3 guessed pages: 3 with a mark and a profile, 32 mark-only. Legend rows built from the real schedule: **0**. Cause: the mark and the size are in two ruled cells 14 to 15 times the text height apart and the row builder cuts at 10 (`docs/PHASE5C_COLUMN_SCHEDULE_NOTES.md`, with a parser proposal and acceptance test; nothing built).
- Columns by hand through the review screen on job-010 page 7 (the person's name typed once, elevations typed): 3 columns added; two with both elevations became **green** members of 12'-6" and 14'-0" and are in the main takeoff total with their marks; the third (top elevation only) became **red** ("column base elevation unknown") and is on the "excluded (red)" line. The whole path (add, status, takeoff, Excel) works. One bug found and fixed: the first field of the column form lost its focus after the click that opened it.

## What changed in the product
Items 1 to 7 and 10 are in the review screen, API and Excel as described in the Decision Log of `docs/SPEC.md`; a bug found by the calibration was fixed (structural classes chosen by a person were overwritten by the link job).
