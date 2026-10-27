// USB-C receptacle, 6-pin power-only, mid-mount style simplified to SMD signal pads and four plated shell legs.
// Local frame: origin at the body centre, mouth toward -y, signal pads toward +y.
// Pads A12/B1 are GND, A9/B4 VBUS, A5 CC1, B5 CC2; the shell legs are pin SH.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, tht, courtyard } from '@pcbjs/lib'

function USBC6PFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="usbc-led:USB-C-6P" value="USB-C 6P" height={3.2} model={{ kind: 'box', w: 8.94, h: 7.3, height: 3.2, color: '#c0c0c0' }} {...rest}>
      {smd('A12', -2.5, 4.0, 1.0, 1.3, { name: 'GND' })}
      {smd('A9', -1.5, 4.0, 0.7, 1.3, { name: 'VBUS' })}
      {smd('A5', -0.5, 4.0, 0.6, 1.3, { name: 'CC1' })}
      {smd('B5', 0.5, 4.0, 0.6, 1.3, { name: 'CC2' })}
      {smd('B4', 1.5, 4.0, 0.7, 1.3, { name: 'VBUS' })}
      {smd('B1', 2.5, 4.0, 1.0, 1.3, { name: 'GND' })}
      {tht('S1', -4.32, -1.6, 1.6, 1.0, { name: 'SH' })}
      {tht('S2', 4.32, -1.6, 1.6, 1.0, { name: 'SH' })}
      {tht('S3', -4.32, 2.2, 1.6, 1.0, { name: 'SH' })}
      {tht('S4', 4.32, 2.2, 1.6, 1.0, { name: 'SH' })}
      <rect layer="F.Fab" x={-4.47} y={-3.65} w={8.94} h={7.3} />
      {courtyard(10.4, 9.8)}
      {children}
    </footprint>
  )
}

export const USBC6P = defineFootprint(USBC6PFootprint, { pins: ['GND', 'VBUS', 'CC1', 'CC2', 'SH'], prefix: 'J', id: 'usbc-led:USB-C-6P', name: 'USBC6P' })
