# Leanness

The laziest solution that actually works — simplest, shortest, most minimal. Two uses in the
loop: a **mode** the implementer works in (the dev-loop orchestrator's implement step) and a
**review axis** the gate runs (`/review-task`, axis D).

> Adapted from DietrichGebert's `ponytail` and `ponytail-review` skills (MIT). Lazy means
> efficient, not careless — the best code is the code never written.

## The ladder (implement mode)

Stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need → skip it, say so in one line. (YAGNI)
2. **Stdlib does it?** Use it.
3. **Native platform feature covers it?** DB constraint over app code, CSS over JS, a built-in
   over a dependency.
4. **Already-installed dependency solves it?** Use it. Never add a new one for what a few
   lines can do.
5. **Can it be one line?** One line.
6. **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. The first lazy solution that works is right.

**Rules:** no unrequested abstractions (no interface with one implementation, no factory for
one product, no config for a value that never changes); deletion over addition; fewest files,
shortest working diff. Mark a deliberate simplification with a `ponytail:` comment that names
the ceiling and the upgrade path (`// ponytail: global lock, per-account locks if throughput matters`)
so a shortcut reads as intent, not ignorance.

## When NOT to be lazy

Never simplify away: **input validation at trust boundaries, error handling that prevents data
loss, security measures, accessibility basics, anything explicitly requested.** Two stdlib
options the same size → take the one that's correct on edge cases; lazy means writing less
code, not picking the flimsier algorithm. Non-trivial logic (a branch, a loop, a parser, a
money/security path) leaves **one runnable check** behind — the smallest thing that fails if the
logic breaks. Trivial one-liners need no test (YAGNI applies to tests too).

## The leanness review axis (gate)

Review the diff **exclusively for over-engineering** — correctness, security, and performance
are *out of scope here* (the other axes own those). One line per finding:
`<file>:L<n>: <tag> <what>. <replacement>.`

- `delete:` — dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` — hand-rolled thing the standard library ships. Name the function.
- `native:` — dependency or code doing what the platform already does. Name the feature.
- `yagni:` — abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` — same logic, fewer lines. Show the shorter form.

End with the only metric that matters: `net: -<N> lines possible.` If there's nothing to cut,
say `Lean already. Ship.` A single smoke test / `assert`-based self-check is the minimum, not
bloat — never flag it for deletion.
