# Phase 5 plan: review screen and takeoff table (v1)

Goal: the estimator sees, per sheet, what the system found (scale, labels, members, takeoff rows) with green, amber and red marks, fixes anything quickly, and exports a takeoff table. Estimating steps 2 to 6: read notes, set scale, go through sheets, count and measure members, produce the takeoff list. The Phase 4e study showed fixed-rule linking is 44% top-1, so the system **suggests** and the human **confirms or fixes**; every correction is saved as labeled data. The linking rule is not improved in this phase.

Branch `phase-5-review-v1` (from `phase-4e-study`, which contains `phase-4d`; checked). Step 0b (separate test database, loud failure against the real one) is done and committed before this plan.

## Test document

**job-005** (AutoCAD-type, 35 pages, vector). Chosen by structure only among the 8 study documents: the text-layer documents with the most true framing-plan pages among their plan-like pages are job-004, job-005 (3 each); job-005 has a single steel stroke class and clean text, job-004 mixes wood and steel linework; job-002 and job-016 have raster member lines (out of scope); job-001 is outlined text (out of scope). It is referred to by number only.

## Slices (commit after each; lint and all tests after each)

1. **Viewer, page list, scale.** Page list with thumbnails and page type; page view with pdf.js and an SVG overlay in displayed page points (rotation handled by PDF.js and by the displayed-coordinate geometry of the worker). Scale is stored **per view**: a box the user draws on the sheet (table `sheet_views`). The scale is suggested from scale text inside or near the box (Phase 4d scale parser, read from `text_items.parsed`); the user confirms or types it. Stored: `scale_ratio`, `scale_source` (`detected_text` or `user_confirmed`), the box. Conversion: PDF points to paper mm (x 25.4/72), times `scale_ratio`. Members cannot be measured until their view has a confirmed scale.
2. **Labels and page type.** Toggleable overlays for profile labels, marks, dimensions, elevation notes and scale text (from `text_items`). Page type guess (framing plan, foundation plan, elevation, detail, schedule/legend, general notes, other) from title and view-title keywords plus profile counts, shown as a guess with its reason; override saved in `sheet_edits`. Level name per sheet suggested from the title, editable (also in `sheet_edits`). Notes panel: text lines of general-notes pages, searchable, highlighting A992, A36, A500, A572, galvaniz*, primer, shop paint and bolt types. No parsing into fields.
3. **Proposed links with colors.** For each profile label (and each mark label that has a legend row) in a view with a confirmed scale, the frozen Phase 4e rule runs and the top 3 candidate lines with scores are stored; the best is the proposal. Colors (below). Legend link by mark across the whole document. Length from the proposed line and the view scale (`length_source = plan_geometry`). Columns are added by the user (click a plan point, give mark and profile).
4. **Fast fixing and saved corrections.** Click a label, then click the right line (or press 1, 2 or 3); add and delete a member; change profile text, mark, level; confirm a legend link; "looks right" turns amber into confirmed green. Every action goes to `member_edits` (before, after, who, when, `action_id`). Undo of the last action. Export of all corrections as JSONL (label, proposed link, final link, who, when). Keyboard shortcuts.
5. **Takeoff table and export.** Rows: mark, `profile_raw`, canonical profile, quantity, length (mm and feet-inch), level, sheet, color, source bbox (click a row to jump to the member on the sheet), grouped by mark and profile; totals per level and overall with a separate "excluded (red)" line (red is excluded from the main total, amber stays in). Excel export (exceljs, same plain-value conventions as the BOM export). No weight and no price columns. The validator, BOM and Excel export of earlier phases are not modified.

## Color rules (one config file: `api/src/review/status.ts`, tested)

- **green** = rule confidence class `high` AND profile parsed AND (mark linked to a legend row OR profile given directly on the label), AND the view scale is confirmed.
- **amber** = `medium`, or `high` with a missing piece.
- **red** = `low`, no candidate, `ambiguous` mark, scale not confirmed, no length. A column with no determinable base elevation is red. Columns are exempt from the unsupported-member check (no such check runs in the takeoff).
- **unlinked** (Phase 5b): a profile label with no candidate line within the rule radius and no typed length is NOT a red member; it is listed as an unlinked label on its sheet, counted as a warning on the takeoff, and is in no total. A person makes it a member by picking or clicking a line, or by typing a length.
- **shared line** (Phase 5b): a member that shares its chosen line with other members is amber (reason `shared_line`) until a person says "separate members" or merges them.
- A member the human marked "looks right" (`review_status = approved`) or fixed (`edited`) shows as green **confirmed** (a separate flag, same color) unless a red condition remains (no scale, no length).
- Frozen rule (`worker/src/linking/`, ported from `worker/tools/study`, not retuned): candidates = 6 nearest structural lines within 150 pt (minimum 12 pt); score = distance + 20 pt if the angle to the text baseline exceeds 5 degrees; best score wins; `high` = margin of at least 40 pt and aligned; `medium` = margin of at least 5 pt; else `low`. Side preference, leader following and group notes stay off (as frozen).
- **Structural stroke class per view:** suggested deterministically (the heaviest solid non-grey width class with at least 8 lines of 12 pt or more inside the view, excluding the sheet border), shown with swatches, confirmed or changed by the user, stored on the view.

## Schema: additive migration 005 (subset of `docs/SCHEMA_CHANGE_PROPOSAL.md`, plus what the slices need)

Existing columns and migrations 001 to 004 are untouched. Original extracted values are never overwritten; human changes are `member_edits` rows. Internal units mm.

| Table               | Addition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheets`            | `page_type_guess` text (7 values), `page_type_reason` text, `level_guess` text, `plan_frame` jsonb (page size, rotation, origin convention)                                                                                                                                                                                                                                                                                                                                                                                             |
| `sheet_views` (new) | `id`, `sheet_id` -> sheets, `name`, `box` jsonb `{x0,y0,x1,y1}` (displayed pt), `scale_ratio` numeric > 0, `scale_source` (`detected_text` / `user_confirmed`), `scale_text`, `scale_confirmed` boolean, `structural_classes` text[], `plan_frame` jsonb (origin = lower-left of the box, y up, mm), `created_by`, timestamps                                                                                                                                                                                                           |
| `legend_rows` (new) | `id`, `project_id`, `sheet_id`, `mark`, `designation_raw`, `profile` (canonical or null), `remarks_raw`, `source` jsonb (text item key, bbox)                                                                                                                                                                                                                                                                                                                                                                                           |
| `members`           | `view_id` -> sheet_views, `label_key` text (stable key of the source label), `mark_ref_status` (`linked` / `no_legend_row` / `ambiguous`), `legend_row_id` -> legend_rows, `length_source` (`plan_geometry` / `manual`), `plan_sheet_id`, `plan_start_x_mm`, `plan_start_y_mm`, `plan_end_x_mm`, `plan_end_y_mm`, `plan_bbox` jsonb, `plan_scale_ratio`, `plan_method` (`pdf_geometry` / `manual`), `link_candidates` jsonb (top 3 with scores), `link_confidence` (`high` / `medium` / `low`), `link_margin` numeric, `link_rule` text |
| `member_edits`      | `action_id` uuid (edits of one action share it), `undo_of_action_id` uuid (an undo appends inverse rows; nothing is deleted)                                                                                                                                                                                                                                                                                                                                                                                                            |

**Migration 006** (added during slice 3, additive): `sheet_views.class_table` jsonb (the stroke classes seen in the view, written by the link job) and `sheet_views.classes_confirmed` boolean (a person chose the member line classes).

**Migration 007** (added during slice 4, additive): `sheet_views.structural_lines` jsonb (the structural lines of the view, written by the link job, used as click targets when a person picks the right line or adds a beam).

Not in 005: dimensions table, `elevation_source`, `length_source = dimension`, anything priced or weighed.

## Worker and API

- Worker: `pdf_scan/pagetype.py` (page type and level guesses in the scan), `review/legend.py` (legend rows from text lines, called by `read_text`), `linking/` (line reconstruction, candidates, frozen rule), job `link_view` (payload `{view_id}`; creates or refreshes **unreviewed** members of a view, never touches reviewed or edited ones, upserts by `label_key`).
- API: PDF file stream (range requests), views CRUD, scale suggestion, page type and level overrides, notes, members with effective values and colors, member actions and undo, takeoff JSON and xlsx, corrections JSONL. Effective value = latest edit over the stored value.
- Web: React + TypeScript + Vite (existing stack), `pdfjs-dist` for the page canvas, SVG overlay, no state library.

## Acceptance checks (all run, reported with counts)

Isolation test fails against the real database; migration 005 applies on the test database and leaves 001 to 004 untouched; scale conversion and rotated-page tests; page type and level guess tests; legend link tests (linked, none, ambiguous); frozen-rule parity test against the Phase 4e study implementation on synthetic data; color function table test; edit, undo and export tests; takeoff grouping and red-exclusion tests; web logic tests; end-to-end run on job-005; calibration of colors against the Phase 4e AI gold; headless screenshots of each slice if a browser is available.

## Will NOT do

Pricing, weights, AISC shape database, Tekla, computer vision, raster-tile or outlined-text documents (job-001, job-002, job-016), glyph work, automatic column detection, dimension-string validation, dimensions table, cross-document learning, LLMs anywhere in the pipeline, retuning the linking rule, leader following, new auth, anything that calls a network service from the pipeline.

## Risks

1. **Most marks may come out red**: the rule is 44% top-1 overall and 49% of labels had no candidate in the study; on job-005 the study was better (85% validation top-1) but the structural class and scale now depend on user confirmation. Reported plainly.
2. Structural class suggestion may pick wrong lines (mixed classes, column rectangles, grid bars); the user can change it per view.
3. Scale per view needs the user to draw a box before anything is measurable (by design).
4. The study gold is AI-made; the calibration of colors is against that gold only.
5. Browser screenshots may not be possible in the sandbox; then slices are verified by API and logic tests plus data-driven renders, and the report says so.
6. Scope: five slices in one phase; each slice is committed separately so any can be dropped.
