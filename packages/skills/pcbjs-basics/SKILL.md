---
name: pcbjs-basics
description: Design a PCB in pcbjs using TypeScript and JSX. Use when creating or editing a pcbjs board, connecting parts and nets, placing or routing entities, or resolving compile and DRC/ERC findings.
---

# pcbjs basics

A board is a TSX module exporting `<PCB>`. Nets and parts are values; JSX places them. Start with this entry point, then load only the reference or `docs` topic needed for the current decision. Do not preload the docs tree, all skills, or all references.

## Organize the work

For work spanning independent areas, prefer an orchestrator with focused workers when the harness supports and permits delegation. The orchestrator owns scope, interfaces, task ownership, integration and acceptance evidence. Workers own detailed source inspection, relevant topic reading, implementation and focused checks. A small local change can stay in one agent.

Give each worker a bounded outcome, owned files, relevant entry/board/target and constraints, plus the checks that establish completion. Pass paths and a short brief rather than the whole conversation or transcript. Workers load their own task-specific references and return decisions, changed files, verification results and unresolved risks with evidence paths. Keep raw logs and implementation exploration out of the orchestrator's context; inspect details only to resolve a conflict or verify a claim. Read [Orchestration](references/orchestration.md) when coordinating several tasks.

## Essential working loop

- Notify the user of plans, meaningful progress, questions and completion in the main chat session. MCP task/progress updates populate agent activity, not VS Code notifications; workers report to the coordinator for user-facing updates.
- Prefer pcbjs MCP tools when present: they see the live session and unsaved source. The connection owner calls `session` with the task and confirms the agent connection; keep that harness-owned process alive. On a shared connection, the coordinator owns task/progress and checks `events` before edits and after long shell-only work, relaying corrections to workers. Read [Live session](references/session.md) for setup, messaging or tool details; CLI commands do not establish an agent inbox.
- Read current source and apply anchored edits. Do not replace an existing file with a whole-file Write. Give each file one writer at a time; coordinate changes to shared pinouts, nets, grids and configuration before workers depend on them.
- Use `inspect` or `query` for positions and records, and `render` for a focused view. Avoid reading generated `board.json` or computing transformed pad positions by hand.
- Run `check` after the change and inspect the relevant view. The orchestrator verifies the integrated board before reporting completion. Fabrication output requires a completed check; a halted preview is not validation.
- Keep board markings useful for assembly, testing and operation. Do not add disclaimers, TODOs, readiness warnings or branding just to repeat the chat. Keep durable decisions in existing project notes; use `fabNotes` only for actionable fabrication instructions. See `docs fab-set` for where notes belong.

## Load on demand

Use MCP `docs` or `npx pcbjs docs` without a topic to discover titles, then request one topic. Search with `topic` plus `grep` when the question is narrower. Load another reference only when the current task reaches that subject.

| Current task | Load |
| --- | --- |
| Add a board to an existing project | [Multiple boards](references/multi-board.md), sharing its config and session by default |
| Create a project or learn the full source structure | [Getting started](references/getting-started.md) |
| Connect parts or define footprints | `docs schematic`, `docs footprints`, or `docs stdlib`, whichever applies |
| Place parts, groups or grids | `docs placement`, `docs layout`, or `docs grids` |
| Route manually or automatically | `docs routing`; add `autorouter`, `pairs` or `length` only for that feature |
| Use a complete layout pattern | [Pattern index](references/board-patterns.md), then one linked example |
| Resolve a finding | [Common fixes](references/fixes.md), or `docs findings` for the named rule |
| Verify a change or preserve design intent in tests | [Verification](references/verification.md) |
| Source or author 3D models | `docs models`; use the best-practices model reference for a model review |

If pcbjs leaves a needed measurement out of a finding, report the missing detail and the query used to obtain it.
