// Pad geometry follows KiCad's *_Metric chip footprints closely, not exactly.
import { h } from '@pcbjs/core/jsx-runtime'
import type { FootprintFactory, FootprintProps, ModelSpec, PcbNode } from '@pcbjs/core/types'
import { defineFootprint } from '@pcbjs/core/schematic'
import { courtyard, smd, withGenerated } from './footprint.js'
import { oneOf, show } from './gen.js'

interface Chip {
  id: string
  pitch: number
  padW: number
  padH: number
  body: [number, number]
  height: number
  names?: [string, string]
  polarity?: boolean
}

const CHIPS: Record<string, Chip> = {
  '0402': { id: '0402_1005Metric', pitch: 0.96, padW: 0.54, padH: 0.64, body: [1.0, 0.5], height: 0.5 },
  '0603': { id: '0603_1608Metric', pitch: 1.65, padW: 0.95, padH: 1.0, body: [1.6, 0.8], height: 0.6 },
  '0805': { id: '0805_2012Metric', pitch: 1.95, padW: 1.05, padH: 1.3, body: [2.0, 1.25], height: 0.6 },
  '1206': { id: '1206_3216Metric', pitch: 3.0, padW: 1.1, padH: 1.65, body: [3.2, 1.6], height: 0.7 },
}

const LED_COLOURS = ['red', 'green', 'blue', 'yellow', 'white', 'amber', 'orange']

// an LED takes its lens colour from a value such as "green"
function chipModel(prefix: 'R' | 'C' | 'LED' | 'L' | 'D', size: '0402' | '0603' | '0805' | '1206', value: unknown, color?: string): ModelSpec {
  if (prefix !== 'LED') return { kind: 'chip', part: prefix, size }
  if (color) return { kind: 'led', size, color }
  const word = String(value ?? '')
    .trim()
    .toLowerCase()
  return LED_COLOURS.includes(word) ? { kind: 'led', size, color: word } : { kind: 'led', size }
}

/** A two-terminal chip footprint: `R0603('330')` makes a part, `<R0603 ref="R1" />` renders. */
export function chip<const N extends string = '1' | '2'>(
  prefix: 'R' | 'C' | 'LED' | 'L' | 'D',
  size: '0402' | '0603' | '0805' | '1206',
  opts: { names?: [N, N]; polarity?: boolean; color?: string } = {},
): FootprintFactory<N | '1' | '2'> {
  oneOf('chip', 'the prefix', prefix, ['R', 'C', 'LED', 'L', 'D'] as const)
  const c = CHIPS[size]
  if (!c) throw new TypeError(`chip: the size must be 0402, 0603, 0805 or 1206, got ${JSON.stringify(size)}`)
  const id = `${prefix === 'LED' ? 'LED' : prefix}_${c.id}`
  const [n1, n2] = opts.names ?? ['1', '2']
  const cw = c.pitch + c.padW + 0.5,
    ch = Math.max(c.padH, c.body[1]) + 0.5
  const render = function Chip(props: FootprintProps): PcbNode {
    const { children, ...rest } = props
    const silkY = c.body[1] / 2 + 0.25
    const silkX = c.pitch / 2 - c.padW / 2 - 0.2
    return h(
      'footprint',
      { id: `pcbjs:${id}`, value: prefix, height: prefix === 'LED' ? 0.8 : c.height, ...rest, ...withGenerated(chipModel(prefix, size, rest.value, opts.color), rest) },
      smd(1, -c.pitch / 2, 0, c.padW, c.padH, { name: n1 }),
      smd(2, c.pitch / 2, 0, c.padW, c.padH, { name: n2 }),
      courtyard(cw, ch),
      h('line', { layer: 'F.SilkS', x1: -silkX, y1: -silkY, x2: silkX, y2: -silkY }),
      h('line', { layer: 'F.SilkS', x1: -silkX, y1: silkY, x2: silkX, y2: silkY }),
      opts.polarity ? h('line', { layer: 'F.SilkS', x1: -c.pitch / 2 - c.padW / 2 - 0.3, y1: -silkY, x2: -c.pitch / 2 - c.padW / 2 - 0.3, y2: silkY, width: 0.15 }) : null,
      h('rect', { layer: 'F.Fab', x: -c.body[0] / 2, y: -c.body[1] / 2, w: c.body[0], h: c.body[1] }),
      children,
    )
  }
  return defineFootprint<N | '1' | '2'>(render, {
    pins: [n1, n2] as N[],
    prefix: prefix === 'LED' ? 'D' : prefix,
    id: `pcbjs:${id}`,
    name: `${prefix}${size}${opts.color ? `_${opts.color}` : ''}`,
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

const leds = new Map<string, FootprintFactory<'K' | 'A' | '1' | '2'>>()
/** A chip LED of a fixed lens colour for the 3D view: `LED('0805', 'red')('KT-0805R')`. */
export function LED(size: '0402' | '0603' | '0805' | '1206' = '0603', color?: string): FootprintFactory<'K' | 'A' | '1' | '2'> {
  oneOf('LED', 'the size', size, ['0402', '0603', '0805', '1206'] as const)
  if (color !== undefined && typeof color !== 'string') throw new TypeError(`LED: the colour, the second argument, must be a word such as 'red', got ${show(color)}`)
  if (!color) {
    if (size === '0603') return LED0603
    if (size === '0805') return LED0805
    if (size === '1206') return LED1206
  }
  const key = `${size}:${color ?? ''}`
  let f = leds.get(key)
  if (!f) {
    f = chip('LED', size, { names: ['K', 'A'], polarity: true, ...(color ? { color: color.toLowerCase() } : {}) })
    leds.set(key, f)
  }
  return f
}
