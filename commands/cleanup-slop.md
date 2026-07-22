---
description: Strip Claude slop from generated code — narration comments, doc-comment essays, stale refs, prose-y CHANGELOG entries
---

You're cleaning up Claude-generated slop from code that doesn't match the user's style. The user has already reviewed and found it overwritten with narration; they want the functional content kept and the prose trimmed.

## Scope

Look at the work indicated in `$ARGUMENTS` (e.g. "unpushed commits on this branch", "the working tree diff", "PR #123", "commits since main"). If unclear, default to the working tree diff (`git diff` + untracked files) plus any unpushed commits on the current branch (`git log @{u}..` if a tracking branch exists).

**Stay inside the scoped diff.** Only propose and edit hunks introduced by the scoped changes (plus minimal surrounding context). No drive-by cleanup of pre-existing comments, changelog entries, or code in a touched file — if you spot slop outside the diff, flag it in the punch list, don't edit it. Never touch generated/vendored files, lockfiles, or migrations unless `$ARGUMENTS` names them explicitly.

## What counts as slop

Strip these patterns:

- **Doc-comment essays.** Multi-paragraph JSDoc / Python docstrings / Go doc comments / Rustdoc explaining background, history, "why this approach over X," design rationale that belongs in a PR description, not the code. Keep structured sections (`Args`/`Returns`/`Raises`, `@param`/`@throws`/`@returns`, rustdoc `# Examples`) — strip only the rationale/history prose around them.
- **Inline narration that restates the code.** Comments that paraphrase what the next 3 lines do.
- **Sliced-development references.** Comments mentioning "slice 1," "slice 2," "first iteration," "the previous version" — these rot the moment the code lands.
- **Stale references to removed APIs.** Comments referencing names that have since been renamed/removed (grep for the names to verify before deleting).
- **Defensive narration about edge cases.** Block comments explaining race conditions or invariants where the code already makes the invariant obvious (e.g. an `if (finished) return;` guard doesn't need a 4-line comment).
- **Duplicated comments across sibling types/functions.** Same essay copy-pasted above two interfaces or two similar functions.
- **Empty-catch / ignored-error narration.** `try { ... } catch {}` is fine; `if err != nil { return nil }` is fine; the inline `// ignore — can't actually fail because X` prose adds nothing unless the "because X" is genuinely surprising. Trim the comment only — never add or remove the catch/error body itself.
- **`// nolint` / `# noqa` / `// eslint-disable` directives with rationale essays.** Keep the directive and any error/rule code (`# noqa: E501`, `# type: ignore[arg-type]`, `//nolint:gosec`); trim the multi-line justification down to a phrase or drop it if the disable is obvious.
- **Multiple same-session CHANGELOG entries.** Several entries added in this scoped work, same date, each with prose-y essays — collapse into one consolidated entry with tight bullets. Only merge entries you introduced in this diff; never drop dates, `Fixed`/`Added`/security wording, or pre-existing/published history.

## What to keep

- **Why-comments for non-obvious invariants** — a hidden constraint, a workaround for a specific upstream bug, a subtle ordering requirement.
- **Functional doc comments** on public API surface that document behavior callers rely on. (Go: keep the `// Funcname ...` first line; trim subsequent paragraphs of rationale.) Keep param/return/throws/example/contract lines.
- **CHANGELOG entries that document user-visible or operationally relevant changes** — just trim the prose.

## Workflow

1. Survey the changes. List the slop spotted as a numbered punch list — quote file:line, summarize the pattern, propose the fix. Do NOT start editing yet. If the scope is large (roughly >25 files or >40 candidate items), summarize by category and ask how to narrow before producing the full list.
2. **STOP and wait for explicit approval.** No `Edit`/`Write` until the user approves specific item numbers ("go ahead with 1-4"); sometimes they'll skip items. Never edit in the same turn as the punch list, and never auto-continue. If you are running non-interactively (headless, or dispatched by another agent with no user to approve), stop here and output the punch list only.
3. Execute the approved items. Use `Edit` with exact strings. Preserve indentation. Before editing an **untracked** file (no git history to recover from), copy it to the scratchpad first so the change is reversible.
4. Verify. Capture a baseline by running the project's verification command **before** your edits, then run it again after and compare — do not `git stash` after editing (that stashes the user's whole uncommitted tree and drops untracked files). Detect the command from the repo:
   - `package.json` scripts (`check`, `typecheck`, `lint`, `test`) — `bun`/`pnpm`/`npm` run as appropriate.
   - `pyproject.toml` / `Makefile` — `ruff check .`, `mypy`, `pytest`.
   - Go: `go build ./...`, `go vet ./...`, `golangci-lint run` if configured, `go test ./...`.
   - Rust: `cargo check`, `cargo clippy`, `cargo test`.
   - If a `Makefile` defines `lint`/`test`/`check` targets, prefer those.
   Report whether it passes; if a pre-existing failure surfaces, distinguish it from your changes by comparing against the pre-edit baseline.
5. Report the net line-delta and what was stripped. Do not run `git commit` — the user commits themselves.

## Hard rules

- Don't refactor logic. Slop cleanup is comment / dead-code / changelog only.
- **Comments, dead code, and changelog only — never delete anything that changes runtime, API, wire, or schema behavior.** Don't remove struct/request/response fields, exported/public params, or `if`/`switch` branches on a reachability judgment — a field that's grep-clean in this repo may still be consumed by an external client, a serialized payload, a DB column, or interface satisfaction. If you believe a field or branch is genuinely dead, flag it in the punch list marked `[deletes code — verify external consumers]` and let the user confirm; never batch it in with comment strips. If any removal would alter observable behavior, abort that item and flag it.
- Don't introduce new abstractions to "tidy" what you're stripping.
- Don't delete functional content from doc comments — keep the line that documents behavior, drop the paragraphs of rationale.
- Never touch: license/SPDX/copyright headers, `// Code generated`/`@generated` markers, build tags/constraints, or security suppressions carrying a CVE/rule id.
- For a PR or unpushed-commit range, clean the current files to match the intent of that range — do not amend, rebase, or rewrite history.
- If you're unsure whether a comment is slop or a load-bearing invariant, leave it and flag in the punch list ("uncertain — keep?").

$ARGUMENTS
