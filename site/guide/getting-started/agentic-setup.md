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

## Give a bounded first task

Try this prompt:

> Read the pcbjs-basics skill and inspect Blinky. Explain how J1, Q1 and the three LED channels connect. Then move the front silk title slightly upward in pcb.tsx. Keep the electrical connections unchanged. Run pcbjs check, inspect the result in a board view or screenshot, and report what changed and any findings.

This first edit is visible and easy to compare. Keep a known version of the project before requesting larger changes. Ask the agent to edit the existing files in small steps, inspect the result and show the check output.

## Share the same evidence

Use `npm run dev` to review the board while the agent works. Ask it to use `pcbjs inspect` for positions and nets, `pcbjs check` for findings, and `pcbjs shot` when a screenshot helps. A successful check is one part of the review; compare the intended circuit, part choices and physical layout too.

The following lessons explain the files the agent edits. Continue with [Define the schematic](./schematic), or use [Set up with npm](./npm-setup) for the manual workflow.
