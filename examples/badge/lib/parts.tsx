// Footprints the standard library does not have, written for the badge. Local mm, origin at the part centre, front side; side="B" mirrors them.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, courtyard, silkRect, TactSwitch, PogoPad, withPins } from '@pcbjs/lib'

// SOIC-8, 1.27 mm pitch, 3.9 mm body: pins 1 to 4 down the left, 5 to 8 up the right, as ATtiny85-SSU.
function SOIC8Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  const y = [-1.905, -0.635, 0.635, 1.905]
  return (
    <footprint id="badge:SOIC-8_3.9x4.9mm_P1.27mm" height={1.5} model={{ kind: 'box', w: 3.9, h: 4.9, height: 1.5, color: '#222' }} {...rest}>
      {y.map((py, i) => smd(i + 1, -2.7, py, 1.55, 0.6))}
      {y.map((py, i) => smd(8 - i, 2.7, py, 1.55, 0.6))}
      {courtyard(7.4, 5.4)}
      <rect layer="F.Fab" x={-1.95} y={-2.45} w={3.9} h={4.9} />
      <path layer="F.SilkS" d="M -1.4 -2.6 H 1.4 M -1.4 2.6 H 1.4" />
      <circle layer="F.SilkS" cx={-3.4} cy={-2.75} r={0.15} fill />
      {children}
    </footprint>
  )
}
export const SOIC8 = defineFootprint(SOIC8Footprint, { pins: ['1', '2', '3', '4', '5', '6', '7', '8'], prefix: 'U', id: 'badge:SOIC-8', name: 'SOIC8' })

// CR2032 holder in the manner of Keystone 3034: the + tab as one large pad at +x, the - contact as a large round pad under the cell.
// The cell itself is a 20 mm disc; the courtyard and a Dwgs.User circle mark the keepout under it.
function CR2032Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="badge:BatteryHolder_CR2032" height={4.2} {...rest}>
      <pad num="+" at="12.6 0" size={[2.6, 5]} shape="rect" />
      <pad num="-" at="0 0" size={8} shape="circle" />
      <circle layer="F.CrtYd" r={11} width={0.05} />
      <circle layer="Dwgs.User" r={10} />
      <circle layer="F.Fab" r={10} />
      <text layer="F.SilkS" at="12.6 -3.6" size={1.2}>+</text>
      {children}
    </footprint>
  )
}
export const CR2032 = defineFootprint(CR2032Footprint, { pins: ['+', '-'], prefix: 'BT', id: 'badge:CR2032', name: 'CR2032' })

// C&K PTS810 4.2 x 3.2 mm tact switch from the standard library, each pad its own pin: 1 and 2 are one contact, 3 and 4 the other.
export const Tact = withPins(TactSwitch('4.2x3.2'), { 1: '1', 2: '2', 3: '3', 4: '4' })

// SPDT SMD slide switch like the C&K JS102011SAQN, three terminals at 2.5 mm pitch.
function SlideFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="badge:SW_JS102011SAQN" height={1.5} model={{ kind: 'box', w: 8.6, h: 3.6, height: 1.5, color: '#888' }} {...rest}>
      {smd(1, -2.5, -2.2, 1.0, 1.4)}
      {smd(2, 0, -2.2, 1.0, 1.4)}
      {smd(3, 2.5, -2.2, 1.0, 1.4)}
      {courtyard(9.2, 6.4)}
      <rect layer="F.Fab" x={-4.3} y={-1.8} w={8.6} h={3.6} />
      {silkRect(8.8, 2.4)}
      {children}
    </footprint>
  )
}
export const Slide = defineFootprint(SlideFootprint, { pins: ['1', '2', '3'], prefix: 'SW', id: 'badge:SW_JS102011SAQN', name: 'Slide' })

// AVR ISP-6 as bare pogo pads from the standard library, 2 x 3 at 2.54 mm, odd pins on the top row: 1 MISO, 2 VCC, 3 SCK, 4 MOSI, 5 RST, 6 GND.
export const Pogo = PogoPad(1.5, { cols: 3, rows: 2 })
