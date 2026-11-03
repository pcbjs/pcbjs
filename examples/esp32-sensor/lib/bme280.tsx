// BME280 on I2C at 0x76: CSB to VDD selects I2C, SDO to GND sets the address. Decoupling and the bus pull-ups, R1 on SDA and R2 on SCL, live here.
import { layout as defineLayout, route, via, circuit, type Ports } from '@pcbjs/core'
import { C0603, R0603 } from '@pcbjs/lib'
import { LGA8 } from './footprints'

export const schematic = circuit('bme280', ({ VDD, GND, SDA, SCL }: Ports<'VDD' | 'GND' | 'SDA' | 'SCL'>) => ({
  U: LGA8('BME280').source({ MPN: 'BME280', 'MPN:LCSC': 'C92489', Manufacturer: 'Bosch' }).connect({ 1: GND, 2: VDD, 3: SDA, 4: SCL, 5: GND, 6: VDD, 7: GND, 8: VDD }),
  C: C0603('100n').connect({ 1: VDD, 2: GND }),
  R1: R0603('4k7').connect({ 1: VDD, 2: SDA }),
  R2: R0603('4k7').connect({ 1: VDD, 2: SCL }),
}))

// The sensor block, 9 x 5 mm: the BME280 at the origin, its 100n just right of it, the two pull-ups in a column on the left.
// Routed by hand: the pins are 0.65 mm apart, and the router stacks a second via on a pad another route already reached through a via.
// The I2C lines leave from the pull-ups' inner pads, so the board routes SDA and SCL to SENS.R1[2] and SENS.R2[2].

export const layout = defineLayout(
  schematic,
  (g, { at }) => (
    <g at={at}>
      <g.U at="0 0" />
      <g.C at="2.6 0 270deg" />
      <g.R1 at="-4 -1.2" />
      <g.R2 at="-4 1.2" />
      {/* I2C: SDI and SCK straight out to the pull-ups */}
      {route(g.U[3], g.R1[2]).width(0.2).H(-2.4).V(-1.2).Z()}
      {route(g.U[4], g.R2[2]).width(0.2).H(-2.2).V(1.2).Z()}
      {/* VDD: VDDIO round pin 7 to VDD, VDD to the cap, the pull-up column, and under the block from the pull-ups to the cap */}
      {route(g.U[6], g.U[8]).width(0.2).H(1.7).V(-0.975).Z()}
      {route(g.U[8], g.C[1]).width(0.25).H(2.6).Z()}
      {route(g.R1[1], g.R2[1]).width(0.25).Z()}
      {route(g.R2[1], g.C[1]).width(0.25).V(2.4).H(3.4).V(-0.825).Z()}
      {/* CSB to VDD under the pull-ups on the back, which selects I2C */}
      {route(g.U[2], g.R1[1]).width(0.2).H(-1.7).via('B.Cu').V(0).H(-4.825).via('F.Cu').Z()}
      {/* GND: pins 1, 7 and 5 joined under the body, a via at pin 5 and one at the cap */}
      {route(g.U[1], g.U[7]).width(0.2).H(0.3).V(-0.325).Z()}
      {route(g.U[7], g.U[5]).width(0.2).H(0.3).V(0.975).Z()}
      {route(g.U[5], '1.0 1.75').width(0.25).Z()}
      {via(g.ports.GND, '1.0 1.75')}
      {route(g.C[2], '2.6 1.7').width(0.25).Z()}
      {via(g.ports.GND, '2.6 1.7')}
    </g>
  ),
  'Bme280Block',
)
