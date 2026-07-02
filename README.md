# claude-config

My Claude Code workflow for long-running feature work, made clone-able across machines.

A **resume-notes loop**: the work is held task-by-task in an isolated worktree, with a running
`progress.md` cursor so it survives `/clear`, and every change goes through a locked review gate.
One mind holds the seams — which is what keeps interconnected features correct.

Two commands run it: **`/plan-feature`** turns a rough idea into a grounded, slice-ready plan, and
**`/dev-loop`** executes it. `/dev-loop` loops in the main thread, spawning a fresh **orchestrator
agent per task** (`dev-loop-orchestrator`) that takes one task to done — implement → review gate →
commit + checkpoint — via its own subagents and returns a one-line result. The review-heavy work
lives a level down, so the main thread stays lean.

> Earlier the loop shipped three interchangeable drivers (a manual you-drive loop and a zero-context
> JS-Workflow driver alongside this one). It was consolidated to the single agent driver on
> 2026-06-28; the other two are archived and restorable under `archive/superseded-drivers/` for the
> rare case you need a zero-context or no-nesting driver.

## The loop

```
/plan-feature <feature>     align → ground → spec → slice   (pauses for approval between stages)
        │                   → docs/<feature>/plan.md  (a grounded, vertical-slice checklist)
        ▼
/dev-loop <feature>         orient → ensure worktree + publish branch → LOOP per task:
        │                     └─ orchestrator agent: implement (lean) → verify (RUN tests)
        │                        → review gate (≤2 fix) → commit + push + rewrite progress.md
        │                        → returns a one-line result
        ▼
        └─ all tasks done → full suite run + whole-feature integration review (incl. security)
                          → (on your OK) FF-merge → (on your OK) cleanup
```

- **`/plan-feature`** — turns a rough idea into the plan `/dev-loop` executes. Four stages, each
  ending in a checkpoint: **Align** (grill, one question at a time), **Ground** (map the seams,
  pin every symbol to a real `file:line`, bound the write-set, enumerate twin paths), **Spec**
  (write `plan.md`), **Slice** (vertical-slice tracer-bullet tasks). The grounding stage is what
  stops phantom-API and contract-drift bugs before they're ever written down.
- **`/dev-loop`** — drives the plan to completion across as many fresh sessions as it takes. The main
  thread loops, spawning a fresh `dev-loop-orchestrator` agent (`agents/dev-loop-orchestrator.md`) per
  task; each orchestrator does implement → **verify (actually runs the repo's tests)** → gate →
  commit + push + checkpoint via its own subagents and returns a one-line result, keeping the main
  thread lean. The feature branch is **published at creation** and every gated commit is pushed, so
  remote state = approved tasks. Invariant at every task boundary (this is what makes `/clear` always
  safe): feature-branch commits = approved tasks, working tree = the task in flight, `progress.md` =
  the cursor. Relies on nested sub-agents; degrades to inline if the harness disables them. When
  every task is checked it runs the full suite + the whole-feature integration review — the seam
  **and** security gate no single task diff can be — then offers the FF-merge, then asks about
  cleanup (worktree, branch, docs).
- **`/review-task`** — the locked gate: an **execute-first precondition** (per-task: the scoped
  verify; integration: the FULL suite — red = auto-FAIL), then cross-model rubric review (Claude
  self + codex) plus a specialist **security** pass (`--integration` only — security is a
  whole-surface property) and a **leanness** pass, over a task's diff — or, with `--integration
  <base>`, the whole feature, to catch the cross-task contract drift and whole-surface security
  issues no single task diff shows. The rubric's test-audit judges test *quality* (filler tests,
  mutation reasoning, right level), not counts.

## What's here

| Path | Role |
|---|---|
| `commands/plan-feature.md` | the planner — align, ground, spec, slice (user-invoked) |
| `commands/dev-loop.md` | the execution loop — main thread loops, spawning an orchestrator agent per task; `/clear`-safe |
| `agents/dev-loop-orchestrator.md` | the per-task orchestrator agent (implement → gate → commit; spawns its own subagents) |
| `commands/review-task.md` | the locked review gate (per-task + integration) |
| `rubrics/per-task-review.md` | the review rubric — correctness, seam/twin-path, plan-conformance, tests, leanness |
| `reference/seam-design.md` | deep-module / seam vocabulary + the grounding discipline |
| `reference/leanness.md` | the YAGNI ladder (implement) + over-engineering review axis |
| `reference/security-review.md` | the security review axis — FP discipline + auth-bypass catalog + triage + per-tech highlights (adapted from deepsec) |
| `templates/{plan,progress}.md` | the plan checklist + the resume cursor |
| `skills/flow-report/` | companion skill: export any subject (plan, module, flow, diff) as a self-contained HTML report of high-level flow/state diagrams — for plan/refine/review conversations |
| `bootstrap.sh` | symlinks the active loop into `~/.claude` |
| `archive/superseded-drivers/` | the shelved manual + JS-Workflow drivers, with restore instructions |
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
`progress.md`. The Claude execution loop is not directly portable as-is because it relies on
Claude slash commands and nested Agent calls.

## Credits

The planner and gate vendor and adapt open-source skill collections — kept self-contained here
(no issue tracker, no multi-platform plumbing, no scanner runtime), rewired to the
`plan.md`/`progress.md` loop:

- **[mattpocock/skills](https://github.com/mattpocock/skills)** (MIT, © 2026 Matt Pocock) —
  `grilling` (Align), `codebase-design` + `to-prd` (Ground/Spec), `to-issues` (Slice), `review`
  (the multi-axis gate).
- **[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)** (MIT, © 2026
  DietrichGebert) — `ponytail` (lean implement mode) and `ponytail-review` (the leanness axis).
- **[vercel-labs/deepsec](https://github.com/vercel-labs/deepsec)** (Apache-2.0) — its core
  investigation prompt, P0/P1/P2 triage rubric, and per-tech threat highlights, distilled into
  `reference/security-review.md` (the security axis). The scanner CLI itself is *not* vendored —
  only the security knowledge it encodes.
