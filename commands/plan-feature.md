---
description: Self-contained feature planner — grills the idea until every decision is locked, then emits docs/<feature>/plan.md (Locked decisions + Domain glossary + vertical-slice DAG) in the exact format /dev-loop consumes. No superpowers/skills.
argument-hint: "<feature idea, in your own words> — the thing you want to build"
---

# /plan-feature — align, then plan (self-contained)

Turn a feature idea into `docs/<feature>/plan.md` in the **exact** shape the launcher parses
(`templates/plan.md`). This command is deliberately **standalone**: it calls no skill and no
plugin — the alignment + planning rituals are spelled out inline below so the loop stays
portable. Output only; you scaffold nothing else (the `/dev-loop` launcher writes `progress.md`).

The plan you emit is read by **context-less fan-out agents** who never saw this conversation.
So every resolved choice, every shared term, and every task slice must stand on its own. Plan
for that reader, not for yourself.

## 0. Orient
- Resolve `<feature>` = a short kebab-case slug from `$ARGUMENTS` (e.g. "rate limit the API" →
  `api-rate-limit`). Confirm the slug with the user in your first message.
- If `docs/<feature>/plan.md` already exists, STOP and ask whether to revise it — never silently
  overwrite a plan a loop may be mid-execution on.
- Read `~/.claude/templates/plan.md` for the format contract you must emit. Do **not** start writing the
  plan until the alignment gate (§1) is fully resolved.

## 1. Alignment gate (grill — one question at a time)
Measure twice. Interview the user until **every open decision branch is resolved** — not merely
"enough to start." A vague answer here becomes an ambiguity a fan-out agent re-litigates (or
guesses wrong on) with no way to ask you. Drive these to ground:

- **Goal & success criteria** — what does "done and correct" look like, observably? What's the
  one-line reason this is worth doing?
- **Unstated constraints** — required libraries/patterns/versions, perf or compat budgets, things
  that must NOT change, conventions to match.
- **Decision branches** — every fork where a reasonable engineer could pick differently (storage,
  API shape, sync vs async, where code lives, error behavior). Each fork must be *closed*, with a
  reason — that reason is the antibody against re-litigation.
- **Out of scope** — what you're explicitly NOT doing, and what's deferred.

Rules for the grilling:
- **One question at a time.** Ask, get the answer, let it reshape your next question. Do not
  batch a questionnaire — batching lets ambiguities hide.
- Prefer sharp either/or questions ("Postgres or in-memory for the counter?") over open ones.
- When the user says "you decide," decide, state the choice + why, and move on — a closed branch.
- Surface assumptions you're carrying and get them confirmed or corrected.
- **Don't stop early.** Continue until you can't find another fork that a context-less implementer
  could resolve differently. Then say so and move to §2.

When the gate closes, restate the resolved picture in 3-6 bullets and get a final "yes" before
planning. Each resolved fork becomes a **Locked decision** (the choice **and its why**).

## 2. Domain glossary
Coin a few (≈3-8) concise shared terms for the nouns/roles this feature introduces, so parallel
agents who share no conversation still speak the same language (e.g. naming the same concept two
ways across tasks is how disjoint slices silently collide). One line each. These go in the plan.

## 3. Vertical-slice DAG
Decompose into tasks. **Each task is a vertical slice**: independently implementable, reviewable,
and committable on its own — not a horizontal layer ("all the types", "all the tests"). A slice
carries its own test.

For each task produce: `id` (unique, stable, e.g. `T1`), `title` (short imperative), `slice`
(the vertical cut, one line), `files` (the declared **write-set**), `deps` (task ids that must be
**approved** first), `test` (the exact command that validates it).

**The disjointness design rule (this is what makes fan-out possible).** Tasks in the *same
dependency layer* (same depth in the DAG) run in parallel ONLY if their write-sets are provably
disjoint. So **deliberately choose each task's `files` so same-layer tasks don't overlap.** Two
tasks that must both edit `src/app.ts` belong in different layers (chain them with a `dep`), or
split that file's responsibilities so each owns a distinct path. Overlap within a layer isn't an
error — it just forces those tasks to run sequentially, narrowing the fan-out. Maximize disjoint
width.

Overlap is computed by the contract's **segment-prefix rule** — apply it yourself while choosing
write-sets:
- Normalize each path lexically: reject absolute paths, empty strings, and any `..` segment;
  strip a leading `./`; collapse repeated `/`. A trailing `/` marks a **directory** (then drop
  the slash); otherwise it's a **file**. Result = a list of `/`-segments + a dir/file flag.
- Two entries **overlap** iff they're equal, OR either is a **directory whose segment list is a
  prefix of the other's**. So dir `src/` overlaps `src/foo.ts`; `src/foo` and `src/foobar` do
  **not** overlap; a *file* literally named `src` does **not** overlap `src/foo.ts`.

Path rules for `files` (enforced by the parser — get them right or the launcher rejects the plan):
- Repo-relative POSIX paths. **Directories END WITH `/`**; files do not. **No globs/wildcards.**
- `files` is a non-empty sequence; `deps` is a sequence of ids (`[]` = none).

Prefer the narrowest write-set that still makes the slice self-contained (a task that declares a
whole dir `src/` blocks every other task touching anything under `src/` from sharing its layer).

## 4. Emit `docs/<feature>/plan.md`
Write the file in the **exact shape of `templates/plan.md`** — same section order and headings:

1. `# <Feature> — Plan` + the blockquote header (what we're building; the `tasks` block is the
   machine-readable source of truth; live status lives in `progress.md`/git, not here).
2. `## Context / goal` — 1-3 lines: the change and why.
3. `## Locked decisions` — every resolved fork from §1, **each with its why**.
4. `## Domain glossary` — the §2 terms.
5. `## Tasks (DAG)` — the blockquote, then a **single fenced ```yaml block** that is the first
   fenced block after that heading. One entry per task with EXACTLY the required keys
   (`id, title, slice, files, deps, test`) — no extra or duplicate keys. Match the template's
   field style verbatim. Keep every value a **single-line scalar** (no block scalars, no
   fenced/backtick content inside a value) so a stray start-of-line fence can't close the block early.
6. `## Out of scope / deferred` — from §1.
7. A horizontal rule, then the **`## Format contract` appendix copied verbatim from
   `~/.claude/templates/plan.md`** (so the plan is self-describing for whoever consumes it). Copy it
   as-is; do not paraphrase.

Optionally add a small "Layering that falls out" table (layer → width → tasks → why) showing the
fan-out shape — useful, not required.

## 5. Validate before finishing (fail fast)
Re-read your `tasks` block and check, lexically, exactly what the launcher will check:
- **ids**: present, unique, case-sensitive, match `^[A-Za-z0-9_-]+$`.
- **deps**: every id resolves to a real task; **no cycles** (topologically sortable).
- **schema**: every task has all required keys, correct types (`files` & `deps` are sequences,
  not bare scalars; `files` non-empty; `title`/`slice`/`test` non-empty strings).
- **paths**: every `files` entry normalizes (not absolute, no `..`, non-empty); dirs end with `/`,
  no globs.
- **disjointness**: within each dependency layer, no two tasks' write-sets overlap by the
  segment-prefix rule. If any do, either re-split the files or add a `dep` to push one into a
  later layer (and note in `slice`/comment why) — then re-check.

If anything fails, fix the plan and re-validate. Do not hand the user a plan that won't parse.

## 6. Hand off
Tell the user the plan is written, point them at `docs/<feature>/plan.md`, and ask them to review
it (especially Locked decisions + the layering). Then: **"Looks right? Run `/dev-loop <feature>`
to scaffold `progress.md` and start execution."** Do not start the loop yourself — review is the
user's gate.
