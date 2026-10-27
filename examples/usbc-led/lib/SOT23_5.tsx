// SOT-23-5, pins 1 to 3 along the bottom left to right, 4 and 5 along the top right to left, 0.95 mm pitch.
// Pin names follow the AP2112K LDO: 1 VIN, 2 GND, 3 EN, 4 NC, 5 VOUT.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, courtyard } from '@pcbjs/lib'

function SOT23_5Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="usbc-led:SOT-23-5" value="SOT-23-5" height={1.1} model={{ kind: 'box', w: 1.6, h: 2.9, height: 1.1, color: '#222' }} {...rest}>
      {smd(1, -0.95, 1.1, 0.6, 1.1, { name: 'VIN' })}
      {smd(2, 0, 1.1, 0.6, 1.1, { name: 'GND' })}
      {smd(3, 0.95, 1.1, 0.6, 1.1, { name: 'EN' })}
      {smd(4, 0.95, -1.1, 0.6, 1.1, { name: 'NC' })}
      {smd(5, -0.95, -1.1, 0.6, 1.1, { name: 'VOUT' })}
      <rect layer="F.Fab" x={-1.45} y={-0.8} w={2.9} h={1.6} />
      {courtyard(3.6, 3.4)}
      <circle layer="F.SilkS" cx={-1.7} cy={1.6} r={0.1} fill />
      {children}
    </footprint>
  )
}

export const SOT23_5 = defineFootprint(SOT23_5Footprint, { pins: ['VIN', 'GND', 'EN', 'NC', 'VOUT'], prefix: 'U', id: 'usbc-led:SOT-23-5', name: 'SOT23_5' })
