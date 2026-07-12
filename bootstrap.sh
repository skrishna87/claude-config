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
link agents/dev-loop-orchestrator.md  agents/dev-loop-orchestrator.md
link commands/review-task.md       commands/review-task.md
link rubrics/per-task-review.md    rubrics/per-task-review.md
link reference/seam-design.md      reference/seam-design.md
link reference/leanness.md         reference/leanness.md
link reference/security-review.md  reference/security-review.md
link reference/model-policy.md     reference/model-policy.md
link templates/plan.md             templates/plan.md
link templates/progress.md         templates/progress.md

# --- companion skills ---------------------------------------------------------------
link skills/flow-report            skills/flow-report

# --- helper CLIs (into ~/.local/bin, not ~/.claude) ----------------------------------
mkdir -p "$HOME/.local/bin"
ln -sfn "$REPO/bin/keepawake" "$HOME/.local/bin/keepawake"
echo "linked  $HOME/.local/bin/keepawake  ->  $REPO/bin/keepawake"

if ! command -v opencode >/dev/null 2>&1; then
  if command -v codex >/dev/null 2>&1; then
    echo "WARNING: opencode CLI not found — /review-task's cross-model reviewer (Reviewer B) will \
use the codex exec FALLBACK until opencode is installed + authed (openai/gpt-5.6-sol)." >&2
  else
    echo "WARNING: neither opencode nor codex CLI found — /review-task's cross-model reviewer \
(Reviewer B) will run DEGRADED (single-model) until one is installed + authed." >&2
  fi
fi

echo
echo "Active loop linked: /plan-feature (align→ground→spec→slice) + /dev-loop (orchestrator-per-task,"
echo "  via the dev-loop-orchestrator agent) + /review-task (cross-model + security + leanness gate)."
echo "Superseded drivers (manual /dev-loop + /dev-loop-auto) are ARCHIVED under archive/superseded-drivers/;"
echo "the v2 DAG-orchestrator loop is ARCHIVED under archive/dev-loop-v2/."
