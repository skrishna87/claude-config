# dev-loop v2 — ARCHIVED 2026-06-21 (full pivot back to a resume-notes loop)

This directory holds the **v2 DAG-orchestrator loop** in full (`/plan-feature`, `/phase-translate`,
`/dev-loop`, `/review-task`, the background orchestrator `workflows/dev-loop.js`, the plan/progress
templates, the per-task rubric, and the old top-level `README.md` that documents the whole design).
It is shelved, not deleted. Everything still works; `bootstrap.sh` here re-links it into `~/.claude`.

## Why it was shelved

The v2 loop's foundational bet is **file-disjoint vertical slices, each implemented by a
fresh-context worker and reviewed in isolation, pass/fail.** That bet holds for genuinely
independent, mechanical fan-out (a rename across N files, parity rows). It **breaks for
interconnected, contract-heavy features** (e.g. the Go↔UI parity-ports), because there the
correctness lives in the **seams between slices** — and a per-task, diff-only, pass/fail gate is
blind to seams by construction.

Concretely, every blocker a later codex pass caught on the parity-ports work was a **seam bug** the
in-loop gate could not see:

- **Cross-task / cross-repo contract drift** — Go returned HTTP `500` where the plan (and the UI)
  expected `201 recoverable_error`. No gate ever sees both repos' diffs at once, so it's invisible.
- **Composition with untouched code** — talk-past input double-processed against the existing
  queue-drain path; idempotent replay searched the wrong trigger and lost continuation metadata.
  The bug is in the interaction with code *outside* the reviewed diff.
- **Twin-path asymmetry** — the UI runner stranded the flow in `SUSPENDED` on step-budget while the
  headless executor resolved it. One path handled, its twin missed.
- **Plan-conformance slips** — `recoverable_error` marked acked despite "do NOT ack"; `ask_user`
  not normalized to `accepted` even though the code's own comment said it should be.

Compounding problems: the orchestrator is **"script-based pass/fail, no context + decide"** — no
single agent holds the whole feature, so nothing reasons across the seams. The planning tax to
pre-specify every seam for context-less workers is heavy, and **the integration iteration still
happened by hand at the end anyway** — so the automation wasn't buying the quality or the
hands-off-ness it promised. The earlier **resume-notes loop (v1)** — one agent holding the whole
feature in context, a running notes/progress doc for `/clear`-survival, human course-correction —
produced better quality with easier iteration for this kind of work. Hence the pivot.

Also note: codex was **OFF in-loop** (`CODEX_ENABLED=0`, for real env reliability reasons — hangs,
`bwrap` failures), so the cross-model reviewer that *did* catch these never ran during execution.

## If you revisit this — the fix-list (none of this was applied before archiving)

Catchable by tightening `rubrics/per-task-review.md` (covers ~6 of 7 findings above):
1. **Plan-conformance check** — enumerate the slice's explicit requirements, *especially negative
   MUST-NOTs* ("do NOT ack", "normalize ask_user", "return 201 not 500"), and verify each in the
   diff. A code comment that contradicts the code is a Critical tell.
2. **Composition / twin-path lens** — soften "judge ONLY the diff" to "judge the diff, but trace how
   it composes with the flows it joins (queues, replay, retry) and check symmetry across parallel
   paths (UI vs headless; success/failure/budget/cancel branches)."
3. **Stronger test-audit** — a green test that asserts the *current/buggy* state instead of the
   *planned* contract, or that skips a branch the slice introduces (error/`recoverable`/edge), is a
   FAIL, not a pass. Green ≠ correct.
4. **Flag stale/contradictory comments** left in the diff.

Structural (the part the rubric can't fix):
5. **Integration / contract gate** — there is NO review anywhere that sees two tasks together
   (`integrate` only cherry-picks). Add a cross-task **and cross-plan** contract review at the
   layer/feature boundary, or the Go↔UI-class drift stays invisible.
6. **Re-enable codex in-loop** (`CODEX_ENABLED=1`) once it's reliable in this env — it's the
   cross-model signal that actually caught these.
7. **Bump `implement` → opus** on the one correctness-crux task per plan (orchestrator supports
   `args.models = { implement: "opus" }`) for the implementer-quality slips.

The deeper question to answer before un-archiving: **does this work's value come from parallelism
(keep v2, fix the gate) or from one mind holding the seams (stay on the resume-notes loop, and use
v2 only for truly-independent mechanical sweeps)?**

## Reactivate

```bash
archive/dev-loop-v2/bootstrap.sh   # re-links the v2 files into ~/.claude
```
