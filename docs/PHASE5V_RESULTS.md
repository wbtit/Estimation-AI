# Phase 5v results: measured length (pre-registered in PHASE5V_PREREGISTRATION.md, commit a008b13)

Tools: `worker/tools/takeoff/measure_study.py` (study only, synthetic tests in `worker/tests/test_takeoff_tools.py`). Per-markup rows are in the git-ignored private folder. No UI, no schema change, frozen linking code untouched. No tolerance was changed after the results. Disclosure: Q1 and part of Q2 repeat the Phase 5t finding with fixed bars (not blind); Q3 and Q5 are new.

## Q1 Do the markups carry the scale?
Yes. All 138 measured markups have a measurement entry with a units-per-point factor. They sit on **28 pages**; on **all 28 the markups on the page carry one single ratio**. We read one page scale on **23** of those pages; it agrees with the markups within 1% on **22**, differs on **1**, and on **5** pages we read no single scale (none, or more than one).

## Q2 Their number against drawn distance x our scale
- All 138 markups show a value. With THEIR ratio, drawn distance x ratio equals their value within the bar on **138 of 138**: the maths is right, and their value is the plain distance between the clicks.
- With OUR page scale (98 markups on the 23 pages): **97 agree** (1 inch or 0.5%), 1 disagrees by more than 5% (that is the page whose scale differs). The other 40 markups are on the 5 pages where we read no single scale.

## Q3 Auto-measure against their clicks
All 138 are two-click markups on vector pages (no raster pages and no multi-point paths, so "cannot auto-measure" is 0).

| Line set | both ends within 6 pt | within 12 pt (primary) | within 24 pt |
|---|---|---|---|
| Phase 5t structural classes | 9 | **34** (25%) | 43 |
| lines of every class | 25 | **66** (48%) | 96 |

(b) Distance of the nearest line (larger of the two ends), structural classes: up to 3 pt 4; 3 to 6: 5; 6 to 12: 25; 12 to 24: 9; over 24: 95. Every class: 17 / 8 / 41 / 30 / 42. Of the lines within 12 pt, the line length differs from the clicked distance by more than 10% for 8 of 34 (structural) and 15 of 66 (every class).

(c) Where a line exists within 12 pt and we have the scale: structural classes, 27 tested, **auto length agrees on only 3**, while the clicks themselves agree on 27 of 27; every class, 46 tested, auto agrees on 10, clicks agree on 45. So the scale and the maths are fine; the line the system finds is usually not the length they clicked (end points are 6 to 24 pt off, and the lines are often split or overshoot).

Meaning: a fully automatic length would be right for only 3 (structural classes) to 10 (every class) of their 138 measurements here. Auto-measure can only be a first guess that a person confirms or re-clicks.

## Q4 How the workbook writes Length (96 main rows with a quantity)
- Length (ft.): whole number on 28, one decimal on 27, two decimals on 41. None are fractions.
- Length (In.): all 96 are whole inches written as text with an inch mark, and every value is 12 or more (it is the total length in inches, not the left-over inches). On all 96 the inch value equals the feet value x 12 within half an inch, so the two columns show the same length.
- So lengths are written to whole inches (feet to 2 decimals). Rounding the measured length to the nearest inch fits the target.

## Q5 Written dimensions as a scale check (feasibility only)
5 framing plans with one parsed scale (one per job, first in sorted order), 9 dimension strings (first two per page; the plans have fewer than 10 in the first two lines of each page). A parallel line within 12 pt and 5 degrees of the text was found for **7** of 9. In **0 of the 7** did the drawn extent of that line x scale equal the written value within 1 inch. Not feasible with this simple rule: the line next to a dimension text is usually a piece of a split dimension line or a tick, not the full extent. Not pursued (the study said to stop if it grew); no conclusion about our scale from this.

## What did not work
- Automatic end points: 25% of their clicks have a structural line within 12 pt (48% with every class) and the auto length is right on about 1 in 9 of the tested ones. The clicks are not on the heavy line class; they click wherever the end is.
- Q5: written dimensions cannot be matched to a dimension line with this rule.
- 5 of the 28 pages have no single scale of ours: measuring there needs a confirmed scale by a person.
- Evidence limit: 138 markups on 28 pages of one set of jobs; the 40 markups on the 5 pages without our scale were not tested for the auto length.
- During the run the private `inventory_map.csv` was rewritten (column-padded, at 18:25, not by this work); `tools/takeoff/common.py` now strips the padding when reading it.

## Recommendation
Length is measured: the system proposes two end points (amber) and the estimator confirms or re-clicks with the measure tool; round to the nearest inch; require a confirmed scale; written lengths only as a cross-check. See V1_UI_SPEC.md section 7 and SCHEMA_CHANGE_PROPOSAL.md section 9.
