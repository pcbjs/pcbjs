// Parts outside the standard library, land patterns taken from the KiCad 9 footprint library, see models/LICENSES.md.
// Frames are KiCad's: mm, origin where KiCad has it, y down.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { courtyard, silkOutline, npth } from '@pcbjs/lib'

// Amphenol 12401610E4-2A: USB Type-C receptacle, 24 contacts, top mount, horizontal. KiCad
// USB_C_Receptacle_Amphenol_12401610E4-2A. Two staggered rows of 0.3 x 0.7 mm pads at 0.5 mm pitch, the A row at the rear,
// y -5.02, the B row at y -3.32 under the body, the mouth at +y. The shield pads are 0.82 x 1.4 mm on 0.46 x 1.04 mm slots
// where KiCad has 0.8 x 1.4 on 0.5 x 1.1: a 0.18 mm ring for JLCPCB, and 0.45 mm from the slots to the peg holes.
const USBC_A = ['GND', 'TX1P', 'TX1N', 'VBUS', 'CC1', 'DP', 'DN', 'SBU1', 'VBUS', 'RX2N', 'RX2P', 'GND'] as const
const USBC_B = ['GND', 'TX2P', 'TX2N', 'VBUS', 'CC2', 'DP', 'DN', 'SBU2', 'VBUS', 'RX1N', 'RX1P', 'GND'] as const

function USBC24Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  const sh = [[-4.49, 2.84], [-4.13, -3.11], [4.13, -3.11], [4.49, 2.84]]
  return (
    <footprint id="hub:USB_C_Receptacle_Amphenol_12401610E4-2A" value="12401610E4-2A" height={3.2} {...rest}>
      {USBC_A.map((name, i) => <pad num={`A${i + 1}`} name={name} at={`${-2.75 + i * 0.5} -5.02`} size={[0.3, 0.7]} />)}
      {USBC_B.map((name, i) => <pad num={`B${i + 1}`} name={name} at={`${2.5 - i * 0.5} -3.32`} size={[0.3, 0.7]} />)}
      {sh.map(([x, y], i) => <pad num={`S${i + 1}`} name="SHIELD" at={`${x} ${y}`} size={[0.82, 1.4]} drill={[0.46, 1.04]} shape="oval" thermal="thermal" />)}
      {npth(-3.6, -4.36, 0.65)}
      <pad num="" type="npth" at="3.6 -4.36" size={[0.95, 0.65]} drill={[0.95, 0.65]} shape="oval" />
      {silkOutline(9.2, 9.2, { cy: -0.62, edges: ['left', 'right'], pads: sh.map(([x, y]) => ({ x, y, w: 0.9, h: 1.5 })) })}
      {courtyard(10.78, 11.6, 0, -0.07)}
      {children}
    </footprint>
  )
}

export const USBC24 = defineFootprint(USBC24Footprint, {
  pins: ['GND', 'VBUS', 'CC1', 'CC2', 'DP', 'DN', 'SBU1', 'SBU2', 'TX1P', 'TX1N', 'RX1P', 'RX1N', 'TX2P', 'TX2N', 'RX2P', 'RX2N', 'SHIELD'],
  pads: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'S1', 'S2', 'S3', 'S4'],
  prefix: 'J', id: 'hub:USB_C_Receptacle_Amphenol_12401610E4-2A', name: 'USBC24',
})

// Wuerth 692122030100: USB 3.0 Type-A receptacle, right angle, SMD contacts and through-hole shell. KiCad
// USB3_A_Receptacle_Wuerth_692122030100. Pins 1 to 4 are the USB 2.0 row, 5 to 9 the SuperSpeed contacts between them, the
// mouth at +y.
const USB3A_PADS = [
  ['1', 'VBUS', -3.75, -8.67, 2.6], ['2', 'DN', -1.25, -8.67, 2.6], ['3', 'DP', 1.25, -8.67, 2.6], ['4', 'GND', 3.75, -8.67, 2.6],
  ['5', 'SSRXN', 5, -8.895, 2.15], ['6', 'SSRXP', 2.5, -8.895, 2.15], ['7', 'GND', 0, -8.895, 2.15],
  ['8', 'SSTXN', -2.5, -8.895, 2.15], ['9', 'SSTXP', -5, -8.895, 2.15],
] as const

function USB3AFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="hub:USB3_A_Receptacle_Wuerth_692122030100" value="692122030100" height={7} {...rest}>
      {USB3A_PADS.map(([num, name, x, y, h]) => <pad num={num} name={name} at={`${x} ${y}`} size={[0.9, h]} />)}
      <pad num="S1" name="SHIELD" at="-6.8 -3.45" size={[2.52, 3.4]} drill={[1.12, 2]} shape="oval" thermal="thermal" />
      <pad num="S2" name="SHIELD" at="6.8 -3.45" size={[2.52, 3.4]} drill={[1.12, 2]} shape="oval" thermal="thermal" />
      {npth(-3.4, -3.45, 2)}
      {npth(3.4, -3.45, 2)}
      {silkOutline(13.1, 14.8, { cy: -0.93, edges: ['left', 'right'], pads: [-6.8, 6.8].map(x => ({ x, y: -3.45, w: 2.52, h: 3.4 })) })}
      {courtyard(13.6, 18.4, 0, -0.85)}
      {children}
    </footprint>
  )
}

export const USB3A = defineFootprint(USB3AFootprint, {
  pins: ['VBUS', 'DN', 'DP', 'GND', 'SSRXN', 'SSRXP', 'SSTXN', 'SSTXP', 'SHIELD'],
  prefix: 'J', id: 'hub:USB3_A_Receptacle_Wuerth_692122030100', name: 'USB3A',
})

// TI TPD4EUSB30 in the DQA package, USON-10 2.5 x 1.0 mm, 0.5 mm pitch, KiCad USON-10_2.5x1.0mm_P0.5mm. Flow-through: each
// line enters on pins 1, 2, 4, 5 at -x and leaves on the NC pins 10, 9, 7, 6 opposite, so both pads of a line are one pin.
const USON_PADS = [
  ['1', 'D1P', -0.385, -1], ['2', 'D1N', -0.385, -0.5], ['3', 'GND', -0.385, 0], ['4', 'D2P', -0.385, 0.5], ['5', 'D2N', -0.385, 1],
  ['6', 'D2N', 0.385, 1], ['7', 'D2P', 0.385, 0.5], ['8', 'GND', 0.385, 0], ['9', 'D1N', 0.385, -0.5], ['10', 'D1P', 0.385, -1],
] as const

function USON10Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint model={{ file: '../models/USON-10_2.5x1.0mm_P0.5mm.step' }} id="hub:USON-10_2.5x1.0mm_P0.5mm" value="TPD4EUSB30" height={0.55} {...rest}>
      {USON_PADS.map(([num, name, x, y]) => <pad num={num} name={name} at={`${x} ${y}`} size={[0.55, 0.3]} />)}
      <circle layer="F.SilkS" cx={-0.75} cy={-1.55} r={0.1} width={0.15} />
      {courtyard(1.82, 3)}
      {children}
    </footprint>
  )
}

export const USON10 = defineFootprint(USON10Footprint, {
  pins: ['D1P', 'D1N', 'GND', 'D2P', 'D2N'], prefix: 'U', id: 'hub:USON-10_2.5x1.0mm_P0.5mm', name: 'TPD4EUSB30',
})
