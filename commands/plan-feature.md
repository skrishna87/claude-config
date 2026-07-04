---
description: Turn a rough feature idea into a grounded, slice-ready plan.md — align, ground against the codebase, spec, slice, then a cross-model adversarial gate on the finished plan. Pauses for your approval between each stage. Feeds /dev-loop.
argument-hint: "<feature-name> + a sentence or two on what you want"
disable-model-invocation: true
---

# /plan-feature — align, ground, spec, slice, gate

Produce `docs/<feature>/plan.md`: the checklist `/dev-loop` executes. Five stages, and you
**stop at the end of each one for approval** before the next begins. Never run two stages
without a checkpoint — the whole point is to catch a wrong turn while it's cheap.

The output plan is only as good as its grounding. A plan that names a function that doesn't
exist, or assumes a status code the code doesn't return, produces seam bugs `/dev-loop` can't
see. Stage 2 exists to kill those before they're written down.

Resolve `<feature>` and the rough intent from `$ARGUMENTS`. Create `docs/<feature>/` if needed.

## Sizing — is the full flow worth it here?

Before Stage 1, size the feature and say so out loud. Five pauses + the loop pay for themselves
on multi-slice, multi-day features; on a small change they cost more than they save. If the
feature looks like **≤2 slices, one seam, one repo, no auth/contract surface**, recommend the
lightweight path: merge Stages 1–2 into a single pass with ONE pause, skip Stage 5 (the gate
audits plan-bug propagation across N isolated tasks — a 2-task plan doesn't have that risk
unless it touches auth or a reused contract), and note that plain plan mode + `/review-task`
on the final diff may beat the loop entirely. The user picks; if they choose full anyway, run
it. Never silently bypass stages — downgrade explicitly at the start, or not at all.

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
   *composes* with them (queues, replay, retry, the other side of a contract). For every
   **existing** function/method the plan modifies, list **ALL its call sites** — every caller
   is in the blast radius. A shared code path (one service behind two handlers) silently leaks
   the change into flows the feature never meant to touch; either scope the change or add each
   extra caller to the write-set and tests.
4. **Twins** — every parallel path the feature touches (UI vs headless, success/failure/budget/
   cancel branches, two repos sharing one contract). A change to one twin that misses another
   is the most common seam bug.
5. **Reused-contract semantics** — for any existing contract the feature reuses (status code,
   enum, queue message, return shape), the *actual current* semantics read at the source.
6. **Endpoint auth reach** — for every endpoint added or touched: the permission guard on its
   route (grep-verified, named) and **what set of callers it actually admits**. "It has a
   guard" isn't grounding — if a broadly-permitted role can reach the new surface, or probe
   state through its responses (409-vs-200 oracles), the plan must scope it explicitly.
7. **Verify commands** — the exact command(s) that build and test this repo, read from
   package.json / Makefile / CI config / docs — grounded, not guessed. `/dev-loop`'s
   execute-verify step runs these on every task, so a wrong command here silently disables it.

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

**Tag every task with a tier `[S|M|L]`** per `~/.claude/reference/model-policy.md` (S =
mechanical/fully specified, M = normal slice, L = seam- or judgment-heavy). This sets which
model tier implements it — classify honestly here, once, so the driver never has to guess;
when torn between two tiers, take the higher.

> Slicing discipline adapted from Matt Pocock's `to-issues` skill (MIT), emitting a plan.md
> checklist instead of tracker issues.

**PAUSE.** Present the slice list: *granularity right (too coarse / too fine)? dependencies
correct? anything to merge or split?* Iterate until approved.

---

## Stage 5 — Adversarial gate (cross-model)

The plan is the **root of trust** for `/dev-loop`: every context-isolated orchestrator and
reviewer judges against it, so a plan bug propagates into N task implementations and resurfaces
as fix cycles or an integration blocker. Stage 2's grounding is verified by the same model that
wrote it — this gate is the independent check, same reason the review gate is cross-model. It
runs on the **complete** plan (after slicing) because the expensive misses live in the tasks
and acceptance criteria, not just the seam map.

For **each repo in the plan's write-set** (usually one; a cross-repo feature has one pass per
side): mirror the plan into the repo so the cross-model auditor running inside `$REPO` can read it. This is the
plan-only variant of `/review-task` §1's mirror — do NOT copy that block verbatim: `progress.md`
doesn't exist yet at planning time (it's created at Done).

```bash
mkdir -p "$REPO/.dev-loop"
EXCL="$(git -C "$REPO" rev-parse --git-common-dir)/info/exclude"
grep -qxF '.dev-loop/' "$EXCL" 2>/dev/null || echo '.dev-loop/' >> "$EXCL"
cp "<abs>/docs/<feature>/plan.md" "$REPO/.dev-loop/plan.md"
```

Then:

```bash
timeout 900 opencode run --dir "$REPO" -m openai/gpt-5.5 --variant high --agent plan \
  "You are doing a READ-ONLY audit — do not modify any files.

Review the feature plan at .dev-loop/plan.md against THIS repo's actual code. There is no
diff yet — you are auditing whether the plan is grounded, before implementation. Check, with
file:line evidence for every claim:
1. Every symbol/endpoint/flag the plan pins resolves where the plan says it does.
2. For every existing function the plan modifies: find ALL call sites. Does the plan account
   for each caller, or does a shared path leak the change into flows the plan never mentions?
3. For every endpoint added or touched: what permission guard is on the route, and what
   callers does it actually admit? Could a permitted-but-unintended caller reach the new
   surface, or probe state through its responses?
4. Reused-contract semantics: do the plan's claims about status codes / sentinels /
   zero-vs-nil / return shapes match what the code actually does at the source?
5. Overclaiming acceptance criteria: does any criterion assert behavior the referenced code
   doesn't have (extra filters, side conditions, different semantics)?
6. Check-then-act placement: is any enforcement the plan adds separated from the write it
   guards by a transaction boundary, and does the plan say whether that race is accepted?
Report each finding as High/Medium/Low with file:line and what the plan should say instead.
If the plan is sound, say so plainly — do not invent findings." > /tmp/plan-review.md 2>&1
```

Then read `/tmp/plan-review.md` (findings at the END, after the streamed tool-call log).
Bridge rules are `/review-task` §4 Reviewer B's: model pinned `openai/gpt-5.5 --variant high`,
FOREGROUND with the timeout (never background-and-poll), retry once on failure, then the codex
fallback chain.

Then **adjudicate**: verify each finding against the code yourself before acting — the auditor
can be wrong too (the `/review-task` §5 disagreement discipline applies). Fix the plan for every
confirmed finding. There is **no fix-cycle budget here** — plan fixes are markdown edits, so
just fix and move on; run ONE confirmation re-pass only if a High finding forced re-slicing.
If no cross-model bridge is available, proceed but say so loudly at Done — the plan ships
single-model.

**PAUSE.** Present the findings and how each was resolved (or refuted, with evidence).
Ask: *"Gate findings resolved to your satisfaction?"* Wait for go.

---

## Done

When the slices are approved and the gate findings resolved, plan.md is complete. Create `docs/<feature>/progress.md` from
`~/.claude/templates/progress.md` (all tasks unchecked, worktree fields blank).

Then ask ONE last question: *"Should these tasks be tracked anywhere outside plan.md — whatever
this project uses (issue tracker, board, ticket system)?"* Tools vary per project, so don't
assume one. If yes, mirror the slices there with whatever tooling is available and record the
linkage (URLs/ids) in plan.md next to each task — **plan.md stays the source of truth** for
`/dev-loop`; the tracker is a mirror. If no, move on.

Tell the user:

`Plan ready — docs/<feature>/plan.md (<n> tasks). Run /dev-loop <feature> to start building.`

Do NOT start implementing — `/plan-feature` plans; `/dev-loop` builds.
