# Agent skills

`@pcbjs/skills` packages what an agent needs to work on a pcbjs board as Agent Skills, and `pcbjs skills install` puts them in a project.
Read it to give a coding agent pcbjs know-how, or to change the skills themselves.

## Install

```sh
npx pcbjs skills install                        # link each skill from .agents/skills and .claude/skills
npx pcbjs skills install --no-claude            # .agents/skills only
npx pcbjs skills install --to <dir>             # into that skills folder alone
npx pcbjs skills list                           # each skill and when it applies
npx pcbjs skills path                           # where the package keeps them
```

`@pcbjs/pcbjs` depends on `@pcbjs/skills` at its own train's version, so a project that installs pcbjs has the matching skills. `pcbjs skills` loads the `@pcbjs/skills` the project resolves, and the package's own bin, `npx pcbjs-skills`, takes the same commands, for a folder without pcbjs.

The one copy of each skill is the installed package's, `node_modules/@pcbjs/skills/<name>`. `install` makes `.agents/skills/<name>` and `.claude/skills/<name>` relative symlinks to it, such as `../../node_modules/@pcbjs/skills/pcbjs-basics`, so an upgrade of pcbjs upgrades the skills with no second step. `.agents/skills` is the folder of the Agent Skills standard; `.claude/skills` is the companion for Claude Code, which reads only that folder.

`install` links only when the package lies in the `node_modules` of a project above the target folder, as for `pcbjs skills install` and for `npx pcbjs-skills install` in a project that installs pcbjs. Otherwise, as with `npx @pcbjs/skills install --to ~/.agents/skills` from npm's cache, it copies, since a link into a cache would dangle, and the output line says `copy`; in `.claude/skills` it then links to that copy. Where the system refuses a symlink, such as Windows without developer mode, it copies too. Each output line names the skill, then `link` or `copy` with the destination and with the companion.

Running it again replaces a folder, a copy or a stale link of the same name in both folders and leaves other folders alone. Commit the links with the project. They resolve after `npm install`, since `node_modules` is not committed; for a team, add `"prepare": "pcbjs skills install"` to the project's scripts so a fresh clone restores them.

| Agent | Reads | Install with |
| --- | --- | --- |
| Claude Code | `.claude/skills`, `~/.claude/skills` | `pcbjs skills install`, the companion links |
| Codex | `.agents/skills` up to the repository root, `~/.agents/skills` | `pcbjs skills install` |
| Grok Build | `.agents/skills` or `.claude/skills`, `~/.agents/skills` | `pcbjs skills install` |
| any, user-wide | `~/.agents/skills` or `~/.claude/skills` | `--to ~/.agents/skills`, `--to ~/.claude/skills` |

## The skills

| Skill | Use it when |
| --- | --- |
| `pcbjs-basics` | starting a board with `pcbjs create`, writing `pcb.tsx` and `pcb.config.ts`, parts and nets, `route()` chains, groups, pours and stitching, the brand on silk, the check, inspect and shot loop, reading findings |
| `pcbjs-best-practices` | hardening a board past a clean check: rules as DRC rather than scripts, house rules over every fab, contracts over `inspect --json`, cold and warm checks, hand routes or the router, stacks with `reference()`, heat copper, vendor models with licence notes, where the brand goes, reproducible fab sets |
| `pcbjs-port-from-kicad` | `pcbjs import board` and `footprint`, how `.kicad_pcb`, `.kicad_dru` and `.kicad_sch` map, the three correctness checks of a port, netlist comparison by pad position, Gerber comparison, what the importer cannot see, and Altium, Eagle and EasyEDA by way of KiCad's importers |
| `pcbjs-port-from-python-scripted` | a board whose KiCad files a Python generator writes: what maps to what, keeping the Python flow beside the port until the checks pass, the make targets, generator asserts as contracts |
| `pcbjs-upgrade` | moving a project to a newer pcbjs: the notes from before 0.1, then each minor's Migration section from the changelog |

## Format

Each skill is a folder at the package root, `@pcbjs/skills/<name>`, with a `SKILL.md` and a `references/` folder. `SKILL.md` starts with YAML frontmatter, `name`, the folder's name, and `description`, what the skill does and when to use it, which an agent reads to decide whether to load the skill. Its body stays short, the steps and the rules, and names a reference file for each longer topic, so an agent loads a reference only when the task needs it. Skills point to `pcbjs docs <topic>` for detail rather than copying the docs.

## Writing a skill

- Keep `SKILL.md` under 500 lines; move long material into `references/`.
- Every TypeScript, TSX and JavaScript block in a skill is a module that must type-check against the current packages, and every Python block must parse: `packages/pcbjs/tests/skill-samples.test.mjs` checks them. A block opened as ` ```ts file=lib/pinout.ts ` is written at that path, so another block of the same file can import it. Write code that cannot compile, such as an old API, in a `diff` or `text` block.
- Keep skills generic: no project names, and no paths to notes outside the package.
- `packages/skills/tests` checks the frontmatter, the length, that every named reference exists, and the bin.

## Migration notes

`pcbjs-upgrade` keeps the notes from before the changelog in `references/pre-0.1.md`. Every later breaking change carries a `#### Migration` heading in its changeset, with what to change and a before and after. When the package is packed, its `prepack` runs `scripts/sync-changelog.mjs`, which reads `CHANGELOG.md` at the repository root and in every package, takes each Migration section under its version, merges sections that several packages share, and writes them per minor, newest first, into `references/changelog.md`. Run it by hand with `node packages/skills/scripts/sync-changelog.mjs`; `--out <file>` and changelog paths as arguments override the defaults.
