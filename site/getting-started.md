---
title: Getting started
description: Install pcbjs from npm, make a project, and run the edit and check loop on a first board.
---

# Getting started

pcbjs needs Node 22.12 or newer. `@beta` is the npm tag until 0.1; `latest` holds a placeholder with no code, so name the tag.

## Make a project

```sh
npm install -D @pcbjs/pcbjs@beta
npx pcbjs create my-board
cd my-board
npm install
```

`pcbjs create` writes a board, `pcb.tsx`, a config, `pcb.config.ts`, that lists it as the project's entry, a `tsconfig.json` with JSX pointed at `@pcbjs/core`, and a `package.json` with `dev`, `build` and `preview` scripts. [Quick start](/docs/quickstart) has every file.

## The loop

```sh
npx pcbjs check      # compile, route, DRC and ERC; one line per board, then the findings
npm run dev          # the viewer on http://localhost:5173, recompiled on every save
npx pcbjs inspect U1 # where a part and its pads ended up, in absolute mm
npm run build        # the fab set in .pcbjs/fab/my-board and the site in .pcbjs/dist
```

Edit, run `check`, read the findings, repeat. A finding gives the rule, the position, the parts and the source line to change. When `check` says `ok`, `build` writes the Gerbers, drills, BOM, placement file and a zip to send to the fab.

## From source

For contributors: clone https://github.com/pcbjs/pcbjs, run `npm install` and `npm run build` at its root, and make projects under `examples/`, which join the workspace. [Development](/docs/development) has the layout and the checks.

## A larger board

The template is one LED. Blinky, a demo board in `examples/demo`, shows how a board grows: the schematic module `blinky.sch.tsx` holds the nets, the parts and the schematic picture, and the layout `blinky.pcb.tsx` places them by name.

The schematic: three LED channels are instances of one `circuit()`, so each gets its own resistor, LED and private net, and findings say `R2 (CH2/R)`.

<<< @/../examples/demo/blinky.sch.tsx#example{tsx}

The layout: `schematic={sch}` puts every export of the module in scope, so `<J1 />` and `route(Q1[2])` need no import. Tracks are drawn by hand where they matter and left to the autorouter with `.X()` where they do not.

<<< @/../examples/demo/blinky.pcb.tsx#example{tsx}

Both files are the checked-in demo, kept clean by `pcbjs check`. Run it in `examples/demo` to see the board pass, then move a part onto another or misspell a pin to see a finding or a type error with its line.

## Next

- [Quick start](/docs/quickstart): the project files, the config and where things go in a board file.
- [Schematic](/docs/schematic) and [Layout](/docs/layout): nets, parts and the elements a board is drawn with.
- [Routing](/docs/routing) and [Autorouter](/docs/autorouter): manual tracks, automatic legs, pairs and lengths.
- [Findings](/docs/findings): every DRC and ERC rule and what makes a board orderable.
- [Examples](/examples): the demo boards and the review boards, with their numbers.
