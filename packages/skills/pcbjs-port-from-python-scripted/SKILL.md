---
name: pcbjs-port-from-python-scripted
description: Move a board whose KiCad files are written by Python scripts, a layout.py, routes.py, placement.py or netlist.py driven by a Makefile, to pcbjs. Use when a repository generates .kicad_pcb or .kicad_sch from Python with pcbnew, kiutils or s-expression writers and the task is to port it, to run both flows side by side, or to turn the generator's asserts and check scripts into pcbjs rules and contracts.
---

# Port a Python-generated board to pcbjs

A Python generator already treats the board as code: constants for placement, tables for routes, loops for repeated parts, asserts for the mechanical rules. pcbjs keeps all of that as TypeScript, so the port is mostly a translation of intent, checked against the board the generator writes.

## Steps

1. **Read the generator first.** Find the netlist, the placement constants, the route tables, the silk and legend code, the rule profiles, the asserts and the check scripts the Makefile runs. List every assert and every check; each must land somewhere.
2. **Branch, and keep the Python flow.** Work on a branch or worktree. Do not touch the generators, their outputs or their make targets: they stay the source of truth until the pcbjs checks pass. Put the pcbjs project in its own folder, such as `pcbjs/`, with its own `package.json`, or at the root when nothing else is there.
3. **Import the generated board.** `npx pcbjs import board board/Name.kicad_pcb -o pcbjs/pcb.tsx` gives a project that matches pad for pad. Commit it raw. It is the baseline every later step is compared with.
4. **Add the checks and make targets now**, before refining, so every refinement runs them: `pcbjs check --fab`, the netlist and copper comparison against the generated `.kicad_pcb`, the Gerber comparison, and the contracts. references/makefile.md has the targets.
5. **Rewrite from intent.** Replace the import's transcript, absolute coordinates and straight segments, with what the generator meant: constants, loops, pad-relative chains, computed legends. references/mapping.md maps each Python construct to its pcbjs form. Run the checks after every step; the comparison must stay at 0 differences.
6. **Turn asserts into rules and contracts.** Each generator assert becomes a DRC rule where one exists, else a contract over `pcbjs inspect --json` that imports the same numbers. references/contracts.md.
7. **Write it up**: which checks of the Python flow have a pcbjs counterpart and which do not, the three correctness checks with numbers, what is left before the pcbjs flow could replace the Python one.

## What stays the same

- Coordinates: both use KiCad's frame, mm with y down, so a constant moves over unchanged. A back part at KiCad angle `a` is `side="B"` at `a + 180`.
- Footprints: read the project's own `.pretty` libraries with `kicadFootprint('Lib:Name')` rather than copying them, so both flows load the same files; `kicad.footprints` in `pcb.config.ts` names the folders.
- Models: the same files through the footprint's model line.
- Refs and net names; nets whose names start with `+` or `/` are renamed by the importer, so compare nets as a mapping.

## Variants and environment

A generator often reads environment variables, `VARIANT=caps` or `FAB=jlc`. A fab choice becomes `variants(...)` with one target per fab, routed once under the stricter rules. A part fit can stay an environment variable read in the board module, `process.env.VARIANT === 'caps'`, setting `dnp` on the parts; pass it to `pcbjs check` the same way the generator gets it.

## Keep both until

- `pcbjs check --fab` passes cold and warm with every finding explained.
- The comparison shows 0 net differences and lists every intended copper change.
- Every generator assert and check script is either a DRC rule, a contract or listed as not covered with the reason.
- The fab set covers what the Python order package wrote, or the gap is written down: assembly drawings, panels and per-assembler BOM formats usually are.

Then the owner decides whether the pcbjs flow replaces the Python one. Until then both build from one commit.
