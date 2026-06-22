---
description: Locked review gate — cross-model rubric review (Claude self + codex) plus a leanness pass, over a task's diff or a whole feature. The ONLY reviewer /dev-loop uses.
argument-hint: "[repo/worktree path] [--integration <base-ref> for a whole-feature review]"
---

# /review-task — locked review gate

The single, consistent review step. **Ignore every other reviewer plugin/skill here**
(pr-review-toolkit, feature-dev:code-reviewer, `/code-review`, code-simplifier, …) — this gate
is deliberately locked so results are reproducible across tasks and sessions. Independent
reviewers judge the SAME diff by the SAME rubric; you consolidate.

## 1. Establish scope + repo

- **Find the git repo dir** holding the changes — the dir with a `.git`. In a mono-style repo
  this is the sub-repo / worktree, **NEVER the mono root** (running codex at a non-git root is
  what caused the past "no git" failure). Call it `$REPO`.
- **Scope** depends on the fixed-point:
  - **Per-task (default)** — the current task = the **unstaged** working-tree changes (prior
    approved tasks are already committed, so out of scope automatically).
    Diff: `git -C "$REPO" diff` (if empty, try `--staged`; if still empty, nothing to review —
    say so and stop).
  - **Integration (`--integration <base>`)** — the **whole feature** so far, to catch
    cross-task contract drift and composition bugs no single task diff shows.
    Diff: `git -C "$REPO" diff <base>...HEAD` (three-dot, against the merge-base).
- `$ARGUMENTS` may override `$REPO` or pass `--integration <base>`.
- **Make the plan readable INSIDE `$REPO` (the context mirror).** The plan/progress usually live at
  the mono root (`docs/<feature>/{plan,progress}.md`), which a reviewer running `-C "$REPO"` — and
  **especially codex in its read-only sandbox** — cannot reach. Mirror them into the worktree
  (git-excluded, refreshed NOW so they're never stale), and point every reviewer at the local copy:
  ```bash
  mkdir -p "$REPO/.dev-loop"
  # exclude it once so `git add -A` never stages it (per-repo, untracked — no tracked .gitignore change):
  EXCL="$(git -C "$REPO" rev-parse --git-common-dir)/info/exclude"   # abs for a linked worktree
  grep -qxF '.dev-loop/' "$EXCL" 2>/dev/null || echo '.dev-loop/' >> "$EXCL"
  cp "<abs>/docs/<feature>/plan.md"     "$REPO/.dev-loop/plan.md"
  cp "<abs>/docs/<feature>/progress.md" "$REPO/.dev-loop/progress.md"
  ```
  Now `$REPO/.dev-loop/{plan.md,progress.md}` carries the feature-level context every reviewer needs.

## 2. Load the rubric + plan

- Read `~/.claude/rubrics/per-task-review.md` — every reviewer gets it verbatim.
- Read `$REPO/.dev-loop/plan.md` (the worktree-local mirror from §1) — the seam map + the task's
  acceptance criteria + MUST-NOTs. Reviewers need it for the plan-conformance and composition/
  twin-path checks — **a gate that can't see the plan is judging the diff against the rubric alone
  and cannot catch a plan violation or contract drift.** (`progress.md` is alongside it for the
  prior-task Done log — useful context for the integration review especially.)

## 3. Run the reviewers (in parallel)

**Reviewer A — Claude (self):** dispatch a `general-purpose` subagent with the rubric, the diff,
and the worktree-local plan at `$REPO/.dev-loop/plan.md` (tell it to READ that file for the seam
map + acceptance + MUST-NOTs). Tell it to read neighboring code and the joined flows in `$REPO`
for context — and, in `--integration` mode, to actively trace cross-task and cross-repo contracts.
Hand it crafted context — **not** your session history. Require the rubric's output format ending
in `VERDICT: PASS/FAIL`.

**Reviewer B — codex (cross-model):**
```bash
codex exec -C "$REPO" -s read-only -o /tmp/codex-review.md \
  "$(cat ~/.claude/rubrics/per-task-review.md)

Run 'git diff' (or 'git diff <base>...HEAD' for an integration review) to see the changes and
review ONLY those, against the plan at .dev-loop/plan.md (read it — it holds the acceptance
criteria, seam map, and MUST-NOTs for this work). Trace how they compose with the flows they join
and check twin-path symmetry."
```
Then read `/tmp/codex-review.md`.
- The `.dev-loop/plan.md` path is the worktree-local mirror from §1 — codex `-C "$REPO"` can read
  it where it could not read the mono-root `docs/<feature>/plan.md`.
- `-C "$REPO"` points codex at the real git dir; `-s read-only` lets it introspect without writing.
- If codex errors on git, retry once adding `--skip-git-repo-check`.
- If codex is unavailable/unauthed, proceed with Reviewer A alone but **explicitly flag that
  coverage was single-model** — never silently drop the cross-model reviewer.

**Reviewer C — leanness (advisory):** a `general-purpose` subagent with
`~/.claude/reference/leanness.md` and the diff. Over-engineering only — `delete/stdlib/native/
yagni/shrink`, ending `net: -N lines possible` or `Lean already. Ship.` This axis is advisory.

## 4. Consolidate

- Group findings by rubric section (so a passing section never masks a failing one). Keep
  Claude's and codex's lists visible side by side — do not average them.
- Where the two reviewers **disagree** (one flags, the other doesn't), investigate the flagged
  item yourself and decide — disagreements are where blind spots hide.
- Assign final severity per the rubric. Leanness findings stay in their own advisory block
  (non-blocking unless the over-engineering is egregious).

## 5. Verdict

```
REVIEW: <feature> / <task|INTEGRATION since base>
  Claude: <Crit/Imp/Min>   codex: <Crit/Imp/Min>   [single-model if codex unavailable]
  Blocking: <Critical+Important findings with file:line, grouped by section, or "none">
  Leanness (advisory): <net: -N lines possible | Lean already>
  VERDICT: PASS | FAIL
```
**PASS** = zero unresolved Critical or Important. Minor + leanness issues are noted, not blocking.
