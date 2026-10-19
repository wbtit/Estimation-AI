# Evaluation pack (Phase 12a state, 2026-10-19)

Job ids only. Images are in `fixtures/private/eval/` (git-ignored); open `fixtures/private/eval/index.html`.
**job-018 is not held-out**: it was used in Phases 7 to 12a, so every job-018 number here is a best case, not an accuracy.

## 1. Goal and philosophy
- **Goal:** a steel estimator gets a first-draft takeoff (pieces, sizes, lengths, weights, a BOM) from the drawings, and checks and fixes it much faster than counting by hand.
- **Steel Genie's flow:** estimators already work that way (pages, set up each page, build, review, BOM). We copy the flow so nothing new has to be learned.
- **Line-first:** a beam is a drawn line of the right pen, so we start from linework and attach labels to it. The label-first approach (Phases 5 to 9) missed members that had no label of their own.
- **A person sets up each page** (role, crop, scale, beam pen, Top of Steel, column plan). These are the inputs the engine cannot read reliably, and five clicks fix them. Auto mode proposes them; a person confirms.
- **Deterministic rules, no LLM in the engine:** the same drawing always gives the same answer. Every rule has a name and fixed constants, so a mistake can be traced and fixed.
- **Everything is logged and measured:** every person action (who, when, ids) and every build's counts. The system version is frozen before anyone edits, so "what the machine did" and "what the person changed" can always be told apart.

## 2. Pipeline, upload to BOM
| Step | What it does | Main constants | Person input | Known to fail |
|---|---|---|---|---|
| Scan | pages, page kind (vector/raster), thumbnails | — | upload | raster pages are not built |
| Text | text layer lines and words | — | — | stroked text is not text |
| Scale | reads printed scales per page | — | Scale field | **pages with no readable scale are refused: 21 of 30 on job-015, 8 of 9 on job-020** |
| Proposals (auto mode) | role from page type, crop from grid bubbles, beam pen, scale, T.O.S. | crop margin 36 pt; pen = heaviest solid class with ≥ 8 lines ≥ 12 pt | confirm on Save page | job-018 p9 crop is a tiny corner; detail sheets get the framing role |
| Views | several boxes per page, each with its own setup | — | Add view, Edit box | — |
| Crop / exclusions / pens | the view box clips segments; exclude boxes drop content; deselected lines are not beams | deselect: direction 1°, 1.0 pt, 50% overlap | Crop, Exclude, Pick beam | — |
| Segments | vector paths into segments with width, colour, PDF dash flag | thin filled rect = segment (≤ 6 pt, aspect ≥ 8) | — | — |
| Cleaning | hatch, dimension lines, text strokes removed | hatch: ≥ 4 parallel neighbours within 6 pt | — | sparse hatch is missed (see walls) |
| Dash rule | equal dashes 1–14 pt; Phase 12a `dash_pattern` (≤ 3 piece lengths, regular gaps ≥ 0.2 × piece) | run ≥ 5, piece ≤ 40 pt | — | — |
| Grids | bubbles + dash-dot or long lines, crossings by family | at grid 30 pt | — | job-018 p18: both families read as one, so 0 crossings |
| Columns / base plates / grid markers | glyphs at crossings or the repeated glyph; 4 bolt rings = 1 column (HSS/W from the outline); bow-tie markers dropped | glyph 3–24 pt; bolts 2–36 in apart | Draw column | **every column has no size** (labels are not attached on column plans); piles counted as columns (job-018 p14) |
| Beam lines | chains of the pen's segments | bridge 24 pt, 1°, 1 pt, min 24 pt | Pick beam / Add pen | wrong pen picked: HSS framing in a thin pen gives 0 beams (job-018 p12) |
| Walls | `wall_band`: parallel faces 4–24 in apart with fill between, or a filled band | fill ≥ max(4, 1 per 48 pt) | — | deck-edge lines with marks between are removed as "walls" |
| Column shapes | `column_shape` / `base_plate`: outlines and plates around a column are not beams | ≤ 3 ft | — | — |
| Supports | columns, then girders, then beams (Alberta order); every column of a column plan is a support | snap 12 pt | — | sections and details have no columns, so their pieces are unsupported |
| Splitting | a line splits only at supports of an earlier level | overhang trim | move ends | — |
| Labels | size text attached by parallel reach, then nearest | reach 36 / 48 / 60 pt | Section Size | **joist labels (e.g. 30K7) are taken as beam sizes "inferred"**; detail sheets give unsized pieces |
| Lengths | support to support × scale | — | ends | — |
| States | found / needs review / attention | — | Approve | — |
| Tags, BOM | tag per kind, catalog weight (AISC v16) | — | Member type | — |

## 3. What the UI offers
Projects (list, create, stage, archive) · Workspace: Pages (cards with ▶ build, ⋮ menu, views, role, T.O.S., scale, setup chips) and Members list · Canvas tools: Select V, Hand H, Crop C, Pick beam P, Exclude X, Add view, Draw beam B, Draw column K, Measure M · Layers (fade, filters, Only problems, Hide approved) · Issue navigator N / Shift+N · Approve A · Undo · Properties: Summary (sheet and project, Members by size), Member (size, type, studs, camber, ignore, delete) · Save page (asks to approve what is left) · BOM tab (filters, Excel) · Report tab (system version vs saved final) · Export: BOM Excel, Report Excel, answer key. Screenshots: `fixtures/private/eval/ui/`.

## 4. Data and measurement
- Every member has a build run and view; every person edit is a `member_edits` row (undoable); every action is a `count_actions` row; view changes are `view_undo` rows.
- **Frozen system version:** at the end of auto mode, `build_snapshots` stores each page's setup (with sources) and every piece. Nothing changes it later.
- **Report:** per page and per size, the system version against the saved final (kept, size changed, removed, added, confirmed unchanged by a person).
- **Answer key export:** the saved final as JSON, for scoring later builds.

## 5. Honest status
| Status | Claim | Evidence |
|---|---|---|
| Proven | Phase 12a removes junk pieces | job-018: under 3 ft 378 → 39, beams on column plans 377 → 0, over 100 ft 19 → 1 (section 6) |
| Proven | The build is deterministic and the frozen version is reproducible | the old-rules rerun equals the frozen phase11 snapshot on all 8 totals |
| Proven | Quantities are **not yet** usable | 0 of 13 beam sizes within 20% on job-018 (section 6) |
| Likely | Real framing beams are found where the pen is right | job-018 p16: beam lines on W16/W21 framing (overlay) |
| Unknown | Any number on an unseen job | no held-out evaluation since Phase 7 |
| Known broken | Columns have no size | 272 of 272 columns on job-018, 172 of 172 on job-015 |
| Known broken | Pages without a scale are not built | 29 of 39 framing/column pages on job-015 and job-020 |
| Known broken | Joists read as beams with a size | 27 of 58 needs-review beams on job-018 have a K-joist label at their middle |
| Known broken | Detail and section sheets are built as framing | job-015 p26, p33, p34, p36; job-020 p8: all their pieces are unsized |

## 6. Numbers
**Phase 12a, before (rules phase11-build-v1) → after (phase12a-build-v1), auto mode on fresh copies:**

| Job | Beams | Under 3 ft | Over 100 ft | Beams on column plans | Found / review / attention | Columns |
|---|---|---|---|---|---|---|
| job-018 | 655 → 133 | 378 → 39 | 19 → 1 | 377 → 0 | 24/99/757 → 15/58/332 | 225 → 272 |
| job-015 | 811 → 253 | 691 → 181 | 7 → 7 | 289 → 0 | 0/2/986 → 0/0/425 | 177 → 172 |
| job-020 | 96 → 36 | 95 → 36 | 0 → 0 | — | 0/0/96 → 0/0/36 | 0 → 0 |

**Pre-registered Phase 11 measures** (docs/PHASE11_PREREGISTRATION.md 5–8) on the **system version alone (no person setup)**, against the estimators' workbook (job-018; theirs: 13 beam sizes, 195 beam pieces, 3,314 ft; 5 column sizes, 69 columns):

| System version | Beam pieces (main) | Beam sizes within 20% | Beam weight error | Columns sized | Bar |
|---|---|---|---|---|---|
| phase12-job-018 | 73 (1,883 ft) | 0 / 13 | −28.5% | 0 of 272 (0 / 5 sizes) | not yet |
| phase11 frozen | 123 (2,538 ft) | 0 / 13 | −2.5% | 0 of 225 (0 / 5 sizes) | not yet |

The phase11 weight is close only by accident: its 123 "sized" pieces include junk; per size, none is within 20%, and 10 of 13 sizes were never found. Phase 12a removed junk that happened to carry weight.

## 6b. Counts against the estimators (PARTIAL: usage limit reached)
Summary boxes on the marked-up sets (kind and number as written; "~" kept as written, meaning not guessed):

| Kind | job-018 theirs | job-018 phase11 | job-018 phase12 | job-015 theirs | job-020 theirs |
|---|---|---|---|---|---|
| Columns | 70 | 225 | 272 | 162 | 33 |
| Beams | 163 | 655 | 133 | 546 | 77 |
| Horizontal braces | 5 | 0 | 0 | — | — |
| Vertical braces | 38 | 0 | 0 | 36 | 4 |
| Kicker braces | — | — | — | 30 | 10 |
| Girts | 30 | 0 | 0 | 10 | — |
| Posts | "37~20" | 0 | 0 | 16 | 16 |
| HP piles | "85~20" | (counted as columns, p14: 103) | (103) | — | — |
| Joists | 10 | — | (27 joist lines read as beams) | — | — |

Our job-015 total is 253 beams and 172 columns; job-020 is 36 beams and 0 columns, mostly because pages without a scale are not built.

**Not done (limit reached):** per-page symbol counts by tag prefix (F.3), the gap buckets with duplicates and non-steel (F.4–F.5), and the 5 biggest-difference pages (F.6). The inputs exist: `fixtures/private/takeoffs/prefix_inventory.csv`, `fixtures/private/eval/pages-*.json` (estimator symbols per page) and `failures.json`.

## 7. Top 10 failure patterns (job-018, job-015, job-020; Phase 12a after-copies)
Ranked by pieces affected; crops in `fixtures/private/eval/failures/` (3 each).

| # | Pattern | Count | Cause |
|---|---|---|---|
| P1 | Estimator work on pages we did not build | 1,002 symbols and lines | no readable scale: the page is refused (job-015 748, job-020 254) |
| P2 | Column with no size | 444 | labels are not attached to columns on column-plan pages |
| P3 | Beam with no size | 347 | pieces on detail/section sheets, or the label is out of reach |
| P4 | Estimator beam line with no piece of ours | 143 | wrong or thin pen (HSS framing on job-018 p12), sections |
| P5 | One or no end supported | 328 | sections and details have no columns or girders |
| P6 | Piece under 3 ft | 256 | detail-sheet fragments (flanges, plates in sections) |
| P7 | Column plan with no grid crossings | 235 columns | both grid families read as one (job-018 p18), or detail sheets as column plans |
| P9 | Glyph column away from any grid | 141 | the repeated-glyph rule picks small symbols (rebar dots, elevation targets) |
| P8 | Joist given a beam size | 27 | K-joist lines are in the beam pen and take a nearby label |
| P10 | Piece spanning the whole view | 5 | sheet border or match line in the beam pen |

## 8. Open questions
1. Should pages with no readable scale ask a person for the scale before auto mode, rather than be refused?
2. Should detail and section sheets be skipped by default (role "Don't build")?
3. Joists: count them as their own kind (from the K / LH label), or ignore them?
4. Piles on a pile plan: a kind of their own, not columns?
5. Column sizes: read from the column schedule, or from labels at the column?
6. What do "37~20" and "85~20" mean in the summary box?
7. Do estimators count a member once per job (plan only) or also in sections? This decides how duplicates are handled.

## 9. Not produced
- The UI round's Page setup popover, colour legend, Colour by, Pin and Lock do not exist yet (that round is paused), so there are no screenshots of them. Layers is shown without a legend.
- The Approve screenshots are from the earlier approve round (demo-job-018), because this task is read-only.
- Section 6b is partial (above).
