# Coordinate a pcbjs task

Use this when several independent investigations, implementations or reviews justify workers. For a small change, use the same focused reading and reporting discipline in one agent. Delegation depends on the harness and its instructions; pcbjs MCP provides board/session tools, not an agent-spawning service.

## Coordinator context

Retain the user's objective and constraints, the current architecture and shared interfaces, task ownership and dependencies, accepted decisions, verification status and unresolved risks. Keep a compact working note for a long task. Link evidence and detailed worker notes instead of copying them into the coordinator's context. Keep transcripts, full manuals, generated board data and raw test output with the worker that needs them.

Start from the task and a narrow state check. Do not read every topic before deciding how to divide the work. The coordinator reads the skill entry point; each worker reads only its relevant reference and source. If history matters, assign a bounded transcript or document review and ask for current decisions, superseded assumptions and unresolved items with source pointers.

## Dispatch by ownership

Useful divisions include a pinout/schematic investigation, a placement/routing change, a mechanical/model check, and an independent electrical or visual review. Split only where the tasks can proceed independently. Shared pinouts, coordinate frames, net classes and configuration need an agreed interface and one owner before dependent edits begin.

Give a worker:

- A concrete outcome and acceptance criteria.
- Owned files or a read-only review scope, plus files other workers own.
- The project, entry, board, target and relevant source revision or snapshot.
- Current constraints and shared decisions, relevant source/reference paths, and required checks.
- A request for a compact handoff, with detailed evidence saved at a project-appropriate path if needed.

Use a fresh worker context with this brief when the harness supports it. Do not inherit the full parent history by default. A worker should request missing context or expand its reading only when needed, and report proposed scope changes before editing another owner's files. Parallel reads are useful; serialize conflicting writes and shared integration checks. Separate worktrees are optional isolation, not a prerequisite for workers.

## Live session ownership

The coordinator owns task/progress metadata and the persistent MCP inbox when tools share one connection. Workers must not overwrite that connection's task description with their own. A worker with a separate harness-owned connection may identify its own task; verify the actual project and connection. Share pending user corrections with affected workers. A one-shot MCP process or CLI command is not a listening agent.

Read from the session when unsaved editor text matters. Record the snapshot or source revision used for a review; refresh focused queries after integration rather than treating an old worker result as current.

## Handoff and integration

Return the outcome, decisions and rationale, changed files or patch location, checks actually run with results, and unresolved risks or dependencies. Distinguish verified facts from proposals. Include precise evidence paths; omit raw logs unless a failure needs examination.

The coordinator checks interface compatibility and the focused diff, resolves ownership conflicts, and runs acceptance checks on the integrated state. Do not reread every file a worker inspected or rerun every worker check without a concrete reason. Expand into source or logs when evidence is missing, results disagree, or integration changed an assumption. Report the user-visible outcome and outstanding limits; delegation does not itself prove correctness.
