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

The slicer tags every task `[S]`, `[M]`, or `[L]` — classification happens once, at plan time,
by the session model running `/plan-feature` (launch planning on your strongest plan-included
model), not per-run:

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
| Gate reviewers (both halves) | **strong — never below session** | Claude Code: inherit + GPT via the bridge chain (`openai/gpt-5.6-sol`, copilot-sol fallback where served, then codex; **default variant — never `--variant high`**; transport per § Bridge chain) · opencode: `task-reviewer` (inherits) + `task-reviewer-cross` (pinned) |
| Plan-gate, security, integration | session model (the ceiling) | root-of-trust and whole-surface passes — run at the session model by inheriting, NEVER by passing an explicit stronger `model:` |

**Ceiling rule (2026-07-07):** the session model is the MAX tier everywhere. "Strong" always means
*inherit* (omit `model:`), never an explicit upgrade — in particular, never spawn `model: fable`:
Fable is API/extra-usage only (dropped from plan inclusion 2026-07-07), so an explicit fable spawn
silently bills outside the plan. Want a stronger pipeline → launch the session on the stronger
model; the tiers follow it by construction.

## Bridge chain — which transport carries the pinned gate model

**One primary harness on every machine: opencode.** `gpt-5.6-sol` is served directly through
opencode's OpenAI auth, so that's the primary leg everywhere. The chain:

1. `opencode run -m openai/gpt-5.6-sol` — primary (ChatGPT-plan OAuth; opencode's own OpenAI
   login), at the default variant. **Deplete this quota first** — it's the free/sub-priced pool.
2. `opencode run -m github-copilot/gpt-5.6-sol` — copilot fallback, **live only where `opencode
   models | grep -qx 'github-copilot/gpt-5.6-sol'` lists it** (a machine with a Copilot seat authed
   into opencode). Same command as leg 1 with only the `-m` flag changed; same laws (stdin,
   liveness kill, timeout, one verbatim retry). Where the leg isn't listed it's a **no-op** — skip
   straight to codex. This leg rides the Copilot seat (metered premium requests) — a **separate
   quota pool** from leg 1, so it's the ONE fallback that survives an OpenAI-quota exhaustion (codex
   below shares leg 1's quota and can't).
3. `codex exec` — final fallback. Same ChatGPT quota as leg 1 but a different harness, which is
   the point: the observed wedge modes (2026-07-05 `--variant high`; 2026-07-06 concurrent
   cold-start stall; 2026-07-07 stdin-EOF block) were opencode-side, and only a harness change
   escapes those.

Leg liveness is machine-resolved locally: `opencode models | grep -qx 'openai/gpt-5.6-sol'` /
`... 'github-copilot/gpt-5.6-sol'` (the models list only shows authenticated providers). Wiring a
leg is a one-time `opencode auth login` per provider. Record which leg produced every verdict:
`bridge: opencode-openai | opencode-copilot | codex`.

**Why opencode is primary (2026-07-06 eval, planted-defect diff):** at the same pinned model,
opencode's review was ≥ the copilot harness's — 3/3 defects plus a real leanness catch copilot
missed in both its runs, all four rubric sections, stable severities, at a third of the latency
(30s vs 40s/98s). Copilot CLI as a separate harness — and the chatmock BYOK shim formerly behind
it — is retired; the surviving copilot leg rides *inside* opencode as a provider (leg 2), not a
separate CLI.

**Preflight (mandatory before any gate work starts):** `/dev-loop` §1 and `/plan-feature` stage 5
run one **serialized** probe — `timeout 60 opencode run --dir "$REPO" -m openai/gpt-5.6-sol --format
json "reply OK" < /dev/null` — before any fan-out, **in the gate's own invocation shape** (`--dir`
+ `< /dev/null`): a probe that differs from the gates in stdin or working directory can pass while
every gate wedges (2026-07-07). It absorbs the morning OAuth refresh, proves auth+model resolve, and writes
the live-leg list to `$REPO/.dev-loop/bridge-ok` — one per line, in chain order: the OpenAI leg
when the probe answers, plus `github-copilot/gpt-5.6-sol` where `opencode models` lists it — so
per-task gates skip dead legs instead of rediscovering them mid-failure. Probe fails → the chain
starts at codex and the run is flagged before any implementation work is spent. No marker present
(standalone `/review-task`) → the gate probes for itself.

**Concurrency law: never two headless opencode runs at once on a machine.** 2026-07-06 work-laptop
incident: stage 5 fanned out gates for two sibling repos in parallel; both wedged (suspected
shared-state contention under `~/.local/share/opencode/` — retries in fresh processes kept hanging
while the sibling process was alive; serial runs worked). Multi-repo gate legs run **serially** —
the cost is ~90s per extra repo and buys determinism.

**stdin law: `< /dev/null` on every opencode invocation, same as codex.** opencode ≥ 1.17.15
(upgraded 2026-07-07) blocks reading inherited stdin on a non-TTY — waits for EOF forever, writes
0 bytes. Deterministic, not intermittent: the 2026-07-07 plan-gate wedged 4/4 (both legs + all
retries) until stdin was redirected; A/B-confirmed in the same worktree (`< /dev/null` → OK in
~10s; inherited stdin → 0 bytes at timeout). Harness upgrades change invocation behavior — after
upgrading opencode or codex, re-run the preflight probe in gate shape before trusting the chain.

**Timeout law (unchanged, now with teeth):** 300s per-task / 480s plan-gate, run in the liveness
shape (`/review-task` §4: background the `timeout`-wrapped leg in one shell command, 60s zero-byte
kill, `wait` for the exit code). On
timeout, retry ONCE with the **verbatim same command** — same timeout; a run that "needs more
time" is a stall. A second timeout means the leg is **dead**: fall to the next leg immediately.
There is no third attempt and no larger timeout — raising it is how 8 designed minutes became
23 real ones (480+900, 2026-07-06). Plus the **liveness rule**: 0 bytes of output at 60s = a
wedged opencode init (both observed wedge modes — the 2026-07-06 intermittent init-hang and the
2026-07-07 stdin block — stall between `init` and session-create and
never write anything; healthy runs emit events in ~5s) — kill at 60s, count the attempt, on
EVERY attempt including the first (2026-07-07: attempt 1 burned its full 480s because the kill
was applied only to the retry).

The chain rides whatever provider logins the current machine's opencode has authed — OpenAI as the
primary leg, plus the copilot leg where a seat is present. `Bridge-mode:` stamps in older plans are
ignored.

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
| fable-5 | 9 | 9 | NOT plan-included as of 2026-07-07 — API/extra-usage only; never auto-spawn | expensive |
| opus-4.8 | 7 | 8 | mid | mid |
| sonnet-5 | 5 | 7 | cheap | cheap |
| gpt-5.6-sol | 8+ | 5 | ~free on the openai/codex ChatGPT-OAuth legs; metered premium on the copilot-seat leg | sub-priced via ChatGPT OAuth; API otherwise |
| OSS (deepseek-v4, glm-5.x, qwen) | test-driving | test-driving | n/a | cheapest — opencode gateway/OpenRouter/local |

**Cross-model reviewer pin — `openai/gpt-5.6-sol`, at DEFAULT variant.** (2026-07-12) Sol is
served directly through opencode's OpenAI auth (`opencode models | grep -qx
'openai/gpt-5.6-sol'`), so every gate (per-task, integration, plan-gate) starts there. If the
openai leg dies after the standard retry, fall to `github-copilot/gpt-5.6-sol` where that leg is
live (separate seat quota — the OpenAI-quota-exhaustion escape), then the codex harness, recording
the leg that produced the verdict. Down-tiering
to gpt-5.4 buys negative speed and worse calibration (2026-07-03: gpt-5.4 = 5m55s, 2× slower AND
over-escalated a Minor to a blocking Important). But **reasoning variant is a separate axis, and
`--variant high` is banned.** Re-benchmark 2026-07-05 (real 413-line gate diff, `opencode run
--agent plan --format json`): `--variant high` emitted **zero stream bytes for 600s and never
returned** (opencode doesn't stream thinking, so long silent reasoning == indistinguishable from a
hung process — this was the "15-min hang" that made the gate unusable and would kill adoption).
**Default variant: first byte 2s, done 86s, verdict PASS, calibration intact** (caught a real
untested-branch Minor); `minimal` ~88s but shallower. So the opencode gate model
runs at default variant + a 300s (plan-gate 480s) fail-fast timeout + the static-review preamble
(no test re-runs).
The 2026-07-03 numbers were all `--variant high`; treat them as model-vs-model only, not variant
guidance. Rule 2 (never down-tier the model) still holds — with data behind it.

## Test-driving OSS / other labs (opencode)

Two knobs, no config surgery:
- **Session primary** — switch via `/models`; the unpinned agents (driver, `task-implementer`,
  `task-reviewer`) follow it. Pinned gates (`task-reviewer-cross`, `plan-gate`) stay strong,
  so the experiment is backstopped.
- **Budget pin** — edit `model:` in `task-implementer-lite.md` (e.g. `opencode/deepseek-v4-pro`,
  `opencode/glm-5.2`) and run only `[S]`/`[M]` tasks through it. Cycle-cause telemetry is the
  scorecard: an OSS implementer that holds `cycles=0` across a feature has earned the seat;
  repeated `design`/`semantics` causes mean it hasn't.
