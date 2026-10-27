// WS2812B-2020 addressable RGB LED, 2.0 x 2.0 mm, 4 pads.
// Pin order from the datasheet: 1 DOUT top-left, 2 GND bottom-left, 3 DIN bottom-right, 4 VDD top-right, seen from the top.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'

function WS2812B2020Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="lib:WS2812B-2020" value="WS2812B-2020" height={0.84} model={{ kind: 'box', w: 2, h: 2, height: 0.84, color: '#f2f2ee' }} {...rest}>
      <pad num={1} name="DOUT" at="-0.8 -0.55" size={[0.7, 0.6]} />
      <pad num={2} name="GND" at="-0.8 0.55" size={[0.7, 0.6]} />
      <pad num={3} name="DIN" at="0.8 0.55" size={[0.7, 0.6]} />
      <pad num={4} name="VDD" at="0.8 -0.55" size={[0.7, 0.6]} />
      <rect layer="F.CrtYd" x={-1.4} y={-1.2} w={2.8} h={2.4} width={0.05} />
      <rect layer="F.Fab" x={-1} y={-1} w={2} h={2} />
      {/* pin 1 marker */}
      <line layer="F.SilkS" x1={-1.45} y1={-1.15} x2={-1.45} y2={-0.2} />
      {children}
    </footprint>
  )
}

export const WS2812B2020 = defineFootprint(WS2812B2020Footprint, { pins: ['DOUT', 'GND', 'DIN', 'VDD'], prefix: 'D', id: 'lib:WS2812B-2020', name: 'WS2812B2020' })
