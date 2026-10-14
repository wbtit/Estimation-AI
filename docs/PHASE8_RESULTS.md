# Phase 8 results: quantity-level evaluation, the counting copilot (count mode) and the measure tool

Pre-registration of Part A: `docs/PHASE8_PREREGISTRATION.md` (committed before any quantity was compared). Everything is deterministic code: no LLM, no trained model, nothing pushed, commits without Claude trailers. Parts B and C are features (built and tested), not evaluations: **no claim is made here that they save time or raise accuracy**; the action log exists so that can be measured later.

## 1. Short answer
- **Part A (read-only): at the quantity level the current count is not usable as a first draft** (one job only). 21% of the estimator's sizes are within 20%, and the unit-weighted count is 49% low. The naive count of size labels (32%, -33%) beats the linked count. Their largest size (62 pieces, repeated members) is never found. Full tables and the reading are in `docs/PHASE8_EVAL.md`.
- **Part B: count mode is built** (API, worker job, web, tests): click with a kind, snap to the nearest extracted line of any class, size autofill with its rule recorded, automatic tags in click order, a dashed suggestions layer with one-click accept or reject, undo and redo, soft delete, an action log, and totals, tables and Excel that count confirmed pieces only.
- **Part C: the two-click measure tool is built**: confirmed scale only, each click snapped to the nearest line end point or intersection within 12 pt and shown before the click is confirmed, saved measurements that attach to a piece and fill Length and Total W.
- **Checks:** lint clean; API 556 passed, worker 576 passed, web 95 passed (numbers in section 6). Screenshots from the real screen on a made-up drawing: `fixtures/private/shots/phase8/`.
- **One thing is not done on your side:** migration `013_count_mode.sql` is NOT applied to the real database (only to the test database and a scratch demo database). Run `npm run migrate` when you want it; it only adds columns and tables.

## 2. Part A in four lines
| (size per job, 16 mapped sheets, their 19 sizes) | ours total | within 20% | weight (unit weight x count) |
|---|---|---|---|
| display basis (one piece per linked line) | 233 of 463 | 21% | 49% low |
| old label basis | 260 | 26% | 45% low |
| naive: every size label counts 1 | 322 | 32% | 33% low |
| naive: each size once per sheet | 42 | 5% | 91% low |
Reading by the pre-registered bars: **not usable**. The linking takes 89 pieces away (62 unlinked labels, 27 labels that share a line). One job, kind blank on our side, so the kind-level tables say nothing. Open questions 113 to 116.

## 3. Part B: the counting copilot (count mode)
Where: migration `db/migrations/013_count_mode.sql`; API `api/src/routes/count.ts`, `api/src/review/{snap,size-fill,count-log,measure}.ts` and changes in `members.ts`, `takeoff.ts`, `tables.ts`, `flags.ts`, `shared-line.ts`, `member-ops.ts`, `excel/*`; worker job `worker/src/review/sheet_lines_job.py`; web `lib/{count,snap,measure,useCount}`, `components/{CountPanel,CountLayer}` and changes in `App.tsx`, `SymbolOverlay.tsx`.

| request | what was built |
|---|---|
| 1. Count mode: pick a kind, click the drawing; piece with source `human_click`, click point, page, timestamp | The "count" tab: a kind choice (main kinds first, then misc, then excluded) and the Count tool (key K). A click calls `POST /count/click` and stores `count_source = human_click`, `click_x`, `click_y`, `click_at`, the sheet and the kind. The piece is drawn AT the click. |
| 2. Snap to the nearest extracted line of ANY role within a configurable radius (default 24 pt), highlight it, store the line as evidence; never drop a click | A worker job (`sheet_lines`) stores every line of the sheet of any class. Hovering highlights the line the click would snap to and shows the radius. The click stores `snapped_line` (id, ends, class, version of the extraction) and the distance; with no line in range, or lines not ready yet, the piece is kept with `snapped = false`. The radius is a project setting (24 pt) and can be sent per click. |
| 3. Size autofill: the label already linked to that line, else the nearest profile label within a radius, else blank and amber; always overwritable; store the rule | `size-fill.ts`: `linked_label`, then `nearest_label` (radius 80 pt, project setting), then `none` (the piece is amber, reason "size missing: type the size"). The panel says in words which rule filled it and how far the label was. Typing a size is an edit recorded as `size_source = manual`. |
| 4. Auto-tag per kind in click order (kind abbreviation and a running number), editable | The tag is the kind's prefix and the next free number on the sheet (existing numbering rule; numbers are never reused). The prefix is the owner's abbreviation when loaded, else the provisional one (today `BE1`, `CO1`; question 96 is still the owner's). The tag box in the panel edits it; a tag already used on the sheet is refused. |
| 5. Suggestions layer: existing linked-line pieces as dashed markers; one click accepts (`suggestion_accepted`) or rejects (kept as rejected, out of totals); everything logged | Undecided pieces of the system are dashed (one piece per linked line: a label that shares a line it does not carry is not shown as a suggestion). A click on a suggestion accepts it, shift-click rejects it (buttons in the list too). A rejected suggestion is kept, listed, restorable, and never in any total in any mode. Accepting a low-confidence (red) suggestion is a person's confirmation: it counts. |
| 6. Undo and redo of count actions; delete is a soft delete | Undo (existing, per person) and a new Redo (Ctrl+Shift+Z or Ctrl+Y, buttons). A new action clears the redo. Delete is the existing soft delete (the piece is kept, `deleted`); undo of a click soft-deletes it, redo brings it back. |
| 7. Takeoff tables, totals and the Excel export include confirmed pieces only (`human_click` and `suggestion_accepted`), suggested-but-undecided shown apart | With `count_mode` on (a checkbox in the panel; off by default so nothing existing changes): the takeoff totals, the page and job tables, the sheet list count and the Excel takeoff and tables use confirmed pieces; the undecided suggestions are a separate block in the takeoff, a separate line in the tables and a separate Excel sheet "Suggested (undecided)", in no total. |
| 8. Action log table: every create, accept, reject, edit, undo with timestamps | Table `count_actions` (create, accept, reject, edit, delete, undo, redo, measure, attach_length, mode) with who, sheet, piece, the edit-action id and a JSON detail (kind, click, snap, size rule, tag). `GET /count-actions` returns it with time per page and person (gaps over five minutes are idle). |

Design decisions taken (Decision Log updated): count mode is opt-in per project; a confirmed piece always counts once; clicked pieces are never grouped with labels of a line; the evidence of a click names the extraction version of the lines so it stays meaningful if the page is re-read.

## 4. Part C: the measure tool
| request | what was built |
|---|---|
| 1. Two clicks, the page's confirmed scale; snap each click to the nearest line end point or intersection within 12 pt, shown before confirming | Measure tool (key M). The scale is the confirmed scale of a view that holds both points; a guessed scale is refused ("confirm the scale first"). The snap marker (square = end point, cross = intersection) follows the pointer BEFORE the click; after the second click the length is shown on the drawing and in the panel. The server snaps the raw clicks again and stores both. |
| 2. Attach a measured length to a piece; Length and Total W fill in | "Save measurement" stores it (`measurements`); "Attach to the selected piece" sets the piece's length (an undoable edit, `length_source = measured_manual`, the measurement id kept). The tables get Length ft, Length In (decimal feet and inches, like the workbook) and Total W = quantity x length (ft) x Unit W (lb/ft), only for pieces with a measured length; pieces of the same size and length make one row. A typed length replaces a measured one. Columns take their length from their elevations, so a plan measurement is refused for them. |
| 3. Tests of scale conversion (imperial feet-inches and metric) and snapping | `count-lib.test.ts` and `count-mode.test.ts` (API), `measure.test.ts` and `snap.test.ts` (web, the same shared snap cases as the API): ratio 96 and 48 (imperial), 100 and 50 (metric), feet-inches rounding, which view's scale applies, snap to end point, intersection and nothing. |

## 5. Screenshots (`fixtures/private/shots/phase8/`, git-ignored)
Taken by `worker/tools/phase8_shots.py` from the real review screen in a headless Firefox, on a MADE-UP framing plan in a scratch database (`estimation_ai_phase8demo_test`); no real drawing or data was used. I looked at 02, 03, 04, 05, 06, 07, 08 and 09 (some of them an earlier run of the same script) and not at 01.
- `01-suggestions-dashed.png`: count tab with count mode on; the system's pieces are dashed.
- `02-count-hover-snap.png`: the count tool: the line under the pointer is highlighted (teal) with the snap radius.
- `03-clicks-with-size-notes.png`: clicks made pieces BE1, CO1, BE2 with amber blank sizes and the note "size blank: type it"; one click landed on a suggestion symbol and accepted it instead (by design).
- `04-accept-reject.png`: one suggestion accepted, one rejected (Rejected (1)); the lists show confirmed, suggested and rejected apart.
- `05-measure-snap-preview.png`: the measure tool with the snap marker before the click.
- `06-measure-length.png` and `07-measure-attached.png`: the measured length (32'-0", 9,754 mm: the two clicks snapped to the corners of the two column squares, which are lines of the drawing) and the length on the selected piece.
- `08-tables-length-total-w.png` and `09-takeoff-confirmed-and-suggested.png`: the tables with the suggested line (in no total), and the takeoff in count mode.
- `action-log-summary.json`: the logged actions of the demo (mode, 3 creates, accept, reject, measure, attach_length) and the time per page.
What the images do not show: speed, or how real drawings behave (dense pages, rotated pages, pages with 100,000 lines). The snap data of a dense page is large (a few MB); the hover test of the web code takes under 250 ms for 50,000 lines in a unit test.

## 6. Tests and checks
New tests: API `snap` (shared cases, 16), `count-lib` (14: scale conversion, view choice, snapping, size rules, tags, time per page), `count-mode` (33: settings, the lines, click, snap of any class, size rules, tag edit and clash, accept, reject, undo, redo, soft delete, a person confirmation, confirmed-only totals, tables, Excel, the log, measure, attach, typed length replaces measured); shared-line cases for confirmed pieces; worker `sheet_lines` job (5); web `snap` (shared cases), `measure`, `count`, `count-mode` components (panel, overlay, layer) and the `useCount` hook. Lint clean (ruff, eslint, tsc, prettier). Last full run: API 556 passed (43 files, with the database), worker 576 passed, web 95 passed.

## 7. Not done, risks, what to look at first
- Not applied to the real database (migration 013). The scratch database `estimation_ai_phase8demo_test` remains (drop it with `DROP DATABASE estimation_ai_phase8demo_test;` when you like); its uploads are in /tmp.
- The count flow needs the sheet's lines (a worker job per sheet, run the first time the tool is opened: seconds on simple pages, longer on dense ones). Until they are ready a click is kept but not snapped (flagged).
- Snap is "nearest line of any class": on a dense plan it can pick a hatch line or a dimension line; the highlight shows what it picked and the radius is configurable (question 120).
- Suggestions follow the one-piece-per-line basis, so a second label on an already carried line is not offered as a suggestion; unlinked labels are listed, not offered (question 115).
- The unit tests and one screen run on made-up data; nothing says yet how an estimator uses it on real pages. The first honest test is a timed session using the action log.

## 8. Decisions for the owner
See OPEN_QUESTIONS 117 to 122.
