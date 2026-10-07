# Steel Estimation Platform: Estimate Stage Spec (v0.1)

## 1. Purpose
Build an in-house tool for Whiteboard Technologies (structural steel detailing/fabrication, Bengaluru) that turns 2D structural drawing PDFs into a reviewed steel takeoff (BOM), a priced estimate, and approved member data. It is modeled on the workflow of Steel Genie (ALLPLAN), which is proven to raise estimator productivity. Goal: build and prove it for internal use first. Not a product for sale.

Every number must be traceable to the drawing it came from. Every extracted field carries a confidence and a reason where uncertain. Human corrections are stored as data.

## 2. Scope
In scope (estimate stage): create project, upload PDF set, pick sheet, confirm scale, crop plan region, build members from the sheet, review/edit members, add braces by form, project config defaults, BOM with totals, Excel export, approval gate, export of approved member JSON.

Out of scope for now: the Tekla/3D-model stage (separate spec later), IFC export, PDF markup export, revision comparison, connection design engine, misc steel (stairs, rails), scanned/raster drawings, multi-user permissions.

## 3. Business workflow (hard constraint)
Client sends 2D drawings -> we estimate and quote -> only after client approval do we build the 3D model in Tekla. No BIM model exists upstream. So: the estimate stage must never trigger the model stage automatically. Approval is an explicit state change by a human.

## 4. Architecture (proposed; challenge if you see better)
- API + orchestration: Node.js/TypeScript (Fastify or NestJS), PostgreSQL, Redis, BullMQ. Docker on Linux.
- Extraction worker: Python (PyMuPDF, pdfplumber), called via queue. Reads vector PDF content directly (text with positions, line paths). Text that is outlined into stroked paths (a CAD stroke font, as in the test set) is read by a deterministic glyph reader with a person-confirmed glyph library (Phase 4b). A local OCR engine is allowed only as an optional cross-check (off by default, no network, never the source of truth, never overwriting the glyph result); scanned/raster drawings stay out of scope and are never OCR'd.
- Web UI: React + TypeScript, pdf.js for the sheet canvas with an SVG overlay for members, Three.js for the review 3D view. (Frontend stack is an open decision; see section 12.)
- Storage: PDFs on local disk/object store path configured by env; metadata and members in Postgres.
- Review-time 3D is a lightweight Three.js view drawn from member JSON. Tekla + MCP is used only in the later model stage after approval.
- Components are separate processes talking through Postgres and the queue (extraction and review are independently scalable).

## 5. Member data contract (schema_version 0)
Versioned from day one. Expect it to change; migrations must handle it.

Project-level (once per project):
  schema_version, project_id, name, number, status, design_standard (default "AISC"), unit_system (canonical internal unit: mm; keep original display strings), location,
  grids: [{axis, label, position_mm}] (labels may be non-Latin; store exact characters),
  levels: [{name, elevation_mm}], drawing_issue/revision label.

Sheet-level:
  sheet_id, sheet_number (e.g. S030), title, kind (plan | schedule | detail | notes | other), page_index, scale (parsed + user override + source), tos/elevation notes parsed from the sheet, crop_region (bbox), build_status, built_at.

Member-level:
  member_id (stable id; must survive rebuilds/revisions where possible),
  type: beam | column | brace | joist | other,
  mark/name,
  profile_raw (text exactly as on the drawing), profile (normalized catalog name, null if unresolved),
  material and grade: explicit, NEVER defaulted (e.g. W-shapes A992, angles A36, HSS per drawing),
  start / end: { grid_x, grid_y, offset_x_mm, offset_y_mm, elevation_mm, resolved_xyz_mm, resolution_method } (elevation required at BOTH ends; members can be sloped),
  level, rotation, camber, studs, quantity/repeat,
  supported_by: [member_id] (used by the unsupported-member check),
  connection_hint: { type, raw_text } (label only in v0),
  coating/finish (optional),
  source: { sheet_id, bbox, callout_ref } per field where practical,
  confidence per field (0..1) + overall status color (green | amber | red) + reason string,
  review: { status: unreviewed|approved|edited|rejected, original_value, corrected_value, reviewer, timestamp } per edited field.

Computed (not extracted): length, weight, cost. Computed by the engine from catalog and rules.

Lessons from the Tekla tests that this contract must respect:
- Sloped members exist: elevation at both ends, never one.
- Material is never a default.
- A member with no support must be flagged by the validator.
- Grid labels can be non-Latin (a test model used Cyrillic letters that look like Latin). Always use exact characters from the data.
- A profile name is only proven valid if it resolves in the catalog and gives non-zero weight.

## 6. Validation rules (deterministic)
- Profile resolves in the AISC shapes catalog -> weight per length > 0.
- Material/grade is present and plausible for the shape family (flag, don't auto-fix).
- Both end elevations present; length > 0.
- Unsupported member check via supported_by / geometry.
- Duplicate member check (same type, profile, endpoints).
- Units sane (flag lengths outside plausible range for the sheet scale).
Each failure sets status amber/red with a reason. Validation never silently changes data.

## 7. Pricing engine (deterministic)
Inputs: validated members, catalog weights, rate table. Outputs: weights, tonnage, labor hours, cost. Pricing RULES come from the estimators (rates per ton or hour, fabrication vs erection split, connection allowance, waste, markups). Do NOT invent them. Build the engine with a configurable rate table and stub values clearly marked as placeholders until I supply the real rules.

## 8. Data sources I must provide (do not fabricate)
- AISC shapes database (published spreadsheet) -> catalog import.
- One real estimate spreadsheet from an estimator -> pricing rules.
- Fixtures: job-001 drawing set (6-page vector PDF, AutoCAD exported through Bluebeam; S001 cover/notes, S011 site plan, S030-S032 trellis framing, S4.1 details), and ideally an estimator takeoff for S030-S032 as ground truth.
Place fixtures under /fixtures (git-ignored if they are client data).

## 9. Phases
Work one phase at a time. Each phase ends with a demo I can run and a written report of what ran and passed.

Phase 0: Skeleton
- Repo layout, docker-compose (Postgres, Redis), env config, migrations tool, lint/test setup, CI-less local scripts.
- DB tables: projects, sheets, members, member_edits, rate_table, catalog_shapes, jobs.
- Done when: docker compose up works, migrations apply, a health endpoint returns OK, one test runs.

Phase 1: Contract, catalog, validator, BOM, Excel
- Implement schema v0 (types + JSON schema), catalog import from the AISC file, validator, pricing stub, BOM aggregation, Excel export.
- Seed 10-15 hand-written members for job-001 from a JSON fixture (I will provide or we write together).
- Done when: seed members flow through validate -> BOM -> price -> Excel, and tests cover each validation rule including the sloped-member and unsupported-member cases.

Phase 2: Projects, upload, sheets
- Create-project form (name, number, status, design standard, units, location, upload up to 500 MB PDF), ingest job (page count, per-page vector/scanned detection, thumbnails), sheet classification by sheet number/title block text (regex first), read scale from title block text with manual override, progress states (create -> scan -> done).
- Done when: job-001 uploads, 6 sheets appear with correct kinds, scales parsed or flagged.

Phase 3: Review UI shell
- Sheet list with thumbnails, scale dropdown, crop box tool, sheet canvas (pdf.js) with SVG member overlay, status colors (green/amber/red), click-to-select, member inspector (profile typeahead from catalog, both end elevations, studs, camber, review status), pending-changes bar (Unsaved changes: Restore / Apply), stored edit history.
- Use seed members from Phase 1 so the UI works before extraction exists.
- Done when: I can select, edit, apply and restore a seed member, and the correction is stored with original and corrected values.

Phase 4: Extraction ("Build" on a sheet)
- 4a (inspection only, no design yet): dump text objects with positions, line/path geometry, fonts, and layers/groups for job-001 S030-S032. Report what the PDF actually contains and how callouts sit relative to members. Stop and show me.
- 4b: extract members for the cropped plan region: lines -> candidate members, callout text -> profile/studs/camber, snap ends to grids, assign confidence/reasons, queue incomplete members as amber/red.
- 4c: evaluation harness against ground truth takeoff: member recall and precision by type, profile exact-match rate, length tolerance, total weight error. Report numbers, don't hide misses.
- Done when: Build on S030-S032 produces members, the harness prints metrics, and failures are flagged not guessed.

Phase 5: Braces, config, 3D review view
- Brace form (start/end column, welded/bolted, pattern X/V/chevron/diagonal, HSS size), config tab (ASD/LRFD, default connection style, bolt grade/diameter priorities, plate thickness priorities) stored as project config, connection allowance via lookup table.
- Three.js viewer beside the 2D sheet: members as lines/boxes from JSON, color by type/status/weight, click-to-select linked both ways with the 2D view.
- Done when: a seed project shows linked 2D/3D selection and braces appear in BOM.

Phase 6: Approval gate + handoff
- Explicit "Approve estimate" action (human only). Locks a version, exports approved member JSON (the contract in section 5) for the later Tekla stage. No automatic model creation.
- Done when: approving freezes a version and the JSON validates against the schema.

Later (not in v0): revision comparison via stable member ids, IFC export, PDF markup export, connection design, misc steel, scanned drawings, more engineering firms' conventions.

## 10. Rules for Claude Code
- Deterministic code in the core pipeline; no LLM calls in extraction, validation, pricing.
- Don't invent catalog data, rates, or ground truth. Ask.
- Anything that fails validation is flagged with a reason, never silently corrected or dropped.
- Keep extracted data and human corrections separate; never overwrite original extracted values.
- No real client data in git. Treat uploaded drawings as confidential; no third-party API calls with drawing content.
- Tests: every validation rule has a test. Report only what you ran.
- Keep modules small and documented; keep the member schema versioned with migrations.

## 11. Definition of done (per phase)
Runs locally via documented commands, tests pass (ran, not assumed), a short written report lists what was built, what was tested, what is missing, and what decision I need to make next.

## 12. Open questions (answer before or during the phase noted)
- Frontend framework confirmed as React + TS? (Phase 3)
- Pricing rules and rate table from the estimators. (Phase 1/6)
- Ground-truth takeoff for job-001 S030-S032, and more past sets from other engineering firms. (Phase 4c)
- Auth/user model: single team login or per-user? (Phase 2)
- Deployment target: on-prem Ubuntu server details. (Phase 0)
- Canonical unit: mm internally with imperial display strings, confirm. (Phase 1)

## 13. Decision log
- 2026-10-07 (Phase 0) Clean-slate rebuild. No code from earlier work is reused.
- 2026-10-07 (Phase 0) Monorepo: `api/` (Node 20+, TypeScript, Fastify 5), `worker/` (Python 3.12, uv-managed venv, fully pinned and hashed `requirements.txt`), `web/` (React + TS + Vite placeholder), `db/migrations/` (numbered plain SQL), `docs/`, `fixtures/`.
- 2026-10-07 (Phase 0) DB access via Kysely + pg. Migrations are plain `.sql` files applied in order by `db/migrate.ts`, each in a transaction, tracked in `schema_migrations`, under an advisory lock.
- 2026-10-07 (Phase 0) Node -> Python handoff uses the Postgres `jobs` table. Workers claim with a single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`. Failed jobs return to `pending` until `max_attempts`, then `failed`. Jobs whose lock is older than `WORKER_LOCK_TIMEOUT_SECONDS` (default 600) are reclaimed. A worker claims only job types it has handlers for. No BullMQ on the Python path; Redis is in compose for later Node-side use only.
- 2026-10-07 (Phase 0) Importing a module never starts a server or worker. Entry points are only `api/src/server.ts` and `worker/src/main.py`; a test enforces this for the worker.
- 2026-10-07 (Phase 0) Member storage: normalized columns on `members` hold the values as extracted or entered. Human corrections are stored only in append-only `member_edits` rows (field, original_value, corrected_value, review_status, reviewer, timestamp). The effective value of a field is its latest edit, otherwise the member column. Extracted values are never overwritten by review.
- 2026-10-07 (Phase 0) Missing values are stored as NULL and flagged by the validator, never defaulted or dropped. So material, grade, profile_raw and both end elevations are nullable in the DB, while SPEC section 6 makes their absence a validation failure. Only `type` and `origin` are required.
- 2026-10-07 (Phase 0) `members.sheet_id` is nullable (form-entered braces have no sheet). `member_id` (stable id) is unique per project. `origin` is one of extracted | manual | seed. `supported_by` is a text array of stable member_ids.
- 2026-10-07 (Phase 0) Lengths and elevations are stored in mm (`*_mm`), with original drawing strings kept in `*_raw` columns where relevant. The `projects.unit_system` default is `mm`, pending confirmation of the section 12 open question.
- 2026-10-07 (Phase 0) Computed values (length, weight, cost) are not stored on `members`; the engine computes them (Phase 1).
- 2026-10-07 (Phase 0) `rate_table` is a generic key/value/unit table with `is_placeholder` (default true), so no pricing structure is invented before the estimators supply rules. No rows are seeded.
- 2026-10-07 (Phase 0) `catalog_shapes` keeps `edition`, `shape_name`, `family`, `weight_kg_per_m` (> 0), optional `weight_lb_per_ft`, and the remaining AISC columns in `properties` JSONB. It is unique on (edition, shape_name). No rows are seeded until the AISC file is provided.
- 2026-10-07 (Phase 0) Local ports: Postgres 127.0.0.1:5432, Redis 127.0.0.1:6380 (6379 is taken by a host Redis on the dev machine), API 127.0.0.1:3000, web 127.0.0.1:5173. Credentials come only from `.env`; code has no credential defaults.
- 2026-10-07 (Phase 0) Tooling: eslint + prettier + tsc + vitest (api), ruff (check + format) + pytest (worker), `tsc` typecheck (web), with Makefile targets. API and worker tests run against the real compose Postgres.
- 2026-10-07 (Phase 0) Secret scanning: gitleaks v8.21.2 pre-commit hook (`.githooks/`, blocks on findings or if gitleaks is missing) and `scripts/run-gitleaks.sh` for CI. `.gitleaks.toml` adds a connection-URL password rule to the default rules.
- 2026-10-07 (Phase 1) Pricing is NOT part of Phase 1 (instruction for this phase; SPEC section 9 listed a pricing stub). No cost columns or rate logic exist. `rate_table` stays empty. Pricing moves to a later phase to be named.
- 2026-10-07 (Phase 1) Contract v0 is defined once as Zod schemas (`api/src/contract/schema.ts`); TypeScript types are inferred from them and `schema/contract.v0.schema.json` (draft 2020-12) is generated from them. A test fails if the committed file drifts. All keys are required, unknown values are explicit null, objects are strict, and identifiers and grid labels are never trimmed or normalized (Cyrillic look-alikes stay distinct from Latin). Contract details chosen: bbox `{x0,y0,x1,y1}`, grid axis `x|y`, `unit_system` literal `mm`, `review.edits[]` (docs/OPEN_QUESTIONS.md item 11).
- 2026-10-07 (Phase 1) Catalog loader reads CSV or XLSX from a supplied path. The name column, weight column and weight unit (`lb/ft` or `kg/m`) are explicit arguments with no defaults, because the AISC file layout is not known yet. Weight must be a number > 0 and names must be unique; the whole file is refused if any row fails (no partial import). lb/ft is converted to kg/m with the exact factor 0.45359237 / 0.3048 and both values are stored. Editions are immutable: importing into an existing label is refused. Only synthetic `TEST-xxx` shapes exist in the repo; no real catalog data was invented.
- 2026-10-07 (Phase 1) Validator rules: missing material, missing grade, missing profile, profile not in catalog (exact match), non-positive catalog weight, missing start or end elevation (0 is a valid value), length unavailable, non-positive length, unsupported member, support reference not found, duplicate member (same type, profile and end points, either direction). Non-Latin grid labels are allowed and untouched. Severity: red when the member cannot be weighed or its geometry is wrong, amber when it is incomplete or suspect; status is the worst issue. Validation never changes data. Assumptions to confirm: columns are exempt from the unsupported check, and the severity mapping (docs/OPEN_QUESTIONS.md items 4 and 5). Not implemented: material/grade plausibility per family and scale-based length sanity (need your input).
- 2026-10-07 (Phase 1) Length is the 3D distance between the resolved end points (sloped members handled) and is null, not estimated, when an end is unresolved. Weight = length (m) x catalog kg/m x quantity. Length and weight are computed on demand and never stored. A member that can be weighed counts toward the totals even if flagged for another reason; members that cannot be weighed stay in the BOM, flagged, and are reported as excluded.
- 2026-10-07 (Phase 1) Units: mm is canonical; feet-inches (nearest 1/16 inch) is display only. Excel shows kg, lb and metric tonnes.
- 2026-10-07 (Phase 1) Excel export (exceljs): a `BOM` sheet (a row per member, totals row) and a `Summary` sheet (inputs, status counts, totals, by profile, by type, issue counts, no-pricing note). Plain values, no formulas, no timestamps. exceljs depends on uuid 8; `overrides.uuid` pins ^11.1.1 to clear an advisory (`npm audit` reports 0).
- 2026-10-07 (Phase 1) API: `GET /api/projects/:projectId/bom?edition=` (JSON validation + BOM) and `GET /api/projects/:projectId/bom.xlsx?edition=`. Read-only. 404 for an unknown project or edition, 400 for a malformed id or missing edition, 422 if a stored member violates the contract. `member_edits` are not applied yet (the edit vocabulary is defined with the review UI in Phase 3) and every member is included regardless of review status.
- 2026-10-07 (Phase 1) Test data is synthetic only (`fixtures/synthetic`: TEST-001..003 at 10/25/40 kg/m, 14 made-up members) and non-ASCII text in code and fixtures is written as \u escapes (enforced by a test), so look-alike characters cannot hide in source.
- 2026-10-07 (Phase 1 follow-up) A column whose base elevation cannot be determined is flagged red (`COLUMN_BASE_ELEVATION_MISSING`). Base = the lower end, by resolved z when both ends are resolved, else the lower of the two elevations; unknown if that end has no elevation. Columns stay exempt from the unsupported-member check (docs/OPEN_QUESTIONS.md item 14).
- 2026-10-07 (Phase 1 follow-up) BOM totals: RED members are excluded from the main total (JSON `totals`, Excel total row, Summary) and reported on a separate `excluded_red` block / "EXCLUDED (red)" row: member count, piece count, and length and weight for the red members that could still be weighed. AMBER members stay in the main total. By-profile and by-type groups follow the main total. `members_excluded` was replaced by `excluded_red`. Synthetic fixture result: main total 10 members, 13 pieces, 73,000 mm, 1,405 kg; excluded (red) 4 members, 4 pieces, 1 weighed (6,000 mm, 60 kg).
- 2026-10-07 (Phase 2) PyMuPDF (AGPL-3.0) is used by the worker; AGPL accepted for internal use only. If the tool is ever distributed or offered as a service to others, revisit (commercial licence or replacement).
- 2026-10-07 (Phase 2) FINDING: the real drawing set has no text layer (all 6 pages: 0 fonts, 0 text spans, 22k to 47k vector paths, text outlined as curves; rotation 270, 3024 x 2160 pt). SPEC section 4 assumed readable text. In Phase 2 its sheet numbers, titles, scales and classification therefore come out null and flagged (`no_text_layer`); the scanner is tested on synthetic PDFs that do have text. Its 18 bookmarks all point at page 1 and are not used. Phase 4 needs a decision (re-export with text, OCR, or glyph matching); docs/OPEN_QUESTIONS.md item 15.
- 2026-10-07 (Phase 2) Upload: one PDF per project, streamed to disk (never buffered), 500 MB limit (`MAX_UPLOAD_BYTES`), non-PDF rejected by the `%PDF-` magic bytes at the start of the file regardless of filename or content type, sha256 and size computed while streaming, filename sanitized (path stripped, ASCII letters/digits/`._ -`, 120 chars), stored under git-ignored `uploads/<project>/<random>.pdf`. The file record, the `scan_pdf` job and the project status change are written in one transaction; failed or duplicate uploads leave no file behind.
- 2026-10-07 (Phase 2) The Node -> Python handoff for scanning is the Postgres `jobs` table (`scan_pdf`, payload `{project_id, document_id}`); no new queue tech. Handlers now receive `(connection, job, config)`. A scan is marked failed for the user (`scan_failed`) only after the job's last attempt; earlier failures retry. A re-scan upserts on (project, page_index) and never touches scale overrides or edit history. Page text is never logged (titles can contain client names).
- 2026-10-07 (Phase 2) Page analysis: `has_text_layer` = at least 20 non-space characters, `has_vector_paths` = at least 50 drawing paths, `scanned` = one image covering at least 50% of the page with too few vector paths (a hidden OCR text layer on such a page is not trusted or used), `vector` = has paths or text, otherwise `unknown`. Scanned pages are flagged `scanned_unsupported_v0`; no OCR. Thresholds are tunable defaults, not measured values. Text boxes are mapped through the page rotation matrix because PyMuPDF reports them in unrotated space.
- 2026-10-07 (Phase 2) Sheet number: label-anchored first (SHEET NO / DWG NO ...), then a conspicuously large unique candidate in the title-block corner or far-right strip; pattern accepts S001, S030, S4.1, S-101, S2.01, S101A, SD1.2; ambiguous or missing -> null + flag. Title only from a SHEET TITLE / DRAWING TITLE / TITLE label. Classification (plan | schedule | detail | notes | other) by keyword rules on the title, falling back to large all-caps view titles; confidence 0.9 / 0.75 / 0.6 / 0.5 (ambiguous, priority schedule > plan > detail > notes) / 0 (no evidence); reasons name rules, never page text; below 0.7 is flagged (docs/OPEN_QUESTIONS.md item 16).
- 2026-10-07 (Phase 2) Scale: every scale expression on a page is stored (`sheets.scales`: raw text, kind, ratio, count). ratio = real length / drawn length (1/8" = 1'-0" is 96; NTS has none). Exactly one distinct scale becomes the sheet's parsed scale; none or several leave it null and flagged. The grammar is implemented in Python (extraction) and TypeScript (override validation) and both are tested against the same vectors in `fixtures/synthetic/scale-cases.json`.
- 2026-10-07 (Phase 2) Manual scale override: stored in its own columns, the extracted scale is never overwritten; every change is an append-only `sheet_edits` row (effective value before and after, editor, reason, time) in the same transaction; setting the same scale again (same kind and ratio) records nothing; clearing is recorded. Setting an override resolves the scale review flags and clearing restores them. `editor` is a required field because there is no authentication yet (SPEC section 12).
- 2026-10-07 (Phase 2) Migration 002: `project_files`, scan columns on `sheets`, `sheet_edits`, unique (project, page_index); the unique (project, sheet_number) index from 001 is dropped because a sheet number is extracted text, not an identity (duplicates are flagged). Project status values: created, scanning, scanned, scan_failed.
- 2026-10-07 (Phase 2) Client drawings for local checks live in git-ignored `fixtures/private/` under anonymized names (job-001.pdf); tests use only PDFs generated inside the tests.
- 2026-10-07 (Phase 4b) SPEC section 4 rule "No OCR in v0" is superseded by the owner's decision: a local OCR engine is allowed ONLY as an optional cross-check. It sits in a separate optional dependency group (`ocr`, pinned and hashed in `worker/requirements-ocr.txt`), is off unless `OCR_CROSSCHECK_ENABLED=true`, makes no network connection (checked statically and by a test that forbids sockets), and never replaces the glyph text: OCR output goes in `text_items.ocr_text`, can only propose glyph labels (`proposed_label`, `votes`) or flag disagreement. Scanned pages are still not OCR'd. Licence, network and audit review: docs/OCR_DEPENDENCY_REVIEW.md (open point: the model files ship without a licence text).
- 2026-10-07 (Phase 4b) Text reader (worker, deterministic): dark stroked paths up to 14 pt merged into character clusters (0.2 pt), all coordinates mapped through the page rotation matrix; a glyph is matched to a library entry when symmetric mean Chamfer <= 0.03 and Hausdorff <= 0.10 of glyph size (the Phase 4a tolerances, not retuned), after normalising translation and scale and resampling to 64 points; upright lines with the Phase 4a rules (minimum 2 characters). Unknown shapes decode to `?` and are counted; vertical text is stored as "not read" (`vertical_text_not_read`) and counted; no rotation invariance. Fixed small-mark rules defined before scoring (docs/PHASE4B_PLAN.md): dots under 1.5 pt, `:` from two stacked dots, word space above 0.45 x median character height (from the measured gap distribution), `=` from two stacked bars, underlines (a bar wider than 1.2 x character height) dropped, lower case below 0.8 x cap height. Confidence constants are rule-based, not calibrated: 0.8 glyph only, 0.3 with unknown shapes, 0.95 OCR agrees, 0.5 OCR disagrees.
- 2026-10-07 (Phase 4b) Glyph library (migration 003, table `glyph_library`): one row per shape per `font_id`, `proposed` with no label until a person confirms it; `confirmed` requires a label and a reviewer (CHECK constraint); only confirmed labels decode; OCR votes never confirm. Labels are seeded by OCR majority vote (only from lines where the OCR length equals the cluster count, no small marks, letters counted case-insensitively, ground-truth lines excluded) and reviewed by the owner through a CSV (`python -m src.text_reader.cli export-csv / import-csv`, atomic, with a dry run) and contact sheets of unlabeled groups in `fixtures/private/`.
- 2026-10-07 (Phase 4b) `text_items` (migration 003): bbox in displayed page points, glyph text, OCR text, methods, confidence, agree, needs_review, reasons (`unknown_glyph`, `ocr_disagrees`, `vertical_text_not_read`), stable `item_key`. API: `GET /api/projects/:projectId/sheets/:sheetId/text-items`, `POST /api/projects/:projectId/read-text` (enqueues the `read_text` job). The member contract and members tables were NOT changed: the proposed changes for grid-less members are in docs/SCHEMA_CHANGE_PROPOSAL.md and wait for approval.
- 2026-10-07 (Phase 4b) Accuracy harness (private): compares decoded text with `fixtures/private/ground_truth_text.csv` that only the owner fills in (a blank template of 60 lines, stratified: 30 seeded random upright lines plus 5 each of callout, scale, legend, dimension, mark and sheet lines chosen by page STRUCTURE only (circles, stacked bars, colons, arrowheads, thick member lines, title-block corner; `structure.py`), never by content; a short category is topped up with random lines and reported; `truth-template --regenerate` replaces only a template with no truth filled; accuracy is also reported per `category` column. It is generated if it does not exist; never overwritten). Reports exact match, `?` rate and OCR agreement. No threshold is chosen on that set.
- 2026-10-07 (Phase 4b) Visual glyph review by Claude Code, authorised by the owner for this task (images stay in `fixtures/private/`): the 200 most frequent glyph groups were viewed as shapes only (contact sheets with the OCR guess hidden, `--no-guess`), never using the ground-truth crops; clear shapes were confirmed with reviewer `claude-code-visual-review` (rows carry `reviewed_by`/`reviewed_at`), ambiguous ones (bars I/l/1/-, O vs 0, rotated, symbols, fragments) were left unlabeled. `revoke-labels --who NAME [--font-id F] [--dry-run]` returns every label confirmed by that reviewer to `proposed`; OCR votes are kept.
- 2026-10-07 (Phase 4b) Ground-truth answer sheet: the CSV gains `draft_text` (AI reading of the crop), `review`, `correction`, `truth_source`; `truth_text` is never written by the draft. `truth-accept` copies `draft_text` into `truth_text` where `review` is `ok`, takes a typed `correction` instead (it wins), and leaves other rows empty and out of scoring; a `.bak` copy is written first. The accuracy report states `draft_source: AI, verified by human` with counts accepted as is, corrected and typed by the owner. The harness is not run until the owner has reviewed the drafts.
- 2026-10-07 (Phase 4 inventory) Read-only PDF inventory (`worker/tools/pdf_inventory.py`, findings in `docs/INVENTORY.md`): counts and flags only, no extraction, OCR or text decoding; names exist only in the git-ignored `fixtures/private/inventory_map.csv`; path-based flags use up to 6 sampled pages per file; labelled-circle counts cannot distinguish grid bubbles from callouts without reading labels.
