---
description: Self-contained feature planner — grills the idea until every decision is locked AND grounds the design against the real codebase (verified seam map; every referenced symbol, write-set, and parallel-path invariant checked against the code), then emits docs/<feature>/plan.md (Locked decisions + Domain glossary + grounded vertical-slice DAG) in the exact format /dev-loop consumes, passing its §3.5 pre-flight first try. No superpowers/skills.
argument-hint: "<feature idea, in your own words> — the thing you want to build"
---

# /plan-feature — align, ground, then plan (self-contained)

Turn a feature idea into `docs/<feature>/plan.md` in the **exact** shape the launcher parses
(`templates/plan.md`). This command is deliberately **standalone**: it calls no skill and no
plugin — the alignment + grounding + planning rituals are spelled out inline below so the loop
stays portable. Output only; you scaffold nothing else (the `/dev-loop` launcher writes `progress.md`).

The plan passes **two gates before you write a line of it**: §1 aligns the design with the **user's
intent** (grill until every decision is locked); §1.5 grounds it against the **codebase's reality**
(read the real code; verify every symbol, contract, write-set, and parallel path). Skipping the
second gate is the failure mode this command exists to prevent — a plan can be perfectly aligned with
what the user wants and still be wrong about what the code *is*, and that defect is invisible to the
user yet costs a full implement→review→replan cycle per slice to discover later.

The plan you emit is read by **context-less fan-out agents** who never saw this conversation.
So every resolved choice, every shared term, and every task slice must stand on its own — and must be
**true about the code**, since that reader cannot sanity-check it against the system. Plan for that
reader, not for yourself.

## 0. Orient
- Resolve `<feature>` = a short kebab-case slug from `$ARGUMENTS` (e.g. "rate limit the API" →
  `api-rate-limit`). Confirm the slug with the user in your first message.
- If `docs/<feature>/plan.md` already exists, STOP and ask whether to revise it — never silently
  overwrite a plan a loop may be mid-execution on.
- Read `~/.claude/templates/plan.md` for the format contract you must emit. Do **not** start writing the
  plan until the alignment gate (§1) is fully resolved.
- `$REPO` = the directory that actually holds the `.git` for the code this feature changes (the
  sub-repo / package, **never** a mono-repo root if the code lives in a sub-tree). Every grounding
  grep in §1.5/§3/§5 is `git -C "$REPO" grep` — get this right or the greps search the wrong tree and
  every symbol reads as a phantom.

## 1. Alignment gate (grill — one question at a time)
Measure twice. Interview the user until **every open decision branch is resolved** — not merely
"enough to start." A vague answer here becomes an ambiguity a fan-out agent re-litigates (or
guesses wrong on) with no way to ask you. Drive these to ground:

- **Goal & success criteria** — what does "done and correct" look like, observably? What's the
  one-line reason this is worth doing?
- **Unstated constraints** — required libraries/patterns/versions, perf or compat budgets, things
  that must NOT change, conventions to match.
- **Decision branches** — every fork where a reasonable engineer could pick differently (storage,
  API shape, sync vs async, where code lives, error behavior). Each fork must be *closed*, with a
  reason — that reason is the antibody against re-litigation.
- **Out of scope** — what you're explicitly NOT doing, and what's deferred.

Rules for the grilling:
- **One question at a time.** Ask, get the answer, let it reshape your next question. Do not
  batch a questionnaire — batching lets ambiguities hide.
- Prefer sharp either/or questions ("Postgres or in-memory for the counter?") over open ones.
- When the user says "you decide," decide, state the choice + why, and move on — a closed branch.
- Surface assumptions you're carrying and get them confirmed or corrected.
- **Don't stop early.** Continue until you can't find another fork that a context-less implementer
  could resolve differently. Then say so and move to §2.

When the gate closes, restate the resolved picture in 3-6 bullets and get a final "yes" before
planning. Each resolved fork becomes a **Locked decision** (the choice **and its why**).

## 1.5 Ground the design against the codebase (research pass — do this BEFORE decomposing)
§1 grilled the **user** about intent. This step grills the **codebase** for ground truth. A "new
feature" still lands inside an existing system, and the single most expensive plan defect is a slice
that asserts something false about that system — names a type/field/method that doesn't exist,
reuses an existing contract whose real semantics conflict, declares a write-set narrower than what
the change must edit, or changes a behavior on one execution path while silently missing its twin.
**None of these are intent defects the user can catch for you** — they live in the code, so you must
go read the code. Do not plan from memory of how the system "probably" works.

For every existing surface this feature touches, open it (`git -C "$REPO" grep -nw '<symbol>'`, then
Read the file) and capture a short **verified seam map** — each design concept → the real
symbol(s) it maps to, with **name + signature + file pasted from the code, not paraphrased**. Drive
out, specifically, the surfaces that recur as blockers:

- **Reused / extended types & fields.** Every existing type, struct field, JSON field, enum, or
  request shape the feature reuses or adds to — grep its real definition AND its **existing
  semantics/contract**. Reusing a field that already carries a different meaning (e.g. an existing
  `disposition` that means `queued|held|consumed`) silently breaks the old contract. If your concept
  needs a new meaning, it needs a **new field/type**, not a borrowed one.
- **Endpoints / handlers / runners you hook into.** Read what the real one actually returns and how
  it behaves (e.g. a "durable continuation" endpoint that returns a `runId` and is **headless** — no
  SSE stream to subscribe to). Plan to the behavior the code has, not the one you assume.
- **Dependency-injection / wiring seams.** A new dependency (a store, reader, client) almost always
  must be threaded through a composition root (`container.go`, a provider, a factory). That wiring
  file is part of the change — find it now so the slice that needs it can declare it.
- **Parallel execution paths — find the twin.** When the system runs the same logic two ways (live
  UI runner **and** headless/durable executor; live SSE **and** persisted-history replay;
  success path **and** failure/rollback path), grep for **all** of them. A behavior added to one and
  missed on the other is the defect that recurs the most — enumerate every path here so §3 can cover
  each.
- **Transactional / idempotency boundaries.** If a new path crosses a transaction, a
  duplicate-check, or a retry seam, read how failure unwinds (does a rollback discard a decision a
  later step already persisted? does a retry hit a 409?). A "recoverable" outcome that the real
  transaction can't actually replay is a phantom guarantee.

This map is the antibody against the most expensive class of revision. If you cannot find a symbol
your design assumes exists, that is a finding — resolve it (real name, or "this task creates it")
before it reaches a context-less worker.

## 2. Domain glossary
Coin a few (≈3-8) concise shared terms for the nouns/roles this feature introduces, so parallel
agents who share no conversation still speak the same language (e.g. naming the same concept two
ways across tasks is how disjoint slices silently collide). One line each. These go in the plan.

## 3. Vertical-slice DAG
Decompose into tasks. **Each task is a vertical slice**: independently implementable, reviewable,
and committable on its own — not a horizontal layer ("all the types", "all the tests"). A slice
carries its own test.

For each task produce: `id` (unique, stable, e.g. `T1`), `title` (short imperative), `slice`
(the vertical cut, one line), `files` (the declared **write-set**), `deps` (task ids that must be
**approved** first), `test` (the exact command that validates it).

**The disjointness design rule (this is what makes fan-out possible).** Tasks in the *same
dependency layer* (same depth in the DAG) run in parallel ONLY if their write-sets are provably
disjoint. So **deliberately choose each task's `files` so same-layer tasks don't overlap.** Two
tasks that must both edit `src/app.ts` belong in different layers (chain them with a `dep`), or
split that file's responsibilities so each owns a distinct path. Overlap within a layer isn't an
error — it just forces those tasks to run sequentially, narrowing the fan-out. Maximize disjoint
width.

Overlap is computed by the contract's **segment-prefix rule** — apply it yourself while choosing
write-sets:
- Normalize each path lexically: reject absolute paths, empty strings, and any `..` segment;
  strip a leading `./`; collapse repeated `/`. A trailing `/` marks a **directory** (then drop
  the slash); otherwise it's a **file**. Result = a list of `/`-segments + a dir/file flag.
- Two entries **overlap** iff they're equal, OR either is a **directory whose segment list is a
  prefix of the other's**. So dir `src/` overlaps `src/foo.ts`; `src/foo` and `src/foobar` do
  **not** overlap; a *file* literally named `src` does **not** overlap `src/foo.ts`.

Path rules for `files` (enforced by the parser — get them right or the launcher rejects the plan):
- Repo-relative POSIX paths. **Directories END WITH `/`**; files do not. **No globs/wildcards.**
- `files` is a non-empty sequence; `deps` is a sequence of ids (`[]` = none).

Prefer the narrowest write-set that still makes the slice self-contained (a task that declares a
whole dir `src/` blocks every other task touching anything under `src/` from sharing its layer).

**Ground every slice against the §1.5 seam map as you write it.** A context-less worker implements
the slice *as written* — if the prose names an API that doesn't exist or a write-set too narrow to
finish, the worker either invents the wrong thing or gate-blocks. These rules are the exact defect
classes that otherwise surface only at the review gate (each costs a full
implement→review→replan→relaunch cycle); satisfying them here makes the plan pass `/dev-loop`'s §3.5
pre-flight first try:

- **(a) Pin every referenced symbol to a grep-verified definition — no phantom APIs.** Before a
  slice says "via `Repo.Method`" or "matching `Type.Field`", grep it and paste the **real** name +
  signature into the slice (e.g. "read through `GetWithRevision(ctx, id) → (content, rev, hash,
  err)` — NOT an invented `CurrentRevision`"). A symbol the task itself *creates* (in its own
  write-set) is fine; a symbol it *calls on existing code* must exist today or be created by a `deps`
  task. If you're unsure of a name, that's the signal to grep, not to guess.
- **(b) Bound each write-set to the slice's real blast radius — or say how you stay inside it.**
  Trace what implementing the slice must actually edit. If it naturally touches a file outside `files`
  — a composition root that wires a new dependency, a caller that must thread a new value, a sibling
  path — either (i) widen `files` to include it, or (ii) keep the tighter set and add an explicit
  **stay-in-set** clause naming the in-set mechanism and deferring the rest to a later wiring task.
  A write-set narrower than the change, with no stay-in-set note, gate-blocks at run time. (A slice
  that "adds the type/enum/vocabulary" but whose write-set can't reach the code that *acts* on it
  isn't a vertical slice — it's a horizontal layer in disguise. Make the slice ship **working,
  observable behavior end-to-end**, or fold it into the task that does.)
- **(c) Enumerate "everywhere" invariants — never assert them abstractly.** When a slice needs "do X
  in every path that does Y" / "all callers" / "every mutation", grep the sites and **list them in
  the slice** (path A, path B, path C). This is where **parallel execution paths** bite: a behavior
  added to the live runner but not the headless executor, to success but not the failure/rollback
  path, to live SSE but not persisted-history replay — enumerate the twins from §1.5 so none is
  silently missed. The enumerated list doubles as the slice's test checklist.
- **(d) When a slice reuses or touches an existing contract, match its REAL semantics.** Don't just
  confirm the symbol exists — encode how it actually behaves (a field's existing meaning, an
  endpoint's headless-vs-streamed shape, a transaction's rollback/retry/idempotency rules). A slice
  that assumes a borrowed field is free, or that a "recoverable" outcome can replay across a
  transaction the real code rolls back, is wrong even though every name resolves.
- **(e) Make each `test` exercise the real changed path.** The `test` must hit the actual seam the
  slice changes (the live/persisted mapper, the SSE handler, the executor) — not a sibling component
  that doesn't flow through it. A passing test on the wrong target proves nothing.

**Design the leanest DAG that satisfies the Locked decisions.** Architectural over-engineering is
invisible to the per-diff review gate — by the time a worker implements a slice, the fact that the
slice exists and has its shape is already locked. So prune it *here*: prefer the fewest tasks and
abstractions that meet §1's locked decisions; don't introduce a cross-task seam, layer, or
generalization "for extensibility" without a **named second consumer** or an explicit request.
Every abstraction or shared seam you introduce carries a one-line justification in its `slice` — a
named second consumer, or a locked-decision reference. One with neither is YAGNI: inline it,
collapse the tasks. (This governs structure *you* invent — never a capability the Locked decisions
mandate.)

## 4. Emit `docs/<feature>/plan.md`
Write the file in the **exact shape of `templates/plan.md`** — same section order and headings:

1. `# <Feature> — Plan` + the blockquote header (what we're building; the `tasks` block is the
   machine-readable source of truth; live status lives in `progress.md`/git, not here).
2. `## Context / goal` — 1-3 lines: the change and why.
3. `## Locked decisions` — every resolved fork from §1, **each with its why**.
4. `## Domain glossary` — the §2 terms.
5. `## Tasks (DAG)` — the blockquote, then a **single fenced ```yaml block** that is the first
   fenced block after that heading. One entry per task with EXACTLY the required keys
   (`id, title, slice, files, deps, test`) — no extra or duplicate keys. Match the template's
   field style verbatim. Keep every value a **single-line scalar** (no block scalars, no
   fenced/backtick content inside a value) so a stray start-of-line fence can't close the block early.
6. `## Out of scope / deferred` — from §1.
7. A horizontal rule, then the **`## Format contract` appendix copied verbatim from
   `~/.claude/templates/plan.md`** (so the plan is self-describing for whoever consumes it). Copy it
   as-is; do not paraphrase.

Optionally add a small "Layering that falls out" table (layer → width → tasks → why) showing the
fan-out shape — useful, not required.

## 5. Validate before finishing (fail fast — both layers)
Re-read your `tasks` block and check exactly what `/dev-loop` will check.

**Structural (`/dev-loop` §2) — lexical:**
- **ids**: present, unique, case-sensitive, match `^[A-Za-z0-9_-]+$`.
- **deps**: every id resolves to a real task; **no cycles** (topologically sortable).
- **schema**: every task has all required keys, correct types (`files` & `deps` are sequences,
  not bare scalars; `files` non-empty; `title`/`slice`/`test` non-empty strings).
- **paths**: every `files` entry normalizes (not absolute, no `..`, non-empty); dirs end with `/`,
  no globs.
- **disjointness**: within each dependency layer, no two tasks' write-sets overlap by the
  segment-prefix rule. If any do, either re-split the files or add a `dep` to push one into a
  later layer (and note in `slice`/comment why) — then re-check.

**Grounding (`/dev-loop` §3.5) — run the greps yourself now, don't trust the prose:**
- Every production symbol a slice **calls outside its own write-set** resolves in `$REPO` (or is
  created by a `deps` task's write-set). Any that greps empty is a phantom — fix the name or move the
  dependency.
- Every **edit-target path** a slice names is in its `files` (segment-prefix rule) or covered by an
  explicit stay-in-set note.
- Every **"everywhere"** invariant enumerates its concrete sites, and each parallel-path twin from
  §1.5 is covered by some task.
A plan that fails its own §3.5 here will STOP at launch — don't hand it over until the greps are clean.

**Plan-internal consistency:** no contradictory text. If a decision **changed during the
back-and-forth** (e.g. you moved from "reconnect via SSE" to "one-shot refresh"), purge the old
wording from **every** mention — glossary, locked decisions, and each slice — not just the one you
last edited. A symbol's signature cited in one task must match the same symbol cited in another.

If anything fails, fix the plan and re-validate. Do not hand the user a plan that won't parse — or
that won't ground.

## 6. Hand off
Tell the user the plan is written, point them at `docs/<feature>/plan.md`, and ask them to review
it (especially Locked decisions + the layering). Then: **"Looks right? Run `/dev-loop <feature>`
to scaffold `progress.md` and start execution."** Do not start the loop yourself — review is the
user's gate.
