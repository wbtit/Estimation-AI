# Phase 7 audit: what to keep for a line-first, Steel Genie-style build

Read-only audit on branch `phase-7-audit` (from `pilot-prep`). No source code, database row or migration was changed. The only outputs are this file and overlay pictures under the git-ignored `fixtures/private/shots/phase7_audit/`.

Naming note: the repository already has a "Phase 7" (`docs/PHASE7_RESULTS.md`, branch `phase-7`, the structural grammar prototype). This audit is a different piece of work; it is called "Phase 7 audit" because the request named it so.

## 0. Pre-registration of Part C (written and committed before any measurement)

Nothing in this section is changed after the measurement. Deviations, if any, are reported in Part C as deviations.

### Files used
Only PDFs under `fixtures/private/`: `job-001.pdf` and the estimators' marked-up copies in `fixtures/private/takeoffs/` (one per matched job; a marked-up copy is the drawing set plus the estimators' annotations). The job of each copy comes from the existing private `inventory.json` (Phase 5t text-fingerprint match). Jobs whose drawing is not under `fixtures/private/` are listed as "not checked"; no other folder is searched. No file, project, client or layer name is printed or written; only job ids, counts and normalised patterns.

### C1. PDF layers (every job with a file under fixtures/private)
- Per PDF: `doc.get_ocgs()` (optional content groups) and `doc.layer_ui_configs()` (the layer list shown to a user); `has_layers` = at least one OCG.
- Layer names are upper-cased and reported only as patterns: contains `BEAM`; `COL`; `GRID`; starts with `S-`; contains `FRAM`; `BRAC`; `STL` or `STEEL`; `DIM`; `TEXT` or `ANNO`; `HATCH`; contains a Bluebeam or markup word (`MARKUP`, `BLUEBEAM`, `ANNOT`).
- beam-like = `BEAM` or `FRAM`; column-like = `COL`; grid-like = `GRID`.
- Also counted, per document: the share of stroked drawing paths on sampled pages that carry a layer (`get_drawings()` field `layer` not empty), on at most the 3 pages with the most estimator symbols (job-001 has no symbols: its first 3 pages).
- Caveat stated in advance: the marked-up copies passed through Bluebeam; their layer list may differ from the original drawing file (layers added or removed). This is not checked against the originals (they are not under fixtures/private).

### C2. Line weight under the estimators' symbols (3 pages, 3 jobs)
- **Which symbols stand for beams.** The meaning of the estimators' symbol groups is not known (OPEN_QUESTIONS 98 and 124; no prefix file exists). Assumption, stated in advance: the 8-vertex polygon annotations (the "circle" group, 52% of their symbols) are the beam-like symbols; the 3-vertex ones (triangles) are left out. This is an assumption, not a fact; results are read with it.
- **Page selection (fixed before looking).** Eligible: pages of the Phase 6b set (estimator symbols present) whose stored page type guess is `framing_plan` and that carry at least 20 eight-vertex symbols. Per job, the eligible page with the most eight-vertex symbols. Three jobs are drawn from the eligible jobs, sorted by id, with `random.Random(7701).sample(jobs, 3)`.
- **Segments.** From `page.get_drawings()` on the marked-up copy (the drawing content; annotations are not part of it): every `l` item of a stroked path, and every thin filled rectangle (long side at least 8 pt, long/thin at least 8, thin side at most 6 pt; the production rule in `worker/src/linking/lines.py`) as a segment of width = thin side. All coordinates through `page.rotation_matrix`, like the symbols. Recorded per segment: width, stroke colour (RGB rounded to 0.01), dash pattern (as given by the PDF), layer name (pattern only), length.
- **Clusters.** Width cluster = width rounded to 0.01 pt. Full cluster = (width cluster, colour, dash pattern).
- **Near a symbol.** A segment is beam-near when its point-to-segment distance to an eight-vertex symbol centre is at most 12 pt (24 pt as sensitivity).
- **Baselines.** (a) all segments of the page; (b) all segments inside the box around the page's eight-vertex symbols expanded by 72 pt; (c) a chance control: the same symbols displaced 60 to 200 pt in a random direction (20 replicates, seed 7702), segments near those points.
- **Top cluster.** T1 = the heaviest-width SOLID full cluster with at least 20 segments on the page (the "heavier pen" idea). T2 = the full cluster that holds the largest share of beam-near length (chosen from the near data, so descriptive only).
- **Verdict per page (T1 only), fixed in advance.** "Distinct" when T1 holds at least 50% of the beam-near length AND its near share is at least 2 times its share of all segment length (baseline a) AND at least 1.5 times its share in the displaced control (c). Otherwise "not distinct". The same numbers are reported by segment count.
- **Fragmentation.** Anchor per symbol: the nearest T1 segment within 12 pt (if none: the symbol has no T1 anchor, counted). From the anchor, collinear T1 segments (direction within 1 degree, perpendicular offset at most 1 pt) are projected on the anchor's axis, overlapping parts merged, and chained outward while the gap to the next piece is at most G = 24 pt (6 and 72 pt as sensitivity). Reported: source segments per chain (median, 90th percentile), gaps per chain, gap size (median, 90th percentile of gaps above 0.5 pt), chain length. The same is repeated with the anchor taken from any cluster (nearest segment of any cluster within 12 pt, chained within its own full cluster), descriptive.
- **Overlays.** One PNG per page in `fixtures/private/shots/phase7_audit/`: the page rendered faint, segments drawn in a colour per width cluster (the 8 most frequent width clusters by length; others grey), eight-vertex symbols as rings, a legend with widths only. I do not view the pictures (no approval to view page images in this task); they are for the owner.

### What would change the plan (read in advance)
- If T1 is "distinct" on all 3 pages: a pen-weight filter is a usable first step for beam lines on these drawings.
- If "not distinct" on 2 or more pages: pen weight alone does not isolate beam lines; a person's crop and class choice, or the labels, must do the selection (as Phases 5 to 7 found).
- If layers with beam, column or grid names exist on most jobs: layers are a cheaper signal than pen weight and should be read first.

---

## 1. Short answer
- **Most of the backend can stay.** Upload, scan, job queue, text reading, scale, catalog, edits log, validator, kinds, grades, tags, measure and snap are KEEP or small ADAPT. The label-first parts (frozen linking rule, link job, shared-line rule, label takeoff, automatic label pipeline) are RETIRE: they keep running behind the existing switch. The whole web UI is REPLACE.
- **The schema already has some of the empty places the new flow needs.** `sheets.crop_region`, `sheets.tos_notes`, `sheets.build_status`, `sheets.built_at`, `projects.grids`, `members.supported_by` and the start/end grid columns exist since migration 001, but no code writes them. Grids with geometry, support nodes, beam lines, piece indexes, build runs and confirmed T.O.S. are missing (section 3).
- **Line-first has been measured twice already, without a person's crop or class choice.** In Phase 6b, line first scored precision 0.10 and recall 0.29. In Phase 7, a structural grammar (grids, columns, chaining, split at supports) scored precision 0.04 and recall 0.19 on held-out jobs, with no signal over chance. The new flow differs from both: a person confirms crop, scale and line class, and the column plan comes first. Those runs show that structure alone finds far too many members, so the person's inputs will carry most of the weight.
- **Pen weight alone does not single out beam lines (C2, 3 pages): "not distinct" on 3 of 3 by the registered rule.** The heaviest black pen holds 1.4 to 2.4 times its page share of the length under the estimators' circle symbols, but only 10% to 46% of it. On two of the three pages, most of that length is thin or medium grey lines.
- **Layers are not a reliable signal (C1, 17 jobs).** 10 of 17 PDFs have a layer list, but only 4 have a beam-like layer name and 2 a column-like one. Paths tagged with layer names exist on 5 of 17 (beam-like tags on 4). Some tags are not in the PDF's own layer list.

## 2. Part A: module inventory

Verdicts are for the new approach: KEEP (use as is), ADAPT (keep the code, change its role or add to it), RETIRE (keep running behind the switch until the new method beats it, then remove), REPLACE (rewrite).

### 2.1 Upload, pipeline, queue
| path | what it does | verdict | reason |
|---|---|---|---|
| `api/src/routes/projects.ts` | projects, streamed PDF upload (500 MB, magic bytes, sha256), starts the scan | KEEP | the projects grid and upload are the same |
| `worker/src/queue.py`, `worker/src/main.py`, `jobs` table | Postgres job queue (`FOR UPDATE SKIP LOCKED`), worker entry point, handler table | KEEP | a `build_sheet` job is one more handler. Note: Redis is in docker-compose but no code uses it; there is no BullMQ (Decision Log, Phase 0) |
| `worker/src/pdf_scan/*` (`job`, `analyze`, `textscan`, `textlines`) | page scan: vector or raster, sizes, rotation, thumbnails, text-layer facts | KEEP | the page cards need exactly this |
| `worker/src/pdf_scan/sheet_id.py`, `reread.py`, `parsers/sheet.py` | sheet number and title from the title block | KEEP | page cards show the sheet number |
| `worker/src/pdf_scan/classify.py`, `pagetype.py` | page kind and page type guess (framing, foundation, ...) | ADAPT | also used to order the build: foundation/column plan first |
| `worker/src/review/auto_run.py`, `api/src/routes/pipeline.ts` | runs the whole label-first pipeline automatically after the scan; "these guesses are right" | ADAPT | the new flow builds per page when a person presses Build; auto-run should stop after scan, text and line extraction |
| `worker/src/review/sheet_state.py`, `api/src/review/overrides.ts`, `takeoff-sheets.ts` | include or exclude a sheet, person overrides of guesses | ADAPT | becomes the page card state (in or out, built or not) |
| `worker/src/review/copy_project.py`, `worker/tools/copy_project.py` | copies a project as a clean pilot copy | KEEP | a tool, independent of the method |

### 2.2 Vector text reading
| path | what it does | verdict | reason |
|---|---|---|---|
| `worker/src/text_layer/*` (items, quality, annotate, catalog) | words and lines from the PDF text layer, in displayed coordinates | KEEP | the labels (size, studs, camber) come from here |
| `worker/src/text_layer/parsers/*` (profile, dimension, elevation, joist, marks, numbers, sheet) | pure parsers that keep the raw string | KEEP | sizes, `<studs>`, `C=` camber, T.O.S. notes; the elevation parser already reads T.O.S. forms |
| `worker/src/text_reader/*` | stroked-lettering reader with a person-confirmed glyph library (optional OCR cross-check) | KEEP | needed for drawings with outlined text (job-001, job-006); not on the critical path |
| `worker/src/review/legend.py`, `legend_rows` | mark followed by a profile (legend and schedule rows) | KEEP | beams labelled by mark get their size here |
| `worker/src/review/kinds.py` | kind from keywords on the label's own line or the legend | ADAPT | in line-first, the kind comes from the build (beam, column, brace); keywords become a check |

### 2.3 Scale
| path | what it does | verdict | reason |
|---|---|---|---|
| `worker/src/pdf_scan/scale.py`, `api/src/scale/index.ts` | scale grammar (Python and TypeScript, shared test vectors) | KEEP | the page card's scale dropdown |
| `sheet_views` (box, scale_ratio, scale_confirmed), `api/src/routes/views.ts` | a box on a page with its own confirmed scale | ADAPT | the crop of the new flow is a box with a scale. Choose one: the crop is a view, or `sheets.crop_region` (section 3) |
| `api/src/review/geometry.ts`, `measure.ts`, `web/src/lib/measure.ts` | page points to mm with the confirmed scale; two-click measure | KEEP | length = support-to-support distance x scale uses the same conversion |

### 2.4 Catalog, weights, grades, BOM, Excel
| path | what it does | verdict | reason |
|---|---|---|---|
| `api/src/catalog/*`, `scripts/import-catalog.ts`, `catalog_shapes` | AISC v16.0 import (lb/ft, both units stored), spelling-tolerant lookup | KEEP | Section Type and Weight come from it |
| `api/src/review/grades.ts`, `project_grade_rules` | grade by shape family, set by a person | KEEP | the Grade column |
| `api/src/review/profile.ts`, `joist.ts` | profile text a person types, joist designations | KEEP | joists stay "not counted" |
| `api/src/bom/index.ts` | BOM rows: length from resolved end points, weight = length x kg/m x quantity | ADAPT | the right model for line-first (length from end points); output columns change to the Steel Genie BOM |
| `api/src/excel/index.ts` | BOM and Summary sheets | ADAPT | becomes the Steel Genie BOM export: Main, Category, Piecemark, Qty, Section Type, Section, Length, Grade, Weight |
| `api/src/review/tables.ts`, `api/src/excel/tables.ts`, `routes/tables.ts` | Stage 1 tables in the estimator's columns (kind, size, qty, length, unit W, total W) | ADAPT | the nearest existing thing to the new BOM tab; the grouping rule changes |
| `api/src/review/takeoff.ts`, `api/src/excel/takeoff.ts`, `routes/takeoff.ts` | label-first takeoff grouped by level, mark and profile | RETIRE | built around labels and shared lines; keep behind the switch for comparison |
| `rate_table` | empty pricing table | KEEP | unchanged; pricing is still not built |

### 2.5 Members, corrections, validation
| path | what it does | verdict | reason |
|---|---|---|---|
| `members` table, `api/src/members/rows.ts`, `api/src/contract/*` | member rows and the versioned contract (v1, Zod, JSON schema) | ADAPT | add the piece fields (section 3); the contract already has start/end with grid and elevation |
| `member_edits`, `api/src/review/actions.ts`, `member-ops.ts`, `routes/member-actions.ts` | append-only human changes with undo, effective value = latest edit | KEEP | the Properties panel edits go here; a rebuild must not overwrite edited pieces (already the rule for the link job) |
| `api/src/review/corrections.ts` | all human corrections as JSON lines | KEEP | the measurement log for the new method |
| `api/src/validator/index.ts` | rules: catalog, grade, elevations, length, unsupported member, duplicate | KEEP | the unsupported check and both end elevations are exactly what line-first needs |
| `api/src/review/members.ts`, `routes/members.ts` | effective members with colours for the review screen | ADAPT | keep the effective-value logic; drop the label-first parts (link candidates, shared lines) |
| `api/src/review/status.ts`, `flags.ts` | colour rules, draft flags | ADAPT | colour must describe the build (supported, undefined size, unsupported), not link confidence |

### 2.6 Label-to-line association (label-first)
| path | what it does | verdict | reason |
|---|---|---|---|
| `worker/src/linking/rules.py`, `candidates.py`, `labels.py` | the frozen Phase 4e rule: label to the nearest structural line | RETIRE | the method being replaced; keep behind the switch |
| `worker/src/review/link_job.py` | the `link_view` job: one member per profile label | RETIRE | same |
| `api/src/review/shared-line.ts`, `web/src/lib/pieces.ts` | one piece per linked line, grouping of labels on a line | RETIRE | a label-first count rule |
| `worker/src/linking/lines.py` | segments of a page with width, colour and dash class; collinear merge; dash chaining | ADAPT | the segment reader and merge step of line-first (C2 shows gaps of 5 to 18 pt, so chaining must bridge more than its 1 pt merge) |
| `worker/src/linking/structural.py`, `worker/src/review/classes_job.py` | suggests the stroke class that holds the members; a person confirms | ADAPT | C2 says a pen-weight guess alone is not enough, so the person's class choice stays a page-card step |
| `api/src/review/size-fill.ts` | size of a clicked piece from the linked or nearest label | ADAPT | the start of "attach labels to the beam they belong to" |

### 2.7 Lines, snap, counting copilot (Phases 8 to 10, pilot)
| path | what it does | verdict | reason |
|---|---|---|---|
| `worker/src/review/sheet_lines_job.py`, `sheet_lines` | every line of a sheet, any class (snap targets) | KEEP | the build reads its input here |
| `worker/src/review/line_roles.py` | hatch and dimension line detection (ported from the Phase 7 grammar) | KEEP | "consume" hatch and dimensions before chaining beams |
| `api/src/review/snap.ts`, `web/src/lib/snap.ts` | snap a click to ranked lines, Tab to cycle | KEEP | the canvas toolbar (add or fix a beam by hand) needs it |
| `api/src/routes/count.ts`, `review/count-log.ts`, `count_actions` | the counting copilot: click to count, accept or reject suggestions, typical x N, action log | ADAPT | the action log and the typical rule carry over; the click-to-count screen is replaced by Build plus correction tools |
| `api/src/review/pilot-report.ts` | time per page and person from the action log | ADAPT | the right way to compare the new flow with the estimators' time |
| `api/src/review/prefix-kinds.ts`, `tag-scope.ts`, `project_prefix_kinds` | mark prefix to kind; tag numbering per job or sheet | KEEP | Piecemark numbering (B_1, B_2 ...) and the kind of a prefix |
| `api/src/review/kinds.ts`, `member_kinds` | 36 kinds with scope (main, misc, excluded) and symbol group | KEEP | the Category field: kinds are rows, not code, so new kinds need no migration |

### 2.8 Phase 7 structural grammar (research code)
| path | what it does | verdict | reason |
|---|---|---|---|
| `worker/tools/takeoff/phase7_parse.py` | every path with width, dash, colours, Form XObject transforms | ADAPT | the most complete vector reader in the repo; port to `worker/src` with its tests |
| `worker/tools/takeoff/phase7_grammar.py` | grids from bubbles, column glyphs, X/V brace signs, collinear chaining, split at supports, unsupported spans flagged | ADAPT | already a line-first prototype (supports, spans, pieces). It needs the person's crop and class, the column plan first, and labels attached; port behind tests, do not copy as is |
| `worker/tools/takeoff/phase*_*.py`, `worker/tools/study/*` | studies and scoring against the estimators' symbols | KEEP | research and evaluation harnesses, not production |

### 2.9 Web UI
| path | what it does | verdict | reason |
|---|---|---|---|
| `web/src/App.tsx` (1,544 lines) and `web/src/components/*` (24 components plus their tests) | review screen: page list, viewer, symbol overlay, panels (count, members, takeoff, tables, report, prefixes) | REPLACE | the new workspace has a different layout (projects grid; Plans and BOM tabs; page cards; canvas with toolbar; Properties panel) |
| `web/src/lib/usePdf.ts`, `geometry.ts`, `snap.ts`, `measure.ts`, `api.ts` | pdf.js loading, displayed-point geometry, snap, measure, fetch helpers | ADAPT | pure helpers with tests that the new canvas can reuse |
| `web/src/lib/count.ts`, `useCount.ts`, `useMembers.ts`, `symbols.ts`, `labels.ts`, `pick.ts`, `notes.ts`, `status.ts`, `types.ts` | screen state for count mode and label-first symbols | REPLACE | tied to the current screen |

### 2.10 Tests and test database
| path | what it does | verdict | reason |
|---|---|---|---|
| `api/src/__tests__/*` (vitest), `worker/tests/*` (pytest), web tests (vitest, jsdom) | API 599, worker 632, web 127 tests at the end of Phase 10 (as reported then; not re-run in this audit) | KEEP | the web tests go with the screen they test |
| `api/src/db/test-database.ts`, `scripts/ensure-test-db.ts`, worker guard | tests refuse a non-`_test` database; separate test database | KEEP | unchanged |
| `fixtures/synthetic/*` | made-up catalog, members, parser and snap cases | KEEP | add synthetic PDFs with grids, columns and beams for the build module |

### 2.11 Database tables (migrations 001 to 015)
| table | verdict | note |
|---|---|---|
| `projects` | KEEP | `grids`, `levels` JSON exist but are never filled; `count_mode`, `tag_scope`, radii from 013/014 |
| `sheets` | ADAPT | `crop_region`, `tos_notes`, `build_status`, `built_at` exist (001) and are unused: the new page card can use them |
| `members` | ADAPT | `type` is a fixed list (beam, column, brace, joist, other) while `kind` is a reference to `member_kinds`: Category must come from `kind`. Start/end grid, elevation, `supported_by`, `camber_raw`, `studs`, `quantity` exist |
| `member_edits`, `sheet_edits`, `count_actions`, `measurements` | KEEP | logs and measurements |
| `sheet_views` | ADAPT | box plus confirmed scale: the crop |
| `sheet_lines` | KEEP | raw lines per sheet (JSON) |
| `text_items`, `glyph_library`, `legend_rows`, `project_files`, `jobs` | KEEP | |
| `catalog_shapes`, `project_grade_rules`, `member_kinds`, `project_prefix_kinds`, `rate_table` | KEEP | |

## 3. What the line-first model needs that does not exist yet
1. **Grid lines with geometry.** Per sheet: axis or family, label as written, the line's two end points in page points, the bubble box, source (found or drawn by a person), confirmed by and when. `projects.grids` (label and position in mm) exists, but only the synthetic seed writes it, and it has no page geometry.
2. **Sheet registration.** A transform from each page's points to one project plan frame (from two or more matched grid lines), so columns of the column plan can be projected onto the framing plans. Nothing like it exists.
3. **Support nodes (columns as support points).** Project, sheet, point (page and plan mm), grid intersection labels, source (glyph on this page, projected from the column plan, placed by a person), the column piece it belongs to, status.
4. **Beam lines (before splitting).** Sheet, build run, end points, the source segments merged and the gaps bridged, pen class, role (girder or beam). `sheet_lines` stores only raw lines.
5. **Pieces with start and end points.** On `members` or a new table: page-point start and end, piece index on its beam line (B_1, B_2 ...), the beam line it came from, start and end support node, support state (both ends, one end, none), build run. `supported_by` holds member ids, not nodes. The plan start/end columns in mm exist and can be reused.
6. **Label attachment evidence.** Which label (size, studs, camber) went to which piece and by which rule; "undefined" when no size is attached (a state, not a missing row). `size_source` and `size_evidence` from 013 cover part of this.
7. **Crop per page, confirmed.** `sheets.crop_region` exists; missing: who confirmed it and when. Or use `sheet_views` as the crop (it already has the confirmed scale).
8. **T.O.S. per page.** `sheets.tos_notes` (text) exists; missing: elevation in mm, the raw text, source (read or typed), confirmed by and when. Pieces copy it to both end elevations unless an edit says otherwise.
9. **Build state per page and build history.** `sheets.build_status` and `built_at` exist; missing: a `build_runs` table (sheet, who, started, finished, inputs (crop, scale, T.O.S., pen class), rules version, counts, error) so a rebuild is traceable and never overwrites a person's edits. Also the build order rule (column plan before framing plans).
10. **BOM column meanings.** Main, Section Type and Category need a mapping, not a table: Category = kind (`member_kinds`), Section Type = catalog family, Piecemark = tag. What "Main" holds in Steel Genie's BOM is not known to me (question below).

## 4. Part B: Phase 6b status
Phase 6b results exist (`docs/PHASE6B_RESULTS.md`, with the Phase 6c correction). Nothing was re-run.
1. Data: 16 jobs, 136 pages, 4,373 estimator count symbols, one-to-one matching at 12 pt.
2. Label-first: precision 0.20, recall 0.21, F1 0.20, 13% of pages within plus or minus 1.
3. Line with label (one piece per linked line): P 0.29, R 0.20, F1 0.24. It became the display basis in Phase 7.
4. Line first (every structural line of the suggested class): P 0.10, R 0.29, 13,133 pieces for 4,373 symbols (3 times too many).
5. Oracle class choice adds at most 0.06 F1; class choice is a small factor compared with coverage.
6. Coverage: the 6b figure "47.5% of symbols with no line within 24 pt" counted only the suggested class. Phase 6c found 70% of those have a line of some class within 24 pt, but a random point does too 56% of the time.
7. Phase 7 chance controls: symbols moved 60 to 200 pt keep about half of every basis's recall, so the real alignment is about +0.10 recall over chance (+0.04 without the two largest jobs).
8. Phase 7 grammar (line-first with grids, column glyphs, chaining, splits at supports): held-out P 0.04, R 0.19, no signal over chance. Structure alone cannot tell which of thousands of lines are the members.
9. **What changes the plan.** Those line-first runs had no person crop, no person class choice and no column plan, and were scored against symbol positions, while the estimators' rings sit beside columns (median 36 pt on one page). So the new flow is untested, not disproven. The person's crop and class choice are what it depends on, and its evaluation should be at quantity level (job-018 workbook), not symbol positions.
10. Also: the estimators count only what the job needs on a page (scope), and only one finished takeoff (job-018) exists as quantity ground truth.

## 5. Part C: drawing checks (measured, as pre-registered in section 0)

Files: 17 jobs have a PDF under `fixtures/private/` (job-001 drawing, 16 marked-up copies). **Not checked: job-009 and job-016** (no file under fixtures/private; I did not search elsewhere). Processes: C1 run PID 142718, a count-only diagnostic PID 143047, C2 run PID 144137; all exited by themselves. Database access was one read-only transaction (page type guesses). The API on port 3000 was not touched.

### C1. PDF layers
"Catalog layers" = the PDF's layer list (`get_ocgs`). "Path tags" = share of stroked paths on up to 3 sampled pages that carry a layer name (`get_drawings` field `layer`). Patterns only; no layer name is printed.

| job | file | has layers | layer count | beam-like | column-like | grid-like | paths with a layer tag | beam / col / grid in path tags |
|---|---|---|---|---|---|---|---|---|
| job-001 | drawing | yes | 95 | yes | no | yes | 0% | no / no / no |
| job-002 | marked-up | no | 0 | no | no | no | 0% | no / no / no |
| job-003 | marked-up | no | 0 | no | no | no | 45% | yes / yes / yes |
| job-004 | marked-up | yes | 32 | yes | no | no | 100% | yes / no / no |
| job-005 | marked-up | yes | 13 | no | no | yes | 0% | no / no / no |
| job-006 | marked-up | yes | 1 | no | no | yes* | 99% | yes / yes / yes |
| job-008 | marked-up | yes | 1 | no | no | yes* | 0% | no / no / no |
| job-010 | marked-up | no | 0 | no | no | no | 0% | no / no / no |
| job-011 | marked-up | yes | 805 | yes | yes | yes | 100% | yes / yes / yes |
| job-012 | marked-up | yes | 1 | no | no | yes* | 99% | no / no / no (steel and dimension patterns only) |
| job-013 | marked-up | no | 0 | no | no | no | 0% | no / no / no |
| job-014 | marked-up | yes | 1 | no | no | yes* | 0% | no / no / no |
| job-015 | marked-up | no | 0 | no | no | no | 0% | no / no / no |
| job-017 | marked-up | no | 0 | no | no | no | 0% | no / no / no |
| job-018 | marked-up | no | 0 | no | no | no | 0% | no / no / no |
| job-019 | marked-up | yes | 1 | no | no | yes* | 0% | no / no / no |
| job-020 | marked-up | yes | 31 | yes | yes | yes | 0% | no / no / no |

\* One single layer whose name matches the grid pattern and the text pattern at once (the same pattern in 5 jobs); whether it holds the grid is unknown.

- Totals: layer list in 10 of 17; beam-like layer name 4 of 17; column-like 2; grid-like 9 (5 of them the single layer marked \*). Path tags on sampled pages: 5 of 17; beam-like tags 4, column-like 3, grid-like 3.
- **Measured oddity.** On job-006 and job-012 the paths carry 36 and 23 distinct layer tags on one page, and none of them is in the PDF's layer list (which has 1 entry). job-001 has 95 layers but no path on its first 3 pages carries a tag (its content sits in Form XObjects; whether the layers are attached there is not checked).
- **Caveat (stated in advance):** 16 of the 17 are Bluebeam marked-up copies; the original drawing files may have different layer lists. Not checked.
- **Reading.** Layers are a bonus where present (job-011, job-006, job-004, job-003 tag beams), not a signal to build on: 11 of 17 jobs have neither a beam-like layer name nor beam-like path tags.

### C2. Line weight under the estimators' circle symbols
Pages picked by the registered rule (seed 7701 among 13 eligible jobs): job-003, job-015, job-020, each the eligible framing page with the most eight-vertex symbols. Assumption (stated in advance): eight-vertex symbols stand for beams; this is not proven.

Per page:
| | job-003 | job-015 | job-020 |
|---|---|---|---|
| circle symbols | 99 | 113 | 31 |
| straight segments | 17,412 | 8,460 | 13,563 |
| distinct widths / full clusters | 22 / 35 | 11 / 13 | 14 / 27 |
| share of segments drawn solid (PDF dash array empty) | 100% | 99.9% | 99.9% |
| segments within 12 pt of a symbol (displaced control mean) | 1,801 (807) | 1,220 (323) | 497 (389) |
| T1 (heaviest solid cluster, at least 20 segments) | 38 pt, yellow | 1.80 pt, black | 8 pt, green |
| T1 share of all length / near length / control near length | 0.0% / 0.0% / 0.0% | 19.3% / 45.7% / 46.1% | 0.6% / 0.0% / 0.5% |
| **registered verdict** | **not distinct** | **not distinct** | **not distinct** |
| T2 (cluster with most near length; descriptive) | 0.84 pt grey (0.80) | 1.80 pt black (= T1) | 0.24 pt light grey (0.92) |
| T2 share of all length / near length | 24.6% / 36.7% | 19.3% / 45.7% | 17.9% / 53.8% |
| layer tags on these pages | none | none | none |

Length share by width (all segments / within 12 pt of a symbol), widths holding at least 1% of either:
| job-003 | job-015 | job-020 |
|---|---|---|
| 0.48 pt: 16.5% / 4.7% | 0.24 pt: 49.1% / 16.1% | 0.24 pt: 77.7% / 64.3% |
| **0.84 pt: 48.0% / 70.2%** | 0.36 pt: 4.6% / 7.2% | 0.36 pt: 6.0% / 10.6% |
| 0.98 pt: 1.8% / 5.7% | 0.84 pt: 14.5% / 0.1% | 0.84 pt: 4.1% / 2.0% |
| 1.08 pt: 3.5% / 5.2% | 0.98 pt: 3.2% / 17.9% | 0.98 pt: 0.7% / 6.2% |
| 1.92 pt (heaviest black): 7.1% / 9.7% | 1.20 pt: 6.9% / 12.9% | **1.80 pt (heaviest black): 7.1% / 15.6%** |
| (others below 6% each) | **1.80 pt (heaviest black): 19.3% / 45.7%** | (others below 2% each) |

**Post-hoc reading (not registered).** The registered T1 rule picked thick coloured bands on two pages (38 pt yellow, 8 pt green), so it tested the wrong thing there. Looking at the heaviest BLACK pen instead: it holds 9.7% / 45.7% / 15.6% of the near length against 7.1% / 19.3% / 7.1% of the page (1.4, 2.4 and 2.2 times). On job-015, symbols moved 60 to 200 pt land on it just as often (46.1%), so the whole framing area is drawn in that pen, not only the marked members. Either way the answer is the same: **the heaviest pen is enriched under the symbols but holds well under half of the near length on 2 of 3 pages; most near length there is thin or medium grey linework.**

**A likely contamination.** A 0.98 pt magenta cluster (the colour of the estimators' circle symbols) is part of the page content on all three pages and holds 5% to 18% of the near length. It is likely flattened markup from the estimators (tag boxes or leaders), not drawing linework. Likely, not proven; it slightly inflates the near shares of that cluster only.

**Dash patterns.** Almost every segment has an empty PDF dash array: dashed lines are drawn as separate short segments (as Phase 4c found), so "dash pattern" as a PDF attribute carries no information on these pages; dashes must be found by chaining.

Fragmentation (anchor = nearest segment within 12 pt of a symbol, chained along collinear segments of the same cluster):
| | job-003 | job-015 | job-020 |
|---|---|---|---|
| anchor in T1 | 0 of 99 (T1 is a colour band) | 82 of 113 | 0 of 31 (T1 is a colour band) |
| T1 chain, gaps up to 24 pt: segments per chain median / 90th pct; single segment | n/a | 2 / 4; 44% | n/a |
| T1 gap size median / 90th pct | n/a | 18.0 / 18.0 pt | n/a |
| T1 chain length median | n/a | 302 pt | n/a |
| any cluster, gaps up to 24 pt: segments per chain median / 90th pct; single segment | 1 / 18; 55% | 1 / 27; 59% | 2 / 5; 42% |
| any cluster: gaps per chain (mean); gap median / 90th pct | 1.7; 9.0 / 9.0 pt | 6.0; 9.0 / 9.0 pt | 2.4; 4.6 / 6.8 pt |
| gaps up to 6 pt only: single segment | 68% | 89% | 74% |
| gaps up to 72 pt: gap 90th pct | 11.3 pt | 9.0 pt | 24.0 pt |

- **Reading.** Where a symbol sits on a heavy black line (job-015), the line is usually one piece or two pieces with one fixed gap of 18 pt (likely a break where it crosses another member or a column; not checked). Elsewhere half the anchors are single segments, and the rest are chains of many short pieces with regular 4.5 to 9 pt gaps: dashed linework (hidden beams, joists or bridging). A merge step must bridge at least 18 pt gaps on solid lines without fusing dashed ones; the current merge in `linking/lines.py` bridges 1 pt.

Overlays (not viewed by me; for the owner): `fixtures/private/shots/phase7_audit/c2-1-job-003.png`, `c2-2-job-015.png`, `c2-3-job-020.png`. Each shows the page faint, the 8 widths with the most length in 8 colours (legend top left, widths only), other widths grey, and the circle symbols as black rings.

### Proven, likely, unknown (Part C)
- **Proven (measured):** layer lists and layer tags are present on a minority of jobs and do not agree with each other on two jobs; on 3 framing pages no pen-weight cluster passes the registered "distinct" bar; dashes are separate segments; beam-near chains break at 4.5 to 18 pt gaps.
- **Likely:** the heaviest black pen is the main framing pen on some drawings (job-015) but not on others (job-003, job-020 draw much of the marked linework in thin or grey pens); the 0.98 pt magenta cluster is flattened estimator markup.
- **Unknown:** what the eight-vertex symbols stand for (beam is assumed); whether the original drawing files carry more layers than the marked-up copies; how the two jobs not under fixtures/private (job-009, job-016) look; what the 18 pt gap on job-015 is.

## 6. Recommended build order
1. **Decide on the pilot first.** pilot-01 is set up for the counting copilot on the current screen. The new workspace replaces that screen. Either run the pilot now, to get the estimators' time per page as the baseline the new flow must beat, or stop it.
2. **Schema (one additive migration):** build runs, grid lines, support nodes, beam lines, piece fields (start/end points, index on its line, supports, build run), crop and T.O.S. confirmation (section 3). Back up first; test database first.
3. **Backend line-first module in the worker (`worker/src/build/`),** ported from the Phase 7 grammar and `linking/lines.py`, with synthetic PDF tests for each step. Inputs are the person's crop, scale, T.O.S. and line class (C2: the pen alone does not pick the beams). Steps: segments inside the crop, then remove hatch, dimension and text strokes (existing `line_roles.py`), then grids from bubbles and dash-dot lines, then columns (glyphs at grid crossings, or projected from the confirmed column plan), then beam lines. Merge collinear pieces and bridge gaps up to about 18 to 24 pt on solid lines (C2), snap ends to columns, then girders, then beams. Split at supports into B_1, B_2 ..., keep unsupported pieces flagged and never drop them. Last, attach labels (existing parsers, legend rows, size rule). Length = support-to-support distance x confirmed scale.
4. **A `build_sheet` job and API:** Build per page (column plan pages first), page card state, results per page; a BOM endpoint with Main, Category, Piecemark, Qty, Section Type, Section, Length, Grade, Weight, from the existing catalog, grades and BOM code.
5. **Measure before building the screen.** Pre-register a quantity-level comparison on job-018 (the only finished takeoff): build with a person's crop and class on its framing pages and compare pieces and length per size with the workbook. The label-first count stays behind the switch as the comparison.
6. **UI shell, replaced in place:** projects grid; Plans | BOM tabs; left page cards (Build button, T.O.S., scale, status); canvas reusing the pdf.js loader, geometry, snap and measure helpers, with a vertical toolbar (select, crop, add beam, split, join, measure); right Properties panel (Summary, Member, Crop). Edits go to `member_edits` as today.
7. **Retire label-first** only when the new method beats it on the registered measure.

## 7. Decisions for the owner
- The pilot on pilot-01 (current copilot screen): run it as the time baseline, or stop it?
- What does Steel Genie's "Main" column hold (main member yes/no, assembly main part, something else)?
- May the line-first build module and its schema (sections 3 and 6) be planned as the next phase?
- For job-009 and job-016 (not under fixtures/private), and for layer lists in the original files: do you want the original drawing files checked (you would give the paths)?
- Which symbol groups mean beams? C2 assumed the circle group.
