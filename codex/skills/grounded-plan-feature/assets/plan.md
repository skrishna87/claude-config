# <Feature> - Plan

> Source of truth for WHAT we're building and the locked decisions. Created once; rarely changes.
> Source branch: <source>   |   Worktree: <.worktrees/<repo>/<branch>>

## Context / goal
<1-3 lines: the change and why>

## Locked decisions
- <architecture / library / pattern choices a fresh session must NOT re-litigate, with the why>

## Seam map
> The grounded skeleton. What later implementation/review checks composition against.
- **Seams**: <the seam(s) this feature is tested/composed at; prefer existing; ideal new = 1>
- **Pinned symbols**: <every function/type/endpoint/flag named, each with file:line; mark any that do not exist yet as "create">
- **Write-set + blast radius**: <files touched, and the untouched code that composes with them>
- **Twins**: <every parallel path: UI vs headless, success/failure/budget/cancel, repo-to-repo>
- **Reused-contract semantics**: <existing contracts reused, with their real current meaning>
- **Changed path to test**: <the end-to-end path that proves the change through the seam>

## Tasks
<Each task = a vertical-slice tracer bullet: a thin path through every layer it touches,
demoable on its own. Order by dependency. Tier [S|M|L]: S = mechanical, M = normal slice
(default), L = seam/judgment-heavy - sets the implementing model's tier downstream.
Optional [leaf] = no dependents AND no foundational surface (auth/write-path/concurrency/
cross-repo contract) -> its cross-model review batches to integration (model-policy.md); never on [L].
Optional [lane:<repo>] = parallel-lane assignment for a multi-repo feature (see /dev-loop);
omit for a single-repo/sequential plan.>
- [ ] 1. [M] <task> - *accept:* <criteria that prove it> - *blocked-by:* <none | task n>
- [ ] 2. [S] <task> - *accept:* <...> - *blocked-by:* <...>
- [ ] 3. [L] <task> - *accept:* <...> - *blocked-by:* <...>
- [ ] 4. [S][leaf] <leaf slice - per-task cross-model review deferred to integration> - *accept:* <...> - *blocked-by:* <...>

## Out of scope / deferred
- <...>
