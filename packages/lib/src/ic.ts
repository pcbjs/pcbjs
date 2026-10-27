// Land patterns follow the KiCad 9 library, IPC-7351 nominal density; pins are numbered as the JEDEC outline does.
import type { ModelSpec } from '@pcbjs/core/types'
import { makeFootprint, r4, type FootprintDef, type GeneratorOptions, type LibFootprint, type PadDef, type PinsOf } from './footprint.js'
import { intArg, memoised, mmArg, oneOf, optsArg, show, sizeArg } from './gen.js'

const BLACK = '#262626'
const box = (w: number, h: number, height: number): ModelSpec => ({ kind: 'ic', w, h, height, color: BLACK })

// pins 1 to n/2 down the left at x = -span/2, the rest up the right
function dualRow(n: number, pitch: number, span: number, l: number, w: number): PadDef[] {
  const half = n / 2, pads: PadDef[] = []
  for (let i = 0; i < n; i++) {
    const left = i < half, k = left ? i : n - 1 - i
    const y = r4((k - (half - 1) / 2) * pitch)
    pads.push({ num: String(i + 1), name: String(i + 1), x: r4((left ? -1 : 1) * span / 2), y, w: l, h: w })
  }
  return pads
}

// n/4 per side, counter-clockwise from pin 1 at the top of the left side, centres at ±c
function quad(n: number, pitch: number, c: number, l: number, w: number): PadDef[] {
  const side = n / 4, pads: PadDef[] = []
  for (let k = 0; k < n; k++) {
    const s = Math.floor(k / side), i = k % side
    const off = r4((i - (side - 1) / 2) * pitch)
    const num = String(k + 1)
    if (s === 0) pads.push({ num, name: num, x: -c, y: off, w: l, h: w })
    else if (s === 1) pads.push({ num, name: num, x: off, y: c, w, h: l })
    else if (s === 2) pads.push({ num, name: num, x: c, y: -off, w: l, h: w })
    else pads.push({ num, name: num, x: -off, y: -c, w, h: l })
  }
  return pads
}

export interface ExposedPadOptions {
  /** an n by n grid of thermal vias in the exposed pad, 0.3 mm drill in 0.7 mm copper at 1 mm pitch; default none */
  vias?: number
}

// pad number n + 1, pin EP, joined solidly to a pour like a heat slug
function exposedPad(n: number, ep: number | [number, number], gen: string, o: ExposedPadOptions): PadDef[] {
  const [w, h] = typeof ep === 'number' ? [ep, ep] : ep
  const num = String(n + 1)
  const out: PadDef[] = [{ num, name: 'EP', x: 0, y: 0, w, h, shape: 'rect', thermal: 'solid' }]
  const v = o.vias ?? 0
  if (v > 0) {
    const pitch = 1.0, span = (v - 1) * pitch + 0.7
    if (span > Math.min(w, h) + 1e-9) throw new RangeError(`${gen}: ${v} x ${v} thermal vias at 1 mm pitch need an exposed pad of ${r4(span)} mm, this one is ${w} x ${h}`)
    for (let i = 0; i < v; i++)
      for (let j = 0; j < v; j++)
        out.push({ num, name: 'EP', x: r4((i - (v - 1) / 2) * pitch), y: r4((j - (v - 1) / 2) * pitch), w: 0.7, h: 0.7, shape: 'circle', drill: 0.3, paste: false, thermal: 'solid' })
  }
  return out
}

export interface SOT23Options<N extends string = string> extends GeneratorOptions<N> {}

type Num = `${number}`

/** SOT-23 with 3, 5 or 6 pins, as KiCad SOT-23, SOT-23-5, SOT-23-6; prefix Q for 3 pins, else U. */
export function SOT23<const N extends string = never>(pins: 3 | 5 | 6, opts: SOT23Options<N> = {}): LibFootprint<PinsOf<Num, N>> {
  oneOf('SOT23', 'the pin count', pins, [3, 5, 6] as const)
  optsArg('SOT23', opts, [], 'the second argument, the options,')
  return memoised('SOT23', [pins, opts], () => {
    let pads: PadDef[], body: { w: number; h: number }, model: ModelSpec
    if (pins === 3) {
      pads = [
        { num: '1', name: '1', x: -0.9375, y: -0.95, w: 1.475, h: 0.6 },
        { num: '2', name: '2', x: -0.9375, y: 0.95, w: 1.475, h: 0.6 },
        { num: '3', name: '3', x: 0.9375, y: 0, w: 1.475, h: 0.6 },
      ]
      body = { w: 1.3, h: 2.9 }
      model = { kind: 'sot23', pins: 3 }
    } else {
      pads = dualRow(6, 0.95, 2.275, 1.325, 0.6)
      if (pins === 5) pads = [...pads.slice(0, 3), { ...pads[3], num: '4', name: '4' }, { ...pads[5], num: '5', name: '5' }]
      body = { w: 1.6, h: 2.9 }
      model = { kind: 'sot23', pins }
    }
    const def: FootprintDef = {
      id: `pcbjs:SOT-23${pins === 3 ? '' : `-${pins}`}`, name: `SOT23_${pins}`, value: `SOT-23${pins === 3 ? '' : `-${pins}`}`,
      prefix: pins === 3 ? 'Q' : 'U', pads, body: { cx: 0, cy: 0, ...body }, height: 1.1, model,
    }
    return makeFootprint<any>(def, opts)
  })
}

/** SOT-223 as KiCad SOT-223-3_TabPin2: the tab is pad 4 on pin 2, as on the AMS1117 and most LDOs. */
export const SOT223 = makeFootprint<Num>({
  id: 'pcbjs:SOT-223-3_TabPin2', name: 'SOT223', value: 'SOT-223', prefix: 'U',
  pads: [
    { num: '1', name: '1', x: -3.15, y: -2.3, w: 2, h: 1.5 },
    { num: '2', name: '2', x: -3.15, y: 0, w: 2, h: 1.5 },
    { num: '3', name: '3', x: -3.15, y: 2.3, w: 2, h: 1.5 },
    { num: '4', name: '2', x: 3.15, y: 0, w: 2, h: 3.8 },
  ],
  pins: ['1', '2', '3'],
  body: { cx: 0, cy: 0, w: 3.5, h: 6.5 }, height: 1.8, model: box(3.5, 6.5, 1.8),
})

const SOIC_N_LEN: Record<number, number> = { 8: 4.9, 14: 8.65, 16: 9.9 }
const SOIC_W_LEN: Record<number, number> = { 8: 5.3, 14: 9.0, 16: 10.3, 18: 11.55, 20: 12.8, 24: 15.4, 28: 17.9 }

/** SOIC, 1.27 mm pitch: "N" the 3.9 mm narrow body, "W" the 7.5 mm wide body. */
export function SOIC<const N extends string = never>(pins: number, width: 'N' | 'W' = 'N', opts: GeneratorOptions<N> = {}): LibFootprint<PinsOf<Num, N>> {
  evenPins('SOIC', pins, 4, 32)
  oneOf('SOIC', 'the width', width, ['N', 'W'] as const)
  optsArg('SOIC', opts, [], 'the third argument, the options,')
  return memoised('SOIC', [pins, width, opts], () => {
    const wide = width === 'W'
    const bw = wide ? 7.5 : 3.9, bl = (wide ? SOIC_W_LEN : SOIC_N_LEN)[pins] ?? r4((pins / 2) * 1.27 - 0.2)
    const height = wide ? 2.65 : 1.75
    return makeFootprint({
      id: `pcbjs:SOIC-${pins}${wide ? 'W' : ''}_${bw}x${bl}mm_P1.27mm`, name: `SOIC${pins}${wide ? 'W' : ''}`, value: `SOIC-${pins}${wide ? 'W' : ''}`, prefix: 'U',
      pads: dualRow(pins, 1.27, wide ? 9.3 : 4.95, wide ? 2.05 : 1.95, 0.6),
      body: { cx: 0, cy: 0, w: bw, h: bl }, height, model: box(bw, bl, height),
    }, opts as GeneratorOptions)
  }) as any
}

const TSSOP_LEN: Record<number, number> = { 8: 3.0, 14: 5.0, 16: 5.0, 20: 6.5, 24: 7.8, 28: 9.7 }

/** TSSOP, 0.65 mm pitch, 4.4 mm body (KiCad TSSOP-*_4.4x*mm_P0.65mm). */
export function TSSOP<const N extends string = never>(pins: number, opts: GeneratorOptions<N> = {}): LibFootprint<PinsOf<Num, N>> {
  evenPins('TSSOP', pins, 8, 64)
  optsArg('TSSOP', opts, [], 'the second argument, the options,')
  return memoised('TSSOP', [pins, opts], () => {
    const bl = TSSOP_LEN[pins] ?? r4((pins / 2) * 0.65 + 0.3)
    return makeFootprint({
      id: `pcbjs:TSSOP-${pins}_4.4x${bl}mm_P0.65mm`, name: `TSSOP${pins}`, value: `TSSOP-${pins}`, prefix: 'U',
      pads: dualRow(pins, 0.65, 5.725, 1.475, 0.4),
      body: { cx: 0, cy: 0, w: 4.4, h: bl }, height: 1.2, model: box(4.4, bl, 1.2),
    }, opts as GeneratorOptions)
  }) as any
}

export interface QFNOptions<N extends string = string> extends GeneratorOptions<N>, ExposedPadOptions {
  /** the pad length across the edge and width along it; default from the KiCad QFN patterns for the body size and pitch */
  pad?: { l: number; w: number }
  /** body height, default 0.9 */
  height?: number
}

/** QFN, square body `size` mm, `pins` / 4 pads per side; `ep` adds the exposed pad, pad pins + 1 named EP. */
export function QFN<const N extends string = never>(pins: number, size: number, pitch: number, ep?: number | [number, number], opts: QFNOptions<N> = {}): LibFootprint<PinsOf<Num | 'EP', N>> {
  quadPins('QFN', pins, size, pitch)
  if (ep !== undefined) sizeArg('QFN', 'ep, the fourth argument and the exposed pad,', ep, `; leave it undefined for no exposed pad and pass options fifth, QFN(${pins}, ${size}, ${pitch}, 3.45, { vias: 3 })`)
  optsArg('QFN', opts, ['pad', 'height', 'vias'], 'the fifth argument, the options,')
  if (opts.pad !== undefined) { mmArg('QFN', 'pad.l, the pad length', opts.pad?.l); mmArg('QFN', 'pad.w, the pad width', opts.pad?.w) }
  if (opts.height !== undefined) mmArg('QFN', 'height', opts.height)
  if (opts.vias !== undefined) intArg('QFN', 'vias, the thermal via grid', opts.vias, 0, 10)
  return memoised('QFN', [pins, size, pitch, ep ?? null, opts], () => {
    const l = opts.pad?.l ?? (size <= 3 ? 0.775 : 0.875)
    const w = opts.pad?.w ?? Math.min(0.4, r4(pitch / 2))
    const outer = size / 2 + (size <= 3 ? 0.35 : 0.375)
    const pads = quad(pins, pitch, r4(outer - l / 2), l, w)
    if (ep !== undefined) pads.push(...exposedPad(pins, ep, 'QFN', opts))
    const epName = ep === undefined ? '' : `-1EP`
    const height = opts.height ?? 0.9
    return makeFootprint({
      id: `pcbjs:QFN-${pins}${epName}_${size}x${size}mm_P${pitch}mm`, name: `QFN${pins}`, value: `QFN-${pins}`, prefix: 'U',
      pads, body: { cx: 0, cy: 0, w: size, h: size }, height, model: box(size, size, height),
    }, opts as GeneratorOptions)
  }) as any
}

/** LQFP pad rows by body size and pitch: pad centre from the body centre, pad length and width (KiCad Package_QFP). */
const LQFP_PADS: Record<string, { c: number; l: number; w: number }> = {
  '7/0.5': { c: 4.1625, l: 1.475, w: 0.3 },
  '7/0.8': { c: 4.175, l: 1.5, w: 0.5 },
  '10/0.5': { c: 5.675, l: 1.55, w: 0.3 },
  '10/0.65': { c: 5.675, l: 1.55, w: 0.4 },
  '14/0.5': { c: 7.675, l: 1.55, w: 0.3 },
  '20/0.5': { c: 10.675, l: 1.55, w: 0.3 },
}

export interface LQFPOptions<N extends string = string> extends GeneratorOptions<N>, ExposedPadOptions {
  /** an exposed pad on the underside, pad number pins + 1, pin EP; default none */
  ep?: number | [number, number]
}

/** LQFP, square body `size` mm, `pins` / 4 leads per side at `pitch`, as KiCad LQFP-48_7x7mm_P0.5mm and kin. */
export function LQFP<const N extends string = never>(pins: number, size: number, pitch: number, opts: LQFPOptions<N> = {}): LibFootprint<PinsOf<Num | 'EP', N>> {
  quadPins('LQFP', pins, size, pitch)
  optsArg('LQFP', opts, ['ep', 'vias'], 'the fourth argument, the options,')
  if (opts.ep !== undefined) sizeArg('LQFP', 'ep, the exposed pad,', opts.ep)
  if (opts.vias !== undefined) intArg('LQFP', 'vias, the thermal via grid', opts.vias, 0, 10)
  return memoised('LQFP', [pins, size, pitch, opts], () => {
    const t = LQFP_PADS[`${size}/${pitch}`] ?? { c: r4(size / 2 + (size >= 10 ? 0.675 : 0.6625)), l: size >= 10 ? 1.55 : 1.475, w: pitch >= 0.8 ? 0.5 : pitch >= 0.65 ? 0.4 : pitch >= 0.5 ? 0.3 : 0.2 }
    const pads = quad(pins, pitch, t.c, t.l, t.w)
    if (opts.ep !== undefined) pads.push(...exposedPad(pins, opts.ep, 'LQFP', opts))
    return makeFootprint({
      id: `pcbjs:LQFP-${pins}_${size}x${size}mm_P${pitch}mm`, name: `LQFP${pins}`, value: `LQFP-${pins}`, prefix: 'U',
      pads, body: { cx: 0, cy: 0, w: size, h: size }, height: 1.6, model: box(size, size, 1.6),
    }, opts as GeneratorOptions)
  }) as any
}

function evenPins(gen: string, pins: number, min: number, max: number): void {
  if (typeof pins !== 'number' || !Number.isInteger(pins) || pins % 2 || pins < min || pins > max) throw new RangeError(`${gen}: the pin count, the first argument, must be even, ${min} to ${max}, got ${show(pins)}`)
}

function quadPins(gen: string, pins: number, size: number, pitch: number): void {
  if (typeof pins !== 'number' || !Number.isInteger(pins) || pins % 4 || pins < 8) throw new RangeError(`${gen}: the pin count, the first argument, must be a multiple of 4, at least 8, got ${show(pins)}`)
  mmArg(gen, 'size, the second argument and the body side,', size)
  mmArg(gen, 'pitch, the third argument,', pitch)
  if ((pins / 4 - 1) * pitch + pitch / 2 > size) throw new RangeError(`${gen}: ${pins / 4} pads at ${pitch} mm pitch do not fit a ${size} mm side`)
}
