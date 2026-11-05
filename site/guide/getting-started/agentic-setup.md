---
title: Set up an agent
description: Give a coding agent the pcbjs skills and a checked Blinky project to work on.
---

# Set up an agent

A coding agent works on the same TypeScript files and checks as you do. Start from a checked example, then give it one concrete change and a way to verify the result.

## Create the project

First follow [npm setup](./npm-setup), choosing the source checkout to match this guide's current APIs. From your Blinky project folder, run:

```sh
npx pcbjs check
npx pcbjs skills install
npm run dev
```

`skills install` adds the matching pcbjs skills to the project's `.agents/skills` and `.claude/skills`. In a project it also configures the supported agent integrations, including the pcbjs MCP server. Open the project folder in your agent so it can discover these instructions.

For a Codex or Cursor MCP registration, choose the harness explicitly:

```sh
npx pcbjs skills install --mcp codex,cursor
```

See [Agent skills](/docs/skills) for the files this writes and options for installing only the integrations you use. Follow your harness's normal workflow to load the project configuration.

## Verify the live connection

Ask the agent to call the pcbjs `session` tool from its own tool list with a task and plan. Confirm that the result lists its agent connection in this project. Keep the harness-owned MCP process running while it works. A config file or a script that performs one handshake and exits does not establish ongoing messaging.

Before edits and after long shell commands, the agent should call MCP `events` and act on pending messages. Codex does not receive the Claude Code hooks installed by pcbjs. If the tools are unavailable, the CLI still supports board work, but the agent must say that Send to agent is unavailable.

## Give a bounded first task

Try this prompt:

> Read the pcbjs-basics skill, verify your persistent MCP connection with the session tool, and inspect Blinky. Explain how J1, Q1 and the three LED channels connect. Then move the front silk title slightly upward in pcb.tsx. Keep the electrical connections unchanged. Check pending events before editing, run the checks, inspect the result in a board view or screenshot, and report what changed and any findings.

This first edit is visible and easy to compare. Keep a known version of the project before requesting larger changes. Ask the agent to edit the existing files in small steps, inspect the result and show the check output.

## Coordinate larger tasks

For a larger change, ask for focused workers if your harness supports them:

> Coordinate the work with a concise plan and clear file ownership. Give each worker a bounded task, relevant source and reference paths, constraints and checks. Let workers load only their topic's details. Keep your context to shared interfaces, decisions, progress and risks; collect compact handoffs with evidence paths, then verify the integrated board.

A small edit can stay with one agent. The installed skills provide topic indexes rather than requiring every tutorial to be read. The coordinator keeps the persistent MCP inbox and relays corrections when workers share its connection; pcbjs does not create workers itself.

## Share the same evidence

Use `npm run dev` to review the board while the agent works. Ask it to use `pcbjs inspect` for positions and nets, `pcbjs check` for findings, and `pcbjs shot` when a screenshot helps. A successful check is one part of the review; compare the intended circuit, part choices and physical layout too.

The following lessons explain the files the agent edits. Continue with [Define the schematic](./schematic), or use [Set up with npm](./npm-setup) for the manual workflow.
