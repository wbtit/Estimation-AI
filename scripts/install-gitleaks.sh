#!/usr/bin/env bash
# Installs a pinned gitleaks release into ~/.local/bin after verifying its SHA-256 checksum.
# Linux and macOS (x64/arm64). On Windows, use WSL2 or download the release zip manually.
set -euo pipefail

VERSION="8.21.2"
INSTALL_DIR="${HOME}/.local/bin"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tarball="gitleaks_${VERSION}_${os}_${arch}.tar.gz"
base="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

curl -fsSL "${base}/${tarball}" -o "${tmp}/${tarball}"
curl -fsSL "${base}/gitleaks_${VERSION}_checksums.txt" -o "${tmp}/checksums.txt"
(cd "${tmp}" && grep " ${tarball}\$" checksums.txt | sha256sum -c -)

tar -xzf "${tmp}/${tarball}" -C "${tmp}" gitleaks
mkdir -p "${INSTALL_DIR}"
install -m 0755 "${tmp}/gitleaks" "${INSTALL_DIR}/gitleaks"
"${INSTALL_DIR}/gitleaks" version
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "add ${INSTALL_DIR} to PATH so the pre-commit hook can find gitleaks" ;;
esac
