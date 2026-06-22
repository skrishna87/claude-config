// dev-loop-auto.js — the hands-off SEQUENTIAL orchestrator for /dev-loop-auto.
//
// SIBLING of the manual /dev-loop. Both drive the SAME on-disk state — a plan.md
// checklist + a progress.md cursor + per-task commits in ONE feature worktree — so you can
// run a feature with either loop and swap between them mid-feature. The only difference is
// the DRIVER:
//   * /dev-loop      — YOU are the driver: one agent does a few tasks, then yields and asks
//                      you to /clear + re-run. Context survives via /clear.
//   * /dev-loop-auto — THIS script is the driver: it loops every remaining task with a
//                      fresh-context agent PER task. The JS driver holds no LLM context, so
//                      nothing accumulates — no /clear, no retyping, one launch to done.
//
// WHY a Workflow (not a nested agent loop): the user's constraint is "no manual input AND
// context stays lean across N tasks." Those together REQUIRE a driver that resets context
// per task. A JS Workflow driver does exactly that for free (zero driver context); a nested
// LLM loop would still accumulate per-task summaries and creep toward the context ceiling.
//
// WHAT THIS IS NOT: this is the deliberately-SIMPLE sequential loop, not the archived v2 DAG
// orchestrator. There is NO dependency DAG, NO disjoint-write-set fan-out, NO ephemeral
// per-task worktrees, NO cherry-pick integration. Tasks run ONE AT A TIME, in plan order, in
// the single shared feature worktree — exactly as /dev-loop does by hand. Stripping the
// parallelism is what removes v2's heavy planning tax. The seam-quality fix that v2 lacked is
// kept and made non-optional: a whole-feature §7 INTEGRATION REVIEW runs as the final phase.
//
// HARD RUNTIME CONSTRAINTS (this is a Workflow SCRIPT, not an agent):
//   * The script has NO filesystem / git / bash access. EVERY side effect (file edits, git
//     add/commit, running tests, codex) is performed by a dispatched `agent(...)`. This file
//     is PURE control-flow + threading schema-validated data between agents.
//   * FORBIDDEN here (they throw at runtime): Date.now(), Math.random(), new Date().
//   * Concurrency auto-caps; but this loop is sequential by design (await each task) so the
//     single worktree is never touched by two agents at once.
//
// RUNTIME API (provided by the Workflow tool): agent(prompt,{schema,label,phase,model}),
//   parallel, pipeline, phase(title), log(msg), args, budget. See the tool docs.

export const meta = {
  name: "dev-loop-auto",
  description:
    "Hands-off sequential dev loop: walk the plan.md checklist task-by-task in one shared worktree, gate each task with the locked review (Claude+codex+leanness), commit + checkpoint on pass, stop on the first hard block, then run a whole-feature integration review. Sibling of /dev-loop over the same plan+progress state. All side effects run through dispatched agents.",
  phases: [
    { title: "validate", detail: "lexically check args before any side effect" },
    { title: "implement", detail: "fresh agent implements each task (+ bounded fix cycles)" },
    { title: "gate", detail: "locked per-task review gate (Claude self + codex + leanness)" },
    { title: "checkpoint", detail: "commit on pass, tick the plan box, rewrite progress.md" },
    { title: "integration", detail: "whole-feature §7 review before handoff" },
  ],
};

// =======================================================================================
// args CONTRACT (what the launcher /dev-loop-auto MUST satisfy):
//   args = {
//     repo:          "<abs path to the git repo>",          // informational
//     worktree:      "<abs path to the shared feature worktree>",  // ALL work happens here
//     featureBranch: "<branch name being built>",
//     source:        "<source branch the feature will FF onto>",   // informational
//     baseSha:       "<merge-base / branch point>",   // integration review diffs base...HEAD
//     planPath:      "<abs path to docs/<feature>/plan.md>",       // checklist, ticked on pass
//     progressPath:  "<abs path to docs/<feature>/progress.md>",   // the resume cursor
//     rubricPath:    "<abs path to ~/.claude/rubrics/per-task-review.md>",
//     reviewGatePath:"<abs path to ~/.claude/commands/review-task.md>",  // procedure reference
//     leannessPath:  "<abs path to ~/.claude/reference/leanness.md>",
//     seamMap:       "<the plan's Seam map section text>",         // briefed to every worker
//     lockedDecisions:"<the plan's Locked decisions text>",        // briefed to every worker
//     tasks: [ { id: "5", text: "<task text>", accept: "<criteria>" }, ... ],  // UNCHECKED only, in order
//     models?: { implement, gate, fix, checkpoint, integration }  // optional per-stage override
//   }
//
// RETURN: { approved: [ids], blocked: {id,reason}|null, integration: {pass,coverage,blocking,notes}|null,
//           finalHead, coverageNotes: [...] }

// =======================================================================================
// SECTION 1 — Light validation (sequential loop needs far less than v2's DAG validation)
// =======================================================================================
const ID_RE = /^[A-Za-z0-9_.-]+$/;

function validateArgs(a) {
  if (a === undefined || a === null || typeof a !== "object") {
    throw new Error("Workflow args missing: expected the validated state object");
  }
  for (const k of ["worktree", "baseSha", "planPath", "progressPath", "rubricPath", "tasks"]) {
    if (a[k] === undefined || a[k] === null || a[k] === "") {
      throw new Error(`args.${k} is required`);
    }
  }
  if (!Array.isArray(a.tasks) || a.tasks.length === 0) {
    throw new Error("args.tasks must be a non-empty array of remaining unchecked tasks");
  }
  const seen = new Set();
  for (const t of a.tasks) {
    if (t === null || typeof t !== "object") {
      throw new Error(`each task must be an object (got ${JSON.stringify(t)})`);
    }
    if (typeof t.id !== "string" || !ID_RE.test(t.id)) {
      throw new Error(`task id must match ${ID_RE} (got ${JSON.stringify(t.id)})`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    seen.add(t.id);
    if (typeof t.text !== "string" || t.text.trim() === "") {
      throw new Error(`task ${t.id}: "text" must be a non-empty string`);
    }
  }
  // Normalize optional briefing fields so prompt builders never see undefined.
  a.seamMap = typeof a.seamMap === "string" && a.seamMap.trim() ? a.seamMap : "(none provided — read the plan's Seam map section)";
  a.lockedDecisions = typeof a.lockedDecisions === "string" && a.lockedDecisions.trim() ? a.lockedDecisions : "(none provided — read the plan's Locked decisions section)";
  a.featureBranch = a.featureBranch || "(feature branch)";
}

// =======================================================================================
// SECTION 2 — Per-stage model selection (best model for the job; overridable via args.models)
// =======================================================================================
// The GATE and the INTEGRATION review run the strongest tier — review is the highest-stakes
// reasoning in the loop and must out-think the implementer. implement runs a capable-but-cheap
// tier (it's run N times; quota matters — bump to opus per-launch for a correctness-crux plan).
// checkpoint is mechanical → cheap. "opus" resolves to the latest Opus independent of session.
const DEFAULT_STAGE_MODELS = {
  implement: "sonnet",
  gate: "opus",
  fix: "sonnet",
  checkpoint: "haiku",
  integration: "opus",
};
function stageModel(phase, args) {
  const over = args && args.models;
  return (over && over[phase]) || DEFAULT_STAGE_MODELS[phase] || undefined;
}

// =======================================================================================
// SECTION 3 — Agent return schemas
// =======================================================================================
const implementSchema = {
  type: "object",
  required: ["ok", "taskId", "changedFiles", "summary"],
  properties: {
    ok: { type: "boolean" },
    taskId: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    error: { type: "string" },
  },
};

const gateSchema = {
  type: "object",
  required: ["taskId", "pass", "coverage", "blocking"],
  properties: {
    taskId: { type: "string" },
    pass: { type: "boolean" }, // final VERDICT: PASS => true (zero unresolved Critical/Important)
    coverage: { type: "string" }, // "CROSS-MODEL" | "SINGLE-MODEL" | "DEGRADED"
    blocking: { type: "array", items: { type: "string" } }, // Critical+Important findings
    leanness: { type: "string" }, // advisory one-liner
    notes: { type: "string" },
  },
};

const checkpointSchema = {
  type: "object",
  required: ["ok", "taskId", "commitSha"],
  properties: {
    ok: { type: "boolean" },
    taskId: { type: "string" },
    commitSha: { type: "string" }, // the task commit on the feature branch
    error: { type: "string" },
  },
};

const integrationSchema = {
  type: "object",
  required: ["pass", "coverage", "blocking"],
  properties: {
    pass: { type: "boolean" },
    coverage: { type: "string" },
    blocking: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

// =======================================================================================
// SECTION 4 — Agent-prompt builders (every side effect lives inside a dispatched agent)
// =======================================================================================
// Prompts are explicit about the absolute worktree path because agent() has NO cwd — an
// under-specified path lets an agent drift to the wrong tree.

function implementPrompt(task, args) {
  return [
    `You are the IMPLEMENTER for plan task ${task.id}: ${task.text}`,
    task.accept ? `Acceptance criteria: ${task.accept}` : ``,
    ``,
    `=== Work ONLY in this worktree ===`,
    `Absolute path: ${args.worktree}`,
    `You have NO cwd. EVERY file edit uses an absolute path under that worktree, and EVERY git`,
    `command uses \`git -C "${args.worktree}"\`. Do not touch anything outside it.`,
    ``,
    `Prior tasks are already committed on this branch — build on them. The working tree is clean`,
    `at the start of your task; leave your changes UNSTAGED (the gate reviews the unstaged diff,`,
    `a later agent commits on pass). Do NOT stage or commit.`,
    ``,
    `=== Implement exactly this task as a thin vertical slice — nothing more ===`,
    `Read ${args.planPath} for the full task context (seam map, pinned symbols, twins, write-set).`,
    `Work in PONYTAIL / leanness mode (${args.leannessPath || "~/.claude/reference/leanness.md"}):`,
    `the laziest solution that actually works — but NEVER simplify away validation, error`,
    `handling, or security. Match the surrounding code's conventions; read neighboring code first.`,
    ``,
    `=== Seam map (compose correctly with these) ===`,
    args.seamMap,
    ``,
    `=== Locked decisions (do NOT re-litigate) ===`,
    args.lockedDecisions,
    ``,
    `Return ok=true with changedFiles (paths you modified) and a one-paragraph summary. If you`,
    `cannot complete the slice as specified, return ok=false with the reason rather than forcing`,
    `an out-of-scope edit.`,
  ].filter((l) => l !== ``).join("\n");
}

// The single-agent locked review gate. review-task.md normally dispatches sub-reviewers, but a
// Workflow agent cannot nest — so this ONE fresh-context agent executes all three lenses itself
// (it gets ONLY the diff + rubric + plan, never the implementer's context, so independence holds).
function gatePrompt(task, args, scope) {
  const diffCmd = scope.mode === "integration"
    ? `git -C "${args.worktree}" diff ${args.baseSha}...HEAD`
    : `git -C "${args.worktree}" diff`;
  const header = scope.mode === "integration"
    ? `You are the WHOLE-FEATURE INTEGRATION REVIEW (the §7 gate no single task diff can be).`
    : `You are the REVIEW GATE for plan task ${task.id}: ${task.text}`;
  return [
    header,
    `Follow the locked review procedure at ${args.reviewGatePath || "~/.claude/commands/review-task.md"}`,
    `and the rubric at ${args.rubricPath} — judge by the rubric, do NOT substitute another reviewer.`,
    ``,
    `Repo/worktree under review ($REPO): ${args.worktree}`,
    `Scope = the diff from:`,
    `  ${diffCmd}`,
    scope.mode === "integration"
      ? `This is the cross-task / cross-repo review: actively trace contracts BETWEEN tasks, how the`
        + `\nfeature composes with untouched flows, and twin-path symmetry (UI vs headless,`
        + `\nsuccess/failure/budget/cancel, repo↔repo). The drift that no single task diff shows lives here.`
      : `Judge this task's diff, but trace how it composes with the flows it joins and check twin-path symmetry.`,
    ``,
    `=== Context mirror — DO THIS FIRST ===`,
    `The plan lives at the mono root (${args.planPath}), which codex \`-C "${args.worktree}"\` CANNOT`,
    `read. Copy the plan + progress INTO the worktree (git-excluded so it's local to codex AND never`,
    `staged by \`git add -A\`), refreshed now so it's current:`,
    `  mkdir -p "${args.worktree}/.dev-loop"`,
    `  EXCL="$(git -C "${args.worktree}" rev-parse --git-common-dir)/info/exclude"`,
    `  grep -qxF '.dev-loop/' "$EXCL" 2>/dev/null || echo '.dev-loop/' >> "$EXCL"`,
    `  cp "${args.planPath}" "${args.worktree}/.dev-loop/plan.md"`,
    `  cp "${args.progressPath}" "${args.worktree}/.dev-loop/progress.md"`,
    `Every lens reads the plan from ${args.worktree}/.dev-loop/plan.md — without it you'd be judging`,
    `the diff against the rubric alone (no plan-conformance / seam check, where contract drift hides).`,
    ``,
    `Apply ALL lenses yourself (you cannot dispatch sub-agents here):`,
    `  Lens A — rubric-correctness: read ${args.rubricPath} + ${args.worktree}/.dev-loop/plan.md, read`,
    `    neighboring code in the worktree, and apply every rubric section against the diff.`,
    `  Lens B — adversarial cross-model (codex). Preflight, then run with a hard timeout:`,
    `      codex exec -C "${args.worktree}" -s read-only -o /tmp/dev-loop-auto-${task.id}.md \\`,
    `        "$(cat ${args.rubricPath})`,
    ``,
    `Run '${diffCmd}' and review ONLY those changes, against the plan at .dev-loop/plan.md (read it —`,
    `acceptance + seam map + MUST-NOTs). Trace how they compose with the flows they join and check`,
    `twin-path symmetry."`,
    `    Then read /tmp/dev-loop-auto-${task.id}.md. If codex errors on git, retry once with`,
    `    --skip-git-repo-check. If codex is unavailable/unauthed, do an adversarial divergent-persona`,
    `    ("hostile implementer / hostile parser") Claude pass INSTEAD and set coverage="DEGRADED".`,
    `    Set coverage="CROSS-MODEL" when codex ran, else "DEGRADED".`,
    `  Lens C — leanness (advisory): read ${args.leannessPath || "~/.claude/reference/leanness.md"},`,
    `    hunt only over-engineering, one-line summary. Advisory — non-blocking unless egregious.`,
    ``,
    `Consolidate per the rubric: group by section, investigate any A/codex disagreement yourself.`,
    `pass = true IFF zero unresolved Critical or Important findings. Return taskId="${task.id}",`,
    `pass, coverage, blocking (Critical+Important as "file:line — problem", [] if none), leanness, notes.`,
  ].join("\n");
}

function fixPrompt(task, args, blocking) {
  return [
    `You are the FIX agent for plan task ${task.id}, resolving review-gate findings.`,
    `Work ONLY in the worktree at ${args.worktree} (absolute paths + \`git -C\`). Leave changes`,
    `UNSTAGED — do NOT commit. Do not introduce new scope.`,
    ``,
    `Blocking findings to resolve:`,
    (blocking && blocking.length ? blocking.map((b, i) => `  ${i + 1}. ${b}`).join("\n") : "  (none provided)"),
    ``,
    `Re-verify the task's acceptance criteria after fixing${task.accept ? `: ${task.accept}` : "."}`,
    `Return ok, taskId="${task.id}", changedFiles, summary.`,
  ].join("\n");
}

// Commit the passed task + tick its plan.md checkbox + rewrite progress.md, in ONE commit, so
// "feature-branch commit = approved task" stays the resumable invariant both loops rely on.
function checkpointPrompt(task, args, doneCount, totalCount, nextTask) {
  const next = nextTask
    ? `- [ ] task ${nextTask.id}: ${nextTask.text} — next unchecked item`
    : `- (all tasks checked — integration review is next)`;
  return [
    `You are the COMMIT + CHECKPOINT agent for plan task ${task.id} (it just PASSED the gate).`,
    `All file ops use absolute paths + \`git -C "${args.worktree}"\`.`,
    ``,
    `1. Tick THIS task's checkbox in ${args.planPath}: change its line from`,
    `   "- [ ] ${task.id}. ..." to "- [x] ${task.id}. ..." (match the task number; leave the text).`,
    `2. Rewrite ${args.progressPath} (the resume cursor) to reflect:`,
    `   - Worktree: ${args.worktree}   Branch: ${args.featureBranch}   Base: ${args.baseSha}   Source: ${args.source || "(source)"}`,
    `   - Approved tasks (committed): ${doneCount}/${totalCount} — see \`git log ${args.baseSha}..HEAD\``,
    `   - In flight: none`,
    `   - Next: ${nextTask ? `task ${nextTask.id}: ${nextTask.text}` : "none — run the integration review"}`,
    `   - Keep any existing Gotchas; add new ones this task surfaced (exact build/test commands, env traps).`,
    `   - How to resume: "Run /dev-loop-auto <feature> (or /dev-loop <feature> — same state)."`,
    `   Match the existing progress.md structure. Next item for reference: ${next}`,
    `3. Commit the task's code changes TOGETHER WITH the plan.md tick + progress.md rewrite, as one`,
    `   commit on the feature branch:`,
    `     git -C "${args.worktree}" add -A`,
    `     git -C "${args.worktree}" commit -m "${task.id}: <one-line summary of what this task did>"`,
    `   Use a real one-line summary (not the literal placeholder). NO trailer needed.`,
    `4. Capture the sha: git -C "${args.worktree}" rev-parse HEAD`,
    ``,
    `Return ok=true, taskId="${task.id}", commitSha=<that sha>. On any failure ok=false + error.`,
  ].join("\n");
}

// =======================================================================================
// SECTION 5 — Per-task execution (implement → bounded gate loop → commit+checkpoint)
// =======================================================================================
const MAX_FIX_CYCLES = 2;

function failReason(prefix, res) {
  if (!res) return `${prefix} (agent died — null result)`;
  if (res.error) return `${prefix}: ${res.error}`;
  if (res.summary) return `${prefix}: ${res.summary}`;
  return `${prefix} (returned ok:false, no detail)`;
}

// Returns { approved:true, commitSha, coverage } or { approved:false, reason, coverage? }.
// NEVER throws — a failure is a value so the loop can stop cleanly and report.
async function runTask(task, args, doneCount, totalCount, nextTask) {
  // ---- implement ----
  phase("implement");
  const impl = await agent(implementPrompt(task, args), {
    schema: implementSchema, label: `implement:${task.id}`, phase: "implement", model: stageModel("implement", args),
  });
  if (!impl || !impl.ok) return { approved: false, reason: failReason(`task ${task.id} implement failed`, impl) };

  // ---- gate, with up to MAX_FIX_CYCLES fix→review cycles ----
  phase("gate");
  let gate = await agent(gatePrompt(task, args, { mode: "task" }), {
    schema: gateSchema, label: `gate:${task.id}:0`, phase: "gate", model: stageModel("gate", args),
  });
  let coverage = gate ? gate.coverage : "UNKNOWN";
  let cycle = 0;
  while ((!gate || !gate.pass) && cycle < MAX_FIX_CYCLES) {
    if (gate === null) return { approved: false, reason: `task ${task.id}: review gate agent died (no verdict)` };
    cycle += 1;
    phase("implement");
    const fix = await agent(fixPrompt(task, args, gate.blocking || []), {
      schema: implementSchema, label: `fix:${task.id}:${cycle}`, phase: "implement", model: stageModel("fix", args),
    });
    if (!fix || !fix.ok) return { approved: false, reason: failReason(`task ${task.id} fix attempt ${cycle} failed`, fix), coverage };
    phase("gate");
    gate = await agent(gatePrompt(task, args, { mode: "task" }), {
      schema: gateSchema, label: `gate:${task.id}:${cycle}`, phase: "gate", model: stageModel("gate", args),
    });
    if (gate) coverage = gate.coverage;
  }
  if (!gate || !gate.pass) {
    return {
      approved: false,
      reason: `task ${task.id} gate FAILED after ${MAX_FIX_CYCLES} fix cycles${gate && gate.blocking ? `: ${gate.blocking.join("; ")}` : ""}`,
      coverage,
    };
  }

  // ---- commit + checkpoint on pass ----
  phase("checkpoint");
  const cp = await agent(checkpointPrompt(task, args, doneCount + 1, totalCount, nextTask), {
    schema: checkpointSchema, label: `checkpoint:${task.id}`, phase: "checkpoint", model: stageModel("checkpoint", args),
  });
  if (!cp || !cp.ok) return { approved: false, reason: failReason(`task ${task.id} commit/checkpoint failed`, cp), coverage };
  return { approved: true, commitSha: cp.commitSha, coverage };
}

// =======================================================================================
// SECTION 6 — Orchestrator entry point
// =======================================================================================
async function devLoopAuto(args) {
  phase("validate");
  validateArgs(args);
  const totalRemaining = args.tasks.length;
  log(`sequential loop over ${totalRemaining} remaining task(s) in ${args.worktree}`);

  const approved = [];
  const coverageNotes = [];
  let blocked = null;
  let doneCount = 0;

  // ---- Walk the checklist in order; STOP on the first hard block (a later task likely
  //      depends on it, and the working tree holds the failed task — exactly /dev-loop's model). ----
  for (let i = 0; i < args.tasks.length; i++) {
    const task = args.tasks[i];
    const nextTask = args.tasks[i + 1] || null;
    log(`task ${task.id} (${i + 1}/${totalRemaining}): ${task.text}`);
    const r = await runTask(task, args, doneCount, totalRemaining, nextTask);
    if (r.coverage) coverageNotes.push(`${task.id}: ${r.coverage}`);
    if (!r.approved) {
      blocked = { id: task.id, reason: r.reason };
      log(`BLOCKED at task ${task.id}: ${r.reason} — stopping; ${doneCount}/${totalRemaining} done this run`);
      break;
    }
    approved.push(task.id);
    doneCount += 1;
    log(`approved ${task.id} (${doneCount}/${totalRemaining}); commit ${r.commitSha}`);
  }

  // ---- Integration review: ONLY when every remaining task got approved this run (no block).
  //      This is the seam gate v2 lacked. A FAIL here is reported, NOT auto-fixed — the human
  //      adds fix tasks to plan.md and re-loops (same as /dev-loop §7). ----
  let integration = null;
  if (!blocked) {
    phase("integration");
    log(`all ${totalRemaining} tasks approved — running whole-feature integration review`);
    integration = await agent(gatePrompt({ id: "INTEGRATION", text: "whole feature" }, args, { mode: "integration" }), {
      schema: integrationSchema, label: `integration:${args.featureBranch}`, phase: "integration", model: stageModel("integration", args),
    });
    if (integration) coverageNotes.push(`INTEGRATION: ${integration.coverage}`);
  }

  phase("report");
  const result = { approved, blocked, integration, finalHead: null, coverageNotes };
  if (blocked) {
    log(`done: ${approved.length} approved, stopped at blocked task ${blocked.id}`);
  } else if (integration && integration.pass) {
    log(`done: all ${approved.length} tasks approved + INTEGRATION PASS — ready for human review/FF`);
  } else if (integration) {
    log(`done: all tasks approved but INTEGRATION FAILED — seams don't hold; add fix tasks and re-loop`);
  }
  if (coverageNotes.some((c) => /DEGRADED/.test(c))) {
    log(`warn: some reviews ran DEGRADED (no cross-model coverage) — see coverageNotes`);
  }
  return result;
}

// =======================================================================================
// Workflow ENTRY. A Workflow body uses top-level await + return (the runtime wraps it in an
// async fn); `node --check` reporting "return outside of function" is EXPECTED.
// =======================================================================================
let __args = typeof args === "undefined" ? undefined : args;
if (typeof __args === "string") {
  try { __args = JSON.parse(__args); }
  catch (e) { throw new Error("Workflow args arrived as a non-JSON string: " + e.message); }
}
return await devLoopAuto(__args);
