# Phase 11c plan: review UX fixes from the owner's dry run

Local branch `phase-11c-ux` (from `phase-11b-ui`). This phase is UI work plus person inputs that the build reads. Build rules (the thresholds and logic in worker/src/build) do not change, and auto mode is never run on phase11-job-018. Section 8 lists every place where the build reads a new input. The same list goes into PHASE11_RESULTS.md as deviations.

## 1. Data (migration 020, after a backup; applied to `_test` first, then the real DB)

- **New table `build_views`.** I'm not reusing `sheet_views`, because its rows are label-first views with their own scale gating and stroke classes, and mixing the two would change label-first behaviour. Columns:
  - `id`, `sheet_id`, `name` ("View 1"…), `position`, `box {x0,y0,x1,y1}` (page points);
  - `role_name` (FK → `role_names`, ON UPDATE CASCADE);
  - `scale_ratio`, `scale_text`, `tos_mm`, `tos_raw`, `tos_source`;
  - `column_plan_view_id` (FK → `build_views`, SET NULL);
  - for each of box/crop, role, scale, T.O.S., pens and column plan: `*_source` ('system' | 'person') and `*_confirmed_by` / `*_confirmed_at`, with the same rules as today;
  - `no_beams`, `setup_changed_at`, `created_by` / `created_at`.
- **`view_pens`:** `view_id`, `pen_class`, `position` (1 = the first pen, 2+ = added pens), `source`, `confirmed_by` / `confirmed_at`.
- **`view_exclusions`:** `view_id`, `box`, `status` ('suggested' | 'accepted'), `rule` (for suggestions: frame | title_block | table), `created_by` / `created_at`. Only accepted rows count.
- **`view_deselections`:** `view_id`, `line {x0,y0,x1,y1}` (the `sheet_lines` row, rounded to 0.01 pt), `line_index`, `lines_version`, `created_by` / `created_at`.
- **`role_names`:** `name` (PK), `behaviour` ('column_plan' | 'framing' | 'none'), `built_in`, `created_by`, `updated_by`. Organisation-wide. It is seeded with the 10 built-in names and their default behaviours.
- **New nullable columns:** `members.build_view_id` and `build_runs.view_id`. NULL means the page's first view, so existing members are not rewritten. phase11-job-018 therefore keeps every sheet, member and snapshot row unchanged; it only gains view rows.
- **Backfill:** each sheet gets one view with exactly its current setup values and sources:
  - the box is the crop;
  - the pen goes into `view_pens`; No beams becomes `no_beams`;
  - `build_role` maps as column_plan → "Column plan", framing → "Framing plan", NULL → "Other" (Don't build);
  - the column plan link points to the linked page's first view.
  - The `sheets` setup columns stay in place but become a read-only legacy copy. Before and after counts are printed.
- **Copies:** `copy_project` also copies the views, pens, exclusions and deselections.

## 2. Build input contract (worker, `build_sheet` per view)

A Build press, or a rebuild in auto mode, makes one `build_runs` row for each view whose behaviour is not none. Inputs, all read from the view:

| Input | How the build reads it |
|---|---|
| crop | the view box |
| scale | `scale_ratio`; lengths use this ratio |
| T.O.S. | `tos_mm` |
| role | behaviour column_plan or framing |
| beam pens | 1..n pen classes. `beam_lines` runs once per pen and the results are concatenated, with line ids renumbered in pen order. No pen together with `no_beams` = no beams. |
| exclude boxes | accepted only. Each segment is clipped to the parts outside every box, using the existing `geom.clip_segment`. Text lines whose centre falls in a box are dropped before bubbles, labels and grids. |
| deselected lines | a pen segment is removed when it lies on a deselected line: direction within 1°, distance from its axis ≤ 1.0 pt, and at least 50% of its length overlapping. This is matched by geometry because `sheet_lines` and the build's segments come from two extractors. After each build, the deselections that matched no pen segment are counted in `build_runs.counts.deselections_unmatched` and shown on the view ("2 deselected lines not found"), so a mismatch is never silent. |
| column plan | the linked column-plan view (its grid lines, scale and columns) |

Storing is scoped to the view. A rebuild replaces only the untouched pieces of that view, and pieces carry `build_view_id`. Auto mode (`propose_sheet`) writes its proposals to the page's first view instead of the `sheets` columns. The proposal rules themselves don't change. Snapshots stay one per page: `setup` gets a `views` list, and `pieces` is the union of the page's views. The report still compares per page and adds a per-view count.

Any change to a view's box, role, scale, T.O.S., pens, exclusions or deselections sets `setup_changed_at`, which shows the view (and its page card) as "Requesting Build".

## 3. API

- **View routes:**
  - `GET/POST/PATCH/DELETE .../sheets/:sheetId/views` (box, name, role_name, scale, T.O.S., column plan view).
  - `.../views/:viewId/pens`: pick (replace | add), delete.
  - `.../exclusions`: add, delete, accept, accept-all.
  - `.../exclusions/suggest`: proposes boxes from `sheet_lines` and text, using the deterministic rules below. The results are stored as suggested rows.
  - `.../deselections`: toggle one line; box (ctrl-drag); reset.
- **Role routes:** `GET/POST/PATCH /api/role-names`. A new name requires a behaviour, and an edit is logged.
- **The old per-sheet setup routes keep working.** They act on the page's first view, so the current UI and tests carry on.
- **Logging:** every route writes a `count_actions` row with the sheet id and `detail` = {view_id, kind, counts and ids only}. View, pen, exclusion and deselection changes use action 'setup' (or 'pick_pen'), so they count in minutes-per-page, and auto mode's "a person already worked here" guard still sees them. Role list edits get a new action 'role' (one CHECK widened) and carry no sheet id.
- **Suggested excludes** (proposals only, never applied without Accept). They are conservative: a missed suggestion is better than one over framing. The constants live in `api/src/review/excludes.ts`:

  | Constant | Value | Meaning |
  |---|---|---|
  | `FRAME_EDGE_FRAC` | 0.03 | a frame line lies within 3% of the page size from a sheet edge |
  | `FRAME_SPAN_FRAC` | 0.5 | ...and spans at least 50% of that edge; one band per edge, from the edge to the line + `FRAME_PAD_PT` |
  | `FRAME_PAD_PT` | 4 | pad of a frame band |
  | `TITLE_ZONE_FRAC` | 0.30 | the title block line lies in the right 30% of the page |
  | `TITLE_SPAN_FRAC` | 0.8 | ...is vertical and spans at least 80% of the page height; the band runs from the left-most such line outside the frame zone to the right edge |
  | `TABLE_MIN_LINES` | 12 | a table is at least 12 axis-aligned lines... |
  | `TABLE_MIN_CELLS` | 6 | ...that cross into at least 6 cells |
  | `TABLE_LINE_MAX_FRAC` | 0.25 | table lines are shorter than 25% of the page width |
  | `TABLE_JOIN_PT` | 2 | lines closer than this belong to one cluster |
  | `GRID_OVERLAP_MAX` | 0.05 | a suggestion is dropped if more than 5% of its area overlaps the view's grid area |

  The grid area is the bounding box of the grid lines and bubbles (`grid_lines` rows) of the page's latest build that fall in the view box. With no grid evidence at all, no table suggestions are made, only frame and title-block bands. Those bands still have to pass the 5% check against the view's built beam lines, if there are any.

## 4. Web

- **Zoom and pan:**
  - Ctrl+wheel and pinch zoom around the pointer. Plain wheel pans vertically, Shift+wheel horizontally; Space+drag and middle-button drag pan freely.
  - The range is 10–800%. Fit resets the view, and the % box can be typed into.
  - The wheel handler is bound only to the canvas.
  - The pure maths lives in `lib/zoom.ts`.
  - Rendering has two layers. Underneath is a low-resolution render of the whole page, made once per page at no more than 4096 px on the long side and CSS-scaled, so panning and zooming never show blank areas. On top, after 200 ms with no zoom or pan change, the visible area (plus a margin) is rendered at full resolution. This avoids the canvas size limit at 800%.
- **Colours:**
  - CSS variables in one place: beam #D500F9, column #2979FF, review #FF9100, attention #FF1744, ok #00C853. Drawing fade defaults to 45%, set by a Layers slider and stored in localStorage inside try/catch.
  - Each mark gets a white halo. Beams are 3 px, or 6 px on hover or select; undefined beams are dashed; the column I is larger.
  - State colours the whole member, with a glow. Show flags is off by default.
- **Issue navigator:**
  - The pill "N need attention · M to review" with ◂ ▸, plus keys N and Shift+N.
  - Order: attention before review; within each, by view, then top to bottom, then left to right.
  - Each step zooms to the member with context around it and selects it. A fixed member drops out of the list.
- **Page cards:** red and orange counts on the thumbnail. A Views list with + Add view (drawn on the canvas). Fields belong to the selected view.
- **Canvas:** view boxes are labelled, and the active one is highlighted.
- **Role dropdown:** built-in names, custom names, and "+ Type a new role…" (which asks once for Framing, Column plan or Don't build).
- **Pick beam:**
  - Replace pen (default) or Add pen.
  - Pen preview stays on. Clicking a line deselects it (grey, struck through) and clicking again re-selects it. Ctrl+drag deselects a box of lines. There is a "Reset deselections" link.
  - Exclude area tool and "Suggest excludes": suggestions are dashed and marked "suggested", with Accept for each box and Accept all. Accepted boxes are grey and hatched; they can be selected and deleted.
- **Set size for all undefined beams** and **Set size for all columns without a size:** both use the AISC search and the existing batch edit route, so each is one member_edits action that is logged and undoable. Shift+click and box-select are checked against the new styling.

## 5. Tests

- **API:** views (CRUD, backfill shape), pens (replace and add), exclusions (add, suggest, accept), deselections (toggle, box, reset), role names (new, edit, behaviour), set-size-for-all as one action, and a log row for every action.
- **Worker:**
  - The build reads pens, deselections and accepted exclude boxes; suggested boxes are ignored.
  - A deselection that matches no pen segment is counted as `deselections_unmatched`.
  - A synthetic page has a border line in the beam pen, and an exclude box removes it.
  - A second view with its own scale gives the right length.
  - A rebuild of view 2 keeps view 1's pieces.
  - The migrated first view builds exactly as the sheet did.
- **Web:** zoom around a point keeps that point fixed (clamping included), navigator order, the deselect toggle, and the role dropdown with a custom name.
- All suites, lint and format must pass.

## 6. Guide and screenshots

- REVIEW_GUIDE.md covers every item in the brief.
- Screenshots are 1920x1080 and taken on **dryrun-job-018** only. The screenshot script currently reads phase11-job-018's id, so I'll point it at the dryrun copy.
- The shots: page 16 (fade and marks), the navigator on a page with attention items, page 21 with suggested excludes and two views, and the role dropdown open.
- The two views on page 21 are created on the dryrun copy as "screenshot-check", with no rebuild unless you say so.
- After the shots, I delete their view-log and setup-log rows and stop the servers by PID. Ports 3100 and 5180 only.

## 7. Order of work

1. Migration and backfill (with a backup), plus copy_project.
2. API routes and tests.
3. Worker view build and tests.
4. Web zoom and colours.
5. Navigator.
6. Pick beam, exclusions, Add pen.
7. Views and roles UI.
8. Set size for all.
9. Guide.
10. Screenshots; then stop.

I'll commit after each step, with no trailers and no push.

## 8. Deviations (the build reads new inputs; none change a rule)

1. The view box replaces the sheet crop, and each view has its own scale, T.O.S., role behaviour and column-plan link.
2. Several beam pens, one `beam_lines` call per pen.
3. Accepted exclude boxes clip segments and drop text.
4. Deselected lines are removed from the pen segments (the geometric match in section 2).
5. Rebuild storage is scoped per view (`build_view_id`).
6. Auto mode writes its proposals to the first view instead of the `sheets` columns.

## Decisions needing your OK

- A new `build_views` table rather than extending `sheet_views`.
- NULL `build_view_id` means "the first view", so no member rows are rewritten (phase11-job-018 included).
- Deselections are stored as geometry and matched with 1° / 1.0 pt / 50% overlap.
- The suggestion thresholds in section 3.
- Visible-area rendering at high zoom.
