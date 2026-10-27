// Jig: a 60 x 45 mm bed of nails for the controller. The controller lies face up on it, its test pads on the pogo pins, its M3 holes on locating pins.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down, the same frame as the controller seen from its top.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { pour, via, reference } from '@pcbjs/core'
import { Brand, MountingHole, roundedRect, rect } from '@pcbjs/lib'
import { W, H, HOLES, TEST_PADS } from '../lib/mech'
import { chain } from '../lib/wire'
import * as sch from './jig.sch'

const Locator = MountingHole(3.2)
const SIG = 0.25, PWR = 0.5

export default (
  <PCB name="jig" title="Motor stack controller jig" revision="0.1.0" schematic={sch} color="red">
    <path layer="Edge.Cuts" d={roundedRect(W, H, 2)} />
    {HOLES.map(([x, y], i) => <Locator ref={`H${i + 1}`} at={`${x} ${y}`} />)}

    {/* pogo pins under the controller's test pads */}
    {P.map((Pin, i) => <Pin at={`${TEST_PADS[i].x} ${TEST_PADS[i].y}`} />)}
    {TEST_PADS.map(t => <text layer="F.SilkS" at={`${t.x} ${t.y - 2.6}`} size={0.7}>{t.name}</text>)}

    <J1 at="21 12 -90deg" thermal={{ 3: 'solid', 5: 'solid' }} />
    <J2 at="40 10" />
    <R1 at="12 26" />
    <D1 at="16 26 180deg" />

    {chain(PWR, J2[1], P[1][1])}
    {chain(PWR, J2[2], P[0][1])}
    {chain(0.3, J2[3], P[6][1])}
    {chain(0.3, J2[4], P[7][1])}
    {chain(SIG, J1[1], P[2][1], R1[1])}
    {chain(SIG, J1[2], P[3][1])}
    {chain(SIG, J1[4], P[4][1])}
    {chain(SIG, J1[10], P[5][1])}
    {chain(SIG, R1[2], D1.A)}

    {pour(GND, 'B.Cu', rect(W, H))}
    {pour(GND, 'F.Cu', rect(W, H), { connect: 'solid' })}
    {[[10, 20], [30, 20], [50, 20], [10, 34], [50, 34], [30, 30]].map(([x, y]) => via(GND, `${x} ${y}`))}

    {/* where the controller lies */}
    <path layer="F.SilkS" d={roundedRect(W - 1, H - 1, 1.5, 0.5, 0.5)} />
    <text layer="F.SilkS" at="38 30" size={1.2}>motor-stack controller jig</text>

    {/* the controller lying face up on the pogo pins: its GND test pad on the first pin */}
    {reference('../controller/pcb.tsx', { mate: { local: P[0], remote: 'TP1', pin: 1 } })}
    <Brand at="15.35 4" height={6} layer="B.SilkS" />
  </PCB>
)
