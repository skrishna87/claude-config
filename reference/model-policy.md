# Model policy — which model runs which role

One policy for both harnesses (Claude Code reads `~/.claude/reference/model-policy.md`,
opencode reads `~/.config/opencode/dev-loop/reference/model-policy.md` — same file, symlinked).
The core bet: **cheap generation + strong verification**. The locked gate is what makes a
budget implementer safe to try; savings come from generation, never from verification.

## Rules (in priority order)

1. **Defaults, not limits.** Standing permission to override: if a cheaper model's output
   misses the bar, redo the work with a stronger model without asking. Judge the output, not
   the price tag — escalating costs less than shipping mediocre work.
2. **Never downgrade verification.** Gate reviewers, plan-gate, security, and integration
   passes run strong-tier regardless of what implemented the task. A budget reviewer saves
   pennies and risks the whole invariant.
3. **For anything that ships: intelligence > taste > cost.** Cost is a tie-breaker only.
   Anything user-facing (UI, copy, API design) additionally needs a high-taste model.
4. **Escalate on evidence.** A budget-tier task that burns a fix cycle with cause `design` or
   `semantics` gets its FIX done at standard tier (a `missing-test`/`style` cycle stays at
   tier). If cycle-cause telemetry shows the same budget-tier cause twice in a feature, raise
   the implementer tier for the remaining tasks and say so in the run summary.

## Task tiers (assigned at plan time, /plan-feature Stage 4)

The slicer tags every task `[S]`, `[M]`, or `[L]` — classification happens once, by the
strongest model in the pipeline, not per-run:

- **S** — mechanical, fully specified by the plan: rename/move, config, boilerplate, a test
  for pinned behavior, a template CRUD path. No design judgment left.
- **M** — a normal vertical slice: real logic, but the seam map + acceptance criteria pin the
  decisions. The default when unsure.
- **L** — seam-heavy or judgment-heavy: touches a reused contract or twin paths, cross-repo,
  new seam, tricky concurrency/migration, or user-facing surface where taste matters.

Untagged tasks (plans written before this policy) = `M`.

## Role → tier

| Role | Tier | Mechanics |
|---|---|---|
| Driver / main loop | session model | whatever you launched with |
| Implementer, `[S]`/`[M]` task | **budget** | Claude Code: spawn implementer subagent with `model: sonnet` · opencode: `task-implementer-lite` |
| Implementer, `[L]` task | session model | Claude Code: omit `model` (inherit) · opencode: `task-implementer` |
| Fix cycles | per rule 4 | escalate on `design`/`semantics` cause |
| Gate reviewers (both halves) | **strong — never below session** | Claude Code: inherit + GPT via opencode bridge (`openai/gpt-5.5 --variant high`, pinned) · opencode: `task-reviewer` (inherits) + `task-reviewer-cross` (pinned) |
| Plan-gate, security, integration | strongest available | root-of-trust and whole-surface passes |

## Cross-model gate timing — per-task vs batched (leaf deferral)

The cross-model reviewer (Reviewer B / `task-reviewer-cross`) is the run's highest-value gate —
in practice it drives nearly every fix cycle. It is never *skipped*; the only question is *when*
it runs. Default: **per task**, on every task's diff, as the gate always has.

A task the slicer tags **`[leaf]`** defers its cross-model pass to the integration review rather
than paying it per task. `[leaf]` is an assertion the slicer must earn — **both** parts true:

1. **No dependents** — no other plan task is `blocked-by` this one. A bug here can't propagate
   into later tasks, so catching it at integration costs no rework distance.
2. **No foundational surface** — it touches none of: auth / permission reach, a state-mutating
   write path, concurrency, or a cross-repo / reused shared contract. These are exactly the
   Stage-2 invariants a per-task cross-model pass exists to catch *early*.

Effect: a `[leaf]` task's per-task gate still runs Reviewer A (self, full rubric incl. the
Security check) + the verify suite; its diff is then covered by the cross-model Reviewer B at
**integration**, which already reviews the whole `<base>...HEAD` diff — the leaf's code is in it.
**Coverage is deferred, never dropped**, and the deferral is recorded (`coverage: BATCHED`), never
silent. Tier the axis on **dependency position, not risk category**: the danger a per-task
cross-model pass buys down is *propagation*, and a leaf has none.

Hard limits: **never `[leaf]`-defer an `[L]` task** (L is seam/judgment-heavy by definition — it
always gets cross-model eyes per task), and leaf deferral applies to the **per-task** gate only —
the integration cross-model pass always runs. Unmarked = per task (today's behavior); when unsure,
leave it unmarked. Rule 2 holds with data behind it: this changes *when* the cross-model pass runs,
never *whether*, and never its pinned model.

## Ability table (personal calibration — vibes, update as models ship)

Intelligence = how hard a problem you can hand it unsupervised. Taste = UI/UX, code quality,
API design, copy. **Cost is per-harness, not universal** — it reflects what YOU pay.

| model | intelligence | taste | cost in Claude Code (plan usage) | cost in opencode (API) |
|---|---|---|---|---|
| fable-5 | 9 | 9 | expensive | expensive |
| opus-4.8 | 7 | 8 | mid | mid |
| sonnet-5 | 5 | 7 | cheap | cheap |
| gpt-5.5 | 8 | 5 | ~free (opencode/codex ChatGPT OAuth) | sub-priced via ChatGPT OAuth; API otherwise |
| OSS (deepseek-v4, glm-5.x, qwen) | test-driving | test-driving | n/a | cheapest — opencode gateway/OpenRouter/local |

**Cross-model reviewer pin — measured, don't re-tier.** Benchmark 2026-07-03 (identical review
prompt, real gate diff, all `--variant high` via `opencode run --agent plan`): gpt-5.5 = 3m02s,
fastest and best-calibrated; gpt-5.5-fast = 3m18s, no gain; gpt-5.4 = 5m55s, 2× slower AND
over-escalated a Minor to a blocking Important. Down-tiering the reviewer buys negative speed
and worse calibration — the pin stays `openai/gpt-5.5 --variant high` for every gate
(per-task, integration, plan-gate). Rule 2 applies with data behind it.

## Test-driving OSS / other labs (opencode)

Two knobs, no config surgery:
- **Session primary** — switch via `/models`; the unpinned agents (driver, `task-implementer`,
  `task-reviewer`) follow it. Pinned gates (`task-reviewer-cross`, `plan-gate`) stay strong,
  so the experiment is backstopped.
- **Budget pin** — edit `model:` in `task-implementer-lite.md` (e.g. `opencode/deepseek-v4-pro`,
  `opencode/glm-5.2`) and run only `[S]`/`[M]` tasks through it. Cycle-cause telemetry is the
  scorecard: an OSS implementer that holds `cycles=0` across a feature has earned the seat;
  repeated `design`/`semantics` causes mean it hasn't.
