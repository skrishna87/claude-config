# claude-config

My Claude Code workflow for long-running feature work, made clone-able across machines.

## Status: mid-pivot (2026-06-21)

The previous approach — a **DAG-driven, background-orchestrator dev loop (v2)** that fanned out
file-disjoint task slices and gated each in isolation — has been **archived** under
[`archive/dev-loop-v2/`](archive/dev-loop-v2/). It worked for independent mechanical fan-out but was
blind to the **seams between slices** (cross-task/cross-repo contracts, composition with existing
flows, twin-path asymmetry) — which is exactly where interconnected features break. See
[`archive/dev-loop-v2/ARCHIVE_NOTE.md`](archive/dev-loop-v2/ARCHIVE_NOTE.md) for the full why and the
fix-list to apply if it's ever revived.

The active direction is a **return to the resume-notes loop (v1's model)**: one agent holding the
whole feature in context, a running notes/progress doc so work survives `/clear`, human
course-correction, and a single cross-cutting review over the whole feature diff — instead of N
context-isolated workers and N keyhole gates. **It is being rebuilt; nothing is wired in yet.**

## What's here

| Path | Role |
|---|---|
| `bootstrap.sh` | symlinks the **active** loop into `~/.claude` (currently links nothing — loop under construction) |
| `archive/dev-loop-v2/` | the shelved v2 DAG-orchestrator loop, in full, with its own `bootstrap.sh` to reactivate and `ARCHIVE_NOTE.md` explaining why it was shelved |
| `installed_plugins.snapshot.json` | snapshot of installed Claude plugins; re-install via `/plugin` |

## Setup on a new machine

```bash
git clone <this-repo> ~/projects/claude-config
~/projects/claude-config/bootstrap.sh
```

`bootstrap.sh` makes per-file symlinks into `~/.claude`, leaving your other commands/skills/plugins
untouched. (To run the archived v2 loop instead, use `archive/dev-loop-v2/bootstrap.sh`.)
