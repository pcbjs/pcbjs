// One phase of the bridge: Q01 and Q02 the high and low side DPAK MOSFETs, R01 the low side shunt, R02 and R03 the gate
// resistors, D01 and C01 the bootstrap pair, R04 and C02 the shunt's RC filter. In instance n they are Qn01 and so on.
import { layout as defineLayout, route, pour, via, keepout, circuit, type Ports } from '@pcbjs/core'
import { rect, R0603, C0603, C0805, chip } from '@pcbjs/lib'
import { DPAK, R2512 } from '../lib/footprints'

const FET = { MPN: 'IPD90N06S4-04', Manufacturer: 'Infineon' }
export const D1206 = chip('D', '1206', { names: ['K', 'A'], polarity: true })

export const schematic = circuit(
  'halfBridge',
  ({ VM, GND, V12, PH, HO, LO, VB, IS }: Ports<'VM' | 'GND' | 'V12' | 'PH' | 'HO' | 'LO' | 'VB' | 'IS'>, { nets: { gh, gl, sl } }) => ({
    Q01: DPAK('IPD90N06S4-04').source(FET).connect({ G: gh, D: VM, S: PH }),
    Q02: DPAK('IPD90N06S4-04').source(FET).connect({ G: gl, D: PH, S: sl }),
    R01: R2512('5m').source({ MPN: 'WSL2512R0050FEA', Manufacturer: 'Vishay' }).connect({ 1: GND, 2: sl }),
    R02: R0603('10').connect({ 1: HO, 2: gh }),
    R03: R0603('10').connect({ 1: LO, 2: gl }),
    D01: D1206('CD1206-B0540').source({ MPN: 'CD1206-B0540', Manufacturer: 'Bourns' }).connect({ A: V12, K: VB }),
    C01: C0805('1u').connect({ 1: VB, 2: PH }),
    R04: R0603('100').connect({ 1: IS, 2: sl }),
    C02: C0603('1n').connect({ 1: GND, 2: IS }),
  }),
)

// One column of the power stage, high side on top: Q01, Q02, the shunt, then the bootstrap pair.
// Local frame: origin near the column's visual centre; the board supplies the column's global offset.

export const layout = defineLayout(
  schematic,
  (g, { at }) => (
    <g at={at}>
      <g.Q01 at="0 -19 90deg" />
      <g.Q02 at="0 -6 90deg" />
      <g.R01 at="2.28 4.5 90deg" />
      <g.R02 at="-4.7 -12.5 90deg" />
      <g.R03 at="-4.7 0.5 90deg" />
      <g.R04 at="-2.2 4.5 90deg" />
      <g.C02 at="-2.2 8 90deg" />
      <g.C01 at="-4 16 90deg" />
      <g.D01 at="-4 20.5 -90deg" />

      {/* the phase node: Q01 source and the Q02 tab poured on top, a strip on the back down to the phase wire pad */}
      {pour(g.ports.PH, 'F.Cu', rect(7, 11.4, -3.5, -15.4), { priority: 2, connect: 'solid' })}
      {pour(g.ports.PH, 'B.Cu', rect(5, 46, -2.5, -16), { priority: 2, connect: 'solid' })}
      {/* the Q01 source corner of the F.Cu pour is cut off from the Q02 tab by the gate tracks: a via down to the strip */}
      {via(g.ports.PH, '1.2 -14', { drill: 0.3, size: 0.6 })}
      {/* no signal tracks across the phase strip below the tab: crossing it on B.Cu cut the phase current's path in two */}
      {keepout(rect(5, 18, -2.5, -5), { layers: ['B.Cu'], vias: false, pours: false })}
      {[
        [-1.6, -9.2],
        [0, -9.2],
        [1.6, -9.2],
        [-1.6, -7],
        [0, -7],
        [1.6, -7],
        [-1.6, -4.8],
        [0, -4.8],
        [1.6, -4.8],
      ].map(([x, y]) => via(g.ports.PH, `${x} ${y}`, { drill: 0.4, size: 0.8 }))}

      {/* Q02 source into the shunt, the shunt's sense end through the RC filter */}
      {route(g.Q02.S, g.R01[2]).width(2).Z()}
      {route(g.R01[2], g.R04[2]).width(0.3)}
      {route(g.R04[1], g.C02[2]).width(0.3).Z()}
      {route(g.R02[2], g.Q01.G).width(0.5)}
      {route(g.R03[2], g.Q02.G).width(0.5)}
      {route(g.D01.K, g.C01[1]).width(0.5).Z()}
      {route(g.C01[2], '0 15 B.Cu').width(0.5)}
    </g>
  ),
  'HalfBridgeColumn',
)
