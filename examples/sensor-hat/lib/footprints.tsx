// Footprints this HAT needs that @pcbjs/lib does not have, copied pad for pad from the KiCad 9 library so KiCad's 3D models fit them.
// Each is wrapped in defineFootprint so it works as a schematic part. Frames are KiCad's: origin at the footprint centre, y down.
import { defineFootprint, keepout, type FootprintProps } from '@pcbjs/core'
import { smd, courtyard } from '@pcbjs/lib'

// Bosch LGA-8, 2.5 x 2.5 mm, 0.65 mm pitch, clockwise numbering: pins 1 to 4 along the top left to right, 5 to 8 along the bottom right to left.
// KiCad Package_LGA:Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering. BME280 pins: GND CSB SDI SCK SDO VDDIO GND VDD.
const BME280_PINS = ['GND', 'CSB', 'SDI', 'SCK', 'SDO', 'VDDIO', 'GND', 'VDD'] as const
function BME280Footprint(props: FootprintProps) {
  const { children, ...rest } = props
  const xs = [-0.975, -0.325, 0.325, 0.975]
  return (
    <footprint id="hat:Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering" value="BME280" height={0.93} {...rest}>
      {xs.map((x, i) => smd(i + 1, x, -1.025, 0.35, 0.5, { name: BME280_PINS[i], shape: 'rect' }))}
      {xs.map((x, i) => smd(8 - i, x, 1.025, 0.35, 0.5, { name: BME280_PINS[7 - i], shape: 'rect' }))}
      {courtyard(2.82, 3.08)}
      <rect layer="F.Fab" x={-1.25} y={-1.25} w={2.5} h={2.5} />
      <circle layer="F.SilkS" cx={-1.5} cy={-1.6} r={0.12} fill />
      {children}
    </footprint>
  )
}
export const BME280 = defineFootprint(BME280Footprint, { pins: ['GND', 'CSB', 'SDI', 'SCK', 'SDO', 'VDDIO', 'VDD'], prefix: 'U', id: 'hat:Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering', name: 'BME280' })

// ST LGA-16, 3 x 3 mm, 0.5 mm pitch, 5 pads on the left and right, 3 on the top and bottom, counter-clockwise from pin 1 at the top left.
// KiCad Package_LGA:LGA-16_3x3mm_P0.5mm_LayoutBorder3x5y. LIS3DH pins below; NC pins 2 and 3, the ADC inputs unused.
const LIS3DH_PADS = ['VDDIO', 'NC2', 'NC3', 'SCL', 'GND', 'SDA', 'SA0', 'CS', 'INT2', 'RES', 'INT1', 'GND', 'ADC3', 'VDD', 'ADC2', 'ADC1'] as const
function LIS3DHFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  const at: [number, number][] = [
    [-1.225, -1], [-1.225, -0.5], [-1.225, 0], [-1.225, 0.5], [-1.225, 1],
    [-0.5, 1.225], [0, 1.225], [0.5, 1.225],
    [1.225, 1], [1.225, 0.5], [1.225, 0], [1.225, -0.5], [1.225, -1],
    [0.5, -1.225], [0, -1.225], [-0.5, -1.225],
  ]
  return (
    <footprint id="hat:LGA-16_3x3mm_P0.5mm_LayoutBorder3x5y" value="LIS3DH" height={1} {...rest}>
      {at.map(([x, y], i) => {
        const side = Math.abs(x) > 1.2
        const name = LIS3DH_PADS[i]
        return smd(i + 1, x, y, side ? 0.55 : 0.35, side ? 0.35 : 0.55, name.startsWith('NC') ? { nc: true } : { name })
      })}
      {courtyard(3.5, 3.5)}
      <rect layer="F.Fab" x={-1.5} y={-1.5} w={3} h={3} />
      <circle layer="F.SilkS" cx={-1.75} cy={-1.45} r={0.12} fill />
      {children}
    </footprint>
  )
}
export const LIS3DH = defineFootprint(LIS3DHFootprint, { pins: ['VDDIO', 'SCL', 'GND', 'SDA', 'SA0', 'CS', 'INT2', 'RES', 'INT1', 'ADC3', 'VDD', 'ADC2', 'ADC1'], nc: ['2', '3'], prefix: 'U', id: 'hat:LGA-16_3x3mm_P0.5mm_LayoutBorder3x5y', name: 'LIS3DH' })

// Hirose DM3AT-SF-PEJM5 micro SD socket, push-pull, the card mouth toward +y. KiCad Connector_Card:microSD_HC_Hirose_DM3AT-SF-PEJM5.
// Pads 1 to 8 are the card contacts, 9 and 10 the card detect switch, SH the four shell tabs. The keepouts are KiCad's: no F.Cu under the contact springs.
const SD_PADS: [number, string, number][] = [[1, 'DAT2', 2.775], [2, 'DAT3', 1.675], [3, 'CMD', 0.575], [4, 'VDD', -0.525], [5, 'CLK', -1.625], [6, 'VSS', -2.725], [7, 'DAT0', -3.825], [8, 'DAT1', -4.925], [9, 'CD', -5.875]]
function DM3ATFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  const box = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} H ${x2} V ${y2} H ${x1} Z`
  return (
    <footprint id="hat:microSD_HC_Hirose_DM3AT-SF-PEJM5" value="DM3AT-SF-PEJM5" height={1.6} {...rest}>
      {SD_PADS.map(([n, name, x]) => smd(n, x, -7.725, 0.7, 1.2, { name, shape: 'rect' }))}
      {smd(10, -6.825, 2.775, 1, 0.8, { name: 'CDCOM', shape: 'rect' })}
      {smd('SH', -6.825, -3.425, 1, 1.2, { name: 'SHIELD', shape: 'rect' })}
      {smd('SH', -6.825, 6.925, 1, 2.8, { name: 'SHIELD', shape: 'rect' })}
      {smd('SH', 4.325, -7.725, 1, 1.2, { name: 'SHIELD', shape: 'rect' })}
      {smd('SH', 6.675, 7.375, 1.3, 1.9, { name: 'SHIELD', shape: 'rect' })}
      {keepout('F.Cu', box(-7.225, -7.275, -6.475, -4.025))}
      {keepout('F.Cu', box(-7.225, -2.825, -6.475, 0.775))}
      {keepout('F.Cu', box(-6.125, -1.425, -5.425, 6.175))}
      {keepout('F.Cu', box(2.925, 6.975, 5.475, 8.325))}
      {keepout('F.Cu', box(-5.425, -2.725, 3.275, -1.125))}
      <rect layer="F.CrtYd" x={-7.82} y={-8.82} w={15.7} h={17.7} width={0.05} />
      <rect layer="F.Fab" x={-6.9} y={-6.8} w={13.6} h={15.2} />
      {children}
    </footprint>
  )
}
export const DM3AT = defineFootprint(DM3ATFootprint, { pins: ['DAT2', 'DAT3', 'CMD', 'VDD', 'CLK', 'VSS', 'DAT0', 'DAT1', 'CD', 'CDCOM', 'SHIELD'], prefix: 'J', id: 'hat:microSD_HC_Hirose_DM3AT-SF-PEJM5', name: 'DM3AT' })

// Murata PKMCS0909E4000-R1 SMD piezo sounder, 9 x 9 mm, two pads 8.7 mm apart. KiCad Buzzer_Beeper:Buzzer_Murata_PKMCS0909E.
function PKMCSFootprint(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="hat:Buzzer_Murata_PKMCS0909E" value="PKMCS0909E4000-R1" height={1.9} {...rest}>
      {smd(1, -4.35, 0, 1.3, 3.4, { shape: 'rect' })}
      {smd(2, 4.35, 0, 1.3, 3.4, { shape: 'rect' })}
      {courtyard(10.5, 9.5)}
      <rect layer="F.Fab" x={-4.5} y={-4.5} w={9} h={9} />
      <path layer="F.SilkS" d="M -4.6 -2 V -4.6 H 4.6 V -2 M -4.6 2 V 4.6 H 4.6 V 2" />
      <text layer="F.SilkS" at="-5.4 -3.6" size={0.8}>+</text>
      {children}
    </footprint>
  )
}
export const PKMCS0909E = defineFootprint(PKMCSFootprint, { pins: ['1', '2'], prefix: 'BZ', id: 'hat:Buzzer_Murata_PKMCS0909E', name: 'PKMCS0909E' })
