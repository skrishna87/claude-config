---
description: Turn a rough feature idea into a grounded, slice-ready plan.md — align, ground, spec, slice, then a cross-model adversarial gate. Pauses for approval between stages.
---

# /plan-feature — align, ground, spec, slice, gate (opencode port)

Produce `docs/<feature>/plan.md`: a grounded, vertical-sliced checklist an execution loop (or
you) can build from. Five stages; **stop at the end of each one for approval** before the next
begins. Never run two stages without a checkpoint — the point is to catch a wrong turn while
it's cheap.

A plan that names a function that doesn't exist, or assumes a status code the code doesn't
return, produces seam bugs no per-task review can see. Stage 2 exists to kill those before
they're written down.

Resolve `<feature>` and the rough intent from `$ARGUMENTS`. Create `docs/<feature>/` if needed.

**Reference files** (installed by bootstrap-opencode.sh; read them when each stage says so):
- Seam/grounding method: `~/.config/opencode/skills/grounded-plan-feature/references/seam-design.md`
- Plan template: `~/.config/opencode/skills/grounded-plan-feature/assets/plan.md`
- Progress template: `~/.config/opencode/skills/grounded-plan-feature/assets/progress.md`

## Sizing — is the full flow worth it here?

Before Stage 1, size the feature and say so out loud. Five pauses pay for themselves on
multi-slice, multi-day features; on a small change they cost more than they save. If the
feature looks like **≤2 slices, one seam, one repo, no auth/contract surface**, recommend the
lightweight path: merge Stages 1–2 into a single pass with ONE pause and skip Stage 5 (the
gate audits plan-bug propagation across many tasks — a 2-task plan doesn't have that risk
unless it touches auth or a reused contract). The user picks; if they choose full anyway, run
it. Never silently bypass stages — downgrade explicitly at the start, or not at all.

---

## Stage 1 — Align (grill)

Interview the user about this feature until you reach a shared understanding, walking down
each branch of the design tree, resolving dependencies between decisions one by one.

- **One question at a time.** Wait for the answer before the next.
- **Recommend an answer to every question** — don't just ask; propose, with the why.
- **If a question can be answered by reading the codebase, read the codebase.** Only ask the
  human what only the human knows (intent, priorities, product calls).
- Surface the decisions that will be expensive to reverse first.

**PAUSE.** Summarize the locked decisions in a few bullets and ask: *"Aligned? Anything to
revisit before I ground this against the code?"* Wait for go.

---

## Stage 2 — Ground (seams)

Make the design *real*. Follow the seam-design reference in full against this codebase.
Produce:

1. **Seam map** — the seam(s) this feature is tested and composed at. Prefer existing seams;
   the ideal number of new ones is one. For each, its real interface (invariants, error modes,
   ordering) — not just its type.
2. **Pinned symbols** — every function/type/endpoint/flag the design names, each with a
   grep-verified `file:line`. Anything you can't pin doesn't exist yet → an explicit "create
   X" task, flagged here.
3. **Write-set + blast radius** — files touched, plus the untouched code that *composes* with
   them. For every **existing** function the plan modifies, list **ALL its call sites** —
   every caller is in the blast radius.
4. **Twins** — every parallel path the feature touches (UI vs headless, success/failure/
   cancel branches, two repos sharing one contract). A change to one twin that misses another
   is the most common seam bug.
5. **Reused-contract semantics** — for any existing contract the feature reuses (status code,
   enum, queue message, return shape), the *actual current* semantics read at the source.
6. **Endpoint auth reach** — for every endpoint added or touched: the permission guard on its
   route (grep-verified, named) and what set of callers it actually admits. "It has a guard"
   isn't grounding.
7. **Write-path invariants** — for every state-mutating flow (form save, import, bulk
   update): the atomicity boundary (what succeeds-or-fails together, and the transaction/
   upsert guaranteeing it), destructive ordering (nothing deletes existing data before its
   replacement is durable — delete-then-recreate outside a transaction means one failed
   insert loses everything), input bounds (explicit server-side max on every collection
   input), and scale ceilings (anything growing with N vs the real limit — DB param caps,
   payload, timeout — plus batching). Can't answer one from the code → it's a Stage 1
   question; grill, don't assume.
8. **Verify commands** — the exact build/test command(s) for this repo, read from
   package.json / Makefile / CI config — grounded, not guessed.

**PAUSE.** Present the seam map + anything that surprised you. Ask: *"Does this match your
mental model? Any seam I've got wrong?"* Wait for go.

---

## Stage 3 — Spec (write plan.md)

Synthesize Stages 1–2 into `docs/<feature>/plan.md` using the plan template. No new interview
— write down what you already know: **Context / goal**, **Locked decisions** (each with its
why), **Seam map** (pinned symbols, write-set, twins). Use the repo's own vocabulary. No code
snippets unless a shape (schema, state machine, enum) encodes a decision more precisely than
prose. Leave **Tasks** empty for now.

**PAUSE.** Show the drafted plan.md (everything but Tasks). Ask: *"Spec right before I slice
it?"* Wait for go.

---

## Stage 4 — Slice (vertical-slice tasks)

Break the plan into **tracer-bullet vertical slices** in plan.md's **Tasks** checklist:

- Each slice is a thin path through ALL the layers it touches end-to-end, NOT a horizontal
  slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Any prefactoring ("make the change easy, then make the easy change") is its own first slice.
- Order by dependency; when in doubt about size, split.

Each task's tickable line is `- [ ] n. [S|M|L] <title> - *blocked-by:* <none | task n>`, with
its `interfaces:` and `accept:` as indented sub-bullets (shape below).

**Pin the seam, not just the task - kill `semantics` fix-cycles.** The loop's dominant
*avoidable* churn is `cycle-cause: semantics`: a context-isolated implementer misreading a
reused contract (a status code, a sentinel, zero-vs-null). Making slices *bigger* worsens this;
the fix is per-task **density** - co-locate each trap with the task that trips it:
- **`interfaces:`** - for the seam this slice crosses, the exact signature it **consumes** and
  **produces** (function / endpoint / type + shape), lifted from Stage 2's pinned symbols. The
  real signature, not prose like "calls the parser".
- **Concrete-value acceptance** - every acceptance clause names the *exact* expected value: the
  status code, sentinel, enum variant, zero-vs-null, count. Never a placeholder ("handles it
  correctly"). If Stage 2 read a reused-contract semantic this slice leans on, restate that exact
  value in the clause.

Added specification density, deliberately **not** bigger tasks (slices stay vertical-thin) and
**not** code-in-the-plan (the implementer writes code; the plan pins *meaning*). Task shape:

```
- [ ] n. [tier] <title> - *blocked-by:* <none | n>
  - *interfaces:* consumes `<sig>` · produces `<sig>`
  - *accept:* <clause with an exact value>; <clause with an exact value>
```

**The tier tag `[S|M|L]`** (per `~/.config/opencode/dev-loop/reference/model-policy.md`: S =
mechanical/fully specified, M = normal slice, L = seam- or judgment-heavy) sets which model
tier implements the task — classify honestly here, once; when torn, take the higher.

**Mark cross-model gate timing (`[leaf]`).** Add `[leaf]` only when BOTH hold: (1) no later task
is `blocked-by` it, and (2) it touches no foundational surface — auth/permission reach, a
state-mutating write path, concurrency, or a cross-repo/reused contract. A `[leaf]` task batches
its cross-model review to the integration gate instead of paying it per task (rationale + hard
limits in `model-policy.md`); unmarked keeps the per-task cross-model pass. **Never `[leaf]` an
`[L]` task.** When unsure, don't tag — per-task is the safe default.

**Assign lanes (`[lane:<repo>]`) if the feature spans ≥2 sub-repos.** Partition into (a) a
**foundational prefix** — shared contracts, schema, anything a task in *another* sub-repo is
`blocked-by` — left untagged, runs first sequentially; and (b) one **lane per sub-repo** of the
remaining independent tasks, each tagged `[lane:<repo>]`. In this flat port `/dev-loop` still
executes lanes **sequentially** (no nested concurrency guarantee), but the tags document the
partition and carry over if run under a nesting-capable driver. Single-repo feature → omit lane
tags. A cross-repo contract task is prefix, never a lane member.

**PAUSE.** Present the slice list: *granularity right? dependencies correct? anything to merge
or split?* Iterate until approved.

---

## Stage 5 — Adversarial gate (cross-model)

The plan is the root of trust for everything built from it, and Stage 2's grounding was
verified by the same model that wrote it — this gate is the independent check. It runs on the
**complete** plan (after slicing) because the expensive misses live in the tasks and
acceptance criteria, not just the seam map.

Spawn the **`plan-gate` subagent** (task tool) — it is pinned to a different model provider,
so this stays a cross-model check. Brief it with: the absolute path to `docs/<feature>/plan.md`
and the repo root(s) in the plan's write-set (one pass per repo for a cross-repo feature).

Then **adjudicate**: verify each finding against the code yourself before acting — the gate
model can be wrong too. Fix the plan for every confirmed finding; refute the rest with
evidence. No fix-cycle budget here — plan fixes are markdown edits, so fix and move on; run
ONE confirmation re-pass only if a High finding forced re-slicing. If the gate model's
provider is unavailable, proceed but say so loudly at Done — the plan ships single-model.

**PAUSE.** Present the findings and how each was resolved (or refuted, with evidence). Ask:
*"Gate findings resolved to your satisfaction?"* Wait for go.

---

## Done

Create `docs/<feature>/progress.md` from the progress template (all tasks unchecked, worktree
fields blank or `<not created>`).

Then ask ONE last question: *"Should these tasks be tracked anywhere outside plan.md —
whatever this project uses (issue tracker, board)?"* If yes, mirror the slices there and
record the linkage in plan.md — **plan.md stays the source of truth**. If no, move on.

Tell the user: `Plan ready — docs/<feature>/plan.md (<n> tasks).`

Do NOT start implementing — this command plans; building is a separate ask.
