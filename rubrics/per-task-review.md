# Per-Task Review Rubric

You are reviewing the changes for ONE task (or, with a base fixed-point, a whole feature) in a
larger plan. Be concrete and concise — every finding needs a `file:line` and a one-line fix.

Judge the diff in scope, **but do not stop at the diff's edges**: the costly bugs live in how
the diff *composes* with code it doesn't touch. Read neighboring code, the flows this joins,
and — where the task names them — the plan and the other side of any shared contract.

## What to check

**Correctness** — logic errors, off-by-one, wrong operators, broken edge cases, bad
async/await, unhandled null/None, race conditions.

**Security** — injection, auth/authz gaps, secrets in code, unsafe deserialization, missing
validation at trust boundaries.

**Silent failures** — swallowed exceptions, bare except/catch, fallbacks that hide errors,
ignored return values.

**Composition / twin-path / contract** *(the seam lens — this is where features break)* —
- How does this diff compose with the flows it joins (queues, replay, retry, drain, cancel)?
  Trace it; don't assume.
- Symmetry across **twin paths**: if a behaviour exists on more than one path (UI vs headless,
  success/failure/budget/cancel branches, two repos sharing one contract), is *each* twin
  handled? A change to one twin that misses the other is a Critical.
- Reused contracts: does the code match the contract's **real** semantics at the source — the
  actual status code / enum value / queue message / return shape — not what's convenient here?
  (`201 recoverable_error` vs `500`; "do NOT ack" vs acked; `ask_user` normalized vs not.)

**Plan-conformance** — enumerate the task's explicit requirements, **especially the negative
MUST-NOTs**, and verify each against the diff. A requirement asked-for-but-missing, or behaviour
added that nobody asked for (scope creep), is a finding. A code comment that contradicts the
code is a Critical tell.

**Test-audit (green ≠ correct, count ≠ coverage)** — a passing test that asserts the
*current/buggy* state instead of the *planned* contract, or that skips a branch the slice
introduces (error / recoverable / edge), is a FAIL, not a pass. New logic with no test that
actually exercises it is a finding. Then judge the tests' **quality**, not their count:
- **Filler tests are findings, not coverage** — tautologies (`expect(true)`), asserting a mock
  you just configured, snapshot-everything, near-duplicates that inflate the count. Every test
  must assert observable behavior at a contract, not implementation detail.
- **Mutation reasoning** — take the 1–3 riskiest logic points in the diff and ask: *if this
  operator/branch were flipped or this line deleted, which test fails?* If the answer is "none",
  that logic is untested no matter what coverage says — Important.
- **Right level** — unit vs integration per what the slice's acceptance criteria need; a seam
  crossing tested only with mocks on both sides is untested *at the seam*.

**Convention / standards** — deviates from this repo's documented standards or the plan's
patterns (naming, structure, error handling, libraries). Read neighboring code before judging.
Skip anything tooling already enforces.

**Stale comments** — flag comments left in the diff that contradict or no longer match the code.

## Leanness (advisory axis)

Run separately and report under its own heading — see `~/.claude/reference/leanness.md`. Hunt
*only* over-engineering: reinvented stdlib, unneeded dependency, speculative abstraction, dead
flexibility. One line per finding (`delete/stdlib/native/yagni/shrink`), ending `net: -N lines
possible` or `Lean already. Ship.` Leanness findings are **advisory** — surfaced for the human,
not auto-blocking — unless the over-engineering is egregious (a whole speculative subsystem).

## How to report

Bucket every finding:
- **Critical** — will cause incorrect behavior, data loss, a security hole, or a missed twin.
- **Important** — real bug/risk, a plan MUST-NOT violated, or a clear convention violation.
- **Minor** — style, naming, nice-to-have test; non-blocking.

Format each as one line: `SEVERITY: file:line — problem — suggested fix`, grouped by the check
it came from (so a passing section never masks a failing one).

If nothing material is wrong, say so plainly. Do NOT invent issues to look thorough; do NOT
rubber-stamp. End with exactly one line:
`VERDICT: PASS` (no unresolved Critical/Important) or `VERDICT: FAIL`.
