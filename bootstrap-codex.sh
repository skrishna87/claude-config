#!/usr/bin/env bash
# Symlink this repo's Codex skills into ~/.codex. Idempotent and per-skill.
#
# Usage: ./bootstrap-codex.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX="${CODEX_HOME:-$HOME/.codex}"

link_skill() {
  local name="$1"
  local src="$REPO/codex/skills/$name"
  local dest="$CODEX/skills/$name"
  [ -e "$src/SKILL.md" ] || { echo "MISSING $src/SKILL.md" >&2; return 1; }
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
  echo "linked  $dest  ->  $src"
}

link_skill grounded-plan-feature

echo
echo "Codex skill linked: grounded-plan-feature."
