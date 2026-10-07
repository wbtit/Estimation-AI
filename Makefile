.PHONY: setup setup-ocr up down ps migrate api worker web schema seed-synthetic test test-api test-worker lint lint-api lint-worker lint-web gitleaks hooks glyph-sheets glyph-export glyph-import glyph-summary

# One-time install: Node deps (root, api, web), Python 3.12 venv via uv, git hooks.
setup: hooks
	npm ci
	npm --prefix api ci
	npm --prefix web ci
	cd worker && uv venv --python 3.12 --allow-existing .venv && uv pip sync --python .venv/bin/python requirements.txt

# Optional: the local OCR cross-check (docs/OCR_DEPENDENCY_REVIEW.md). Not needed for decoding.
setup-ocr:
	cd worker && uv pip sync --python .venv/bin/python requirements-ocr.txt

hooks:
	git config core.hooksPath .githooks

up:
	docker compose up -d --wait

down:
	docker compose down

ps:
	docker compose ps

migrate:
	npm run migrate

# Explicit entry points. Nothing starts a server or worker as an import side effect.
api:
	npm --prefix api run dev

worker:
	cd worker && .venv/bin/python -m src.main

web:
	npm --prefix web run dev

# Regenerate schema/contract.v0.schema.json from the Zod contract.
schema:
	npm --prefix api run schema:generate

# Load the synthetic demo project and TEST-xxx catalog (made-up data) into the local DB.
seed-synthetic:
	npm --prefix api run seed:synthetic

# Tests need the database: run `make up` and `make migrate` first.
test: test-api test-worker

test-api:
	npm --prefix api test

test-worker:
	cd worker && .venv/bin/pytest

lint: lint-api lint-worker lint-web

lint-api:
	npm --prefix api run lint
	npx --prefix api prettier --check api/src

lint-worker:
	cd worker && .venv/bin/ruff check . && .venv/bin/ruff format --check .

lint-web:
	npm --prefix web run typecheck

gitleaks:
	./scripts/run-gitleaks.sh

# Glyph library review (Phase 4b). FONT=<font id>; files go to the git-ignored fixtures/private/.
FONT ?= default
glyph-sheets:
	cd worker && .venv/bin/python -m src.text_reader.cli contact-sheets --font-id $(FONT) --out ../fixtures/private/glyph_sheets

glyph-export:
	cd worker && .venv/bin/python -m src.text_reader.cli export-csv --font-id $(FONT) --out ../fixtures/private/glyph_review.csv

# REVIEWER=<your name>; add DRY=--dry-run to check the file without changing anything.
glyph-import:
	cd worker && .venv/bin/python -m src.text_reader.cli import-csv --file ../fixtures/private/glyph_review.csv --reviewer "$(REVIEWER)" $(DRY)

glyph-summary:
	cd worker && .venv/bin/python -m src.text_reader.cli summary --font-id $(FONT)

