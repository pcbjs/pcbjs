// A second layout of the ledChannel circuit, in a file of its own: the resistor above the LED, both turned upright, with
// `led` routed by the compiler between their pins, the net taken from the pins. No demo board uses it; it shows that one circuit can have several layouts.
import { layout, route } from '@pcbjs/core'
import { ledChannel } from './led-channel.sch'

export const LedChannelStack = layout(ledChannel, (g, { at, side }) => (
  <g at={at} side={side}>
    <g.R at="0 0 90deg" />
    <g.D at="0 4 90deg" />
    {route(g.R[2]).X(g.D.A).width(0.3)}
  </g>
), 'LedChannelStack')
