#!/usr/bin/env bash
# REACTIVATE the archived v2 DAG-orchestrator loop.
# Symlinks the archived v2 files back into ~/.claude so /plan-feature, /dev-loop,
# /phase-translate, /review-task work again. Idempotent. See ARCHIVE_NOTE.md for WHY
# this was shelved and the fix-list to apply before trusting it again.
#
# Usage: archive/dev-loop-v2/bootstrap.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # archive/dev-loop-v2
CLAUDE="${CLAUDE_HOME:-$HOME/.claude}"

link() { # link <here-relative-src> <claude-relative-dest>
  local src="$HERE/$1" dest="$CLAUDE/$2"
  [ -e "$src" ] || { echo "MISSING $src" >&2; return 1; }
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
  echo "linked  $dest  ->  $src"
}

link commands/dev-loop.md        commands/dev-loop.md
link commands/plan-feature.md    commands/plan-feature.md
link commands/phase-translate.md commands/phase-translate.md
link commands/review-task.md     commands/review-task.md
link rubrics/per-task-review.md  rubrics/per-task-review.md
link workflows/dev-loop.js       workflows/dev-loop.js
link templates/plan.md           templates/plan.md
link templates/progress.md       templates/progress.md

echo
echo "v2 loop reactivated. NOTE: read ARCHIVE_NOTE.md — the seam-bug fix-list was NOT"
echo "applied before archiving. Apply it before relying on this for interconnected features."
