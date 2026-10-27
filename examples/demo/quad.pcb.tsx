// Quad: a divider on a 30 x 15 mm four-layer board, with SIG on In1.Cu between a via pair and a ground plane on In2.Cu.
// The schematic is quad.sch.ts. Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/4-Layer' // the fab: the JLC04161H-7628 stackup, JLCPCB's rules and LCSC sourcing
import { route, pour, via } from '@pcbjs/core'
import { Brand, rect } from '@pcbjs/lib'
import * as sch from './quad.sch'

const W = 30, H = 15

export default (
  <PCB name="Quad" revision="0.1.0" schematic={sch} color="black">
    {/* outline: 30 x 15 mm with 1 mm corners */}
    <rect layer="Edge.Cuts" x={0} y={0} w={W} h={H} rx={1} />

    {/* the connector, pin 1 VIN, and the divider in a row at the height of the board's middle */}
    <J1 at="3 6.23" />
    <Divider.R1 at="10 7.5" />
    <Divider.R2 at="22 7.5" />

    {/* VIN on the top: from J1.1 across, then 45 degrees down to R1.1 */}
    {route(VIN, { width: 0.3, d: 'M 3 6.23 H 7.905 L 9.175 7.5' })}

    {/* SIG: down to In1.Cu at a via, across, and up again at the second via; the vias go through every layer */}
    {route(SIG, { width: 0.25, d: 'M 10.825 7.5 H 12.5' })}
    {via(SIG, '12.5 7.5')}
    {route(SIG, { layer: 'In1.Cu', width: 0.25, d: 'M 12.5 7.5 H 19.5' })}
    {via(SIG, '19.5 7.5')}
    {route(SIG, { width: 0.25, d: 'M 19.5 7.5 H 21.175' })}

    {/* GND: R2 drops to the In2.Cu plane through a via; J1.2 reaches it through its plated hole */}
    {route(GND, { width: 0.3, d: 'M 22.825 7.5 H 24.5' })}
    {via(GND, '24.5 7.5')}
    {pour(GND, 'In2.Cu', rect(W, H))}

    {/* silk */}
    <text layer="F.SilkS" at="16 12.5" size={1}>Quad · 4 layers</text>
    <Brand at="20.5 2.7" height={4} />
  </PCB>
)
