# Estimation-AI

Internal structural steel estimation platform (estimate stage). Scope, phases and the member
data contract are in [docs/SPEC.md](docs/SPEC.md); security rules in [docs/SECURITY.md](docs/SECURITY.md).

Current state: **Phase 0 skeleton** (infrastructure only, no features).

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
