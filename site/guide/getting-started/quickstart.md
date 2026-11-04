---
title: Quickstart
description: Create a small LED board, inspect its complete source and open the matching preview.
---

# Quickstart

Start with the small LED board below, or follow the [Blinky walkthrough](./npm-setup) for a guided circuit-to-layout example. These pages target pcbjs 0.1.0.

## Create a board

With Node 22.12 or newer, create a project with pcbjs 0.1.0:

```sh
npx --package @pcbjs/pcbjs@0.1.0 pcbjs create my-board
cd my-board
npm install
npx pcbjs check
npm run dev
```

For an unreleased checkout, follow the [source setup](./npm-setup#use-the-current-source). The created folder contains `pcb.tsx`, `pcb.config.ts`, `tsconfig.json` and package scripts. Keep those files together: the config registers the board entry and TypeScript enables pcbjs JSX.

## Read the complete board

The source and preview below describe the same small board. Highlighted lines introduce the parts and copper. Hover a source expression to identify what it draws; use the file copy button to copy the complete module.

```tsx {10-12,17-22} preview=quickstart-led
// Hello: a green LED on a 20 x 15 mm two-layer board, powered from a two-pin header.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, roundedRect } from '@pcbjs/lib'

const { GND, VCC, LED } = nets()

const J1 = PinHeader(2)().source({ MPN: 'PEC02SAAN' }).connect({ 1: GND, 2: VCC })
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect({ 1: VCC, 2: LED })
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })

export default (
  <PCB name="Hello" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(20, 15, 1)} />
    <J1 at="3 4.96" />
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />
    {route(J1[2], R1[1]).width(0.3).Z()}
    {route(R1[2], D1.A).width(0.3).Z()}
    {route(D1.K, J1[1]).width(0.3)}
    <text layer="F.SilkS" at="10 12" size={1}>Hello</text>
  </PCB>
)
```

The part declarations name the electrical connections. The JSX places those parts, outlines the board and routes copper between their pads. The preset supplies the fabrication stackup and rules.

## Edit, inspect and check

Move R1 by changing its `at` value, then inspect the resulting geometry and run the checks:

```sh
npx pcbjs inspect R1
npx pcbjs check
```

`inspect` reports positions and pad identities. `check` compiles, routes, runs DRC/ERC and checks TypeScript. Review the drawing as well as the findings. When ready, `npm run build` writes fabrication outputs under `.pcbjs/fab/` and the static viewer under `.pcbjs/dist/`.

Use [extension setup](./extension-setup) to work beside synchronized previews in VS Code. Continue with [Blinky setup](./npm-setup), or consult the [CLI reference](/docs/cli) for configuration and command options.
