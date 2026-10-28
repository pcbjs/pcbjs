// Footprints this board needs that @pcbjs/lib does not have, written from datasheet land patterns, approximate.
// Each is wrapped in defineFootprint so it works as a schematic part; pad names group pads that share a pin.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { smd, npth, courtyard, SOT23, TactSwitch } from '@pcbjs/lib'

// ESP32-C3-MINI-1: 13.2 x 16.6 mm module, antenna at the top (y < -3), 53 pads.
// Left column pins 1 to 13 top to bottom, bottom row 14 to 24 left to right, right column 25 to 37 bottom to top,
// 16 GND pads in a 4 x 4 grid under the body. The module's NC pads, '' below, are marked nc: they take no net and need no pin.
const C3_LEFT = ['GND', 'GND', '3V3', '', 'IO2', 'IO3', '', 'EN', '', '', 'GND', 'IO0', 'IO1']
const C3_BOTTOM = ['GND', '', 'IO10', '', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', '']
const C3_RIGHT = ['', 'IO18', 'IO19', '', '', 'RXD0', 'TXD0', '', '', '', '', 'GND', 'GND']
const C3_PINS = ['GND', '3V3', 'EN', 'IO0', 'IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO18', 'IO19', 'RXD0', 'TXD0'] as const

function ESP32C3MiniFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  const pads = []
  let n = 1
  for (let i = 0; i < 13; i++, n++) pads.push(smd(n, -6.35, -2.0 + i * 0.8, 0.9, 0.45, C3_LEFT[i] ? { name: C3_LEFT[i] } : { nc: true }))
  for (let i = 0; i < 11; i++, n++) pads.push(smd(n, -4.0 + i * 0.8, 8.05, 0.45, 0.9, C3_BOTTOM[i] ? { name: C3_BOTTOM[i] } : { nc: true }))
  for (let i = 0; i < 13; i++, n++) pads.push(smd(n, 6.35, 7.6 - i * 0.8, 0.9, 0.45, C3_RIGHT[i] ? { name: C3_RIGHT[i] } : { nc: true }))
  for (const y of [0.1, 1.7, 3.3, 4.9]) for (const x of [-2.4, -0.8, 0.8, 2.4]) pads.push(smd(n++, x, y, 0.9, 0.9, { name: 'GND' }))
  return (
    <footprint id="esp32:ESP32-C3-MINI-1" value="ESP32-C3-MINI-1" height={2.4} model={{ kind: 'box', w: 13.2, h: 16.6, height: 2.4, color: '#c0c4c8' }} {...rest}>
      {pads}
      {courtyard(13.8, 17.2)}
      <rect layer="F.Fab" x={-6.6} y={-8.3} w={13.2} h={16.6} />
      <path layer="F.SilkS" d="M -6.75 -8.45 H 6.75 V -2.6 M -6.75 -8.45 V -2.6" />
      <circle layer="F.SilkS" cx={-7.0} cy={-2.6} r={0.15} fill />
      <text layer="F.Fab" at="0 -5.5" size={1}>
        ANT
      </text>
      {children}
    </footprint>
  )
}
export const ESP32C3Mini = defineFootprint(ESP32C3MiniFootprint, { pins: C3_PINS, prefix: 'U', id: 'esp32:ESP32-C3-MINI-1', name: 'ESP32C3Mini' })

// USB-C 16-pin receptacle, HRO TYPE-C-31-M-12 style. Signal pads at y = 0, mouth toward +y, shell pads THT.
const USB_PADS: [string, string, number, number][] = [
  ['A1', 'GND', -3.2, 0.6],
  ['A4', 'VBUS', -2.4, 0.6],
  ['B8', 'SBU2', -1.75, 0.3],
  ['A5', 'CC1', -1.25, 0.3],
  ['B7', 'DN', -0.75, 0.3],
  ['A6', 'DP', -0.25, 0.3],
  ['A7', 'DN', 0.25, 0.3],
  ['B6', 'DP', 0.75, 0.3],
  ['A8', 'SBU1', 1.25, 0.3],
  ['B5', 'CC2', 1.75, 0.3],
  ['B4', 'VBUS', 2.4, 0.6],
  ['B1', 'GND', 3.2, 0.6],
]
function USBCFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="esp32:USB_C_Receptacle_HRO_TYPE-C-31-M-12" value="USB-C" height={3.2} model={{ kind: 'box', w: 8.94, h: 7.3, height: 3.2, color: '#b8bcc0' }} {...rest}>
      {USB_PADS.map(([num, name, x, w]) => smd(num, x, 0, w, 1.15, { name }))}
      {npth(-2.89, 1.25, 0.65)}
      {npth(2.89, 1.25, 0.65)}
      {[-4.32, 4.32].map(x => (
        <pad num="S" name="SHIELD" at={[x, 1.55]} size={[1.0, 2.1]} drill={[0.6, 1.7]} shape="oval" />
      ))}
      {[-4.32, 4.32].map(x => (
        <pad num="S" name="SHIELD" at={[x, 5.73]} size={[1.0, 1.6]} drill={[0.6, 1.2]} shape="oval" />
      ))}
      <rect layer="F.CrtYd" x={-5.1} y={-0.9} w={10.2} h={8.4} width={0.05} />
      <rect layer="F.Fab" x={-4.47} y={0.1} w={8.94} h={7.3} />
      {children}
    </footprint>
  )
}
export const USBC = defineFootprint(USBCFootprint, {
  pins: ['GND', 'VBUS', 'CC1', 'CC2', 'DP', 'DN', 'SBU1', 'SBU2', 'SHIELD'],
  prefix: 'J',
  id: 'esp32:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
  name: 'USBC',
})

// SOT-23-5 and SOT-23-6 from the standard library: pins 1 to 3 down the left, the rest up the right.
export const SOT23_5 = SOT23(5)
export const SOT23_6 = SOT23(6)

// Bosch LGA-8, 2.5 x 2.5 mm, 0.65 mm pitch: pins 1 to 4 on the left top to bottom, 5 to 8 on the right bottom to top.
function LGA8Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  const ys = [-0.975, -0.325, 0.325, 0.975]
  return (
    <footprint id="esp32:Bosch_LGA-8_2.5x2.5mm_P0.65mm" value="LGA-8" height={0.93} model={{ kind: 'box', w: 2.5, h: 2.5, height: 0.93, color: '#d8d8d0' }} {...rest}>
      {ys.map((y, i) => smd(i + 1, -1.0, y, 0.5, 0.35))}
      {ys.map((y, i) => smd(8 - i, 1.0, y, 0.5, 0.35))}
      {courtyard(3.1, 3.1)}
      <rect layer="F.Fab" x={-1.25} y={-1.25} w={2.5} h={2.5} />
      <circle layer="F.SilkS" cx={-1.65} cy={-1.45} r={0.12} fill />
      {children}
    </footprint>
  )
}
export const LGA8 = defineFootprint(LGA8Footprint, { pins: ['1', '2', '3', '4', '5', '6', '7', '8'], prefix: 'U', id: 'esp32:Bosch_LGA-8_2.5x2.5mm_P0.65mm', name: 'LGA8' })

// 5.1 x 5.1 mm SMD tactile switch, TS-1187A, from the standard library: pads 1 and 2 are pin A, 3 and 4 pin B.
export const Tact = TactSwitch('5.1x5.1')
