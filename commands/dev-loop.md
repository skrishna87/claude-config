---
description: Resumable, checkpoint-driven execution loop. Parses a feature's plan DAG, validates it, then launches the background Workflow orchestrator (workflows/dev-loop.js) that fans out file-disjoint tasks, gates each with the locked dual-model review, commits with a Dev-Loop-Task trailer, and checkpoints. Survives /clear.
argument-hint: "<feature-name> to start/resume; omit to auto-detect the active feature"
---

# /dev-loop — launch the DAG orchestrator

A **thin launcher**. It orients from git (not memory), finds the repo + feature worktree,
parses and **validates** the task DAG, reconstructs the done-set from commit trailers, builds
the `args` object the orchestrator expects, then calls the **Workflow tool** to run
`workflows/dev-loop.js` in the background. **All per-task logic — fan-out, the review gate,
commit, integrate, checkpoint — lives in the orchestrator; do not duplicate any of it here.**

The invariant that makes `/clear` always safe (the orchestrator maintains it; the launcher only
reconstructs from it):

- **feature-branch commits with a `Dev-Loop-Task: <id>` trailer** = approved tasks
- **per-task worktrees under `<repo>/.dev-loop/worktrees/`** = in-flight tasks
- **`docs/<feature>/progress.md`** = the durable cursor (Base sha, layer cursor, worktree map, runId)

**Prereq:** a plan exists at `docs/<feature>/plan.md` in the `templates/plan.md` format (written
FIRST via `/plan-feature`). Its fenced `tasks:` block is the machine-readable source of truth.

> **Calling the Workflow tool below IS the explicit opt-in to run a background workflow.** That is
> the whole job of this command — do it once the DAG validates, not before.

## 0. Orient (always first — git, not memory)
- Resolve `<feature>` from `$ARGUMENTS`, else auto-detect: the single `docs/*/` whose
  `progress.md` still has non-`done` tasks. If zero or several qualify, ask the user.
- Read `docs/<feature>/plan.md` and (if present) `docs/<feature>/progress.md`.
- Reconstruct state **from git**, not from any prior conversation. progress.md is the cursor for
  the git-invisible fields (Base sha, worktree path, runId); git trailers are authoritative for
  the done-set (§3). Where the two disagree on the done-set, **git wins**.

## 1. Repo + feature worktree
Per the mono-style rule, `$REPO` is the directory that actually holds a `.git` for this code —
the sub-repo / feature worktree, **NEVER the mono root** (e.g. `/home/<you>/projects` is not a
git repo). This is the `git -C` target for every command below and the `repo` arg.

- **Source branch** = where the feature branches from (recorded in plan.md / progress.md;
  default the repo's main branch).
- **Resuming** → use the existing feature worktree + branch; its path is in progress.md. Verify
  it still exists (`git -C "$REPO" worktree list`); if missing, recreate it from the branch.
- **Creating** → make the feature branch + a dedicated feature worktree off the source branch:
  `git -C "<subrepo>" worktree add <worktree-path> -b <branch> <source>`. Copy any gitignored
  `.env` in; recreate `.venv` (`rm -rf .venv && uv sync`) if the project uses one. Record the
  worktree path, branch, source, and base sha (§3) in progress.md.
  From here on, `$REPO` = that **feature worktree** path (absolute).
- **Ensure `.dev-loop/` is gitignored in `$REPO`** (T4 cross-task dependency): the orchestrator
  creates each task's worktree under `<repo>/.dev-loop/worktrees/<id>`, nested inside the feature
  worktree. If `.dev-loop/` is not already ignored, append it to `$REPO`'s `.gitignore` so those
  nested worktrees are never staged as embedded gitlinks, then commit that one-line change on the
  feature branch (a no-trailer bookkeeping commit) **before** computing the base sha in §3.

## 2. Parse + VALIDATE the DAG (fail fast — invalid ⇒ STOP, do not launch)
Parse the `tasks:` block from `docs/<feature>/plan.md` per the **Format contract** at the bottom
of `templates/plan.md`. Apply it exactly; if anything below fails, STOP with a precise error
(which task, which rule) and do **not** call the Workflow.

- **Block discovery:** the first fenced code block after the first heading matching
  `^##\s+Tasks\b` (a trailing parenthetical is ignored). Anchor fences to start-of-line; the
  block runs from the opening fence to the next closing fence.
- **Schema (per task, exactly these keys; unknown/duplicate keys are errors):** `id`
  (`^[A-Za-z0-9_-]+$`, case-sensitive, unique); `title`, `slice`, `test` (non-empty strings);
  `files` (non-empty **sequence**, repo-relative POSIX paths, a dir entry ENDS WITH `/`, no
  globs); `deps` (sequence of ids; missing or `[]` = none).
- **Path normalization (lexical):** reject absolute / empty / any `..` segment; strip a leading
  `./`; collapse repeated `/`; a single trailing `/` marks a directory (and is consumed).
- **Validation rules:** ids present/unique/well-formed; every `deps` id resolves; no dependency
  cycle; required keys present with valid types; every `files` entry normalizes. Then the
  launcher's extra check (it has fs): every declared **file** path resolves on disk, and each
  directory entry exists (or will be created by a task in the layer) — surface, don't silently
  drop, a path that resolves to nothing.
- **Segment-prefix disjointness (for your own sanity check; the orchestrator re-derives it):**
  within a layer, entry A overlaps B iff A == B or either is a directory whose segment list is a
  prefix of the other's. Overlapping same-layer tasks run sequentially (not failed) — that's the
  orchestrator's job, not a launch blocker.

## 3. Done-set from commit trailers (the contract's exact extraction)
- **Base sha** = the `Base sha` recorded in progress.md (its single source). On a fresh feature,
  it's the feature-branch HEAD at loop start (after the `.gitignore` bookkeeping commit in §1);
  record it in progress.md.
- Extract approved ids from the **trailer block only** (never grep the message body):
  ```bash
  git -C "$REPO" log <base-sha>..HEAD --format='%(trailers:key=Dev-Loop-Task,valueonly)'
  ```
  This prints **one line per commit** in the window: a non-empty line is that commit's approved
  task id; a blank line is a bookkeeping commit (no trailer). The same id on two non-empty lines
  is the duplicate-trailer error below.
- For each commit that carries a trailer, verify it descends from the recorded base sha:
  `git -C "$REPO" merge-base --is-ancestor <base-sha> <commit>` — reject grafted/rewritten
  history.
- **Reject duplicate trailers** (the same id on two commits is a contract error → STOP).
- **Ignore non-trailer bookkeeping commits** (checkpoints carry no `Dev-Loop-Task`).
- `done` = the set of ids so extracted.

## 4. Scaffold progress.md if missing
If `docs/<feature>/progress.md` does not exist, create it from `templates/progress.md`: every
task `pending`, the feature worktree path / branch / source, the Base sha, layer cursor
`0/<total-layers>`, and `runId: none`. (The orchestrator rewrites it each checkpoint; you only
seed it so a fresh session can resume.)

## 5. Build `args` (EXACTLY the orchestrator's contract — see `workflows/dev-loop.js` head)
Construct the object the Workflow expects. Required keys (the script throws on any missing/empty
one): `repo`, `baseSha`, `planPath`, `progressPath`, `reviewGate`, `tasks`. Use **absolute**
paths (agents get no cwd):

```js
args = {
  repo:            "<abs path to the FEATURE WORKTREE>",   // $REPO; git -C target; .dev-loop/ nests here
  featureBranch:   "<branch name being built>",            // logging/checkpoint only
  baseSha:         "<base-sha from §3>",                    // first layer-base + progress.md Base sha
  planPath:        "<abs path to docs/<feature>/plan.md>",  // briefed to checkpoint agent as authoritative (it must NOT edit it)
  progressPath:    "<abs path to docs/<feature>/progress.md>", // the cursor the checkpoint agent rewrites
  glossary:        "<verbatim 'Domain glossary' section text from plan.md>",   // briefed to every worker; omit ⇒ '(none provided)'
  lockedDecisions: "<verbatim 'Locked decisions' section text from plan.md>",  // briefed to every worker; omit ⇒ '(none provided)'
  reviewGate:      "<the FULL VERBATIM TEXT of commands/review-task.md>",       // see note below
  tasks: [ { id, title, slice, files: ["..."], deps: ["..."], test }, ... ],   // every task, the T1 schema
  done:  ["T1", ...],   // ids from §3; the orchestrator excludes these from work
};
```

- **`reviewGate` MUST be the literal text** of `~/.claude/commands/review-task.md` (read the file
  and inline its contents), **not a path** — the orchestrator embeds it verbatim into the gate
  agent's prompt and has no filesystem to resolve a path. This is how the launcher "supplies the
  gate" to the per-task review the orchestrator runs.
- Pass **all** tasks (not just the remaining ones) plus `done`; the orchestrator computes the
  remaining layers itself from `tasks` minus `done`. `glossary`/`lockedDecisions` are the raw
  section texts from plan.md (so context-less workers share the same terms + locked choices).

## 6. Launch the Workflow (background)
Call the **Workflow tool** with:
```
Workflow({ scriptPath: "<abs path to workflows/dev-loop.js>", args })
```
This is a **background** run (the orchestrator drives every task to done with no `/clear` pump).
Tell the user it's launched and that you'll report when it completes. Do not re-implement,
re-review, or commit anything yourself — the orchestrator owns all of that.

The run returns `{ approved: [...ids], blocked: [{id, reason}], finalHead, layers, coverageNotes }`.

## 7. Resume semantics
- **ALWAYS** reconstruct remaining work from **git trailers + progress.md** (§0–§5) and launch a
  **fresh** Workflow. This is the only path that survives `/clear`.
- Use `resumeFromRunId` **only** to optimize a same-session retry (you still hold the runId in
  this conversation). A persisted `runId` in progress.md is **ignored** on a fresh session — never
  resume from it post-`/clear`.

## 8. Completion
- Report the run result: tasks **approved** this run, tasks **blocked** (with reasons), and any
  **DEGRADED** review coverage (codex was down for some gate) from `coverageNotes` — surface the
  degrade, never hide it.
- If any task is blocked, the loop stopped short: relay the blockers, point at the current
  progress.md, and let the user fix/rerun. Re-running `/dev-loop <feature>` reconstructs from git
  and retries only the unfinished work.
- When **every** task is approved (no blockers, `done` ∪ `approved` covers the DAG): tell the user
  to do their final review / manual test. Show `git -C "$REPO" log --oneline <base-sha>..HEAD`. On
  their **explicit** confirmation, fast-forward `<branch>` onto `<source>` (and push **only** if
  they ask). **Never fast-forward or push without explicit confirmation.**

## Notes
- Thin launcher: per-task fan-out, the dual-model gate, commit-on-pass, integrate, and checkpoint
  all live in `workflows/dev-loop.js`. Don't reimplement them here.
- The locked review gate is `commands/review-task.md`, supplied to the orchestrator via
  `args.reviewGate`. Do not pull in any other reviewer plugin/skill.
- git is the source of truth for the done-set; progress.md owns the git-invisible cursor fields.
  Both are reconstructed every launch, so a `/clear` costs at most the work of one in-flight task.
