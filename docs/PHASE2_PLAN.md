# Phase 2 plan: projects, upload, page scan, sheet classification, scale

Branch `phase-2` (from `phase-1`). Scope is exactly what was requested (SPEC section 9, Phase 2). No conflict with CLAUDE.md. One SPEC assumption is contradicted by the real drawing set; see "Finding" below and `docs/OPEN_QUESTIONS.md` item 15.

## Finding that affects this phase (numbers only, from the private fixture)
All 6 pages of the real set have **no text layer** (0 fonts, 0 text spans) but 22k to 47k vector paths each and no page-sized images. The text is outlined (converted to curves). SPEC section 4 assumed readable text. Consequence: sheet number, title and scale text cannot be read from this file without OCR (excluded in v0), so those fields will be null and flagged on this set. The scanner is still built for PDFs that do have a text layer (tested with synthetic PDFs).

## API (Node, Fastify)
| Endpoint | Behaviour |
|---|---|
| `POST /api/projects` | name (required), number, location, design_standard (default AISC), unit_system (only `mm`). Status is set by the server (`created`). |
| `GET /api/projects`, `GET /api/projects/:id` | List and get; includes the uploaded document summary and scan progress. |
| `POST /api/projects/:id/pdf` | One PDF per project. Streams to disk (no buffering), limit 500 MB, rejects non-PDF by magic bytes (`%PDF-`), computes sha256 and size while streaming, sanitizes the original filename, stores under `uploads/<project>/<random>.pdf` (git-ignored). In one transaction it records the file, enqueues a `scan_pdf` job and sets the project to `scanning`. 409 if the project already has a PDF. |
| `GET /api/projects/:id/sheets`, `.../sheets/:sheetId` | Page and sheet scan results. |
| `GET /api/projects/:id/sheets/:sheetId/thumbnail` | PNG. |
| `PATCH /api/projects/:id/sheets/:sheetId/scale-override` | Body `{ scale: string \| null, editor, reason? }`. `null` clears the override. The extracted scale is never overwritten; every change is an append-only row in `sheet_edits` (original and corrected value, editor, timestamp), written in the same transaction as the change. |

Progress states: project `created` -> `scanning` -> `scanned` (or `scan_failed`); `project_files.pages_scanned / page_count` gives page progress.

## Worker (Python 3.12, PyMuPDF, deterministic, no OCR, no LLM)
`scan_pdf` job, claimed from the Postgres `jobs` table (no new queue tech). Per page:
- size, rotation, text-character count, vector-path count, image count and largest image coverage;
- `has_text_layer` (>= 20 characters), `has_vector_paths` (>= 50 paths);
- `page_kind`: `scanned` if one image covers >= 50% of the page and there are too few vector paths; `vector` if it has vector paths or a text layer; otherwise `unknown`. Scanned pages are flagged `scanned_unsupported_v0` and nothing is extracted from them (not even a hidden OCR layer);
- sheet number from title-block text: label-anchored ("SHEET NO", "DWG NO", ...) first, then a unique largest-font candidate in the title-block region. Pattern accepts S001, S030, S4.1, S-101, S2.01, S101A and similar. Ambiguous or missing -> null + flag;
- title: only when it sits under or beside a "SHEET TITLE"/"DRAWING TITLE"/"TITLE" label. Otherwise null + flag;
- classification `plan | schedule | detail | notes | other` by regex on the title, falling back to large all-caps view titles on the page; a confidence and a human-readable reason are stored. No evidence -> `other`, confidence 0, flagged;
- scales: every scale expression on the page (imperial `1/8" = 1'-0"`, `1 1/2" = 1'-0"`, `1" = 20'`, ratio `SCALE 1:96`, `NTS`) stored as raw string + numeric ratio (real length / drawn length; NTS has no ratio). Exactly one distinct scale -> the sheet's parsed scale; none or several -> parsed scale null and flagged;
- thumbnail PNG (480 px long edge) under `uploads/<project>/thumbs/`.
Text coordinates from PyMuPDF are in unrotated page space, so all boxes are transformed with the page rotation matrix before any position logic.
Re-running a scan updates scan fields in place (upsert on project + page); user overrides and edit history are untouched.

## Review flags (`needs_review` + `review_reasons[]`)
`scanned_unsupported_v0`, `no_text_layer`, `no_usable_content`, `sheet_number_not_found`, `sheet_number_ambiguous`, `duplicate_sheet_number`, `title_not_found`, `classification_no_evidence`, `classification_ambiguous`, `low_confidence_classification` (< 0.7), `scale_not_found`, `multiple_scales`.

## Data
Migration `002_phase2_scan.sql`: `project_files` (one per project: filename, path, sha256, size, page count, progress, scan status/error), scan columns on `sheets` (size, rotation, page_kind, counts, source/confidence/reason, `scales` JSONB, ratios, review flags, thumbnail path), unique `(project_id, page_index)`, the unique sheet-number index replaced by a plain index (a sheet number is extracted data, not an identity; duplicates are flagged), and `sheet_edits`.

## Tests
- Node: scale parser (shared test vectors with Python), filename sanitizer, upload (magic bytes, size limit, sha256, one-per-project, atomic job creation, temp-file cleanup), project and sheet endpoints, scale override (valid, invalid, clear, original preserved, history), thumbnail.
- Python: synthetic PDFs built inside the tests (text layer, vector lines, image-only scanned-style page, multi-scale page, S4.1-style number, rotated page); parsers; classification; the `scan_pdf` job against the real Postgres.
- No real client PDF in tests or git. The private fixture is used only for a local manual check, reported anonymized.

## Not in this phase
Crop regions and "Build" (Phase 3/4), scale from drawn dimensions, OCR, using PDF bookmarks or layer names as a data source (the real file has them; counted only, see open questions), authentication (editor name is a required field instead).
