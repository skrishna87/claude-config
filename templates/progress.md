# <Feature> — Progress (resume cursor)

> Read this first, then plan.md. A fresh session needs ONLY this + plan.md — no prior conversation.
> Last updated: <date>

## Where we are
- Worktree: <path>   Branch: <branch>   Base: <sha>   Source: <branch>
- Published: <remote>/<branch> | no
- Approved tasks (committed): <n>/<m> — see `git log <base>..HEAD`
- In flight: <none | task k: partial state>

## Next
- [ ] task <k>: <text> — <why next>

## Gotchas
- Verify: `<command>` — <scoped variant for fast per-task runs, if any>
- <env traps, anything that bit us>

## How to resume
Run `/dev-loop <feature>` — it reconstructs the done-set from git + this cursor and continues
(spawning one orchestrator per remaining task).
