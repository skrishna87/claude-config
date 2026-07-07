# <Feature> — Plan

> Source of truth for WHAT we're building and the locked decisions. Created once; rarely changes.
> Source branch: <source>   |   Worktree: <.worktrees/<repo>/<branch>>

## Context / goal
<1–3 lines: the change and why>

## Locked decisions
- <architecture / library / pattern choices a fresh session must NOT re-litigate, with the why>

## Seam map
> The grounded skeleton (from /plan-feature Stage 2). What the gate checks composition against.
- **Seams**: <the seam(s) this feature is tested/composed at — prefer existing; ideal new = 1>
- **Pinned symbols**: <every function/type/endpoint/flag named, each with file:line; mark any
  that don't exist yet as "create">
- **Write-set + blast radius**: <files touched, and the untouched code that composes with them>
- **Twins**: <every parallel path — UI vs headless, success/failure/budget/cancel, repo↔repo>
- **Reused-contract semantics**: <existing contracts reused, with their REAL current meaning>
- **Verify commands**: <exact build/test commands for this repo — /dev-loop executes these
  every task; full suite runs at integration review>

## Tasks
<Each task = a vertical-slice tracer bullet: a thin path through every layer it touches,
demoable on its own. Order by dependency. Tier [S|M|L] per reference/model-policy.md —
sets the implementer's model tier; untagged = M.
Optional [leaf] = no dependents AND no foundational surface (auth/write-path/concurrency/
cross-repo contract) → its cross-model review batches to integration (model-policy.md); never on [L].
Optional [lane:<repo>] = parallel-lane assignment for a multi-repo feature (see /dev-loop §3);
omit for a single-repo/sequential plan.
Per task, to starve `semantics` fix-cycles: *interfaces:* = the exact consume/produce signatures
of the seam it crosses (from the Seam map, not prose); *accept:* clauses name EXACT expected
values (status code, sentinel, enum, zero-vs-null, count) — never "handles it correctly".>
- [ ] 1. [M] <title> — *blocked-by:* <none | task n>
  - *interfaces:* consumes `<sig>` · produces `<sig>`
  - *accept:* <clause with an exact value>; <clause with an exact value>
- [ ] 2. [S] <title> — *blocked-by:* <…>
  - *interfaces:* consumes `<sig>` · produces `<sig>`
  - *accept:* <exact-value clause>; <exact-value clause>
- [ ] 3. [L] <title> — *blocked-by:* <…>
  - *interfaces:* consumes `<sig>` · produces `<sig>`
  - *accept:* <exact-value clause>
- [ ] 4. [S][leaf] <leaf slice — per-task cross-model review deferred to integration> — *blocked-by:* <…>
  - *interfaces:* consumes `<sig>` · produces `<sig>`
  - *accept:* <exact-value clause>

## Out of scope / deferred
- <...>
