---
description: The checkpoint-driven execution loop. The main thread loops, spawning a fresh dev-loop-orchestrator AGENT per task; each orchestrator takes one task to done (implement → locked review gate → commit + checkpoint) via its own subagents and returns. Works a grounded plan.md task-by-task in an isolated worktree; survives /clear.
argument-hint: "<feature-name> to start/resume; omit to auto-detect the active feature"
---

# /dev-loop — checkpoint-driven execution loop (orchestrator-per-task)

The execution loop over a grounded `plan.md` + `progress.md`. The loop lives in the **main thread**,
and each task is handled by a freshly spawned **`dev-loop-orchestrator` agent** that does the task
via its own subagents and returns:

```
main driver (this thread): orient → ensure worktree → LOOP:
    └─ Agent(dev-loop-orchestrator)   ← one task: implement → gate(≤2 fix) → commit + checkpoint
         └─ (its own subagents: implement / review / fix)        → returns ORCHESTRATOR RESULT
    read result → APPROVED & tasks remain? loop again : stop
  all tasks checked → integration review → (on your OK) FF-merge
```

**Context model:** the main thread only spawns + reads a one-line result per task, so the
review-heavy work lives in each per-task orchestrator's context, not here. The main thread still
accumulates one summary per task (not zero) and can't `/clear` itself — so for a very large feature
you may hit a context ceiling: `/clear` and relaunch (the checkpoint is on disk every task, so you
lose at most the in-flight task). If you ever need a truly zero-context driver — a huge feature, a
hard quota cap, or a harness that disables nesting — the previous JS-Workflow driver (`/dev-loop-auto`)
and the manual driver are archived and restorable under `archive/superseded-drivers/`.

> **Harness dependency:** this variant relies on **nested `Agent` calls** (the orchestrator agent
> spawning its own subagents). If your harness disables or depth-caps that, the orchestrator falls
> back to doing implement/review **inline** in its own context — still correct, just less isolation
> (its `notes` line reports `inline` vs `delegated`). If you see `inline` every task, nesting is off.

**Prereq:** a grounded `docs/<feature>/plan.md` from `/plan-feature` (the per-task orchestrators are
context-isolated, so they lean hard on the plan). Missing `progress.md` → seed from the template.

## 0. Orient
- Resolve `<feature>` from `$ARGUMENTS`, else auto-detect from `docs/*/progress.md` with unfinished
  items. **If more than one matches, list them and ask which — never guess.**
- Read `docs/<feature>/plan.md` + `docs/<feature>/progress.md`.
- Reconstruct from git, not memory: `git -C <worktree> log --oneline <base>..HEAD` + `git -C <worktree>
  status`. If a task is mid-flight (uncommitted changes), the first orchestrator will finish/gate THAT
  one before any new task.

## 1. Ensure isolation (worktree + branch)
Work in `.worktrees/<repo>/<branch>` at the mono root, branched off
source. Resuming → reuse the recorded worktree/branch. Creating → `git -C <subrepo> worktree add
<mono-root>/.worktrees/<repo>/<branch> -b <branch> <source>`; copy gitignored `.env`; recreate `.venv`
(`rm -rf .venv && uv sync`) if present; record worktree path + base sha + source in progress.md.
**Publish the branch** so every gated step is backed up remotely: `git -C <worktree> push -u
<remote> <branch>` when the sub-repo has a remote (record `Published: <remote>/<branch>` in
progress.md; no remote → record `Published: no` and continue — orchestrators then skip pushing).

**Bridge preflight (once per run, before the first orchestrator spawns):** one serialized
`timeout 60 opencode run -m openai/gpt-5.5 --format json "reply OK"` — absorbs the cold-start
OAuth refresh and proves the gate's primary leg resolves before any implementation work is spent.
Write the live legs to `<worktree>/.dev-loop/bridge-ok`, one per line in chain order
(`openai/gpt-5.5` if the probe answered; `github-copilot/gpt-5.5` iff `opencode models | grep -qx
'github-copilot/gpt-5.5'`; neither → leave the file empty so gates start at codex and flag it).
Per-task gates read this marker instead of rediscovering dead legs mid-failure (`/review-task` §4).
Multi-lane runs: ONE preflight, then remember the concurrency law — gate legs are headless opencode
runs and **two must never execute at once on a machine**, so lanes serialize their gate steps even
when their implement steps overlap (see § Bridge chain in `policyPath`).

## 2. Gather the brief (once)
From `plan.md`, extract the **`## Seam map`** text and **`## Locked decisions`** text. Note the
absolute `worktree`, `planPath` (`docs/<feature>/plan.md`), `progressPath`, `baseSha`, `source`, and
the fixed reference paths: `rubricPath=~/.claude/rubrics/per-task-review.md`,
`reviewGatePath=~/.claude/commands/review-task.md`, `leannessPath=~/.claude/reference/leanness.md`,
`policyPath=~/.claude/reference/model-policy.md`.

## 3. Loop: one orchestrator agent per task
Repeat until the plan has no unchecked tasks (or an orchestrator returns BLOCKED):

1. Spawn a **`dev-loop-orchestrator`** agent via the **Agent tool** (`subagent_type:
   "dev-loop-orchestrator"`). Brief it with everything from step 2 plus: *"Advance this plan by
   exactly ONE task — the first unchecked — then return your ORCHESTRATOR RESULT block. Work only in
   <worktree>."* Include the next task's **tier tag** (`[S|M|L]` from its plan line; untagged = M)
   — the orchestrator picks its implementer's model from it per `policyPath` — **and its `[leaf]`
   marker if present** (a leaf task's per-task gate defers the cross-model pass to integration per
   `policyPath`; the orchestrator returns `coverage: BATCHED` for it). The orchestrator
   itself always inherits your session model (never pass `model` on this spawn): its reviewers
   inherit from it, and verification is never downgraded. Hand it crafted context, not your
   session history.
2. Read the returned `ORCHESTRATOR RESULT` block:
   - **`status: APPROVED`** and `remaining > 0` → loop (spawn the next orchestrator). The plan box,
     progress.md, and commit are already updated, so the next orchestrator sees fresh state.
   - **`status: DONE`** (or `remaining: 0`) → exit the loop → step 4.
   - **`status: BLOCKED`** → STOP. Surface `blocking`, show `git -C <worktree> log --oneline
     <base>..HEAD`, note the working tree holds the in-flight task. The user fixes/re-plans, then
     relaunches `/dev-loop`. Do NOT continue past a block — a later task likely
     depends on it.
   - If `coverage: DEGRADED`, record it; report loudly at the end (cross-model bridge was down → single-model).
   - If `verify: NONE` (no runnable test command found), record it; if it's NONE on every task,
     surface that loudly — the whole feature is shipping on review alone.
   - Record `cycles` + `cycle-cause` per task (a running `task N: cycles=X (cause)` list is enough).
     In the end-of-run summary, report the totals — and if the same cause recurs (e.g. `missing-test`
     twice), call it out: that's a systematic implementer gap to fix in the prompts, not noise.
3. Keep your own per-iteration footprint minimal: trust the orchestrator's result + the on-disk state;
   you do not need to re-read the whole diff each loop.

## 3a. Lanes — parallel execution (opt-in; default is the sequential loop above)

Engages **only** when the plan declares **≥2 `[lane:<repo>]` groups** (see `/plan-feature` Stage 4).
Otherwise ignore this section — run §3 sequentially. The safety rule is absolute: **a lane is a
whole sub-repo.** Different sub-repos are different git repos with independent worktrees and
branches, so their orchestrators can't touch the same files or race the same branch. **Never split
one sub-repo across two lanes** (same branch, concurrent commits = corruption). If two lanes would
share a repo, they're one lane.

1. **Prefix first, sequentially.** Every task NOT tagged `[lane:*]` is the **foundational prefix**
   (shared contracts, schema, whatever a cross-lane task is `blocked-by`). The slicer ordered these
   first. Run them through the normal §3 loop until the next unchecked task is a `[lane:*]` task.
   A prefix task that goes BLOCKED stops the whole run (lanes may depend on it) — same as §3.
2. **One worktree+branch per lane.** For each lane's sub-repo, ensure its own
   `.worktrees/<repo>/<branch>` per §1 (independent base sha + branch + publish; record each in
   progress.md under a per-lane heading).
3. **Advance lanes concurrently.** Each round: for every lane that still has an unchecked task and
   isn't BLOCKED, spawn its next orchestrator (its worktree, its next task, `[leaf]`/tier as §3.1)
   — **all in ONE message so they run in parallel.** Await all, read each ORCHESTRATOR RESULT, then
   repeat. A lane that returns BLOCKED **pauses that lane only**; the others keep going. Keep the
   per-lane `cycles`/coverage tallies separate. Loop until every lane is drained or blocked.
4. **Barrier → §4.** When all lanes are drained, go to §4 — but the integration review runs **per
   lane sub-repo** (each `git diff <lane-base>...HEAD` in its own worktree) plus, if the lanes share
   a contract, one cross-repo composition pass. Any lane still BLOCKED at the barrier ⇒ no merge;
   surface it. FF each lane's branch onto its own source only after the user confirms (§4 rules).

Parallelism is a wall-clock optimization, not a safety change: every task still gets the full §3
gate, and the integration barrier still holds. If in doubt whether two groups are truly
independent sub-repos, don't lane them — sequential is always correct.

## 4. Integration review + hand off
When every checklist item is checked, run the **whole-feature** integration review — the seam **and
security** gate no single task diff can be (the specialist security axis, Reviewer C, runs *here*,
not in the per-task orchestrator gate — security is a whole-surface property). **Run the FULL test
suite in the worktree first** (the plan's Verify commands) — a red suite is a FAIL before any
reviewer spends a token. Then either spawn one orchestrator-style reviewer or follow
`~/.claude/commands/review-task.md` with `--integration <base>` (scope = `git diff <base>...HEAD`).
This pass runs the cross-model reviewer over the **whole** diff — so it is also the **backstop for
every `[leaf]` task** whose per-task cross-model pass was deferred (`coverage: BATCHED`). It runs
regardless; a run with zero leaves still gets it.
- **FAIL** → seams don't hold. Surface the blockers, add fix tasks to `plan.md` (unchecked), keep
  looping (back to step 3). Do NOT offer to merge.
- **PASS** → STOP. Summarize, and present the **advisory ledger**: every advisory from the run
  (Minors, security P2, leanness) with its disposition — taken / recorded (progress.md residual +
  fix one-liner) / dropped + reason — for the user to overrule before merge. An advisory with no
  disposition is a gap, not a pass. In the summary, **confirm every `coverage: BATCHED` (leaf) task
  got its cross-model pass here** — a BATCHED task with no integration cross-model coverage is a
  gap, not a pass. Then show `git -C <worktree> log --oneline <base>..HEAD`, and tell the user:
  do your final review / manual test; on your confirmation I'll fast-forward `<branch>` onto `<source>`
  (and push if you want). **Never FF or push without explicit confirmation.**
- **After the confirmed FF** — ask about cleanup (never do it unprompted): remove the worktree
  (`git worktree remove`), delete the feature branch local + published remote, and mark
  `docs/<feature>/progress.md` shipped (or archive `docs/<feature>/`). Do exactly what the user
  picks, nothing more.

## Notes
- **Locked gate**: orchestrators use ONLY `~/.claude/commands/review-task.md` + the rubric — no other
  reviewer plugin — so results are reproducible across tasks and sessions.
- **Context**: the review-heavy work lives a level down in each orchestrator, but the main thread
  still accumulates one summary per task. If it feels heavy after many tasks, checkpoint is already on
  disk every task — `/clear` and relaunch costs at most the in-flight task.
- **Provisional commits** live in the worktree; reshape with `git reset --soft <base>` before FF.
  Nothing touches `<source>` until you confirm.
