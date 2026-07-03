---
description: Checkpoint-driven execution loop over a grounded plan.md. Flat driver — this session orchestrates directly, spawning a fresh implementer subagent per task and the locked cross-model review gate before every commit. Survives session resets via the on-disk cursor.
---

# /dev-loop — checkpoint-driven execution loop (opencode port, flat driver)

Execute `docs/<feature>/plan.md` task-by-task. This port is **flat**: the loop and the
per-task orchestration live in THIS session (opencode doesn't guarantee nested subagent
spawning, so there is no orchestrator layer). You spawn the workers directly:

```
this session: orient → ensure worktree → per task:
    task-implementer (fresh context) → implement + verify → IMPLEMENT RESULT
    locked gate (/review-task): task-reviewer ∥ task-reviewer-cross → you consolidate
    FAIL → snapshot diff → fix (task-implementer) → scoped re-gate     (≤2 cycles)
    PASS → ONE commit: tick plan + rewrite progress + push
all tasks checked → full suite → integration gate (+ security-reviewer) → (user OK) FF-merge
```

**The invariant** at every task boundary: `branch commits = approved tasks` · `working tree =
in-flight task` · `progress.md = cursor`. A session reset costs at most the in-flight task —
relaunch `/dev-loop` and it re-orients from disk.

**Context discipline:** hand every subagent a crafted brief (paths + task + seam map text),
never session history. Between tasks keep only result blocks; don't re-read whole diffs.

**Prereq:** a grounded `docs/<feature>/plan.md` from `/plan-feature`. Missing `progress.md` →
seed from `~/.config/opencode/skills/grounded-plan-feature/assets/progress.md`.

## 0. Orient

- Resolve `<feature>` from `$ARGUMENTS`, else auto-detect from `docs/*/progress.md` with
  unfinished items. **If more than one matches, list them and ask which — never guess.**
- Read `docs/<feature>/plan.md` + `docs/<feature>/progress.md`.
- Reconstruct from git, not memory: `git -C <worktree> log --oneline <base>..HEAD` +
  `git -C <worktree> status`. If a task is mid-flight (uncommitted changes), finish/gate THAT
  one before any new task.

## 1. Ensure isolation (worktree + branch)

Work in `.worktrees/<repo>/<branch>` at the mono root, branched off source. Resuming → reuse
the recorded worktree/branch. Creating → `git -C <subrepo> worktree add
<mono-root>/.worktrees/<repo>/<branch> -b <branch> <source>`; copy gitignored `.env`; recreate
`.venv` (`rm -rf .venv && uv sync`) if present; record worktree path + base sha + source in
progress.md. **Publish the branch**: `git -C <worktree> push -u <remote> <branch>` when the
sub-repo has a remote (record `Published: <remote>/<branch>` in progress.md; no remote →
`Published: no`, skip pushes later).

## 2. Brief (once)

From `plan.md`, extract the **Seam map** and **Locked decisions** text. Note the absolute
`worktree`, `planPath`, `progressPath`, `baseSha`, `source`, and the fixed reference paths:
`rubricPath=~/.config/opencode/dev-loop/rubrics/per-task-review.md`,
`leannessPath=~/.config/opencode/dev-loop/reference/leanness.md`,
`policyPath=~/.config/opencode/dev-loop/reference/model-policy.md`,
`gatePath=~/.config/opencode/commands/review-task.md` (read it once now — it is the locked
gate procedure you follow at every gate below).

## 3. Loop: one task at a time

Repeat until the plan has no unchecked tasks (or a task goes BLOCKED):

1. **Implement.** Pick the implementer by the task's tier tag (`[S|M|L]` on its plan line;
   untagged = M) per `policyPath`: **S/M → `task-implementer-lite`** (budget model), **L →
   `task-implementer`** (session model). Spawn it with the brief plus: the first unchecked
   task's full text + acceptance criteria, and *"implement exactly this ONE task, leave
   changes unstaged, return your IMPLEMENT RESULT block."* Read the result:
   - `verify: FAIL` → BLOCKED (the implementer already spent its 2 attempts). Stop per rule 4.
   - `verify: NONE` → record it; if it's NONE on every task, surface that loudly at the end —
     the feature is shipping on review alone.
2. **Gate.** Follow `gatePath` (per-task scope, the unstaged diff): spawn `task-reviewer` and
   `task-reviewer-cross` in parallel with crafted briefs, consolidate, produce the verdict. If
   the cross provider is down → proceed but record `coverage: DEGRADED`, report loudly at end.
3. **FAIL → fix loop (≤2 cycles).**
   - Snapshot first: `mkdir -p <worktree>/.dev-loop`, git-exclude it once
     (`EXCL="$(git -C <worktree> rev-parse --git-common-dir)/info/exclude"; grep -qxF
     '.dev-loop/' "$EXCL" || echo '.dev-loop/' >> "$EXCL"`), then
     `git -C <worktree> diff > <worktree>/.dev-loop/review-cycle-<n>.diff`.
   - Spawn the implementer in fix mode with ONLY the blocking findings; it re-runs verify.
     Same variant as the implement pass — **except** per the policy's escalation rule: a cycle
     caused by `design` or `semantics` on a lite-implemented task gets its fix from
     `task-implementer` (session model); note the escalation.
   - Re-gate **scoped** (`--re-review` per `gatePath`): pass the prior blocking findings + the
     snapshot path to both reviewers. Still FAIL after 2 cycles → BLOCKED.
   - Classify each cycle's cause (`missing-test | semantics | design | style`) and append a
     one-line `Gate lesson (task <n>):` to progress.md Gotchas — subagents are fresh-context,
     so this line is the only way the next task's implementer inherits it.
4. **PASS → commit + checkpoint + push.** In ONE commit on the feature branch: tick the task's
   checkbox in plan.md, rewrite progress.md (approved count, `In flight: none`, next task, new
   gotchas, resume line `Run /dev-loop <feature>`), then `git -C <worktree> add -A && git -C
   <worktree> commit -m "<task>: <summary>"`, and push if published (push failure = note,
   never a blocker; never force). Keep a running `task N: cycles=X (cause)` list.
5. **BLOCKED → STOP.** Surface what blocked, show `git -C <worktree> log --oneline
   <base>..HEAD`, note the working tree holds the in-flight task. The user fixes/re-plans,
   then relaunches `/dev-loop`. Never continue past a block — later tasks likely depend on it.

## 4. Integration review + hand off

When every task is checked:

- **Run the FULL suite in the worktree first** (the plan's Verify commands) — red = FAIL
  before any reviewer spends a token.
- Follow `gatePath` with `--integration <base>`: both rubric reviewers over
  `git diff <base>...HEAD` **plus `security-reviewer`** (the whole-surface security axis runs
  here, not per task). Consolidate to one verdict.
- **FAIL** → seams don't hold. Surface the blockers, add fix tasks to plan.md (unchecked),
  keep looping (back to §3). Do NOT offer to merge.
- **PASS** → STOP. Summarize (include cycle totals and any recurring cycle-cause — a repeated
  cause is a systematic implementer gap, not noise; also any DEGRADED coverage or verify:
  NONE). Show the log and tell the user: do your final review / manual test; on your
  confirmation fast-forward `<branch>` onto `<source>` (and push if wanted). **Never FF or
  push without explicit confirmation.**
- **After the confirmed FF** — ask about cleanup (never do it unprompted): remove the
  worktree, delete the branch local + remote, mark progress.md shipped. Do exactly what the
  user picks.

## Notes

- **Locked gate**: only `/review-task` + the shared rubric — no other reviewer tool — so
  results are reproducible across tasks and sessions.
- **Provisional commits** live in the worktree; reshape with `git reset --soft <base>` before
  FF. Nothing touches `<source>` until the user confirms.
