#!/usr/bin/env bash
# Symlink this repo's Claude config into ~/.claude so the /dev-loop flow works on any
# machine. Idempotent — safe to re-run. Per-FILE symlinks, so your existing commands/
# skills/plugins in ~/.claude are left untouched.
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

link commands/dev-loop.md       commands/dev-loop.md
link commands/review-task.md    commands/review-task.md
link rubrics/per-task-review.md rubrics/per-task-review.md

echo
echo "Done. This machine also needs:"
echo "  - codex CLI on PATH + authed:   codex --version && codex login"
echo "  - git (worktree-capable checkout for the projects you loop on)"
echo
echo "Optional — re-create your plugin set from the tracked manifest:"
echo "  see installed_plugins.snapshot.json and install via /plugin in Claude Code."
