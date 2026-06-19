// dev-loop.js — the background Workflow orchestrator (task T4 of dev-loop-v2).
//
// ROLE (see docs/dev-loop-v2/plan.md → "Orchestrator"): walk the task DAG layer by
// layer, fan out file-disjoint tasks, gate each task with the locked dual-model review,
// commit approved work with a `Dev-Loop-Task:` trailer, integrate onto the feature
// branch, and checkpoint progress.md — all without aborting a layer when one task fails.
//
// HARD RUNTIME CONSTRAINTS (this is a Workflow SCRIPT, not an agent):
//   * The script has NO filesystem / git / bash access. EVERY side effect (git worktree
//     add/commit/merge, file edits, running tests, codex) is performed by a dispatched
//     `agent(...)`. This file is PURE control-flow + threading schema-validated data
//     between agents. This is the binding "side-effects-via-agents" locked decision.
//   * FORBIDDEN here (they throw at runtime): Date.now(), Math.random(), new Date().
//     => no timestamps, no random ids; every identifier below is derived deterministically
//        from the task ids / run inputs.
//   * `isolation:'worktree'` is NOT used for workers. Per spike wf_144124d1 we create
//     worktrees MANUALLY via an agent's `git worktree add <path> <layer-base-sha>`, and a
//     plain (non-isolation) agent writes into them fine using absolute paths + `git -C`.
//
// RUNTIME API assumed (provided by the Workflow tool):
//   agent(prompt, {schema, label, phase, isolation, model}) -> the schema object, or
//       null if the agent died/threw.
//   parallel([thunks])            -> array of results; a BARRIER (waits for all); a thrown
//                                    thunk resolves to null. null overall on internal throw.
//   pipeline(items, ...stages)    -> per-item staged execution, NO barrier (an item flows to
//                                    the next stage as soon as its prior stage resolves).
//   phase(title)                  -> opens a labelled phase for logging/observability.
//   log(msg)                      -> structured log line.
//   args                          -> the validated input (contract below).
//   budget                        -> concurrency/cost budget handle (informational here).
// Concurrency auto-caps (~16); we do not hand-tune it.

// The orchestrator is invoked by the launcher (T5) which has already PARSED and VALIDATED
// the DAG from plan.md/progress.md. We still DEFENSIVELY re-validate everything lexically
// here, because (a) the launcher is a separate, fallible process, and (b) failing fast with
// a clear thrown error before any side effect is far cheaper than a corrupt mid-run.
export const meta = {
  name: "dev-loop",
  description:
    "DAG-driven orchestrator: fan out file-disjoint tasks per layer, gate each with the locked dual-model review, commit with a Dev-Loop-Task trailer, integrate, checkpoint. All side effects run through dispatched agents; this script is pure control-flow.",
  phases: [
    "validate",
    "orchestrate", // umbrella; each layer also opens its own phase below
    "report",
  ],
};

// ---------------------------------------------------------------------------------------
// args CONTRACT (what the launcher T5 MUST satisfy). Defined explicitly so T5 has a target.
// ---------------------------------------------------------------------------------------
//   args = {
//     repo:          "<abs path to the git repo / feature worktree>",   // git -C target
//     featureBranch: "<branch name being built>",                       // informational/logging
//     baseSha:       "<sha>",   // feature-branch HEAD when the loop started; the FIRST
//                               //   layer-base sha + the progress.md "Base sha".
//     planPath:      "<abs path to plan.md>",        // briefed to the checkpoint agent as the
//                                                     //   authoritative DAG it must NOT modify
//     progressPath:  "<abs path to progress.md>",    // the durable cursor the checkpoint rewrites
//     glossary:      "<the Domain glossary text>",        // briefed to every worker verbatim
//     lockedDecisions: "<the Locked decisions text>",     // briefed to every worker verbatim
//     reviewGate:    "<the commands/review-task.md text OR a path>",  // the gate spec for the gate agent
//     tasks: [
//       { id, title, slice, files: [..], deps: [..], test }   // the T1 schema, one per task
//     ],
//     done: ["T1", ...],   // ids already approved (trailer commits exist); excluded from work
//   }
//
// RETURN shape: { approved: [...ids], blocked: [{id, reason}], finalHead: "<sha|null>",
//                 layers: <n>, coverageNotes: [...] }

// =======================================================================================
// SECTION 1 — Lexical validation + normalization (NO filesystem; identical to the contract)
// =======================================================================================

// Normalize ONE declared path string into { segs:[...], dir:bool } per the Format contract:
//   reject absolute / empty / contains a ".." segment; strip leading "./"; collapse repeated
//   "/"; a single trailing "/" marks a directory and is consumed. Returns null-by-throw on
//   violation (caller wraps the path/task context into the message).
function normalizePath(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`files entry must be a non-empty string (got ${JSON.stringify(raw)})`);
  }
  if (raw[0] === "/") {
    throw new Error(`files entry must be repo-relative, not absolute: "${raw}"`);
  }
  // Strip a single leading "./".
  let s = raw;
  if (s.slice(0, 2) === "./") s = s.slice(2);
  // A directory is denoted by a single trailing "/"; consume it (so it never reads as an
  // empty trailing segment). We detect it BEFORE collapsing so "src//" still means dir.
  const isDir = s.length > 0 && s[s.length - 1] === "/";
  // Split on "/", collapse repeats by dropping empty segments produced by "//" or trailing "/".
  const parts = s.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(`files entry normalizes to empty: "${raw}"`);
  }
  for (const p of parts) {
    if (p === "..") {
      throw new Error(`files entry must not contain a ".." segment: "${raw}"`);
    }
    // "." segments are redundant; the contract only strips a *leading* "./", but a stray
    // interior "." segment is harmless to drop and keeps disjointness exact. Reject instead
    // to stay strictly within the contract's lexical rules (no silent rewriting).
    if (p === ".") {
      throw new Error(`files entry must not contain a "." segment after the leading "./": "${raw}"`);
    }
  }
  return { segs: parts, dir: isDir, raw };
}

// Does normalized entry A overlap normalized entry B? (Format contract "Disjointness" rule.)
//   A == B  OR  either is a directory whose segment list is a prefix of the other's.
//   A *file* matches only an exactly-equal entry; a *directory* matches itself + everything beneath.
function isPrefix(short, long) {
  if (short.length > long.length) return false;
  for (let i = 0; i < short.length; i++) {
    if (short[i] !== long[i]) return false;
  }
  return true;
}
function entriesOverlap(a, b) {
  // Exact match (same segments). Note: a file "src" and a dir "src/" have identical segs but
  // differ on the dir flag; per the rule a file matches ONLY an exactly-equal entry, and a
  // dir matches itself + descendants. Equal segs always overlap regardless of flag (the dir
  // case is "matches itself"; the file==file case is exact equality).
  if (a.segs.length === b.segs.length && isPrefix(a.segs, b.segs)) return true;
  // Prefix cases require the prefix side to be a DIRECTORY.
  if (a.dir && isPrefix(a.segs, b.segs)) return true;
  if (b.dir && isPrefix(b.segs, a.segs)) return true;
  return false;
}

// Do two tasks' write-sets overlap? (any entry of one overlaps any entry of the other)
function writeSetsConflict(taskA, taskB) {
  for (const a of taskA._normFiles) {
    for (const b of taskB._normFiles) {
      if (entriesOverlap(a, b)) return true;
    }
  }
  return false;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

// Defensive, fail-fast validation of args.tasks. Throws a clear Error on the FIRST violation,
// before any agent is dispatched. Mutates each task with a `_normFiles` cache.
function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("args.tasks must be a non-empty array");
  }
  const byId = new Map();
  // Pass 1: per-task structural validation + id uniqueness + path normalization.
  for (const t of tasks) {
    if (t === null || typeof t !== "object") {
      throw new Error(`each task must be an object (got ${JSON.stringify(t)})`);
    }
    if (typeof t.id !== "string" || !ID_RE.test(t.id)) {
      throw new Error(`task id must match ${ID_RE} (got ${JSON.stringify(t.id)})`);
    }
    if (byId.has(t.id)) {
      throw new Error(`duplicate task id: ${t.id}`);
    }
    for (const k of ["title", "slice", "test"]) {
      if (typeof t[k] !== "string" || t[k].trim() === "") {
        throw new Error(`task ${t.id}: "${k}" must be a non-empty string`);
      }
    }
    if (!Array.isArray(t.files) || t.files.length === 0) {
      throw new Error(`task ${t.id}: "files" must be a non-empty sequence`);
    }
    if (t.deps !== undefined && !Array.isArray(t.deps)) {
      throw new Error(`task ${t.id}: "deps" must be a sequence (or omitted)`);
    }
    // Normalize every declared path now; surface the task id with any path error.
    t._normFiles = t.files.map((f) => {
      try {
        return normalizePath(f);
      } catch (e) {
        throw new Error(`task ${t.id}: ${e.message}`);
      }
    });
    t._deps = Array.isArray(t.deps) ? t.deps.slice() : [];
    byId.set(t.id, t);
  }
  // Pass 2: every dep resolves to a known id (and isn't a self-dep).
  for (const t of tasks) {
    for (const d of t._deps) {
      if (typeof d !== "string") {
        throw new Error(`task ${t.id}: dep ${JSON.stringify(d)} is not a string id`);
      }
      if (d === t.id) {
        throw new Error(`task ${t.id}: depends on itself`);
      }
      if (!byId.has(d)) {
        throw new Error(`task ${t.id}: dep "${d}" does not resolve to a known task`);
      }
    }
  }
  // Pass 3: no dependency cycle (DFS with white/grey/black coloring).
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map(tasks.map((t) => [t.id, WHITE]));
  const stack = []; // for a readable cycle path in the error
  function dfs(id) {
    color.set(id, GREY);
    stack.push(id);
    for (const d of byId.get(id)._deps) {
      const c = color.get(d);
      if (c === GREY) {
        const cycle = stack.slice(stack.indexOf(d)).concat(d).join(" -> ");
        throw new Error(`dependency cycle detected: ${cycle}`);
      }
      if (c === WHITE) dfs(d);
    }
    color.set(id, BLACK);
    stack.pop();
  }
  for (const t of tasks) {
    if (color.get(t.id) === WHITE) dfs(t.id);
  }
  return byId;
}

// =======================================================================================
// SECTION 2 — Topological layering + within-layer partition (disjoint vs conflicting)
// =======================================================================================

// Compute topological LAYERS over the tasks NOT in `done`. A task is placed in the earliest
// layer in which all of its deps are already satisfied (either pre-done, or in a prior layer).
// We must also drop tasks whose deps are blocked/unsatisfiable at runtime — but that pruning
// happens dynamically during execution (Section 4), so here we lay out the *static* DAG.
function computeLayers(tasks, byId, doneSet) {
  const remaining = tasks.filter((t) => !doneSet.has(t.id));
  const satisfied = new Set(doneSet); // ids considered "available as a dep"
  const layers = [];
  const placed = new Set();
  // Iterate: each round, take every still-unplaced task whose deps are all satisfied.
  while (placed.size < remaining.length) {
    const layer = remaining.filter(
      (t) => !placed.has(t.id) && t._deps.every((d) => satisfied.has(d)),
    );
    if (layer.length === 0) {
      // No progress possible though tasks remain => deps reference something neither done
      // nor in `remaining` (e.g. a dep that is itself excluded). validateTasks already proved
      // all deps resolve and there's no cycle, so the only way here is a dep that is neither
      // done nor scheduled — treat as a hard contract error.
      const stuck = remaining.filter((t) => !placed.has(t.id)).map((t) => t.id);
      throw new Error(
        `cannot layer tasks [${stuck.join(", ")}]: a dependency is neither done nor scheduled`,
      );
    }
    // Deterministic order within a layer (id sort) so logs/partitions are reproducible
    // (no Math.random / Date available, and we want stable behavior anyway).
    layer.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    layers.push(layer);
    for (const t of layer) {
      placed.add(t.id);
      satisfied.add(t.id);
    }
  }
  return layers;
}

// Partition ONE layer into a file-disjoint group (safe to fan out together) and a
// conflicting remainder (must run sequentially). Greedy: walk tasks in deterministic order,
// add to the disjoint group only if it conflicts with NOTHING already accepted there;
// otherwise push to the sequential remainder. (The remainder still runs — just not in
// parallel with a task it overlaps. We integrate-serialize them anyway, but keeping them out
// of the parallel implement phase avoids two agents editing the same file at once.)
function partitionLayer(layer) {
  const disjoint = [];
  const sequential = [];
  for (const t of layer) {
    const clashes = disjoint.some((u) => writeSetsConflict(t, u));
    if (clashes) sequential.push(t);
    else disjoint.push(t);
  }
  return { disjoint, sequential };
}

// =======================================================================================
// SECTION 3 — Agent return SCHEMAS (one small schema per structured stage)
// =======================================================================================
// These are the contracts each dispatched agent must return. The runtime validates the
// agent's structured output against the schema; a violation (or a dead agent) yields null,
// which we uniformly treat as "blocked" (Section 4). Keeping schemas tiny + explicit is what
// lets the script thread data safely between agents without any fs of its own.

const provisionSchema = {
  type: "object",
  required: ["ok", "taskId", "path"],
  properties: {
    ok: { type: "boolean" }, // false => worktree add failed
    taskId: { type: "string" },
    path: { type: "string" }, // absolute ephemeral worktree path the worker must use
    error: { type: "string" },
  },
};

const implementSchema = {
  type: "object",
  required: ["ok", "taskId", "changedFiles", "summary"],
  properties: {
    ok: { type: "boolean" },
    taskId: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" } }, // for write-set audit
    summary: { type: "string" },
    error: { type: "string" },
  },
};

const gateSchema = {
  type: "object",
  required: ["taskId", "pass", "coverage", "blocking"],
  properties: {
    taskId: { type: "string" },
    pass: { type: "boolean" }, // VERDICT: PASS => true
    coverage: { type: "string" }, // "CROSS-MODEL" | "DEGRADED" (review-task.md §7)
    blocking: { type: "array", items: { type: "string" } }, // Critical+Important findings
    notes: { type: "string" },
  },
};

const commitSchema = {
  type: "object",
  required: ["ok", "taskId", "commitSha"],
  properties: {
    ok: { type: "boolean" },
    taskId: { type: "string" },
    commitSha: { type: "string" }, // the trailer-bearing commit in the task worktree
    error: { type: "string" },
  },
};

const integrateSchema = {
  type: "object",
  required: ["ok", "taskId", "clean", "newHead"],
  properties: {
    ok: { type: "boolean" }, // false => integration failed even after auto-serialize
    taskId: { type: "string" },
    clean: { type: "boolean" }, // true => replayed with no conflict
    conflict: { type: "boolean" }, // true => a SURPRISE overlap was hit
    newHead: { type: "string" }, // feature-branch HEAD after this integration (or prior head)
    conflictFiles: { type: "array", items: { type: "string" } },
    error: { type: "string" },
  },
};

const checkpointSchema = {
  type: "object",
  required: ["ok", "head"],
  properties: {
    ok: { type: "boolean" },
    head: { type: "string" }, // feature HEAD after the NO-trailer bookkeeping commit
    error: { type: "string" },
  },
};

const cleanupSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" }, error: { type: "string" } },
};

// =======================================================================================
// SECTION 4 — Agent-prompt builders (every side effect lives here, in a dispatched agent)
// =======================================================================================
// Each builder returns the PROMPT string. The agent does the real fs/git/test/codex work;
// the script never touches them. Prompts are explicit about absolute paths because agent()
// has NO `cwd` param — an under-specified path lets the agent drift back to the launcher
// worktree (the exact failure the spike warned about).

// A deterministic, fs-safe ephemeral worktree path for a task. No timestamps/random allowed.
// The launcher passes args.repo; worktrees live under <repo>/.dev-loop/worktrees/<id>, nested
// inside the main working tree. We do NOT assume `.dev-loop/` is gitignored — every bookkeeping
// `git add` is path-scoped (see checkpointPrompt) so these worktree dirs are never staged as
// embedded gitlinks. Cleaned up after integration. Sanitize the id into the path even though ids
// are already [A-Za-z0-9_-].
function worktreePathFor(repo, id) {
  const safeId = String(id).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${repo}/.dev-loop/worktrees/${safeId}`;
}

function provisionPrompt(repo, task, layerBaseSha) {
  const path = worktreePathFor(repo, task.id);
  return [
    `You are the PROVISIONING agent for dev-loop task ${task.id}.`,
    `Create an isolated git worktree based on an EXACT recorded sha (NOT a branch tip — the`,
    `feature branch may have unpushed dependency commits we must inherit).`,
    ``,
    `Run exactly:`,
    `  git -C "${repo}" worktree prune    # clear any stale registration for a reused path`,
    `  rm -rf "${path}"                   # remove any leftover dir from a prior aborted run`,
    `  git -C "${repo}" worktree add --detach "${path}" ${layerBaseSha}`,
    ``,
    `The worktree must be DETACHED at ${layerBaseSha} so we can commit freely without`,
    `moving any branch. If every command succeeds, return ok=true, taskId="${task.id}",`,
    `path="${path}". If anything fails, return ok=false with the error text and the same`,
    `taskId/path. Do NOT edit any source files.`,
  ].join("\n");
}

function implementPrompt(task, worktreePath, glossary, lockedDecisions) {
  const fileList = task.files.join(", ");
  return [
    `You are the IMPLEMENTER for dev-loop task ${task.id}: ${task.title}.`,
    ``,
    `=== Your isolated worktree (work ONLY here) ===`,
    `Absolute worktree path: ${worktreePath}`,
    `You have NO cwd set. EVERY file you edit MUST use an absolute path under that worktree,`,
    `and EVERY git command MUST use \`git -C "${worktreePath}" ...\`. Do not touch any path`,
    `outside this worktree, and do not 'cd' elsewhere.`,
    ``,
    `=== The slice (do exactly this, nothing more) ===`,
    task.slice,
    ``,
    `=== Declared write-set (stay strictly inside it) ===`,
    `You may create/modify ONLY these paths (a dir entry covers everything beneath it):`,
    `  ${fileList}`,
    `Editing anything outside this set is scope creep and WILL fail the review gate — and can`,
    `silently break a task running in parallel. If the slice seems to need an out-of-set edit,`,
    `STOP and return ok=false explaining why instead of editing it.`,
    ``,
    `=== Validation command (your work must make this pass) ===`,
    `  ${task.test}`,
    `Run it with \`git -C\`/absolute paths inside the worktree; iterate until it passes.`,
    ``,
    `=== Shared context (do NOT re-litigate these) ===`,
    `Domain glossary:\n${glossary}`,
    ``,
    `Locked decisions:\n${lockedDecisions}`,
    ``,
    `Do NOT stage or commit — leave changes in the worktree's working tree (the gate reviews`,
    `the unstaged diff; a later agent commits on pass). Return ok=true with changedFiles (the`,
    `absolute or repo-relative paths you actually modified) and a one-paragraph summary. If you`,
    `cannot complete the slice, return ok=false with the error and whatever changedFiles exist.`,
  ].join("\n");
}

function gatePrompt(task, worktreePath, reviewGate) {
  return [
    `You are the REVIEW GATE for dev-loop task ${task.id}. Follow the locked dual-model review`,
    `procedure VERBATIM — do not substitute any other reviewer plugin/skill.`,
    ``,
    `Repo/worktree under review ($REPO): ${worktreePath}`,
    `Scope = the UNSTAGED working-tree diff in that worktree:`,
    `  git -C "${worktreePath}" diff`,
    `Judge ONLY that diff, by the rubric, with BOTH lenses (rubric-correctness + adversarial`,
    `hostile-parser; codex cross-model when healthy, else the divergent-persona Claude fallback).`,
    ``,
    `Task under review: ${task.title} — ${task.slice}`,
    `Declared write-set (out-of-set edits are scope creep per the rubric): ${task.files.join(", ")}`,
    `Validation command that must pass: ${task.test}`,
    ``,
    `=== The gate procedure to follow ===`,
    reviewGate,
    ``,
    `Return: taskId="${task.id}", pass (true iff final VERDICT is PASS = zero unresolved`,
    `Critical/Important), coverage ("CROSS-MODEL" or "DEGRADED"), blocking (the list of`,
    `Critical+Important findings as "file:line — problem", empty if none), and notes.`,
  ].join("\n");
}

function fixPrompt(task, worktreePath, blocking) {
  return [
    `You are the FIX agent for dev-loop task ${task.id}, addressing review-gate findings.`,
    `Work ONLY in the worktree at ${worktreePath} using absolute paths + \`git -C\`.`,
    `Stay inside the declared write-set: ${task.files.join(", ")}.`,
    ``,
    `Blocking findings to resolve (do not introduce new scope):`,
    blocking.map((b, i) => `  ${i + 1}. ${b}`).join("\n"),
    ``,
    `Re-run the validation command after fixing: ${task.test}`,
    `Leave changes UNSTAGED (do not commit). Return ok, taskId, changedFiles, summary.`,
  ].join("\n");
}

function commitPrompt(task, worktreePath) {
  // The trailer MUST be the literal id (e.g. "Dev-Loop-Task: T4"), never "T<id>".
  return [
    `You are the COMMIT agent for dev-loop task ${task.id} (it just PASSED the gate).`,
    `In the worktree at ${worktreePath}, run exactly:`,
    `  git -C "${worktreePath}" add -A`,
    `  git -C "${worktreePath}" commit -m "${task.id}: ${task.title}" -m "" --trailer "Dev-Loop-Task: ${task.id}"`,
    ``,
    `The commit MUST carry exactly ONE trailer line \`Dev-Loop-Task: ${task.id}\` (the literal`,
    `id). This trailer is what marks the task APPROVED. Then capture the resulting sha:`,
    `  git -C "${worktreePath}" rev-parse HEAD`,
    `Return ok, taskId="${task.id}", commitSha=<that sha>. On any failure return ok=false + error.`,
  ].join("\n");
}

function integratePrompt(repo, featureBranch, task, worktreePath, commitSha, expectedFeatureHead) {
  return [
    `You are the INTEGRATE agent for dev-loop task ${task.id}. Replay its approved commit onto`,
    `the feature branch "${featureBranch}" in the main repo at ${repo}.`,
    ``,
    `The approved commit is ${commitSha} in the worktree ${worktreePath}.`,
    `The feature branch HEAD is expected to be ${expectedFeatureHead}.`,
    ``,
    `Procedure:`,
    `  1. Ensure ${repo} has "${featureBranch}" checked out at ${expectedFeatureHead}.`,
    `  2. Cherry-pick the commit onto it:`,
    `       git -C "${repo}" cherry-pick ${commitSha}`,
    `  3. If it applies CLEANLY: return ok=true, clean=true, conflict=false,`,
    `     newHead=<git -C "${repo}" rev-parse HEAD>.`,
    `  4. If it CONFLICTS (a SURPRISE overlap — these tasks were declared disjoint): this is NOT`,
    `     a cherry-pick-retry situation — abort the cherry-pick`,
    `       git -C "${repo}" cherry-pick --abort`,
    `     and return ok=true, clean=false, conflict=true, newHead=${expectedFeatureHead}`,
    `     (UNCHANGED feature head), and conflictFiles=<the conflicting paths>. The orchestrator`,
    `     will then drive the rebase-and-re-run auto-serialize path; do NOT try to resolve the`,
    `     conflict yourself here.`,
    `  5. On any other git error, return ok=false with the error and newHead=${expectedFeatureHead}.`,
  ].join("\n");
}

function rebasePrompt(repo, featureBranch, task, worktreePath, newBaseHead) {
  // The auto-serialize path: the loser rebases onto the updated feature HEAD, then the caller
  // RE-RUNS implement+gate on that new base (handled by the orchestrator, not here).
  return [
    `You are the REBASE agent for dev-loop task ${task.id} (a surprise integration conflict`,
    `means its base is stale). Reset its worktree onto the updated feature HEAD so the task can`,
    `be RE-IMPLEMENTED and RE-GATED on the new base (NOT cherry-picked again — that reproduces`,
    `the conflict).`,
    ``,
    `In the worktree ${worktreePath}, run:`,
    `  git -C "${worktreePath}" reset --hard ${newBaseHead}`,
    `This discards the now-stale task commit + working changes and rebases the worktree onto`,
    `${newBaseHead} (the current "${featureBranch}" HEAD in ${repo}). The orchestrator will`,
    `re-dispatch implement → gate → commit on this fresh base. Return ok + (reuse the cleanup`,
    `schema: just ok / error).`,
  ].join("\n");
}

function checkpointPrompt(args, layerIndex, totalLayers, statusRows, worktreeMap, baseSha, featureHead) {
  const rows = statusRows
    .map((r) => `| ${r.id} | ${r.status} | ${r.worktree || "—"} | ${r.notes || ""} |`)
    .join("\n");
  const wmap = Object.keys(worktreeMap).length
    ? Object.entries(worktreeMap).map(([id, p]) => `${id} -> ${p}`).join("; ")
    : "(none in-flight)";
  return [
    `You are the CHECKPOINT agent. Update the durable cursor after layer ${layerIndex + 1}/${totalLayers},`,
    `then make a BOOKKEEPING commit with NO trailer so the feature worktree ends clean.`,
    ``,
    `Do NOT modify ${args.planPath}. plan.md is the authoritative tasks DAG; live status lives`,
    `ONLY in progress.md + git commit trailers (it has no checkboxes to tick). Touch ONLY`,
    `progress.md below.`,
    ``,
    `1. Rewrite ${args.progressPath} (the resume cursor) with:`,
    `   - Feature worktree: ${args.repo}   Branch: ${args.featureBranch}`,
    `   - Base sha: ${baseSha}   Layer cursor: ${layerIndex + 1}/${totalLayers}`,
    `   - Workflow runId: none   (never relied on across /clear)`,
    `   - Task status table (verbatim rows below):`,
    rows,
    `   - Worktree map (in-flight only): ${wmap}`,
    `2. Commit the progress.md update in the feature branch at ${args.repo} with NO Dev-Loop-Task`,
    `   trailer (this is bookkeeping, not a task). Stage ONLY progress.md — never \`add -A\`,`,
    `   because the task worktrees under ${args.repo}/.dev-loop/ are NOT gitignored and a bare`,
    `   \`add -A\` would stage them as embedded gitlinks and corrupt the feature branch:`,
    `     git -C "${args.repo}" add -A -- "${args.progressPath}"`,
    `     git -C "${args.repo}" commit -m "checkpoint: after layer ${layerIndex + 1}/${totalLayers}"`,
    `   If there is nothing to commit, that's fine — report the current head.`,
    ``,
    `The current feature HEAD before your bookkeeping commit is ${featureHead}.`,
    `Return ok=true and head=<git -C "${args.repo}" rev-parse HEAD> after committing.`,
  ].join("\n");
}

function cleanupPrompt(repo, task, worktreePath) {
  return [
    `You are the CLEANUP agent for dev-loop task ${task.id}. Remove its ephemeral worktree.`,
    `Run:`,
    `  git -C "${repo}" worktree remove --force "${worktreePath}"`,
    `  git -C "${repo}" worktree prune`,
    `Return ok=true on success, else ok=false + error. Removing an already-gone worktree is`,
    `success (idempotent cleanup).`,
  ].join("\n");
}

// =======================================================================================
// SECTION 5 — Per-task execution (implement → gate → commit), with the bounded fix loop
// =======================================================================================
// Returns a task-result object: { id, approved, commitSha?, worktreePath, reason? }.
// On any failure / null agent / gate block, approved=false with a reason. NEVER throws —
// failures are values so a bad task can't abort a layer.

const MAX_FIX_CYCLES = 2; // ≤2 fix→review cycles per the plan

async function provisionTask(args, task, layerBaseSha) {
  const res = await agent(provisionPrompt(args.repo, task, layerBaseSha), {
    schema: provisionSchema,
    label: `provision:${task.id}`,
    phase: "provision",
  });
  if (!res || !res.ok) {
    return { ok: false, reason: `provision failed${res && res.error ? `: ${res.error}` : " (agent died)"}` };
  }
  return { ok: true, path: res.path };
}

// Run implement + the bounded gate loop in an ALREADY-PROVISIONED worktree. Used both for the
// first attempt and (verbatim) for the auto-serialize re-run on a fresh base.
async function implementAndGate(args, task, worktreePath) {
  // implement
  const impl = await agent(
    implementPrompt(task, worktreePath, args.glossary, args.lockedDecisions),
    { schema: implementSchema, label: `implement:${task.id}`, phase: "implement" },
  );
  if (!impl || !impl.ok) {
    return { approved: false, reason: `implement failed${impl && impl.error ? `: ${impl.error}` : " (agent died)"}` };
  }

  // gate, with up to MAX_FIX_CYCLES fix→review iterations
  let gate = await agent(gatePrompt(task, worktreePath, args.reviewGate), {
    schema: gateSchema,
    label: `gate:${task.id}:0`,
    phase: "gate",
  });
  let coverage = gate ? gate.coverage : "UNKNOWN";
  let cycle = 0;
  while ((!gate || !gate.pass) && cycle < MAX_FIX_CYCLES) {
    if (gate === null) {
      // A dead gate agent is itself a block — we cannot certify the task. Do not loop forever.
      return { approved: false, reason: "review gate agent died (no verdict)" };
    }
    cycle += 1;
    const fix = await agent(fixPrompt(task, worktreePath, gate.blocking || []), {
      schema: implementSchema,
      label: `fix:${task.id}:${cycle}`,
      phase: "implement",
    });
    if (!fix || !fix.ok) {
      return { approved: false, reason: `fix attempt ${cycle} failed${fix && fix.error ? `: ${fix.error}` : " (agent died)"}` };
    }
    gate = await agent(gatePrompt(task, worktreePath, args.reviewGate), {
      schema: gateSchema,
      label: `gate:${task.id}:${cycle}`,
      phase: "gate",
    });
    if (gate) coverage = gate.coverage;
  }
  if (!gate || !gate.pass) {
    return {
      approved: false,
      reason: `gate FAILED after ${MAX_FIX_CYCLES} fix cycles${gate && gate.blocking ? `: ${gate.blocking.join("; ")}` : ""}`,
      coverage,
    };
  }

  // commit-in-worktree on pass (writes the Dev-Loop-Task trailer)
  const commit = await agent(commitPrompt(task, worktreePath), {
    schema: commitSchema,
    label: `commit:${task.id}`,
    phase: "commit",
  });
  if (!commit || !commit.ok) {
    return { approved: false, reason: `commit failed${commit && commit.error ? `: ${commit.error}` : " (agent died)"}`, coverage };
  }
  return { approved: true, commitSha: commit.commitSha, coverage };
}

// =======================================================================================
// SECTION 6 — The orchestrator entry point
// =======================================================================================
async function devLoop(args) {
  // ---- Phase: validate (defensive, fail-fast, BEFORE any side effect) ----
  phase("validate");
  if (args === undefined || args === null || typeof args !== "object") {
    throw new Error("Workflow args missing: expected the validated DAG + state object");
  }
  for (const k of ["repo", "baseSha", "planPath", "progressPath", "reviewGate", "tasks"]) {
    if (args[k] === undefined || args[k] === null || args[k] === "") {
      throw new Error(`args.${k} is required`);
    }
  }
  const glossary = typeof args.glossary === "string" ? args.glossary : "(none provided)";
  const lockedDecisions = typeof args.lockedDecisions === "string" ? args.lockedDecisions : "(none provided)";
  // Re-pack so the prompt builders see normalized fields even if the launcher omitted them.
  args.glossary = glossary;
  args.lockedDecisions = lockedDecisions;
  args.featureBranch = args.featureBranch || "(feature branch)";

  const byId = validateTasks(args.tasks);
  const doneSet = new Set(Array.isArray(args.done) ? args.done : []);
  // A done id that isn't a known task is suspicious but not fatal — log and ignore it.
  for (const d of doneSet) {
    if (!byId.has(d)) log(`warn: args.done contains unknown id "${d}" — ignoring`);
  }

  const layers = computeLayers(args.tasks, byId, doneSet);
  log(`validated ${args.tasks.length} tasks; ${doneSet.size} already done; ${layers.length} layer(s) to run`);

  // ---- Orchestration state ----
  let layerBaseSha = args.baseSha;          // worktrees for the CURRENT layer base on this sha
  let featureHead = args.baseSha;           // running feature-branch HEAD (advanced by integrate/checkpoint)
  const approved = [];                       // ids approved this run
  const blocked = [];                        // { id, reason }
  const blockedSet = new Set();              // ids that are blocked (for dependent pruning)
  const coverageNotes = [];                  // per-task review coverage (flag any DEGRADED)
  // status mirror for the checkpoint table (start from done + pending)
  const statusById = new Map();
  for (const t of args.tasks) {
    statusById.set(t.id, doneSet.has(t.id) ? "done" : "pending");
  }

  // Helper: is any dep of this task blocked? (skip dependents of a blocked task)
  function depsBlocked(task) {
    return task._deps.some((d) => blockedSet.has(d));
  }

  // ---- Walk the layers ----
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    phase(`layer ${li + 1}/${layers.length}`);

    // Prune tasks whose deps got blocked in an earlier layer: skip ONLY them, keep going.
    const runnable = [];
    for (const t of layer) {
      if (depsBlocked(t)) {
        const reason = `skipped — depends on blocked task(s): ${t._deps.filter((d) => blockedSet.has(d)).join(", ")}`;
        blocked.push({ id: t.id, reason });
        blockedSet.add(t.id);
        statusById.set(t.id, "blocked");
        log(`block ${t.id}: ${reason}`);
      } else {
        runnable.push(t);
      }
    }
    if (runnable.length === 0) {
      log(`layer ${li + 1}: nothing runnable (all dependents blocked)`);
      continue;
    }

    // Partition into a file-disjoint fan-out group + a conflicting remainder (run serially).
    const { disjoint, sequential } = partitionLayer(runnable);
    log(
      `layer ${li + 1}: ${disjoint.length} disjoint (fan out), ${sequential.length} conflicting (sequential)`,
    );

    // Provisioning is a SEQUENTIAL stage that runs FIRST, before any fan-out. Each task's
    // worktree is created by an agent running `git worktree add`, which writes shared
    // `.git/worktrees` metadata and takes `index.lock`; firing those concurrently across a layer
    // risks lock contention / corrupt registration. So we provision every runnable task one at a
    // time here, recording { taskId, path } (or a provision failure) for each. THEN we fan out
    // implement→gate→commit over the already-provisioned paths.
    //
    // After provisioning, the disjoint group runs through implement+gate+commit via pipeline (no
    // barrier: each task flows on its own, concurrency auto-capped), and the conflicting remainder
    // runs sequentially so two agents never edit the same file concurrently. Both paths produce
    // the SAME task-result shape.
    //
    // We must collect ALL task results before the sequential INTEGRATE step (integration mutates
    // the shared feature branch and must be ordered) — so the pipeline's returned array is the
    // barrier point for *results*, and the ordered integrate loop runs below.

    // -- SEQUENTIAL provisioning pass: create every runnable task's worktree one at a time. --
    // Records the provisioned path per task; a provision failure is captured as a terminal result.
    const provisioned = new Map();   // taskId -> worktree path (only successfully provisioned)
    const provisionFailures = [];    // task-result objects for tasks whose provisioning failed
    for (const task of runnable) {
      statusById.set(task.id, "in-flight");
      const prov = await provisionTask(args, task, layerBaseSha);
      if (!prov.ok) {
        provisionFailures.push({ id: task.id, approved: false, reason: prov.reason, worktreePath: null });
      } else {
        provisioned.set(task.id, prov.path);
      }
    }

    // -- run one ALREADY-PROVISIONED task through implement+gate+commit, returning a result. --
    async function runTask(task) {
      const worktreePath = provisioned.get(task.id);
      const r = await implementAndGate(args, task, worktreePath);
      if (r.coverage) coverageNotes.push(`${task.id}: ${r.coverage}`);
      return {
        id: task.id,
        approved: r.approved,
        reason: r.reason,
        commitSha: r.commitSha,
        worktreePath,
      };
    }

    // Only tasks that provisioned successfully fan out into implement+gate+commit.
    const disjointRun = disjoint.filter((t) => provisioned.has(t.id));
    const sequentialRun = sequential.filter((t) => provisioned.has(t.id));

    // Fan out the disjoint group via pipeline (single stage `runTask`; no barrier between
    // tasks, concurrency auto-capped). Then run the sequential remainder one at a time.
    // `pipeline` returns the collected results — that collection is our barrier before integrate.
    let disjointResults = [];
    if (disjointRun.length > 0) {
      disjointResults = await pipeline(disjointRun, (task) => runTask(task));
      // pipeline returns null on internal throw; normalize to an all-blocked array so we never
      // lose track of a task. (Individual thunk throws already resolve to null per-item.)
      if (disjointResults === null) {
        disjointResults = disjointRun.map((t) => ({ id: t.id, approved: false, reason: "pipeline error", worktreePath: provisioned.get(t.id) }));
      }
      // A null entry = that task's thunk threw => blocked with its provisioned worktree.
      disjointResults = disjointResults.map((res, i) =>
        res === null
          ? { id: disjointRun[i].id, approved: false, reason: "task agent died (null)", worktreePath: provisioned.get(disjointRun[i].id) }
          : res,
      );
    }

    const sequentialResults = [];
    for (const task of sequentialRun) {
      const res = await runTask(task);
      sequentialResults.push(res || { id: task.id, approved: false, reason: "task agent died (null)", worktreePath: provisioned.get(task.id) });
    }

    // Combine, preserving a deterministic order (disjoint first, then sequential — both already
    // id-sorted within their group via partitionLayer's stable input order). Provision failures
    // are appended so the integrate loop records them as blocked (they have no worktree to clean).
    const layerResults = disjointResults.concat(sequentialResults).concat(provisionFailures);

    // ---- Sequential INTEGRATE (ordered; mutates the shared feature branch) ----
    // Only approved tasks integrate. A surprise conflict triggers the rebase-and-re-run path.
    for (const res of layerResults) {
      const task = byId.get(res.id);
      if (!res.approved) {
        blocked.push({ id: res.id, reason: res.reason || "blocked" });
        blockedSet.add(res.id);
        statusById.set(res.id, "blocked");
        log(`block ${res.id}: ${res.reason || "blocked"}`);
        continue;
      }

      // Try to integrate the approved commit onto the current feature HEAD.
      let integrated = await integrateOne(args, task, res, featureHead);

      // SURPRISE conflict => auto-serialize: rebase the loser onto the updated HEAD and RE-RUN
      // implement+gate+commit on that new base, then integrate again. ONE re-run attempt.
      if (integrated && integrated.ok && integrated.conflict) {
        log(`surprise conflict integrating ${res.id} (${(integrated.conflictFiles || []).join(", ")}); auto-serializing`);
        const reRun = await autoSerialize(args, task, res, featureHead);
        if (!reRun.approved) {
          blocked.push({ id: res.id, reason: `auto-serialize failed: ${reRun.reason}` });
          blockedSet.add(res.id);
          statusById.set(res.id, "blocked");
          log(`block ${res.id}: auto-serialize failed: ${reRun.reason}`);
          continue;
        }
        // Integrate the freshly re-run commit (now based on the updated HEAD => should be clean).
        res.commitSha = reRun.commitSha;
        integrated = await integrateOne(args, task, res, featureHead);
        if (integrated && integrated.ok && integrated.conflict) {
          // Still conflicting after rebase-and-re-run => block (per plan).
          blocked.push({ id: res.id, reason: "still conflicting after rebase-and-re-run" });
          blockedSet.add(res.id);
          statusById.set(res.id, "blocked");
          log(`block ${res.id}: still conflicting after rebase-and-re-run`);
          continue;
        }
      }

      if (!integrated || !integrated.ok) {
        blocked.push({ id: res.id, reason: `integrate failed${integrated && integrated.error ? `: ${integrated.error}` : " (agent died)"}` });
        blockedSet.add(res.id);
        statusById.set(res.id, "blocked");
        log(`block ${res.id}: integrate failed`);
        continue;
      }

      // Success: advance the feature head, mark approved.
      featureHead = integrated.newHead;
      approved.push(res.id);
      statusById.set(res.id, "done");
      log(`approved ${res.id}; feature head now ${featureHead}`);
    }

    // ---- Worktree cleanup for every task we provisioned this layer ----
    // (Both approved and blocked tasks may have left a worktree; remove all of them. Cleanup
    // is best-effort and never blocks progress.)
    const toClean = layerResults.filter((r) => r.worktreePath);
    if (toClean.length > 0) {
      let cleanupResults = await pipeline(toClean, (r) =>
        agent(cleanupPrompt(args.repo, byId.get(r.id), r.worktreePath), {
          schema: cleanupSchema,
          label: `cleanup:${r.id}`,
          phase: "cleanup",
        }),
      );
      // Cleanup is best-effort and never blocks progress, but a silently-skipped removal leaves a
      // stale worktree behind — so surface any failed/null/ok:false result (with the path to fix).
      if (cleanupResults === null) cleanupResults = toClean.map(() => null);
      cleanupResults.forEach((cr, i) => {
        if (!cr || !cr.ok) {
          const r = toClean[i];
          log(`warn: cleanup failed for ${r.id} at ${r.worktreePath}${cr && cr.error ? `: ${cr.error}` : " (agent died)"}; worktree may be stale`);
        }
      });
    }

    // ---- CHECKPOINT (ordered, single agent): rewrite progress.md (NOT plan.md — it stays the
    // authoritative DAG), then make a NO-trailer, path-scoped bookkeeping commit so the feature
    // worktree ends clean. ----
    const statusRows = args.tasks.map((t) => ({
      id: t.id,
      status: statusById.get(t.id),
      worktree: "—", // all this layer's worktrees are now cleaned up
      notes: blockedSet.has(t.id) ? (blocked.find((b) => b.id === t.id) || {}).reason || "" : "",
    }));
    const cp = await agent(
      checkpointPrompt(args, li, layers.length, statusRows, /*worktreeMap*/ {}, args.baseSha, featureHead),
      { schema: checkpointSchema, label: `checkpoint:layer${li + 1}`, phase: "checkpoint" },
    );
    if (cp && cp.ok && cp.head) {
      featureHead = cp.head; // bookkeeping commit advances HEAD; the NEXT layer bases here
    } else {
      // A failed checkpoint is a durability risk but not a correctness one (trailers in git
      // are still the source of truth). Log loudly and continue with the last known head.
      log(`warn: checkpoint after layer ${li + 1} failed${cp && cp.error ? `: ${cp.error}` : ""}; continuing on head ${featureHead}`);
    }

    // The next layer's worktrees base on the feature HEAD AFTER this layer fully integrated +
    // checkpointed — so they inherit every commit (incl. unpushed) produced so far.
    layerBaseSha = featureHead;
  }

  // ---- Phase: report ----
  phase("report");
  const result = {
    approved,
    blocked,
    finalHead: featureHead,
    layers: layers.length,
    coverageNotes,
  };
  log(`done: ${approved.length} approved, ${blocked.length} blocked, final head ${featureHead}`);
  if (coverageNotes.some((c) => /DEGRADED/.test(c))) {
    log(`warn: some gates ran DEGRADED (Claude-only, no cross-model coverage) — see coverageNotes`);
  }
  return result;
}

// ---- integrate one approved task; returns the integrate schema object (or null) ----
async function integrateOne(args, task, res, expectedFeatureHead) {
  return agent(
    integratePrompt(args.repo, args.featureBranch, task, res.worktreePath, res.commitSha, expectedFeatureHead),
    { schema: integrateSchema, label: `integrate:${task.id}`, phase: "integrate" },
  );
}

// ---- auto-serialize: rebase the loser onto the updated HEAD, then RE-RUN implement+gate+commit
// on the new base (NOT a bare cherry-pick retry). Returns a task-result-like { approved, ... }. ----
async function autoSerialize(args, task, res, newBaseHead) {
  const rebased = await agent(rebasePrompt(args.repo, args.featureBranch, task, res.worktreePath, newBaseHead), {
    schema: cleanupSchema, // reuse {ok, error}
    label: `rebase:${task.id}`,
    phase: "integrate",
  });
  if (!rebased || !rebased.ok) {
    return { approved: false, reason: `rebase failed${rebased && rebased.error ? `: ${rebased.error}` : " (agent died)"}` };
  }
  // Re-run implement -> gate -> commit on the now-current base, in the SAME worktree.
  return implementAndGate(args, task, res.worktreePath);
}

// =======================================================================================
// Workflow ENTRY: the runtime executes the top-level body and captures its return value.
// A Workflow script is NOT a standalone ES module — it uses top-level await + return, so
// `node --check` will report "return outside of function". That is EXPECTED; the runtime
// wraps this body in an async function. Do not "fix" it back into `export default`.
// =======================================================================================
// The runtime exposes the launch input as the global `args`. Be robust: some paths deliver
// it as a JSON string — coerce to an object before handing it to the orchestrator.
let __args = typeof args === "undefined" ? undefined : args;
if (typeof __args === "string") {
  try { __args = JSON.parse(__args); }
  catch (e) { throw new Error("Workflow args arrived as a non-JSON string: " + e.message); }
}
return await devLoop(__args);
