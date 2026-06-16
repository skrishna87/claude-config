---
description: Resumable, checkpoint-driven execution loop. Works a feature's plan task-by-task in an isolated worktree — subagent per task, locked dual review gate, commit-on-pass, checkpoint after each task. Survives /clear.
argument-hint: "<feature-name> to start/resume; omit to auto-detect the active feature"
---

# /dev-loop — checkpoint-driven execution loop

Drive a feature to completion across as many fresh sessions as it takes, never relying on
context compaction. The invariant at every task boundary (this is what makes `/clear`
always safe):

- **feature-branch commits** = approved tasks (each passed the review gate)
- **working tree** = the current task in flight (or clean)
- **`docs/<feature>/progress.md`** = the cursor (done / next / gotchas / how to resume)

**Prereq:** a plan exists at `docs/<feature>/plan.md` as a checklist. You write the
spec/plan FIRST (brainstorm → plan), save it under `docs/<feature>/`, *then* run this. If
`progress.md` is missing, create it from the plan (all items unchecked) using the template.

## 0. Orient (always first)
- Resolve `<feature>` from `$ARGUMENTS`, else auto-detect from `docs/*/progress.md` with
  unfinished items.
- Read `docs/<feature>/plan.md` + `docs/<feature>/progress.md`.
- Reconstruct state **from git, not memory**: `git -C <worktree> log --oneline
  <base>..HEAD` (approved tasks) and `git -C <worktree> status` (in flight). Cross-check
  against the checklist.

## 1. Ensure isolation (worktree + branch)
Per the mono-repo worktree rule, work in `.worktrees/<repo>/<branch>` at the **mono root**,
branched off the source branch.
- Resuming → use the existing worktree/branch (path is in progress.md).
- Creating → `git -C <subrepo> worktree add <mono-root>/.worktrees/<repo>/<branch> -b
  <branch> <source>`. Copy any gitignored `.env` into it; recreate `.venv`
  (`rm -rf .venv && uv sync`) if present. Record worktree path + base sha + source branch
  in progress.md.

## 2. Pick the next task
First unchecked item in the plan checklist. If a task was interrupted mid-flight
(uncommitted changes exist), finish + review THAT before picking a new one.

## 3. Implement (subagent per task)
Dispatch ONE fresh subagent to implement ONLY this task. Brief: the task text, the relevant
files/conventions from plan.md, and "leave changes in the working tree — do NOT stage or
commit; return a summary + the list of changed files." You coordinate and review; the
subagent does the edits, so your own context stays lean.

## 4. Review gate
Run the gate by following `~/.claude/commands/review-task.md` against the unstaged diff.
- **PASS** → step 5.
- **FAIL** → dispatch a fix subagent with the consolidated findings, then re-review.
  Bounded: up to 2 fix→review cycles. Still failing → STOP, update progress.md, surface
  the blockers to the user.

## 5. Commit + checkpoint (on pass)
- `git -C <worktree> add -A && git -C <worktree> commit -m "<task>: <one-line summary>"`
  (provisional, isolated in the worktree — nothing touches source yet).
- Tick the task's checkbox in `plan.md`.
- Rewrite `progress.md`: done list, next task, branch/base/worktree, new gotchas, how to
  resume. Keep it self-contained — a fresh session reads only this + plan.md.

## 6. Continue or yield
After each task decide:
- **Continue** to the next task if context is healthy and tasks are small.
- **Yield** if ≈3–4 tasks done since the last clear, a task touched many files, or context
  feels heavy. To yield: confirm progress.md is current, then tell the user verbatim —
  `Checkpoint saved — <feature> at task <n>/<m>. Run /clear, then /dev-loop <feature> to
  continue.` — and STOP.

Always finish the current task cleanly (review + commit + checkpoint) before yielding —
**never yield mid-task.**

## 7. Done
When every checklist item is checked: STOP. Summarize, show `git -C <worktree> log
--oneline <base>..HEAD`, and tell the user: do your final review / manual test; on your
confirmation I'll fast-forward `<branch>` onto `<source>` (and push if you want).
**Never FF or push without explicit confirmation.**

## Notes
- Checkpoint after EVERY task (cheap); `/clear` only OCCASIONALLY (expensive — it's the
  one thing that drops context). A `/clear` then costs at most one in-flight task.
- This loop owns the per-task review via review-task.md — do not pull in other reviewer
  plugins inside the loop.
- Provisional per-task commits live only in the isolated worktree; to reshape history
  before FF, `git reset --soft <base>` and recommit.
