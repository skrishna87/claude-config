# Seam design & grounding

Shared vocabulary for **where behaviour lives and how it composes**. Used by `/plan-feature`
(to ground a design before slicing) and by `/review-task` (the correctness+seam axis). The
loop's quality stands or falls on the *seams between slices* — get the language right and the
seam bugs become visible.

> Deep-module vocabulary adapted from Matt Pocock's `codebase-design` skill (MIT). The
> grounding discipline below is loop-specific.

## Vocabulary — use these terms exactly

- **Module** — anything with an interface and an implementation. Scale-agnostic: a function,
  a class, a package, or a tier-spanning slice.
- **Interface** — *everything a caller must know to use the module correctly*: not just the
  type signature, but invariants, ordering constraints, error modes, required config, and
  performance characteristics. (Broader than "API" or "signature.")
- **Implementation** — what's inside the module.
- **Depth** — leverage at the interface: how much behaviour a caller exercises per unit of
  interface they must learn. **Deep** = lots of behaviour behind a small interface; **shallow**
  = the interface is nearly as complex as the implementation (avoid).
- **Seam** *(Michael Feathers)* — a place where you can alter behaviour **without editing in
  that place**; the *location* where a module's interface lives. Where to put the seam is its
  own decision, distinct from what goes behind it.
- **Adapter** — a concrete thing that satisfies an interface at a seam (role, not substance).

## Design principles

- **Fewest seams wins. The ideal number of new seams is one.** Prefer an *existing* seam to a
  new one, and put any new seam at the **highest** point you can.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a
  seam unless something actually varies across it.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a
  pass-through (shallow — collapse it). If complexity reappears across N callers, it earned
  its keep.
- **The interface is the test surface.** Callers and tests cross the *same* seam. If you have
  to test *past* the interface, the module is the wrong shape.
- **Accept dependencies, don't create them; return results, don't mutate** — the two reflexes
  that keep a seam testable.

## Grounding discipline — run this BEFORE slicing a plan

A design is **grounded** when every claim in it is pinned to something real in the codebase.
Ungrounded plans are where the seam bugs are born. For the feature you're planning:

1. **Pin every symbol.** Every function/type/endpoint/flag the plan names must be pinned to a
   grep-verified definition (`file:line`). If you can't find it, it doesn't exist yet — say so
   and make creating it an explicit task. No phantom APIs.
2. **Map the seams.** Name the seam(s) the feature is tested and composed at. Prefer existing;
   justify any new one. For each, state its real interface (invariants, error modes, ordering)
   — not just its type.
3. **Bound the write-set.** List the files/modules the change actually touches, and the real
   **blast radius** — the untouched code that *composes* with what you touch (queues, replay,
   retry, the other side of a request/response contract).
4. **Enumerate the twins.** Wherever a behaviour exists on more than one path — UI vs headless,
   success/failure/budget/cancel branches, two repos implementing one contract — list *every*
   path. A change to one twin that misses the other is the single most common seam bug.
5. **Match reused-contract REAL semantics.** When the slice reuses an existing contract (a
   status code, an enum value, a queue message, a return shape), read the *actual* current
   semantics at the source — not what the plan assumes. `201 recoverable_error` vs `500`,
   "do NOT ack" vs acked, `ask_user` normalized to `accepted` — these drift silently.
6. **Name the real changed path to test.** State the end-to-end path a test must exercise to
   prove the slice — through the seam, not around it. Green-on-the-old-path is not proof.

A plan that survives all six is ready to slice into vertical-slice tasks. One that can't pin a
symbol, can't name its seam, or hand-waves a twin is not — fix it before `/dev-loop` touches it.
