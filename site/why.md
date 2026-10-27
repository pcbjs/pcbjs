---
title: Why pcbjs
description: What pcbjs is for, what it is not, and how it compares with generating a board for KiCad from a script.
---

# Why pcbjs

A board is mostly repetition, arithmetic and rules: a footprint is a grid of pads, a placement is a coordinate worked out from another one, a net is a name that must be spelled the same in two places, and a fab says what it can build. Code is good at all of that. pcbjs makes the code the design: a board is a TypeScript module whose default export is a JSX tree, and one compile turns it into checked copper, the files a fab needs and a viewer.

## What you get

- Typed schematics. Nets and parts are values. A misspelled net or pin is a type error in the editor, not a new net with one pad found at review.
- One compile. Placement, routing, pours, connectivity, DRC and ERC run every time, in seconds for the boards in the [examples](/examples). There is no separate step to forget.
- Findings that point at code. Each one names the rule, the position, the parts and the source line to change, in the terminal, the JSON report, the viewer and the editor.
- Ordinary software tooling. Diffs are readable, review happens in pull requests, a part is a function, a channel is a `.map`, and boards share footprints and pinouts as ordinary modules.
- The fab set. Gerber X2, Excellon, a job file, BOM, placement and a README-fab that says whether the board is orderable, for the preset of the fab you order from.

## Compared with scripted KiCad

A common way to get some of this today is a Python script that writes or edits a `.kicad_pcb`, through KiCad's `pcbnew` module or by emitting its s-expressions, followed by work in KiCad's GUI and `kicad-cli` for DRC and the fab files. `pcbjs import board` turns such a board into a pcbjs project, and its tests hold the result to KiCad's own fab set: on two test boards, one with every library pad shape on both sides and one with slotted pads, an arc track, custom rules and a schematic, copper, mask, paste and outline match kicad-cli's Gerbers by bounding box to 2 µm and the drill files hole for hole.

| | Scripted KiCad | pcbjs |
| --- | --- | --- |
| Source of truth | the script and the `.kicad_pcb` it writes, which drift once someone edits the board in the GUI | the TSX module; every output is generated from it |
| Nets | strings, checked when the board is opened or DRC runs | typed values, checked by TypeScript as you type and at `connect` |
| Routing | by hand in the GUI, or tracks computed in the script | manual tracks, automatic legs, pairs and length tuning in one `route()` chain, cached and lockable |
| Checks | KiCad's DRC, run in the GUI or with `kicad-cli` as a separate step | DRC and ERC in every compile, findings tied to source lines |
| Feedback loop | run the script, reload the board, look | save, and the viewer recompiles in place |
| Schematic | a full schematic editor with symbols and sheets | a netlist in code, no drawn schematic |
| Interactive work | push and shove routing, a mature GUI | none: the code is the interface, the viewer is for looking |
| Maturity | decades of production use | a proof of concept |

KiCad is the better tool for a board that needs a drawn schematic, interactive routing or a team used to its GUI. pcbjs is for boards that are generated, parametric or repetitive, for designs that live in a code review, and for an agent that writes the board as code and reads the findings. Coming from KiCad, [Coming from KiCad](/docs/kicad) says what carries over one to one, and [Importing from KiCad](/docs/import) turns a `.kicad_pcb` or a footprint into pcbjs code.

## What it is not, yet

pcbjs is pre 0.1. There is no drawn schematic, no interactive or push and shove routing, and no KiCad export. Length tuning adds serpentines after routing and never reroutes to make room. [Development](/docs/development) keeps the full list of what is not there yet, and [Design](/docs/design) explains why the compiler is built the way it is.
