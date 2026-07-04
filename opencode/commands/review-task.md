---
description: Locked review gate — cross-model rubric review (same-model + pinned-provider reviewers) plus security and leanness axes, over a task's diff or a whole feature. The ONLY reviewer /dev-loop uses.
---

# /review-task — locked review gate (opencode port)

The single, consistent review step. **Ignore every other reviewer tool/plugin here** — this
gate is deliberately locked so results are reproducible across tasks and sessions. Independent
reviewers judge the SAME diff by the SAME rubric; you consolidate.

`$ARGUMENTS` may pass a repo/worktree path, `--integration <base-ref>` for a whole-feature
review, or `--re-review` after a fix cycle (with the prior blocking findings).

## 1. Establish scope + repo

- **Find the git repo dir** holding the changes — the dir with a `.git`. In a mono-style repo
  this is the sub-repo / worktree, never the mono root. Call it `$REPO`.
- **Scope** depends on the fixed-point:
  - **Per-task (default)** — the current task = the **unstaged** working-tree changes.
    Diff: `git -C "$REPO" diff` (if empty, try `--staged`; if still empty, nothing to review —
    say so and stop).
  - **Integration (`--integration <base>`)** — the whole feature so far, to catch cross-task
    contract drift. Diff: `git -C "$REPO" diff <base>...HEAD`.
  - **Re-review (`--re-review`)** — a fix-cycle re-gate. The caller passes the prior blocking
    findings AND the **pre-fix diff snapshot** (saved at FAIL time, e.g.
    `$REPO/.dev-loop/review-cycle-0.diff`). The fix delta = current diff vs the snapshot.
    Reviewers verify each finding is resolved and scan only the fix delta for regressions —
    no re-litigation of unchanged code. No snapshot supplied → say so in the verdict and fall
    back to the full diff, never silently.
- Note the absolute `planPath` (`docs/<feature>/plan.md`) — subagents read it directly; no
  mirror needed in this harness.

## 2. Execute before you review (green precondition)

Static review can't see a test that doesn't run. Resolve the verify command(s) — plan.md's
**Verify commands**, progress.md Gotchas, or detect from the repo — then:
- **Per-task**: the implementer normally already ran verify; trust its reported result if
  given, otherwise run the fast/relevant subset now.
- **Integration**: run the **FULL suite** in `$REPO`, always. A red suite is an automatic
  `VERDICT: FAIL` — report the failures and stop.
- No verify command resolvable → proceed, but report `Verify: NONE` — never silently.

## 3. Run the reviewers (in parallel)

Spawn via the task tool, each with a crafted brief — repo path, the exact diff command,
`planPath`, and the mode (full | re-review + findings + snapshot path). Never session history.

- **`task-reviewer`** (same-model) — always.
- **`task-reviewer-cross`** (pinned to a different provider) — always. If its provider is
  down/unauthed, proceed single-model but **explicitly flag coverage as DEGRADED** — never
  silently drop the cross-model half.
- **`security-reviewer`** — `--integration` mode ONLY. Security is a whole-surface property;
  on a per-task diff the rubric's Security check under the two reviewers already covers
  in-diff vulns. P0/P1 block; P2 advisory.
- Leanness is the rubric's advisory section — both reviewers report it; no separate pass. In
  `--re-review` mode its advisory verdict from the first pass stands; reviewers get only the
  scoped re-review instruction.

## 4. Consolidate

- Group findings by rubric section (a passing section never masks a failing one). Keep the two
  reviewers' lists visible side by side — do not average them.
- Where they **disagree** (one flags, the other doesn't), investigate the flagged item
  yourself and decide — disagreements are where blind spots hide.
- Security at integration: map security-reviewer findings by triage (P0/P1 → blocking, P2 →
  advisory); dedupe against the rubric reviewers; where only the specialist flags it, confirm
  the mitigation is truly absent before blocking.
- Leanness stays advisory unless the over-engineering is egregious.
- **Dispose of every advisory — nothing scrolls past undecided.** Each advisory finding (Minor,
  security P2, leanness) gets exactly one disposition: **taken** (fix now — only when trivially
  cheap and in-scope), **recorded** (one-line residual + fix recipe into progress.md), or
  **dropped** with a one-line reason. Per-task default is `recorded`; the integration review
  adjudicates the accumulated ledger with the user before anything merges.

## 5. Verdict

```
REVIEW: <feature> / <task|INTEGRATION since base>
  Verify: PASS <cmd> | FAIL (auto-FAIL) | NONE
  same-model: <Crit/Imp/Min>   cross-model: <Crit/Imp/Min>   [DEGRADED if cross unavailable]
  Security (integration only): <P0/P1 findings with file:line + slug | "none" | "n/a (per-task)">  (P2 advisory: <n>)
  Blocking: <Critical+Important findings with file:line, grouped by section, or "none">
  Leanness (advisory): <net: -N lines possible | Lean already>
  Advisories: taken <n> / recorded <n> / dropped <n>  (each disposition listed above)
  VERDICT: PASS | FAIL
```
**PASS** = zero unresolved Critical or Important; at `--integration` also zero security P0/P1.
Minor, security P2, and leanness issues never block — but each carries a §4 disposition;
"noted" ≠ dropped.
