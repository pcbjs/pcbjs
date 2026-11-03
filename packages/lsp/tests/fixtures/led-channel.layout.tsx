// A layout of the ledChannel circuit: a row centered between resistor and LED, with the tracks between them.
// Local frame: the channel runs along y = 0; the board supplies the global offset.
import { layout, route } from '@pcbjs/core'
import { ledChannel } from './led-channel.sch'

export const LedChannelRow = layout(ledChannel, (g, { at, label }) => (
  <g at={at}>
    <g.R at="-4mm 0" />
    <g.D at="4mm 0 180deg" />
    {route('-7 0').net(g.ports.VCC).width(0.3).H(-4.825)}
    {route('-3.175 0').net(g.nets.led).width(0.3).H(3.175)}
    {route('4.825 0').net(g.ports.SW).width(0.3).H(6.2)}
    {label && <text layer="F.SilkS" at="0 -1.4mm" size={0.8}>{label}</text>}
  </g>
), 'LedChannelRow')
