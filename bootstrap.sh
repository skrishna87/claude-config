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

# --- active loop (resume-notes + planner + multi-axis gate) ------------------------
link commands/plan-feature.md      commands/plan-feature.md
link commands/dev-loop.md          commands/dev-loop.md
link commands/review-task.md       commands/review-task.md
link rubrics/per-task-review.md    rubrics/per-task-review.md
link reference/seam-design.md      reference/seam-design.md
link reference/leanness.md         reference/leanness.md
link templates/plan.md             templates/plan.md
link templates/progress.md         templates/progress.md

echo
echo "Active loop linked: /plan-feature (align→ground→spec→slice) + /dev-loop + /review-task."
echo "The previous DAG-orchestrator loop (v2) is ARCHIVED under archive/dev-loop-v2/."
