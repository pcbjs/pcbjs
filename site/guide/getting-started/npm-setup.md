---
title: Set up with npm
description: Create Blinky, check it, and open the live viewer before editing a board.
---

# Set up with npm

Start with a working board so each change has a result you can compare. This guide uses Blinky: three LED channels switched by one transistor on a 30 × 20 mm board.

Use Node 22.12 or newer. This guide targets pcbjs 0.1.0. For an unreleased checkout, use the [source setup](#use-the-current-source) until its version is available on npm.

## Install pcbjs 0.1.0

Create a project with the 0.1.0 release:

```sh
npx --package @pcbjs/pcbjs@0.1.0 pcbjs create my-blinky --example blinky
cd my-blinky
npm install
npx pcbjs check
npm run dev
```

The viewer opens at the address printed by `dev`, normally `http://localhost:5173`. Keep it running while editing.

## Use the current source

Clone the repository and build its packages, then create Blinky inside its examples workspace:

```sh
git clone https://github.com/pcbjs/pcbjs.git
cd pcbjs
npm install
npm run build
node packages/pcbjs/bin/pcbjs.js create examples/my-blinky --example blinky
npm install
cd examples/my-blinky
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

The example uses the checkout's packages. Later lessons use `npx pcbjs` as shorthand for the project's CLI. The current viewer provides 2D, 3D, Schematic and DRC/ERC views.

## Find the files

| File | What you will change |
| --- | --- |
| `blinky.sch.tsx` | Nets, part connections and the schematic drawing |
| `pcb.tsx` | Board outline, part positions, routes and silk |
| `blinky.sourcing.ts` | Manufacturer and distributor part numbers |
| `lib/led-channel.tsx` | The reusable circuit, its default row layout and a stack variant |
| `pcb.config.ts` | The entry to compile and project defaults |

The repository keeps this board at `examples/demo/blinky.pcb.tsx`. The created project calls the same layout `pcb.tsx` and lists only that entry in its config. Each guide preview is compiled from the complete source displayed beside it, with a separate state for each lesson.

## Keep a known result

The supplied Blinky should pass DRC, ERC and TypeScript checking. Run `npx pcbjs check` again after each small change. Save the original in version control so you can compare or restore an experiment.

To start with the smaller default board later, run `npx pcbjs create my-board` in a new or empty directory. `npx pcbjs create --list-examples` lists other starting points.

Next, [set up the VS Code extension](./extension-setup), or continue with [Define the schematic](./schematic). To work with a coding agent instead, follow [Set up an agent](./agentic-setup).
