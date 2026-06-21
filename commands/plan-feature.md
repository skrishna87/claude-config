---
description: Turn a rough feature idea into a grounded, slice-ready plan.md — align, ground against the codebase, spec, then slice. Pauses for your approval between each stage. Feeds /dev-loop.
argument-hint: "<feature-name> + a sentence or two on what you want"
disable-model-invocation: true
---

# /plan-feature — align, ground, spec, slice

Produce `docs/<feature>/plan.md`: the checklist `/dev-loop` executes. Four stages, and you
**stop at the end of each one for approval** before the next begins. Never run two stages
without a checkpoint — the whole point is to catch a wrong turn while it's cheap.

The output plan is only as good as its grounding. A plan that names a function that doesn't
exist, or assumes a status code the code doesn't return, produces seam bugs `/dev-loop` can't
see. Stage 2 exists to kill those before they're written down.

Resolve `<feature>` and the rough intent from `$ARGUMENTS`. Create `docs/<feature>/` if needed.

---

## Stage 1 — Align (grill)

Interview the user relentlessly about this feature until you reach a shared understanding.
Walk down each branch of the design tree, resolving dependencies between decisions one by one.

- **One question at a time.** Wait for the answer before the next. Asking several at once is
  bewildering.
- **Recommend an answer to every question** — don't just ask, propose, with the why.
- **If a question can be answered by reading the codebase, read the codebase** instead of
  asking. Only ask the human what only the human knows (intent, priorities, product calls).
- Surface the decisions that will be expensive to reverse first.

> Grilling discipline adapted from Matt Pocock's `grilling` skill (MIT).

**PAUSE.** When the decision tree is resolved, summarize the locked decisions in a few bullets
and ask: *"Aligned? Anything to revisit before I ground this against the code?"* Wait for go.

---

## Stage 2 — Ground (seams)

Now make the design *real*. Follow `~/.claude/reference/seam-design.md` in full against this
codebase. Concretely, produce:

1. **Seam map** — the seam(s) this feature is tested and composed at. Prefer existing seams;
   the ideal number of new ones is one. For each, state its real interface (invariants, error
   modes, ordering) — not just its type.
2. **Pinned symbols** — every function/type/endpoint/flag the design names, each with a
   grep-verified `file:line`. Anything you can't pin doesn't exist yet → it becomes an explicit
   "create X" task, flagged here.
3. **Write-set + blast radius** — the files the change touches, and the untouched code that
   *composes* with them (queues, replay, retry, the other side of a contract).
4. **Twins** — every parallel path the feature touches (UI vs headless, success/failure/budget/
   cancel branches, two repos sharing one contract). A change to one twin that misses another
   is the most common seam bug.
5. **Reused-contract semantics** — for any existing contract the feature reuses (status code,
   enum, queue message, return shape), the *actual current* semantics read at the source.

**PAUSE.** Present the seam map + anything that surprised you (a symbol that wasn't where the
plan assumed, a twin nobody mentioned, a contract that means something different than expected).
Ask: *"Does this match your mental model? Any seam I've got wrong?"* Wait for go.

---

## Stage 3 — Spec (write plan.md)

Synthesize Stages 1–2 into `docs/<feature>/plan.md` using `~/.claude/templates/plan.md`. No
new interview — just write down what you already know. Fill:

- **Context / goal** — the change and why, from the user's perspective.
- **Locked decisions** — the architecture/library/pattern calls a fresh session must NOT
  re-litigate, each with its why. (These came out of Stage 1.)
- **Seam map** — the grounded seams, pinned symbols, write-set, and twins from Stage 2.
- Use the repo's own vocabulary throughout. Respect existing conventions and any ADRs/CONTEXT
  in the area. No file-path-level code snippets unless a shape (schema, state machine, enum)
  encodes a decision more precisely than prose.

Leave **Tasks** empty for now.

> PRD/seam-sketch shape adapted from Matt Pocock's `to-prd` skill (MIT), minus the issue tracker.

**PAUSE.** Show the drafted plan.md (everything but Tasks). Ask: *"Spec right before I slice it?"*
Wait for go.

---

## Stage 4 — Slice (vertical-slice tasks)

Break the plan into **tracer-bullet vertical slices** and write them into plan.md's **Tasks**
checklist.

<vertical-slice-rules>
- Each slice is a thin path through ALL the layers it touches end-to-end (schema → logic → API
  → UI → tests), NOT a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Any prefactoring ("make the change easy, then make the easy change") is its own first slice.
- Order by dependency — a slice's blockers come before it.
</vertical-slice-rules>

For each slice give: a one-line title, **acceptance criteria** (the checks that prove it), and
**blocked-by** (earlier slices it needs), in the plan.md task format. Keep slices small enough
that one is a healthy `/dev-loop` task — when in doubt, split.

> Slicing discipline adapted from Matt Pocock's `to-issues` skill (MIT), emitting a plan.md
> checklist instead of tracker issues.

**PAUSE.** Present the slice list: *granularity right (too coarse / too fine)? dependencies
correct? anything to merge or split?* Iterate until approved.

---

## Done

When the slices are approved, plan.md is complete. Create `docs/<feature>/progress.md` from
`~/.claude/templates/progress.md` (all tasks unchecked, worktree fields blank). Tell the user:

`Plan ready — docs/<feature>/plan.md (<n> tasks). Run /dev-loop <feature> to start building.`

Do NOT start implementing — `/plan-feature` plans; `/dev-loop` builds.
