// The LDO stage in a 9 x 4 mm row: CIN on the left, the regulator in the middle, COUT on the right, both caps upright with GND at the top.
// Origin at the regulator centre. VIN arrives from below at CIN, VOUT leaves from below at COUT; GND drops to the back pour through two vias.
import { layout, route, via } from '@pcbjs/core'
import { ldo } from './ldo.sch'

export const LdoRow = layout(ldo, (g, { at }) => (
  <g at={at}>
    <g.U at="0 0" />
    <g.CIN at="-3.4 0 90deg" />
    <g.COUT at="3.4 0 90deg" />
    {/* VIN (pin 1) down the left of the regulator to CIN, EN (pin 3) joining it on the way */}
    {route(g.U[1], g.CIN[1], 'H -2.2 V 0.825 Z').width(0.3)}
    {route(g.U[3], '-2.2 0.95', 'Z').width(0.3)}
    {/* VOUT (pin 5) down the right to COUT */}
    {route(g.U[5], g.COUT[1], 'H 2.4 V 0.825 Z').width(0.3)}
    {/* GND: pin 2 to CIN, both caps to vias into the back pour */}
    {route(g.U[2], g.CIN[2], 'XZ').width(0.3)}
    {via(g.ports.GND, '-3.4 -2.0')}
    {via(g.ports.GND, '3.4 -2.0')}
    {route(g.CIN[2], '-3.4 -2.0', 'Z').width(0.3)}
    {route(g.COUT[2], '3.4 -2.0', 'Z').width(0.3)}
  </g>
), 'LdoRow')
