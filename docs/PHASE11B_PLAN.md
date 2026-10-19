# Phase 11b: auto mode, the Steel Genie-style review UI, the system-vs-final report

Replaces the PNG + JSON setup step of Phase 11 Part C (`tools/takeoff/phase11_setup.py` stays in the
repository, unused). Everything of Phase 11 A/B is kept: migration 016, `worker/src/build`, the
`build_sheet` job, the build API and the line-first BOM. `docs/PHASE11_PREREGISTRATION.md` is not
changed; where this phase does a pre-registered step another way, section 7 lists it as a deviation
and `docs/PHASE11_RESULTS.md` repeats it. Branch `phase-11b-ui` (from `phase-11-build`), local only.

## 1. Data (migration 017, additive; database backed up first, applied to `_test` first)

- `sheets` (as built; simpler than the first draft, same meaning):
  - a setup value is a **system value while its `*_confirmed_by` is NULL** and a person's value once
    set. 016 already has `*_confirmed_by` for crop, scale, T.O.S. and pen class, so no source
    columns are added; `pen_class_source` stays `suggested` | `person` and `tos_source` stays
    `read` | `typed`;
  - 017 adds `role_confirmed_by/at`, and `column_plan_sheet_id` with `column_plan_confirmed_by/at`;
  - `setup_changed_at`, the time of the last setup change, which drives "Requesting Build";
  - `reviewed_by` and `reviewed_at`, set by "Save page".
- `auto_builds`: one row per auto run (status, pages total and done, for the processing panel).
- `build_runs.mode`: `auto` | `person`, and `auto_build_id`.
- `build_snapshots`, the SYSTEM VERSION:
  - one row per page per auto run, holding `project_id`, `sheet_id`, `build_run_id`, `auto_run_id`,
    `created_at`, `setup` and `pieces`;
  - `setup` (JSONB) holds every setup value with its source;
  - `pieces` (JSONB) holds per piece the member id, kind, tag, size, raw size, page end points,
    plan end points, length mm, states and label evidence;
  - written once, inside the auto run's transaction;
  - a trigger rejects any UPDATE, and a DELETE that is not part of deleting the project, so later
    edits can never change it.
- `members.ignored`, a boolean: an ignored piece stays on the page, shown grey, and is out of the
  BOM. A deleted piece is `count_state = 'rejected'`. Either way the piece counts as "touched", so a
  rebuild never brings it back.
- `tag_counters (project_id, scope_key, prefix, last_number)`: one counter per project (the Decision
  Log item); `scope_key` is `''` for job-wide tags and the sheet id when the project numbers tags per
  sheet (the existing `tag_scope` setting):
  - the build, the new UI's "add" and the copilot all take numbers from it;
  - it is seeded from the highest existing tag per prefix in the whole project, built pieces
    included;
  - numbers are never reused.
- `projects.stage`, the Status in the create dialog: `Estimating` (default) | `Submitted` | `Won` |
  `Lost`. The existing `projects.status` keeps meaning the processing state.
- `count_actions.action` also allows `setup`, `pick_pen`, `rebuild`, `add`, `ignore`, `save` and
  `view` (the page opened). Every action has `who`, the time, the page, and a detail with counts and
  ids only.

## 2. Worker: auto mode

- New job `auto_build`. It is queued by `auto_run` after its last step, and can also be started by
  hand for an existing project. Per page it proposes:
  - **role** from the page type guess: foundation plan becomes column plan; framing plan becomes
    framing; anything else becomes skip;
  - **crop**: the box around the grid bubbles plus 36 pt, else the whole-sheet box (the Part C
    proposal code, moved into `src/build/propose.py` with its tests);
  - **pen class** from the existing suggester inside the crop;
  - **scale**: the stored effective ratio;
  - **column plan** for a framing page:
    - the only column plan page when there is one;
    - else the one with the most grid labels (family and label) in common with the page (as
      built: a label count, simpler than running registration against each plan);
    - on a tie, none.
- Every proposed value is stored with source `system`, then `build_sheet` runs in mode `auto`:
  column plan pages first, then framing pages.
- **Unconfirmed path in `build_sheet`:**
  - mode `auto` does not require a person's confirmation;
  - it still refuses, with a clear reason on the page, when there is no scale, or no pen class on a
    framing page;
  - mode `person` keeps today's rules unchanged.
- **T.O.S. in auto mode (owner decision 1):** proposed (source system: `tos_source = 'read'`,
  `tos_confirmed_by` NULL) when a T.O.S. note is parsed inside the crop: text lines inside the crop,
  read with the existing elevation parser (`find_elevations`), reference `top_of_steel`, not a signed
  offset, with a value. One distinct value: it is proposed. Several: the most frequent; a tie leaves
  it empty. None: empty, the page card shows "Top of Steel: —", the ends have no elevation, and the
  length is still the plan length (the same number a confirmed T.O.S. gives).
- After all pages, one snapshot row per page is written in the same transaction as the run's end.
  A second auto run on a project is refused once any person action exists.
- `build_sheet` and `assign_tags` take tag numbers from `tag_counters`.

## 3. API (all with tests)

- `POST /projects/:id/auto-build` and `GET …/auto-build-status`, which gives per-page progress for
  the processing panel.
- `GET /projects/:id/pages`: one call that gives the page cards:
  - the badge: Built / Requesting Build / Not confirmed / Reviewed / Not built + reason;
  - the setup values with their sources, the T.O.S., scale and status;
  - counts.
- Setup routes:
  - the existing `build-setup/*` routes get `source: person`, set `setup_changed_at` and log a
    `setup` action;
  - new `build-setup/pick-pen` takes `{x, y, who}` and picks the class of the nearest extracted line
    (from `sheet_lines`, 12 pt reach), with source `person`;
  - new `build-setup/column-plan`.
- `POST …/build` (▶) builds with the page's current values, in mode `person`:
  - values still `system` are kept as they are, and the badge stays "Not confirmed";
  - edited pieces are never overwritten (the existing rule).
- `POST …/save-page`:
  - sets `reviewed_by` and `reviewed_at`;
  - turns every setup value still `system` into `person`, as confirmed by this person;
  - logs `save`;
  - any later change takes the badge off "Reviewed".
- `GET …/sheets/:id/line-first`: the page's pieces, nodes, grid lines and beam lines for the
  overlays, with the evidence for the tooltips.
- Member routes for built pieces, each logged in `member_edits` and `count_actions`:
  - edit size, member type, studs, camber, ignore;
  - delete;
  - add a drawn beam or column, which is snapped (`lib/snap`) and tagged from the counter;
  - drag an end, which recomputes the length;
  - undo, which restores the previous value and is itself logged.
  - Multi-select edits are one action.
- `GET /catalog/sections?q=`: AISC search, read-only, used by the Section Size box.
- The BOM gets `category` and `section` filters. "Ignored" and "deleted" pieces are out of it.
- **Report:** `GET /projects/:id/report` and `.xlsx`, described in section 5.
- `GET /projects/:id/answer-key.json`: the saved final as an answer key in the format the
  evaluation tools read, `{cols, rows}` with keys `ref, qty, shape, size, name, len_ft, len_in,
  unit_w, total_w, grade`:
  - one row per BOM row;
  - `ref` is the page's sheet number, in the `detail/sheet` form `phase8_eval_lib` maps;
  - `name` is the category.
  - The file is downloaded only; the server stores nothing.

## 4. Web: the new UI

The old screens (`App.tsx` and `components/*`, label-first copilot) are removed from the web app.
The reusable `lib/*` modules (`usePdf`, `geometry`, `snap`, `measure`, `api`) and their tests stay.
Old screens can be brought back from git history (decision 2, below). Hash routes, no new
dependency. Short words on screen; evidence only in hover tooltips.

- **Projects:**
  - search;
  - a card grid: thumbnail of page 1, name, date, status badge, and an "Add new project" card.
  - The create dialog has File, Name (prefilled from the file name), Project Number and Status.
  - The processing panel shows the steps (Upload, Scan, Read text, Auto build) and a progress bar,
    and opens the workspace when done.
- **Workspace top bar:** Home, project name, tabs Plans | BOM | Report, export icon.
- **Left panel:** tabs Pages / Members.
  - A page card shows "Page N | Type", the sheet number, ▶, a ⋮ menu (role, column plan), the badge,
    Top of Steel (typed), a Scale dropdown with the ratio, and Status.
  - Members is a list with a filter, and click to select.
- **Canvas:**
  - PDF zoom and pan.
  - A vertical toolbar:
    - Layers: Plan, Grids, Beams, Undefined Beams, Columns, labels on/off, a length filter;
    - Crop;
    - Pick beam: one click, then every line of that class is highlighted;
    - Draw beam, Draw column, Measure, Fit;
    - Undo, with the count of edits since the last save.
  - Overlays:
    - beams are purple along the line;
    - columns are a blue I symbol with the tag;
    - the size read is printed small under the drawing's label;
    - an amber triangle means needs review, red means attention;
    - "isolate undefined" is available.
- **Right panel, Properties:**
  - **Summary:** Project / Sheet toggle; Column, Beam, Brace counts; total weight in tons
    (decision 3, below).
  - **Member:**
    - Piecemark, Member Type, Section Size (search), Length (read-only), Studs, Camber;
    - Left and Right end elevation, locked to the T.O.S.;
    - Ignore;
    - several selected pieces show "Mixed".
  - **Crop:** the box values, editable on the canvas.
- Any setup change makes the page "Requesting Build"; ▶ rebuilds. "Save page" sets the page to
  Reviewed.
- **BOM tab:** Main, Category, Piecemark, Qty, Section Type, Section, Length (ft-in), Grade, Weight;
  Category and Section filters; Export to Excel.
- **Report tab:** the tables of section 5, and Export to Excel.
- **Who:** the existing name gate.
- **Tests:** vitest with Testing Library for:
  - the project cards and create dialog;
  - the page card badges;
  - pick-pen hit testing;
  - "Mixed" properties;
  - BOM filters;
  - undo count;
  - the report view.
  - `tsc` is clean.

## 5. The system-vs-final report (rules fixed here, before any review)

**Matching** of snapshot pieces (system) to the current pieces that are not deleted (final), per
page:
1. Same member id. Rebuilds keep ids when the geometry is the same.
2. Otherwise, on the same page and of the same kind: directions within 5°, offset within 6 pt, and
   overlap of at least 50% of the shorter piece. The closest pair wins first.

**Classes:**
- **kept unchanged:** matched; same size; length within 1 inch (25.4 mm).
- **size changed** and **length changed** (more than 1 inch): one piece can be in both.
- **deleted by person:** a system piece whose final row is `rejected`.
- **removed by rebuild:** a system piece with no final match and no delete action.
- **added by person:** drawn by a person.
- **added by rebuild:** final pieces from a person-mode build with no system match.
- **ignored:** listed apart.

**Other measures:**
- **Setup changed per page:** crop, pen, scale, role, column plan, T.O.S. (system value vs final
  value).
- **Minutes per page:**
  - the project log is sorted by time;
  - each gap to the next action counts for the page of the later action when both actions are on the
    same page;
  - a gap is capped at 5 minutes (idle);
  - the "view" action marks entering a page.
- **Per size:** count and total length, system vs final, and per page and in total.
- The Excel export gets one sheet per table.

## 6. job-018 run (replaces Part C's JSON step)

> **2026-10-19: the review project is now `phase11r-job-018`.** `phase11-job-018` is retired from
> the measurement because it holds owner test actions made after its auto run: page views, pen
> picks, crop changes, rebuilds, added, deleted and ignored pieces, and member edits, by two people.
> It is archived and nothing in it was changed. `phase11r-job-018` is a fresh copy of job-018
> (previewed, then copied; the source is unchanged by its content hash) with auto mode run once.
> Its snapshot matches the frozen one on every page:
> - pages built and skipped (13 and 10), the setup of every page, and the 880 pieces;
> - piece counts per page, per kind, per size and per state;
> - each piece's page geometry, end points, size and length.
>
> Only 72 tags differ, all permuted among the same numbers on the same page. Tags are numbered in
> reading order, and pieces that share a top-left point are ordered by `member_id`, which hashes
> the page id, so two copies break those ties differently. Everything below that names
> `phase11-job-018` now means `phase11r-job-018`.

1. Run `auto_build` on the existing copy `phase11-job-018`. The snapshot is written. A count-only
   summary is reported.
2. **STOP.** I tell you how to start the app: API and web. Port 3000 is not touched without asking
   you first; if a stale process holds it, I name its PID and ask before stopping it.
3. After you say the review is saved, `docs/PHASE11_RESULTS.md` gives:
   - (a) the pre-registered bars on the estimator's corrected setup and build. The final setup
     values are applied to a fresh copy of job-018 (preview first) and built there in mode
     `person`, with no member edits. This is the build engine's number with a person's setup.
   - (b) the same bars on the system version (the snapshot) alone.
   - (c) the system-vs-final report.
   - (d) the estimator's saved final against the workbook: the same measures, beside the rest.
   - Grid detection per page and the failure counts, as pre-registered, on (a) and (b).
   - The crossing-rule deviation: the "direction" rule run on another fresh copy with the same final
     setup, beside (a), labelled as a deviation found from setup counts.
   - At the top: job-018 is not held-out, so the numbers are a best case, not an accuracy.

## 7. Deviations from the pre-registration (to be repeated in the results)

- §3 and §4: the setup is made in the UI by the estimator, not from `phase11_setup.json`. The values
  are stored with who and when, the same as the API.
- §3: the proposals use the same rules (crop, pen, scale), now made by `auto_build` and stored with
  source `system`.
- §4: (a) is built on a fresh copy with the estimator's final setup. (b), (c) and (d) are added
  measures.
- The crossing-rule run: as agreed before this plan.

## 8. Order of work and stop points

1. Migration 017: backup, then `_test`, then the real database. Done 2026-10-16. 017 left out two
   actions of 015 (`typical`, `prefix_map`) when it widened `count_actions.action`; migration 018
   puts the full list back (backup, `_test`, real database). No row was affected.
2. Worker:
   - `propose.py`, `auto_build`, the unconfirmed path, snapshots, the tag counter;
   - tests, then ruff and pytest.
3. API:
   - routes, report and answer key;
   - tests, then eslint, prettier and vitest.
4. Web:
   - the new UI;
   - tests, then tsc and vitest.
5. Run auto mode on `phase11-job-018`. Start the app on non-default ports (or ask first for 3000),
   take headless screenshots into `fixtures/private/shots/phase11b/` (projects screen, the workspace
   of two framing pages with overlays, one column plan page, the BOM tab), then **STOP** with the
   paths and the start instructions; the owner checks them before the estimator reviews.
6. After your save: the results, the commit, and the 10-line summary with the bar verdicts.

## 9. Owner decisions (2026-10-16, plan approved)

1. T.O.S.: proposed in auto mode when a T.O.S. note is parsed inside the crop (source system), else
   empty (rule in section 2).
2. The old label-first web screens are removed; their API stays.
3. Units on screen: the Summary total in US short tons (2000 lb), labelled "tons"; BOM row weights in
   lb (also in the Excel export); lengths in ft-in to 1/16".
4. Project Status values: Estimating, Submitted, Won, Lost.

## 10. Owner additions (2026-10-16)

- **A. Imperial input and display everywhere on screen.** T.O.S. and end elevations are typed and
  shown in ft-in. Accepted forms include `13'-3 1/2"`, `13'-3.5"`, `13' 3"`, `13'`, `13.29'`, `3 1/2"`,
  and a leading minus sign; a bare number without a foot or inch mark is refused (unclear unit).
  Stored in mm. Lengths shown in ft-in to 1/16". `web/src/lib/ftin.ts` with tests for the parser and
  the formatter.
- **B. Screenshots before the review** (section 8 step 5).
- **C. `docs/REVIEW_GUIDE.md`**: one page in simple words for the estimator: what to check on each
  page (role, crop, beam pen, scale, T.O.S.) and how to fix each (Crop tool, Pick beam, scale
  dropdown, typing T.O.S., ▶ rebuild); how to fix members (click, Section Size, delete, Ignore, draw
  a missing beam or column, multi-select); "Save page"; check against the drawing, do not just
  accept what is shown.

## 11. System version breakdown (job-018 copy, frozen snapshot; counts only, no fix)
Read from `build_snapshots` of the one auto run (880 pieces), the run's `beam_lines`, `support_nodes`,
`sheet_lines` and `text_items`. Page numbers are as shown on the cards (page index + 1). Pages 7, 8,
9 and 14 are outside the 16 pre-registered pages. The rules are frozen; nothing below was changed.

**208'-0" (3 pieces, pages 5, 6 and 7, one each).** Each is one vertical beam line of the page's beam
pen class made of 39 drawn segments (about 15 pt each) with 38 gaps of 9 pt: a dashed line drawn
as separate solid strokes. The 24 pt gap bridge joins the dashes into one 936 pt run, clipped by
the crop at its lower end. No support node falls on it, so it is never split: an unsplit run, size
undefined and no support ("attention"). Not a border line and not a column stroke.

**1'-4" (74 pieces, the most common BOM length; 16" real on every page, drawn at 11.8, 24 or 36 pt
depending on the scale):**

| Page | Pieces | What they are |
|---|---|---|
| 16 | 26 | stubs cut out of longer beam lines (2-4% of the line) between two close beam-beam crossings (all 52 ends are `beam_intersection` nodes); support both; 15 are "needs review" (in the total), 11 "attention" (no size) |
| 18 | 24 + 4 | 24 are column strokes: pairs of parallel 16" lines 8" apart with a web line between them (a column drawn to scale, not taken by the column glyph rule); 4 single strokes; no support |
| 21 | 12 + 4 | 12 column strokes (same pairs with a web); 3 single strokes; 1 stub of a longer line (one end supported) |
| 11 | 4 | single short vertical strokes, no pair, no support |

So: column glyph strokes 36, short splits between close crossings 26, other isolated strokes 12.
None is a border line.

**Beams along the page frame or the title-block border.** Page 21: two. One runs along the top
page frame (horizontal, 1559 pt inside the crop, on a 2880 pt frame line, 57'-9") and one along the
title-block border (vertical, 2002 pt, on a 2088 pt line, 74'-2"). Both are of the page's pen class,
are "attention" (no size, no support), and are there because the proposed crop reaches the frame:
the crop's top edge is 7 pt from the page top and its right edge is on the border line. Page 5: no
beam lies on the frame or on a line longer than 400 pt other than the 208'-0" dashed run above
(192 pt inside the crop's right edge). The page 5 screenshot shows which line was meant.

**Attention by reason (757):**

| Kind | No size only | Unsupported only | Both |
|---|---|---|---|
| Beams | 145 | 1 | 386 |
| Column | 225 | 0 | 0 |

Needs review (99, all beams): size from a nearby label 57, one end not supported 12, both 30.

**Column schedule in the set: no.** No page is guessed as a schedule (guesses: 7 foundation plans,
6 framing plans, 6 details, 4 other); no text item matches "column schedule" (2 items on 1 page
have the word "schedule" alone); 0 legend rows. All 14,760 text items of the set were read. The 225
columns have no size because neither the page nor a schedule gives one.

**Page 1 (sheet S0-01): is there a table of column marks and sizes? No.** Read-only counts on the
copy's text items (1490 on the page, all read):
- Column-mark-like items (`C`/`CO` + number, whole item or a token inside one): 0. W or HSS size
  strings: 0 (one item matches a size shape and is not in a table row). Marks with a size on the
  same row: 0, so no rows.
- The words "column" (4 items) and "schedule" (2 items) do appear, but the 13 to 76 items under
  them hold no column marks and almost no digits (2 at most): a legend or notes block, not a
  schedule of marks and sizes.
- **The marks match nothing.** No column plan page (5, 6, 9, 11, 14, 15, 18) has a single
  column-mark text item either. The `CO1`... `CO27` seen on page 5 are our own piecemarks from the
  tag counter (prefix `CO`, 27 on page 5), not drawing text. So there is nothing to match.
- **Why "Detail":** the sheet title matched no keyword rule. Among the view titles, one matched the
  `SECTION` rule (type detail) and one matched `NOTES` (type general notes). `detail` comes before
  `general_notes` in the rule preference, so it wins (stored reason: "view titles match section;
  also general_notes").
