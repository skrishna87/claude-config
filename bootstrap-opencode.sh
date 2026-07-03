#!/usr/bin/env bash
# Symlink this repo's opencode port into ~/.config/opencode. Idempotent.
#
# Installs:
#   commands/  — /plan-feature (staged planning), /dev-loop (flat driver), /review-task (locked gate)
#   agents/    — plan-gate + task-reviewer-cross (pinned cross-model; set `model:` to a
#                non-primary provider), task-implementer, task-reviewer, security-reviewer
#   skills/grounded-plan-feature — shared harness-neutral planner skill (same dir the Codex
#                port uses; opencode discovers Claude-style SKILL.md natively)
#   dev-loop/  — shared rubric + reference docs (leanness, security axes) the agents read
#
# Usage: ./bootstrap-opencode.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OC="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"

link() {
  local src="$1" dest="$2"
  [ -e "$src" ] || { echo "MISSING $src" >&2; return 1; }
  mkdir -p "$(dirname "$dest")"
  ln -sfn "$src" "$dest"
  echo "linked  $dest  ->  $src"
}

for cmd in plan-feature dev-loop review-task; do
  link "$REPO/opencode/commands/$cmd.md" "$OC/commands/$cmd.md"
done
for agent in plan-gate task-implementer task-implementer-lite task-reviewer task-reviewer-cross security-reviewer; do
  link "$REPO/opencode/agents/$agent.md" "$OC/agents/$agent.md"
done
link "$REPO/codex/skills/grounded-plan-feature" "$OC/skills/grounded-plan-feature"
link "$REPO/rubrics"   "$OC/dev-loop/rubrics"
link "$REPO/reference" "$OC/dev-loop/reference"

echo
echo "opencode port linked: /plan-feature + /dev-loop + /review-task, 5 agents, skill, rubric/reference."
echo "NOTE: plan-gate.md and task-reviewer-cross.md pin 'model:' — keep them on a provider that is"
echo "      NOT your opencode primary (list: opencode models; auth: opencode auth login)."
