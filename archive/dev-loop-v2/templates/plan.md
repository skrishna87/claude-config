# <Feature> — Plan

> WHAT we're building + the locked decisions. Created once by `/plan-feature`; rarely changes.
> The `tasks` DAG below is the **machine-readable source of truth** the launcher parses.
> Live status lives in `progress.md` and in git (commit trailers) — **not here** (no checkboxes
> to drift). Source branch: `<source>` | Feature worktree: `<.worktrees/<repo>/<branch>>`

## Context / goal
<1–3 lines: the change and why>

## Locked decisions
- <architecture / library / pattern choices a fresh session — or a context-less fan-out agent —
  must NOT re-litigate, with the why>

## Domain glossary
> Shared language so parallel agents that share no conversation still speak the same terms.
- **<term>** — <concise definition>

## Tasks (DAG)
> The orchestrator walks this graph. `deps` form the topological layers; a layer's width is the
> fan-out. `files` is the declared **write-set** for the disjointness check. Each task is a
> **vertical slice**: independently implementable, reviewable, and committable. Choose write-sets
> to be disjoint within a layer — that's what lets the layer fan out.

```yaml
# Authoritative task list — one entry per task. Block-discovery rule: see "Format contract".
- id: T1                       # unique, stable; appears verbatim in the commit trailer
  title: "<short imperative>"
  slice: "<the vertical slice, one line>"
  files: ["src/foo.ts", "test/foo.test.ts"]   # write-set: explicit file paths and/or dirs (dirs END WITH "/"). NO globs — see disjointness rule.
  deps: []                     # task ids that must be APPROVED before this one starts
  test: "<exact command that validates this task>"
- id: T2
  title: "<...>"
  slice: "<...>"
  files: ["src/bar.ts"]
  deps: [T1]
  test: "<...>"
```

## Out of scope / deferred
- <...>

---
## Format contract (how this file is consumed — keep in sync if you change the shape)

**Block discovery (deterministic).** The task list is the first fenced code block after the
first heading matching `^##\s+Tasks\b` (trailing parenthetical is ignored, so `## Tasks (DAG — …)`
matches too). A fence is a line whose first non-whitespace run is ```` ``` ````; the block runs
from that opening fence to the next closing fence. Parsers MUST anchor fences to start-of-line —
never substring-match a fence token mid-line.

**Task schema.** Each entry is a mapping with EXACTLY these required keys; unknown or duplicate
keys are a validation error:
- `id` — string `^[A-Za-z0-9_-]+$`, **case-sensitive**, unique; must byte-match the commit trailer.
- `title`, `slice`, `test` — non-empty strings (`test` = the exact validation command).
- `files` — a non-empty **sequence** (a bare scalar is an error). Repo-relative POSIX paths; a
  directory entry ENDS WITH `/`, a file entry does not. No globs/wildcards.
- `deps` — a **sequence** of ids (bare scalar is an error); `[]` and a missing key both mean "none".

**Path normalization (lexical; both sides apply it identically).** For each entry: reject if it
is absolute (leading `/`), is the empty string, or contains a `..` segment. Strip a leading `./`;
collapse repeated `/`. If it ends with a single `/`, mark it a **directory** and drop that
trailing slash; otherwise it is a **file**. The result is a non-empty list of `/`-segments plus a
dir/file flag — computed with no filesystem access. (The trailing slash that denotes a directory
is consumed here, so it never counts as an "empty entry".)

**Disjointness (identical on both sides).** Entry A overlaps entry B iff **A == B**, or **either
entry is a directory whose segment list is a prefix of the other's** (a directory matches itself
and everything beneath it; a file matches only an exactly-equal entry). Worked examples: dir
`src/` (`[src]`) overlaps `src/foo.ts` (`[src, foo.ts]`) — `[src]` is a dir-prefix. `src/foo` and
`src/foobar` do **not** overlap (`foo` ≠ `foobar`). A *file* literally named `src` does **not**
overlap `src/foo.ts` (a file matches only itself). The launcher (has fs) MAY additionally expand
directory entries to existing files, but the authoritative same-layer test is this lexical rule,
so launcher and Workflow script always agree. Same-layer tasks whose write-sets overlap run
**sequentially** — not failed. (A *surprise* overlap that only appears at integration triggers the
T4 rebase-and-re-run path.)

**Validation (fail fast before any dispatch):** ids present/unique/well-formed; every `deps` id
resolves; no dependency cycle; every task has the required keys with valid types; every `files`
entry normalizes. The Workflow script enforces all of this **lexically**; the launcher
additionally checks that declared paths resolve on disk.

**Commit trailer / done-set.** Every approved-task commit carries exactly ONE `Dev-Loop-Task: <id>`
**git trailer** (literal id, e.g. `Dev-Loop-Task: T1`). Bookkeeping commits carry none. Extract
from the trailer block ONLY —
`git log <base-sha>..HEAD --format='%(trailers:key=Dev-Loop-Task,valueonly)'` — never grep the
message body. The done-set = the ids so extracted; an id on two commits is an error. `<base-sha>`
is the `Base sha` in `progress.md` (its single source); verify each counted commit with
`git merge-base --is-ancestor <base-sha> <commit>` to reject grafted/rewritten history.

**Authority & precedence.** git is authoritative for the **done-set** only. The git-invisible
fields — `Base sha`, layer cursor, per-task **worktree map**, `runId` — are authoritative in
`progress.md`. For fields duplicated across `plan.md` and `progress.md` (branch, feature worktree
path), `progress.md` wins (it's the live cursor). A persisted `runId` MUST be ignored on a fresh
session (same-session retry optimization only).
