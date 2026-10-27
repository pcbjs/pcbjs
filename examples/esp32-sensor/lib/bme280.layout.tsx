// The sensor block, 9 x 5 mm: the BME280 at the origin, its 100n just right of it, the two pull-ups in a column on the left.
// Routed by hand: the pins are 0.65 mm apart, and the router stacks a second via on a pad another route already reached through a via.
// The I2C lines leave from the pull-ups' inner pads, so the board routes SDA and SCL to SENS.RSDA[2] and SENS.RSCL[2].
import { layout, route, via } from '@pcbjs/core'
import { bme280 } from './bme280.sch'

export const Bme280Block = layout(bme280, (g, { at }) => (
  <g at={at}>
    <g.U at="0 0" />
    <g.C at="2.6 0 270deg" />
    <g.RSDA at="-4 -1.2" />
    <g.RSCL at="-4 1.2" />
    {/* I2C: SDI and SCK straight out to the pull-ups */}
    {route(g.U[3], g.RSDA[2], 'H -2.4 V -1.2 Z').width(0.2)}
    {route(g.U[4], g.RSCL[2], 'H -2.2 V 1.2 Z').width(0.2)}
    {/* VDD: VDDIO round pin 7 to VDD, VDD to the cap, the pull-up column, and under the block from the pull-ups to the cap */}
    {route(g.U[6], g.U[8], 'H 1.7 V -0.975 Z').width(0.2)}
    {route(g.U[8], g.C[1], 'H 2.6 Z').width(0.25)}
    {route(g.RSDA[1], g.RSCL[1], 'Z').width(0.25)}
    {route(g.RSCL[1], g.C[1], 'V 2.4 H 3.4 V -0.825 Z').width(0.25)}
    {/* CSB to VDD under the pull-ups on the back, which selects I2C */}
    {route(g.U[2], g.RSDA[1], 'H -1.7 @B.Cu V 0 H -4.825 @F.Cu Z').width(0.2)}
    {/* GND: pins 1, 7 and 5 joined under the body, a via at pin 5 and one at the cap */}
    {route(g.U[1], g.U[7], 'H 0.3 V -0.325 Z').width(0.2)}
    {route(g.U[7], g.U[5], 'H 0.3 V 0.975 Z').width(0.2)}
    {route(g.U[5], '1.0 1.75', 'Z').width(0.25)}
    {via(g.ports.GND, '1.0 1.75')}
    {route(g.C[2], '2.6 1.7', 'Z').width(0.25)}
    {via(g.ports.GND, '2.6 1.7')}
  </g>
), 'Bme280Block')
