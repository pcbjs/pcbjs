// Origin at the module centre, the antenna end at -y.
import { h } from '@pcbjs/core/jsx-runtime'
import { makeFootprint, type GeneratorOptions, type LibFootprint, type PadDef, type PinsOf } from './footprint.js'
import { rect } from './shapes.js'
import { memoised, optsArg } from './gen.js'
import { fetched, outline } from './models.js'

// Espressif's KiCad library, CC-BY-SA 4.0 with the KiCad library exception, at a fixed commit
const C3_MODEL = 'https://raw.githubusercontent.com/espressif/kicad-libraries/dd76561812ab300351234ba6e0ec1295641796f0/3dmodels/espressif.3dshapes/ESP32-C3-MINI-1.STEP'

// from the ESP32-C3-MINI-1 datasheet's Pin Definitions; U0RXD and U0TXD as RXD0 and TXD0
const C3_NAMES: Record<number, string> = {
  1: 'GND', 2: 'GND', 3: '3V3', 5: 'IO2', 6: 'IO3', 8: 'EN', 11: 'GND', 12: 'IO0', 13: 'IO1', 14: 'GND', 16: 'IO10',
  18: 'IO4', 19: 'IO5', 20: 'IO6', 21: 'IO7', 22: 'IO8', 23: 'IO9', 26: 'IO18', 27: 'IO19', 30: 'RXD0', 31: 'TXD0',
}
const c3Name = (n: number) => C3_NAMES[n] ?? (n >= 36 ? 'GND' : 'NC')

type C3Pin = 'GND' | '3V3' | 'EN' | 'IO0' | 'IO1' | 'IO2' | 'IO3' | 'IO4' | 'IO5' | 'IO6' | 'IO7' | 'IO8' | 'IO9' | 'IO10' | 'IO18' | 'IO19' | 'RXD0' | 'TXD0'

export interface ESP32C3Mini1Options<N extends string = string> extends GeneratorOptions<N> {
  /** a hard keepout for tracks, vias and pours on every copper layer under the antenna, default true */
  antennaKeepout?: boolean
}

/** Espressif ESP32-C3-MINI-1, LCSC C2838502 for the -N4; land pattern from Espressif's KiCad library, Espressif.pretty/ESP32-C3-MINI-1.kicad_mod. */
export function ESP32C3Mini1Footprint<const N extends string = never>(opts: ESP32C3Mini1Options<N> = {}): LibFootprint<PinsOf<C3Pin, N>> {
  optsArg('ESP32C3Mini1Footprint', opts, ['antennaKeepout'])
  const { antennaKeepout = true, ...gen } = opts
  return memoised('ESP32C3Mini1', [antennaKeepout, gen], () => {
    const pads: PadDef[] = []
    const side = (n: number, x: number, y: number) => pads.push({ num: String(n), name: c3Name(n), x, y, w: 0.8, h: 0.4, shape: 'rect' })
    const row = (n: number, x: number, y: number) => pads.push({ num: String(n), name: c3Name(n), x, y, w: 0.4, h: 0.8, shape: 'rect' })
    for (let i = 0; i < 11; i++) side(1 + i, -5.9, -1.3 + i * 0.8)
    for (let i = 0; i < 13; i++) row(12 + i, -4.8 + i * 0.8, 7.6)
    for (let i = 0; i < 11; i++) side(25 + i, 5.9, 6.7 - i * 0.8)
    for (let i = 0; i < 13; i++) row(36 + i, 4.8 - i * 0.8, -2.2)
    for (const y of [0.725, 2.7, 4.675]) for (const x of [-1.975, 0, 1.975]) pads.push({ num: '49', name: 'GND', x, y, w: 1.45, h: 1.45, shape: 'rect', thermal: 'solid' })
    for (const [n, x, y] of [[50, 5.95, -2.25], [51, 5.95, 7.65], [52, -5.95, 7.65], [53, -5.95, -2.25]] as const)
      pads.push({ num: String(n), name: 'GND', x, y, w: 0.7, h: 0.7, shape: 'rect' })
    return makeFootprint({
      id: 'pcbjs:ESP32-C3-MINI-1', name: 'ESP32C3Mini1', value: 'ESP32-C3-MINI-1', prefix: 'U', pads,
      pins: ['GND', '3V3', 'EN', 'IO0', 'IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO18', 'IO19', 'RXD0', 'TXD0'],
      body: { cx: 0, cy: 0, w: 13.2, h: 16.6 }, height: 2.4, model: fetched(C3_MODEL, outline(13.2, 16.6, 2.4), [-6.6, -8.37, 0]),
      courtyard: [{ cx: 0, cy: 0, w: 13.6, h: 17.0 }],
      pin1: [-7.0, -1.3],
      extra: [
        h('line', { layer: 'F.Fab', x1: -6.6, y1: -2.9, x2: 6.6, y2: -2.9, width: 0.1 }),
        h('text', { layer: 'F.Fab', at: [0, -5.6], size: 1 }, 'ANT'),
        ...(antennaKeepout ? [h('keepout', { layers: 'all', d: rect(13.2, 5.4, -6.6, -8.3) })] : []), // the datasheet keeps the antenna area free of copper
      ],
    }, gen as GeneratorOptions)
  }) as any
}

/** ESP32-C3-MINI-1 with the antenna keepout and the default pin names; `ESP32C3Mini1Footprint(opts)` for others. */
export const ESP32C3Mini1 = ESP32C3Mini1Footprint()
