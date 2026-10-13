# Phase 6c pre-registration: what sits under the estimators' symbols that we miss, and why two jobs gave nothing

Written and committed BEFORE any Phase 6c measurement was run on a real drawing. Phase 6c is a DIAGNOSTIC: no new count rule, no training, no change to the frozen linking code. Questions and definitions below are fixed now; nothing is tuned after the results are seen. Part D (housekeeping) needs the owner's approval in chat and is not part of the measurement.

## Not blind (disclosure)
- Phase 6b results are known (`docs/PHASE6B_RESULTS.md`): label-first P 0.20 / R 0.21, line with label P 0.29 / R 0.20, line first P 0.10 / R 0.29 at 12 pt; 47.5% (2,078 of 4,373) of their symbols have "no extracted line within 24 pt".
- **Correction of the Phase 6b wording, found while reading the code for this phase.** In the Phase 6b tool the "line within 24 pt" test uses only the structural lines of the worker's SUGGESTED class of the view (`main["segs"]`), not every extracted line. So the 2,078 are "no line of the suggested class within 24 pt". Lines of other classes that the extractor DOES keep may be nearby. Phase 6c reports both, and the first census category below separates them. The Phase 6b results text calling this "no extracted line" is corrected in `docs/PHASE6C_RESULTS.md`.
- I have looked at the 12 Phase 6b pictures. They suggested (not measured) that many rings sit beside members, on small post clusters, on trusses and on scope the job needs; this shaped the owner's six sample categories, which are fixed by the owner, not by me.
- job-006 is known to have a text layer on every page and zero members in the live system; job-014 has 27 pieces and none within 12 pt of a symbol.
- Nothing about the census numbers, the blind sample or the scope figure has been computed.

## Data
- The same 16 jobs, the same 136 pages, 4,373 symbols, the same symbol reading (Polygon annotations with 3 or 8 vertices, mean of vertices, takeoff page rotation matrix applied) as Phase 6b. Their symbols come from the marked-up PDFs in the git-ignored `fixtures/private/takeoffs`.
- Our side: the PDFs already stored by the API for the Phase 6b projects (`phase6b_projects.json`, `project_files.stored_path` under `uploads/`). No other source path is used.
- Page sizes, rotation and the whole-sheet view box are those of the pipeline (`whole_sheet_box`).

## Part A. job-006 and job-014
### job-006 (zero pieces): stage trace, fixed now
Per page (all pages of the job, and the pages with symbols separately), counts per stage; the cause is "the first stage whose count is zero while the stage before it is not":
1. stored PDF opens; page count; page rotation, size.
2. text layer: text lines and characters from `get_text("rawdict")`; rows in the database table of text lines.
3. label parse: profile labels returned by the worker's `page_labels` (all labels), then those inside the whole-sheet view box.
4. view: whether a view row exists, its box, scale, chosen classes.
5. lines: `page_lines` count, lines inside the view box, class table, suggested class, structural lines of the chosen classes.
6. link: labels with at least one candidate; proposals with a best line; result of `_member_fields` (skipped or not).
7. members: rows in the database (all, counted, drawn) and the state of the link and pipeline jobs (status and error text, no names).
If a stage is a bug: fix it, add a regression test with synthetic data, rerun that job only (new project from the stored upload, API on a spare port), and report its Phase 6b metrics (pieces, P, R, F1 at 12 pt for the three bases, suggested class) before and after. If it is not a bug, the cause is reported as measured and nothing is changed.

### job-014 (27 pieces, none within 12 pt): frame check, fixed now
For every mapped page of the job with symbols, compare the takeoff page with the stored drawing page: rect, rotation, MediaBox, CropBox (displayed points). Then align by text: words of 4 or more characters that occur exactly once on each page; the translation (median dx, dy) and the scale (median ratio of distances between pairs) of takeoff-to-drawing, with the median absolute residual after alignment. Also the same alignment against the drawing page index minus 2 to plus 2, to detect an index offset (the best page is the one with the most matching words). Decision (fixed): the cause is a coordinate-frame problem if, on a majority of the job's pages, the mapped page is not the best-matching page, or the median translation exceeds 2 pt, or the scale differs from 1 by more than 0.5%. Otherwise the frame is ruled out and the cause is reported as unknown unless a further stated check explains it. The size of the symbol shift, if any, is reported and the Phase 6b match is re-scored for the job only if a shift is found (as an extra row, labelled; the Phase 6b figure is not replaced).

## Part B. what sits under the missed symbols
### Population
The symbols of the Phase 6b population "no line of the suggested class within 24 pt" (2,078 expected; the run checks that the count is reproduced from the stored PDFs and states any difference).

### Census, deterministic, over ALL of the population
For each symbol, using `get_drawings(extended=True)` (rotation matrix applied, displayed points), every vector primitive (one item of a drawn path) with distance to the symbol point at most 24 pt (point to segment, to rectangle edges or inside, to quad edges or inside, to the control polygon of a curve sampled at 8 points per curve). Recorded per primitive: item type (line `l`, curve `c`, rect `re`, quad `qu`), paint (stroke, fill, both), line width, number of items of its path, layer name (as present, not printed in reports), whether it lies inside a Form XObject (content-stream scan: operators `q`, `Q`, `cm`, `Do` with the form matrix and BBox mapped to page points; a primitive is inside when its centre is inside the form's quadrilateral) and whether its centre lies inside an image region (`get_image_info` boxes; a box covering at least 90% of the page is the page background and is not an image region for this purpose, counted separately). Also: whether any text span (from the same text layer) lies within 24 pt of the symbol, and every extracted line of ANY class (`page_lines`, no class filter, all lines within 24 pt).

Definition of "the extractor keeps": a primitive is kept when it is an `l` or `re` item of a stroked path (paint stroke or both), or any item of a filled path that is a thin filled rectangle (long side at least 8 pt, aspect at least 8, thin side at most 6 pt), exactly the rule of `src/linking/lines.py` (`page_segments`). Everything else is "dropped by the extractor" and is classified by its primitive type: curve, quad, filled non-thin shape (fill-only line, rect or quad items), and, as a separate type, a stroked line shorter than 3 pt (the minimum line length) that did not merge into a longer line (no extracted line within 24 pt of it is the check).

### Exclusive categories (one per symbol, first that applies, fixed order)
0. **kept-other-class**: an extracted line of ANY class lies within 24 pt (so the extractor keeps something near; the class choice or linking is what missed it). Reported with the number of such lines and their class keys by weight.
a. **dropped geometry present**: no extracted line within 24 pt, but at least one dropped primitive within 24 pt. Split by the type of the nearest dropped primitive (curve, quad, filled shape, short stroked line).
c. **image region**: nothing of the above, and the symbol lies inside an image region.
b. **only text nearby**: nothing of the above, and a text span lies within 24 pt.
d. **nothing within 24 pt**: none of the above.
The owner's list names the categories a, b, c, d in that order; the order of precedence above (0, a, c, b, d) is fixed now because an image region is a stronger statement than text beside it. Non-exclusive flags (any text within 24 pt; inside an image region; inside a Form XObject; any dropped primitive) are reported as overlapping counts, never added.

Reported: shares overall, per job, and with the two largest jobs (by symbol count) removed. The "nothing within 24 pt" category is also split by whether the symbol lies outside the whole-sheet view box.

### Blind human sample
- Population as above. Fixed seed 6003 (`random.Random(6003)`). Procedure: sort the population by (job, page, symbol index); shuffle with the seed; walk the shuffled list and keep a symbol while its job has fewer than 6 selected; stop at 60.
- For each: one PNG in the git-ignored `fixtures/private/shots/phase6c/`, named only by the sample number (no job, page or group in the name or the picture). Two panels: near (a window of 120 pt) and wide (480 pt) of the page rendered underneath; overlays: their symbol as a blue ring, the lines of the suggested class that we extracted in green, extracted lines of other classes in light green, raw primitives (all items within the window) as thin orange outlines.
- A CSV `samples.csv` in the same folder: sample, job, page, x, y; a BLANK column `owner_label` with the fixed categories (member drawn but not extracted; column/post symbol (not a line); ring placed beside member; ring on text/label; raster area; other/unclear); a blank `owner_notes`; and a separate column `provisional_ai_label` written by me from looking at the pictures, marked in the header and in the results as NOT ground truth. The group (colour and corners) of their symbol is not shown.
- Nothing in the results depends on the owner's labels until the owner returns them.

## Part C. scope against detection
Definition fixed now: a page is a "marked-everything page" when our linked-line piece count (line with label, suggested class, Phase 6b) is at least 1 and their symbol count is at least 0.8 times that count (theirs >= 0.8 x ours). Report, for those pages: the number of pages and jobs, their symbols, our pieces, and recall (matched at 12 pt / their symbols) and precision for the line-with-label basis as the primary figure; the same for label-first and line-first; and, for comparison, the same figures on all other pages and on all pages. Sensitivity thresholds, also fixed now and reported beside the primary one without choosing among them: 0.5 and 1.0. Pages where we have no piece (count 0) are listed separately and are in neither group. The figures come from the stored Phase 6b results (no new matching).
Reading caveat (fixed): the selection uses our own piece count, so the selected pages favour pages where we drew few pieces; recall there is not the recall on a random page.

## Reading guide (fixed now, no bars, the owner decides)
- If categories 0 and a together hold more than half of the population, the extractor or the class choice is where the misses are, and a drawing-based method over the extracted geometry may still be worth a look.
- If b, c and d together hold more than half, the symbols are placed where nothing structural is drawn (labels, images, blank), and no geometry method will reach them.
- The blind sample gives the owner's own reading of the same symbols; where it disagrees with the census, the owner's labels are the reference.

## What this cannot show
The census says what is drawn near a symbol, not what the estimator meant. A near primitive is not proof it belongs to the counted member. Form XObject membership is derived from a content-stream scan and is approximate for nested or very unusual streams. The sample of 60 (at most 6 per job) is small and not representative of the weights of the large jobs.
