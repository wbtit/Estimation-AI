.PHONY: setup up down ps migrate api worker web test test-api test-worker lint lint-api lint-worker lint-web gitleaks hooks

# One-time install: Node deps (root, api, web), Python 3.12 venv via uv, git hooks.
setup: hooks
	npm ci
	npm --prefix api ci
	npm --prefix web ci
	cd worker && uv venv --python 3.12 --allow-existing .venv && uv pip sync --python .venv/bin/python requirements.txt

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
