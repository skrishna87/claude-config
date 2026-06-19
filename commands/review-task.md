---
description: Locked dual-model review gate (Claude self + codex) over the current task's diff. The ONLY per-task reviewer /dev-loop uses.
argument-hint: "[optional: repo/worktree path or scope note]"
---

# /review-task — locked dual-model review gate

The single, consistent review step. **Ignore every other reviewer plugin/skill here**
(pr-review-toolkit, feature-dev:code-reviewer, `/code-review`, code-simplifier, …) —
this gate is deliberately locked so results are reproducible across tasks and sessions.

Two **complementary lenses** judge the SAME diff by the SAME rubric, then you consolidate:
- **Lens A — rubric-correctness:** a Claude self-review against the rubric.
- **Lens B — adversarial cross-model:** the **codex** (GPT) reviewer when it's healthy,
  ELSE a divergent-persona Claude fallback. Either way Lens B always carries a **hostile
  implementer/parser** mindset (below).

**Why the hostile lens is mandatory, always.** Dogfooding caught a case where the plain
rubric reviewer PASSED a spec that an adversarial "hostile-parser" reviewer correctly
FAILED for machine-ambiguity. So an adversarial pass must be represented in EVERY gate —
even when codex is up. It rides on Lens B's prompt; if codex is down, the Claude fallback
inherits it. Never run a gate with two identical generic lenses.

## 1. Establish scope + repo
- **Scope** = the current task = the **unstaged** working-tree changes (prior approved
  tasks are already committed, so they're out of scope automatically).
- Find the **git repo dir** holding the changes — the dir with a `.git`. In a mono-style
  repo this is the sub-repo / worktree, **NEVER the mono root** (`/home/rsai/projects`
  is not a git repo — running codex there is what caused the past "no git" failure).
  Call it `$REPO`.
- Capture the diff: `git -C "$REPO" diff` (unstaged). If empty, try `--staged`. If still
  empty, there's nothing to review — say so and stop.
- `$ARGUMENTS` may override `$REPO` or the scope.

## 2. Load the rubric + set run identity
- Read `~/.claude/rubrics/per-task-review.md`. **Both lenses get it verbatim.**
- The §4 block sets its OWN run identity (`RUN`, sanitized `TASK`) so it is self-contained and
  safe to copy-run — never rely on a variable assigned only in prose. These names only make codex
  output files unique so parallel gates (fan-out) never collide; export a real `runId`/`TASK` in
  the environment when you have one.

## 3. codex preflight (once per run)
Probe ONCE — never retry-storm a dead binary:
```bash
codex_up=0
if command -v codex >/dev/null 2>&1; then
  # fast auth/health probe with a hard timeout; trivial prompt, read-only
  if timeout -k 10 30 codex exec -s read-only --skip-git-repo-check \
       "reply with the single word: OK" >/dev/null 2>&1; then
    codex_up=1
  fi
fi
```
- `codex_up=1` → Lens B = real cross-model codex (§4).
- `codex_up=0` (absent, unauthed, or probe timed/errored) → **skip straight to the Claude
  fallback** (§5). Do NOT attempt the codex review loop.

## 4. Run the lenses (in parallel)
**Lens A — Claude rubric-correctness (always):** dispatch a `general-purpose` subagent with
the rubric, the task description + plan reference, and the diff. Tell it to read neighboring
code in `$REPO` for context but to judge ONLY the diff. Hand it crafted context — **not**
your session history. Require the rubric's output format ending in `VERDICT: PASS/FAIL`.

**Lens B — codex cross-model (only if `codex_up=1`):** run with a **hard per-attempt
timeout** and a **unique output path**, with **bounded backoff retries**. codex once HUNG
5+ minutes on a trivial diff, so a single attempt must never stall the gate.
```bash
mkdir -p /tmp/dev-loop
RUN="$(printf '%s' "${runId:-$$}" | tr -c 'A-Za-z0-9_-' '_')"   # self-contained + sanitized (flows into path/glob)
TASK="$(printf '%s' "${TASK:-task}" | tr -c 'A-Za-z0-9_-' '_')"   # sanitize: it flows into a path + glob
codex_ok=0 out=""
for attempt in 1 2 3; do
  out="/tmp/dev-loop/${RUN}-${TASK}-${attempt}.md"   # unique per run/task/attempt
  args=(exec -C "$REPO" -s read-only -o "$out")
  [ "$attempt" -ge 2 ] && args+=(--skip-git-repo-check)   # git-error retry from prior runs
  if timeout -k 10 120 codex "${args[@]}" \
       "$(cat ~/.claude/rubrics/per-task-review.md)

ADVERSARIAL LENS: review as a HOSTILE IMPLEMENTER/PARSER. Assume any ambiguity will be
read the worst plausible way and any unstated case will break. Flag machine-ambiguity,
underspecified contracts, and silent-failure paths — not just rubric violations.

Run 'git diff' to see the UNCOMMITTED changes and review ONLY those." && [ -s "$out" ]; then
    codex_ok=1; break    # success REQUIRES a non-empty report — else we'd fake cross-model
  fi
  sleep $((attempt * 5))   # 5s, 10s backoff between attempts
done
if [ "$codex_ok" = 1 ]; then cat "$out"; fi
rm -f /tmp/dev-loop/${RUN}-${TASK}-*.md   # cleanup; NEVER reuse a shared /tmp file
```
- `-C "$REPO"` points codex at the real git dir; `-s read-only` lets it introspect
  surrounding code without writing.
- If all attempts time out / error / produce an empty report (`codex_ok=0`), treat codex as
  failed → **fall to §5** so dual coverage is restored. Never proceed Lens-A-only without the
  fallback, and never count an empty codex run as cross-model coverage.

## 5. Fallback — divergent-persona Claude (when codex is down or failed)
Dispatch a SECOND, fresh `general-purpose` subagent — **distinct from Lens A** — as Lens B.
Same rubric verbatim, PLUS this persona so it genuinely diverges instead of echoing Lens A:
> You are a **hostile implementer / hostile parser**. Read every line assuming the worst
> plausible interpretation: where could a literal implementation diverge from intent, where
> is a contract machine-ambiguous, where does an unstated edge case break it, where does an
> error get silently swallowed? Be adversarial — prefer a false FAIL you can justify over a
> polite PASS. Same output format, ending in `VERDICT: PASS/FAIL`.

This restores two-lens coverage, but it is **Claude-only (no cross-model signal)** — flag it (§7).

## 6. Consolidate
- Merge both lists; dedupe findings that are the same `file:line` / issue.
- Where the lenses **disagree** (one flags, the other doesn't), investigate the flagged
  item yourself and decide — disagreements are where blind spots hide, so don't average
  them away. (The dogfood failure lived exactly here: only the adversarial lens caught it.)
- Assign final severity per the rubric.

## 7. Verdict
Emit a compact block. The **Coverage** line is mandatory — it ALWAYS states whether true
cross-model (codex/GPT) coverage held or degraded to Claude-only. Never silently drop a lens.
```
REVIEW: <feature> / <task>
  Coverage: CROSS-MODEL (Claude + codex/GPT) | DEGRADED — Claude-only (codex <absent|unauthed|timeout|errored>)
  Lens A (rubric): <Crit/Imp/Min>   Lens B (adversarial): <Crit/Imp/Min>
  Blocking: <Critical+Important findings with file:line, or "none">
  VERDICT: PASS | FAIL
```
**PASS** = zero unresolved Critical or Important. Minor issues are noted, not blocking.
A DEGRADED run can still PASS — but the degrade is stated loudly, never hidden.
