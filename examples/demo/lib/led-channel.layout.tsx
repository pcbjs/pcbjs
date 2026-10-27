// A layout of the ledChannel circuit: one row along +x, the resistor then the LED, with the tracks between them.
// Local frame: the channel runs along y = 0; the supply bus of the board is at x = 9, the switch bus at x = 22.2.
import { layout, route } from '@pcbjs/core'
import { ledChannel } from './led-channel.sch'

export const LedChannelRow = layout(ledChannel, (g, { at, label }) => (
  <g at={at}>
    <g.R at="12mm 0" />
    <g.D at="20mm 0 180deg" />
    {route(g.ports.VCC, { width: 0.3, d: 'M 9 0 H 11.175' })}
    {route(g.nets.led, { width: 0.3, d: 'M 12.825 0 H 19.175' })}
    {route(g.ports.SW, { width: 0.3, d: 'M 20.825 0 H 22.2' })}
    {label && <text layer="F.SilkS" at="16mm -1.4mm" size={0.8}>{label}</text>}
  </g>
), 'LedChannelRow')
