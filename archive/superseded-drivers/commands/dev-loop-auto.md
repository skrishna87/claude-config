---
description: Hands-off sibling of /dev-loop. One launch drives the WHOLE plan to done — a fresh-context Workflow agent per task (lean context, no /clear, no retyping), per-task review gate, commit + checkpoint on pass, then a whole-feature integration review. Same plan.md + progress.md state as /dev-loop; swap between them mid-feature.
argument-hint: "<feature-name> to start/resume; omit to auto-detect the active feature"
---

# /dev-loop-auto — hands-off sequential execution loop

The **automated** sibling of `/dev-loop`. Same job, same on-disk state, different driver:

- `/dev-loop` — **you** drive: it does a few tasks, yields, you `/clear` + re-run. You reset context.
- `/dev-loop-auto` — a **Workflow JS driver** drives: it loops every remaining task with a
  **fresh-context agent per task**, so no LLM context accumulates — no `/clear`, no retyping,
  one launch to done. Use this when the plan is solid and you want it run unattended.

Both read/write the **same** `docs/<feature>/plan.md` checklist + `docs/<feature>/progress.md`
cursor + per-task commits in the **same** worktree, so you can start with one and finish with the
other. The state on disk is the contract; these are just two drivers over it.

**Prereq:** a grounded plan at `docs/<feature>/plan.md` (checklist) from `/plan-feature`. A plan
that isn't grounded (unpinned symbols, unmapped seams) is where seam bugs come from — and the
per-task workers here are context-isolated, so they lean on the plan even harder than `/dev-loop`'s
do. If the plan isn't grounded, run `/plan-feature` first. If `progress.md` is missing, create it
from the template (all items unchecked).

This loop is **best for** solid, well-grounded plans you want run hands-off. If the work is
exploratory or the seams are still fuzzy, prefer `/dev-loop` (one mind, human course-correction
every few tasks).

## 0. Orient (always first — identical to /dev-loop, so state is interchangeable)
- Resolve `<feature>` from `$ARGUMENTS`, else auto-detect from `docs/*/progress.md` with
  unfinished items.
- Read `docs/<feature>/plan.md` + `docs/<feature>/progress.md`.
- Reconstruct state **from git, not memory**: `git -C <worktree> log --oneline <base>..HEAD`
  (approved tasks) and `git -C <worktree> status` (in flight). Cross-check against the checklist.
- **If a task is interrupted mid-flight** (uncommitted changes exist): do NOT launch the Workflow
  yet. Finish + review THAT task first by following `/dev-loop` §3–5 inline (or just hand off to
  `/dev-loop`), commit it, then come back and launch from a clean tree. The Workflow assumes a
  clean working tree at the start of each task.

## 1. Ensure isolation (worktree + branch) — same convention as /dev-loop
Work in `.worktrees/<repo>/<branch>` at the **mono root**, branched off the source branch.
- Resuming → use the existing worktree/branch (path is in progress.md).
- Creating → `git -C <subrepo> worktree add <mono-root>/.worktrees/<repo>/<branch> -b <branch>
  <source>`. Copy any gitignored `.env` in; recreate `.venv` (`rm -rf .venv && uv sync`) if present.
  Record worktree path + base sha + source branch in progress.md.

## 2. Build the task list for the driver
- From `plan.md`'s `## Tasks` section, collect every **unchecked** item (`- [ ] <n>. <text> —
  *accept:* <criteria> — *blocked-by:* …`) **in order**. Each becomes
  `{ id: "<n>", text: "<task text>", accept: "<criteria>" }`. Skip checked (`- [x]`) items —
  they're already approved (verify against `git log`).
- Extract the plan's **`## Seam map`** section text and **`## Locked decisions`** section text —
  these get briefed to every worker verbatim.
- If there are no unchecked tasks, skip to step 4 (integration review only) — or report done.

## 3. Launch the Workflow
Call the **Workflow tool** with `scriptPath: "~/.claude/workflows/dev-loop-auto.js"` (this is a
user-invoked slash command instructing the Workflow call — that's the required opt-in). Pass `args`:

```
{
  repo:           "<abs path to the git subrepo>",
  worktree:       "<abs path to .worktrees/<repo>/<branch>>",
  featureBranch:  "<branch>",
  source:         "<source branch>",
  baseSha:        "<base sha recorded in progress.md>",
  planPath:       "<abs>/docs/<feature>/plan.md",
  progressPath:   "<abs>/docs/<feature>/progress.md",
  rubricPath:     "~/.claude/rubrics/per-task-review.md",
  reviewGatePath: "~/.claude/commands/review-task.md",
  leannessPath:   "~/.claude/reference/leanness.md",
  seamMap:        "<the Seam map section text>",
  lockedDecisions:"<the Locked decisions section text>",
  tasks:          [ { id, text, accept }, ... ],   // the unchecked tasks, in order
  // models:      { implement: "opus" }            // OPTIONAL per-stage override; default
                                                    // implement=sonnet, gate/integration=opus,
                                                    // checkpoint=haiku. Bump implement→opus for a
                                                    // correctness-crux plan; downgrade gate to save quota.
}
```

Pass `args` as a real JSON value, not a stringified blob. The Workflow runs in the background and
notifies you on completion — you do not babysit it. Each task implements → gates (Claude self +
codex + leanness, ≤2 fix cycles) → commits + ticks the plan box + rewrites progress.md, all in
fresh agent contexts. It **stops on the first hard block** (so a later dependent task never builds
on broken work) and otherwise runs to the end, then runs the integration review.

## 4. Relay the result + hand off
The Workflow returns `{ approved, blocked, integration, coverageNotes }`. Report it; do not re-run
the work yourself.

- **`blocked` is set** → a task FAILed the gate after 2 fix cycles (or an agent died). Surface
  `blocked.reason`, show `git -C <worktree> log --oneline <base>..HEAD` (what landed), note the
  working tree holds the in-flight task. The user fixes/re-plans, then re-launches `/dev-loop-auto`
  (or `/dev-loop`) — state is intact and resumable.
- **`integration.pass === false`** → all tasks landed but the **seams don't hold**. This is the
  gate no single task diff could be. Surface `integration.blocking`, add fix tasks to `plan.md`
  (unchecked), and tell the user to re-launch the loop. **Do NOT offer to merge.**
- **`integration.pass === true`** → STOP. Summarize, show `git -C <worktree> log --oneline
  <base>..HEAD`, and tell the user: do your final review / manual test; on your confirmation I'll
  fast-forward `<branch>` onto `<source>` (and push if you want). **Never FF or push without
  explicit confirmation.**
- If any `coverageNotes` entry is `DEGRADED`, say so loudly — codex was down, so that review was
  Claude-only (single-model). Offer to re-run the gate for those once codex is healthy.

## Notes
- **Context stays flat by construction**: the JS driver holds no LLM context; each task's work is a
  fresh agent. That's the whole point versus running `/dev-loop` without yielding — same hands-off
  feel, but the orchestrator's window never grows, so no quota/latency creep and no compaction.
- **Locked gate**: this loop uses ONLY `~/.claude/commands/review-task.md` + the rubric — no other
  reviewer plugin. Same gate as `/dev-loop`, so results are comparable across both.
- **Provisional commits** live in the isolated worktree; to reshape history before FF,
  `git reset --soft <base>` and recommit. Nothing touches `<source>` until you confirm the FF.
- **Sequential by design** — one task at a time, no parallel fan-out. If you want parallelism for a
  truly file-disjoint mechanical sweep, that's the archived v2 DAG loop, not this.
