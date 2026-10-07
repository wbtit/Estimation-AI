#!/usr/bin/env bash
# CI-ready secret scan. Exits non-zero if gitleaks finds anything.
#   ./scripts/run-gitleaks.sh                 scan all commits reachable from HEAD
#   ./scripts/run-gitleaks.sh origin/main..   scan only the commits in a range (e.g. a PR)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed. Run ./scripts/install-gitleaks.sh" >&2
  exit 1
fi

log_opts="${1:-HEAD}"
gitleaks git --redact --no-banner --log-opts="${log_opts}" .
