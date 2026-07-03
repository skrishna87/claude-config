---
name: flow-report
description: Export a self-contained HTML report that renders any project subject — a feature plan, a module, a code flow, a state machine, a diff/branch, a schema, or the workflow itself — as high-level, intuitive flow / state-machine / sequence diagrams, for planning, refining, or reviewing. Triggers - "diagram this", "visualize the plan/flow/module/architecture", "export an HTML report", "show me the state machine", "map this feature". Pairs with /plan-feature (visualize the seam map at a pause) and /dev-loop (visualize the feature before the integration review).
---

# flow-report — HTML diagram report export

Produce ONE self-contained HTML file that explains a subject at a glance through a few
high-level diagrams. The report is a thinking tool for three purposes: **plan** (what will
be built), **refine** (what is vs. what should be — surface the open questions), **review**
(what changed and where the risk sits).

The template shell lives next to this file: `template.html` (same directory as this
SKILL.md). Copy it and fill the placeholders — do not rebuild the shell from scratch.
The shell is styled to a simple **Sky Blue** design system: Fraunces for headings/stat
numerals, Inter for UI, Sky Blue `#0284c7` as the brand accent, semantic light/dark
tokens. Swap the accent and fonts in `template.html` to retheme.

## 1. Resolve subject + purpose

From the arguments (ask only if genuinely ambiguous):

- **Subject** — a feature name (prefer `docs/<feature>/{plan,progress}.md` as primary
  sources), a module/directory, a specific flow ("what happens when a job is retried"),
  a branch/diff (`<base>...HEAD`), a schema, or a config/workflow.
- **Purpose** — `plan` | `refine` | `review`. Default: if a plan.md with unchecked tasks
  exists → plan; if a diff/branch was named → review; else refine.

## 2. Ground it (no invented boxes)

Same discipline as `/plan-feature` Stage 2: **every node, state, and edge label must map to
something real** — a grep-verified symbol, file, endpoint, plan task, or an explicitly-marked
"create". Read the actual code/plan first; a diagram of guessed architecture is worse than
none, because it looks authoritative. Things that don't exist yet are drawn, but marked
(`create` class, below). If while grounding you find a surprise (a twin path, a contract that
means something else), it goes in the report's **Open questions** — that's the payload.

## 3. Choose the lenses (1–4 diagrams, high-level)

Pick by what the subject *is* — don't render every lens:

| Subject shape | Mermaid lens |
|---|---|
| pipeline / module map / seam map / data flow | `flowchart LR` (or `TD` for layered stacks) |
| lifecycle, status enum, anything with transitions | `stateDiagram-v2` |
| actors/services exchanging calls or messages | `sequenceDiagram` |
| schema / stored shapes | `erDiagram` |

Rules that keep it intuitive:
- **≤ ~15 nodes per diagram.** Collapse detail into one node and let the caption carry it;
  a diagram that needs panning has failed. Split into two diagrams before crowding one.
- Node labels use the repo's own vocabulary (the real symbol/file/task names), short.
- Prefer one diagram per question the reader has, each with a 1–2 sentence caption saying
  **what to look at** ("the two paths must stay symmetric", "everything green is new").

**Standard classes** — use these `classDef`s verbatim so colors always match the legend
chips in the template (intent tokens: success / primary / warning / destructive;
translucent fills work on both light and dark):

```
classDef create fill:#2f8f4622,stroke:#2f8f46,stroke-width:2px,stroke-dasharray:5 3
classDef changed fill:#0284c722,stroke:#0284c7,stroke-width:2px
classDef risk fill:#e2891f22,stroke:#e2891f,stroke-width:2px
classDef blocked fill:#cf556b22,stroke:#cf556b,stroke-width:2px
```

`create` = to be built (plan) · `changed` = touched by this work (review) · `risk` = open
question / hotspot (refine) · `blocked` = blocking finding. Unclassed = existing, unchanged.
In `stateDiagram-v2` use the same colors via `classDef` + `class` statements.

## 4. Fill the template

Copy `template.html` → output path, then replace the `{{…}}` placeholders:

- `{{TITLE}}`, `{{SUBTITLE}}` — subject · purpose · date · source refs (plan path, branch).
- `{{TILES}}` — 2–4 stat tiles, only counts that inform the purpose (e.g. plan: `tasks
  8`, `new seams 1`, `twins 3`; review: `files touched 12`, `blocking findings 0`). Each:
  `<div class="tile"><div class="label">…</div><div class="value">…</div></div>`.
- `{{SECTIONS}}` — one `<section>` per diagram (the template has a commented example):
  caption paragraph, `<pre class="mermaid">…</pre>`, and a `<details>` holding the raw
  mermaid source (the offline fallback — always include it).
- `{{LEGEND}}` — chips for **only the classes actually used** (template has all four
  commented; delete unused ones).
- `{{QUESTIONS}}` — the Open-questions `<li>`s (refine/plan) or key findings (review).
  If none, delete the whole questions block.

Diagram syntax care (the #1 failure mode): plain alphanumeric node ids; labels with
special characters (`/ ( ) : ,`) go in `["quoted brackets"]`; no trailing spaces after
`classDef`. The template renders a visible error banner per failed diagram — a report
with an error banner is not done. Layout: a long `flowchart LR` chain scales down to
tiny text — for pipelines with phases, prefer `flowchart TD` with `direction LR`
subgraphs, connecting the **subgraphs** (not their inner nodes) to outside nodes
(an edge from an inner node to outside makes mermaid ignore the subgraph's direction).

## 5. Verify, write, hand off

- Output path: features → `docs/<feature>/flow-report.html`; anything else →
  `docs/reports/<slug>.html` (create the dir). Uncommitted artifact — never commit it
  unless asked.
- **Render it and look at it** before calling it done: open the file with the browser
  tooling available (playwright MCP / agent-browser) and screenshot — check every diagram
  rendered (no error banners), labels aren't colliding, and the legend matches the classes
  used. No browser tooling → say so and ask the user to eyeball it.
- Hand off with the file path, one line per diagram on what it shows, and the open
  questions repeated as text (the report supports the conversation; it doesn't replace it).

Note: diagram rendering needs network once (Mermaid CDN); offline the report degrades to
a banner + the raw sources in each `<details>`.
