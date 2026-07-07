#!/usr/bin/env bash
# Install the codex-OAuth → OpenAI-compatible localhost shim (go-chatmock) that lets
# Copilot CLI carry gpt-5.5 on the ChatGPT subscription (personal machines' gate leg).
# Reuses ~/.codex/auth.json — no separate login. See reference/model-policy.md § Bridge chain.
set -euo pipefail

SRC="${HOME}/.local/src/go-chatmock"
BIN="${HOME}/.local/bin/go-chatmock"
ENV_FILE="${HOME}/.claude/bridge-copilot.env"
# Pinned to the commit audited 2026-07-06 (outbound = chatgpt.com + auth/api.openai.com only,
# minimal deps). This code handles the ChatGPT OAuth tokens — NEVER float to origin/HEAD; to
# take an upstream update, re-audit the diff first, then move this pin deliberately.
CHATMOCK_COMMIT="8c278a51c5cd7c8d82e48958bdc89ce90e07ba98"

command -v go >/dev/null || { echo "ERROR: go toolchain required" >&2; exit 1; }
# The ChatGPT backend version-gates gpt-5.5 ("requires a newer version of Codex"): the shim
# must impersonate a current codex client. Pin its version constant to the installed codex CLI —
# rerun this script after a codex upgrade if the backend starts rejecting the model again.
CODEX_VER="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ -n "$CODEX_VER" ] || { echo "ERROR: codex CLI required (shim reuses its auth + client version)" >&2; exit 1; }
[ -f "${HOME}/.codex/auth.json" ] || { echo "ERROR: ~/.codex/auth.json missing — run 'codex login' first" >&2; exit 1; }

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC" && git -C "$SRC" remote add origin https://github.com/n0madic/go-chatmock
fi
git -C "$SRC" fetch -q --depth 1 origin "$CHATMOCK_COMMIT"
git -C "$SRC" checkout -q -f "$CHATMOCK_COMMIT"
sed -i -E "s/(CodexClientVersion\s*=\s*)\"[0-9.]+\"/\1\"${CODEX_VER}\"/" "$SRC/internal/config/codex_client.go"

mkdir -p "$(dirname "$BIN")"
(cd "$SRC" && go build -o "$BIN" .)
echo "installed: $BIN (impersonating codex ${CODEX_VER})"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# Machine-local (NOT synced): this machine's Copilot CLI gate leg rides the
# codex ChatGPT OAuth via the localhost chatmock shim, not a GitHub Copilot seat.
# Presence of this file = personal machine. Work laptop: no file → org seat.
export COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:8000/v1
export COPILOT_PROVIDER_TYPE=openai
export COPILOT_MODEL=gpt-5.5
EOF
  echo "wrote: $ENV_FILE (delete it on machines that should use a real Copilot seat)"
fi

"$BIN" info | head -8
