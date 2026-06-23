---
name: grounded-plan-feature
description: Produces grounded feature plans in this repo's docs feature plan.md format, including seam mapping, pinned symbols, locked decisions, vertical-slice tasks, and progress.md seeding. Use when the user asks Codex to plan a feature, propose changes, create an implementation plan, port /plan-feature, or prepare work for a later coding loop.
---

# Grounded Plan Feature

Use this skill to turn a rough feature/change request into `docs/<feature>/plan.md` and
`docs/<feature>/progress.md`. Planning is the deliverable; do not implement unless the user
separately asks for implementation.

## Required resources

Read these bundled files before writing the plan:

- `references/seam-design.md` for grounding vocabulary and checks.
- `assets/plan.md` for the exact required plan format.
- `assets/progress.md` when seeding the resume cursor.

Read `references/leanness.md` only if the plan includes implementation constraints or review
criteria about keeping the change small.

## Workflow

1. Resolve the feature slug.
   - Prefer a short hyphen-case slug from the user request.
   - Use `docs/<feature>/` as the output directory.

2. Align.
   - Clarify expensive-to-reverse product or architecture decisions before grounding.
   - Ask one question at a time only when the answer is not discoverable from the repo.
   - Recommend a default answer with the tradeoff.
   - If the user wants a plan without back-and-forth, state assumptions and continue.

3. Ground against the codebase.
   - Search/read code before making claims.
   - Pin every named function, type, endpoint, flag, config, command, or file to a real
     `path:line`; if it does not exist yet, mark it as `create`.
   - Produce the seam map: seams, pinned symbols, write-set plus blast radius, twins, reused
     contract semantics, and the real changed path to test.
   - Prefer existing seams; justify any new seam.

4. Write the spec.
   - Create `docs/<feature>/plan.md` from `assets/plan.md`.
   - Fill Context / goal, Locked decisions, Seam map, and Out of scope / deferred.
   - Keep repo vocabulary and real symbol names. Avoid speculative APIs.

5. Slice.
   - Add vertical-slice tracer-bullet tasks to `## Tasks`.
   - Each task must be demoable or verifiable on its own.
   - Each task line must use the exact checklist shape:
     `- [ ] n. <task> - *accept:* <criteria> - *blocked-by:* <none | task n>`
   - Order by dependency. Split tasks that cannot be completed and reviewed as one focused
     coding task.

6. Seed progress.
   - Create `docs/<feature>/progress.md` from `assets/progress.md`.
   - Fill date, task count, next task, and unknown worktree/branch fields as `<not created>`.

## Output contract

When done, report:

- Plan path and progress path.
- Number of tasks.
- Any assumptions made because the user skipped alignment.
- Any symbols/contracts that could not be pinned and were converted into create tasks.

Do not start coding from the plan in the same response unless the user explicitly asks.
