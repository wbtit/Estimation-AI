# Phase 5v pre-registration: measured length (written and committed BEFORE any of this phase's tools were run)

Context: lengths are almost never written. Estimators set a page scale in the markup tool and click the two end points of a member. We test whether the system can do the same two clicks: length = drawn distance (pt x 25.4/72, in mm) x scale ratio. Study only: no UI, no schema change, no change to the frozen linking code (rule phase4e-v1-frozen).

Disclosure (what was known before writing this): the Phase 5t results already say 138 length markups carry a measurement entry and a stored value, and that 98 of them lie on a page where we read one scale (97 of the 98 agreed within 2%). So Q1 and part of Q2 are a re-check with fixed bars, not a blind first look. Q3 and Q5 are new. The workbook's length columns have not been read in this phase.

Population (fixed): the same 138 Line or PolyLine markups of at least 3 pt that carry a measurement entry, on the matched takeoff pages (same page map and code path as the Phase 5t geometry study). A vertex list is read in displayed page points (rotation applied). The two "clicks" are the first and last vertex. A markup with more than two vertices is counted but is not used in Q3 (it is a path, not a two-click measure); Q2 uses its summed path length.

## Q1 Scale carried by the markups
- Per markup: read the ratio from the measurement entry (units per point x unit in inches x 72), as in the Phase 5t reader.
- Per page: the markup ratios present (distinct values, 1% merge), and our parsed page ratio (analyze_page, scale_parsed_ratio; none if no scale or more than one scale was found).
- Report: pages with markups; pages where all markup ratios agree with each other; pages where our ratio exists; pages where it agrees with the markup ratio within 1%; pages where it does not; pages where we read no single scale. Bar for "agree": relative difference at most 1%.
- If a markup has no readable ratio, say so; Q2 then tests the scale instead.

## Q2 Their number against drawn distance x our scale
- Their value: the first dimension found in the markup's contents or subject text by the existing dimension parser (mm).
- Ours: path length (pt) x 25.4/72 x our page ratio. Only markups on a page where we read one scale.
- Agree when |ours - theirs| <= 1 inch (25.4 mm) OR <= 0.5% of theirs.
- Report: markups with a value; markups with our scale (the test set); agree; disagree; the share of disagreements that fall within 2%, 5%, above 5%; and, as a separate line, the same test using THEIR markup ratio (tests the maths alone, not our scale). No tuning of the tolerance afterwards.

## Q3 Auto-measure against their clicks
- Line set: exactly the Phase 5t set: page_lines, lines_in_box (whole page), the confirmed study classes of the page if the study has them, else suggest_classes; lines of at least 3 pt (the Phase 5t minimum). Secondary set (reported separately, registered now): the lines of all stroke classes.
- Only vector pages: a page is raster (cannot auto-measure) when the page kind is not vector or image coverage is 0.5 or more. Raster markups are counted and reported as "cannot auto-measure", and left out of (a) to (c).
- For each two-vertex markup: for each line, endpoint pairing is the better of the two orders; the click-to-end distance is the larger of the two. The nearest line is the one with the smallest larger-of-two distance (ties: longer line).
- Tolerances (fixed): primary 12 pt, also reported at 6 pt and 24 pt. "A drawn line exists" means both ends are within the tolerance of the two clicks.
- (a) share of vector two-vertex markups with such a line, at each tolerance and for both line sets.
- (b) distribution of the larger-of-two distance to the nearest line (bands: up to 3, 3 to 6, 6 to 12, 12 to 24, over 24 pt, none within the page), plus the share where the line is shorter or longer than the clicked distance by more than 10%.
- (c) where a line exists at 12 pt: its auto length (line length x 25.4/72 x our ratio, pages with our scale only) against their value; agree when within 1 inch or 0.5%. Also reported: how many of the non-agreeing are agreeing when the clicks (instead of the line) are used (separates line choice from scale).
- No parameter is changed after seeing the results.

## Q4 Rounding of Length in the workbook (main-steel rows only)
- Population: the main block of the target workbook (rows before the total row), reader as in Phase 5u (`read_main_sheet`), only the two length columns Length (ft.) and Length (In.). No other column is read, and no counts or values are printed except format classes.
- Per cell class: empty, whole number, decimal (with one, two, three or more decimal places), fraction text (contains "/"), mixed (whole plus fraction), text other. Reported for the ft column and the in column, and the joint pattern per row (e.g. whole ft + whole in; whole ft + decimal in).
- Also: share of rows whose in value is a multiple of 1/16, 1/8, 1/4, 1/2 and 1 inch, as far as the cells are numbers. Counts only.

## Q5 Written dimensions as a scale check (small; stop if it grows)
- Pages: 5 vector framing plans with a parsed single scale, chosen by sorted job id then page number, at most one page per job, from the drawing documents the takeoff PDFs are matched to (page type = plan by the existing page classifier if available, else sheet title containing PLAN). Fixed in advance: take the first 5 in that order.
- Per page: up to 2 dimension strings parsed by the dimension parser whose text box has a straight dimension line (a stroked line of at least 20 pt lying within 12 pt of the text box and within 5 degrees of the text direction). Stop at 10 strings in all.
- Test: drawn extent of that line (pt) x 25.4/72 x scale ratio against the written value; equal within 1 inch.
- Report feasibility only: how many strings were found, how many had a clear dimension line, how many agreed. No production code; the tool stays under worker/tools/takeoff/ with synthetic tests.

## Docs (no code)
Update docs/V1_UI_SPEC.md (length measured by default; length_source values measured_auto, measured_manual, written, typed; measure tool: two clicks, blue measuring line with end markers, scale shown, flag for sloped or unclear members; written length is a cross-check only) and docs/SCHEMA_CHANGE_PROPOSAL.md (the same four length_source values). Update docs/OPEN_QUESTIONS.md with the answers: joists are not main steel and are not counted, length is measured, prefix meanings are still to be filled by the owner. Decision Log entry in docs/SPEC.md. Results go to docs/PHASE5V_RESULTS.md. Nothing in docs, code, logs or chat carries client, project or file names or tag prefix letters; derived per-markup data stays in fixtures/private (git-ignored); tests use synthetic data only; no cost, price or rate cell is read.

Nothing above is redefined after the results are seen.
