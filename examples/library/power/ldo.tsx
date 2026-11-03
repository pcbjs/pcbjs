// The regulator of the power library: an AMS1117-3.3 with its input and output capacitors, as a circuit and the layout that places it.
// In instance n the parts are Un01, Cn01 and Cn02. Local frame: millimetres, origin between the regulator and capacitors, x right, y down.
import { circuit, layout as defineLayout, route, type Ports } from '@pcbjs/core'
import { C0805, SOT223, withPins } from '@pcbjs/lib'

/** The AMS1117 in SOT-223, its tab on VOUT. */
export const AMS1117 = withPins(SOT223, ['GND', 'VOUT', 'VIN'])

export const schematic = circuit('ldo', ({ VIN, VOUT, GND }: Ports<'VIN' | 'VOUT' | 'GND'>) => ({
  U01: AMS1117('AMS1117-3.3').source({ MPN: 'AMS1117-3.3', 'MPN:LCSC': 'C6186' }).connect({ VIN, VOUT, GND }),
  C01: C0805('10u').source({ MPN: 'CL21A106KAYNNNE', 'MPN:LCSC': 'C15850' }).connect({ 1: VIN, 2: GND }),
  C02: C0805('22u').source({ MPN: 'CL21A226MAQNNNE', 'MPN:LCSC': 'C45783' }).connect({ 1: VOUT, 2: GND }),
}))

/** The regulator with a capacitor either side, below its pins. */
export const layout = defineLayout(schematic, (g, { at }) => (
  <g at={at}>
    <g.U01 at="0 -2" />
    <g.C01 at="-4.5 4.5 90deg" />
    <g.C02 at="4.5 4.5 90deg" />
    {route(g.U01.VIN, g.C01[1]).width(0.5)}
    {route(g.U01[2], g.C02[1]).width(0.5)}
    {route(g.U01[4], g.C02[1]).width(0.5)}
    {route(g.U01.GND, g.C01[2]).width(0.5)}
    {route(g.C01[2], g.C02[2]).width(0.5)}
  </g>
), 'ldoLayout')
