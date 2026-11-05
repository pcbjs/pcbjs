# Copper for current and heat

Pours, stitching and heat copper are measured with `pcbjs inspect <net>`: its first line gives the net's copper per layer, its `zone` rows the fill, pieces and islands removed, and its `stitch` line the stitching vias.

## Via sizes as a design choice

Fab minima are limits, not the preferred via inventory. Choose a usual drill and diameter for the board, reuse the same object for `autoroute={{ via: VIA }}`, standalone `via()`, `stitch(..., { via: VIA })` and explicit chain transitions, and document intentional exceptions for escape, current or thermal needs. A net class `via` applies to its routes; it does not currently set standalone or stitching dimensions. Keep trace width and via dimensions separate unless an electrical or manufacturing calculation connects them.

Inspect the compiled inventory by drill, diameter and layer span, then attribute each group to manual, automatic, pair or stitching sources before consolidating it. Several diameters on one drill can be deliberate. Preserve explicit overrides and compare connectivity, clearance and routing after any consolidation. Do not impose a fixed number of sizes or change the fab limits just to select a smaller default.

With no via dimensions specified, pcbjs currently starts at 0.3 mm drill and 0.6 mm diameter and grows those defaults to meet board minima. Lowering `minViaDrill` or `minViaDiameter` does not select those smaller values. Board `autoroute.via` sets route defaults only; it does not change standalone or stitching vias. `rulesAt()` currently reports class dimensions or fab minima, so use actual item queries, such as `board.items.on('F.Cu', { kinds: ['via'] })`, when auditing emitted geometry. Include other spans and deduplicate item ids for a whole-board inventory.

## Stitching vias from the fill

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, stitch } from '@pcbjs/core'
import { PinHeader, R0603, rect } from '@pcbjs/lib'

const { GND, VCC } = nets()
const VIA = { drill: 0.3, size: 0.62 }
const J1 = PinHeader(2)().connect({ 1: GND, 2: VCC })
const R1 = R0603('1k').connect({ 1: VCC, 2: GND })

export default (
  <PCB name="Stitched" rev="0.1.0">
    <rect layer="Edge.Cuts" x={0} y={0} w={60} h={40} />
    <J1 at="5 20" />
    <R1 at="30 20" />
    {route(J1[2], R1[1])}
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
  <PCB name="Heat" rev="0.1.0">
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

## Silk appearance over copper

Check fabrication silk clipping in 2D separately from 3D visibility across camera distances and board sides. If valid white artwork becomes tinted or disappears only in the 3D view, investigate renderer depth and transparency before changing the board. Choose mask, silk thickness and finish for manufacturing intent; do not increase the physical stack thickness or artwork strokes to compensate for a viewer depth defect. `maskExpansion` and `silkMinWidth` are fabrication constraints, not camera depth controls.
