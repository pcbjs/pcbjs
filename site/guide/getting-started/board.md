---
title: Define the board
description: Give Blinky its outline, coordinate frame and design rules.
---

# Define the board

Open `pcb.tsx`. Start a fresh layout file that default-exports a `<PCB>`. This first state contains only the outline. This is the physical board: its outline, rules and the elements placed inside it.

## Start with the outline

Blinky uses a 30 × 20 mm rounded rectangle with 2 mm corner radii. The outline is a path on `Edge.Cuts`:

<GuideDemo example="blinky-board" />

The frame has x increasing to the right and y increasing downward. In this example, `(0, 0)` is the top-left of the outline. Distances are millimetres unless a value includes another unit.

`roundedRect(W, H, 2)` returns the path; the `Edge.Cuts` layer makes that path the board boundary. In 3D, the same boundary determines the board's shape. Copper must remain inside the allowed edge clearance.

## Connect the files

In the next placement step, add the schematic import. The `schematic={sch}` prop makes the schematic module's exports available in this board file. That is why Blinky can place `<J1>` and use `VCC` without importing each name separately. Explicit imports and local declarations are also supported.

`name="Blinky"` names the board and its outputs. `rev="0.1.0"` records the design revision. `pcb.config.ts` names `pcb.tsx` as the entry, so `check`, `dev` and `build` all read the same design.

## Keep the rules with the design

Blinky starts from the JLCPCB rules set by its project config. This outline sets 0.2 mm clearance and 0.2 mm minimum track width. The later placement and routing states add required sourcing information and `autoroute` options for 45-degree bends with a via cost of 4.

These are constraints the compiler checks and the router uses. Changing the outline or a rule can affect many routes, so inspect the new board and run `npx pcbjs check` after either change.

**Try it:** locate the outline in the 2D view, then switch to 3D. Notice that the rounded corners and dimensions describe the same object in both views. Keep the supplied dimensions for the next lesson.

Next: [Place the parts](./placement). For other board options and fab presets, see [Board reference](/docs/board) and [Fab presets](/docs/fab).
