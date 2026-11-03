// A 3.3 V LDO stage: AP2112K-3.3 with its input and output capacitors, enable tied to the input.
// Ports: VIN, VOUT and GND. Pin 4 of the AP2112K is NC. C1 is the input capacitor, C2 the output one.
import { layout as defineLayout, route, via, circuit, NC, type Ports } from '@pcbjs/core'
import { C0603 } from '@pcbjs/lib'
import { SOT23_5 } from './footprints'

export const schematic = circuit('ldo', ({ VIN, VOUT, GND }: Ports<'VIN' | 'VOUT' | 'GND'>) => ({
  U: SOT23_5('AP2112K-3.3').source({ MPN: 'AP2112K-3.3TRG1', 'MPN:LCSC': 'C51118', Manufacturer: 'Diodes' }).connect({ 1: VIN, 2: GND, 3: VIN, 4: NC, 5: VOUT }),
  C1: C0603('1u').connect({ 1: VIN, 2: GND }),
  C2: C0603('1u').connect({ 1: VOUT, 2: GND }),
}))

// The LDO stage in a 9 x 4 mm row: C1, the input capacitor, on the left, the regulator in the middle, C2, the output one, on the right, both caps upright with GND at the top.
// Origin at the regulator centre. VIN arrives from below at C1, VOUT leaves from below at C2; GND drops to the back pour through two vias.

export const layout = defineLayout(
  schematic,
  (g, { at }) => (
    <g at={at}>
      <g.U at="0 0" />
      <g.C1 at="-3.4 0 90deg" />
      <g.C2 at="3.4 0 90deg" />
      {/* VIN (pin 1) down the left of the regulator to C1, EN (pin 3) joining it on the way */}
      {route(g.U[1], g.C1[1]).width(0.3).H(-2.2).V(0.825).Z()}
      {route(g.U[3], '-2.2 0.95').width(0.3).Z()}
      {/* VOUT (pin 5) down the right to C2 */}
      {route(g.U[5], g.C2[1]).width(0.3).H(2.4).V(0.825).Z()}
      {/* GND: pin 2 to C1, both caps to vias into the back pour */}
      {route(g.U[2], g.C1[2]).width(0.3)}
      {via(g.ports.GND, '-3.4 -2.0')}
      {via(g.ports.GND, '3.4 -2.0')}
      {route(g.C1[2], '-3.4 -2.0').width(0.3).Z()}
      {route(g.C2[2], '3.4 -2.0').width(0.3).Z()}
    </g>
  ),
  'LdoRow',
)
