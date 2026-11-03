// Pad geometry follows KiCad's *_Metric chip footprints closely, not exactly.
import { h } from '@pcbjs/core/jsx-runtime'
import type { PcbNode } from '@pcbjs/core/internal/types'
import { makeFootprint, type LibFootprint, type ModelDef, type PadDef } from './footprint.js'
import { oneOf } from './gen.js'

interface Chip {
  id: string
  pitch: number
  padW: number
  padH: number
  /** length along the pads and width */
  body: [number, number]
  /** end cap length */
  cap: number
  height: number
}

const CHIPS: Record<string, Chip> = {
  '0402': { id: '0402_1005Metric', pitch: 0.96, padW: 0.54, padH: 0.64, body: [1.0, 0.5], cap: 0.25, height: 0.5 },
  '0603': { id: '0603_1608Metric', pitch: 1.65, padW: 0.95, padH: 1.0, body: [1.6, 0.8], cap: 0.3, height: 0.6 },
  '0805': { id: '0805_2012Metric', pitch: 1.95, padW: 1.05, padH: 1.3, body: [2.0, 1.25], cap: 0.4, height: 0.6 },
  '1206': { id: '1206_3216Metric', pitch: 3.0, padW: 1.1, padH: 1.65, body: [3.2, 1.6], cap: 0.5, height: 0.7 },
}
const LED_HEIGHT = 0.8

// an LED's lens colour is the `color` option of chip(); the value is a BOM field
function chipModel(prefix: 'R' | 'C' | 'LED' | 'L' | 'D', cap: number, color?: string): ModelDef {
  if (prefix !== 'LED') return { kind: 'chip', part: prefix, cap }
  return color ? { kind: 'led', cap, color } : { kind: 'led', cap }
}

/** The two silk lines along the body, and the cathode bar of a polarised part. */
function chipSilk(c: Chip, polarity: boolean): PcbNode[] {
  const silkY = c.body[1] / 2 + 0.25
  const silkX = c.pitch / 2 - c.padW / 2 - 0.2
  const bar = -c.pitch / 2 - c.padW / 2 - 0.3
  return [
    h('line', { layer: 'F.SilkS', x1: -silkX, y1: -silkY, x2: silkX, y2: -silkY }),
    h('line', { layer: 'F.SilkS', x1: -silkX, y1: silkY, x2: silkX, y2: silkY }),
    ...(polarity ? [h('line', { layer: 'F.SilkS', x1: bar, y1: -silkY, x2: bar, y2: silkY, width: 0.15 })] : []),
  ]
}

/** A two-terminal chip footprint: `R0603('330')` makes a part. */
export function chip<const N extends string = '1' | '2'>(
  prefix: 'R' | 'C' | 'LED' | 'L' | 'D',
  size: '0402' | '0603' | '0805' | '1206',
  opts: { names?: [N, N]; polarity?: boolean; color?: string } = {},
): LibFootprint<N | '1' | '2'> {
  oneOf('chip', 'the prefix', prefix, ['R', 'C', 'LED', 'L', 'D'] as const)
  const c = CHIPS[size]
  if (!c) throw new TypeError(`chip: the size must be 0402, 0603, 0805 or 1206, got ${JSON.stringify(size)}`)
  const [n1, n2] = opts.names ?? ['1', '2']
  const pads: PadDef[] = [
    { num: '1', name: n1, x: -c.pitch / 2, y: 0, w: c.padW, h: c.padH },
    { num: '2', name: n2, x: c.pitch / 2, y: 0, w: c.padW, h: c.padH },
  ]
  return makeFootprint({
    id: `pcbjs:${prefix}_${c.id}`,
    name: `${prefix}${size}${opts.color ? `_${opts.color}` : ''}`,
    value: prefix,
    prefix: prefix === 'LED' ? 'D' : prefix,
    pads,
    body: { cx: 0, cy: 0, w: c.body[0], h: c.body[1] },
    height: prefix === 'LED' ? LED_HEIGHT : c.height,
    model: chipModel(prefix, c.cap, opts.color),
    courtyard: [{ cx: 0, cy: 0, w: c.pitch + c.padW + 0.5, h: Math.max(c.padH, c.body[1]) + 0.5 }],
    silk: chipSilk(c, !!opts.polarity),
    pin1: false,
  })
}

export const R0402 = chip('R', '0402')
export const R0603 = chip('R', '0603')
export const R0805 = chip('R', '0805')
export const R1206 = chip('R', '1206')
export const C0402 = chip('C', '0402')
export const C0603 = chip('C', '0603')
export const C0805 = chip('C', '0805')
export const C1206 = chip('C', '1206')
// pad 1 the cathode K under the silk bar, pad 2 the anode A, as KiCad's LED_0603
export const LED0603 = chip('LED', '0603', { names: ['K', 'A'], polarity: true })
export const LED0805 = chip('LED', '0805', { names: ['K', 'A'], polarity: true })
export const LED1206 = chip('LED', '1206', { names: ['K', 'A'], polarity: true })
