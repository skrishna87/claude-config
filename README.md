# claude-config

My Claude Code workflow for long-running feature work, made clone-able across machines.

A **resume-notes loop**: one agent holds the whole feature in context, works it task-by-task in
an isolated worktree, keeps a running `progress.md` cursor so the work survives `/clear`, and
puts every change through a locked review gate. One mind holds the seams — which is what keeps
interconnected features correct.

## The loop

```
/plan-feature <feature>     align → ground → spec → slice   (pauses for approval between stages)
        │                   → docs/<feature>/plan.md  (a grounded, vertical-slice checklist)
        ▼
/dev-loop <feature>         orient → pick task → implement (subagent, lean) → review gate →
        │                   commit + rewrite progress.md → continue or yield (/clear-safe)
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
- **`/review-task`** — the locked gate: cross-model rubric review (Claude self + codex) plus a
  leanness pass, over a task's diff — or, with `--integration <base>`, the whole feature, to
  catch the cross-task contract drift no single task diff shows.

## What's here

| Path | Role |
|---|---|
| `commands/plan-feature.md` | the planner — align, ground, spec, slice (user-invoked) |
| `commands/dev-loop.md` | the execution loop — checkpoint-driven, `/clear`-safe |
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

## Credits

The planner and gate vendor and adapt two MIT-licensed skill collections — kept self-contained
here (no issue tracker, no multi-platform plumbing), rewired to the `plan.md`/`progress.md` loop:

- **[mattpocock/skills](https://github.com/mattpocock/skills)** (MIT, © 2026 Matt Pocock) —
  `grilling` (Align), `codebase-design` + `to-prd` (Ground/Spec), `to-issues` (Slice), `review`
  (the multi-axis gate).
- **[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)** (MIT, © 2026
  DietrichGebert) — `ponytail` (lean implement mode) and `ponytail-review` (the leanness axis).
