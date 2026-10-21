# Phase 12c-A plan: detection with a person's page setup (pre-registered)

Written and committed BEFORE any run of this phase. No engine rule changes: the build runs with
`RULES_VERSION` = `phase12b-build-v1` exactly as committed on `phase-12b`. Counts only; job ids
only; no client, project or file names; private outputs under `fixtures/private/eval/p12c/`
(git-ignored). No constant below is changed after any result is seen. A crash fix in the evaluation
scripts that does not use the results is allowed and reported as a deviation with its commit.

Goal: measure detection quality when the PAGE SETUP is right (pages, role, scale), separately from
page selection, which Phase 12b measured.

## 1. Jobs and groups

The 15 jobs of Phase 12b: job-003, 004, 005, 006, 008, 010, 011, 012, 013, 014, 015, 017, 018,
019, 020 (job-002 stays out: no summary box). Groups, reported separately:
- **seen**: job-015, job-018, job-020 (used in Phase 12a);
- **Phase 7 dev**: job-003, 005, 006, 010, 011, 012, 013, 014;
- **strict held-out**: job-004, 008, 017, 019.

## 2. Their symbols (the answer per page)

- Marked-up set and page mapping: `fixtures/private/takeoffs/inventory.json` (`match`, `page_map`),
  with the Phase 6c frame check (`phase6c_frame_all.json`): drawing page = mapped page + best
  offset, and a symbol's drawing position = its displayed takeoff position (rotation applied) +
  (dx, dy) of that offset.
- A count symbol is a Polygon annotation with 3 or 8 corners; its point is the mean of its corners.
  Its tag prefix is the leading letters of the nearest FreeText within 40 pt (the tag study's
  radius, as in `tools/takeoff/prefix_inventory.py`). **B** = beam, **C** = column; every other
  prefix is "other", counted and not compared.
- Two marked-up pages mapping to one drawing page add up.

## 3. The simulated person setup

Stored on fresh copies `p12c-<job>` (`tools.copy_project`, preview first, then `--apply`; it never
copies person rows) as SYSTEM values: every `*_confirmed_by` stays NULL, no person action and no
person build is logged. Each built page's evidence carries `p12c_person_setup: true` and the source
of every value.
- **Pages to build:** the drawing pages holding at least one B or C symbol. Every other page gets no
  role (not built).
- **Role:** column plan if the page has C symbols and no B symbols; otherwise framing. The role
  name is the built-in name of that role (a pile plan title does NOT make it a pile plan here).
- **Scale, first source that gives one** (the source is recorded per page):
  1. `markup`: the estimators' measurement calibration on that page: every annotation of the
     marked-up page carrying a measurement entry, read with the Phase 5v reader
     (`measure_scale`, `ratio_from_measure`); ratios merged within 1%; the value carried by the
     most annotations; a tie between different values gives no markup scale;
  2. `parsed`: our stored scale (`propose_scale`);
  3. `dimensions`: the Phase 12b rule `scale_from_dimensions` on the proposed crop;
  4. none: the page is not built and is listed "no scale".
- **Crop:** our proposed crop (`propose_crop`). **Beam pen:** our suggester (`propose_pen`) on a
  framing page; none on a column plan (the Phase 12a rule). Elevation: as proposed (not used).
- **Build:** auto mode's order and code (column plans first, then framing pages with the column
  plan chosen by `choose_column_plan`), the frozen system version written as usual. The
  evaluation tool only replaces the role and scale of the proposal; the engine is not changed.
- Afterwards every `p12c-<job>` copy is archived.

## 4. Measures

"Ours" on a page: beams = pieces of kind Beams (kind Joist left out); columns = pieces of kind
Column (or Piles) on a page built as a column plan, duplicates INCLUDED (detection on the page).
Columns on framing pages are not compared; their C symbols there are reported apart (open question
140). A kind they did not mark on a page is not in "within 20%"; our pieces of that kind there are
reported as "extra on an unmarked kind".
- **Per page and kind** (beams on framing pages, columns on column-plan pages): ours, theirs,
  ours - theirs, % error = (ours - theirs) / theirs; within 20% = |ours - theirs| <= 0.2 x theirs.
- **Per job:** share of built framing pages with beams within 20%; share of built column-plan pages
  with columns within 20%; the job totals over these pages (columns with duplicates left out) vs
  the summary box (Columns, Beams), with % error.
- **Pages not built** (no scale, failed, refused) are counted and listed by reason; they are not in
  the bar's denominators.
- Medians of |% error| and signed % error per group and kind (page level and job level).

**Length check (secondary).** Their measurement lines on the built pages: Line or PolyLine
annotations of at least 3 pt with a measurement entry (the Phase 5v population, plus any others on
these pages). Only two-point lines are matched (longer paths are counted, not matched). Their length
= the value written in the markup when it parses as a dimension, else the clicked distance x their
markup ratio. A line matches our piece (kind Beams or Joist) on the same page when the angle
difference is at most **5 deg**, the piece covers at least **50%** of their line's length when
projected onto it, and the piece's distance from their line's midpoint is at most **12 pt** (the
lines are drawn on the member); the nearest such piece wins. Reported: matched, unmatched (no
piece), the length error ours - theirs in inches (median of |error|, 90th percentile of |error|,
median signed).

**Pen check (diagnostic).** Per framing page, every line of the proposed crop of at least 24 real
inches (at the page scale) with its pen class (`page_lines`). For each B symbol, the nearest such
line within the matching distance; the share of B symbols whose nearest line is of our chosen pen,
the share of another pen, the share with none; "the right pen" = the pen class nearest to the most
B symbols.

## 5. Matching distance and the failure table

The estimators' rings sit BESIDE members, not on them (Phase 7: median offset about 36 pt on one
page). **Primary matching distance: 36 pt** (symbol point to a beam piece's segment, or to a
column's point) for the pen check and every row of the failure table; **12 pt and 24 pt** are
reported as sensitivity. Matching is **one-to-one**: all symbol-piece pairs within the distance,
taken nearest first, each symbol and each piece used once (B symbols with beam pieces; C symbols
with columns). Only the under-split test lets one piece take several symbols.

Failure table, on the built pages only, as counts (rows can overlap; each is in member units so the
top causes can be ranked):

| Row | Counted as |
|---|---|
| Wrong pen | B symbols on framing pages where "the right pen" is not our pen |
| Marked beam with no piece of ours | B symbols left unmatched by the one-to-one matching |
| Joist taken as a beam | Our Beams pieces left unmatched that belong to a joist-like run: at least 4 parallel Beams pieces (within 2 deg) of lengths within 10% of each other, neighbours at a perpendicular spacing equal within 10% and at most 8 ft real |
| Over-split | B symbols with at least 2 of our Beams pieces within the distance that are collinear (within 2 deg, offset at most 2 pt) and end to end (nearest ends at most 6 pt apart) |
| Under-split | Our Beams pieces that are the nearest piece of 2 or more B symbols within the distance (each symbol to its nearest piece, not one-to-one) |
| Extra piece on a non-steel line | Our Beams pieces left unmatched, not in a joist-like run, on a framing page where our pen is "the right pen" |
| Columns missed | C symbols on column-plan pages left unmatched |
| Columns extra | Our columns on column-plan pages left unmatched |
| Unsized | Matched pieces (beams and columns) with no size (`profile` empty) |

Each row gets 3 gallery crops (27 images): three panels, drawing / ours / their markup, a 600 pt
square crop around the case (clipped to the page), with the case circled. The 3 cases are the first
three in a fixed order: jobs sorted by id, pages by number, cases by y then x; at most one case per
page, then a second pass if fewer than 3 pages have a case.

## 6. Bar (pre-registered, word for word)

"copilot viable" if, on Phase-7-dev + strict held-out jobs combined, beams are within 20% on at
least half of the built framing pages AND columns are within 20% on at least half of the built
column-plan pages. Otherwise "detection needs work", listing the top 3 causes by count from the
failure table. Report the same bar separately for the seen jobs and for strict held-out only (for
information; the verdict uses dev + strict held-out).

## 7. Outputs

- `worker/tools/p12c_setup.py`: copies are made with `tools.copy_project`; this tool stores the
  simulated setup and runs the build (preview first: it prints the page list, roles and scale
  sources, counts only, and writes nothing without `--apply`).
- `worker/tools/p12c_eval.py`: the measures, the failure table and the gallery (read-only on the
  database).
- `docs/PHASE12C_RESULTS.md`: the bar verdict at the top, then the tables.
- `fixtures/private/eval/p12c/`: per-page JSON and the 27 images.
- Lint, format and tests green for the touched code.
