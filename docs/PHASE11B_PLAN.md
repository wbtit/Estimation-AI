# Phase 11b: auto mode, the Steel Genie-style review UI, the system-vs-final report

Replaces the PNG + JSON setup step of Phase 11 Part C (`tools/takeoff/phase11_setup.py` stays in the
repository, unused). Everything of Phase 11 A/B is kept: migration 016, `worker/src/build`, the
`build_sheet` job, the build API and the line-first BOM. `docs/PHASE11_PREREGISTRATION.md` is not
changed; where this phase does a pre-registered step another way, section 7 lists it as a deviation
and `docs/PHASE11_RESULTS.md` repeats it. Branch `phase-11b-ui` (from `phase-11-build`), local only.

## 1. Data (migration 017, additive; database backed up first, applied to `_test` first)

- `sheets`:
  - a source per setup value, `role_source`, `crop_source` and `scale_source`, each one of
    `system` | `person`;
  - `pen_class_source` and `tos_source` also allow `system`;
  - `setup_changed_at`, the time of the last setup change, which drives "Requesting Build";
  - `column_plan_sheet_id` and its source;
  - `reviewed_by` and `reviewed_at`, set by "Save page".
- `build_runs.mode`: `auto` | `person`.
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
- `tag_counters (project_id, prefix, last_number)`: one counter per project (the Decision Log item):
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
    - else the one with the most grid lines matched in registration;
    - on a tie, none.
- Every proposed value is stored with source `system`, then `build_sheet` runs in mode `auto`:
  column plan pages first, then framing pages.
- **Unconfirmed path in `build_sheet`:**
  - mode `auto` does not require a person's confirmation;
  - it still refuses, with a clear reason on the page, when there is no scale, or no pen class on a
    framing page;
  - mode `person` keeps today's rules unchanged.
- **T.O.S. in auto mode (decision 1, below):** no T.O.S. is proposed. Without one the ends have no
  elevation; the length is the plan length, which is the same number a confirmed T.O.S. gives. The
  page card shows "Top of Steel: —" until a person types it.
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

1. Migration 017: backup, then `_test`, then the real database.
2. Worker:
   - `propose.py`, `auto_build`, the unconfirmed path, snapshots, the tag counter;
   - tests, then ruff and pytest.
3. API:
   - routes, report and answer key;
   - tests, then eslint, prettier and vitest.
4. Web:
   - the new UI;
   - tests, then tsc and vitest.
5. Run auto mode on `phase11-job-018`, then **STOP**, then the start instructions.
6. After your save: the results, the commit, and the 10-line summary with the bar verdicts.

## 9. Decisions for the owner

1. T.O.S. in auto mode: not proposed; the ends have no elevation until typed; lengths are not
   affected.
2. The old label-first web screens are removed from the app; the API for them stays.
3. Total weight unit: metric tonnes (kg / 1000), labelled "t". US short tons is the alternative.
4. Project Status values: Estimating, Submitted, Won, Lost.
