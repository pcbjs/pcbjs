// Land patterns follow the KiCad 9 library: Connector_USB, Connector_JST, Connector_PinSocket_2.54mm, MountingHole.
import { h } from '@pcbjs/core/jsx-runtime'
import type { ModelSpec, Part } from '@pcbjs/core/types'
import { makeFootprint, padGridDefs, padRowDefs, r4, silkOutline, type FootprintDef, type GeneratorOptions, type LibFootprint, type PadDef, type PinsOf } from './footprint.js'
import { connectorCall, memoised, mmArg, oneOf, optsArg, padArgs, show, type ConnectorOptions, type HoleOptions } from './gen.js'
import { fetched, kicad3d, outline } from './models.js'

export type { ConnectorOptions, HoleOptions } from './gen.js'

const NONE: ModelSpec = { kind: 'none' }
type Num = `${number}`
type USBPins<T> = T extends 'power6' ? 'GND' | 'VBUS' | 'CC1' | 'CC2' | 'SHIELD' : 'GND' | 'VBUS' | 'CC1' | 'CC2' | 'DP' | 'DN' | 'SBU1' | 'SBU2' | 'SHIELD'
/** The pad numbers of a USB-C receptacle, for `J1['B6']`: the contacts it has pads for and the shell tabs S1 to S4. */
type USBPads<T> = `S${1 | 2 | 3 | 4}` | (T extends 'power6' ? `A${5 | 9 | 12}` | `B${5 | 9 | 12}` : `A${1 | 4 | 5 | 6 | 7 | 8}` | `B${1 | 4 | 5 | 6 | 7 | 8}`)

/** HRO TYPE-C-31-M-12 signal row, x and width, from KiCad USB_C_Receptacle_HRO_TYPE-C-31-M-12; A1 also stands for B12 and so on. */
const USB16: [string, string, number, number][] = [
  ['A1', 'GND', -3.25, 0.6],
  ['A4', 'VBUS', -2.45, 0.6],
  ['B8', 'SBU2', -1.75, 0.3],
  ['A5', 'CC1', -1.25, 0.3],
  ['B7', 'DN', -0.75, 0.3],
  ['A6', 'DP', -0.25, 0.3],
  ['A7', 'DN', 0.25, 0.3],
  ['B6', 'DP', 0.75, 0.3],
  ['A8', 'SBU1', 1.25, 0.3],
  ['B5', 'CC2', 1.75, 0.3],
  ['B4', 'VBUS', 2.45, 0.6],
  ['B1', 'GND', 3.25, 0.6],
]
/** HRO TYPE-C-31-M-17 power-only row, from KiCad USB_C_Receptacle_HRO_TYPE-C-31-M-17. */
const USB6: [string, string, number, number][] = [
  ['B12', 'GND', -2.75, 0.9],
  ['B9', 'VBUS', -1.52, 0.8],
  ['A5', 'CC1', -0.5, 0.7],
  ['B5', 'CC2', 0.5, 0.7],
  ['A9', 'VBUS', 1.52, 0.8],
  ['A12', 'GND', 2.75, 0.9],
]

type USBType = 'power6' | 'full16'

function usbFootprint<const T extends USBType = 'full16', const N extends string = never>(
  type: T = 'full16' as T,
  opts: GeneratorOptions<N> = {},
): LibFootprint<PinsOf<USBPins<T>, N>, USBPads<T>> {
  oneOf('USBC', 'the type', type, ['power6', 'full16'] as const)
  optsArg('USBC', opts, [], 'the options')
  return memoised('USBC', [type, opts.pinNames ?? null, opts.prefix ?? null, opts.value ?? null, opts.silk ?? null], () => {
    const full = type === 'full16'
    const row = full ? USB16 : USB6
    const y = full ? -4.045 : -3.18,
      ph = full ? 1.45 : 1.6
    const pads: PadDef[] = row.map(([num, name, x, w]) => ({ num, name, x, y, w, h: ph }))
    const shell: [number, number, number, number][] = full
      ? [
          [-4.32, -3.13, 2.1, 1.7],
          [4.32, -3.13, 2.1, 1.7],
          [-4.32, 1.05, 1.6, 1.2],
          [4.32, 1.05, 1.6, 1.2],
        ]
      : [
          [-4.32, -3.0, 1.7, 1.2],
          [4.32, -3.0, 1.7, 1.2],
          [-4.32, 0.8, 1.7, 1.2],
          [4.32, 0.8, 1.7, 1.2],
        ]
    const dw = full ? 0.6 : 0.5
    shell.forEach(([x, sy, len, dl], i) => pads.push({ num: `S${i + 1}`, name: 'SHIELD', x, y: sy, w: 1.0, h: len, shape: 'oval', drill: [dw, dl] }))
    if (full) for (const x of [-2.89, 2.89]) pads.push({ num: '', name: '', x, y: -2.6, w: 0.65, h: 0.65, shape: 'circle', drill: 0.65, type: 'npth' })
    const bh = full ? 7.3 : 6.8
    const def: FootprintDef = {
      id: full ? 'pcbjs:USB_C_Receptacle_HRO_TYPE-C-31-M-12' : 'pcbjs:USB_C_Receptacle_HRO_TYPE-C-31-M-17',
      name: full ? 'USBC_16P' : 'USBC_6P',
      value: full ? 'TYPE-C-31-M-12' : 'TYPE-C-31-M-17',
      prefix: 'J',
      pads,
      pins: full ? ['GND', 'VBUS', 'CC1', 'CC2', 'DP', 'DN', 'SBU1', 'SBU2', 'SHIELD'] : ['GND', 'VBUS', 'CC1', 'CC2', 'SHIELD'],
      body: { cx: 0, cy: 0, w: 8.94, h: bh },
      height: 3.26,
      model: fetched(full ? 'lcsc:C165948' : 'lcsc:C283540', outline(8.94, bh, 3.26), [0, full ? -1.06 : -0.8, 0], [0, 0, 180]),
      courtyard: full ? [{ cx: 0, cy: -0.56, w: 10.64, h: 9.42 }] : [{ cx: 0, cy: -0.29, w: 10.64, h: 8.38 }],
      // the open sides stop 1.5 mm short of the mouth so the outline stays on the board when the mouth overhangs
      silk: mode =>
        [mode === 'open' ? silkOutline(8.94, bh - 1.5, { cy: -0.75, pads, edges: ['top', 'left', 'right'] }) : silkOutline(8.94, bh, { pads })].filter(
          (n): n is NonNullable<typeof n> => n !== null,
        ),
      mouth: 'bottom',
      pin1: false,
    }
    return makeFootprint(def, opts as GeneratorOptions)
  }) as any
}

/** A USB-C receptacle part: "full16" the HRO TYPE-C-31-M-12 (LCSC C165948), "power6" the HRO TYPE-C-31-M-17 (LCSC C283540). */
export interface USBCGenerator {
  <const T extends USBType = 'full16', const N extends string = never>(type?: T, opts?: string | number | ConnectorOptions<N>): Part<PinsOf<USBPins<T>, N>, USBPads<T>>
  <const N extends string = never>(opts: ConnectorOptions<N>): Part<PinsOf<USBPins<'full16'>, N>, USBPads<'full16'>>
  /** the footprint factory: `USBC.footprint('power6')('TYPE-C-31-M-17')` makes a part, `<J ref="J1" at="…" />` places one */
  footprint<const T extends USBType = 'full16', const N extends string = never>(type?: T, opts?: GeneratorOptions<N>): LibFootprint<PinsOf<USBPins<T>, N>, USBPads<T>>
}
export const USBC: USBCGenerator = Object.assign(
  function USBC(type?: unknown, opts?: unknown) {
    if (type !== null && typeof type === 'object') {
      opts = type
      type = undefined
    }
    if (type !== undefined && type !== 'power6' && type !== 'full16')
      throw new TypeError(`USBC: the type must be "power6", "full16", got ${show(type)}; the value goes after it, USBC('full16', 'TYPE-C-31-M-12')`)
    const { gen, part } = connectorCall('USBC', opts, [], 'the second argument')
    return call(usbFootprint(type as USBType | undefined, gen), part)
  },
  { footprint: usbFootprint },
) as any

const call = (f: unknown, part: unknown) => (part === undefined ? (f as () => unknown)() : (f as (p: unknown) => unknown)(part))

/** Drill and pad options of the JST and header families: `drill` in mm, `pad` a diameter or [w, h] in footprint axes. */
export type JSTOptions = HoleOptions

type JSTEntry = 'top' | 'side'

function phFootprint<const N extends string = never>(
  pins: number,
  entry: JSTEntry | (JSTOptions & GeneratorOptions<N>) = 'top',
  opts: JSTOptions & GeneratorOptions<N> = {},
): LibFootprint<PinsOf<Num, N>> {
  if (entry !== null && typeof entry === 'object') {
    opts = entry
    entry = 'top'
  }
  countOf('JST_PH', pins, 2, 16)
  oneOf('JST_PH', 'the entry', entry, ['top', 'side'] as const)
  optsArg('JST_PH', opts, ['drill', 'pad'], 'the options')
  const { drill, pad, ...gen } = opts
  // JST PH: 0.75 mm holes in 1.2 x 1.75 mm oval pads, the KiCad library's land pattern for JST's 0.7 mm recommended hole
  const hole = padArgs('JST_PH', drill, pad, 0.75, [1.2, 1.75])
  return memoised('JST_PH', [pins, entry, hole.drill, hole.size, gen.pinNames ?? null, gen.prefix ?? null, gen.value ?? null, gen.silk ?? null], () => {
    const pads = padRowDefs(pins, 2.0, { size: hole.size, drill: hole.drill, shape: 'oval', firstShape: 'roundrect' })
    const w = (pins - 1) * 2 + 3.9
    const top = entry === 'top'
    const body = top ? { cx: 0, cy: 0.55, w, h: 4.5 } : { cx: 0, cy: 2.45, w, h: 7.6 }
    const height = top ? 6.0 : 4.8
    const part = `${top ? 'B' : 'S'}${pins}B-PH-K`
    return makeFootprint(
      {
        id: `pcbjs:JST_PH_${part}_1x${String(pins).padStart(2, '0')}_P2.00mm_${top ? 'Vertical' : 'Horizontal'}${hole.suffix}`,
        name: `JST_PH_${pins}`,
        value: part,
        prefix: 'J',
        pads,
        body,
        height,
        model: kicad3d(
          `Connector_JST.3dshapes/JST_PH_${part}_1x${String(pins).padStart(2, '0')}_P2.00mm_${top ? 'Vertical' : 'Horizontal'}.step`,
          outline(body.w, body.h, height),
          [-(pins - 1), 0, 0],
        ),
        courtyard: [{ cx: 0, cy: body.cy, w: r4(w + 1.0), h: r4(body.h + 1.0) }],
        // the side entry mates on the body edge away from the pins, normally flush with the board edge
        ...(top ? {} : { mouth: 'bottom' as const }),
      },
      gen as GeneratorOptions,
    )
  }) as any
}

/** JST PH, 2.0 mm pitch, through-hole part: "top" the vertical B<n>B-PH-K, "side" the right-angle S<n>B-PH-K. */
export interface JSTPHGenerator {
  <const N extends string = never>(pins: number, entry?: JSTEntry, opts?: string | number | ConnectorOptions<N, JSTOptions>): Part<PinsOf<Num, N>>
  <const N extends string = never>(pins: number, opts: string | number | ConnectorOptions<N, JSTOptions>): Part<PinsOf<Num, N>>
  footprint<const N extends string = never>(pins: number, entry?: JSTEntry, opts?: JSTOptions & GeneratorOptions<N>): LibFootprint<PinsOf<Num, N>>
}
export const JST_PH: JSTPHGenerator = Object.assign(
  function JST_PH(pins: number, entry?: unknown, opts?: unknown) {
    // the entry may be left out before the value or options: JST_PH(2, { drill: 0.8 })
    if (opts === undefined && entry !== null && (typeof entry === 'object' || typeof entry === 'number')) {
      opts = entry
      entry = undefined
    }
    const { gen, part } = connectorCall('JST_PH', opts, ['drill', 'pad'], 'the options')
    return call(phFootprint(pins, (entry ?? 'top') as JSTEntry, gen), part)
  },
  { footprint: phFootprint },
) as any

function xhFootprint<const N extends string = never>(pins: number, opts: JSTOptions & GeneratorOptions<N> = {}): LibFootprint<PinsOf<Num, N>> {
  countOf('JST_XH', pins, 2, 16)
  optsArg('JST_XH', opts, ['drill', 'pad'], 'the options')
  const { drill, pad, ...gen } = opts
  // JST XH: 0.95 mm holes in 1.7 x 1.95 mm oval pads, the KiCad library's land pattern for JST's 0.9 mm recommended hole
  const hole = padArgs('JST_XH', drill, pad, 0.95, [1.7, 1.95])
  return memoised('JST_XH', [pins, hole.drill, hole.size, gen.pinNames ?? null, gen.prefix ?? null, gen.value ?? null, gen.silk ?? null], () => {
    const pads = padRowDefs(pins, 2.5, { size: hole.size, drill: hole.drill, shape: 'oval', firstShape: 'roundrect' })
    const w = (pins - 1) * 2.5 + 4.9
    const body = { cx: 0, cy: 0.525, w, h: 5.75 }
    const part = `B${pins}B-XH-A`
    return makeFootprint(
      {
        id: `pcbjs:JST_XH_${part}_1x${String(pins).padStart(2, '0')}_P2.50mm_Vertical${hole.suffix}`,
        name: `JST_XH_${pins}`,
        value: part,
        prefix: 'J',
        pads,
        body,
        height: 7.0,
        model: kicad3d(`Connector_JST.3dshapes/JST_XH_${part}_1x${String(pins).padStart(2, '0')}_P2.50mm_Vertical.step`, outline(body.w, body.h, 7.0), [
          r4(-(pins - 1) * 1.25),
          0,
          0,
        ]),
        courtyard: [{ cx: 0, cy: body.cy, w: r4(w + 1.0), h: r4(body.h + 1.0) }],
      },
      gen as GeneratorOptions,
    )
  }) as any
}

/** JST XH, 2.5 mm pitch, vertical through-hole B<n>B-XH-A part. */
export interface JSTXHGenerator {
  <const N extends string = never>(pins: number, opts?: string | number | ConnectorOptions<N, JSTOptions>): Part<PinsOf<Num, N>>
  footprint<const N extends string = never>(pins: number, opts?: JSTOptions & GeneratorOptions<N>): LibFootprint<PinsOf<Num, N>>
}
export const JST_XH: JSTXHGenerator = Object.assign(
  function JST_XH(pins: number, opts?: unknown) {
    const { gen, part } = connectorCall('JST_XH', opts, ['drill', 'pad'], 'the second argument')
    return call(xhFootprint(pins, gen), part)
  },
  { footprint: xhFootprint },
) as any

export interface PinSocketOptions extends HoleOptions {
  rows?: 1 | 2
}

function socketFootprint<const N extends string = never>(pins: number, opts: PinSocketOptions & GeneratorOptions<N> = {}): LibFootprint<PinsOf<Num, N>> {
  countOf('PinSocket', pins, 1, 40)
  optsArg('PinSocket', opts, ['rows', 'drill', 'pad'], 'the options')
  const { rows = 1, drill, pad, ...gen } = opts
  oneOf('PinSocket', 'rows', rows, [1, 2] as const)
  // 1.7 mm pads on a 1.0 mm drill, as KiCad's Connector_PinSocket_2.54mm
  const hole = padArgs('PinSocket', drill, pad, 1.0, [1.7, 1.7])
  return memoised('PinSocket', [pins, rows, hole.drill, hole.size, gen.pinNames ?? null, gen.prefix ?? null, gen.value ?? null, gen.silk ?? null], () => {
    const pads = padGridDefs(rows, pins, 2.54, {
      size: hole.size,
      drill: hole.drill,
      ...(hole.size[0] !== hole.size[1] ? { shape: 'oval' as const } : {}),
      firstShape: 'rect',
      at: [(rows - 1) * 1.27, (pins - 1) * 1.27],
    })
    const body = { cx: (rows - 1) * 1.27, cy: r4((pins - 1) * 1.27), w: rows * 2.54, h: r4(pins * 2.54) }
    const name = `PinSocket_${rows}x${String(pins).padStart(2, '0')}_P2.54mm_Vertical`
    return makeFootprint(
      {
        id: `pcbjs:${name}${hole.suffix}`,
        name: `PinSocket_${rows}x${pins}`,
        value: `Conn_${rows < 2 ? '01' : '02'}x${String(pins).padStart(2, '0')}_Socket`,
        prefix: 'J',
        pads,
        body,
        height: 8.5,
        model: socketModel(rows, pins, outline(body.w, body.h, 8.5)),
        courtyard: [{ ...body, w: body.w + 1.0, h: r4(body.h + 1.0) }],
      },
      gen as GeneratorOptions,
    )
  }) as any
}

// KiCad puts the second row at -x, pcbjs at +x: the double row turns half round about pin 1 and moves back down the column
function socketModel(rows: number, pins: number, box: ReturnType<typeof outline>) {
  const path = `Connector_PinSocket_2.54mm.3dshapes/PinSocket_${rows}x${String(pins).padStart(2, '0')}_P2.54mm_Vertical.step`
  return rows < 2 ? kicad3d(path, box) : kicad3d(path, box, [0, r4(-(pins - 1) * 2.54), 0], [0, 0, 180])
}

/** A female 2.54 mm pin socket part; `pins` counts one row, so a 2 x 20 socket is `PinSocket(20, { rows: 2 })`. */
export interface PinSocketGenerator {
  <const N extends string = never>(pins: number, opts?: string | number | ConnectorOptions<N, PinSocketOptions>): Part<PinsOf<Num, N>>
  footprint<const N extends string = never>(pins: number, opts?: PinSocketOptions & GeneratorOptions<N>): LibFootprint<PinsOf<Num, N>>
}
export const PinSocket: PinSocketGenerator = Object.assign(
  function PinSocket(pins: number, opts?: unknown) {
    const { gen, part } = connectorCall('PinSocket', opts, ['rows', 'drill', 'pad'], 'the second argument')
    return call(socketFootprint(pins, gen), part)
  },
  { footprint: socketFootprint },
) as any

/** A round SMD test pad of diameter d on F.Cu, pin 1, out of the BOM and the placement file. */
export function TestPad<const N extends string = never>(d = 1.5, opts: GeneratorOptions<N> = {}): LibFootprint<PinsOf<Num, N>> {
  positive('TestPad', d)
  optsArg('TestPad', opts, [], 'the second argument, the options,')
  return memoised('TestPad', [d, opts], () =>
    makeFootprint(
      {
        id: `pcbjs:TestPoint_Pad_D${d}mm`,
        name: 'TestPad',
        value: 'TestPoint',
        prefix: 'TP',
        pads: [{ num: '1', name: '1', x: 0, y: 0, w: d, h: d, shape: 'circle' }],
        body: { cx: 0, cy: 0, w: 0, h: 0 },
        height: 0,
        model: NONE,
        bom: false,
        pos: false,
        courtyardCircle: { d: r4(d + 0.5) },
        pin1: false,
        silk: [h('circle', { layer: 'F.SilkS', r: r4(d / 2 + 0.35), width: 0.15 })],
        extra: [h('circle', { layer: 'F.Fab', r: r4(d / 2), width: 0.1 })],
      },
      opts as GeneratorOptions,
    ),
  ) as any
}

export interface PogoOptions<N extends string = string> extends GeneratorOptions<N> {
  /** columns along x, default 1 */
  cols?: number
  /** rows along y, default 1 */
  rows?: number
  /** default 2.54 */
  pitch?: number
}

/** Round pads d mm across for a pogo-pin fixture, numbered down each column: `PogoPad(1.5, { cols: 3, rows: 2 })` for AVR ISP-6. */
export function PogoPad<const N extends string = never>(d = 1.5, opts: PogoOptions<N> = {}): LibFootprint<PinsOf<Num, N>> {
  positive('PogoPad', d)
  optsArg('PogoPad', opts, ['cols', 'rows', 'pitch'], 'the second argument, the options,')
  if (opts.pitch !== undefined) mmArg('PogoPad', 'pitch', opts.pitch)
  const cols = opts.cols ?? 1,
    rows = opts.rows ?? 1,
    pitch = opts.pitch ?? 2.54
  countOf('PogoPad', cols, 1, 20)
  countOf('PogoPad', rows, 1, 20)
  if (pitch < d + 0.2) throw new RangeError(`PogoPad: a ${pitch} mm pitch leaves no gap between ${d} mm pads`)
  const { cols: _c, rows: _r, pitch: _p, ...gen } = opts
  return memoised('PogoPad', [d, cols, rows, pitch, gen], () => {
    const pads = padGridDefs(cols, rows, pitch, { size: d, shape: 'circle', order: 'columns' })
    const n = cols * rows
    const body = { cx: 0, cy: 0, w: r4((cols - 1) * pitch + d), h: r4((rows - 1) * pitch + d) }
    return makeFootprint(
      {
        id: `pcbjs:Pogo_${cols}x${rows}_D${d}mm_P${pitch}mm`,
        name: n > 1 ? `Pogo_${cols}x${rows}` : 'PogoPad',
        value: n > 1 ? `Pogo_${cols}x${rows}` : 'Pogo',
        prefix: n > 1 ? 'J' : 'TP',
        pads,
        body: { ...body, w: 0, h: 0 },
        height: 0,
        model: NONE,
        bom: false,
        pos: false,
        courtyard: [{ cx: 0, cy: 0, w: r4(body.w + 0.5), h: r4(body.h + 0.5) }],
        pin1: [r4(pads[0].x - d / 2 - 0.45), pads[0].y],
        silk: [],
        extra: [h('rect', { layer: 'F.Fab', x: -body.w / 2, y: -body.h / 2, w: body.w, h: body.h, width: 0.1 })],
      },
      gen as GeneratorOptions,
    )
  }) as any
}

/** A mounting hole of drill d, non-plated, or with a plated pin 1 pad of diameter `pad`, `true` for twice the drill. */
export function MountingHole(d = 3.2, pad?: number | boolean): LibFootprint<Num> {
  positive('MountingHole', d)
  if (pad !== undefined && typeof pad !== 'boolean') mmArg('MountingHole', 'pad, the second argument,', pad, 'true for a pad twice the drill, or the pad diameter in mm')
  const p = pad === true ? r4(2 * d) : typeof pad === 'number' ? pad : 0
  if (p && p < d + 0.4) throw new RangeError(`MountingHole: a ${p} mm pad around a ${d} mm hole leaves less than a 0.2 mm ring`)
  return memoised('MountingHole', [d, p], () => {
    const screw = d >= 3.0 && d <= 3.4 ? 'M3' : d >= 2.1 && d <= 2.4 ? 'M2' : d >= 2.5 && d <= 2.8 ? 'M2.5' : d >= 4.1 && d <= 4.5 ? 'M4' : ''
    const pads: PadDef[] = p
      ? [{ num: '1', name: '1', x: 0, y: 0, w: p, h: p, shape: 'circle', drill: d }]
      : [{ num: '', name: '', x: 0, y: 0, w: d, h: d, shape: 'circle', drill: d, type: 'npth' }]
    const label = `MountingHole_${d}mm${screw ? `_${screw}` : ''}${p ? '_Pad' : ''}`
    return makeFootprint({
      id: `pcbjs:${label}`,
      name: 'MountingHole',
      value: screw || `Hole_${d}mm`,
      prefix: 'H',
      pads,
      body: { cx: 0, cy: 0, w: 0, h: 0 },
      height: 0,
      model: NONE,
      bom: false,
      pos: false,
      courtyardCircle: { d: r4(Math.max(2 * d + 0.5, p + 0.5)) },
      pin1: false,
      silk: [], // the screw head, as KiCad
      extra: [h('circle', { layer: 'F.Fab', r: r4(Math.max(d, p) / 2), width: 0.1 })],
    })
  }) as any
}

function countOf(gen: string, n: number, min: number, max: number): void {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new RangeError(`${gen}: the count must be a whole number from ${min} to ${max}, got ${show(n)}`)
}
function positive(gen: string, d: number): void {
  if (!(typeof d === 'number' && d > 0 && Number.isFinite(d))) throw new RangeError(`${gen}: the diameter, the first argument, must be a positive number of mm, got ${show(d)}`)
}
