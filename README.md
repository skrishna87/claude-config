# claude-config

My Claude Code workflow for long-running feature work, made clone-able across machines.

A **resume-notes loop**: one agent holds the whole feature in context, works it task-by-task in
an isolated worktree, keeps a running `progress.md` cursor so the work survives `/clear`, and
puts every change through a locked review gate. One mind holds the seams — which is what keeps
interconnected features correct.

Three **interchangeable drivers** run that loop over the *same* `plan.md` + `progress.md` state, so
you can start with one and finish with another:
- **`/dev-loop`** — *you* drive: a few tasks, then it yields and you `/clear` + re-run. One mind,
  human course-correction every few tasks. Best for exploratory or seam-fuzzy work.
- **`/dev-loop-auto`** — a Workflow **JS driver** drives, hands-off: every remaining task runs in a
  fresh-context agent, so the driver's context never grows — no `/clear`, no retyping, one launch to
  done. Flattest context; best for a solid, well-grounded plan you want run unattended.
- **`/dev-loop-agent`** — the main thread loops, spawning a fresh **orchestrator agent per task**
  that does the task via its own subagents and returns. Leaner main thread than `/dev-loop` (review
  work lives in the per-task orchestrator), but not zero like `/dev-loop-auto`, and it relies on
  nested sub-agents (falls back to inline if the harness disables them).

## The loop

```
/plan-feature <feature>     align → ground → spec → slice   (pauses for approval between stages)
        │                   → docs/<feature>/plan.md  (a grounded, vertical-slice checklist)
        ▼
/dev-loop <feature>         orient → pick task → implement (subagent, lean) → review gate →
   (you drive)              commit + rewrite progress.md → continue or yield (/clear-safe)
        │
        │  …or, hands-off over the same state:
        │
/dev-loop-auto <feature>    orient → launch Workflow driver → [ per task, fresh agent:
   (driver drives)          implement → gate (≤2 fix) → commit + checkpoint ] looped to done
        ▼
        └─ all tasks done → whole-feature integration review → (on your OK) FF-merge
```

- **`/plan-feature`** — turns a rough idea into the plan `/dev-loop` executes. Four stages, each
  ending in a checkpoint: **Align** (grill, one question at a time), **Ground** (map the seams,
  pin every symbol to a real `file:line`, bound the write-set, enumerate twin paths), **Spec**
  (write `plan.md`), **Slice** (vertical-slice tracer-bullet tasks). The grounding stage is what
  stops phantom-API and contract-drift bugs before they're ever written down.
- **`/dev-loop`** — drives the plan to completion across as many fresh sessions as it takes.
  Invariant at every task boundary (this is what makes `/clear` always safe): feature-branch
  commits = approved tasks, working tree = the task in flight, `progress.md` = the cursor.
- **`/dev-loop-auto`** — the hands-off driver for the same invariant. A `Workflow` JS script
  (`workflows/dev-loop-auto.js`) loops the unchecked tasks one at a time, each in a fresh agent
  context, gating + committing + checkpointing per task and stopping on the first hard block —
  then runs the integration review. The script holds no LLM context, so it sidesteps the
  quota/latency/compaction cost of one long-running session. Sequential only (no DAG fan-out —
  that's the archived v2); the integration review is the seam gate v2 was missing.
- **`/dev-loop-agent`** — the agent-driver variant of the same invariant. The main thread loops,
  spawning a fresh `dev-loop-orchestrator` agent (`agents/dev-loop-orchestrator.md`) per task; the
  orchestrator does implement → gate → commit via its own subagents and returns a one-line result.
  Keeps the main thread leaner than `/dev-loop` by pushing the review-heavy work down a level.
  Relies on nested sub-agents; degrades to inline work if the harness disables them. (`/dev-loop-auto`
  is the flatter-context choice — see [`dev-loop-auto-vs-nested-subagents` memory note].)
- **`/review-task`** — the locked gate: cross-model rubric review (Claude self + codex) plus a
  leanness pass, over a task's diff — or, with `--integration <base>`, the whole feature, to
  catch the cross-task contract drift no single task diff shows.

## What's here

| Path | Role |
|---|---|
| `commands/plan-feature.md` | the planner — align, ground, spec, slice (user-invoked) |
| `commands/dev-loop.md` | the execution loop — checkpoint-driven, `/clear`-safe (you drive) |
| `commands/dev-loop-auto.md` | the hands-off launcher — orient, then run the Workflow driver |
| `workflows/dev-loop-auto.js` | the sequential Workflow orchestrator behind `/dev-loop-auto` |
| `commands/dev-loop-agent.md` | the agent-driver launcher — main thread loops, orchestrator agent per task |
| `agents/dev-loop-orchestrator.md` | the per-task orchestrator agent (spawns its own subagents) |
| `commands/review-task.md` | the locked review gate (per-task + integration) |
| `rubrics/per-task-review.md` | the review rubric — correctness, seam/twin-path, plan-conformance, tests, leanness |
| `reference/seam-design.md` | deep-module / seam vocabulary + the grounding discipline |
| `reference/leanness.md` | the YAGNI ladder (implement) + over-engineering review axis |
| `templates/{plan,progress}.md` | the plan checklist + the resume cursor |
| `bootstrap.sh` | symlinks the active loop into `~/.claude` |
| `archive/dev-loop-v2/` | the shelved v2 DAG-orchestrator loop, with its own bootstrap + ARCHIVE_NOTE |
| `installed_plugins.snapshot.json` | snapshot of installed plugins; re-install via `/plugin` |

## Setup on a new machine

```bash
git clone <this-repo> ~/projects/claude-config
~/projects/claude-config/bootstrap.sh
```

`bootstrap.sh` makes per-file symlinks into `~/.claude`, leaving your other commands/skills/
plugins untouched. (To run the archived v2 loop instead, use `archive/dev-loop-v2/bootstrap.sh`.)

For Codex, the portable first piece is the planner. Link it with:

```bash
~/projects/claude-config/bootstrap-codex.sh
```

That installs the `grounded-plan-feature` skill into `~/.codex/skills`. It ports `/plan-feature`
into Codex's skill model: align only when needed, ground claims against real `file:line` symbols,
write `docs/<feature>/plan.md` in the required format, slice vertical tasks, and seed
`progress.md`. The Claude execution loops are not directly portable as-is because they rely on
Claude slash commands, nested Agent calls, and Workflow JS execution.

## Credits

The planner and gate vendor and adapt two MIT-licensed skill collections — kept self-contained
here (no issue tracker, no multi-platform plumbing), rewired to the `plan.md`/`progress.md` loop:

- **[mattpocock/skills](https://github.com/mattpocock/skills)** (MIT, © 2026 Matt Pocock) —
  `grilling` (Align), `codebase-design` + `to-prd` (Ground/Spec), `to-issues` (Slice), `review`
  (the multi-axis gate).
- **[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)** (MIT, © 2026
  DietrichGebert) — `ponytail` (lean implement mode) and `ponytail-review` (the leanness axis).
