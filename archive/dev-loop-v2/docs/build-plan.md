# dev-loop v2 — Plan

> Single source of truth for WHAT we're building (no separate spec doc).
> Repo: `claude-config`. Execute task-by-task; each task is independently reviewable + committable.

## Context / goal

Rebuild the current sequential, human-pumped `/dev-loop` into a **background Workflow-tool
orchestrator** with **dependency-DAG fan-out**, a **hardened dual-model review gate**, and a
**self-contained alignment + planning front-end**. This directly retires the four pains:

1. **Manual restart fatigue** → the orchestrator is a script (not a context-accumulating
   session), so it drives all tasks to done in one background run. No `/clear` pump.
2. **No fan-out** → native `parallel()`/`pipeline()`; independent tasks run concurrently.
3. **Plan can't express fan-out** → the plan now encodes per-task `deps` + `files`, forming a
   DAG whose topological layers give the "1 → 2 → 1 → 3" widths.
4. **Flaky codex** → preflight + backoff + a Claude fallback reviewer; degraded coverage is
   flagged loudly, never silent.

…with **zero dependency on the superpowers plugin** (it's disabled; the loop must stay portable).

## Locked decisions

- **Substrate:** the Workflow tool — a background JS orchestrator. Each task = a fresh-context
  subagent. No reliance on context compaction; no human-in-the-loop pump.
- **Fan-out posture: disjoint-or-sequential.** Fan out a DAG layer only when its tasks'
  declared **write-sets** are provably disjoint; otherwise run them sequentially. A surprise
  merge conflict ⇒ **auto-serialize** the loser on top of the winner; still conflicting ⇒ block.
- **Side-effects rule:** the Workflow script has **no fs/git/bash access**. ALL git, file, and
  codex work is performed by dispatched agents. The script is pure control-flow + threading of
  schema-validated data between stages.
- **Review gate:** keep codex (genuine cross-model signal) but **harden** it — preflight
  health/auth probe, backoff retries, `--skip-git-repo-check` retry. On total failure, fall
  back to a **second Claude subagent with a divergent reviewer persona**. The verdict always
  states whether true cross-model coverage held.
- **Plan front-end:** a self-contained `/plan-feature` command (grilling-style alignment gate +
  domain glossary + vertical-slice DAG). No superpowers `brainstorming`/`writing-plans`.
- **Invariant preserved (why resume is always safe):** feature-branch **commits** = approved
  tasks; **working tree / per-task worktree** = in-flight; `progress.md` = the durable cursor.
  git remains the source of truth; a fresh `/dev-loop` reconstructs remaining work from it.
- **Worktree base (verified gap, changelog 2.1.133):** task worktrees are created **explicitly
  from a recorded layer-base SHA** = current feature-branch HEAD, via an agent's
  `git worktree add <sha>`. Do NOT rely on the Workflow `isolation:'worktree'` default base:
  `worktree.baseRef` defaults to `fresh`, which branches agent-isolation worktrees from
  `origin/<default>` and **drops unpushed dependency commits** (every prior layer's output);
  and `baseRef:"head"` has itself had a bug resolving to the *main* checkout's HEAD from inside
  a linked worktree (changelog ~:453). Explicit SHA sidesteps both.
- **Resume semantics (corrected):** the Workflow `resumeFromRunId` is **same-session only** — a
  retry optimization, never durable. Post-`/clear` recovery ALWAYS reconstructs remaining work
  from git + progress.md and launches a **fresh** Workflow.
- **Task↔commit mapping:** every approved-task commit carries a `Dev-Loop-Task: T<id>` trailer.
  Reconstruction reads trailers (not free-text subjects), rejects duplicate trailers, and
  verifies each commit descends from the recorded base SHA.
- **One artifact:** this plan. No separate spec document.

## Domain glossary

- **Layer** — a topological level of the task DAG; every task in it has all `deps` satisfied.
- **Width** — number of tasks in a layer; the user's "1 → 2 → 1 → 3" = successive layer widths.
- **Write-set** — the `files` a task declares it will modify; the basis for the disjointness check.
- **Gate** — the locked dual-model review (Claude + codex, codex→Claude fallback) over a task diff.
- **Launcher** — `commands/dev-loop.md`: orients from git, parses the DAG, calls the Workflow.
- **Orchestrator** — `workflows/dev-loop.js`: walks layers, fans out, integrates, checkpoints.

## Tasks (DAG — `deps` drive the layers; write-sets are disjoint within each layer)

- [ ] **T1 — Define the plan + progress FORMAT (the contract).**
  `files: templates/plan.md, templates/progress.md` · `deps: []`
  Upgrade `plan.md` to carry a fenced, machine-parseable `tasks:` block
  (`id, title, slice, files, deps, test`) plus **Locked decisions** + **Domain glossary**
  sections. Upgrade `progress.md` to track per-task status (done / in-flight / blocked),
  current layer cursor, worktree map, base sha, and the Workflow `runId`. Also define here, as
  part of the contract: the `Dev-Loop-Task: <task-id>` **commit trailer** (the literal id, e.g.
  `Dev-Loop-Task: T1` — not `T<id>`, which would double to `TT1`), and the **validation rules**
  enforced before dispatch — unique ids; every `dep` resolves; no cycles; non-empty `files` with
  valid repo-relative paths; non-empty `test`; and a **disjointness check split by fs access**:
  the **launcher** (has fs) normalizes + expands *existing* paths; the **Workflow script** (no
  fs, and can't see files a task will *create*) does a conservative **lexical prefix/pattern
  overlap** on the declared strings (treat `src/` as overlapping `src/foo.ts`) — never naive
  exact-match, never runtime globbing. Keystone — every other piece keys off this shape.

- [ ] **T2 — Harden the review gate.**
  `files: commands/review-task.md` · `deps: []`
  Add codex preflight (`codex --version` + auth probe → skip to fallback if known-down),
  backoff retries, the `--skip-git-repo-check` retry, structured verdict capture, and the
  **divergent-persona Claude fallback**. Verdict block must declare cross-model vs degraded.
  Each codex run writes to a **unique output path** (e.g. `mktemp` or
  `/tmp/dev-loop/<runId>-<task>-<attempt>.md`), cleaned up after — never the shared
  `/tmp/codex-review.md`, which races when gates run in parallel.
  Stays usable both standalone and as the in-orchestrator stage.

- [ ] **T3 — Rubric tweak.**
  `files: rubrics/per-task-review.md` · `deps: []`
  Add a line: a task must respect its **declared write-set**; touching files outside it (or
  another slice's files) is **scope creep** — flag it. Reinforces safe fan-out.

- [ ] **T4 — Build the orchestrator.**
  `files: workflows/dev-loop.js` · `deps: [T1, T2]`
  Receives the **validated** DAG + state via `args` (the launcher reads files; the script
  cannot). **Validate before any dispatch** (T1 rules: unique ids, deps resolve, no cycles,
  valid non-empty paths + tests, prefix/glob-aware write-set disjointness) — fail early with a
  clear error rather than mid-run. Compute topological layers; per layer partition into a
  disjoint group (fan out) + conflicting remainder (sequential). Record the **layer-base SHA**
  (current feature HEAD). A sequential **provisioning** stage creates each task's worktree from
  that SHA (`git worktree add <path> <sha>`) and returns `{taskId, path}`; the worker is then
  briefed with that **absolute path** and operates only there (absolute paths for edits, `git -C
  <path>` for git) — `agent()` has no `cwd` param, so the worktree path must be explicit in the
  brief, else the agent may drift back to the launcher worktree. (RESOLVED by spike
  `wf_144124d1`: a non-`isolation` agent CAN write into a manually `git worktree add`-ed
  worktree — no guard block, shell + Write both work — and it bases directly on the given SHA.
  Isolation worktrees instead base on `origin/<default>` but can still reach the unpushed
  layer-base SHA via the shared object store. Decision: manual `git worktree add <path>
  <layer-base-sha>` + absolute-path workers; no `isolation` fallback needed.) Per task,
  a `pipeline`: **implement** (worker in its worktree, briefed with only that slice + files +
  glossary + locked decisions) → **gate** (T2 on the task diff; ≤2 fix→review cycles) →
  **commit-in-worktree** on pass, writing the `Dev-Loop-Task: <task-id>` trailer — this
  trailer-bearing commit is what marks a task **approved** → **integrate** (sequential agent
  replays passed task commits onto the feature branch) → **checkpoint** (agent updates plan.md
  ticks + progress.md, then makes a **bookkeeping commit with NO trailer** so the feature
  worktree ends clean and recovery is well-defined; only trailer commits count as tasks).
  **Failure handling:** a thrown agent resolves to `null` in `parallel()`/`pipeline()` — treat
  null / failed / gate-blocked as **blocked**: filter it out, skip only its dependents, keep
  independent branches moving; never let one bad task abort the layer. Report blockers at the end.
  **Auto-serialize (corrected):** a *surprise* integration conflict (declared-disjoint yet
  overlapping) is NOT a cherry-pick retry — that just reproduces the conflict. Rebase the loser's
  worktree onto the updated feature HEAD and **re-run implement + tests + gate** on the new base,
  then integrate; still failing ⇒ block + report.

- [ ] **T5 — Rewrite the launcher.**
  `files: commands/dev-loop.md` · `deps: [T1, T4]`
  Orient from git + progress.md (not memory); parse + **validate** the `tasks:` block; compute
  the done-set from **`Dev-Loop-Task` commit trailers** in `git log <base>..HEAD` (verify each
  descends from the recorded base sha; reject duplicate trailers; ignore non-trailer bookkeeping
  commits); ensure the feature worktree;
  call `Workflow({scriptPath: dev-loop.js, args})` with the remaining DAG + paths + base &
  layer-base sha. **Resume:** ALWAYS reconstruct remaining work from git + progress and launch a
  **fresh** Workflow; use `resumeFromRunId` ONLY to optimize a same-session retry (it does not
  survive `/clear`). Report on completion or hard block. Thin — no per-task logic here.

- [ ] **T6 — Write `/plan-feature` (self-contained front-end).**
  `files: commands/plan-feature.md` · `deps: [T1]`
  Plain-instruction reimplementation of the "measure twice" rituals: a **grilling gate**
  (interview until every decision branch resolves, not "enough to start"), a **domain glossary**,
  and **vertical-slice planning** that emits `plan.md` in the T1 format with declared write-sets
  chosen to maximize disjointness (⇒ wider, safely-fannable layers).

- [ ] **T7 — Wire bootstrap + README.**
  `files: bootstrap.sh, README.md` · `deps: [T4, T5, T6]`
  `bootstrap.sh` links `workflows/dev-loop.js` and `commands/plan-feature.md` (plus existing).
  `README.md` refreshes the flow diagram, the fan-out/DAG explanation, and the
  "no superpowers; codex hardened" notes.

- [ ] **T8 — End-to-end dogfood.**
  `files: (none — validation)` · `deps: [T7]`
  Run `/plan-feature` then `/dev-loop` on a tiny throwaway feature and verify: (a) a multi-width
  layer actually fans out; (b) the gate passes/fails correctly and a forced fail blocks only the
  dependents (independent branches keep going); (c) a **declared** write-set overlap is caught
  pre-dispatch → those tasks run sequentially; (d) a **surprise** conflict (declared disjoint,
  integration conflicts) triggers the rebase-and-re-run auto-serialize path; (e) a kill followed
  by a **new session** (`/clear`) resumes purely from git trailers + progress.md — not `runId`;
  (f) a task worktree actually contains prior layers' unpushed commits (worktree-base correctness).

### Layering that falls out (the fan-out shape — dogfooded)

| Layer | Width | Tasks | Why |
|---|---|---|---|
| 1 | **3** | T1 ∥ T2 ∥ T3 | all independent; disjoint files |
| 2 | **2** | T4, T6 | T6 needs only T1; T4 needs T1+T2 (both done) |
| 3 | 1 | T5 | needs T4 |
| 4 | 1 | T7 | needs T4, T5, T6 |
| 5 | 1 | T8 | needs T7 |

→ `3 → 2 → 1 → 1 → 1` — the exact variable-width pattern the new system is meant to produce.

## Out of scope / deferred

- `pause-after-layer` human checkpoint knob — add only if its absence is actually missed.
- Dropping codex entirely — revisit only if hardening proves insufficient.
- Migrating the rest of `~/.claude` config into this repo.

## How we'll execute this plan

The v2 orchestrator doesn't exist yet, so build it the old way: work T1–T8 in order of the
layers above (manually or via the current sequential `/dev-loop`), reviewing each task with the
existing `/review-task` gate before committing. T8 is the first real run of the new system.
