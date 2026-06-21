---
description: Translate ONE phase of a pre-existing higher-level spec into a v2 dev-loop plan.md — a grounded vertical-slice DAG whose every referenced symbol, write-set, and "everywhere" invariant is verified against the landed code, so it passes /dev-loop's §3.5 pre-flight first try.
argument-hint: "<feature> — the docs/<feature>/ to emit; point me at the source phase spec + landed base sha"
---

# /phase-translate — turn a high-level phase spec into a grounded v2 DAG

`/plan-feature` is for a *new* idea grilled from scratch. **This command is for the other case:** you
already hold a higher-level architecture / delivery plan (e.g. `docs/<arch>/NN-delivery-phases.md`)
and need to translate **one phase** of it into the machine-readable task DAG `/dev-loop` consumes.
The source spec is intentionally coarse — it names goals and checkboxes, not symbols, write-sets, or
call sites. **You** derive all of that seam-level detail by reading the landed code, and the whole
point of this command is to derive it *grounded* — so a slice never references an API that doesn't
exist, never declares a write-set narrower than what it must edit, and never asserts an "everywhere"
invariant it can't enumerate. Those three are the exact defects that, left to the review gate, cost a
full implement→review→diagnose→replan→relaunch cycle each.

Output is `docs/<feature>/plan.md` in the **exact shape of `templates/plan.md`** — identical to what
`/plan-feature` emits, so `/dev-loop` parses it the same way. Do not start the loop yourself.

## 0. Orient
- Resolve `<feature>` (the `docs/<feature>/` to write) from `$ARGUMENTS`. If `docs/<feature>/plan.md`
  already exists, STOP and ask whether to revise it — never silently overwrite a plan in flight.
- Identify three inputs (ask if any is unclear): (1) the **source phase spec** — the exact section of
  the higher-level plan this phase translates (path + heading); (2) the **architecture index** that
  stays the source of truth for cross-phase decisions; (3) the **landed base sha** this phase builds
  on — the feature-branch HEAD with all prior phases merged (`go build ./...` / equivalent green).
- `$REPO` = the directory that actually holds the `.git` for this code (the sub-repo / feature
  worktree, never the mono root). Every grep below is `git -C "$REPO" grep`.

## 1. Read the source + the real seam map
- Read the source phase section and the architecture index. Extract the phase's **goal, the durable
  contracts it must add, and its exit gate** (the observable "done and correct").
- Then read the **landed code** the phase touches — at `<base-sha>`, not from memory. For every noun
  the spec mentions (a repo, a model, a gate, a deferred TODO, a hardcoded value it must replace),
  grep the real symbol and note its exact name + signature + file. This grounding pass is what
  separates a slice that lands clean from one that thrashes. Capture a short "verified seam map":
  each spec concept → the real symbol(s) it maps to, pasted from the code, not paraphrased.

## 2. Lock the phase decisions
List the forks the source spec leaves open that a context-less implementer could resolve differently
(where new code lives, error/conflict behavior, what stays Redis-only vs durable, which task owns the
cross-cutting wiring). Close each with a one-line **why**. These become the plan's `Locked decisions`
and are briefed verbatim to every fan-out worker — they are the antibody against re-litigation.

## 3. Decompose into a grounded vertical-slice DAG
Cut the phase into tasks. Same DAG rules as `/plan-feature` §3 (read it for the full contract):

- **Each task is a vertical slice** — independently implementable, reviewable, committable; carries
  its own `test`. Not a horizontal layer ("all the models", "all the tests").
- **Disjoint-or-sequential.** Same-layer tasks run in parallel ONLY if their `files` write-sets are
  provably disjoint under the segment-prefix rule. Deliberately choose write-sets to maximize
  disjoint width; chain overlapping tasks across layers with a `dep`.
- Required keys per task, EXACTLY: `id, title, slice, files, deps, test` (single-line scalars).

Now the part this command exists for — **as you write each `slice`, ground it against the seam map
from §1.** These three rules mirror `/dev-loop` §3.5 exactly; satisfy them here and the launch
pre-flight passes first try:

- **(a) Pin every referenced symbol to a grep-verified definition.** Never name an API from memory.
  Before a slice says "via `Repo.Method`", grep it: `git -C "$REPO" grep -nw 'Method'`. Paste the
  **real** name + signature into the slice (e.g. "read through an interface matching the real
  `GetWithRevision(ctx, id) → (content, rev, hash, err)` — do NOT invent `CurrentRevision`"). A
  symbol the task itself *creates* is fine (it's in the task's own write-set); a symbol it *calls on
  existing code* must exist today or be created by a `deps` task. If you catch yourself unsure of a
  name, that's the signal to grep — an invented method is the single most expensive plan defect.

- **(b) Bound each write-set to the slice's natural blast radius — or say how you stay inside it.**
  Trace what the slice must edit. If completing it naturally touches a file outside `files` (e.g.
  threading a value through a handler), either (i) widen `files` to include it, or (ii) keep the
  tighter write-set and add an explicit **stay-in-set** clause in the slice naming the in-set
  mechanism (read the value from the durable record inside this package; defer the handler/API
  surfacing to a later wiring task T_n). A slice whose declared write-set is narrower than what it
  must edit, with no stay-in-set note, will gate-block at run time.

- **(c) Enumerate "everywhere" invariants — never assert them abstractly.** When a slice requires
  "do X in every path that mutates Y", grep the mutation sites (`git -C "$REPO" grep -n 'AdvanceSection'`
  …) and **list them in the slice** (path A, path B, path C). An abstract "every path" gets the one
  obvious site wired and the rest silently missed. The enumerated list is also the test checklist.

- **(d) Be lean in the decomposition — but never at the cost of fidelity.** Translate the source
  architecture faithfully; its deliberate seams and durable contracts are *requirements*, not your
  call to prune — never question whether a spec-mandated seam should exist (that corrodes the whole
  point of translation). Leanness here governs only the structure **you invent** while decomposing:
  don't split into more tasks than the seams require, and don't add an abstraction, helper layer, or
  generalization the source spec didn't ask for. Every abstraction or cross-task seam *you*
  introduce (as opposed to one the spec mandates) carries a one-line justification in its `slice` — a
  named second consumer, or a source-spec / locked-decision reference. One with neither is YAGNI:
  inline it.

Carry the hardest task explicitly: name the one slice that is the correctness crux of the exit gate,
and expect it to need the most fix cycles — pin its seams the tightest.

## 4. Emit `docs/<feature>/plan.md`
Write the file in the **exact shape of `templates/plan.md`** — same section order and headings:
`# <Feature> — Plan` + blockquote header; `## Context / goal`; `## Locked decisions` (each with its
why); `## Domain glossary` (≈3–8 shared terms so context-less workers speak the same language);
`## Tasks (DAG)` (the blockquote, then a **single fenced ```yaml block** that is the first fenced
block after the heading — one entry per task, EXACTLY the six keys, every value a single-line
scalar); `## Out of scope / deferred`; a horizontal rule; then the **`## Format contract` appendix
copied verbatim from `templates/plan.md`**. Record the source branch + base sha in the header so a
fresh session can resume. Optionally add a small "Layering that falls out" table (layer → width →
tasks → why).

## 5. Validate before finishing (fail fast — both layers)
Re-read your `tasks` block and check exactly what `/dev-loop` will check:
- **Structural (`/dev-loop` §2):** ids present/unique/`^[A-Za-z0-9_-]+$`; every `deps` id resolves;
  no cycle; all six keys present with valid types; `files` non-empty sequences of normalized
  repo-relative POSIX paths (dirs end with `/`, no globs); **within each layer, no two write-sets
  overlap** by the segment-prefix rule (else re-split or push one to a later layer).
- **Grounding (`/dev-loop` §3.5) — run the greps yourself now:** every production symbol a slice
  calls outside its own write-set resolves in the repo (or in a `deps` task's write-set); every
  edit-target path a slice names is in its `files` or covered by a stay-in-set note; every
  "everywhere" invariant enumerates its sites. If any grep comes back empty for a symbol you cited,
  fix the slice (real name, or move the dependency) and re-check. **A plan that fails its own §3.5
  here will fail at launch — don't hand it over until the greps are clean.**

## 6. Hand off
Tell the user the plan is written at `docs/<feature>/plan.md`; point them at the `Locked decisions`,
the layering, and the hardest-task call-out to review. Then: **"Looks right? Run `/dev-loop <feature>`
to scaffold `progress.md` and start execution."** Do not start the loop yourself — review is the
user's gate.
