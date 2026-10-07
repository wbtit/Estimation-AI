# Security

## Rules
- No secrets in git. Only `.env.example` (placeholder values such as `change_me`) is committed; `.env` is gitignored.
- No client drawings or real project data in git. Drawings live outside the repo or under `fixtures/` as gitignored PDFs. Use anonymized ids (`project-001`, `job-001`); never client or project names in code, fixtures, comments or tests.
- No third-party API calls with drawing content.
- Local services bind to 127.0.0.1 only (docker compose ports, API default host).

## Secret scanning (gitleaks)
Config: `.gitleaks.toml` = gitleaks default rules + a rule for passwords embedded in database or
broker connection URLs (the `user:password@host` part), which the defaults miss. Only the
`change_me` placeholder is allowlisted.

### Install (Linux / macOS)
```bash
./scripts/install-gitleaks.sh      # pinned v8.21.2, SHA-256 verified, installs to ~/.local/bin
gitleaks version                   # ~/.local/bin must be on PATH
```
Windows: use WSL2 and the same commands, or download the release zip from
https://github.com/gitleaks/gitleaks/releases, verify it against the release `checksums.txt`, and put `gitleaks.exe` on PATH.

### Pre-commit hook
```bash
make hooks                         # = git config core.hooksPath .githooks
```
Every `git commit` then runs `gitleaks git --pre-commit --staged`. A finding blocks the commit, and so does a missing gitleaks binary.

### CI / manual scan
```bash
./scripts/run-gitleaks.sh                  # all commits reachable from HEAD
./scripts/run-gitleaks.sh origin/main..    # only the commits in a range (e.g. a PR)
```
Exits non-zero on any finding. Output is redacted.

## If a secret is committed
Rotate it first (it must be treated as exposed once pushed), then remove it from history or record the decision in the SPEC Decision Log.
