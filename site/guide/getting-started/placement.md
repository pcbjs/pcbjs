---
title: Place the parts
description: Turn schematic parts into positioned footprints on the front and back of Blinky.
---

# Place the parts

A part definition gives a component its value, connections and footprint. A placement gives that footprint a position on this board. In `pcb.tsx`, find J1, Q1 and C1:

<GuideDemo example="blinky-placement" />

Hover the source lines or drawing to connect each placement with the object it draws. Use the full viewer to inspect pads and nets.

## Read a position

`at="3 8"` places J1's footprint origin at x = 3 mm, y = 8 mm. The origin belongs to the footprint definition; it need not be its geometric centre. `at` can include a third value for rotation, such as `"15 10 90deg"`.

`side="B"` puts C1 on the back. It remains the same C1 defined in the schematic, with the same nets. Switch sides in the 2D viewer or rotate the 3D view to inspect it. In Blinky, this keeps C1 out of the front-side LED track's way.

A placed part normally brings its pads, courtyard, silk reference and 3D body together. Use `ref:at` when only its generated reference label needs a different position. The finished Blinky adds explicit back silk text for C1 later.

## Place repeated channels as rows

`lib/led-channel.tsx` exports `schematic`, `layout` and `layoutStack`. The layouts are declared with `schematic.layout(render, name)`. The board imports `layout` as `LedChannelRow`, keeping its JSX readable.

The three `LedChannelRow` elements place CH1, CH2 and CH3 at x = 16 mm, y = 5, 10 and 15 mm. Inside each row, the resistor is at x = −4 mm and the LED at x = +4 mm. Their midpoint is the local grid origin. The row's placement carries the board offset, while its parts and short tracks use local coordinates. Moving or rotating a row moves that arrangement around its own origin.

<GuideDemo example="blinky-groups" />

For this first board, keep that shared layout and adjust the board-level placements. [Reusable layouts](/docs/circuits#layouts) explains how to author the row itself when you are ready.

## Make one small move

Move J1 a small distance to the right, save `pcb.tsx` and inspect the changed position. Run:

```sh
npx pcbjs inspect J1
npx pcbjs check
```

`inspect` reports the footprint and pad positions in board coordinates. A position change can affect routes and clearance, so compare the drawing and the findings. Restore J1's original position before following the routing lesson, whose coordinates refer to the supplied layout.

Next: [Route the connections](./routing). See [Layout reference](/docs/layout) for placement elements and [Placement tools](/docs/placement) for automatic placement.
