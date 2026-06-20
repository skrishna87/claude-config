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
link commands/plan-feature.md   commands/plan-feature.md
link commands/phase-translate.md commands/phase-translate.md
link commands/review-task.md    commands/review-task.md
link rubrics/per-task-review.md rubrics/per-task-review.md
link workflows/dev-loop.js      workflows/dev-loop.js
link templates/plan.md          templates/plan.md
link templates/progress.md      templates/progress.md

echo
echo "Done. This machine also needs:"
echo "  - a Workflow-capable Claude Code (the Workflow tool) — runs the background orchestrator"
echo "  - git (worktree-capable checkout for the projects you loop on)"
echo "  - OPTIONAL: codex CLI on PATH + authed (codex --version && codex login)."
echo "      The review gate hardens against codex being down: it preflights, and on failure"
echo "      falls back to a divergent-persona Claude reviewer (coverage is flagged DEGRADED)."
echo
echo "Optional — re-create your plugin set from the tracked manifest:"
echo "  see installed_plugins.snapshot.json and install via /plugin in Claude Code."
