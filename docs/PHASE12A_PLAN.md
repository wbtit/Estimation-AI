# Phase 12a: engine fixes for clear bugs (before the manager's session)

Local branch `phase-12a-engine` (from `phase-11c-ux`). Build rules change here, each as a named
rule with named constants; `RULES_VERSION` = `phase12a-build-v1`. phase11r-job-018 and every frozen
snapshot are not touched. The UI round planned on `phase-11c-ux` is paused (nothing written); its
item 4 (no beam pen on column plans) is item 4 here.

## 1. Rules

| # | Rule | Where | What it does |
|---|---|---|---|
| 1 | `dash_pattern` | `worker/src/build/beam_lines.py` | Each collinear chain of the pen is put in order and cut into runs at pieces over 40 pt or touching pieces. A run of ≥ 5 pieces is a dash pattern when its gaps are regular (80% within 25% + 0.5 pt of the median), the median gap is ≥ 0.2 × the median piece and the piece lengths take ≤ 3 values (80%). Its pieces are dashes: left out with a solid pen, used with a dash pen (as the old dash rule). |
| 2 | `wall_band` | `worker/src/build/not_beams.py` | A pen line is a wall face when its nearest parallel line covering ≥ 50% of it is 4 to 24 in away and the band holds fill (hatch role, cross strokes ≤ 2 × the band, strokes and small shapes ≤ 6 pt; ≥ max(4, one per 48 pt)), or when it runs along a closed filled band 4 to 24 in thick. |
| 3 | `column_shape` | `worker/src/build/not_beams.py` | A pen line ≤ 3 ft with a column position (glyph, column-plan column, projected column, base plate) beside its middle (15% to 85% along, 0.2 to 1.0 × its length away) and closed towards it (perpendiculars at both ends, or one from its middle third) is a column outline, not a beam. |
| 4 | auto mode | `worker/src/build/auto.py` | A column-plan page gets beam pen = none (system value, evidence `pen_rule: column_plan_no_beams`). New auto runs only. A proposal default: a deviation. |
| 5 | marking (web) | `web/src/components/Canvas.tsx` | An undefined beam is a solid red line with a "?" badge. No overlay is dashed except view and crop boxes (grids, suggested excludes, deselected pen lines and the drawing rubber band are solid). |
| 6 | `grid_marker` | `worker/src/build/base_plates.py` | A filled three-corner glyph within 6 pt of a grid line's axis and within 72 pt of its end or bubble (bow-tie end / break markers) is not a column glyph. |
| 7 | `base_plate` | `worker/src/build/base_plates.py` | Rings (curved closed shapes, or closed loops of short segments, round within 20%, ≤ 3 in): four of about one size (25%) at a rectangle's corners (1 pt), sides 2 to 36 in, are ONE column at the centre. The plate = the bolt rectangle grown by 0.35 × its larger side; every pen line inside it is the column's, never a beam. The outline inside the bolts sets `section_type` (rectangle → HSS, I → W, else none); the size still comes from labels. No grid crossing within 30 pt → kept, `off_grid`, build state needs review. A glyph column inside a plate is that same column. |
| 7b | `column_plan_supports` | `worker/src/build/supports.py` | On a column plan page every column found there (glyph or base plate) is a support node, so it is projected to the framing pages (added after the first results; section 4). |
| 8 | counts | build run counts | Per page: `base_plates`, `base_plates_off_grid`, `base_plate_columns`, `columns`, `grid_crossings`, `removed_grid_markers`, `removed_dash_pattern_runs` / `_segments`, `removed_wall_lines`, `removed_base_plate_lines`, `removed_column_shape_lines`. |

Order in the page build: grid markers are dropped from the glyphs; base plates are found; beam lines
per pen (dash pattern inside); then, per line, base plate, wall band, column shape.

## 2. What was looked at before the constants were fixed

- Dash diagnosis on the frozen phase11-job-018 snapshot (counts and lengths only): page 5 had a
  39-stroke chain of 27 / 9 / 9 pt pieces with 9 pt gaps (old rule: equal consecutive pieces of at
  most 14 pt only); page 14 had 4.5 pt dashes with 18 pt gaps (old rule: gap at most 2.5 × the
  dash). The constants of rule 1 were set from these two patterns and from first principles (a beam
  broken where members cross has gaps far shorter than its pieces).
- After rules 6 and 7 were written, one in-memory probe of page 18 (counts only): 8 grid lines of one
  family, 0 crossings, 13 columns by the repeated-glyph rule, all filled 3.1 × 9 pt triangles in
  bow-tie pairs; rule 6 catches 11 of the 13; 136 rings (1.5, 3.0, 4.5 pt); 32 base plates (all
  section type HSS, all off grid since there are no crossings). No constant was changed after it.

## 3. Measurement (pre-registered; committed before any run)

Fresh copies (`worker/tools/copy_project.py`, preview first), auto mode on each:

- before: `p12a-before-job-015`, `p12a-before-job-018`, `p12a-before-job-020` with the
  `phase-11c-ux` worker (a git worktree; rules `phase11-build-v1`);
- after: `p12a-after-job-015`, `p12a-after-job-018`, `p12a-after-job-020` with this branch.

Per built page (counts only), before vs after: beams found (pieces whose type is beam), pieces under
3 ft, pieces over 100 ft, beams on column-plan pages, found / needs review / attention, the
removal counts of each rule (after), and on column-plan pages base plates vs columns vs grid
crossings. job-018 is also compared with the frozen phase11 snapshot (phase11-job-018). Page 18 of
job-018: columns found, how many sit on a base plate, false columns removed by rule 6, beams found,
and an overlay PNG (after). Overlays of job-018 pages 16, 18, 21 (after) are looked at and what
still looks wrong is reported.

No constant is changed after any of these runs. A crash fix that does not use the results is
allowed and reported with its commit.

Then: `phase12-job-018` (preview, auto mode, new rules) is the project for the manager's session;
`demo3-job-018` is the walkthrough copy; older demo copies and the measurement copies are archived;
phase11r-job-018 stays archived and intact.

## 4. Deviations (to be repeated in the results)

- Crash fix after the first after-run (allowed by section 3; it does not use any count): on four
  job-018 column-plan pages the build failed with a unique-id violation because a hole drawn round
  each bolt made a second set of four rings at the same corners, so two plates (two columns) had the
  same centre. Now a ring inside a plate already found is part of that plate. No constant changed.
  The crashed copies were renamed `…-crashed` and archived; the after runs were redone on fresh
  copies (`p12a-after2-job-018`, `phase12-job-018`, `demo3-job-018`). job-015 and job-020 had no
  failure.
- Support fix after the second after-run, found FROM ITS RESULTS (job-018 page 16 lost 18 of its 19
  projected column supports), so it is stated as post-hoc: (a) base-plate columns were never
  support nodes on the column plan (the support glyph list was filtered from the page's glyphs,
  which do not hold plate columns), a defect of the base_plate wiring; (b) with no beams on column
  plans (rule 4), a column-plan column away from a grid crossing had no lines to make it a support
  node, so it was never projected to the framing pages. New rule "column_plan_supports": on a column
  plan page every column found there is a support node. No constant changed. All three jobs were
  re-run on fresh copies (`p12a-after3-job-015`, `-018`, `-020`), and `phase12-job-018` /
  `demo3-job-018` were made again; the superseded copies were renamed `…-superseded` and archived.

- Rule 4 changes a proposal default of auto mode (column-plan pages: no beam pen).
- Rules 1, 2, 3, 6, 7 change what the build finds (`RULES_VERSION` phase12a-build-v1); runs made with
  phase11-build-v1 are not rebuilt.
