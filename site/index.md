---
layout: home
title: pcbjs
titleTemplate: PCB design as TypeScript and JSX

hero:
  name: pcbjs
  text: PCB design as TypeScript and JSX
  image:
    src: /shots/usb3-hub-usb3-hub-3d.webp
    alt: The usb3-hub example board in 3D
  tagline: A board is a TSX module. The compiler places, routes, pours and checks it, and writes the Gerbers, drills, BOM and a viewer that links every item back to its line of code.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Read the docs
      link: /docs/quickstart
    - theme: alt
      text: See the examples
      link: /examples

features:
  - title: Nets and parts are values
    details: nets() hands out typed nets and a footprint factory a part; connect() checks pin names in the editor and pin counts at the call, so a misspelled net is a type error, not a one-pad net.
  - title: One compile, everything checked
    details: pcbjs check flattens the tree, autoroutes the legs you leave open, fills pours and runs DRC and ERC in a second or two. Each finding names the source line to change.
  - title: Ready to order
    details: Gerber X2, Excellon drills, a job file, BOM and placement for JLCPCB, OSH Park and your own presets, zipped, with a README-fab that says whether the board is orderable.
  - title: A viewer tied to the code
    details: The dev server shows the board in 2D and 3D and recompiles on save. Click a pad and the editor opens at the line that placed it; the VS Code extension shows the board beside the code.
  - title: Routing with intent
    details: Draw a track by hand, leave a leg to the autorouter, route differential pairs to an impedance and tune lengths into match groups, all in one route() chain.
  - title: Built for agents too
    details: Terse, stable command output, a JSON report, inspect for absolute coordinates and the docs in the terminal make pcbjs a tool a coding agent can drive.
---

## A real board

The layout of Blinky, one of the demo boards, as it is checked in: three LED channels switched by one transistor on a 30 by 20 mm board. The nets and parts come from its schematic module, and each channel is a circuit placed by its row layout.

<<< @/../examples/demo/blinky.pcb.tsx#example{tsx}

`npx pcbjs check` compiles, routes, and runs DRC and ERC on it; `npm run dev` opens the viewer:

<div class="viewer-shot pair"><img src="/shots/viewer-3d.webp" alt="The pcbjs viewer showing the Blinky demo board in 3D, with the layer list on the left and the findings panel on the right" width="1200" height="750" /><img src="/shots/viewer-sch.webp" alt="The same viewer showing Blinky's schematic, its symbols, wires and power symbols, with the schematic rows on the left" width="1200" height="750" /></div>

pcbjs is a proof of concept, on npm under the `beta` tag until 0.1. [Getting started](/getting-started) installs it and makes a first board; [Why pcbjs](/why) says what it is for and how it compares with scripted KiCad.
