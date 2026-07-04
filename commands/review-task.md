---
description: Locked review gate — cross-model rubric review (Claude self + GPT via the opencode bridge) plus dedicated security and leanness passes, over a task's diff or a whole feature. The ONLY reviewer /dev-loop uses.
argument-hint: "[repo/worktree path] [--integration <base-ref> for a whole-feature review] [--re-review after a fix cycle, with the prior blocking findings]"
---

# /review-task — locked review gate

The single, consistent review step. **Ignore every other reviewer plugin/skill here**
(pr-review-toolkit, feature-dev:code-reviewer, `/code-review`, code-simplifier, …) — this gate
is deliberately locked so results are reproducible across tasks and sessions. Independent
reviewers judge the SAME diff by the SAME rubric; you consolidate.

## 1. Establish scope + repo

- **Find the git repo dir** holding the changes — the dir with a `.git`. In a mono-style repo
  this is the sub-repo / worktree, **NEVER the mono root** (running the cross-model reviewer at
  a non-git root is what caused the past "no git" failure). Call it `$REPO`.
- **Scope** depends on the fixed-point:
  - **Per-task (default)** — the current task = the **unstaged** working-tree changes (prior
    approved tasks are already committed, so out of scope automatically).
    Diff: `git -C "$REPO" diff` (if empty, try `--staged`; if still empty, nothing to review —
    say so and stop).
  - **Integration (`--integration <base>`)** — the **whole feature** so far, to catch
    cross-task contract drift and composition bugs no single task diff shows.
    Diff: `git -C "$REPO" diff <base>...HEAD` (three-dot, against the merge-base).
  - **Re-review (`--re-review`)** — a fix-cycle re-gate. The caller passes the prior verdict's
    blocking findings AND the **pre-fix diff snapshot** (the diff as it stood when the failing
    review ran, saved by the orchestrator at FAIL time, e.g. `$REPO/.dev-loop/review-cycle-0.diff`);
    a full first-pass review already happened. Post-fix `git diff` shows the whole task again, so
    the **fix delta = current diff vs the snapshot** — hunks present now that aren't in the
    snapshot (or changed from it) are the fix. Reviewers do exactly two things: (1) verify each
    blocking finding is actually resolved (not merely moved), (2) scan the fix delta for
    regressions it introduced. **No full re-litigation of unchanged code, and no new findings
    from it** — a finding in untouched-since-cycle-0 code was either visible in the first pass (too
    late, it had its chance) or belongs to the integration review. If the caller supplied no
    snapshot, say so in the verdict and fall back to the full diff for check (2) — never silently
    pretend the scope was narrow. Verdict format is unchanged.
- `$ARGUMENTS` may override `$REPO` or pass `--integration <base>` / `--re-review`.
- **Make the plan readable INSIDE `$REPO` (the context mirror).** The plan/progress usually live at
  the mono root (`docs/<feature>/{plan,progress}.md`), which a reviewer running `-C "$REPO"` — and
  **especially the cross-model reviewer confined to `$REPO`** — cannot reach. Mirror them into the worktree
  (git-excluded, refreshed NOW so they're never stale), and point every reviewer at the local copy:
  ```bash
  mkdir -p "$REPO/.dev-loop"
  # exclude it once so `git add -A` never stages it (per-repo, untracked — no tracked .gitignore change):
  EXCL="$(git -C "$REPO" rev-parse --git-common-dir)/info/exclude"   # abs for a linked worktree
  grep -qxF '.dev-loop/' "$EXCL" 2>/dev/null || echo '.dev-loop/' >> "$EXCL"
  cp "<abs>/docs/<feature>/plan.md"     "$REPO/.dev-loop/plan.md"
  cp "<abs>/docs/<feature>/progress.md" "$REPO/.dev-loop/progress.md"
  ```
  Now `$REPO/.dev-loop/{plan.md,progress.md}` carries the feature-level context every reviewer needs.

## 2. Load the rubric + plan

- Read `~/.claude/rubrics/per-task-review.md` — every reviewer gets it verbatim.
- Read `$REPO/.dev-loop/plan.md` (the worktree-local mirror from §1) — the seam map + the task's
  acceptance criteria + MUST-NOTs. Reviewers need it for the plan-conformance and composition/
  twin-path checks — **a gate that can't see the plan is judging the diff against the rubric alone
  and cannot catch a plan violation or contract drift.** (`progress.md` is alongside it for the
  prior-task Done log — useful context for the integration review especially.)

## 3. Execute before you review (green precondition)

Static review can't see a test that doesn't run. Resolve the verify command(s) — plan.md's
**Verify commands**, the progress.md Gotchas, or detect from the repo — then:
- **Per-task**: the orchestrator has normally already run verify; trust its reported result if
  given, otherwise run the fast/relevant subset now.
- **Integration**: run the **FULL suite** in `$REPO`, always. A red suite (or a build that doesn't
  compile) is an automatic `VERDICT: FAIL` — report the failures and stop; don't spend reviewer
  passes on a diff that's already broken.
- No verify command resolvable → proceed, but report `Verify: NONE` in the verdict — never silently.
- *Mutation tooling (optional, advisory)*: at integration, if the repo already ships a mutation
  config (stryker, mutmut, cargo-mutants), you MAY run it scoped to the feature's files and fold
  survivors into Test-audit as advisory findings — never blocking, never install tooling for this.

## 4. Run the reviewers (in parallel)

In `--re-review` mode, prepend the prior blocking findings to BOTH reviewer prompts, plus the
snapshot path (`$REPO`-relative, so the cross-model reviewer can read it) and the §1 re-review instruction
(verify resolution + scan the fix delta vs the snapshot only) in place of the full-pass
instruction; Reviewer D (leanness) is skipped — its advisory verdict from the first pass stands.

**Reviewer A — Claude (self):** dispatch a `general-purpose` subagent with the rubric, the diff,
and the worktree-local plan at `$REPO/.dev-loop/plan.md` (tell it to READ that file for the seam
map + acceptance + MUST-NOTs). Tell it to read neighboring code and the joined flows in `$REPO`
for context — and, in `--integration` mode, to actively trace cross-task and cross-repo contracts.
Hand it crafted context — **not** your session history. Require the rubric's output format ending
in `VERDICT: PASS/FAIL`.

**Reviewer B — GPT cross-model (opencode bridge):**
```bash
timeout 900 opencode run --dir "$REPO" -m openai/gpt-5.5 --variant high --agent plan \
  "You are doing a READ-ONLY review — do not modify any files.

$(cat ~/.claude/rubrics/per-task-review.md)

Run 'git diff' (or 'git diff <base>...HEAD' for an integration review) to see the changes and
review ONLY those, against the plan at .dev-loop/plan.md (read it — it holds the acceptance
criteria, seam map, and MUST-NOTs for this work). Trace how they compose with the flows they join
and check twin-path symmetry." > /tmp/cross-review.md 2>&1
```
Then read `/tmp/cross-review.md` — the findings + verdict are at the END, after the streamed
tool-call log.
- The model is **pinned**: `openai/gpt-5.5 --variant high`. Benchmarked 2026-07-03 on a real gate
  diff: 5.5-high was the fastest AND best-calibrated (~3 min); gpt-5.4-high was 2× slower and
  over-escalated; 5.5-fast bought nothing. Never tier the cross-model reviewer down.
- `--dir "$REPO"` runs it inside the worktree (so `.dev-loop/plan.md` resolves where the
  mono-root `docs/<feature>/plan.md` would not); `--agent plan` is opencode's built-in read-only
  agent — edits are denied at the permission layer, not just by instruction.
- **FOREGROUND with the `timeout` shown — NEVER background-and-poll** (a backgrounded run can die
  silently and the poll never returns; this burned a real run). Check the exit code; on non-zero
  or timeout, retry once, then fall back.
- Fallback chain: opencode unavailable/unauthed → `codex exec -C "$REPO" -s read-only -o
  /tmp/cross-review.md "<same prompt>"` (foreground + timeout, same rule; on hosts where codex's
  bwrap sandbox is blocked by apparmor userns restrictions, `-s danger-full-access` plus the
  READ-ONLY preamble is the user-authorized workaround; if codex errors on git, retry once with
  `--skip-git-repo-check`). If neither bridge works, proceed with Reviewer A alone but
  **explicitly flag that coverage was single-model** — never silently drop the cross-model
  reviewer.

**Reviewer C — security (specialist) — `--integration` mode ONLY:** security is a whole-surface
property — cross-task auth drift, trust-boundary confusion, and missing-authz bugs only appear once
the whole feature is assembled, and a single task diff structurally can't show them. So this axis
runs **only when reviewing a whole feature** (`--integration`). On a **per-task** diff, **skip it** —
the rubric's Security check under Reviewers A and B already catches obvious in-diff vulns (hardcoded
secrets, blatant injection, unsafe HTML on user input), and the authoritative specialist pass runs
once at integration, before anything merges.
When it runs: a `general-purpose` subagent with `~/.claude/reference/security-review.md` and the
whole-feature diff. It hunts *exploitable* vulnerabilities with deepsec's false-positive discipline
(prove the missing mitigation before flagging), traces auth across the whole feature, and triages
each by exploitability × impact. Output: one line per finding tagged `P0/P1/P2` with `file:line` +
vuln slug, ending `VERDICT: PASS/FAIL`. **P0/P1 are blocking; P2 is advisory.**

**Reviewer D — leanness (advisory):** a `general-purpose` subagent with
`~/.claude/reference/leanness.md` and the diff. Over-engineering only — `delete/stdlib/native/
yagni/shrink`, ending `net: -N lines possible` or `Lean already. Ship.` This axis is advisory.

## 5. Consolidate

- Group findings by rubric section (so a passing section never masks a failing one). Keep
  Claude's and GPT's lists visible side by side — do not average them.
- Where the two reviewers **disagree** (one flags, the other doesn't), investigate the flagged
  item yourself and decide — disagreements are where blind spots hide.
- Assign final severity per the rubric. **Security:** per-task, security findings come only from
  Reviewers A/B's rubric Security check — bucket them as Critical/Important like any rubric finding.
  At `--integration`, **Reviewer C also runs** — map its findings by triage (**P0/P1 → blocking** as
  Critical/Important, **P2 → advisory**); where C and A/B flag the same issue, dedupe — don't
  double-count; where only C flags it, trust the catalog but confirm the mitigation is truly absent
  before blocking.
- Leanness findings stay in their own advisory block (non-blocking unless the over-engineering is
  egregious).

## 6. Verdict

```
REVIEW: <feature> / <task|INTEGRATION since base>
  Verify: PASS <cmd> | FAIL (auto-FAIL) | NONE (no test command found)
  Claude: <Crit/Imp/Min>   GPT: <Crit/Imp/Min>   [single-model if the cross-model bridge is unavailable]
  Security (Reviewer C, --integration only): <P0/P1 blocking findings with file:line + slug | "none" | "n/a (per-task)">  (P2 advisory: <n>)
  Blocking: <Critical+Important findings with file:line, grouped by section, or "none">
  Leanness (advisory): <net: -N lines possible | Lean already>
  VERDICT: PASS | FAIL
```
**PASS** = zero unresolved Critical or Important. Per-task that includes any security issue A/B flag
from the rubric; at `--integration` it also requires **zero security P0/P1** from Reviewer C. Minor,
security P2, and leanness issues are noted, not blocking.
