// Footprints the stdlib lacks: the STM32F103C8 in LQFP-48, a USB-C 2.0 receptacle, a SOT-23 regulator, two crystals and a tact switch.
// Frame: millimetres, origin at the footprint centre, x right, y down.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { courtyard, smd, silkRect } from '@pcbjs/lib/footprint'
import { LQFP, Crystal3225 as Crystal3225Lib, Crystal3215 as Crystal3215Lib, withPins } from '@pcbjs/lib'

// STM32F103C8 pin names in pin order, from the datasheet's LQFP48 pinout; supply pins get a suffix so every name is unique.
export const STM32F103_LQFP48_PINS = [
  'VBAT',
  'PC13',
  'PC14',
  'PC15',
  'OSC_IN',
  'OSC_OUT',
  'NRST',
  'VSSA',
  'VDDA',
  'PA0',
  'PA1',
  'PA2',
  'PA3',
  'PA4',
  'PA5',
  'PA6',
  'PA7',
  'PB0',
  'PB1',
  'PB2',
  'PB10',
  'PB11',
  'VSS_1',
  'VDD_1',
  'PB12',
  'PB13',
  'PB14',
  'PB15',
  'PA8',
  'PA9',
  'PA10',
  'PA11',
  'PA12',
  'PA13',
  'VSS_2',
  'VDD_2',
  'PA14',
  'PA15',
  'PB3',
  'PB4',
  'PB5',
  'PB6',
  'PB7',
  'BOOT0',
  'PB8',
  'PB9',
  'VSS_3',
  'VDD_3',
] as const
export const STM32F103C8 = LQFP(48, 7, 0.5, { pinNames: STM32F103_LQFP48_PINS })

// USB-C 2.0 receptacle, HRO TYPE-C-31-M-12 style. The mouth is at -y; place it at -90deg to face +x.
// Pad x positions along the row; B-side pads carry the "2" suffix.
const USBC_ROW = [
  ['A1B12', 'GND_A', -3.2, 0.6],
  ['A4B9', 'VBUS_A', -2.4, 0.6],
  ['B8', 'SBU2', -1.75, 0.3],
  ['A5', 'CC1', -1.25, 0.3],
  ['B7', 'DN2', -0.75, 0.3],
  ['A6', 'DP1', -0.25, 0.3],
  ['A7', 'DN1', 0.25, 0.3],
  ['B6', 'DP2', 0.75, 0.3],
  ['A8', 'SBU1', 1.25, 0.3],
  ['B5', 'CC2', 1.75, 0.3],
  ['B4A9', 'VBUS_B', 2.4, 0.6],
  ['B1A12', 'GND_B', 3.2, 0.6],
] as const
function USBCFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="pcbjs:USB_C_Receptacle_HRO_TYPE-C-31-M-12" value="USB-C" height={3.2} model={{ kind: 'box', w: 8.94, h: 7.3, height: 3.2, color: '#b8b8b8' }} {...rest}>
      {USBC_ROW.map(([num, name, x, w]) => smd(num, x, 3.4, w, 1.45, { name }))}
      <pad num="S1" name="SH1" at="-4.32 2.9" size={[1.0, 2.1]} drill={[0.6, 1.7]} shape="oval" />
      <pad num="S2" name="SH2" at="4.32 2.9" size={[1.0, 2.1]} drill={[0.6, 1.7]} shape="oval" />
      <pad num="S3" name="SH3" at="-4.32 -1.3" size={[1.0, 1.6]} drill={[0.6, 1.2]} shape="oval" />
      <pad num="S4" name="SH4" at="4.32 -1.3" size={[1.0, 1.6]} drill={[0.6, 1.2]} shape="oval" />
      <rect layer="F.Fab" x={-4.47} y={-3.6} w={8.94} h={7.3} />
      <rect layer="F.CrtYd" x={-5.2} y={-3.9} w={10.4} h={8.4} width={0.05} />
      <path layer="F.SilkS" d="M -4.6 0.2 V 1.6 M 4.6 0.2 V 1.6" />
      {children}
    </footprint>
  )
}
export const USBC = defineFootprint(USBCFootprint, {
  pins: [...USBC_ROW.map(r => r[1]), 'SH1', 'SH2', 'SH3', 'SH4'],
  prefix: 'J',
  id: 'pcbjs:USB_C_Receptacle_HRO_TYPE-C-31-M-12',
  name: 'USBC',
})

// SOT-23 regulator such as the XC6206: 1 VSS, 2 VOUT, 3 VIN.
function SOT23RegFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="pcbjs:SOT-23" value="SOT-23" height={1.1} model={{ kind: 'sot23', pins: 3 }} {...rest}>
      {smd(1, -1.0, -0.95, 0.9, 0.8, { name: 'GND' })}
      {smd(2, -1.0, 0.95, 0.9, 0.8, { name: 'VOUT' })}
      {smd(3, 1.0, 0, 0.9, 0.8, { name: 'VIN' })}
      {courtyard(3.4, 3.4)}
      <rect layer="F.Fab" x={-0.7} y={-1.5} w={1.4} h={3} />
      <path layer="F.SilkS" d="M -0.2 -1.6 H 0.9 V -0.7 M -0.2 1.6 H 0.9 V 0.7" />
      {children}
    </footprint>
  )
}
export const SOT23Reg = defineFootprint(SOT23RegFootprint, { pins: ['GND', 'VOUT', 'VIN'], prefix: 'U', id: 'pcbjs:SOT-23', name: 'SOT23Reg' })

// 3.2 x 2.5 mm four-pad crystal from the standard library: 1 and 3 the crystal, 2 and 4 the lid, here as two pins GND1 and GND2.
export const Crystal3225 = withPins(Crystal3225Lib, { 2: 'GND1', 4: 'GND2' })

// 3.2 x 1.5 mm two-pad watch crystal from the standard library.
export const Crystal3215 = Crystal3215Lib

// Two-pad 4 x 3 mm SMD tact switch, TS-1088 style.
function TactFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="pcbjs:SW_SPST_TS-1088" value="TS-1088" height={2.0} model={{ kind: 'box', w: 4, h: 3, height: 2.0, color: '#3a3a3a' }} {...rest}>
      {smd(1, -2.0, 0, 1.0, 1.6)}
      {smd(2, 2.0, 0, 1.0, 1.6)}
      {courtyard(5.4, 3.6)}
      {silkRect(2.4, 3.0)}
      {children}
    </footprint>
  )
}
export const Tact = defineFootprint(TactFootprint, { pins: ['1', '2'], prefix: 'SW', id: 'pcbjs:SW_SPST_TS-1088', name: 'Tact' })
