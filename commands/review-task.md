---
description: Locked dual-model review gate (Claude self + codex) over the current task's diff. The ONLY per-task reviewer /dev-loop uses.
argument-hint: "[optional: repo/worktree path or scope note]"
---

# /review-task — locked dual-model review gate

The single, consistent review step. **Ignore every other reviewer plugin/skill here**
(pr-review-toolkit, feature-dev:code-reviewer, `/code-review`, code-simplifier, …) —
this gate is deliberately locked so results are reproducible across tasks and sessions.
Two independent reviewers judge the SAME diff by the SAME rubric; you consolidate.

## 1. Establish scope + repo
- **Scope** = the current task = the **unstaged** working-tree changes (prior approved
  tasks are already committed, so they're out of scope automatically).
- Find the **git repo dir** holding the changes — the dir with a `.git`. In a mono-style
  repo this is the sub-repo / worktree, **NEVER the mono root** (`/home/you/projects`
  is not a git repo — running codex there is what caused the past "no git" failure).
  Call it `$REPO`.
- Capture the diff: `git -C "$REPO" diff` (unstaged). If empty, try `--staged`. If still
  empty, there's nothing to review — say so and stop.
- `$ARGUMENTS` may override `$REPO` or the scope.

## 2. Load the rubric
Read `~/.claude/rubrics/per-task-review.md`. Both reviewers get it verbatim.

## 3. Run both reviewers (in parallel)
**Reviewer A — Claude (self):** dispatch a `general-purpose` subagent with the rubric,
the task description + plan reference, and the diff. Tell it to read neighboring code in
`$REPO` for context but to judge only the diff. Hand it crafted context — **not** your
session history. Require the rubric's output format ending in `VERDICT: PASS/FAIL`.

**Reviewer B — codex (cross-model):**
```bash
codex exec -C "$REPO" -s read-only -o /tmp/codex-review.md \
  "$(cat ~/.claude/rubrics/per-task-review.md)

Run 'git diff' to see the UNCOMMITTED changes and review ONLY those."
```
Then read `/tmp/codex-review.md`.
- `-C "$REPO"` points codex at the real git dir — the fix for the past failure.
  `-s read-only` lets it introspect surrounding code without writing.
- If codex errors on git, retry once adding `--skip-git-repo-check`.
- If codex is unavailable/unauthed, proceed with Reviewer A alone but **explicitly flag
  that coverage was single-model** — never silently drop a reviewer.

## 4. Consolidate
- Merge both lists; dedupe findings that are the same `file:line` / issue.
- Where the reviewers **disagree** (one flags, the other doesn't), investigate the
  flagged item yourself and decide — disagreements are where blind spots hide, so don't
  average them away.
- Assign final severity per the rubric.

## 5. Verdict
Emit a compact block:
```
REVIEW: <feature> / <task>
  Claude: <Crit/Imp/Min>   codex: <Crit/Imp/Min>
  Blocking: <Critical+Important findings with file:line, or "none">
  VERDICT: PASS | FAIL
```
**PASS** = zero unresolved Critical or Important. Minor issues are noted, not blocking.
