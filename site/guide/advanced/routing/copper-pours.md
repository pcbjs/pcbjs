---
title: Add connected copper pours
description: Fill ground copper, inspect thermal connections and connect the two faces.
---

# Add connected copper pours

A filled area only helps a ground connection when it actually reaches the relevant copper. This lesson adds ground pours on two layers, inspects their pad connections, then adds stitching vias where both layers have usable fill.

## Pour around a simple signal

```tsx {13,14,15,16} preview=advanced-copper-pours
import PCB, { nets, pour, route, stitch } from '@pcbjs/core'
import { PinHeader, rect } from '@pcbjs/lib'

const { SIG, GND } = nets()
const J1 = PinHeader(2)().connect({ 1: SIG, 2: GND })
const J2 = PinHeader(2)().connect({ 1: SIG, 2: GND })

export default (
  <PCB name="PourPractice">
    <path layer="Edge.Cuts" d={rect(32, 22)} />
    <J1 at="5 8" />
    <J2 at="26 8" />
    {route(J1[1], J2[1]).width(0.3)}
    {pour(GND, 'F.Cu', rect(32, 22))}
    {pour(GND, 'B.Cu', rect(32, 22))}
    {stitch(GND, { pitch: 5, layers: ['F.Cu', 'B.Cu'] })}
  </PCB>
)
```

The outline limits the fill, including edge clearance. Signal copper and holes clear the ground pour by the applicable rules. Ground pads receive thermal connections by default; ground tracks and vias join solidly.

## Inspect connection, not just colour

Hide the back copper and zoom into a ground pad on the front. Look for the thermal gap and spokes. Then switch to the back and inspect the same pad. A visible patch of ground colour elsewhere on a layer does not prove that this pad is connected to it.

Run `npx pcbjs check` and `npx pcbjs inspect GND`. Inspect the zone rows and connectivity findings. By default, disconnected islands are removed; an isolated pad or region can still need an explicit route or via.

## Connect the faces

`stitch()` chooses via positions after the pours fill. Each candidate needs the requested net's fill under its whole via on the specified layers, as well as clearance from pads, holes and foreign copper. It may place fewer vias than the nominal lattice suggests. An empty result reports `stitch-empty` with its reason.

Temporarily remove the back pour and check again. The requested two-layer stitching no longer has the same eligible fill. Restore the pour and compare the via placement. This makes the dependency between fill and stitching visible.

When a pad needs a solid connection, override its thermal behavior deliberately rather than changing every pour. Review the soldering and thermal consequences for that component.

You now have a repeatable way to inspect fill, pad attachment and interlayer connections separately. See [Pours](/docs/pours) for thermal settings, priorities and islands, and [Layout: Keepouts](/docs/layout#keepouts) to reserve a region without copper.
