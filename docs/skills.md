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

## The skills

| Skill | Use it when |
| --- | --- |
| `pcbjs-basics` | starting a board with `pcbjs create`, writing `pcb.tsx` and `pcb.config.ts`, parts and nets, `route()` chains, groups, pours and stitching, the brand on silk, the check, inspect and shot loop, reading findings |
| `pcbjs-best-practices` | hardening a board past a clean check: rules as DRC rather than scripts, house rules over every fab, contracts over `inspect --json`, cold and warm checks, hand routes or the router, stacks with `reference()`, heat copper, vendor models with licence notes, where the brand goes, reproducible fab sets |
| `pcbjs-port-from-kicad` | `pcbjs import board` and `footprint`, how `.kicad_pcb`, `.kicad_dru` and `.kicad_sch` map, the three correctness checks of a port, netlist comparison by pad position, Gerber comparison, what the importer cannot see, and Altium, Eagle and EasyEDA by way of KiCad's importers |
| `pcbjs-port-from-python-scripted` | a board whose KiCad files a Python generator writes: what maps to what, keeping the Python flow beside the port until the checks pass, the make targets, generator asserts as contracts |
| `pcbjs-upgrade` | moving a project to a newer pcbjs: upgrade every package together, check cold then warm, compare with the baseline |

## Format

Each skill is a folder at the package root, `node_modules/@pcbjs/skills/<name>` in a project, with a `SKILL.md` and a `references/` folder. `SKILL.md` starts with YAML frontmatter, `name`, the folder's name, and `description`, what the skill does and when to use it, which an agent reads to decide whether to load the skill. Its body stays short, the workflow and the rules, and names a reference file for each longer topic, so an agent loads a reference only when the task needs it. Skills point to `pcbjs docs <topic>` for detail rather than copying the docs, and name the MCP tool for each step with the CLI command as the fallback when the tools are absent.

## Writing a skill

- Keep `SKILL.md` under 500 lines; move long material into `references/`.
- Every TypeScript, TSX and JavaScript block in a skill is a module that must type-check against the current packages, and every Python block must parse: `packages/pcbjs/tests/skill-samples.test.mjs` checks them. A block opened as ` ```ts file=lib/pinout.ts ` is written at that path, so another block of the same file can import it. Write code that cannot compile, such as an old API, in a `diff` or `text` block.
- Keep skills generic: no project names, and no paths to notes outside the package.
- A skill that edits files says to change an existing file by edits and never by a whole-file Write, which loses an editor's unsaved text.
- `packages/skills/tests` checks the frontmatter, the length, that every named reference exists, and `install`.
