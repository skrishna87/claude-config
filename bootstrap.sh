#!/usr/bin/env bash
# Symlink this repo's active Claude config into ~/.claude. Idempotent — safe to re-run.
# Per-FILE symlinks, so your existing commands/skills/plugins in ~/.claude are untouched.
#
# Usage: ./bootstrap.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${CLAUDE_HOME:-$HOME/.claude}"

link() { # link <repo-relative-src> <claude-relative-dest>
  local src="$REPO/$1" dest="$CLAUDE/$2"
  [ -e "$src" ] || { echo "MISSING $src" >&2; return 1; }
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
  echo "linked  $dest  ->  $src"
}

# --- active loop (resume-notes, rebuilt) -------------------------------------------
# NOTHING linked yet — the resume-notes loop is being rebuilt (see README.md).
# Add link lines here as the new commands land.

echo "No active loop files to link yet — resume-notes loop is under construction (see README.md)."
echo
echo "The previous DAG-orchestrator loop (v2) is ARCHIVED under archive/dev-loop-v2/."
echo "To reactivate it:  archive/dev-loop-v2/bootstrap.sh   (read its ARCHIVE_NOTE.md first)."
