# Estimation-AI

Internal structural steel estimation platform (estimate stage). Scope, phases and the member
data contract are in [docs/SPEC.md](docs/SPEC.md); security rules in [docs/SECURITY.md](docs/SECURITY.md).

Current state: **Phase 6a, v1 Stage 1** (upload a PDF, the system marks counted members with a tag, colour by confidence, kinds, tables and an Excel export; lengths, weights and pricing come later; see the section "Try Stage 1" below). Older phases:
**Phase 4b** (deterministic reader for text outlined into stroked paths, glyph library, optional OCR cross-check) on top of Phase 2 (projects, PDF upload, page scan and sheet classification, scale override) and Phase 1 (contract, catalog, validator, BOM, Excel). Pricing is not implemented yet.

## Layout
| Path | Contents |
|---|---|
| `api/` | Node 20+ / TypeScript / Fastify 5 API (Kysely + pg). Entry point: `src/server.ts` |
| `worker/` | Python 3.12 worker (uv venv, pinned `requirements.txt`). Entry point: `python -m src.main` |
| `web/` | React + TypeScript + Vite placeholder |
| `db/migrations/` | Numbered plain-SQL migrations, applied by `db/migrate.ts` |
| `fixtures/` | Test inputs only; drawings are never committed |
| `scripts/`, `.githooks/` | gitleaks install/scan scripts and pre-commit hook |

Node and Python talk through the Postgres `jobs` table (workers claim rows with
`FOR UPDATE SKIP LOCKED`). Redis is in compose for later Node-side use.

## Prerequisites (Linux)
Docker with the compose plugin, Node 20+, [uv](https://docs.astral.sh/uv/), make, gitleaks
(`./scripts/install-gitleaks.sh`). On Windows, use WSL2 and the same commands.

## Quick start
```bash
cp .env.example .env        # then replace every change_me value
make setup                  # npm ci (root, api, web), Python 3.12 venv via uv, git hooks
make up                     # Postgres 16 + Redis 7, waits until healthy
make migrate                # applies db/migrations/*.sql
make api                    # API on http://127.0.0.1:3000 ; in another shell:
curl http://127.0.0.1:3000/health
make test                   # API (vitest) + worker (pytest); needs `make up` + `make migrate`
make lint                   # eslint + tsc + prettier, ruff check + format, web typecheck
make gitleaks               # secret scan over git history
make down
```
Other targets: `make worker` (start the Python worker), `make web` (Vite dev server), `make ps`.

Ports: Postgres `127.0.0.1:5432`, Redis `127.0.0.1:6380` (6380 avoids a host Redis on 6379),
API `127.0.0.1:3000`, web `5173`.

## Phase 1 commands
```bash
make migrate
make seed-synthetic      # loads SYNTHETIC data only: project "synthetic-001" (14 made-up members) + TEST-xxx catalog
make api                 # then, using the project id the seed printed:
curl "http://127.0.0.1:3000/api/projects/<project-id>/bom?edition=TEST-EDITION"
curl -o bom.xlsx "http://127.0.0.1:3000/api/projects/<project-id>/bom.xlsx?edition=TEST-EDITION"
make schema              # regenerate schema/contract.v0.schema.json after changing the contract
```
Import the real AISC file (path supplied by you; columns and weight unit are explicit, nothing is guessed):
```bash
npm --prefix api run catalog:import -- --file <path.csv|xlsx> --edition "<label>" \
  --name-col "<name header>" --weight-col "<weight header>" --weight-unit lb/ft   # or kg/m
```
The whole file is refused if any row has a weight that is not > 0, an empty or duplicate name. Editions are immutable.
Design notes and open assumptions: [docs/PHASE1_PLAN.md](docs/PHASE1_PLAN.md), [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md).

## Phase 2 commands
```bash
make migrate                 # applies 002_phase2_scan.sql
make api                     # shell 1
make worker                  # shell 2: runs the scan_pdf job
curl -X POST http://127.0.0.1:3000/api/projects -H 'content-type: application/json' -d '{"name":"my project"}'
curl -X POST http://127.0.0.1:3000/api/projects/<id>/pdf -F file=@drawings.pdf     # one PDF per project, max 500 MB
curl http://127.0.0.1:3000/api/projects/<id>                  # status: created -> scanning -> scanned | scan_failed
curl http://127.0.0.1:3000/api/projects/<id>/sheets            # one entry per page
curl -o page1.png http://127.0.0.1:3000/api/projects/<id>/sheets/<sheet-id>/thumbnail
curl -X PATCH http://127.0.0.1:3000/api/projects/<id>/sheets/<sheet-id>/scale-override \
  -H 'content-type: application/json' -d '{"scale":"1:96","editor":"your name","reason":"why"}'
# scale accepts 1/8" = 1'-0", 1" = 20', 1:96, NTS; null clears the override (history is kept)
```
Uploads and thumbnails go under `uploads/` (git-ignored). Real client drawings for local checks go in `fixtures/private/` (git-ignored, never committed; use anonymized names such as `job-001.pdf`). The scan reads vector PDFs only: it does not OCR, so a drawing whose text is outlined as curves (no text layer) gets null sheet number, title and scale plus review flags. Design and open assumptions: [docs/PHASE2_PLAN.md](docs/PHASE2_PLAN.md), [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md).

## Phase 4b commands (text reader and glyph library)
```bash
make migrate                                   # applies 003_glyph_library_text_items.sql
make api ; make worker                         # two shells
curl -X POST http://127.0.0.1:3000/api/projects/<id>/read-text -H 'content-type: application/json' -d '{"font_id":"cad-font-1"}'
curl http://127.0.0.1:3000/api/projects/<id>/sheets/<sheet-id>/text-items            # ?needs_review=true to filter
# the first read finds no confirmed glyph labels, so every letter is "?" and every shape becomes a proposed group:
make glyph-sheets FONT=cad-font-1              # PNG contact sheets of unlabeled groups -> fixtures/private/glyph_sheets/
make glyph-export FONT=cad-font-1              # review CSV -> fixtures/private/glyph_review.csv (OCR proposals pre-filled)
# edit the CSV: set status to "confirmed" (and fix the label) for groups you have checked, then:
make glyph-import REVIEWER="your name" DRY=--dry-run        # check first; drop DRY to apply
```
Only `confirmed` labels decode text; unknown shapes stay `?` and are counted. Optional OCR cross-check (off by default, local, no network): `make setup-ocr`, set `OCR_CROSSCHECK_ENABLED=true`, and `python -m src.text_reader.cli vote --pdf <file> --font-id <id>` to propose labels by majority vote. Accuracy against your own ground truth (private): `python -m src.text_reader.cli truth-template --pdf <file>`, fill `truth_text` in `fixtures/private/ground_truth_text.csv`, then `python -m src.text_reader.cli evaluate --pdf <file> --font-id <id>`. Details: [docs/PHASE4B_PLAN.md](docs/PHASE4B_PLAN.md), [docs/OCR_DEPENDENCY_REVIEW.md](docs/OCR_DEPENDENCY_REVIEW.md), [docs/SCHEMA_CHANGE_PROPOSAL.md](docs/SCHEMA_CHANGE_PROPOSAL.md) (awaiting your approval).

Review helpers: `contact-sheets --no-guess --limit 200` (shape only), `revoke-labels --who NAME --dry-run` (undo one reviewer's labels), `truth-accept` (copy reviewed `draft_text` / typed `correction` into `truth_text`; the report says `draft source: AI, verified by human`).

## Phase 4d (PDF text-layer reader and parsers)
`read_text` now reads a page from its PDF text layer when it has a usable one (`pdf_text` items with word and line boxes, angle and parser output in `parsed`) and uses the glyph reader for every other vector page; the reader used is stored per sheet (`text_source`). Optional payload field `catalog_edition` selects the catalog edition used to validate profile strings (a single loaded edition is used automatically; without one profiles are `unvalidated`). Migration 004 adds the nullable columns. Private tools, counts only: `worker/tools/text_coverage.py` (coverage of the parsers on your own PDFs; see `docs/PHASE4D_COVERAGE.md`), `worker/tools/text_survey.py`, `worker/tools/pdf_inventory.py`. Details and decisions: `docs/PHASE4D_PLAN.md`.


## Try Stage 1 (Phase 6a)
Needs the database and Redis (`make up`, `make migrate`) and the AISC shapes file loaded once
(`npm --prefix api run catalog:import -- --file <aisc xlsx> --edition aisc-v16.0 --sheet "Database v16.0" --name-col "AISC_Manual_Label#1" --weight-col "W#1" --weight-unit lb/ft --family-col Type`; the file stays where it is, nothing is committed).
Three terminals:
```bash
make api      # http://127.0.0.1:3000   (stop any older API on that port first)
make worker   # runs the scan and the automatic pipeline
make web      # http://127.0.0.1:5173
```
Open http://127.0.0.1:5173, type your name, press **Upload a PDF** and choose an estimation PDF (or pick a job that is already uploaded). The page list, symbols, tables and the Excel export fill in by themselves; the bar under the title says "draft, N sheets unconfirmed" until you confirm. Tables and Excel: tab "tables", link "Export Excel". Optional: load the owner's tag abbreviations with `npm --prefix api run kinds:load-abbreviations -- --file <csv with kind,abbreviation>`.
