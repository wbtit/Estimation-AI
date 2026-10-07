# Estimation-AI

Internal structural steel estimation platform (estimate stage). Scope, phases and the member
data contract are in [docs/SPEC.md](docs/SPEC.md); security rules in [docs/SECURITY.md](docs/SECURITY.md).

Current state: **Phase 2** (projects, PDF upload, page scan and sheet classification, scale override) on top of Phase 1 (contract, catalog, validator, BOM, Excel). Pricing is not implemented yet.

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
