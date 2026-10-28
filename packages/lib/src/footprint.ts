import { h } from '@pcbjs/core/jsx-runtime'
import type { FootprintFactory, FootprintProps, ModelSpec, PadProps, PadShape, PadType, PcbNode, ThermalConnection } from '@pcbjs/core/types'
import { defineFootprint, SchematicError } from '@pcbjs/core/schematic'

/** SMD pad centred at (x, y), w by h, roundrect by default. */
export function smd(num: string | number, x: number, y: number, w: number, h_: number, extra: Partial<PadProps> = {}): PcbNode {
  return h('pad', { num, at: [x, y], size: [w, h_], shape: 'roundrect', ...extra })
}
/** Through-hole pad centred at (x, y): copper diameter and drill. */
export function tht(num: string | number, x: number, y: number, dia: number, drill: number, extra: Partial<PadProps> = {}): PcbNode {
  return h('pad', { num, at: [x, y], size: dia, drill, shape: 'circle', ...extra })
}
/** Non-plated hole. */
export function npth(x: number, y: number, drill: number): PcbNode {
  return h('pad', { num: '', at: [x, y], size: drill, drill, type: 'npth', shape: 'circle' })
}

/** Courtyard rectangle w by h centred at (cx, cy), the origin by default; `courtyard(w, h, layer)` still works. */
export function courtyard(w: number, h_: number, cx?: number | string, cy = 0, side = 'F.CrtYd'): PcbNode {
  if (typeof cx === 'string') {
    side = cx
    cx = 0
  }
  const x0 = cx ?? 0
  return h('rect', { layer: side, x: r4(x0 - w / 2), y: r4(cy - h_ / 2), w, h: h_, width: 0.05 })
}
/** Silk outline rectangle centred on the origin. */
export function silkRect(w: number, h_: number, width = 0.15): PcbNode {
  return h('rect', { layer: 'F.SilkS', x: -w / 2, y: -h_ / 2, w, h: h_, width })
}

/** One pad of a generated footprint, as data: number, pin name, centre, size and kind. */
export interface PadDef {
  num: string
  /** the pin the pad belongs to; pads that share a name share a pin. Empty for an unnumbered hole */
  name: string
  x: number
  y: number
  w: number
  h: number
  shape?: PadShape
  drill?: number | [number, number]
  type?: PadType
  layers?: string[]
  paste?: boolean
  roundness?: number
  /** how the pad joins a pour of its net; the exposed pads of the IC generators are 'solid' */
  thermal?: ThermalConnection
}

export interface PadRowOptions {
  /** centre of the row, default the origin */
  at?: [number, number]
  /** the axis the row runs along, default "x" */
  axis?: 'x' | 'y'
  /** pad size [w, h] in footprint axes, or a diameter for a round through-hole pad */
  size: [number, number] | number
  /** drill of a through-hole pad */
  drill?: number | [number, number]
  /** number of the first pad, default 1 */
  first?: number
  /** run from the far end back, so the first pad is at +axis; default false */
  reverse?: boolean
  /** pin names in pad order; default the pad numbers */
  names?: readonly string[]
  shape?: PadShape
  /** the shape of the first pad, such as "rect" for pin 1 of a header */
  firstShape?: PadShape
}

/** The pads of a row as data, the form the generators build on. */
export function padRowDefs(n: number, pitch: number, o: PadRowOptions): PadDef[] {
  const [cx, cy] = o.at ?? [0, 0]
  const [w, hh] = typeof o.size === 'number' ? [o.size, o.size] : o.size
  const first = o.first ?? 1
  const out: PadDef[] = []
  for (let i = 0; i < n; i++) {
    const t = ((o.reverse ? n - 1 - i : i) - (n - 1) / 2) * pitch
    const num = String(first + i)
    const shape = i === 0 && o.firstShape ? o.firstShape : (o.shape ?? (o.drill !== undefined ? 'circle' : 'roundrect'))
    out.push({
      num,
      name: o.names?.[i] ?? num,
      x: r4(o.axis === 'y' ? cx : cx + t),
      y: r4(o.axis === 'y' ? cy + t : cy),
      w,
      h: hh,
      shape,
      ...(o.drill !== undefined ? { drill: o.drill } : {}),
    })
  }
  return out
}

/** A row of n pads at the given pitch, centred on `at`: SMD by default, through-hole when `drill` is set. */
export function padRow(n: number, pitch: number, o: PadRowOptions): PcbNode[] {
  return padRowDefs(n, pitch, o).map(padNode)
}

export interface PadGridOptions extends Omit<PadRowOptions, 'axis' | 'reverse'> {
  /** the pitch across rows, default the pitch along them */
  rowPitch?: number
  /** "rows" numbers along the first row, then the next; "columns" down the first column, then the next; default "rows" */
  order?: 'rows' | 'columns'
}

/** The pads of a cols by rows grid as data, numbered row by row or column by column from the top-left. */
export function padGridDefs(cols: number, rows: number, pitch: number, o: PadGridOptions): PadDef[] {
  const [cx, cy] = o.at ?? [0, 0]
  const [w, hh] = typeof o.size === 'number' ? [o.size, o.size] : o.size
  const rp = o.rowPitch ?? pitch,
    first = o.first ?? 1
  const out: PadDef[] = []
  for (let k = 0; k < cols * rows; k++) {
    const c = o.order === 'columns' ? Math.floor(k / rows) : k % cols
    const r = o.order === 'columns' ? k % rows : Math.floor(k / cols)
    const num = String(first + k)
    const shape = k === 0 && o.firstShape ? o.firstShape : (o.shape ?? (o.drill !== undefined ? 'circle' : 'roundrect'))
    out.push({
      num,
      name: o.names?.[k] ?? num,
      x: r4(cx + (c - (cols - 1) / 2) * pitch),
      y: r4(cy + (r - (rows - 1) / 2) * rp),
      w,
      h: hh,
      shape,
      ...(o.drill !== undefined ? { drill: o.drill } : {}),
    })
  }
  return out
}

/** A cols by rows grid of pads centred on `at`, numbered row by row from the top-left unless `order` is "columns". */
export function padGrid(cols: number, rows: number, pitch: number, o: PadGridOptions): PcbNode[] {
  return padGridDefs(cols, rows, pitch, o).map(padNode)
}

export function padNode(p: PadDef): PcbNode {
  const plated = p.drill !== undefined && p.type !== 'npth'
  return h('pad', {
    num: p.num,
    ...(p.name && p.name !== p.num ? { name: p.name } : {}),
    at: [p.x, p.y],
    size: p.shape === 'circle' && p.w === p.h ? p.w : [p.w, p.h],
    shape: p.shape ?? (plated ? 'circle' : 'roundrect'),
    ...(p.drill !== undefined ? { drill: p.drill } : {}),
    ...(p.type ? { type: p.type } : {}),
    ...(p.layers ? { layers: p.layers } : {}),
    ...(p.paste !== undefined ? { paste: p.paste } : {}),
    ...(p.roundness !== undefined ? { roundness: p.roundness } : {}),
    ...(p.thermal ? { thermal: p.thermal } : {}),
  })
}

export interface Box {
  cx: number
  cy: number
  w: number
  h: number
}

export interface SilkOutlineOptions {
  cx?: number
  cy?: number
  /** pads to keep clear of, by centre and size: `{ x, y, w, h }` or a whole PadDef; the outline is broken where it would run into them */
  pads?: readonly Pick<PadDef, 'x' | 'y' | 'w' | 'h'>[]
  /** gap between a pad's copper and the silk line's edge, default 0.2 */
  clearance?: number
  /** line width, default 0.15 */
  width?: number
  /** how far outside the body the line runs, default 0.1 */
  offset?: number
  layer?: string
  /** the edges to draw, default all four; a connector whose mouth overhangs the board edge leaves out that side */
  edges?: readonly ('top' | 'bottom' | 'left' | 'right')[]
}

/** A silk outline around a w by h body, broken within `clearance` of a pad so the fab never clips it; null when nothing is left. */
export function silkOutline(w: number, h_: number, o: SilkOutlineOptions = {}): PcbNode | null {
  const cx = o.cx ?? 0,
    cy = o.cy ?? 0,
    width = o.width ?? 0.15,
    off = o.offset ?? 0.1
  const keep = (o.clearance ?? 0.2) + width / 2
  const x0 = cx - w / 2 - off,
    x1 = cx + w / 2 + off,
    y0 = cy - h_ / 2 - off,
    y1 = cy + h_ / 2 + off
  const blocks = (o.pads ?? []).map(p => ({ x0: p.x - p.w / 2 - keep, x1: p.x + p.w / 2 + keep, y0: p.y - p.h / 2 - keep, y1: p.y + p.h / 2 + keep }))
  const parts: string[] = []
  // [fixed coordinate, from, to, horizontal, side]
  const all: [number, number, number, boolean, string][] = [
    [y0, x0, x1, true, 'top'],
    [y1, x0, x1, true, 'bottom'],
    [x0, y0, y1, false, 'left'],
    [x1, y0, y1, false, 'right'],
  ]
  const edges = o.edges ? all.filter(e => o.edges!.includes(e[4] as 'top')) : all
  for (const [c, a, b, horiz] of edges) {
    let free: [number, number][] = [[a, b]]
    for (const k of blocks) {
      const lo = horiz ? k.y0 : k.x0,
        hi = horiz ? k.y1 : k.x1
      if (c < lo || c > hi) continue
      const s = horiz ? k.x0 : k.y0,
        e = horiz ? k.x1 : k.y1
      free = free.flatMap(([u, v]) =>
        (e <= u || s >= v
          ? [[u, v]]
          : [
              [u, Math.min(v, s)],
              [Math.max(u, e), v],
            ]
        ).filter(([p, q]) => q - p > 1e-9),
      ) as [number, number][]
    }
    for (const [u, v] of free) {
      if (v - u < 0.2) continue
      parts.push(horiz ? `M ${r4(u)} ${r4(c)} H ${r4(v)}` : `M ${r4(c)} ${r4(u)} V ${r4(v)}`)
    }
  }
  return parts.length ? h('path', { layer: o.layer ?? 'F.SilkS', d: parts.join(' '), width }) : null
}

/** The generated model, or the props' one; a STEP model without a fallback falls back to the generated one. */
export function withGenerated(generated: ModelSpec, props: { model?: ModelSpec }): { model?: ModelSpec } {
  if (!('model' in props)) return { model: generated }
  const m = props.model as (ModelSpec & { step?: unknown; file?: unknown; fallback?: unknown }) | undefined
  const step = !!m && typeof m === 'object' && (m.kind === 'step' || (m.kind === undefined && (typeof m.step === 'string' || typeof m.file === 'string')))
  return {
    model:
      step && !m!.fallback && generated.kind !== 'step' && (generated as { step?: unknown }).step === undefined && (generated as { file?: unknown }).file === undefined
        ? ({ ...m, fallback: generated } as ModelSpec)
        : m,
  }
}

export interface FootprintDef {
  /** library id, such as "pcbjs:SOT-23-5" */
  id: string
  /** the factory's name, shown in errors and part labels */
  name: string
  /** the default value, a name the BOM and a distributor search understand */
  value: string
  prefix: string
  pads: PadDef[]
  /** the body for F.Fab and the default silk, centred at (cx, cy) */
  body: Box
  /** body height above the board for the 3D view */
  height: number
  model: ModelSpec
  /** courtyards; default the union of pads and body grown by 0.25 */
  courtyard?: Box[]
  /** round courtyard by diameter, for holes and pads, instead of a rectangle */
  courtyardCircle?: { d: number; cx?: number; cy?: number }
  /** silk: "outline" draws the body outline clear of the pads, a list replaces it, a function gives the list of each silk mode; default "outline" */
  silk?: 'outline' | 'none' | PcbNode[] | ((mode: 'full' | 'open') => PcbNode[])
  /** the mating side of a connector, the edge of the body a plug enters by: `silk: 'open'`, its default, leaves it out of the outline */
  mouth?: 'top' | 'bottom' | 'left' | 'right'
  /** where to put the pin 1 dot; default outside pad 1 on the side away from the body, false for none */
  pin1?: [number, number] | false
  /** more children: Fab marks, keepouts */
  extra?: PcbNode[]
  bom?: boolean
  pos?: boolean
  /** pin order for positional connect, after renaming; default the pad names in pad order */
  pins?: string[]
  description?: string
}

/** Renames pins: a list gives the default pins new names in order; a record maps a pad number or a default pin name to a new name. */
export type PinNames<N extends string = string> = readonly N[] | Readonly<Record<string, N>>

/** The pin names of a generated footprint, for its part's keys: the family's own and any `pinNames` gave, NC aside. */
export type PinsOf<D extends string, N extends string> = D | Exclude<N, 'NC' | ''>

/** Options every generated footprint takes. */
export interface GeneratorOptions<N extends string = string> {
  /** Pin names in order, or a record by pad number or default pin name; pads named NC are no pin. */
  pinNames?: PinNames<N>
  /** the ref prefix, default the family's */
  prefix?: string
  /** the default value */
  value?: string
  /** 'full', 'open' without a connector's mating side, or 'none'; default 'open' for a family with a mating side, else 'full'. */
  silk?: SilkMode
}

/** The silk of a generated footprint, see `GeneratorOptions.silk`. */
export type SilkMode = 'full' | 'open' | 'none'
const SILK_MODES: readonly SilkMode[] = ['full', 'open', 'none']

const GEN = Symbol.for('pcbjs.lib.generated')

// pads named NC are left unconnected on purpose: no pin, listed in the footprint's `nc`
const isPin = (p: PadDef) => p.name !== '' && p.name !== 'NC'
const defaultPins = (pads: readonly PadDef[]) => [...new Set(pads.filter(isPin).map(p => p.name))]

function renamed(def: FootprintDef, names: PinNames | undefined): PadDef[] {
  if (!names) return def.pads
  const pins = def.pins ?? defaultPins(def.pads)
  const map = new Map<string, string>()
  if (Array.isArray(names)) {
    if (names.length > pins.length) throw new SchematicError(`${def.name}: ${names.length} pin names for ${pins.length} pins`)
    names.forEach((n, i) => {
      if (n !== undefined && n !== '') map.set(pins[i], String(n))
    })
    return def.pads.map(p => (p.name !== '' && map.has(p.name) ? { ...p, name: map.get(p.name)! } : p))
  }
  const rec = names as Record<string, string>
  for (const k of Object.keys(rec))
    if (!def.pads.some(p => p.num === k || p.name === k))
      throw new SchematicError(`${def.name}: pinNames names ${JSON.stringify(k)}, which is neither a pad number nor a pin; its pins are ${pins.join(', ')}`)
  return def.pads.map(p => {
    if (p.name === '') return p
    const byNum = rec[p.num],
      byName = rec[p.name]
    return byNum !== undefined ? { ...p, name: String(byNum) } : byName !== undefined ? { ...p, name: String(byName) } : p
  })
}

const bboxOf = (boxes: Box[]) => {
  const x0 = Math.min(...boxes.map(b => b.cx - b.w / 2)),
    x1 = Math.max(...boxes.map(b => b.cx + b.w / 2))
  const y0 = Math.min(...boxes.map(b => b.cy - b.h / 2)),
    y1 = Math.max(...boxes.map(b => b.cy + b.h / 2))
  return { x0, x1, y0, y1 }
}
const ceil2 = (v: number) => Math.ceil(v * 100 - 1e-6) / 100

/** The default courtyard: pads and body grown by `margin`, out to the next 0.01 mm. */
export function courtyardOf(pads: readonly PadDef[], body: Box, margin = 0.25): Box {
  const b = bboxOf([body, ...pads.map(p => ({ cx: p.x, cy: p.y, w: p.w, h: p.h }))])
  const x0 = -ceil2(-(b.x0 - margin)),
    x1 = ceil2(b.x1 + margin),
    y0 = -ceil2(-(b.y0 - margin)),
    y1 = ceil2(b.y1 + margin)
  return { cx: r4((x0 + x1) / 2), cy: r4((y0 + y1) / 2), w: r4(x1 - x0), h: r4(y1 - y0) }
}

/** Where the pin 1 dot goes: outside pad 1, away from the body centre along the axis pad 1 sticks out on. */
function pin1Dot(pads: readonly PadDef[], body: Box): [number, number] | null {
  const p = pads.find(q => q.num === '1') ?? pads.find(q => q.name !== '')
  if (!p) return null
  const dx = p.x - body.cx,
    dy = p.y - body.cy
  const sx = Math.abs(dx) / Math.max(body.w / 2, 1e-6),
    sy = Math.abs(dy) / Math.max(body.h / 2, 1e-6)
  const gap = 0.45
  return sx >= sy ? [r4(p.x + Math.sign(dx || -1) * (p.w / 2 + gap)), p.y] : [p.x, r4(p.y + Math.sign(dy || -1) * (p.h / 2 + gap))]
}

function children(def: FootprintDef, pads: PadDef[], silk: SilkMode = def.mouth ? 'open' : 'full'): PcbNode[] {
  const out: PcbNode[] = pads.map(padNode)
  if (def.courtyardCircle) {
    const c = def.courtyardCircle
    out.push(h('circle', { layer: 'F.CrtYd', cx: c.cx ?? 0, cy: c.cy ?? 0, r: c.d / 2, width: 0.05 }))
  } else for (const c of def.courtyard ?? [courtyardOf(pads, def.body)]) out.push(courtyard(c.w, c.h, c.cx, c.cy))
  const b = def.body
  if (b.w > 0 && b.h > 0) out.push(h('rect', { layer: 'F.Fab', x: r4(b.cx - b.w / 2), y: r4(b.cy - b.h / 2), w: b.w, h: b.h, width: 0.1 }))
  if (silk !== 'none') {
    const mode = silk === 'open' && (def.mouth || typeof def.silk === 'function') ? 'open' : 'full'
    if (def.silk === undefined || def.silk === 'outline') {
      // open: no line across the mouth, and the sides stop 0.5 mm short of it, so none runs over the board edge it sits on
      const m = mode === 'open' ? def.mouth : undefined
      const cut = m ? 0.5 : 0
      const bx = m === 'left' || m === 'right' ? { cx: b.cx + (m === 'left' ? cut : -cut) / 2, w: b.w - cut } : { cx: b.cx, w: b.w }
      const by = m === 'top' || m === 'bottom' ? { cy: b.cy + (m === 'top' ? cut : -cut) / 2, h: b.h - cut } : { cy: b.cy, h: b.h }
      const edges = (['top', 'bottom', 'left', 'right'] as const).filter(e => e !== m)
      const s = silkOutline(bx.w, by.h, { cx: bx.cx, cy: by.cy, pads, edges })
      if (s) out.push(s)
    } else if (Array.isArray(def.silk)) out.push(...def.silk)
    else if (typeof def.silk === 'function') out.push(...def.silk(mode))
  }
  const dot = def.pin1 === false || silk === 'none' ? null : (def.pin1 ?? pin1Dot(pads, b))
  if (dot) out.push(h('circle', { layer: 'F.SilkS', cx: dot[0], cy: dot[1], r: 0.1, fill: true }))
  if (def.extra) out.push(...def.extra)
  return out
}

/** A generated footprint factory: a FootprintFactory whose static `nc` lists the numbers of its pads named NC, which are no pin. */
export type LibFootprint<P extends string = string, D extends string = never> = FootprintFactory<P, FootprintProps, D> & { readonly nc: readonly string[] }
type Generated<P extends string, D extends string = never> = LibFootprint<P, D>

/** A dual-mode footprint factory from a definition: `F('value')` makes a part, `<F ref="U1" at="…" />` renders. */
export function makeFootprint<P extends string = string, D extends string = never>(def: FootprintDef, opts: GeneratorOptions = {}): Generated<P, D> {
  const pn = opts.pinNames
  if (pn !== undefined && (pn === null || typeof pn !== 'object'))
    throw new TypeError(`${def.name}: pinNames must be a list of names in pin order or an object keyed by pad number or pin, got ${JSON.stringify(pn)}`)
  if (opts.prefix !== undefined && typeof opts.prefix !== 'string') throw new TypeError(`${def.name}: prefix must be letters such as 'U', got ${JSON.stringify(opts.prefix)}`)
  if (opts.value !== undefined && typeof opts.value !== 'string') throw new TypeError(`${def.name}: value must be a string, got ${JSON.stringify(opts.value)}`)
  if (opts.silk !== undefined && !SILK_MODES.includes(opts.silk))
    throw new TypeError(`${def.name}: silk must be ${SILK_MODES.map(m => `'${m}'`).join(', ')}, got ${JSON.stringify(opts.silk)}`)
  const pads = renamed(def, opts.pinNames)
  // each default pin in order becomes the new names of its pads, so a rename can split a pin as well as merge two
  const order = def.pins ?? defaultPins(def.pads)
  const pinList = [...new Set([...order, 'NC'].flatMap(n => pads.filter((_, i) => def.pads[i].name === n).map(p => p.name)))].filter(n => n !== 'NC')
  for (const p of pads) if (isPin(p) && !pinList.includes(p.name)) throw new SchematicError(`${def.name}: pad ${p.num} belongs to no pin`)
  const nc = pads.filter(p => p.name === 'NC').map(p => p.num)
  const value = opts.value ?? def.value
  const kids = children(def, pads, opts.silk)
  // a footprint drawn with other silk than its family's default is another footprint, as KiCad's NoSilkScreen variants are
  const id = opts.silk === 'none' ? `${def.id}_NoSilkScreen` : opts.silk === 'full' && def.mouth ? `${def.id}_SilkFull` : def.id
  const render = function Footprint(props: FootprintProps): PcbNode {
    const { children: more, ...rest } = props
    return h(
      'footprint',
      {
        id,
        value,
        height: def.height,
        model: def.model,
        ...(def.bom === false ? { bom: false } : {}),
        ...(def.pos === false ? { pos: false } : {}),
        ...(def.description ? { description: def.description } : {}),
        ...rest,
        ...withGenerated(def.model, rest),
      },
      ...kids,
      more,
    )
  }
  const f = defineFootprint<P>(render, { pins: pinList as P[], nc, prefix: opts.prefix ?? def.prefix, id, name: def.name }) as unknown as Generated<P, D>
  Object.defineProperty(f, GEN, { value: { def, opts } })
  return f
}

/** A generated footprint with its pins renamed: `withPins(Crystal3225, { 2: 'GND1', 4: 'GND2' })`. */
export function withPins<P extends string, const N extends string, D extends string = never>(
  factory: FootprintFactory<P, FootprintProps, D>,
  pinNames: PinNames<N>,
  opts: Omit<GeneratorOptions, 'pinNames'> = {},
): LibFootprint<PinsOf<P, N>, D> {
  const g = (factory as any)[GEN] as { def: FootprintDef; opts: GeneratorOptions } | undefined
  if (!g) throw new SchematicError(`withPins: ${(factory as any).name ?? 'this footprint'} is not a generated @pcbjs/lib footprint`)
  return makeFootprint<PinsOf<P, N>, D>(g.def, { ...g.opts, ...opts, pinNames })
}

/** A number rounded to 0.0001 mm, so generated coordinates print cleanly and KiCad's 1.1375 stays 1.1375. */
export function r4(v: number): number {
  const r = Math.round(v * 10000) / 10000
  return Object.is(r, -0) ? 0 : r
}
