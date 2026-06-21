# <Feature> — Progress (resume cursor)

> Read this first, then `plan.md`. A fresh session needs ONLY this + `plan.md` + git — no prior
> conversation. **Authority:** git (commit trailers) owns the done-set; THIS file owns the
> git-invisible fields — `Base sha`, layer cursor, worktree map, `runId`. The task-status table
> is a human-readable mirror of git, rewritten each checkpoint by a no-trailer bookkeeping commit.
> Last updated: <date>

## Where we are
- Feature worktree: `<path>`   Branch: `<branch>`   Source: `<branch>`
- Base sha: `<sha>`            Layer cursor: `<n>/<total-layers>`
- Workflow runId: `<id | none>`   (same-session retry optimization only — never used across `/clear`)

## Task status
> done = trailer commit exists · in-flight = a worktree holds uncommitted work ·
> blocked = gate failed or a dependency is blocked · pending = not started.

| id | status | worktree | notes |
|----|--------|----------|-------|
| T1 | pending | — | |
| T2 | pending | — | |

> `worktree` = the task's worktree path while in-flight (where uncommitted work lives so resume
> can find it); `—` once merged/cleaned.

## Gotchas
- <env traps, exact build/test commands, anything that bit us — esp. things a fan-out agent
  can't infer without conversation context>

## How to resume
Run `/dev-loop <feature>`. It reconstructs the done-set from git commit trailers, recomputes the
remaining DAG, and launches a **fresh** Workflow (any prior `runId` is ignored across sessions).
