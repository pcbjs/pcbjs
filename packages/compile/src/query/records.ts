// The records `pcbjs q` and `inspect --json` print and the board API's views turn into: complete for what they name, nested things as references, mm and degrees.
import type { Board as Model, Footprint, Item, Pad, PairInfo, Poly, Prim, Pt, RouteRecord as ModelRoute, Track, Via, Zone } from '@pcbjs/core/model'
import type { Finding } from '@pcbjs/core/finding'
import type { Src } from '@pcbjs/core/internal/types'
import { MODEL_LABEL, modelSource } from '@pcbjs/core/internal/model-source'
import { padRef, regionHash } from '@pcbjs/core/ref'
import { bareHole } from '../bare.js'
import { polysArea } from '../geom.js'
import { polylineLength, routeLength } from '../length.js'
import { classNameOf } from '../netclass.js'
import { routesCopper, type RouteCopper } from '../pair-info.js'
import { boxOf, distance, itemShape, unionBox, type Box } from './shape.js'

export interface SourceRange {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}

export interface PadRecord {
  kind: 'pad'
  ref: string
  uid: string
  part: string
  num: string
  name: string
  net: string | null
  at: Pt
  rot: number
  layers: string[]
  shape: string
  /** in board axes, swapped for a quarter turn, the copper extent at any other angle */
  size: [number, number]
  footprintSize: [number, number]
  /** in board axes; a round drill has both equal */
  drill?: [number, number]
  footprintDrill?: [number, number]
  findings: string[]
  source: SourceRange | null
}

export interface PartRecord {
  kind: 'part'
  ref: string
  path: string
  footprint: string
  value?: string
  at: Pt
  rot: number
  side: 'F' | 'B'
  /** `file`, `generated`, `no model` or `no body` */
  model: string
  bbox: Box | null
  courtyard?: Box
  findings: string[]
  source: SourceRange | null
  pads: PadRecord[]
}

export interface NetRecord {
  kind: 'net'
  ref: string
  class: string
  pads: string[]
  routes: string[]
  vias: string[]
  pours: string[]
  length: number
  findings: string[]
  source: SourceRange[]
}

export interface RouteRecord {
  kind: 'route'
  ref: string
  name?: string
  net: string
  pair?: string
  ends: string[]
  layers: string[]
  width: number
  /** with via barrels; for a pair its longer side */
  length: number
  /** the route's own target narrowed by its match group; `max` null for none */
  target?: { min: number; max: number | null }
  group?: string
  skew?: number
  tuned?: number
  status: 'ok' | 'short' | 'long' | 'failed' | 'unrouted'
  vias: string[]
  findings: string[]
  source: SourceRange | null
  /** the innermost call site of a route made inside a helper */
  call?: SourceRange
  points: { ref: string; at: Pt; layer: string }[]
}

export type PrimRecord = { kind: 'line'; from: Pt; to: Pt } | { kind: 'arc'; from: Pt; to: Pt; center: Pt; cw: boolean }

export interface ItemRecord {
  kind: 'item'
  ref: string
  /** the compile's numeric id, as `#id` */
  id: number
  type: Item['kind']
  layer: string
  layers?: string[]
  net: string | null
  part?: string
  bbox: Box | null
  width?: number
  length?: number
  at?: Pt
  rot?: number
  num?: string
  shape?: string
  size?: number | [number, number]
  drill?: number | [number, number]
  thickness?: number
  pts?: Pt[]
  paths?: Pt[][]
  closed?: boolean[]
  fill?: boolean
  /** with an arc among them; `cw` is clockwise on screen */
  prims?: PrimRecord[] | PrimRecord[][]
  route?: string
  stitch?: true
  pair?: string
  role?: 'P' | 'N'
  priority?: number
  area?: number
  pieces?: number
  islandsRemoved?: { count: number; area: number }
  text?: string
  font?: string
  mirrored?: boolean
  strokes?: Pt[][]
  glyphs?: { outer: Pt[]; holes: Pt[][] }[]
  source: SourceRange | null
}

export interface GroupRecord {
  kind: 'group'
  ref: string
  parts: string[]
}

export interface LegRecord {
  kind: 'leg'
  ref: string
  route: string
  from: Pt
  to: Pt
}

export interface PtRecord {
  kind: 'pt'
  ref: string
  route: string
  at: Pt
}

export interface PairRecord {
  kind: 'pair'
  ref: string
  /** [P, N] */
  nets: [string, string]
  width: number
  gap: number
  /** allowed length difference */
  skew: number
  uncoupled: number
  maxUncoupled: number
  source: SourceRange | null
}

export interface SpanRecord {
  kind: 'span'
  ref: string
  layers: [string, string]
  net?: string
  vias: string[]
}

export interface PlaneRecord {
  kind: 'plane'
  ref: string
  layer: string
  net: string
  zones: string[]
}

export interface RegionRecord {
  kind: 'region'
  ref: string
  hash: string
  layer: string
  net: string
  zone: string | null
  area: number
  bbox: Box | null
}

/** A3's evidence unchanged. */
export type FindingRecord = Finding

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
export const pt4 = (p: Pt): Pt => [r4(p[0]), r4(p[1])]
const pair4 = (p: readonly [number, number]): [number, number] => [r4(p[0]), r4(p[1])]
const box4 = (b: Box | null): Box | null => b && { x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) }

/** A source position, its file relative to the project. */
export function sourceRange(s: Src | undefined, root: string): SourceRange | null {
  if (!s) return null
  const file = root && s.file.startsWith(root + '/') ? s.file.slice(root.length + 1) : s.file
  return { file, line: s.line, col: s.col, endLine: s.endLine ?? s.line, endCol: s.endCol ?? s.col }
}

/** What the record builders read once per board. */
export interface Ctx {
  b: Model
  root: string
  findings: Finding[]
  byId: Map<number, Item>
  fps: Map<string, Footprint>
  /** every route's copper and length, built on first use */
  copper(): Map<string, RouteCopper>
  /** each match group's longest routed length, for groups of more than one route */
  groupTops(): Map<string, number>
}

export function recordCtx(b: Model, findings: Finding[], root = ''): Ctx {
  let copper: Map<string, RouteCopper> | null = null
  let tops: Map<string, number> | null = null
  const c: Ctx = {
    b,
    root,
    findings,
    byId: new Map(b.items.map(it => [it.id, it])),
    fps: new Map(b.footprints.map(f => [f.ref, f])),
    copper: () => (copper ??= routesCopper(b)),
    groupTops: () => (tops ??= groupTops(b, c.copper())),
  }
  return c
}

function groupTops(b: Model, copper: Map<string, RouteCopper>): Map<string, number> {
  const by = new Map<string, number[]>()
  for (const r of b.routes ?? []) if (r.group !== undefined && copper.has(r.id)) by.set(r.group, [...(by.get(r.group) ?? []), copper.get(r.id)!.length])
  return new Map([...by].filter(([, ls]) => ls.length > 1).map(([g, ls]) => [g, Math.max(...ls)]))
}

export const padsOf = (c: Ctx, fp: Footprint): Pad[] => fp.pads.map(id => c.byId.get(id)).filter((p): p is Pad => p?.kind === 'pad')
export const padName = (p: Pad): string => (p.ref === undefined ? (p.uid ?? `#${p.id}`) : p.num ? padRef(p.ref, p.num) : p.ref)
const touches = (r: string, ref: string) => r === ref || r.startsWith(ref + '/')

/** A part's tree path, `CH2/R01`, else its ref. */
export function partPath(c: Ctx, fp: Footprint): string {
  const p = c.b.schematic?.parts.find(x => x.ref === fp.ref)
  return p?.path?.length ? [...p.path, p.local ?? fp.ref].join('/') : fp.ref
}

export const findingsOfPart = (c: Ctx, ref: string): string[] => c.findings.filter(f => f.refs.some(r => touches(r, ref))).map(f => f.id)

/** An item's own source, else that of the part that owns it. */
const itemSource = (c: Ctx, it: Item) => sourceRange(it.src ?? (it.ref !== undefined ? c.fps.get(it.ref)?.src : undefined), c.root)

/** Whether a pad turned by `rot` degrees has its footprint x along the board's y. */
const quarter = (rot: number) => Math.abs(Math.round(((rot % 180) + 180) % 180) - 90) < 1e-6
const square = (rot: number) => Math.abs(((rot % 90) + 90) % 90) < 1e-6 || Math.abs((((rot % 90) + 90) % 90) - 90) < 1e-6

/** A pad's size in board axes as KiCad plots it. */
function boardSize(p: Pad): [number, number] {
  if (square(p.rot)) return quarter(p.rot) ? [r4(p.size[1]), r4(p.size[0])] : pair4(p.size)
  const xs = p.poly.map(q => q[0]),
    ys = p.poly.map(q => q[1])
  return xs.length ? [r4(Math.max(...xs) - Math.min(...xs)), r4(Math.max(...ys) - Math.min(...ys))] : pair4(p.size)
}
/** A pad's drill in board axes, an oval slot swapped as its pad. */
const boardDrill = (p: Pad): [number, number] | null => (p.drill && square(p.rot) && quarter(p.rot) ? [p.drill[1], p.drill[0]] : p.drill)

export function padRecord(c: Ctx, p: Pad): PadRecord {
  const ref = padName(p)
  const drill = boardDrill(p)
  return {
    kind: 'pad',
    ref,
    uid: p.uid ?? `#${p.id}`,
    part: p.ref ?? '',
    num: p.num,
    name: p.name,
    net: p.net ?? null,
    at: pt4(p.at),
    rot: r4(p.rot),
    layers: [...p.layers],
    shape: p.shape,
    size: boardSize(p),
    footprintSize: pair4(p.size),
    ...(drill ? { drill: pair4(drill), footprintDrill: pair4(p.drill!) } : {}),
    findings: c.findings.filter(f => f.refs.includes(ref)).map(f => f.id),
    source: itemSource(c, p),
  }
}

const COURTYARD = new Set(['F.CrtYd', 'B.CrtYd'])

export function partRecord(c: Ctx, fp: Footprint, path = partPath(c, fp)): PartRecord {
  const pads = padsOf(c, fp)
  const own = c.b.items.filter(it => it.ref === fp.ref && it.kind !== 'text' && it.kind !== 'pad')
  const yard = unionBox(own.filter(it => COURTYARD.has(it.layer)).map(it => boxOf(itemShape(it))))
  return {
    kind: 'part',
    ref: fp.ref,
    path,
    footprint: fp.id,
    ...(fp.value ? { value: fp.value } : {}),
    at: pt4(fp.at),
    rot: r4(fp.rot),
    side: fp.side,
    model: MODEL_LABEL[modelSource(fp.model, fp.height ?? (bareHole(c.b, fp) ? 0 : 1))],
    bbox: box4(unionBox([...pads, ...own].map(it => boxOf(itemShape(it))))),
    ...(yard ? { courtyard: box4(yard)! } : {}),
    findings: findingsOfPart(c, fp.ref),
    source: sourceRange(fp.src, c.root),
    pads: pads.map(p => padRecord(c, p)),
  }
}

/** The copper a route call placed: its tracks and vias. */
export const routeCopper = (b: Model, id: string) => ({
  tracks: b.items.filter((it): it is Track => it.kind === 'track' && it.route === id),
  vias: b.items.filter((it): it is Via => it.kind === 'via' && it.route === id),
})

const uidOf = (it: Item) => it.uid ?? `#${it.id}`

export function netRecord(c: Ctx, name: string): NetRecord {
  const { b } = c
  const mine = b.items.filter(it => it.net === name)
  const tracks = mine.filter((it): it is Track => it.kind === 'track')
  const vias = mine.filter((it): it is Via => it.kind === 'via')
  const pads = mine.filter((it): it is Pad => it.kind === 'pad').map(padName)
  const ref = `net:${name}`
  const source = new Map<string, SourceRange>()
  for (const it of mine) {
    const s = it.kind === 'track' || it.kind === 'via' || it.kind === 'zone' ? sourceRange(it.src, c.root) : null
    if (s) source.set(`${s.file}:${s.line}:${s.col}`, s)
  }
  return {
    kind: 'net',
    ref,
    class: classNameOf(b, name) ?? 'default',
    pads,
    routes: (b.routes ?? []).filter(r => r.net === name).map(r => r.id),
    vias: vias.map(uidOf),
    pours: [...new Set(mine.filter(it => it.kind === 'zone').map(z => `plane:${z.layer}:${name}`))],
    length: r4(routeLength(tracks, [], b.stackup)),
    findings: c.findings.filter(f => f.refs.includes(ref) || f.refs.some(r => pads.includes(r))).map(f => f.id),
    source: [...source.values()],
  }
}

const routeFindings = (c: Ctx, id: string) => c.findings.filter(f => f.refs.includes(id))

/** The route's own target narrowed to its match group's window, `tolerance` below the group's longest. */
function routeTarget(c: Ctx, r: ModelRoute): { min: number; max: number } | null {
  let t = r.target ? { min: r.target.min, max: r.target.max ?? Infinity } : null
  const top = r.group !== undefined ? c.groupTops().get(r.group) : undefined
  if (top !== undefined) {
    const lo = top - (r.tolerance ?? 0.1)
    t = t ? { min: Math.max(t.min, lo), max: Math.min(t.max, top) } : { min: lo, max: top }
  }
  return t
}

export function routeRecord(c: Ctx, r: ModelRoute): RouteRecord {
  const { b } = c
  const cu = c.copper().get(r.id)
  const tracks = cu?.tracks ?? [],
    vias = cu?.vias ?? []
  const length = cu?.length ?? 0
  const pts = r.pts ?? []
  const layerAt = (p: Pt) => {
    let best: { d: number; layer: string } = { d: Infinity, layer: tracks[0]?.layer ?? 'F.Cu' }
    for (const t of tracks) {
      const d = distance(itemShape(t), { polys: [], lines: [], points: [p], r: 0 }).d
      if (d < best.d) best = { d, layer: t.layer }
    }
    return best.layer
  }
  const padAt = (p: Pt) =>
    b.items.find((it): it is Pad => it.kind === 'pad' && (r.net === undefined || it.net === r.net) && distance(itemShape(it), { polys: [], lines: [], points: [p], r: 0 }).d < 0.01)
  const ends = [pts[0], pts[pts.length - 1]].flatMap(p => (p ? [padAt(p)] : [])).flatMap(p => (p ? [padName(p)] : []))
  const found = routeFindings(c, r.id)
  const target = routeTarget(c, r)
  const status: RouteRecord['status'] = found.some(f => f.rule === 'route-failed')
    ? 'failed'
    : !tracks.length && !vias.length
      ? 'unrouted'
      : target && length < target.min - 1e-6
        ? 'short'
        : target && length > target.max + 1e-6
          ? 'long'
          : 'ok'
  const call = [...(r.chain ?? [])].reverse().find(x => x.call)
  return {
    kind: 'route',
    ref: r.id,
    ...(/^route:\d+$/.test(r.id) ? {} : { name: r.id.slice(r.id.indexOf('route:') + 'route:'.length) }),
    net: r.net ?? '',
    ...(r.pair ? { pair: r.pair } : {}),
    ends: [...new Set(ends)],
    layers: [...new Set([...tracks.map(t => t.layer), ...vias.flatMap(v => v.layers)])],
    width: r4(tracks[0]?.width ?? 0),
    length: r4(length),
    ...(target ? { target: { min: r4(target.min), max: Number.isFinite(target.max) ? r4(target.max) : null } } : {}),
    ...(r.group !== undefined ? { group: r.group } : {}),
    ...(cu?.skew !== undefined ? { skew: r4(cu.skew) } : {}),
    ...(r.tuned ? { tuned: r4(r.tuned) } : {}),
    status,
    vias: vias.map(uidOf),
    findings: found.map(f => f.id),
    source: sourceRange(r.src, c.root),
    ...(call && r.src ? { call: sourceRange(call, c.root)! } : {}),
    points: pts.map((p, k) => ({ ref: `${r.id}/pt:${k}`, at: pt4(p), layer: layerAt(p) })),
  }
}

const primRecord = (q: Prim): PrimRecord =>
  q.kind === 'arc' ? { kind: 'arc', from: pt4(q.from), to: pt4(q.to), center: pt4(q.center), cw: q.cw } : { kind: 'line', from: pt4(q.from), to: pt4(q.to) }
const ring4 = (r: readonly Pt[]) => r.map(pt4)

function zoneFields(z: Zone) {
  return {
    priority: z.priority,
    area: r4(z.fill.reduce((s, p) => s + polysArea([p]), 0)),
    pieces: z.fill.length,
    ...(z.islandsRemoved ? { islandsRemoved: { count: z.islandsRemoved.count, area: r4(z.islandsRemoved.area) } } : {}),
  }
}

export function itemRecord(c: Ctx, it: Item): ItemRecord {
  const base = {
    kind: 'item' as const,
    ref: uidOf(it),
    id: it.id,
    type: it.kind,
    layer: it.layer,
    net: it.net ?? null,
    ...(it.ref !== undefined ? { part: it.ref } : {}),
    bbox: box4(boxOf(itemShape(it))),
    source: itemSource(c, it),
  }
  switch (it.kind) {
    case 'track':
      return {
        ...base,
        width: r4(it.width),
        length: r4(polylineLength(it.pts)),
        pts: ring4(it.pts),
        ...(it.prims?.some(q => q.kind === 'arc') ? { prims: it.prims.map(primRecord) } : {}),
        ...(it.route ? { route: it.route } : {}),
        ...(it.pair ? { pair: it.pair, role: it.role ?? 'P' } : {}),
      }
    case 'via':
      return {
        ...base,
        layers: [...it.layers],
        at: pt4(it.at),
        size: r4(it.size),
        drill: r4(it.drill),
        ...(it.route ? { route: it.route } : {}),
        ...(it.stitch ? { stitch: true } : {}),
      }
    case 'pad': {
      const drill = boardDrill(it)
      return { ...base, layers: [...it.layers], at: pt4(it.at), num: it.num, shape: it.shape, size: boardSize(it), ...(drill ? { drill: pair4(drill) } : {}) }
    }
    case 'zone':
      return { ...base, ...zoneFields(it) }
    case 'text':
      return {
        ...base,
        at: pt4(it.at),
        rot: r4(it.rot),
        text: it.text,
        ...(it.font ? { font: it.font } : {}),
        size: r4(it.size),
        thickness: r4(it.thickness),
        mirrored: it.mirrored,
        strokes: it.strokes.map(ring4),
        ...(it.polys?.length ? { glyphs: it.polys.map((p: Poly) => ({ outer: ring4(p.outer), holes: p.holes.map(ring4) })) } : {}),
      }
    case 'graphic':
      return {
        ...base,
        width: r4(it.width),
        fill: it.fill,
        closed: [...it.closed],
        paths: it.paths.map(ring4),
        ...(it.prims?.some(ps => ps.some(q => q.kind === 'arc')) ? { prims: it.prims.map(ps => ps.map(primRecord)) } : {}),
      }
  }
}

export const groupRecord = (path: string, parts: string[]): GroupRecord => ({ kind: 'group', ref: path, parts })
export const legRecord = (route: string, leg: number, from: Pt, to: Pt): LegRecord => ({ kind: 'leg', ref: `${route}/leg:${leg}`, route, from: pt4(from), to: pt4(to) })
export const ptRecord = (route: string, n: number, at: Pt): PtRecord => ({ kind: 'pt', ref: `${route}/pt:${n}`, route, at: pt4(at) })
export const pairRecord = (c: Ctx, p: PairInfo): PairRecord => ({
  kind: 'pair',
  ref: p.id,
  nets: p.nets,
  width: r4(p.width),
  gap: r4(p.gap),
  skew: r4(p.skew),
  uncoupled: r4(p.uncoupled),
  maxUncoupled: r4(p.maxUncoupled),
  source: sourceRange(p.src, c.root),
})
export const spanRecord = (ref: string, layers: [string, string], vias: Via[], net?: string): SpanRecord => ({
  kind: 'span',
  ref,
  layers,
  ...(net !== undefined ? { net } : {}),
  vias: vias.map(uidOf),
})
export const planeRecord = (ref: string, layer: string, net: string, zones: Zone[]): PlaneRecord => ({ kind: 'plane', ref, layer, net, zones: zones.map(uidOf) })
export const regionRecord = (ref: string, layer: string, net: string, zone: Zone, fill: Poly): RegionRecord => ({
  kind: 'region',
  ref,
  hash: regionHash(fill),
  layer,
  net,
  zone: zone.uid ?? null,
  area: r4(polysArea([fill])),
  bbox: box4(boxOf({ polys: [fill.outer], lines: [], points: [], r: 0 })),
})
