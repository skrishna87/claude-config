# claude-config — DAG-driven, checkpoint-driven dev loop

My Claude Code workflow for long-running feature work, made clone-able across machines.
The whole thing is built so a single feature can be planned once, then driven to done by a
**background orchestrator** that fans out independent work — and resumed across fresh sessions
(`/clear` between them) **without ever relying on context compaction**.

It is **self-contained**: no superpowers plugin, no skills it can't live without. `codex` is
*optional* — the review gate hardens against it being down.

## The pipeline

```
  idea
   │
   ▼
/plan-feature <idea>      ── grill the idea until every decision branch is locked, then
   │                          emit docs/<feature>/plan.md: Locked decisions + Domain glossary
   │                          + a machine-readable task DAG (deps + declared write-sets).
   │                       You review the plan. Then:
   ▼
/dev-loop <feature>       ── a THIN launcher: orient from git (not memory), ensure the feature
   │                          worktree, parse + VALIDATE the DAG, rebuild the done-set from
   │                          commit trailers, then call the Workflow tool to run the
   │                          background orchestrator (workflows/dev-loop.js). No per-task
   │                          logic lives here.
   ▼
 orchestrator (background) ── walks the DAG layer by layer:
   │
   │   for each topological LAYER (width = # of file-disjoint tasks → the "1→2→1→3" fan-out):
   │     ├─ provision a per-task worktree from the layer-base SHA   (current feature HEAD)
   │     ├─ FAN OUT the disjoint tasks (conflicting ones run sequentially):
   │     │     implement (fresh-context worker, only its slice + write-set + glossary)
   │     │       → REVIEW GATE  (dual-lens; ≤2 fix→review cycles)
   │     │       → commit-in-worktree with a `Dev-Loop-Task: <id>` trailer  (= approved)
   │     ├─ INTEGRATE approved commits onto the feature branch, in order
   │     │     (a surprise overlap ⇒ rebase the loser + re-run on the new base)
   │     └─ CHECKPOINT: rewrite progress.md + a NO-trailer bookkeeping commit (tree clean)
   ▼
 all tasks approved → you do final review / manual test → confirm
   │
   ▼
 agent fast-forwards <branch> onto <source>   (+ push only if you ask)
```

A failed task (gate block, dead agent, unresolvable conflict) is **skipped, not fatal**: only
its dependents are pruned; independent branches keep moving. Blockers are reported at the end.

## The load-bearing ideas

- **The DAG plan.** `/plan-feature` doesn't emit a checklist — it emits a graph. Each task
  declares `deps` (what must be approved first) and `files` (its **write-set**). Topologically
  sorting on `deps` gives **layers**; a layer's width is its fan-out. Choosing write-sets to be
  disjoint within a layer is what *makes* the fan-out — that's why planning maximizes disjoint
  width (the dogfood plan produced `3 → 2 → 1 → 1 → 1`).

- **The plan is grounded before it runs.** `/dev-loop` §3.5 greps every *remaining* task's slice
  against the real code before fan-out: a referenced symbol that exists nowhere (a phantom API like
  `CurrentRevision` for the real `GetWithRevision`), an edit-target path outside the declared
  write-set, or an "everywhere" invariant with no enumerated call sites ⇒ **STOP, don't launch**.
  Each of these otherwise surfaces only *after* a full implement→review cycle and forces a relaunch
  — catching it at launch is ~10× cheaper. `/phase-translate` bakes the same three checks into plan
  authorship, so a plan born from a higher-level spec passes the pre-flight first try.

- **Disjoint-or-sequential fan-out.** Same-layer tasks run in parallel **only** if their
  write-sets are provably disjoint (a lexical segment-prefix rule: dir `src/` overlaps
  `src/foo.ts`; `src/foo` and `src/foobar` don't). Overlapping same-layer tasks aren't an error —
  they just run **sequentially** so two agents never edit the same file at once.

- **Per-task worktrees from the layer-base SHA.** Each task gets its own ephemeral git worktree
  created from the **recorded layer-base SHA** (= the feature HEAD after the previous layer
  integrated + checkpointed) via `git worktree add <path> <sha>`, so it inherits every prior
  layer's commits — *including unpushed ones*. (We do **not** use the Workflow `isolation:'worktree'`
  default, whose `fresh`/`head` base ref would branch from `origin/<default>` and drop those
  unpushed dependency commits.) Workers operate with absolute paths + `git -C`; the script itself
  has no fs/git — **every** side effect runs through a dispatched agent.

- **The hardened dual-lens gate.** Two complementary lenses judge the same diff by the same
  rubric: Lens A = a Claude rubric-correctness review; Lens B = an **adversarial** lens that is
  the **codex (cross-model / GPT)** reviewer when codex is healthy, **else** a divergent-persona
  ("hostile implementer/parser") Claude reviewer. codex is **preflighted once** (auth/health probe
  with a hard timeout), runs with **backoff retries + per-attempt timeout + a unique output path**,
  and on any failure the gate **falls back** so two-lens coverage is always restored. The verdict's
  `Coverage:` line **always** states CROSS-MODEL vs DEGRADED — the degrade is loud, never hidden.

- **Trailer-based done-set (the resumable invariant).** An approved task = a feature-branch commit
  carrying exactly one `Dev-Loop-Task: <id>` **git trailer**. Checkpoints are **no-trailer**
  bookkeeping commits. The done-set is reconstructed from the **trailer block only**
  (`git log <base>..HEAD --format='%(trailers:key=Dev-Loop-Task,valueonly)'`), each commit verified
  to descend from the recorded base SHA, duplicate trailers rejected. So git is authoritative for
  *what's done*; `progress.md` holds only the git-invisible cursor fields (Base sha, layer cursor,
  worktree map, runId).

- **Resume = relaunch a fresh Workflow.** Recovery after `/clear` **always** reconstructs the
  remaining DAG from git trailers + progress.md and launches a brand-new Workflow run. The Workflow
  `resumeFromRunId` is a **same-session-only** optimization — a persisted `runId` is *ignored*
  across sessions. So a `/clear` costs at most one in-flight task.

- **Self-contained / zero superpowers.** Both commands spell out their rituals inline (alignment
  grilling, planning, the gate) — no plugin/skill dependency — so the loop stays portable.

## The invariant (why `/clear` is always safe)

At every layer boundary:

| Artifact | Meaning |
|---|---|
| feature-branch commit with a `Dev-Loop-Task: <id>` trailer | an approved task (passed the gate) |
| per-task worktree under `<repo>/.dev-loop/worktrees/` | a task in flight |
| feature-branch **no-trailer** commit | a bookkeeping checkpoint (progress.md rewrite) |
| `docs/<feature>/progress.md` | the durable cursor — Base sha / layer cursor / worktree map / runId |

The orchestrator maintains this; a fresh `/dev-loop` only reconstructs from it. A `/clear` costs
at most the work of one in-flight task.

## What's here

| Path | Role |
|---|---|
| `commands/plan-feature.md` | `/plan-feature` — self-contained alignment grilling + emits the DAG `plan.md` |
| `commands/phase-translate.md` | `/phase-translate` — translate ONE phase of a higher-level spec into a **grounded** DAG `plan.md` (symbols/write-sets/invariants verified against landed code) |
| `commands/dev-loop.md` | `/dev-loop` — thin launcher: validate the DAG (incl. §3.5 semantic pre-flight), then call the Workflow |
| `workflows/dev-loop.js` | the background **orchestrator**: layer fan-out, gate, commit, integrate, checkpoint |
| `commands/review-task.md` | `/review-task` — the locked **dual-lens** review gate (Claude + codex/fallback) |
| `rubrics/per-task-review.md` | shared rubric fed verbatim to BOTH lenses (incl. the write-set / scope-creep rule) |
| `templates/plan.md` | the plan format + the **Format contract** appendix (block-discovery, schema, disjointness, trailer) |
| `templates/progress.md` | the resume-cursor format for `docs/<feature>/progress.md` |
| `bootstrap.sh` | symlinks all of the above into `~/.claude` (idempotent, per-file) |

Cross-file references inside the commands point at the **bootstrap-symlinked `~/.claude/...`**
locations (the commands run from *your* project, not this repo) — e.g. the launcher's Workflow
`scriptPath` is `~/.claude/workflows/dev-loop.js` and it reads the gate from
`~/.claude/commands/review-task.md`.

## The review gate (detail)

Two **complementary lenses** judge the **same diff** by the **same rubric**, then results are
consolidated (disagreements get investigated, not averaged):

- **Lens A — rubric-correctness:** a Claude self-review against `~/.claude/rubrics/per-task-review.md`.
- **Lens B — adversarial cross-model:** the **codex** (GPT) reviewer when it's healthy, **else** a
  divergent-persona ("hostile implementer / hostile parser") Claude reviewer. An adversarial pass
  is in **every** gate — dogfooding caught a spec the plain rubric reviewer PASSED but the
  hostile-parser lens correctly FAILED for machine-ambiguity.

  ```bash
  # codex is preflighted once, then run with a hard timeout + unique output path + backoff:
  codex exec -C "$REPO" -s read-only -o "/tmp/dev-loop/${RUN}-${TASK}-${attempt}.md" \
    "$(cat ~/.claude/rubrics/per-task-review.md) ...ADVERSARIAL LENS... review ONLY 'git diff'."
  ```
  `-C "$REPO"` points codex at the actual git sub-repo / worktree — **never the mono root**
  (a non-git dir is the "no git initiated" failure). `-s read-only` lets it read surrounding code
  without writing.

This gate is deliberately **locked** — the loop ignores other reviewer plugins
(pr-review-toolkit, feature-dev:code-reviewer, `/code-review`, …) so per-task results are
reproducible. Those stay available for ad-hoc deep dives outside the loop.

## Setup on a new machine

```bash
git clone <this-repo> ~/projects/claude-config
~/projects/claude-config/bootstrap.sh
```

`bootstrap.sh` makes per-file symlinks into `~/.claude` (commands, the workflow, templates,
rubric), so your other commands, skills, and plugins are untouched. Then ensure the deps:

- **A Workflow-capable Claude Code** (the Workflow tool) — **required**; it runs the background
  orchestrator.
- **git** with worktree support — **required**.
- **codex CLI** on PATH and authed (`codex --version && codex login`) — **optional**. Without it,
  the gate falls back to a divergent-persona Claude reviewer and flags coverage as DEGRADED.

### Plugins
Claude plugins are installed via the marketplace, not committed here. A snapshot of the current
set lives in `installed_plugins.snapshot.json`; re-install via `/plugin` in Claude Code on a new
machine.

## Conventions this assumes
- **Mono-style repos** (a root holding independent git sub-repos): `$REPO` is the actual sub-repo /
  feature worktree that holds a `.git`, **never the mono root** (which isn't a git repo).
- **Per-task commits** (each carrying a `Dev-Loop-Task` trailer) accumulate on the feature branch;
  you review the whole branch at the end, then the agent fast-forwards onto source **only on your
  explicit confirmation**.
- **Plan = the DAG.** plan.md has no checkboxes — live status lives in `progress.md` + git
  trailers. Conversation memory is never the source of truth.
