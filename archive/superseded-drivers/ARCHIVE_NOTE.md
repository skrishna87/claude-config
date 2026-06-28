# Superseded dev-loop drivers (archived 2026-06-28)

The dev loop used to ship **three** interchangeable drivers over the same `plan.md` + `progress.md`
state. As of 2026-06-28 it was consolidated to **one** — the orchestrator-per-task **agent driver**,
now simply `/dev-loop` (`commands/dev-loop.md` + `agents/dev-loop-orchestrator.md`). These are the
two superseded alternatives, kept here because each holds a capability the unified driver can't:

- **`commands/dev-loop-manual.md`** — the original *you-drive* loop: one main-thread agent does a few
  tasks inline, yields, you `/clear` + re-run. No nesting dependency, simplest mental model.
  Superseded because the agent driver does the same work hands-off (and degrades to inline on its own
  when nesting is unavailable).
- **`commands/dev-loop-auto.md` + `workflows/dev-loop-auto.js`** — the hands-off *JS-Workflow* driver:
  a Workflow script loops every task with a fresh-context agent, so the driver holds **zero** LLM
  context (never needs `/clear`, no nested-`Agent` dependency). The genuine break-glass fallback for a
  feature too large for the agent driver's main thread, a hard quota cap, or a harness that disables
  nesting (which would force the agent driver into its heaviest all-inline mode).

All three share the identical on-disk contract, so a feature planned or started under any of them
resumes cleanly under the unified `/dev-loop`.

## Restore one

They are no longer symlinked by the top-level `bootstrap.sh`. To bring one back into `~/.claude`
(run from the repo root):

```bash
# the zero-context JS-Workflow driver:
ln -sfn "$PWD/archive/superseded-drivers/commands/dev-loop-auto.md"   ~/.claude/commands/dev-loop-auto.md
ln -sfn "$PWD/archive/superseded-drivers/workflows/dev-loop-auto.js"  ~/.claude/workflows/dev-loop-auto.js
# the manual you-drive driver:
ln -sfn "$PWD/archive/superseded-drivers/commands/dev-loop-manual.md" ~/.claude/commands/dev-loop-manual.md
```

The orchestrator agent + the review gate they invoke are still live, so no other relinking is needed.
Their prose still calls the agent driver a "sibling" and references `/dev-loop-auto`/`/dev-loop` by
their old roles — historical, harmless.
