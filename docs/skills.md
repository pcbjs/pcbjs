# Agent skills

`@pcbjs/skills` packages what an agent needs to work on a pcbjs board as Agent Skills, and `pcbjs skills install` puts them in a project.
Advanced. Read it to give a coding agent pcbjs know-how, or to change the skills themselves.

## Install

```sh
npx pcbjs skills install                        # link each skill from .agents/skills and .claude/skills
npx pcbjs skills install --no-claude            # .agents/skills only
npx pcbjs skills install --no-hooks             # the Claude Code plugin without its hooks
npx pcbjs skills install --mcp codex,cursor     # register pcbjs mcp for these too
npx pcbjs skills install --to <dir>             # into that skills folder alone
npx pcbjs skills list                           # each skill and when it applies
npx pcbjs skills path                           # where the package keeps them
```

`@pcbjs/pcbjs` depends on `@pcbjs/skills` at its own train's version, so a project that installs pcbjs has the matching skills. `pcbjs skills` loads the `@pcbjs/skills` the project resolves.

The one copy of each skill is the installed package's, `node_modules/@pcbjs/skills/<name>`. `install` makes `.agents/skills/<name>` and `.claude/skills/<name>` relative symlinks to it, such as `../../node_modules/@pcbjs/skills/pcbjs-basics`, so an upgrade of pcbjs upgrades the skills with no second step. `.agents/skills` is the folder of the Agent Skills standard; `.claude/skills` is the companion for Claude Code, which reads only that folder.

`install` links only when the package lies in the `node_modules` of a project above the target folder, as for `pcbjs skills install` in a project that installs pcbjs. Otherwise, as with `--to ~/.agents/skills`, it copies, since a link into a cache would dangle, and the output line says `copy`; in `.claude/skills` it then links to that copy. Where the system refuses a symlink, such as Windows without developer mode, it copies too. Each output line names the skill, then `link` or `copy` with the destination and with the companion.

Running it again replaces a folder, a copy or a stale link of the same name in both folders and leaves other folders alone. Commit the links with the project. They resolve after `npm install`, since `node_modules` is not committed; for a team, add `"prepare": "pcbjs skills install"` to the project's scripts so a fresh clone restores them.

| Agent | Reads | Install with |
| --- | --- | --- |
| Claude Code | `.claude/skills`, `~/.claude/skills` | `pcbjs skills install`, the companion links |
| Codex | `.agents/skills` up to the repository root, `~/.agents/skills` | `pcbjs skills install` |
| Grok Build | `.agents/skills` or `.claude/skills`, `~/.agents/skills` | `pcbjs skills install` |
| any, user-wide | `~/.agents/skills` or `~/.claude/skills` | `--to ~/.agents/skills`, `--to ~/.claude/skills` |

## The MCP server, the language server and the hooks

`install` in a project also registers `pcbjs mcp` of mcp.md for each harness, and for Claude Code writes a project plugin with the language server of lsp.md and two hooks. Each file keeps every other key it has; running it again rewrites only the pcbjs entries. `--to` installs skills alone.

Registration writes configuration; it does not prove that the active chat loaded it. After loading the integration through the harness, call its pcbjs `session` tool with a task and verify the returned agent connection and project. Keep that MCP process open. A script that performs a handshake and exits is a connectivity test only. Codex registration allows 60 seconds for startup, including the local session handshake; it does not change project trust or force the harness to reload.

| File | Written | Holds |
| --- | --- | --- |
| `.mcp.json` | unless `--no-claude`, or when it exists | `mcpServers.pcbjs`, `npx --no-install pcbjs mcp` |
| `.vscode/mcp.json` | when `.vscode/` exists or `--mcp vscode` | `servers.pcbjs` with `type: stdio` |
| `.cursor/mcp.json` | when `.cursor/` exists or `--mcp cursor` | `mcpServers.pcbjs` |
| `.codex/config.toml` | when `.codex/` exists or `--mcp codex` | the table `[mcp_servers.pcbjs]` |
| `.claude/plugins/pcbjs/` | unless `--no-claude` | the plugin: `.claude-plugin/plugin.json`, `.lsp.json` running `pcbjs lsp --stdio --agent`, `hooks/hooks.json` |
| `.claude-plugin/marketplace.json` | with the plugin | a project marketplace, `pcbjs-project` unless it has a name, listing the plugin |
| `.claude/settings.json` | with the plugin | the marketplace in `extraKnownMarketplaces` and `pcbjs@pcbjs-project` in `enabledPlugins` |

The hooks, which `--no-hooks` leaves out:

- On prompt submit, `pcbjs hook prompt` prints what happened since the agent's last turn, edits with who made them and each board's findings, then the messages a human sent the agent, which it acknowledges. Its cursor is `.pcbjs/agents/<session id>.json`. It also tells the session that this harness claims its writes.
- After Edit, Write and MultiEdit, `pcbjs hook edited` sends `session/edited` for the file, so the session's edit event names the agent connection of that harness in that folder, with its task, rather than `disk`, queries.md.
- Both read the hook's JSON on stdin, `--name <harness>` naming the harness, `claude-code` by default, and say nothing and exit 0 without a live session or on any error, so they never hold up a turn. Cursor's hooks can run the same commands with `--name cursor`.

The installer does not install these hooks for Codex. Without a host hook, call MCP `events` before edits and after long shell-only work to receive pending messages in tool output. CLI `check`, `shot` and `events` remain useful board operations, but their connections have role `cli` and are not targets of Send to agent. If MCP is unavailable, report that messaging is unavailable rather than claiming the setup is fully connected.

## The skills

| Skill | Use it when |
| --- | --- |
| `pcbjs-basics` | creating or editing a board, connecting parts, placement, routing and findings |
| `pcbjs-best-practices` | reviewing electrical intent, constraints, routing, mechanics, models or fabrication |
| `pcbjs-port-from-kicad` | importing a KiCad board and verifying electrical and fabrication equivalence |
| `pcbjs-port-from-python-scripted` | migrating a Python-generated board while preserving its design contracts |
| `pcbjs-upgrade` | updating pcbjs packages and comparing each board with its baseline |

## Progressive reading and orchestration

Discover skills by their descriptions, load the relevant `SKILL.md`, then read only the reference needed for the current decision. The basics entry routes setup, session use, verification and individual board patterns to separate files. The best-practices entry routes each review topic separately. Use MCP `docs` without arguments for the topic index, then one `topic`; combine `topic` and `grep` to narrow a search. Installing all five skills makes them available, not a request to load them all.

For work across independent areas, the skills favor a coordinator and focused workers when the harness supports and permits delegation. The coordinator keeps the objective, architecture, shared interfaces, ownership, decisions, verification status and unresolved risks. Each worker gets a bounded outcome, source/reference paths, owned files or read-only scope, constraints and acceptance checks. Workers load detailed source and topic references themselves and return compact handoffs with evidence paths. Avoid copying entire histories, manuals and raw logs into the coordinator's context.

Keep one writer per file and agree shared pinouts, nets, coordinate frames and configuration before dependent changes. The coordinator owns task/progress and the inbox when workers share an MCP connection, relays user corrections, and verifies the integrated result. Independent connections can identify their own tasks. pcbjs MCP does not spawn workers; delegation belongs to the agent harness. Small local changes can remain in one agent.

## Format

Each skill is a folder at the package root, `node_modules/@pcbjs/skills/<name>` in a project, with a `SKILL.md` and a `references/` folder. `SKILL.md` starts with YAML frontmatter, `name`, the folder's name, and `description`, what the skill does and when to use it, which an agent reads to decide whether to load the skill. Its body stays short, the workflow and the rules, and names a reference file for each longer topic, so an agent loads a reference only when the task needs it. Skills point to `pcbjs docs <topic>` for detail rather than copying the docs, and name the MCP tool for each step with the CLI command as the fallback when the tools are absent.

## Writing a skill

- Keep `SKILL.md` short: purpose, essential constraints and a task-to-reference map. The 500-line limit is a ceiling, not a target. Move examples and specialist detail into focused references with explicit load conditions.
- Keep references independently useful. Link shared detail instead of duplicating it; do not require a worker to read the full skill collection or conversation before its task.
- For multi-part workflows, define ownership, a compact worker brief and evidence-based handoff. Preserve harness permission rules and offer a single-agent path.
- Every TypeScript, TSX and JavaScript block in a skill is a module that must type-check against the current packages, and every Python block must parse: `packages/pcbjs/tests/skill-samples.test.mjs` checks them. A block opened as ` ```ts file=lib/pinout.ts ` is written at that path, so another block of the same file can import it. Write code that cannot compile, such as an old API, in a `diff` or `text` block.
- Keep skills generic: no project names, and no paths to notes outside the package.
- Prefer useful output over defensive repetition. State material limitations concisely and keep durable decisions in existing notes. Do not instruct agents to copy caveats into silkscreen, drawing layers, source comments or `fabNotes`; board markings serve physical use and `fabNotes` serves actionable order instructions. Branding and draft stamps are not defaults.
- A skill that edits files says to change an existing file by edits and never by a whole-file Write, which loses an editor's unsaved text.
- `packages/skills/tests` checks the frontmatter, the length, that every named reference exists, and `install`.

For another board, the basics skill defaults to another config entry in the existing project/session. Its verification reference covers compact resumed-task handoffs. Best practices adds reviewed pin dispositions, independent endpoint/polarity and frame assertions, and comparison of saved draft reports without suppressing findings. These recipes reuse existing project files and tests; they require no new paperwork or board warnings.
