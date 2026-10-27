// Multi: the Coin idea built for three fabs at once, JLCPCB 2-Layer, OSH Park 2-Layer and a house target with a 0.2 mm clearance
// and a black mask. One design, compiled once per target: each target gets its own DRC, BOM, fab set and viewer entry.
// The schematic is multi.sch.ts. Frame: millimetres, origin at the top-left corner of the outline's bounding box, x right, y down.
import { route, variants } from '@pcbjs/core'
import JLCPCB from '@pcbjs/fab/JLCPCB/2-Layer'
import OSHPark from '@pcbjs/fab/OSHPark/2-Layer'
import { Brand } from '@pcbjs/lib'
import * as sch from './multi.sch'

// the fabs: one <PCB> that compiles the board once per target
const PCB = variants(JLCPCB, OSHPark, { name: 'House', rules: { clearance: 0.2 }, color: 'black' })

export default (
  <PCB name="Multi" revision="0.1.0" schematic={sch}>
    {/* outline: a 20 mm circle */}
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />

    {/* VBAT in at TP1, through R1 at the centre, out at TP2 */}
    <TP1 at="5 10" />
    <R1 at="10 10" />
    <TP2 at="14 14" />

    {/* VBAT drawn by hand, the same in every target */}
    {route(VBAT, { width: 0.4, d: 'M 5 10 H 9.175' })}
    {/* OUT routed by the compiler under each target's rules */}
    {route(OUT, { from: R1[2], to: TP2[1], width: 0.3 })}

    {/* silk */}
    <text layer="F.SilkS" at="10 6" size={1}>Multi · pcbjs</text>
    <Brand at="10 10" height={4} layer="B.SilkS" />
  </PCB>
)
