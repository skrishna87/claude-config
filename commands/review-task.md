---
description: Locked review gate — cross-model rubric review (Claude self + GPT via the opencode bridge, provider-switch retries openai → github-copilot, codex final fallback) plus dedicated security and leanness passes, over a task's diff or a whole feature. The ONLY reviewer /dev-loop uses.
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

**Leaf deferral (per-task only).** If the caller signals this task is `[leaf]` (no dependents, no
foundational surface — see `~/.claude/reference/model-policy.md`), **skip Reviewer B here**: its
diff is covered by the cross-model pass at the integration review. Report `coverage: BATCHED` in
the verdict so the deferral is visible, never silent. This applies to the **per-task** gate ONLY —
at `--integration`, and for any `[L]` task, Reviewer B **always** runs. Not a leaf (or unsignaled)
→ run it as below.

**The bridge chain (every gate, every machine): opencode(openai) → opencode(github-copilot) →
codex.** One harness — opencode; a retry switches the PROVIDER inside it, never the harness and
never the model (§ Bridge chain in `~/.claude/reference/model-policy.md`). Every leg pins
`gpt-5.5`, so falling back changes whose OAuth carries the request, never the verdict's model.
Record the leg that produced the verdict as `bridge: opencode-openai|opencode-copilot|codex`
alongside `coverage:`.

**Leg liveness — read the preflight marker first.** The driver's preflight (dev-loop §1 /
plan-feature stage 5) writes `$REPO/.dev-loop/bridge-ok` — the live legs, one per line, in chain
order. Present → run only the listed legs (the others were probed dead at run start; don't
rediscover mid-gate). Absent (standalone invocation) → probe for yourself before the first gate:
`timeout 60 opencode run -m openai/gpt-5.5 --format json "reply OK"`; leg 2 exists only if
`opencode models | grep -qx 'github-copilot/gpt-5.5'` (personal Copilot seats don't serve gpt-5.5 —
that leg is org-seat-machines-only; NEVER substitute a lesser copilot model).

**Concurrency + retry laws (bind every leg):**
- **Never run two headless opencode gates concurrently on one machine** — concurrent instances can
  wedge each other via shared state under `~/.local/share/opencode/` (2026-07-06 incident: two
  parallel stage-5 gates both stalled; retries in fresh processes hung too while the sibling
  process lived; serial runs worked). Multi-repo / multi-lane gates run serially.
- **Liveness rule — a zero-byte run is dead at 60s, don't wait out the timeout.** A healthy
  `--format json` run writes its first event lines within ~5s; every observed init-wedge
  (2026-07-06, both machines) produced ZERO bytes forever. So run the leg in the background of its
  own shell command, poll the output file, and kill at 60s if it is still 0 bytes — that's the
  attempt, proceed per the retry law. Output growing → leave it alone until the real timeout (a
  long reviewer think is not a wedge; the ndjson tool-call lines show it reading).
- On timeout or non-zero exit: retry ONCE with the **verbatim same command** — same timeout, but
  redirect the retry to `cross-review.retry.ndjson` (a DISTINCT file: the retry must leave
  physical evidence it ran — a 2026-07-06 demo run reported a retry that file mtimes disprove). A
  second timeout = the leg is **dead** → move to the next leg immediately. There is no third
  attempt and NEVER a larger timeout (raising 480→900 "to give it room" is how 8 designed minutes
  became 23 real ones, 2026-07-06).

**opencode openai leg (primary):**

```bash
timeout 300 opencode run --dir "$REPO" -m openai/gpt-5.5 --agent plan --format json \
  "You are doing a READ-ONLY, STATIC review — do not modify any files, and do not read any file
outside this repo. Do NOT run the test suite, builds, or any long-running command: a separate
Verify step already ran the tests, so your job is to read the diff + plan and reason. Use only
fast reads (git diff, cat).

$(cat ~/.claude/rubrics/per-task-review.md)

Run 'git diff' (or 'git diff <base>...HEAD' for an integration review) to see the changes and
review ONLY those, against the plan at .dev-loop/plan.md (read it — it holds the acceptance
criteria, seam map, and MUST-NOTs for this work). Trace how they compose with the flows they join
and check twin-path symmetry. End with the VERDICT line." > "$REPO/.dev-loop/cross-review.ndjson" 2>"$REPO/.dev-loop/cross-review.err"
# Extract the assistant's prose (findings + VERDICT). MUST use --format json + this jq:
jq -r 'select(.type=="text") | .part.text' "$REPO/.dev-loop/cross-review.ndjson" > "$REPO/.dev-loop/cross-review.md"
```
Then read `$REPO/.dev-loop/cross-review.md` — the concatenated review text, ending in the `VERDICT:` line.
- **Scratch lives in `$REPO/.dev-loop/`, NEVER `/tmp`.** `/tmp/cross-review.*` is a single machine-global
  path — two loops on different projects (or two parallel lanes) would clobber each other's review and
  one gate could adjudicate another's findings against the wrong diff (a silent wrong PASS). `.dev-loop/`
  is per-worktree (the loop's isolation boundary) and git-excluded, so every concurrent gate is isolated.
  The caller archives each result per fixed-point (`reviews/task<n>.cycle<k>.cross.md` **and** the
  raw `….cross.ndjson` — the ndjson holds the reviewer's tool-call log, the only record of what it
  read) so it accumulates as run telemetry the miner/logger ingests — see the orchestrator's gate step.
- **`--format json` is mandatory, not optional.** opencode's *default* formatted output renders the
  final assistant message in a TUI live-region that is DROPPED when stdout is redirected to a file —
  so `> file 2>&1` captures the streamed tool-call log but not the findings/verdict, and the gate
  silently churns through retries + the whole fallback chain on a phantom "no-output" failure. JSON
  mode emits each text chunk as an NDJSON `{"type":"text",...,"part":{"text":...}}` line that
  survives redirection; the jq above reassembles them. If `$REPO/.dev-loop/cross-review.md` is empty
  after this, it's a real failure (check `$REPO/.dev-loop/cross-review.err` + exit code) — not the capture bug.
- **Model pinned to `openai/gpt-5.5` at DEFAULT variant — NEVER add `--variant high`.** Reasoning
  effort is a separate axis from the model. Re-benchmarked 2026-07-05 on a real 413-line gate diff:
  `--variant high` spent **600s emitting zero stream bytes and never returned** (opencode does not
  stream thinking tokens, so a long silent-reasoning phase is indistinguishable from a wedged
  process — this was the "15-min hang" that made the gate unusable). Default variant: **first byte
  in 2s, done in 86s, verdict PASS, calibration intact** (independently caught a real untested-branch
  MINOR). `minimal` was equivalent (~88s) but shallower. So: keep the model, drop the variant. The
  static-review preamble ("do NOT run tests/builds") keeps tool count low — the reviewer re-running
  `pytest` was a second latency/silent-gap source (Verify already ran the suite upstream).
- `--dir "$REPO"` runs it inside the worktree (so `.dev-loop/plan.md` resolves where the
  mono-root `docs/<feature>/plan.md` would not); `--agent plan` is opencode's built-in read-only
  agent — edits are denied at the permission layer, not just by instruction (it CAN still run
  bash/tests, hence the static-review preamble telling it not to).
- **FOREGROUND with the `timeout` shown — NEVER background-and-poll** (a backgrounded run can die
  silently and the poll never returns; this burned a real run). Check the exit code; on non-zero
  or timeout, retry once, then fall back. A healthy default-variant review is ~90s, so a run pinned
  at the 300s timeout is a real stall, not slow reasoning — retry, then fall back; don't raise it.
**opencode github-copilot leg (provider-switch retry):** primary leg dead AND
`github-copilot/gpt-5.5` in the `bridge-ok` marker (or in `opencode models`) → the **identical
command with only the model flag changed**: `-m github-copilot/gpt-5.5`. Same prompt, same
timeout, same jq, same retry law. This rides the machine's Copilot seat (work laptop = org
seat/credits — one more reason personal repos never gate on the work laptop). Leg not live on this
machine → skip straight to codex; do not attempt it "just in case" with a different copilot model.

**codex leg (final fallback)** — both opencode legs exhausted (this is also the escape hatch for
opencode-harness wedges, which both observed hang modes were) → `codex exec -C "$REPO" -s read-only -o
  "$REPO/.dev-loop/cross-review.md" "<same prompt>" < /dev/null` (the `< /dev/null` is mandatory:
  codex blocks reading stdin on a non-TTY and hangs forever without it — burned 2026-07-06).
  (Foreground + timeout, same rule; on hosts where codex's
  bwrap sandbox is blocked by apparmor userns restrictions, `-s danger-full-access` plus the
  READ-ONLY preamble is the user-authorized workaround; if codex errors on git, retry once with
  `--skip-git-repo-check`). If no leg works, proceed with Reviewer A alone but
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
- **Dispose of every advisory — nothing scrolls past undecided.** Each advisory finding (Minor,
  security P2, leanness, mutation survivors) gets exactly one disposition: **taken** (fix now —
  only when trivially cheap and inside the task's scope), **recorded** (a one-line residual in
  progress.md WITH the fix recipe, so whoever next touches that code inherits it), or **dropped**
  with a one-line reason. Per-task, default to `recorded` — don't grow a task's scope for a Minor.
  The integration review is the batch point: the accumulated ledger is adjudicated there, with the
  user, before anything merges. Advisory means *a human decides*, not *nobody decides*.

## 6. Verdict

```
REVIEW: <feature> / <task|INTEGRATION since base>
  Verify: PASS <cmd> | FAIL (auto-FAIL) | NONE (no test command found)
  Claude: <Crit/Imp/Min>   GPT: <Crit/Imp/Min | BATCHED to integration ([leaf] per-task) | single-model if the bridge is unavailable>
  Security (Reviewer C, --integration only): <P0/P1 blocking findings with file:line + slug | "none" | "n/a (per-task)">  (P2 advisory: <n>)
  Blocking: <Critical+Important findings with file:line, grouped by section, or "none">
  Leanness (advisory): <net: -N lines possible | Lean already>
  Advisories: taken <n> / recorded <n> / dropped <n>  (each disposition listed above)
  VERDICT: PASS | FAIL
```
**PASS** = zero unresolved Critical or Important. Per-task that includes any security issue A/B flag
from the rubric; at `--integration` it also requires **zero security P0/P1** from Reviewer C. Minor,
security P2, and leanness issues never block — but each carries a §5 disposition; "noted" ≠ dropped.
