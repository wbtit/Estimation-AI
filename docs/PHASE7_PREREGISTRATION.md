# Phase 7 pre-registration: member-geometry re-scoring (Part B) and a structural grammar prototype (Part C)

Written and committed BEFORE any Phase 7 measurement on real drawings. Part A (housekeeping) is already done and committed (`d5ad17e`, see the SPEC Decision Log). Nothing here changes a bar, a radius or a rule after seeing a result. Everything is deterministic code: no LLM, no trained model. Nothing is pushed. The frozen linking code (`worker/src/linking`) is read and called but not changed.

Process rules for the run: every process I start has its PID recorded and only those PIDs are stopped; no `pkill`, no `pgrep -f`; the API on port 3000 is not touched (a separate read-only API on port 3100 is started and stopped by its recorded PID, as in Phase 6b); the PDFs are the ones the API stored (`project_files.stored_path`); no broad filesystem search; no client, project or file names in code, docs, logs, tests or chat (job ids only); private outputs only under `fixtures/private` (git-ignored); the estimator workbook is not opened (no cost, price or rate cell is read).

## 0. Facts that change how Part B is read (checked in the code before writing this)
- **Phase 6b already measured the distance from a symbol to the linked line SEGMENT.** `Piece.distance` in `phase6b_lib.py` uses `point_segment_distance` whenever a piece has a line, and every label-first, line-with-label and line-first piece in the 6b scoring has a line (labels without a best line were not pieces). So the 6b numbers are already "geometry" numbers, matched with a GREEDY one-to-one rule. What Phase 7 Part B adds is: (a) an exact one-to-one rule (Hungarian), (b) a third radius (36 pt), (c) a genuinely point-based comparison (the symbol to the point where our piece is shown: the label centre), which is what "the old point-to-point figures" has to mean, (d) chance controls, (e) the label-only pieces reported apart. The 6b published numbers are reproduced first (greedy, same radii) as a check; if they do not reproduce, that is reported and Part B stops there.
- Hence the expectation is small: the geometry result should equal the 6b result under the greedy rule, and the exact rule should add few matches. Registered prediction: **Hungarian matches at 12 pt are within 5% (relative) of the greedy count for every basis.** If larger, I report it as a surprise.
- Held-out contamination, disclosed up front. In Phases 6b and 6c I viewed pictures of pages from most of the 16 jobs (12 pictures in 6b, 60 samples in 6c, 15 of 16 jobs). So "held-out" here means: not used to develop rules or choose thresholds in Phase 7 and scored once; it does NOT mean never seen. The general lessons from those pictures (rings beside members, column symbols, grid bubbles) shaped the task list I was given; I add no rule from a specific held-out page.

## 1. Data (both parts)
The same 16 jobs and the same 136 pages with at least one estimator count symbol (4,373 symbols), the same page map as Phase 6b (the 6c page-map doubts are NOT corrected here, so results compare with 6b), page rotation applied (`page.rotation_matrix`). Our side: the PDF the API stored for the Phase 6b project of each job. Symbols: the Polygon markups with 3 or 8 vertices, centre of the vertices (`their_symbols`, unchanged).

## 2. Job split (fixed now, for Part C)
Algorithm (`phase7_lib.split_jobs`, seed 7001): rank jobs by their symbol count; the two largest go to different sides (which one goes to dev is drawn from the seed); the other 14 are shuffled with the seed, the first 9 go to dev and the last 5 to held-out. The result, computed once before any other run:

| side | jobs | pages | symbols |
|---|---|---|---|
| dev (10 jobs) | job-002, job-003, job-005, job-006, job-010, job-011, job-012, job-013, job-014, job-018 | 84 | 2,714 |
| held-out (6 jobs) | job-004, job-008, job-015, job-017, job-019, job-020 | 52 | 1,659 |

The largest job of each side is job-012 (dev, 992 symbols) and job-015 (held-out, 804). The two jobs with no pieces in Phase 6b (job-006, job-014) are both on the dev side by the draw; the split is not changed for that.

## 3. Part B: member-geometry re-scoring (no new detection)
### 3.1 Pieces and geometry, per count basis
Pieces are rebuilt in-process exactly as `phase6b_study.study_page` builds them (same labels, same filter of counted members taken from the API on port 3100, same suggested class, same oracle rule), then given a geometry:
- **label-first**: one piece per label with a best line; geometry = the linked line (a 2-point polyline); the displayed point = the centre of the label box.
- **line with label**: one piece per distinct linked line (the new display basis of Part A); geometry = the linked line; displayed point = the centre of the first label's box on that line.
- **line first**: one piece per merged structural line (6b merge rule, unchanged); geometry = the merged line; displayed point = its midpoint.
- **label-only pieces**: labels the API counts for which no best line exists. They have no member geometry (only the label point). They are NOT in the main figures; they are counted per page and added in a separate secondary table (matched by label centre point, label-first and line-with-label only).
Classes: the worker's suggested class per page (primary) and the oracle class per page (best F1 at 12 pt under the 6b rule, an upper bound that uses their symbols), both as in 6b.

### 3.2 Matching
- **Geometry distance**: symbol to the piece's polyline (point to segment), no other change.
- **Point distance** (the comparator): symbol to the displayed point.
- **Exact one-to-one (Hungarian)**: the largest possible number of pairs within the radius, then the smallest total distance (`phase7_lib.hungarian_pairs`, tested against brute force). **Greedy** (the 6b rule) is also computed, for reconciliation only.
- Radii 12 (primary), 24 and 36 pt.
- Reported: P, R, F1 at each radius; pages equal, within plus or minus 1 and within 20% (our piece count against theirs; this does not depend on the matching, so it equals 6b for the unchanged bases); the verdict by the 6b bars at 12 pt (worth building: at least 50% of pages within plus or minus 1 and P and R at least 0.6; promising: at least 30% and 0.4).
- Side by side: [6b published, greedy geometry] / [greedy geometry, recomputed] / [Hungarian geometry] / [Hungarian point].

### 3.3 Chance controls (both pre-registered, fixed seeds)
For every page the real symbols are replaced by the same NUMBER of synthetic points and the whole matching is repeated, 20 replicates per page, mean and standard deviation over replicates:
- **C1 uniform**: points uniform in the page's whole-sheet view box (seeds 7100 + replicate, then the page order).
- **C2 displaced**: each real symbol moved by a random vector of 60 to 200 pt in a random direction, clipped to the view box (seeds 7200 + replicate). It keeps the layout and the density of the real symbols and breaks their alignment with our geometry.
Reported next to the real figures for every basis, class mode and radius. Reading guide (fixed now): the geometry metric "carries information" for a basis if the real recall at 12 pt exceeds the larger of the two control recalls by at least 0.10 AND the real precision at 12 pt is at least 1.5 times the larger control precision. A basis that does not pass this is described as "not distinguishable from chance by this metric at this radius", whatever its F1.

### 3.4 Scope of the tables
All 136 pages, and without the two largest jobs (job-012 and job-015). A per-job table for the primary figure. The Part B results are committed BEFORE Part C is started.

## 4. Part C: structural grammar prototype on plan sheets
Purpose: test whether a rule grammar over ALL vector primitives (not one line class per page) finds the pieces the estimators mark. Rules and thresholds may be developed on the dev jobs only; the held-out jobs are scored ONCE after the rules are frozen and committed under the tag `phase7-grammar-frozen`.

### 4.1 Discipline
- The held-out jobs are not parsed, scored or viewed by any Phase 7 tool before the freeze. The driver takes `--set dev` freely; `--set held-out` refuses unless the tag `phase7-grammar-frozen` exists, the grammar files are unchanged since the tag, and no previous held-out run is recorded (a lock file with the run hash).
- Development is limited to 5 numbered revisions after this v1. Each revision is a code change made after looking at dev results; each is logged (what was seen, what was changed, dev score before and after) in the dev log of `docs/PHASE7_RESULTS.md`. Freeze happens after revision 5 or earlier if a revision improves dev F1 at 12 pt by less than 0.01.
- Dev scores are never used as evidence of quality in the results; only the held-out table is (dev is reported for comparison and to show the gap).

### 4.2 Rules v1 (parameters fixed now)
Coordinates are in the page's displayed orientation. The view box is the whole-sheet box used everywhere else. All lengths in points (pt).
1. **Vector parse.** Every path of `page.get_drawings()`: stroked, filled, both, closed or open; items `l`, `re`, `qu`, `c` (curves sampled at 8 points). Each primitive keeps: id, paint (stroke, fill, both), width, dash array, stroke and fill colour, closed flag, item count, bounding box and its points. The Form XObject transform stack is applied by the PDF engine (checked in a synthetic test with a scaled and moved form, and with a rotated page); the phase 6c content-stream scan is used only to report how many primitives came from a form.
2. **Line roles per page.** Segments are the straight pieces (`l`, `re` edges) of stroked paths, plus filled rectangles whose short side is at most 6 pt and aspect at least 8 (width = the short side), as in the extractor. Over segments of at least 12 pt, widths rounded to 0.05 pt are accumulated by length; the widths in the lowest 50% of length are **thin**, up to 85% **medium**, the rest **heavy** (the width that crosses a threshold goes to the lower role; a page with one width is all thin). **hatch**: a segment shorter than 12 pt, or one with at least 4 other segments within 2 degrees of its direction, of similar length (within 30%), at perpendicular offsets of at most 6 pt and overlapping it along its direction by at least half. **dashed**: the path has a non-empty dash array. A segment keeps its role and dashed flag; no role is dropped.
3. **Grids.** A *bubble* is a closed curved path with a box of 10 to 40 pt per side, aspect at most 1.2, containing the centre of 1 or 2 text characters of the page text layer (any script). A *grid line* is a chain of dashed or dash-dot collinear segments (gap at most 12 pt) of at least 150 pt whose axis passes within 6 pt of a bubble centre and has an end within 12 pt of that bubble. Family from the label content, not the direction: all characters decimal digits -> family N, anything else -> family A. Intersections: a grid line of family N with one of family A (each extended by 24 pt). A page with fewer than 4 intersections has no usable grid.
4. **Column and post glyphs.** A closed path (stroked or filled) or a filled-only path, with a box whose long side is 3 to 24 pt, short side at least 3 pt, long/short at most 3, at most 20 items, not a bubble, not in a hatch group. Overlapping glyphs (box IoU above 0.5) are merged (the larger box is kept, both ids are stored). Signature: an 8-row width profile (share of the box width filled at each of 8 rows, from 16 x 16 point sampling of the polygon), the box size, the item count and the paint. `at_grid`: the centre is within 30 pt of a grid intersection. **Main set**: on a page with a usable grid, glyphs with `at_grid`; on a page without a usable grid, all glyphs. The others are flagged `off_grid`, kept, shown grey, and not in the main total.
5. **Consumed before chaining.** *X sign*: two segments (any role) of lengths 30 to 400 pt within 25% of each other, crossing at points within 15% of their lengths from both midpoints, crossing angle 20 to 160 degrees, neither within 3 degrees of horizontal or vertical. *V sign*: two such segments sharing an end within 2 pt, angle 20 to 120 degrees, other ends within 4 pt of one horizontal or vertical line. *Dimension line*: a thin segment of at least 30 pt with a terminator at both ends (a tick of at most 8 pt crossing it at 30 to 60 degrees within 3 pt of the end, or a filled triangle of at most 10 pt with a corner within 3 pt of the end) and a text item with a digit within 12 pt of it. Also removed: the segments of glyphs, bubbles and grid lines, hatch segments, and segments shorter than 6 pt. The consumed items are counted per kind (brace signs are NOT pieces in the main total; a sensitivity adds them).
6. **Members.** Remaining segments are chained per (role, dashed): collinear (angle at most 1 degree, offset at most 1 pt), gap along the axis at most 8 pt (overlap allowed); chains of at least 24 pt. Split points on a chain: a column glyph (main or off-grid) whose centre is within its half-diagonal + 4 pt of the axis and whose projection lies within [-6, L + 6]; and a crossing with, or an end on, another chain of the same or heavier role (within 4 pt). A **span** is the part of a chain between consecutive split points or chain ends, at least 12 pt. A span end is *supported* by a column glyph within 8 pt of the end, or by another chain (end on it within 4 pt). **Supported** = at least one end supported. An *unsupported* span is kept, flagged `unsupported`, shown grey and NOT in the main total.
7. **Evidence.** Every piece stores its primitive ids, its two supports (type and id, or none), role and dashed flag, and the nearest profile label (from `page_labels`, within 30 pt of the span, evidence only: it changes no count). A piece without evidence is a bug and is asserted against in the tests.
8. **Pieces.** Linear pieces = supported spans (geometry: the span polyline). Column pieces = main-set glyphs (geometry: the glyph box). Page piece count = linear + column.

### 4.3 Scoring
Same data and page set as Part B, restricted to the pages of the side being scored (dev: 84 pages; held-out: 52 pages). Metric: Part B's geometry distance with the exact one-to-one rule at 12 (primary), 24 and 36 pt.
- Linear pieces alone, column pieces alone, and combined (joint matching of both sets against all symbols). Symbols carry no kind, so "alone" means each piece set matched against all symbols; the combined P and R use the joint matching.
- Sensitivities (reported, not the verdict): linear spans with the unsupported ones added; spans with both ends supported only; combined plus brace signs (one point per sign at the crossing or the apex).
- Page agreement: combined main piece count against the symbol count: equal, within plus or minus 1, within 20%.
- Verdict by the existing bars (worth building / promising / not enough) on the HELD-OUT combined figure at 12 pt.
- Chance: both Part B controls (uniform, displaced) on the same pages, 20 replicates, for the combined piece set.
- Dev and held-out are reported separately; held-out also without job-015 and dev without job-012. Per-job table for held-out.
- Reading guide for the held-out result (fixed now): "signal over chance" needs R at 12 pt at least 0.10 above the larger control recall AND P at least 1.5 times the larger control precision. The bars decide "worth building" and "promising" and nothing else does.
- **Miss reasons** for every unmatched held-out symbol, ONE reason, in this fixed order: (1) outside the view box; (2) no parsed primitive within 24 pt; (3) within 24 pt only primitives that the grammar consumed (grid, dimension, brace sign, hatch, glyph edges of a bubble); (4) a candidate that the grammar kept but excluded from the main total within 24 pt (unsupported span, off-grid glyph, span below the minimum); (5) a main piece within 12 pt, but taken by another symbol; (6) a main piece 12 to 24 pt away; (7) a main piece 24 to 36 pt away; (8) other.

### 4.4 Overlays
12 images in `fixtures/private/shots/phase7/`: 6 dev pages and 6 held-out pages chosen by seed 7301 from the pages of that side with at least 20 symbols, at most one page per job, sorted by (job, page) before drawing. Each shows our spans (supported in one colour, unsupported grey), supports, column glyphs (main one colour, off-grid grey), grid lines and bubbles, and the estimator rings. The held-out overlays are drawn only after the single held-out scoring run.

### 4.5 Unit tests (synthetic PDFs, no drawings)
Parse (stroke and fill, dash, width, closed shapes, curves, a Form XObject with a transform, a rotated page); roles (width histogram, hatch group, dashed); bubble and grid line (Latin and non-Latin labels, family by content not direction); glyph (box, filled, signature, merge of an outline and a fill); X and V signs and dimension lines are consumed; chain across a small gap; split at a glyph and at a crossing; the span with no support is kept and flagged and not in the main set; every piece has evidence; the held-out guard refuses without the tag.

## 5. Limits fixed in advance
- Estimator symbols are clicks, not true member positions; matching within a radius can pair a symbol with the wrong member.
- The page map of Phase 5t is uncertain on 13 pages (3.2% of symbols); not corrected here.
- Sixteen jobs; the held-out side is six jobs and 1,659 symbols, one of them large. A held-out result is one draw, not a general claim.
- Raster pages and pictures inside vector pages are flagged only. The stroke-text reader, any trained detector and UI work are out of scope.
- The v1 grammar does not model double-line (flange-drawn) beams, curved members, sloped or stacked glyph libraries, or text-based grid bubbles drawn as strokes (no text layer). These are expected losses and are listed in the results, not fixed after the held-out run.

## 6. Errata (found with synthetic test PDFs, BEFORE any Part C run on real drawings)
1. **Hatch (rule 2).** The rule as written flags only segments with at least 4 neighbours, so the two outer lines of a stack of 8 parallel lines at 3 pt spacing (each with only 2 neighbours within 6 pt) were not hatch. One propagation pass is added: a segment that satisfies the same geometric neighbour test (angle, length, offset, overlap) against at least one core hatch segment is hatch too. Core rule unchanged.
2. **Tick terminators (rule 5).** Ticks of at most 8 pt are shorter than 12 pt and therefore always have the role `hatch`; the tick search accepts any segment inside the view box (not only roles above hatch). The tick angle (30 to 60 degrees to the dimension line), the end tolerance and the numeric text requirement are unchanged.
3. **Chain end order.** The order of the two ends of a chain (and of a span) along its axis is arbitrary (set by the angle cut of 22.5 degrees); nothing downstream depends on it.
These are code-versus-text corrections made on synthetic data; they are not dev revisions and do not count against the limit of 5.

