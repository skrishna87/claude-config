# claude-config — portable checkpoint-driven dev loop

My Claude Code workflow for long-running feature work, made clone-able across machines.
The whole thing is built so a single feature can span many fresh sessions (`/clear`
between them) **without ever relying on context compaction**.

## The flow

```
brainstorm → spec/plan → save to docs/<feature>/{plan.md,progress.md}
        │
        ▼
   /dev-loop <feature>        ◀── run at the start of every fresh session
        │
        ├─ orient from git + progress.md (not memory)
        ├─ ensure isolated worktree + branch
        ├─ pick next unchecked task
        ├─ implement it  (subagent per task → main context stays lean)
        ├─ REVIEW GATE   (/review-task: Claude self + codex, consolidated)
        ├─ on pass: commit (provisional, in worktree) + tick checkbox + rewrite progress.md
        └─ continue, or "checkpoint saved — /clear then /dev-loop <feature>"
        │
        ▼
   all tasks done → you do final review / manual test → confirm
        │
        ▼
   agent fast-forwards <branch> onto <source>  (+ push if you ask)
```

### The invariant (why `/clear` is always safe)

At every task boundary:

| Artifact | Meaning |
|---|---|
| feature-branch **commits** | approved tasks (each passed the review gate) |
| **working tree** | the current task in flight (or clean) |
| `docs/<feature>/progress.md` | the cursor — done / next / gotchas / how to resume |

Checkpoint **after every task** (cheap). `/clear` only **occasionally** (it's the one
expensive thing). A clear costs at most one in-flight task.

## What's here

| Path | Role |
|---|---|
| `commands/dev-loop.md` | `/dev-loop` — the resumable orchestrator |
| `commands/review-task.md` | `/review-task` — the locked dual-model review gate |
| `rubrics/per-task-review.md` | shared rubric fed verbatim to BOTH reviewers |
| `templates/{plan,progress}.md` | starting points for `docs/<feature>/` |
| `bootstrap.sh` | symlinks the above into `~/.claude` (idempotent, per-file) |

## The review gate

Two independent reviewers judge the **same diff** by the **same rubric**, then results are
consolidated (disagreements get investigated, not averaged):

- **Reviewer A — Claude (self):** a dispatched subagent.
- **Reviewer B — codex (cross-model / GPT):**
  ```bash
  codex exec -C "$REPO" -s read-only -o /tmp/codex-review.md \
    "$(cat ~/.claude/rubrics/per-task-review.md)
     Run 'git diff' to see the UNCOMMITTED changes and review ONLY those."
  ```
  `-C "$REPO"` points codex at the actual git sub-repo — **never the mono root**
  (`/home/rsai/projects` isn't a git repo; running codex there is the "no git initiated"
  failure). `-s read-only` lets it read surrounding code without writing.

This is deliberately **locked** — the loop ignores other reviewer plugins
(pr-review-toolkit, feature-dev:code-reviewer, `/code-review`, …) so per-task results are
reproducible. Those stay available for ad-hoc deep dives outside the loop.

## Setup on a new machine

```bash
git clone <this-repo> ~/projects/claude-config
~/projects/claude-config/bootstrap.sh
```

Then ensure the external deps:
- **codex CLI** on PATH and authed: `codex --version && codex login`
- **git** with worktree support

`bootstrap.sh` makes per-file symlinks into `~/.claude`, so your other commands, skills,
and plugins are untouched. To track those too later, add them to this repo and extend
`bootstrap.sh`.

### Plugins
Claude plugins are installed via the marketplace, not committed here. A snapshot of the
current set lives in `installed_plugins.snapshot.json`; re-install via `/plugin` in Claude
Code on a new machine.

## Conventions this assumes
- **Mono-style repos** (a root holding independent git sub-repos): work is gated behind a
  worktree under `.worktrees/<repo>/<branch>` at the mono root.
- **Per-task commits** accumulate on the feature branch; you review the whole branch at the
  end, then the agent fast-forwards onto source.
- **Plan = checklist.** Progress = a self-contained resume cursor. Conversation memory is
  never the source of truth.
