// The read-only board API of `script`, `repl`, `q` and `pcbjs test`: frozen views over one compiled board whose toJSON gives the records of records.ts.
import type { Board as Model, Footprint, Item, Pt } from '@pcbjs/core/model'
import type { Finding } from '@pcbjs/core/finding'
import { boardIndex, resolveRef, RefError, spanLayers, type Resolved } from '@pcbjs/core/ref'
import { classNameOf, classOf, itemClearance, netClearance, pairProvenance } from '../netclass.js'
import { boxesMeet, boxOf, distance as shapeDistance, itemShape, pointShape, unionBox, type Box, type Shape } from './shape.js'
import {
  groupRecord,
  itemRecord,
  legRecord,
  netRecord,
  padName,
  padRecord,
  padsOf,
  pairRecord,
  partPath,
  partRecord,
  planeRecord,
  pt4,
  ptRecord,
  recordCtx,
  regionRecord,
  routeCopper,
  routeRecord,
  sourceRange,
  spanRecord,
  type Ctx,
  type ItemRecord,
  type NetRecord,
  type PartRecord,
  type RouteRecord,
  type SourceRange,
} from './records.js'

export type Point = [number, number]
export type ItemKind = 'pad' | 'track' | 'arc' | 'via' | 'zone' | 'keepout' | 'text' | 'drawing'

/** One thing the board names; `toJSON` is its record. */
export interface Entity {
  readonly kind: string
  readonly ref: string
  toJSON(): unknown
  readonly [k: string]: unknown
}
export type Part = Entity & Readonly<PartRecord>
export type Net = Entity & Readonly<NetRecord>
export type Route = Entity & Readonly<RouteRecord>
/** kind `drc` or `erc`, as the finding's own */
export type FindingView = Entity & Readonly<Finding>
/** a keepout has no `id` */
export type ItemView = Entity & Readonly<Omit<ItemRecord, 'type' | 'id'>> & { readonly type: Item['kind'] | 'keepout'; readonly id?: number }
export type Target = string | Entity | Point

export interface Board {
  readonly name: string
  readonly target: string | null
  readonly snapshot: string
  readonly rev?: string
  part(ref: string): Part | null
  parts(filter?: { group?: string; prefix?: string; side?: 'F' | 'B' }): Part[]
  net(name: string): Net | null
  nets(): Net[]
  finding(id: string): FindingView | null
  findings(filter?: { rule?: string; severity?: string; ref?: string }): FindingView[]
  route(ref: string): Route | null
  routes(): Route[]
  resolve(reference: string): Entity | null
  readonly items: {
    near(at: Target, r: number, o?: { layer?: string; kinds?: ItemKind[] }): ItemView[]
    on(layer: string, o?: { net?: string; kinds?: ItemKind[] }): ItemView[]
  }
  distance(a: Target, b: Target, o?: { layer?: string }): { d: number; a: Point; b: Point }
  clearance(a: Target, b: Target): { actual: number; required: number; rule: string; from: string }
  bbox(t: Target): { x: number; y: number; w: number; h: number }
  source(t: Target): SourceRange[]
  rulesAt(at: Point, layer: string, net?: string): Record<string, number | string>
  toJSON(): unknown
}

export interface BoardInput {
  board: Model
  /** the board's findings with their ids and fingerprints */
  findings: Finding[]
  snapshot: string
  /** the project root, for source paths */
  root?: string
}

/** What a view measures with: its items, or a point. */
interface Geo {
  items: Item[]
  point?: Pt
  srcs: SourceRange[]
}

const isPoint = (t: unknown): t is Point => Array.isArray(t) && t.length === 2 && t.every(v => typeof v === 'number')
const kindOf = (it: Item): ItemKind => (it.kind === 'graphic' ? 'drawing' : it.kind === 'track' && it.prims?.some(p => p.kind === 'arc') ? 'arc' : it.kind)
const onLayer = (it: Item, layer: string) => it.layer === layer || (it.kind === 'pad' && it.layers.includes(layer)) || (it.kind === 'via' && viaSpans(it.layers, layer))
const COPPER = /^(F|B|In\d+)\.Cu$/
// a via spans every copper layer between its two, which the caller cannot list here, so the ends and through vias are matched
const viaSpans = (layers: [string, string], layer: string) => layers.includes(layer) || (COPPER.test(layer) && layers.includes('F.Cu') && layers.includes('B.Cu'))

export function boardApi(input: BoardInput): Board {
  const { board: b, snapshot } = input
  const ctx: Ctx = recordCtx(b, input.findings, input.root ?? '')
  const geo = new WeakMap<object, () => Geo>()
  const cache = new Map<string, Entity>()

  const view = <R extends object>(kind: string, ref: string, record: () => R, g: () => Geo): Entity & Readonly<R> => {
    const key = `${kind}|${ref}`
    const hit = cache.get(key)
    if (hit) return hit as Entity & Readonly<R>
    const rec = record()
    const v = Object.freeze(Object.assign(Object.create(null), rec, { kind, ref, toJSON: () => rec })) as Entity & Readonly<R>
    let held: Geo | null = null
    geo.set(v, () => (held ??= g()))
    cache.set(key, v)
    return v
  }

  const fps = ctx.fps
  const pathOf = (fp: Footprint) => partPath(ctx, fp)
  const srcOf = (...ss: (SourceRange | null)[]) => ss.filter((s): s is SourceRange => !!s)

  const partView = (fp: Footprint, path = pathOf(fp)): Part =>
    view(
      'part',
      fp.ref,
      () => partRecord(ctx, fp, path),
      () => ({ items: padsOf(ctx, fp), srcs: srcOf(sourceRange(fp.src, ctx.root)) }),
    )
  const netView = (name: string): Net =>
    view(
      'net',
      `net:${name}`,
      () => netRecord(ctx, name),
      () => ({ items: b.items.filter(it => it.net === name && it.kind !== 'text' && it.kind !== 'graphic'), srcs: netRecord(ctx, name).source }),
    )
  const routeView = (r: NonNullable<Model['routes']>[number]): Route =>
    view(
      'route',
      r.id,
      () => routeRecord(ctx, r),
      () => {
        const c = routeCopper(b, r.id)
        return { items: [...c.tracks, ...c.vias], srcs: srcOf(sourceRange(r.src, ctx.root)) }
      },
    )
  const findingView = (f: Finding): FindingView =>
    view(
      f.kind,
      f.id,
      () => f,
      () => ({
        items: f.items.flatMap(u => b.items.filter(it => it.uid === u)),
        point: f.at ?? undefined,
        srcs: f.src.map(s => ({ file: s.file, line: s.start[0], col: s.start[1], endLine: s.end[0], endCol: s.end[1] })),
      }),
    )
  const itemView = (it: Item): ItemView =>
    view(
      'item',
      it.uid ?? `#${it.id}`,
      () => itemRecord(ctx, it),
      () => ({ items: [it], srcs: srcOf(sourceRange(it.src, ctx.root)) }),
    ) as ItemView

  const fromResolved = (r: Resolved, text: string): Entity => {
    switch (r.kind) {
      case 'part':
        return partView(r.footprint, r.path)
      case 'pad':
        return view(
          'pad',
          padName(r.pad),
          () => padRecord(ctx, r.pad),
          () => ({ items: [r.pad], srcs: srcOf(sourceRange(r.pad.src, ctx.root)) }),
        )
      case 'group':
        return view(
          'group',
          r.path,
          () => groupRecord(r.path, r.parts),
          () => ({ items: r.parts.flatMap(p => padsOf(ctx, fps.get(p)!)), srcs: [] }),
        )
      case 'net':
        return netView(r.net.name)
      case 'route':
        return routeView(r.route)
      case 'leg':
        return view(
          'leg',
          `${r.route.id}/leg:${r.leg}`,
          () => legRecord(r.route.id, r.leg, r.from, r.to),
          () => ({ items: [], point: r.from, srcs: srcOf(sourceRange(r.route.src, ctx.root)) }),
        )
      case 'pt':
        return view(
          'pt',
          `${r.route.id}/pt:${r.pt}`,
          () => ptRecord(r.route.id, r.pt, r.at),
          () => ({ items: [], point: r.at, srcs: srcOf(sourceRange(r.route.src, ctx.root)) }),
        )
      case 'pair':
        return view(
          'pair',
          r.pair.id,
          () => pairRecord(ctx, r.pair),
          () => ({ items: b.items.filter(it => it.kind === 'track' && it.pair === r.pair.id), srcs: srcOf(sourceRange(r.pair.src, ctx.root)) }),
        )
      case 'item':
        return itemView(r.item)
      case 'finding': {
        const f = ctx.findings.find(x => x.id === r.finding.id)
        if (!f) throw new RefError(`${text}: no finding ${r.finding.id}`)
        return findingView(f)
      }
      case 'span':
        return view(
          'span',
          text,
          () => spanRecord(text, r.layers, r.vias, r.net),
          () => ({ items: r.vias, srcs: [] }),
        )
      case 'plane':
        return view(
          'plane',
          text,
          () => planeRecord(text, r.layer, r.net, r.zones),
          () => ({ items: r.zones, srcs: srcOf(...r.zones.map(z => sourceRange(z.src, ctx.root))) }),
        )
      case 'region':
        return view(
          'region',
          text,
          () => regionRecord(text, r.layer, r.net, r.zone, r.fill),
          () => ({ items: [r.zone], srcs: srcOf(sourceRange(r.zone.src, ctx.root)) }),
        )
    }
  }

  /** null when nothing matches; a RefError naming each candidate when several do. */
  const resolve = (text: string): Entity | null => {
    try {
      return fromResolved(resolveRef(boardIndex(b), text), text)
    } catch (e) {
      if (e instanceof RefError && /names several/.test(e.message)) throw e
      if (e instanceof RefError) return null
      throw e
    }
  }

  const entity = (t: Target): Geo => {
    if (isPoint(t)) return { items: [], point: t, srcs: [] }
    const v = typeof t === 'string' ? resolve(t) : t
    const g = v && geo.get(v as object)?.()
    if (!g) throw new RefError(`${typeof t === 'string' ? t : (t as Entity)?.ref}: names nothing on ${b.name}`)
    return g
  }
  const shapes = (g: Geo, layer?: string): { shape: Shape; item?: Item }[] => {
    const out: { shape: Shape; item?: Item }[] = g.items.filter(it => !layer || onLayer(it, layer)).map(it => ({ shape: itemShape(it), item: it }))
    if (g.point) out.push({ shape: pointShape(g.point) })
    return out
  }
  const nearest = (a: Target, c: Target, layer?: string) => {
    let best: { d: number; a: Pt; b: Pt; ia?: Item; ib?: Item } = { d: Infinity, a: [0, 0], b: [0, 0] }
    for (const x of shapes(entity(a), layer))
      for (const y of shapes(entity(c), layer)) {
        const d = shapeDistance(x.shape, y.shape)
        if (d.d < best.d) best = { ...d, ia: x.item, ib: y.item }
      }
    return best
  }

  // the spatial index: items by cells of 2 mm, built on first use
  const CELL = 2
  let grid: Map<string, Item[]> | null = null
  const cellsOf = (bx: Box) => {
    const out: string[] = []
    for (let i = Math.floor(bx.x / CELL); i <= Math.floor((bx.x + bx.w) / CELL); i++)
      for (let j = Math.floor(bx.y / CELL); j <= Math.floor((bx.y + bx.h) / CELL); j++) out.push(`${i},${j}`)
    return out
  }
  const index = () => {
    if (grid) return grid
    grid = new Map()
    for (const it of b.items) {
      const bx = boxOf(itemShape(it))
      if (!bx) continue
      for (const k of cellsOf(bx)) (grid.get(k) ?? grid.set(k, []).get(k)!).push(it)
    }
    return grid
  }
  const keepoutViews = (layer?: string): ItemView[] =>
    (b.keepouts ?? [])
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => !layer || k.layers.includes(layer))
      .map(
        ({ k, i }) =>
          view(
            'item',
            `keepout:${i + 1}`,
            () => ({
              kind: 'item',
              ref: `keepout:${i + 1}`,
              type: 'keepout',
              layer: k.layers[0] ?? '',
              layers: k.layers,
              net: null,
              bbox: unionBox(k.outline.map(r => boxOf({ polys: [r], lines: [], points: [], r: 0 }))),
              except: k.except ?? [],
              ...(k.ref ? { part: k.ref } : {}),
              source: sourceRange(k.src, ctx.root),
            }),
            () => ({ items: [], srcs: srcOf(sourceRange(k.src, ctx.root)) }),
          ) as ItemView,
      )
  const wants = (kinds?: ItemKind[]) => (it: Item) => !kinds?.length || kinds.includes(kindOf(it))

  const api: Board = {
    name: b.name,
    target: b.variant?.name ?? null,
    snapshot,
    ...(b.rev ? { rev: b.rev } : {}),
    part: ref => {
      const v = resolve(ref)
      return v?.kind === 'part' ? (v as Part) : null
    },
    parts: (f = {}) =>
      b.footprints
        .filter(fp => !f.side || fp.side === f.side)
        .filter(fp => !f.prefix || fp.ref.replace(/\d.*$/, '') === f.prefix)
        .filter(fp => !f.group || pathOf(fp).split('/').slice(0, -1).includes(f.group))
        .map(fp => partView(fp)),
    net: name => {
      const n = name.startsWith('net:') ? name.slice(4) : name
      return b.nets.some(x => x.name === n) ? netView(n) : null
    },
    nets: () => b.nets.map(n => netView(n.name)),
    finding: id => {
      const f = ctx.findings.find(x => x.id === id)
      return f ? findingView(f) : null
    },
    findings: (f = {}) =>
      ctx.findings
        .filter(x => !f.rule || x.rule === f.rule)
        .filter(x => !f.severity || x.severity === f.severity)
        .filter(x => !f.ref || x.refs.some(r => r === f.ref || r.startsWith(f.ref + '/')))
        .map(findingView),
    route: ref => {
      const id = ref.includes('route:') ? ref : `route:${ref}`
      const r = b.routes?.find(x => x.id === id)
      return r ? routeView(r) : null
    },
    routes: () => (b.routes ?? []).map(routeView),
    resolve,
    items: Object.freeze({
      near(at: Target, r: number, o: { layer?: string; kinds?: ItemKind[] } = {}) {
        const g = entity(at)
        const own = new Set(g.items)
        const probes = shapes(g, undefined).map(s => s.shape)
        const bx = unionBox(probes.map(boxOf))
        if (!bx) return []
        const seen = new Set<Item>()
        const out: ItemView[] = []
        for (const k of cellsOf({ x: bx.x - r, y: bx.y - r, w: bx.w + 2 * r, h: bx.h + 2 * r }))
          for (const it of index().get(k) ?? []) {
            if (seen.has(it) || own.has(it)) continue
            seen.add(it)
            if ((o.layer && !onLayer(it, o.layer)) || !wants(o.kinds)(it)) continue
            const s = itemShape(it)
            const ib = boxOf(s)
            if (!ib || !boxesMeet(bx, ib, r)) continue
            if (probes.some(p => shapeDistance(p, s).d <= r)) out.push(itemView(it))
          }
        return out.sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0))
      },
      on(layer: string, o: { net?: string; kinds?: ItemKind[] } = {}) {
        const span = spanLayers(layer)
        const hit = span ? b.items.filter(it => it.kind === 'via' && [...it.layers].sort().join() === [...span].sort().join()) : b.items.filter(it => onLayer(it, layer))
        const items = hit.filter(it => (o.net === undefined || it.net === o.net) && wants(o.kinds)(it)).map(itemView)
        return !span && (!o.kinds?.length || o.kinds.includes('keepout')) && o.net === undefined ? [...items, ...keepoutViews(layer)] : items
      },
    }),
    distance(a, c, o = {}) {
      const n = nearest(a, c, o.layer)
      if (!Number.isFinite(n.d)) throw new RefError(`no copper or ink of both on ${o.layer ?? 'any layer'}`)
      return { d: Math.round(n.d * 1e4) / 1e4, a: pt4(n.a), b: pt4(n.b) }
    },
    clearance(a, c) {
      const n = nearest(a, c)
      if (!Number.isFinite(n.d)) throw new RefError('no copper of both to measure')
      const both = n.ia && n.ib
      const required = both ? itemClearance(b, n.ia!, n.ib!) : netClearance(b, n.ia?.net ?? n.ib?.net)
      const prov = both ? pairProvenance(b, n.ia!, n.ib!) : []
      return { actual: Math.round(n.d * 1e4) / 1e4, required, rule: 'clearance', from: prov[0] ? `${prov[0].from}${prov[0].name ? ` ${prov[0].name}` : ''}` : 'rules' }
    },
    bbox(t) {
      const bx = unionBox(shapes(entity(t)).map(s => boxOf(s.shape)))
      if (!bx) throw new RefError('nothing to bound')
      const r4 = (v: number) => Math.round(v * 1e4) / 1e4
      return { x: r4(bx.x), y: r4(bx.y), w: r4(bx.w), h: r4(bx.h) }
    },
    source: t => [...entity(t).srcs],
    rulesAt(at, layer, net) {
      const cls = classOf(b, net)
      const out: Record<string, number | string> = {
        layer,
        class: classNameOf(b, net) ?? 'default',
        clearance: netClearance(b, net),
        trackWidth: cls?.width ?? b.rules.minTrackWidth,
        viaDrill: cls?.via?.drill ?? b.rules.minViaDrill,
        viaSize: cls?.via?.size ?? b.rules.minViaDiameter,
        holeClearance: b.rules.holeClearance,
        edgeClearance: b.rules.edgeClearance,
      }
      const cu = b.stackup.layers.find(l => l.type === 'copper' && l.name === layer)
      if (cu?.type === 'copper' && cu.weight !== undefined) out.copperWeight = cu.weight
      if (cls?.gap !== undefined) out.gap = cls.gap
      if (cls?.impedance !== undefined) out.impedance = cls.impedance
      const ko = (b.keepouts ?? []).findIndex(
        k => k.layers.includes(layer) && k.outline.some(r => shapeDistance({ polys: [r], lines: [], points: [], r: 0 }, pointShape(at)).d === 0),
      )
      if (ko >= 0) out.keepout = `keepout:${ko + 1}`
      return out
    },
    toJSON: () => ({
      name: b.name,
      target: b.variant?.name ?? null,
      snapshot,
      ...(b.rev ? { rev: b.rev } : {}),
      parts: b.footprints.length,
      nets: b.nets.length,
      findings: ctx.findings.length,
    }),
  }
  return Object.freeze(api)
}
