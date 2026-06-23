# Seam design & grounding

Shared vocabulary for where behaviour lives and how it composes. Use this before slicing a
feature plan and during review.

## Vocabulary

- **Module** - anything with an interface and an implementation: a function, class, package,
  service, or tier-spanning slice.
- **Interface** - everything a caller must know to use a module correctly: type shape,
  invariants, ordering constraints, error modes, required config, and performance traits.
- **Implementation** - what is inside the module.
- **Depth** - leverage at the interface. Deep modules put substantial behaviour behind a small
  interface; shallow modules expose nearly as much complexity as they contain.
- **Seam** - a place where behaviour can be altered without editing that place; the location
  where a module interface lives.
- **Adapter** - a concrete implementation that satisfies an interface at a seam.

## Design principles

- Fewest seams wins. Prefer existing seams; the ideal number of new seams is one.
- One adapter means a hypothetical seam. Two adapters means a real seam.
- Use the deletion test: if deleting the module removes complexity, it was probably shallow;
  if complexity reappears across callers, the module earned its interface.
- The interface is the test surface. Tests and callers should cross the same seam.
- Accept dependencies rather than creating them internally; return results rather than mutating
  hidden state when practical.

## Grounding discipline

A design is grounded when every claim is pinned to something real in the codebase.

1. **Pin every symbol.** Every function, type, endpoint, command, flag, enum, config key, and
   file named in the plan must have a grep-verified `path:line`. If it cannot be found, say it
   does not exist yet and create an explicit task for it.
2. **Map the seams.** Name the seam(s) where this feature is tested and composed. For each,
   state the actual interface: invariants, error modes, ordering, and caller obligations.
3. **Bound the write-set.** List files/modules the change touches and the blast radius: untouched
   code that composes with them, such as queues, retries, replay, consumers, callers, and the
   other side of request/response contracts.
4. **Enumerate twins.** List parallel paths that must stay symmetric: UI/headless, success/error,
   cancel/budget/timeout, sync/async, API/worker, or two repos sharing a contract.
5. **Match reused-contract semantics.** Read the actual current semantics for any reused status,
   enum, queue message, return shape, or persisted value. Do not rely on names alone.
6. **Name the real changed path to test.** State the path a test must exercise to prove the
   slice through the seam, not around it.

A plan that cannot pin a symbol, name its seam, or account for a twin is not ready to slice.
