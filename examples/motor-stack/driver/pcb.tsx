// Driver: IR2133S three phase gate driver and six DPAK MOSFETs, 60 x 62 mm, two layers of 2 oz copper.
// The top 45 mm share the controller's outline and holes; the strip below carries the phase and ground wire pads.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down, seen from the top of the stack.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { pour, via } from '@pcbjs/core'
import { Brand, MountingHole, roundedRect, rect } from '@pcbjs/lib'
import { twoLayer } from '@pcbjs/lib/stackups'
import { W, HOLES } from '../lib/mech'
import { DRIVER_HEADER_AT, headerPin } from '../lib/header'
import { nHA, nLA, nHB, nLB, nHC, nLC, ISA, ISB, ISC, VSNS, nFAULT, SD } from '../lib/nets'
import { chain } from '../lib/wire'
import { HalfBridgeColumn } from './halfbridge.layout'
import * as sch from './driver.sch'

const H = 62
const COLS = [29.5, 39.5, 49.5] as const
const Hole = MountingHole(3.2)
const SIG = 0.25, GATE = 0.4, PWR = 0.6

export default (
  <PCB name="driver" title="Motor stack driver" revision="0.1.0" schematic={sch} color="black" stackup={twoLayer({ outerCopper: 2, finish: 'HASL' })}>
    <path layer="Edge.Cuts" d={roundedRect(W, H, 2)} />
    {[...HOLES, [3.5, 58.5], [56.5, 58.5]].map(([x, y], i) => <Hole ref={`H${i + 1}`} at={`${x} ${y}`} />)}

    <J1 at={DRIVER_HEADER_AT} thermal={{ 3: 'solid', 4: 'solid', 11: 'solid', 12: 'solid', 19: 'solid', 20: 'solid' }} />
    <U1 at="18.1 24 180deg" />
    <C_VCC at="18.3 36" />

    {/* the three phases, A to C left to right, and their wire pads on the bottom strip */}
    <HalfBridgeColumn g={A} at={`${COLS[0]} 0`} />
    <HalfBridgeColumn g={B} at={`${COLS[1]} 0`} />
    <HalfBridgeColumn g={C} at={`${COLS[2]} 0`} />
    <J_A at={`${COLS[0]} 55`} />
    <J_B at={`${COLS[1]} 55`} />
    <J_C at={`${COLS[2]} 55`} />
    <J_VM at="19 5" />
    <J_GND at="11 55" />

    {/* bulk capacitors on the back, across the edge of the VM strip, one between each pair of columns */}
    {C_BULK.map((Cb, i) => <Cb at={`${25 + 10 * i} 10.5 90deg`} side="B" />)}

    {/* regulators below the gate driver */}
    <U2 at="18 43" />
    <C_12IN at="12.5 44 90deg" />
    <C_12OUT at="23.5 43 90deg" />
    <U3 at="18 51.5" />
    <C_5OUT at="23.5 51.5 90deg" />

    {/* bus divider beside the header */}
    <R_VT at="9 37.5" />
    <R_VB at="9 39.5" />
    <C_VS at="12 38.5 90deg" />

    {/* header to gate driver inputs */}
    {([[nHA, U1.nHIN1], [nHB, U1.nHIN2], [nHC, U1.nHIN3], [nLA, U1.nLIN1], [nLB, U1.nLIN2], [nLC, U1.nLIN3], [nFAULT, U1.nFAULT], [SD, U1.SD]] as const)
      .map(([net, pin]) => chain(SIG, J1[headerPin(net)], pin))}
    {chain(SIG, J1[headerPin(ISA)], A.CF[2])}
    {chain(SIG, J1[headerPin(ISB)], B.CF[2])}
    {chain(SIG, J1[headerPin(ISC)], C.CF[2])}
    {chain(SIG, J1[headerPin(VSNS)], R_VB[1], C_VS[1])}
    {chain(SIG, R_VT[2], R_VB[1])}

    {/* gate drive: each output through its gate resistor, the bootstrap capacitor across VB and VS */}
    {([[A, U1.HO1, U1.LO1, U1.VB1, U1.VS1], [B, U1.HO2, U1.LO2, U1.VB2, U1.VS2], [C, U1.HO3, U1.LO3, U1.VB3, U1.VS3]] as const).map(([g, ho, lo, vb, vs]) => [
      chain(GATE, ho, g.RGH[1]),
      chain(GATE, lo, g.RGL[1]),
      chain(GATE, vb, g.CB[1]),
      chain(GATE, vs, g.QH.S),
    ])}
    {chain(SIG, U1.CAO, U1.CAm)}

    {/* supplies: VM to the 12 V regulator, 12 V to the gate driver, the bootstrap diodes and the 5 V regulator, 5 V up the header */}
    {chain(PWR, J_VM[1], R_VT[1])}
    {chain(PWR, C_12IN[1], U2.IN)}
    {chain(PWR, J_VM[1], C_12IN[1])}
    {chain(PWR, U2.OUT, C_12OUT[1], U3.IN)}
    {chain(PWR, C_12OUT[1], C_VCC[1], U1.VCC)}
    {chain(GATE, C_VCC[1], A.DB.A, B.DB.A, C.DB.A)}
    {chain(PWR, U3.pad('4'), U3.pad('2'))}
    {chain(PWR, U3.OUT, C_5OUT[1], J1[1], J1[2])}
    {chain(SIG, U1.nFLTCLR, J1[1])}

    {/* copper: the VM strip on both layers, ground on the back and a ground bar under the shunts on top */}
    {pour(VM, 'F.Cu', rect(45, 9.6, 14, 0.8), { priority: 2, connect: 'solid' })}
    {pour(VM, 'B.Cu', rect(45, 9.6, 14, 0.8), { priority: 2, connect: 'solid' })}
    {[18, 22, 26, 30, 34, 38, 42, 46, 50, 54].map(x => via(VM, `${x} 2.2`, { drill: 0.4, size: 0.8 }))}
    {pour(GND, 'F.Cu', rect(W, H), { connect: 'solid' })}
    {pour(GND, 'B.Cu', rect(W, H))}
    {[[25, 38], [35.5, 38], [45.5, 38], [56, 38], [8, 50], [14, 58.5], [25, 58], [45, 58], [34, 47], [44, 47]].map(([x, y]) => via(GND, `${x} ${y}`, { drill: 0.4, size: 0.8 }))}
    {/* GND pieces the rerouted gate tracks fence off: the driver's COM pin tied to its VCC capacitor, a via beside the phase A shunt */}
    {chain(SIG, U1.pad('1'), C_VCC[2])}{[[32.45, 34.45]].map(([x, y]) => via(GND, `${x} ${y}`, { drill: 0.3, size: 0.6 }))}

    <text layer="F.SilkS" at="31 60" size={1.5}>A</text>
    <text layer="F.SilkS" at="41 60" size={1.5}>B</text>
    <text layer="F.SilkS" at="51 60" size={1.5}>C</text>
    <text layer="F.SilkS" at="19 9.5" size={1}>VM 24V</text>
    <text layer="F.SilkS" at="11 59.5" size={1}>GND</text>
    <Brand at="15.35 46" height={6} layer="B.SilkS" />
  </PCB>
)
