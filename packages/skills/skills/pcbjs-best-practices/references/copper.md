# Copper for current and heat

Pours, stitching and heat copper are measured with `pcbjs inspect <net>`: its first line gives the net's copper per layer, its `zone` rows the fill, pieces and islands removed, and its `stitch` line the stitching vias.

## Stitching vias from the fill

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, stitch } from '@pcbjs/core'
import { PinHeader, R0603, rect } from '@pcbjs/lib'

const { GND, VCC } = nets()
const VIA = { drill: 0.3, size: 0.62 }
const J1 = PinHeader(2).connect(GND, VCC)
const R1 = R0603('1k').connect(VCC, GND)

export default (
  <PCB name="Stitched">
    <rect layer="Edge.Cuts" x={0} y={0} w={60} h={40} />
    <J1 at="5 20" />
    <R1 at="30 20" />
    {route(J1[2]).X(R1[1])}
    {pour(GND, 'F.Cu', rect(60, 40))}
    {pour(GND, 'B.Cu', rect(60, 40))}
    {stitch(GND, { pitch: 4, layers: ['F.Cu', 'B.Cu'], padClearance: 1.0, via: VIA, avoid: { silk: true } })}
  </PCB>
)
```

- `stitch()` places through vias on a lattice wherever every listed layer has fill of the net, clear of other copper, holes, keepouts and pads, then refills once. Vias or through-hole pads of the net already there suppress lattice points, so it adds to a hand layout.
- Measure coverage with the `stitch` line of `inspect GND`, nearest neighbour 95th percentile, before and after.
- Leave it out where the owner limits hole density or keeps vias on a grid; `stitch()` does not snap to a grid.
- Restrict it with `area`, an SVG path, when only part of the board wants it.

## Heat copper from dead pockets

A pour pocket of ground fenced in by tracks, with no ground via or pad in it, carries no current; pcbjs removes it as an island or keeps it joined by a neck. Under a power FET's drain or a regulator's tab it is free copper for heat:

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, pour, via } from '@pcbjs/core'
import { rect } from '@pcbjs/lib'

const { GND, DRAIN } = nets()
const VIA = { drill: 0.3, size: 0.62 }

export default (
  <PCB name="Heat">
    <rect layer="Edge.Cuts" x={0} y={0} w={50} h={40} />
    {pour(GND, 'B.Cu', rect(50, 40))}
    {pour(DRAIN, 'B.Cu', rect(3.1, 6.25, 39.6, 28.9), { clearance: 0.2, priority: 2, connect: 'solid' })}
    {[40.1, 40.9, 41.7, 42.5].map(x => via(DRAIN, `${x} 29.3`, VIA))}
  </PCB>
)
```

- The higher `priority` fills first and the lower pour keeps its clearance from it, so overlapping pours need no hand-cut edges.
- Thermal vias beside the tab, outside the soldered pads, join the two layers; each must keep its clearance on every layer it passes.
- Keep the new pour off any via the owner placed for another piece of fill; `unconnected` says so if not.
- Report the net's copper before and after from `inspect <net>`, and the via count at the tab.

## Pour parity with KiCad

When a board came from KiCad, compare each net's fill area per layer against KiCad's `filled_polygon` areas, a shoelace sum over the `.kicad_pcb`. Pieces KiCad keeps through 45 degree spokes on round pads come back with `thermal: { angle: 45 }` on those pads or parts; a fresh `pcbjs import board` writes it. Expect 98 to 99 % of KiCad's area: pcbjs draws its own reliefs and both remove islands.
