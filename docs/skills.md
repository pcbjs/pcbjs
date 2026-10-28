# Agent skills

`@pcbjs/skills` packages what an agent needs to work on a pcbjs board as Agent Skills, and `pcbjs skills install` puts them in a project.
Read it to give a coding agent pcbjs know-how, or to change the skills themselves.

## Install

```sh
npx pcbjs skills install              # into .claude/skills of this folder
npx pcbjs skills install --to <dir>   # into any skills folder an agent reads
npx pcbjs skills list                 # each skill and when it applies
npx pcbjs skills path                 # where the package keeps them
```

`@pcbjs/pcbjs` depends on `@pcbjs/skills` at its own train's version, so a project that installs pcbjs has the matching skills. `pcbjs skills` loads the `@pcbjs/skills` the project resolves, and the package's own bin, `npx pcbjs-skills`, takes the same commands, for a folder without pcbjs.

`install` copies each skill folder, replacing one of the same name, so running it again after an upgrade brings the skills to the installed version. Other folders in the target are left alone. Commit the installed skills with the project, or add the command to a `postinstall` script.

## The skills

| Skill | Use it when |
| --- | --- |
| `pcbjs-basics` | starting a board with `pcbjs create`, writing `pcb.tsx` and `pcb.config.ts`, parts and nets, `route()` chains, groups, pours and stitching, the brand on silk, the check, inspect and shot loop, reading findings |
| `pcbjs-best-practices` | hardening a board past a clean check: rules as DRC rather than scripts, house rules over every fab, contracts over `inspect --json`, cold and warm checks, hand routes or the router, stacks with `reference()`, heat copper, vendor models with licence notes, where the brand goes, reproducible fab sets |
| `pcbjs-port-from-kicad` | `pcbjs import board` and `footprint`, how `.kicad_pcb`, `.kicad_dru` and `.kicad_sch` map, the three correctness checks of a port, netlist comparison by pad position, Gerber comparison, what the importer cannot see, and Altium, Eagle and EasyEDA by way of KiCad's importers |
| `pcbjs-port-from-python-scripted` | a board whose KiCad files a Python generator writes: what maps to what, keeping the Python flow beside the port until the checks pass, the make targets, generator asserts as contracts |
| `pcbjs-upgrade` | moving a project to a newer pcbjs: the notes from before 0.1, then each minor's Migration section from the changelog |

## Format

Each skill is a folder with a `SKILL.md` and a `references/` folder. `SKILL.md` starts with YAML frontmatter, `name`, the folder's name, and `description`, what the skill does and when to use it, which an agent reads to decide whether to load the skill. Its body stays short, the steps and the rules, and names a reference file for each longer topic, so an agent loads a reference only when the task needs it. Skills point to `pcbjs docs <topic>` for detail rather than copying the docs.

## Writing a skill

- Keep `SKILL.md` under 500 lines; move long material into `references/`.
- Every TypeScript, TSX and JavaScript block in a skill is a module that must type-check against the current packages, and every Python block must parse: `packages/pcbjs/tests/skill-samples.test.mjs` checks them. A block opened as ` ```ts file=lib/pinout.ts ` is written at that path, so another block of the same file can import it. Write code that cannot compile, such as an old API, in a `diff` or `text` block.
- Keep skills generic: no project names, and no paths to notes outside the package.
- `packages/skills/tests` checks the frontmatter, the length, that every named reference exists, and the bin.

## Migration notes

`pcbjs-upgrade` keeps the notes from before the changelog in `references/pre-0.1.md`. Every later breaking change carries a `#### Migration` heading in its changeset, with what to change and a before and after. When the package is packed, its `prepack` runs `scripts/sync-changelog.mjs`, which reads `CHANGELOG.md` at the repository root and in every package, takes each Migration section under its version, merges sections that several packages share, and writes them per minor, newest first, into `references/changelog.md`. Run it by hand with `node packages/skills/scripts/sync-changelog.mjs`; `--out <file>` and changelog paths as arguments override the defaults.
