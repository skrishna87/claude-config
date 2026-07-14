---
description: Budget-tier variant of task-implementer for [S]/[M] tasks — same brief, same rules, same result block, cheaper model. The locked gate (never downgraded) backstops it. Swap the model pin to test-drive OSS models. Spawned by /dev-loop per the model policy.
mode: subagent
# The budget pin. Swap to test-drive OSS / other labs (e.g. opencode/deepseek-v4-pro,
# opencode/glm-5.2) — cycle-cause telemetry is the scorecard, see
# ~/.config/opencode/dev-loop/reference/model-policy.md.
# TEMP 2026-07-13 grok-4.5 implementer trial: deplete the X Premium included weekly xai
# quota first; on quota exhaustion / repeated leg failure repin to opencode/claude-sonnet-5
# (the standing default, kept on the next line for the flip-back).
model: xai/grok-4.5
# model: opencode/claude-sonnet-5
---

# task-implementer-lite — budget tier, same contract

Read `~/.config/opencode/agents/task-implementer.md` and follow it **in full** — same brief
fields, same leanness implement mode, same pre-gate self-check (acceptance-evidence map +
semantics audit), same verify-by-execution, same unstaged-only rule, and end with the exact
same `IMPLEMENT RESULT` block. The only difference is the model you run on: you get the
`[S]`/`[M]` tasks the plan judged mechanical or well-pinned. Don't improvise beyond the plan —
if the task turns out to need design judgment the plan didn't provide, say so in `notes`
rather than guessing.
