---
title: Change one instance or its library layout
description: Make a local placement override without changing every repeated circuit.
---

# Change one instance or its library layout

A connector or mounting hole can force one repeated block to differ from the others. This lesson makes that difference explicit in the source: one instance gets a placement override, while the shared layout stays reusable.

## Place two copies, then override one member

The child of a layout element replaces that member's placement in the layout. It uses the same local frame as the original placement.

```tsx {10,11,12,13,23,26} preview=advanced-instance-layouts
import PCB, { circuit, nets, route, type Ports } from '@pcbjs/core'
import { R0603, rect } from '@pcbjs/lib'

const divider = circuit('divider', ({ VIN, GND }: Ports<'VIN' | 'GND'>, { nets: { mid } }) => {
  const R1 = R0603('10k').connect({ 1: VIN, 2: mid })
  const R2 = R0603('10k').connect({ 1: mid, 2: GND })
  return { R1, R2 }
})
const Divider = divider.layout((g, { at, side }) => (
  <g at={at} side={side}>
    <g.R1 at="-2.5 0" />
    <g.R2 at="2.5 0" />
    {route(g.R1[2], g.R2[1]).width(0.25)}
  </g>
), 'Divider')
const { VIN, GND } = nets()
const CH1 = divider({ VIN, GND }, 'CH1')
const CH2 = divider({ VIN, GND }, 'CH2')

export default (
  <PCB name="Overrides">
    <path layer="Edge.Cuts" d={rect(25, 20)} />
    <Divider g={CH1} at="7.5 5">
      <CH1.R2 at="2.5 2" />
    </Divider>
    <Divider g={CH2} at="7.5 13" />
  </PCB>
)
```

CH1's R2 now sits 2 mm below its shared position. CH2's R2 remains at local `2.5 0`. The route still refers to the same member handles, so it follows the actual pad positions. The example leaves VIN and GND distribution to the containing board.

## Choose the scope before editing

Open the board in `dev`, select a divider. The **Edit instance layout** and **Edit library layout** buttons appear below the view-state badges. **Edit instance layout** works on the shown instance; a supported member move writes an own placement among that layout element's children. **Edit library layout** writes the shared definition and changes every following instance. The viewer explains when a shared element has no supported instance override.

The path chip identifies the editing context. Instance editing ends when member focus is cleared. Library editing shows the isolated template, including its schematic, with fresh local numbering; it stays open until you leave that context. An own placement already present in an instance keeps that placement when the library definition changes.

## Verify the distinction

Move CH1's overridden R2 again and inspect the source. Its child placement should change. Then change the shared R1 placement in the `Divider` definition from `"-2.5 0"` to `"-2.5 1"`: both instances should follow.

This gives you two deliberate tools: local exceptions belong at the call site, and common improvements belong in the shared layout. See [Circuits: Layouts](/docs/circuits#layouts) for the child placement rules and [Editing](/docs/editing) for write behavior.
