#!/usr/bin/env bash
set -euo pipefail
# Download official binary as data; no remote script execution. Requires root on deployment VM.
INSTALL_ROOT="${PRAXIS_OLLAMA_INSTALL_ROOT:-/usr/local}"
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo 'Unsupported architecture'; exit 1;; esac
command -v zstd >/dev/null || { echo 'Install zstd first'; exit 1; }
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fL --retry 3 --max-time 900 "https://ollama.com/download/ollama-linux-${ARCH}.tar.zst" -o "$TMP_DIR/ollama.tar.zst"
sha256sum "$TMP_DIR/ollama.tar.zst"
mkdir -p "$INSTALL_ROOT"
tar --zstd -xf "$TMP_DIR/ollama.tar.zst" -C "$INSTALL_ROOT"
if [ "$INSTALL_ROOT" = /usr/local ]; then
 id ollama >/dev/null 2>&1 || useradd --system --home /var/lib/ollama --create-home --shell /usr/sbin/nologin ollama
 install -d -o ollama -g ollama -m 700 /var/lib/ollama/models
 install -m 644 "$(dirname "$0")/ollama.service" /etc/systemd/system/ollama.service
 systemctl daemon-reload
 systemctl enable --now ollama
fi
"$INSTALL_ROOT/bin/ollama" pull qwen3:1.7b
curl -fsS --max-time 5 http://127.0.0.1:11434/api/tags
