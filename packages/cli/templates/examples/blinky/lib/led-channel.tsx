// One reusable LED channel: its electrical connections and two centered physical layouts.
import { circuit, route, type Ports } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

export const schematic = circuit('ledChannel', ({ VCC, SW }: Ports<'VCC' | 'SW'>, { nets: { led } }) => ({
  R: R0603('330').connect({ 1: VCC, 2: led }),
  D: LED0603('green').source({ MPN: 'LTST-C190GKT', Manufacturer: 'Lite-On' }).connect({ A: led, K: SW }),
}))

// Default row: the origin is midway between the resistor and LED.
export const layout = schematic.layout(
  (g, { at, side, label }) => (
    <g at={at} side={side}>
      <g.R at="-4mm 0" />
      <g.D at="4mm 0 180deg" />
      {route('-7 0').net(g.ports.VCC).width(0.3).H(-4.825)}
      {route('-3.175 0').net(g.nets.led).width(0.3).H(3.175)}
      {route('4.825 0').net(g.ports.SW).width(0.3).H(6.2)}
      {label && (
        <text layer="F.SilkS" at="0 -1.4mm" size={0.8}>
          {label}
        </text>
      )}
    </g>
  ),
  'LedChannelRow',
)

// Alternative stack: the same circuit with the resistor above the LED.
export const layoutStack = schematic.layout(
  (g, { at, side }) => (
    <g at={at} side={side}>
      <g.R at="0 -2 90deg" />
      <g.D at="0 2 90deg" />
      {route(g.R[2], g.D.A).width(0.3)}
    </g>
  ),
  'LedChannelStack',
)
