---
name: pcbjs-best-practices
description: Review or harden a pcbjs board beyond a clean check. Use for design constraints, electrical or mechanical verification, routing quality, model validation, and reproducible fabrication output.
---

# pcbjs best practices

Start with the requested improvement and its acceptance criteria. Load only the matching reference below; a clean check alone does not prove electrical intent or mechanical fit. Do not preload every reference for an ordinary board edit.

## Coordinate the review

For a broad review, prefer focused workers when delegation is available and permitted: electrical rules, routing, mechanical/models and fabrication are separate evidence streams. Give each worker the relevant board/target, owned files or read-only scope, constraints and acceptance checks. Workers read the selected topic and detailed source themselves, then return findings, decisions, changed paths, verification results and unresolved risks with evidence links. The coordinator retains the cross-topic decisions and verifies integration, not each worker's raw investigation. Keep small changes in one agent.

## Shared constraints

- Preserve the owner's circuit, connector positions and routing decisions unless the task authorizes changing them. Express durable requirements as DRC rules or board tests where possible.
- Use the live MCP snapshot and unsaved source when available; verify the persistent agent connection and read pending `events`. Use focused `inspect`, `query` and `render` results instead of generated board files.
- Change existing files with anchored edits, with one writer per file. Coordinate shared pinouts, frames and rules before parallel implementation.
- Match verification to the change. After routing changes, compare a cold check with a warm one. An integrated release or fabrication review needs the relevant acceptance checks below.
- Record decisions and meaningful rejected alternatives briefly. Keep any workaround small and identify the feature that would replace it. Do not run formatters or linters by hand in repositories whose hooks own formatting.
- Communicate material caveats concisely; do not copy them onto the board. Review notes are not silkscreen or fabrication instructions. Use [Fab output](references/fab-output.md#markings-and-notes) when deciding where information belongs.

## Select a topic

| Question | Read |
| --- | --- |
| Are pin maps, custom endpoints or escape frames independently reviewed? | [Electrical intent](references/electrical-intent.md) |
| Can a specification become a compiler-enforced rule? | [Rules as DRC](references/rules-as-drc.md); `docs testing` for design contracts |
| How should owner and fab constraints combine? | [House rules](references/house-rules.md) |
| Which query measures the design requirement? | [Measuring](references/measuring.md) |
| Should a manual route be retained or changed? | [Routing choices](references/routing-choices.md) |
| Do stacked boards, connectors and bodies fit? | [Stacks](references/stacks.md) |
| How should via sizes, fill, heat copper and silk be reviewed? | [Copper](references/copper.md) |
| Which 3D model API or source should be used? | [Models](references/models.md) |
| Is the fabrication package reproducible and explained? | [Fab output](references/fab-output.md) |
| Does a port or refactor preserve the original? | [Comparisons](references/comparisons.md) |

For a final board review, account for every requested constraint, check cold and warm, inspect relevant views and models, and verify the fabrication output. For an isolated model or silk change, load and verify that topic without repeating an unrelated full audit.
