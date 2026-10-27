// Parts the stdlib lacks: the STM32F429ZI pin map for the LQFP-144 generator, and the 54-pin TSOP-II SDRAM written with
// defineFootprint. Frame: millimetres, origin at the body centre, x right, y down.
import { defineFootprint, type FootprintProps } from '@pcbjs/core'
import { courtyard, smd } from '@pcbjs/lib/footprint'
import { LQFP, SOT223, withPins } from '@pcbjs/lib'

// STM32F429ZI LQFP144 pin names in pin order, from the datasheet pinout. Supply pads share one pin per name.
export const F429_LQFP144_PINS = [
  'PE2', 'PE3', 'PE4', 'PE5', 'PE6', 'VBAT', 'PC13', 'PC14', 'PC15', 'PF0', 'PF1', 'PF2', 'PF3', 'PF4', 'PF5', 'VSS', 'VDD', 'PF6',
  'PF7', 'PF8', 'PF9', 'PF10', 'PH0', 'PH1', 'NRST', 'PC0', 'PC1', 'PC2', 'PC3', 'VDD', 'VSSA', 'VREF', 'VDDA', 'PA0', 'PA1', 'PA2',
  'PA3', 'VSS', 'VDD', 'PA4', 'PA5', 'PA6', 'PA7', 'PC4', 'PC5', 'PB0', 'PB1', 'PB2', 'PF11', 'PF12', 'VSS', 'VDD', 'PF13', 'PF14',
  'PF15', 'PG0', 'PG1', 'PE7', 'PE8', 'PE9', 'VSS', 'VDD', 'PE10', 'PE11', 'PE12', 'PE13', 'PE14', 'PE15', 'PB10', 'PB11', 'VCAP1', 'VDD',
  'PB12', 'PB13', 'PB14', 'PB15', 'PD8', 'PD9', 'PD10', 'PD11', 'PD12', 'PD13', 'VSS', 'VDD', 'PD14', 'PD15', 'PG2', 'PG3', 'PG4', 'PG5',
  'PG6', 'PG7', 'PG8', 'VSS', 'VDD', 'PC6', 'PC7', 'PC8', 'PC9', 'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA13', 'VCAP2', 'VSS', 'VDD',
  'PA14', 'PA15', 'PC10', 'PC11', 'PC12', 'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'VSS', 'VDD', 'PD6', 'PD7', 'PG9', 'PG10', 'PG11',
  'PG12', 'PG13', 'PG14', 'VSS', 'VDD', 'PG15', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'BOOT0', 'PB8', 'PB9', 'PE0', 'PE1', 'PDR_ON', 'VDD',
] as const
export const STM32F429 = LQFP(144, 20, 0.5, { pinNames: F429_LQFP144_PINS })

// 16-bit SDRAM in TSOP-II 54, 400 mil, 0.8 mm pitch, the JEDEC pinout of the W9825G6KH and IS42S16160: pads 1 to 27 down
// the left, 28 to 54 up the right. Land pattern after KiCad TSOP-II-54_22.2x10.16mm_P0.8mm.
export const TSOP54 = [
  'VDD', 'DQ0', 'VDDQ', 'DQ1', 'DQ2', 'VSSQ', 'DQ3', 'DQ4', 'VDDQ', 'DQ5', 'DQ6', 'VSSQ', 'DQ7', 'VDD', 'LDQM', 'WE', 'CAS', 'RAS',
  'CS', 'BA0', 'BA1', 'A10', 'A0', 'A1', 'A2', 'A3', 'VDD', 'VSS', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A11', 'A12', 'CKE', 'CLK',
  'UDQM', 'NC', 'VSS', 'DQ8', 'VDDQ', 'DQ9', 'DQ10', 'VSSQ', 'DQ11', 'DQ12', 'VDDQ', 'DQ13', 'DQ14', 'VSSQ', 'DQ15', 'VSS',
] as const
const TSOP_X = 5.3, TSOP_PITCH = 0.8
function tsopPad(i: number) {
  const left = i < 27
  const k = left ? i : 53 - i
  return smd(i + 1, left ? -TSOP_X : TSOP_X, (k - 13) * TSOP_PITCH, 1.6, 0.5, { name: TSOP54[i] })
}
function TSOP54Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  const pads = TSOP54.map((_, i) => tsopPad(i))
  return (
    <footprint id="pcbjs:TSOP-II-54_22.2x10.16mm_P0.8mm" value="TSOP-II-54" height={1.2} model={{ kind: 'box', w: 10.16, h: 22.22, height: 1.2, color: '#222' }} {...rest}>
      {pads}
      <rect layer="F.Fab" x={-5.08} y={-11.11} w={10.16} h={22.22} />
      <path layer="F.SilkS" d="M -5.2 -11.25 H 5.2 M -5.2 11.25 H 5.2 M -6.3 -11.25 H -5.2" />
      {courtyard(12.8, 22.9)}
      {children}
    </footprint>
  )
}
export const SDRAM_TSOP54 = defineFootprint(TSOP54Footprint, {
  pins: ['DQ0', 'DQ1', 'DQ2', 'DQ3', 'DQ4', 'DQ5', 'DQ6', 'DQ7', 'DQ8', 'DQ9', 'DQ10', 'DQ11', 'DQ12', 'DQ13', 'DQ14', 'DQ15',
    'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'BA0', 'BA1',
    'CLK', 'CKE', 'CS', 'RAS', 'CAS', 'WE', 'LDQM', 'UDQM', 'VDD', 'VDDQ', 'VSS', 'VSSQ'],
  nc: ['40'], prefix: 'U', id: 'pcbjs:TSOP-II-54_22.2x10.16mm_P0.8mm', name: 'SDRAM_TSOP54',
})

// AMS1117 in SOT-223: 1 GND, 2 VOUT and the tab, 3 VIN
export const AMS1117 = withPins(SOT223, ['GND', 'VOUT', 'VIN'])
