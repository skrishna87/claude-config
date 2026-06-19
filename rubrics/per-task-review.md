# Per-Task Review Rubric

You are reviewing the changes for ONE task in a larger feature. Judge ONLY the diff
in scope; assume prior tasks were already reviewed and approved. Be concrete and
concise — every finding needs a `file:line` and a one-line fix.

## What to check
- **Correctness** — logic errors, off-by-one, wrong operators, broken edge cases,
  bad async/await, unhandled null/None, race conditions.
- **Security** — injection, auth/authz gaps, secrets in code, unsafe
  deserialization, missing validation at trust boundaries.
- **Silent failures** — swallowed exceptions, bare except/catch, fallbacks that
  hide errors, ignored return values.
- **Convention fit** — deviates from this repo's / the plan's patterns (naming,
  structure, error handling, libraries). Read neighboring code before judging.
- **Tests** — new logic without tests, or tests that don't actually exercise it.
- **Scope creep / write-set violation** — the diff must stay inside the task's **declared
  write-set** (its `files` list in the plan's tasks DAG; a directory entry covers everything
  beneath it). Touching any file outside that write-set — or a file belonging to another task's
  slice — is scope creep: flag it, don't silently accept. This is load-bearing for safe fan-out:
  parallel tasks assume disjoint write-sets, so an out-of-write-set edit can silently break a
  concurrent task. Cite the offending `file:line` and which write-set it violates (out of THIS
  task's set, and/or whose slice it belongs to).

## How to report
Bucket every finding:
- **Critical** — will cause incorrect behavior, data loss, or a security hole.
- **Important** — real bug/risk or clear convention violation.
- **Minor** — style, naming, nice-to-have test; non-blocking.

Format each as one line: `SEVERITY: file:line — problem — suggested fix`.

If nothing material is wrong, say so plainly. Do NOT invent issues to look
thorough; do NOT rubber-stamp. End with exactly one line:
`VERDICT: PASS` (no Critical/Important) or `VERDICT: FAIL`.
