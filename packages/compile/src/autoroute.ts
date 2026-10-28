// Grid A* per leg with vias between adjacent layers; legs that do not fit negotiate congestion, PathFinder style. See docs/autorouter.md.
import type {
  AutoRouteJob,
  Board,
  DrcMarker,
  Item,
  JobAvoid,
  JobParams,
  Keepout,
  Pad,
  PairInfo,
  Prim,
  Pt,
  Ring,
  RouteFailure,
  RouteRecord,
  RouteStep,
  RoutingReport,
  Track,
  Via,
} from '@pcbjs/core/model'
import { tuneRoutes, type PairFrees, type TuneRoute } from './tune.js'
import { tunePairCentre } from './pair-tune.js'
import { routeLength } from './length.js'
import type { ResolvedRules as Rules, Src } from '@pcbjs/core/types'
import type { AutoRouteParams, RouteContext, Pos, ResolvedPos, RouteFn, RouteRequest, RouteResult } from '@pcbjs/core/types'
import { BASE_AUTOROUTE, mergeAutoroute } from '@pcbjs/core/board-spec'
import { CompileError, PART_REFS } from './flatten.js'
import { isPinRef, partOf, pinOfPad } from '@pcbjs/core/schematic'
import { apply, IDENTITY, invert, offset, polysToRings, union } from './geom.js'
import { copperBox, copperLayersOf, copperRings } from './copper.js'
import { defaultVia } from '@pcbjs/core/rules'
import { connectivity, joined } from './connectivity.js'
import { copperLayers, isCopper, resolveLayer } from './layers.js'
import { circleRing } from './path.js'
import { at as parseAt, coordString, mm } from '@pcbjs/core/units'
import { RouteCache, ROUTER_VERSION, hash, type LegEntry, type LockEntry, type PairState } from './route-cache.js'
import { netLoops } from './loops.js'
import { classOf, itemClearance, maxClearance, maxHoleClearance, notePair, overrideBetween, pairGapOf } from './netclass.js'
import { PairGeometryError } from './pair.js'
import { layPairJob, pairStub, type PairContext, type PairJob, type PairLaid } from './pair-lay.js'
import { neckLength, neckOf, neckPieces, neckPrims, neckStub, padMinor, padReach } from './neck.js'
import { planCorner, primsOf, trackShape } from './round.js'
import type { IsFree } from './length.js'
import { itemLabel } from './route-findings.js'
import {
  boxOf,
  exemptKey,
  fill,
  fillAdd,
  hitsEdge,
  inside,
  isNpth,
  keptSet,
  outer,
  ringSet,
  segCross,
  segHits,
  solidRings,
  storeOf,
  viaKeptSet,
  type Grid,
  type RingSet,
} from './obstacles.js'

const MAX_STATES = 3e7
/** Cost factor of a move across the preferred direction of its layer. */
const PREFER_PENALTY = 1.5
/** Cost factor of a move into a soft keepout. */
const AVOID_PENALTY = 10
/** Radius of the soft keepout around a point in `avoid` (mm). */
const AVOID_RADIUS = 0.5
/** How many rounds of negotiation run when the parameters do not say. */
const RIPUP = 12
/** The present sharing factor of the first negotiation round, and its growth per round. */
const PRES_FIRST = 10
const PRES_GROW = 1.5
/** From this round on, legs within NEIGHBOUR_REACH mm of a collision route again too. */
const NEIGHBOURS_FROM = 2
const NEIGHBOUR_REACH = 1
/** What a round adds to the history cost of a cell a leg shared with another net. */
const HIST_STEP = 1
/** Default maxDetour: RATIO times the straight line, or the line plus FLOOR mm. */
const DETOUR_RATIO = 3
const DETOUR_FLOOR = 10

function layerName(board: Board, name: string): string {
  try {
    return resolveLayer(name, false, new Set(copperLayers(board.copper)))
  } catch (e) {
    throw new CompileError((e as Error).message)
  }
}

/** A pad's own layer for smd, `defaultLayer` for tht when the pad is on it. */
function padLayer(pad: Pad, defaultLayer: string): string {
  const cu = pad.layers.filter(isCopper)
  if (!cu.length) throw new CompileError(`pad ${pad.ref}.${pad.num} has no copper`, pad.src)
  return cu.includes(defaultLayer) ? defaultLayer : cu[0]
}
/** A pad as a route end, with every copper layer it may be reached on when it has several. */
function padEnd(pad: Pad, defaultLayer: string): ResolvedPos {
  const layer = padLayer(pad, defaultLayer),
    cu = pad.layers.filter(isCopper)
  return { x: pad.at[0], y: pad.at[1], layer, ...(cu.length > 1 ? { layers: cu } : {}) }
}

export function resolvePos(board: Board, pos: Pos, defaultLayer: string): ResolvedPos {
  if (isPinRef(pos)) {
    const st = partOf(pos.part)
    const ref = st && PART_REFS.get(board)?.get(st)
    if (!st || !ref) throw new CompileError(`${st ? st.label : 'a part'} pin ${pos.pin} is a route end, but the part is not placed on this board`)
    const pad = board.items.find((i): i is Pad => i.kind === 'pad' && i.ref === ref && pinOfPad(st.pins, i) === pos.pin)
    if (!pad) throw new CompileError(`${ref} has no pad for pin ${pos.pin}`)
    return padEnd(pad, defaultLayer)
  }
  if (typeof pos === 'string') {
    let c: ReturnType<typeof coordString>
    try {
      c = coordString(pos)
    } catch (e) {
      throw new CompileError((e as Error).message)
    }
    if (c) return { x: c.x, y: c.y, layer: c.layer ? layerName(board, c.layer) : defaultLayer }
    const dot = pos.indexOf('.')
    if (dot <= 0 || dot === pos.length - 1)
      throw new CompileError(`bad position ${JSON.stringify(pos)}: expected "REF.PAD", "x y [layer]", a tuple [x, y, layer?] or { at, layer? }`)
    const ref = pos.slice(0, dot),
      num = pos.slice(dot + 1)
    const pads = board.items.filter((i): i is Pad => i.kind === 'pad' && i.ref === ref)
    if (!pads.length) throw new CompileError(`no footprint ${ref} for position ${JSON.stringify(pos)}`)
    const pad = pads.find(p => p.num === num) ?? pads.find(p => p.name === num)
    if (!pad) throw new CompileError(`${ref} has no pad ${num} (position ${JSON.stringify(pos)})`)
    return padEnd(pad, defaultLayer)
  }
  if (Array.isArray(pos)) return { x: mm(pos[0]), y: mm(pos[1]), layer: pos[2] ? layerName(board, pos[2]) : defaultLayer }
  if (pos && typeof pos === 'object' && 'at' in pos) {
    const [x, y] = parseAt(pos.at)
    // a via end meets the route on `defaultLayer` when it spans it, else on its first layer
    const ls = (pos as { layers?: unknown }).layers
    if (Array.isArray(ls) && ls.length && !pos.layer) return { x, y, layer: ls.includes(defaultLayer) ? defaultLayer : ls[0], ...(ls.length > 1 ? { layers: [...ls] } : {}) }
    return { x, y, layer: pos.layer ? layerName(board, pos.layer) : defaultLayer }
  }
  throw new CompileError(`bad position ${JSON.stringify(pos)}`)
}

export { solidRings }

interface LayoutInternals {
  board: Board
  rules: Rules
  clearanceTo(net: string | undefined, other: string | undefined): number
  /** `via`: the set for a via's copper, without the keepouts */
  obstacleSet(layer: string, net: string | undefined, width: number, via?: boolean): RingSet
  allowedSet(width: number): RingSet | null
  blockedAt(layer: string, net: string | undefined, width: number, x: number, y: number, via?: boolean): boolean
  segBlocked(layer: string, a: Pt, b: Pt, net: string | undefined, width: number): boolean
  trackGrid(g: Grid, layer: string, net: string | undefined, width: number, via: boolean): Uint8Array
  /** holes, own-net SMD pads and keepouts on this layer */
  viaGrid(g: Grid, layer: string, net: string | undefined, size: number, drill: number, viaInPad: boolean): Uint8Array
}
const internals = new WeakMap<RouteContext, LayoutInternals>()

/** Negotiation's side of one search: `field` counts the other nets' legs per cell; the search leaves its shared cells in `shared`. */
interface Congestion {
  pres: number
  field(g: Grid, layers: string[], spans: string[][], tw: number, vw: number, vd: number): CongestionField
  shared?: { hist: Float32Array; cell: number }[]
}
interface CongestionField {
  occ: Uint16Array[]
  viaOcc: Uint16Array[]
  hist: Float32Array[]
  regions: RingSet[][]
}
const congestionOf = new WeakMap<RouteRequest, Congestion>()

/** A leg's own net: the search starts anywhere on `src` and ends on `dst`, or at the end points when null; `block` is out of reach but near `exempt`, the end items. */
interface Terms {
  src: Item[] | null
  dst: Item[] | null
  block: Item[]
  exempt: Item[]
  gap: number
  grow(it: Item, layer: string, d: number): RingSet | null
}
const termsOf = new WeakMap<RouteRequest, Terms>()
/** A polyline of copper of one width on one layer. */
interface Strip {
  layer: string
  pts: Pt[]
  width: number
}
/** The end of a joining leg kept off a trunk too narrow for it: `kept` when it joined anyway and the trunk stayed thin. */
interface Narrow {
  side: 0 | 1
  kept: boolean
}
/** Tracks that widen a trunk under a joining leg; they lie on the trunk, so they are no trunk themselves. */
const overlays = new WeakSet<Item>()
/** How far from same-net copper a track centre still touches it, for a track of width w. */
const touchOf = (w: number) => Math.max(0.001, w / 2 - 0.005)

function holesOf(items: Item[]): { it: Pad | Via; at: Pt; r: number }[] {
  return items.flatMap((it): { it: Pad | Via; at: Pt; r: number }[] =>
    it.kind === 'pad' && it.drill ? [{ it, at: it.at, r: Math.max(...it.drill) / 2 }] : it.kind === 'via' ? [{ it, at: it.at, r: it.drill / 2 }] : [],
  )
}

/** The board's obstacles for one route, without `exclude`; `soft` items are negotiation's to price, and `twin.partner` counts as `twin.net`. */
export function buildLayout(board: Board, exclude: Set<number> = new Set(), rules: Rules = board.rules, soft: Item[] = [], twin?: { net: string; partner: string }): RouteContext {
  const r = rules
  const cu = copperLayers(board.copper)
  const softIds = new Set(soft.map(it => it.id))
  const snap = new Set(board.items)
  const left = (it: Item) => exclude.has(it.id) || softIds.has(it.id)
  const items = board.items.filter(it => !left(it))
  const store = storeOf(board, r, cu)
  const own = (net: string | undefined, other: string | undefined) => net !== undefined && (other === net || (!!twin && net === twin.net && other === twin.partner))
  // never below the rules' clearance; a pad's override wins over the other net's class
  const clearanceTo = (net: string | undefined, other: string | undefined, it?: Item): number => {
    const pad = (it && overrideBetween(board, { kind: 'track', net }, it)) || 0
    if (!board.classes) return Math.max(r.clearance, pad)
    return Math.max(r.clearance, classOf(board, net)?.clearance ?? 0, pad || (classOf(board, other)?.clearance ?? 0))
  }
  const keepouts: Keepout[] = board.keepouts ?? []
  const obs = new Map<string, RingSet>()
  const allowed = new Map<number, RingSet | null>()
  const kept = new Map<string, RingSet | null>()
  // keyed on the keepouts the net is let into through `except`
  const exempt = new Map<string, string>()
  const exemptOf = (net: string | undefined) => {
    const k = net ?? ''
    let e = exempt.get(k)
    if (e === undefined) exempt.set(k, (e = exemptKey(keepouts, net)))
    return e
  }
  const keptOf = (layer: string, w: number, net: string | undefined) => {
    const k = `${layer}\u0000${w}\u0000${exemptOf(net)}`
    let s = kept.get(k)
    if (s === undefined) kept.set(k, (s = keptSet(keepouts, layer, w, net)))
    return s
  }

  // only for RouteContext.obstacles
  let holes: { it: Pad | Via; at: Pt; r: number }[] | undefined
  const obstacleSet = (layer: string, net: string | undefined, width: number, via = false): RingSet => {
    const key = `${layer}\u0000${net ?? ''}\u0000${width}\u0000${via}`
    let s = obs.get(key)
    if (s) return s
    const byGap = new Map<number, Ring[]>()
    for (const it of items) {
      if (own(net, it.net)) continue
      if (!copperLayersOf(it, cu).includes(layer)) continue
      const gap =
        (it.kind === 'track' || it.kind === 'via') && pairGapOf(board, net, it.net) !== undefined
          ? itemClearance(board, { kind: 'track', net }, it, r)
          : clearanceTo(net, it.net, it)
      let rs = byGap.get(gap)
      if (!rs) byGap.set(gap, (rs = []))
      rs.push(...solidRings(it, layer))
    }
    const parts = [...byGap.entries()].sort((a, b) => a[0] - b[0]).map(([gap, rs]) => polysToRings(offset(rs, gap + width / 2)))
    const grown = parts.length > 1 ? polysToRings(union(parts.flat())) : (parts[0] ?? [])
    const holeRings = (holes ??= holesOf(items))
      .filter(h => (h.it.kind === 'pad' && h.it.type === 'npth') || !own(net, h.it.net))
      .map(h => circleRing(h.at[0], h.at[1], h.r + store.holeGap(h.it) + width / 2))
    const k = via ? null : keptOf(layer, width, net)
    const extra = [...holeRings, ...(k ? k.rings : [])]
    s = ringSet(extra.length ? polysToRings(union([...grown, ...extra])) : grown)
    obs.set(key, s)
    return s
  }
  const allowedSet = (width: number): RingSet | null => {
    if (!board.outline.length) return null
    let s = allowed.get(width)
    if (s === undefined) {
      s = ringSet(polysToRings(offset(board.outline, -(r.edgeClearance + width / 2))))
      allowed.set(width, s)
    }
    return s
  }

  // exact tests, items in 1 mm buckets
  const maxGap = Math.max(r.clearance, maxClearance(board), r.holeClearance, maxHoleClearance(board))
  let buckets: Map<number, Item[]> | undefined
  const near = (x0: number, y0: number, x1: number, y1: number, pad: number): Item[] => {
    if (!buckets) {
      buckets = new Map()
      for (const it of items) {
        const b = store.rec(it).box
        if (!b) continue
        for (let i = Math.floor(b[0]); i <= Math.floor(b[2]); i++)
          for (let j = Math.floor(b[1]); j <= Math.floor(b[3]); j++) {
            const k = (i + 32768) * 65536 + (j + 32768)
            let l = buckets.get(k)
            if (!l) buckets.set(k, (l = []))
            l.push(it)
          }
      }
    }
    const out: Item[] = [],
      seen = new Set<Item>()
    for (let i = Math.floor(x0 - pad); i <= Math.floor(x1 + pad); i++)
      for (let j = Math.floor(y0 - pad); j <= Math.floor(y1 + pad); j++)
        for (const it of buckets.get((i + 32768) * 65536 + (j + 32768)) ?? []) {
          if (seen.has(it)) continue
          seen.add(it)
          const b = store.rec(it).box!
          if (b[0] - pad <= x1 && x0 <= b[2] + pad && b[1] - pad <= y1 && y0 <= b[3] + pad) out.push(it)
        }
    return out
  }
  const setsNear = (layer: string, net: string | undefined, w: number, x0: number, y0: number, x1: number, y1: number): RingSet[] => {
    const cn = store.classGap(net),
      out: RingSet[] = [],
      sn = store.scopeOf(net) ? net : undefined
    for (const it of near(x0, y0, x1, y1, maxGap + w / 2 + 1e-6)) {
      const rec = store.rec(it),
        o = own(net, it.net)
      // a pair's partner keeps the pair gap, which may be below the class clearance
      const gap =
        (it.kind === 'track' || it.kind === 'via') && pairGapOf(board, net, it.net) !== undefined
          ? itemClearance(board, { kind: 'track', net }, it, r)
          : store.gap(cn, it.net, it, sn)
      if (!o) {
        const s = store.copper(it, rec, layer, gap + w / 2)
        if (s) out.push(s)
      }
      if (!o || isNpth(it)) {
        const s = store.hole(rec, store.holeGap(it) + w / 2)
        if (s) out.push(s)
      }
    }
    return out
  }
  const blockedAt = (layer: string, net: string | undefined, w: number, x: number, y: number, via = false): boolean => {
    for (const s of setsNear(layer, net, w, x, y, x, y)) if (inside(s, x, y)) return true
    const k = via ? null : keptOf(layer, w, net)
    return !!k && inside(k, x, y)
  }
  const segBlocked = (layer: string, a: Pt, b: Pt, net: string | undefined, w: number): boolean => {
    for (const s of setsNear(layer, net, w, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) if (segHits(s, a, b)) return true
    const k = keptOf(layer, w, net)
    return !!k && segHits(k, a, b)
  }

  // the store's counts less what this layout leaves out and the routed net's copper
  const trackGrid = (g: Grid, layer: string, net: string | undefined, w: number, via: boolean): Uint8Array => {
    const cn = store.classGap(net),
      sn = store.scopeOf(net) ? net : undefined
    const a = store.trackCounts(g, layer, w, cn, net).slice()
    for (const [it, rec] of store.items) {
      if (!snap.has(it) || left(it)) store.trackFill(g, it, rec, layer, w, cn, a, -1, true, true, sn)
      else if (own(net, it.net)) store.trackFill(g, it, rec, layer, w, cn, a, -1, true, !isNpth(it), sn)
    }
    for (const it of items)
      if (!store.has(it)) {
        const o = own(net, it.net)
        store.trackFill(g, it, store.rec(it), layer, w, cn, a, 1, !o, !o || isNpth(it), sn)
      }
    const n = g.nx * g.ny,
      out = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (a[i]) out[i] = 1
    const al = store.mask(`al\u0000${r.edgeClearance}\u0000${w}`, g, () => allowedSet(w))
    if (al) for (let i = 0; i < n; i++) if (!al[i]) out[i] = 1
    const k = via ? null : store.mask(`k\u0000${layer}\u0000${w}\u0000${exemptOf(net)}`, g, () => keptOf(layer, w, net))
    if (k) for (let i = 0; i < n; i++) if (k[i]) out[i] = 1
    return out
  }
  const viaGrid = (g: Grid, layer: string, net: string | undefined, size: number, drill: number, viaInPad: boolean): Uint8Array => {
    // minHoleToHole from every hole of any net but the soft legs'
    const a = store.holeCounts(g, drill).slice()
    for (const [it, rec] of store.items) if (rec.hole && (!snap.has(it) || softIds.has(it.id))) store.holeFill(g, rec, drill, a, -1)
    for (const it of snap) if (!softIds.has(it.id) && !store.has(it)) store.holeFill(g, store.rec(it), drill, a, 1)
    const n = g.nx * g.ny,
      out = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (a[i]) out[i] = 1
    if (!viaInPad && net !== undefined)
      for (const it of items)
        if (it.kind === 'pad' && it.type === 'smd' && own(net, it.net) && it.layers.includes(layer)) fill(g, ringSet(polysToRings(offset(solidRings(it, layer), size / 2))), out, 1)
    const k = store.mask(`vk\u0000${layer}\u0000${size}\u0000${exemptOf(net)}`, g, () => viaKeptSet(keepouts, layer, size, net))
    if (k) for (let i = 0; i < n; i++) if (k[i]) out[i] = 1
    return out
  }
  const bb = board.outline.length ? board.bbox : { x: board.bbox.x - 2, y: board.bbox.y - 2, w: board.bbox.w + 4, h: board.bbox.h + 4 }
  const layout: RouteContext = {
    rules: r,
    copperLayers: cu,
    outline: board.outline,
    bbox: bb,
    obstacles: (layer, net, width) => obstacleSet(layer, net, width).rings,
    isFree: (layer, x, y, net, width) => {
      const a = allowedSet(width)
      if (a && !inside(a, x, y)) return false
      return !blockedAt(layer, net, width, x, y)
    },
  }
  const inn: LayoutInternals = { board, rules: r, obstacleSet, allowedSet, clearanceTo, blockedAt, segBlocked, trackGrid, viaGrid }
  internals.set(layout, inn)
  return layout
}

/** Point and segment tests, through the internals when the layout was built here. */
function queries(layout: RouteContext) {
  const inn = internals.get(layout)
  const sets = new Map<string, RingSet>()
  const obstacleSet = (l: string, n: string | undefined, w: number) => {
    const k = `${l}\u0000${n ?? ''}\u0000${w}`
    let s = sets.get(k)
    if (!s) sets.set(k, (s = ringSet(layout.obstacles(l, n, w))))
    return s
  }
  const allowedCache = new Map<number, RingSet | null>()
  const allowedSet = inn
    ? inn.allowedSet
    : (w: number) => {
        if (!layout.outline.length) return null
        let s = allowedCache.get(w)
        if (s === undefined) {
          s = ringSet(polysToRings(offset(layout.outline, -(layout.rules.edgeClearance + w / 2))))
          allowedCache.set(w, s)
        }
        return s
      }
  const blockedAt = inn ? inn.blockedAt : (l: string, n: string | undefined, w: number, x: number, y: number) => inside(obstacleSet(l, n, w), x, y)
  const segFree = (layer: string, a: Pt, b: Pt, net: string | undefined, width: number): boolean => {
    if (inn ? inn.segBlocked(layer, a, b, net, width) : segHits(obstacleSet(layer, net, width), a, b)) return false
    const al = allowedSet(width)
    if (al && (!inside(al, a[0], a[1]) || !inside(al, b[0], b[1]) || hitsEdge(al, a, b))) return false
    return true
  }
  return { blockedAt, allowedSet, segFree }
}

const rasterCache = new WeakMap<RouteContext, Map<string, Uint8Array>>()

/** 1 where a track of this width and net may not have its centre line. */
function blockedGrid(layout: RouteContext, g: Grid, layer: string, net: string | undefined, width: number, via = false): Uint8Array {
  let m = rasterCache.get(layout)
  if (!m) {
    m = new Map()
    rasterCache.set(layout, m)
  }
  const key = `${layer}\u0000${net ?? ''}\u0000${width}\u0000${via}\u0000${g.p}\u0000${g.x0}\u0000${g.y0}`
  const hit = m.get(key)
  if (hit) return hit
  const inn = internals.get(layout)
  let out: Uint8Array
  if (inn) out = inn.trackGrid(g, layer, net, width, via)
  else {
    const q = queries(layout)
    const n = g.nx * g.ny
    out = new Uint8Array(n)
    const al = q.allowedSet(width)
    if (al) {
      const inAl = new Uint8Array(n)
      fill(g, al, inAl, 1)
      for (let i = 0; i < n; i++) out[i] = inAl[i] ^ 1
    }
    fill(g, ringSet(layout.obstacles(layer, net, width)), out, 1)
  }
  m.set(key, out)
  return out
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000)

export const straight: RouteFn = req => {
  const a: Pt = [req.start.x, req.start.y],
    b: Pt = [req.end.x, req.end.y]
  const out: RouteResult = { tracks: [{ layer: req.start.layer, pts: [a, b] }], vias: [] }
  if (req.end.layer !== req.start.layer) out.vias.push({ x: b[0], y: b[1], layers: [req.start.layer, req.end.layer] })
  return out
}

/** 1 where a via centre may not go because of this layer, beyond other nets' copper. */
function viaGrid(layout: RouteContext, g: Grid, layer: string, net: string | undefined, size: number, drill: number, viaInPad: boolean): Uint8Array | null {
  const inn = internals.get(layout)
  if (!inn) return null
  let m = rasterCache.get(layout)
  if (!m) {
    m = new Map()
    rasterCache.set(layout, m)
  }
  const key = `via\u0000${layer}\u0000${net ?? ''}\u0000${size}\u0000${drill}\u0000${viaInPad}\u0000${g.p}\u0000${g.x0}\u0000${g.y0}`
  const hit = m.get(key)
  if (hit) return hit
  const out = inn.viaGrid(g, layer, net, size, drill, viaInPad)
  m.set(key, out)
  return out
}

let buffers: { gs: Float64Array; bs: Float32Array; parent: Int32Array; closed: Uint8Array } | null = null
function searchBuffers(S: number) {
  if (!buffers || buffers.gs.length < S) buffers = { gs: new Float64Array(S), bs: new Float32Array(S), parent: new Int32Array(S), closed: new Uint8Array(S) }
  return buffers
}

export const maze: RouteFn = (req, layout) => {
  const maxVias = req.maxVias ?? Infinity
  const layers = maxVias === 0 ? [req.start.layer] : req.layers.length ? req.layers : [req.start.layer]
  const endLayers = (e: typeof req.start) => [...new Set([e.layer, ...(e.layers ?? [])])].map(l => layers.indexOf(l)).filter(i => i >= 0)
  const ss = endLayers(req.start),
    es = endLayers(req.end)
  if (!ss.length) throw new Error(`the start layer ${req.start.layer} is not one of the routing layers`)
  if (!es.length)
    throw new Error(
      maxVias === 0 ? `it changes layer from ${req.start.layer} to ${req.end.layer}, but maxVias is 0` : `the end layer ${req.end.layer} is not one of the routing layers`,
    )
  const p = req.pitch ?? Math.max(0.05, Math.min(0.1, req.width / 2))
  const margin = req.clearance ?? BASE_AUTOROUTE.clearance
  const viaCost = req.viaCost ?? BASE_AUTOROUTE.viaCost
  const ortho = req.bend === '90'
  const bb = layout.bbox
  const g: Grid = { x0: bb.x, y0: bb.y, p, nx: Math.floor(bb.w / p) + 1, ny: Math.floor(bb.h / p) + 1 }
  const L = layers.length,
    N = g.nx * g.ny
  // a finite maxVias makes the via count part of the state: K copies of the layer stack
  const K = Number.isFinite(maxVias) && L > 1 ? maxVias + 1 : 1
  const LN = L * N
  if (K * LN > MAX_STATES) throw new Error(`the routing grid is too large (${g.nx} x ${g.ny} x ${L}${K > 1 ? ` x ${K}` : ''}), raise pitch or lower maxVias`)
  const { tw, vw, vd } = legWidths(req, layout)
  const blocked = layers.map(l => blockedGrid(layout, g, l, req.net, tw))
  // a via is tested on every copper layer between its two routing layers
  const stack = layout.copperLayers
  const viaBlocked: Uint8Array[] = []
  const spans: string[][] = []
  for (let l = 0; l + 1 < L; l++) {
    const span = spanOf(stack, layers[l], layers[l + 1])
    spans.push(span)
    const v = new Uint8Array(N)
    for (const sl of span) {
      const a = blockedGrid(layout, g, sl, req.net, vw, true)
      for (let i = 0; i < N; i++) v[i] |= a[i]
      const h = viaGrid(layout, g, sl, req.net, req.via.size + 2 * margin, req.via.drill + 2 * margin, !!req.viaInPad)
      if (h) for (let i = 0; i < N; i++) v[i] |= h[i]
    }
    viaBlocked.push(v)
  }
  const tm = termsOf.get(req)
  const mask = (its: Item[] | null | undefined, layer: string, d: number): Uint8Array | null => {
    if (!tm || !its?.length) return null
    const a = new Uint16Array(N)
    let any = false
    for (const it of its) {
      const s = tm.grow(it, layer, d)
      if (s) {
        fillAdd(g, s, a, 1)
        any = true
      }
    }
    if (!any) return null
    const m = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (a[i]) m[i] = 1
    return m
  }
  const fence = (layer: string, d: number, into: Uint8Array) => {
    const b = mask(tm?.block, layer, d)
    if (!b) return
    const ex = mask(tm?.exempt, layer, d)
    for (let i = 0; i < N; i++) if (b[i] && !(ex && ex[i])) into[i] = 1
  }
  if (tm) {
    for (let l = 0; l < L; l++) {
      const o = blocked[l].slice()
      fence(layers[l], tm.gap + tw / 2, o)
      blocked[l] = o
    }
    for (let l = 0; l + 1 < L; l++) for (const sl of spans[l]) fence(sl, tm.gap + vw / 2, viaBlocked[l])
  }
  // a leg meets a pad or a via at its centre, a track anywhere along it
  const wires = (its: Item[] | null | undefined) => its?.filter(it => it.kind !== 'pad' && it.kind !== 'via')
  const hubs = (its: Item[] | null | undefined) =>
    layers.map(l => {
      const m = new Map<number, Pt>()
      for (const it of its ?? []) if ((it.kind === 'pad' || it.kind === 'via') && copperLayersOf(it, layout.copperLayers).includes(l)) m.set(cellOf(it.at[0], it.at[1]), it.at)
      return m
    })
  const srcAt = tm?.src ? layers.map(l => mask(wires(tm.src), l, touchOf(req.width))) : null
  const dstAt = tm?.dst ? layers.map(l => mask(wires(tm.dst), l, touchOf(req.width))) : null
  // where a track touches an end pad: the leg leaves the pads it starts on and never comes back, and stays on the pad it reaches
  const lands = (its: Item[] | null | undefined) => its?.filter(it => it.kind === 'pad' || it.kind === 'via')
  const srcZone = tm?.src ? layers.map(l => mask(lands(tm.src), l, touchOf(req.width))) : null
  const dstZone = tm?.dst ? layers.map(l => mask(lands(tm.dst), l, touchOf(req.width))) : null
  const spanTouch = (its: Item[] | null | undefined) => {
    if (!its) return null
    return spans.map(sp => {
      const m = new Uint8Array(N)
      for (const sl of sp) {
        const a = mask(its, sl, touchOf(req.via.size))
        if (a) for (let i = 0; i < N; i++) m[i] |= a[i]
      }
      return m
    })
  }
  const srcVia = spanTouch(wires(tm?.src)),
    dstVia = spanTouch(wires(tm?.dst))
  const avoidSets = layers.map(l => {
    const rings = (req.avoid ?? []).filter(a => a.layer === undefined || a.layer === l).map(a => outer(a.ring))
    return rings.length ? ringSet(polysToRings(offset(rings, req.width / 2))) : null
  })
  const soft = avoidSets.map(s => {
    if (!s) return null
    const m = new Uint8Array(N)
    fill(g, s, m, 1)
    return m
  })
  const cg = congestionOf.get(req)
  const F = cg ? cg.field(g, layers, spans, tw, vw, vd) : null
  const pres = cg?.pres ?? 0
  const pref = layers.map(l => req.prefer?.[l])
  const cellOf = (x: number, y: number) => {
    const i = Math.min(g.nx - 1, Math.max(0, Math.round((x - g.x0) / p))),
      j = Math.min(g.ny - 1, Math.max(0, Math.round((y - g.y0) / p)))
    return j * g.nx + i
  }
  const sc = cellOf(req.start.x, req.start.y),
    ec = cellOf(req.end.x, req.end.y)
  const srcHub = tm?.src ? hubs(tm.src) : null,
    dstHub = tm?.dst ? hubs(tm.dst) : null
  // an end may sit in other copper's clearance only on its own net's copper, or when only its grid cell is blocked
  const q = queries(layout)
  const inn = internals.get(layout)
  const endOk = (e: ResolvedPos, c: number, l: number) => {
    if (!blocked[l][c]) return true
    const layer = layers[l],
      al = q.allowedSet(tw)
    if (!q.blockedAt(layer, req.net, tw, e.x, e.y) && (!al || inside(al, e.x, e.y))) return true
    return !inn || onOwnCopper(inn.board, req, e.x, e.y, layer)
  }
  const isStart = new Uint8Array(L),
    isEnd = new Uint8Array(L)
  for (const l of ss) isStart[l] = endOk(req.start, sc, l) ? 1 : 0
  for (const l of es) isEnd[l] = endOk(req.end, ec, l) ? 1 : 0
  for (const [e, ok, ls] of [
    [req.start, isStart, ss],
    [req.end, isEnd, es],
  ] as const)
    if (!ls.some(l => ok[l]))
      throw new Error(`the ${e === req.start ? 'start' : 'end'} at (${fmt(e.x)}, ${fmt(e.y)}) is inside the clearance of other copper, and only a pad of the net may be`)
  const ei = ec % g.nx,
    ej = (ec / g.nx) | 0
  const free = (l: number, c: number) => !blocked[l][c] || (c === sc && isStart[l] === 1) || (c === ec && isEnd[l] === 1)
  const isSrc = (l: number, c: number) => (c === sc && isStart[l] === 1) || !!srcHub?.[l].has(c) || (!!srcAt?.[l]?.[c] && !blocked[l][c])
  const isDst = (l: number, c: number) => (c === ec && isEnd[l] === 1) || !!dstHub?.[l].has(c) || (!!dstAt?.[l]?.[c] && !blocked[l][c])
  // the heuristic aims at the box of every target cell
  let ti0 = ei,
    ti1 = ei,
    tj0 = ej,
    tj1 = ej
  const tl = new Set(es)
  if (dstAt)
    for (let l = 0; l < L; l++) {
      const m = dstAt[l]
      if (m)
        for (let c = 0; c < N; c++)
          if (m[c] && !blocked[l][c]) {
            const i = c % g.nx,
              j = (c / g.nx) | 0
            if (i < ti0) ti0 = i
            if (i > ti1) ti1 = i
            if (j < tj0) tj0 = j
            if (j > tj1) tj1 = j
            tl.add(l)
          }
    }
  if (dstHub)
    dstHub.forEach((m, l) => {
      for (const c of m.keys()) {
        const i = c % g.nx,
          j = (c / g.nx) | 0
        if (i < ti0) ti0 = i
        if (i > ti1) ti1 = i
        if (j < tj0) tj0 = j
        if (j > tj1) tj1 = j
        tl.add(l)
      }
    })
  const viaH = layers.map((_, l) => {
    let d = Infinity
    for (const e of tl) d = Math.min(d, Math.abs(l - e))
    return viaCost * d
  })
  const h = (l: number, c: number) => {
    const i = c % g.nx,
      j = (c / g.nx) | 0
    const dx = i < ti0 ? ti0 - i : i > ti1 ? i - ti1 : 0,
      dy = j < tj0 ? tj0 - j : j > tj1 ? j - tj1 : 0
    return p * (ortho ? dx + dy : Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) + viaH[l]
  }
  // maxDetour bounds the path length, vias free
  const straightLen = Math.hypot(req.end.x - req.start.x, req.end.y - req.start.y)
  const limit = req.maxDetour && req.maxDetour.ratio > 0 ? Math.max(req.maxDetour.ratio * straightLen, straightLen + req.maxDetour.floor) : Infinity
  let pruned = false

  const S = K * LN
  const buf = searchBuffers(S)
  const gs = buf.gs.fill(Infinity, 0, S)
  const bs = limit < Infinity ? buf.bs.fill(Infinity, 0, S) : null
  const parent = buf.parent.fill(-1, 0, S)
  const closed = buf.closed.fill(0, 0, S)
  let hf = new Float64Array(1024),
    hi = new Int32Array(1024),
    hn = 0
  const push = (f: number, idx: number) => {
    if (hn === hf.length) {
      const nf = new Float64Array(hn * 2)
      nf.set(hf)
      hf = nf
      const ni = new Int32Array(hn * 2)
      ni.set(hi)
      hi = ni
    }
    let k = hn++
    while (k > 0) {
      const pk = (k - 1) >> 1
      if (hf[pk] <= f) break
      hf[k] = hf[pk]
      hi[k] = hi[pk]
      k = pk
    }
    hf[k] = f
    hi[k] = idx
  }
  const pop = () => {
    const top = hi[0],
      lf = hf[--hn],
      li = hi[hn]
    let k = 0
    for (;;) {
      let c = 2 * k + 1
      if (c >= hn) break
      if (c + 1 < hn && hf[c + 1] < hf[c]) c++
      if (hf[c] >= lf) break
      hf[k] = hf[c]
      hi[k] = hi[c]
      k = c
    }
    hf[k] = lf
    hi[k] = li
    return top
  }
  const DX = [1, -1, 0, 0, 1, 1, -1, -1],
    DY = [0, 0, 1, -1, 1, -1, 1, -1]
  const dirs = ortho ? 4 : 8
  // a tie keeps the route on the layer it was asked to start on
  const ls0 = layers.indexOf(req.start.layer)
  const seed = (l: number, c: number) => {
    const idx = l * N + c
    if (gs[idx] < Infinity) return
    gs[idx] = l === ls0 ? 0 : 1e-9
    if (bs) bs[idx] = 0
    push(gs[idx] + h(l, c), idx)
  }
  for (const l of ss) if (isStart[l]) seed(l, sc)
  if (srcAt)
    for (let l = 0; l < L; l++) {
      const m = srcAt[l]
      if (m) for (let c = 0; c < N; c++) if (m[c] && !blocked[l][c]) seed(l, c)
    }
  if (srcHub)
    srcHub.forEach((m, l) => {
      for (const c of m.keys()) seed(l, c)
    })
  let found = -1
  while (hn) {
    const cur = pop()
    if (closed[cur]) continue
    closed[cur] = 1
    const k0 = (cur / LN) | 0,
      lc = cur - k0 * LN
    const l = (lc / N) | 0,
      c = lc - l * N
    if (isDst(l, c)) {
      found = cur
      break
    }
    const ci = c % g.nx,
      cj = (c / g.nx) | 0,
      gc = gs[cur],
      bc = bs ? bs[cur] : 0
    const pl = pref[l],
      sl = soft[l],
      occ = F?.occ[l],
      hist = F?.hist[l],
      bl = blocked[l],
      st = isStart[l] === 1,
      en = isEnd[l] === 1
    const sz = srcZone?.[l],
      dz = dstZone?.[l],
      inS = !!sz?.[c],
      inD = !!dz?.[c]
    const nx = g.nx,
      base = k0 * LN + l * N,
      vh = viaH[l]
    for (let k = 0; k < dirs; k++) {
      const ni = ci + DX[k],
        nj = cj + DY[k]
      if (ni < 0 || nj < 0 || ni >= nx || nj >= g.ny) continue
      const nc = nj * nx + ni
      if (bl[nc] && !(nc === sc && st) && !(nc === ec && en) && !dstHub?.[l].has(nc)) continue
      if ((sz?.[nc] && !inS) || (inD && !dz![nc])) continue
      if (k >= 4) {
        const a = cj * nx + ni,
          b = nj * nx + ci
        if (bl[a] && !(a === sc && st) && !(a === ec && en)) continue
        if (bl[b] && !(b === sc && st) && !(b === ec && en)) continue
      }
      const idx = base + nc
      if (closed[idx]) continue
      const len = k >= 4 ? Math.SQRT2 * p : p
      const dx = ni < ti0 ? ti0 - ni : ni > ti1 ? ni - ti1 : 0,
        dy = nj < tj0 ? tj0 - nj : nj > tj1 ? nj - tj1 : 0
      const oct = p * (ortho ? dx + dy : dx > dy ? dx + (Math.SQRT2 - 1) * dy : dy + (Math.SQRT2 - 1) * dx)
      const nb = bc + len
      if (bs && nb + oct > limit) {
        pruned = true
        continue
      }
      let cost = len
      if (pl) cost *= k >= 4 ? (1 + PREFER_PENALTY) / 2 : (pl === 'h') === k < 2 ? 1 : PREFER_PENALTY
      if (sl && sl[nc]) cost *= AVOID_PENALTY
      const ng = gc + (occ ? cost * (1 + hist![nc]) * (1 + pres * occ[nc]) : cost)
      if (ng < gs[idx]) {
        gs[idx] = ng
        if (bs) bs[idx] = nb
        parent[idx] = cur
        push(ng + (oct + vh), idx)
      }
    }
    const nk = K > 1 ? k0 + 1 : k0
    if (nk >= K) continue
    for (const nl of [l - 1, l + 1]) {
      if (nl < 0 || nl >= L) continue
      const span = Math.min(l, nl)
      if (viaBlocked[span][c] || !free(nl, c)) continue
      // a via may touch the tracks of the leg's own ends only where the leg leaves or reaches them
      if ((srcVia?.[span][c] && !isSrc(l, c)) || (dstVia?.[span][c] && !isDst(nl, c))) continue
      const idx = nk * LN + nl * N + c
      if (closed[idx]) continue
      const cost = viaCost * (soft[nl]?.[c] || sl?.[c] ? AVOID_PENALTY : 1)
      const ng = gc + (F ? cost * (1 + Math.max(F.hist[l][c], F.hist[nl][c])) * (1 + pres * F.viaOcc[span][c]) : cost)
      if (ng < gs[idx]) {
        gs[idx] = ng
        if (bs) bs[idx] = bc
        parent[idx] = cur
        push(ng + h(nl, c), idx)
      }
    }
  }
  if (found < 0) {
    if (pruned) throw new Error(`no path found within maxDetour, at most ${fmt(limit)} mm for ${fmt(straightLen)} mm between its ends`)
    throw new Error(Number.isFinite(maxVias) && L > 1 ? `no path found with at most ${maxVias} via${maxVias === 1 ? '' : 's'}` : 'no path found')
  }

  const path: number[] = []
  for (let k = found; k >= 0; k = parent[k]) path.push(k)
  path.reverse()
  if (path.length === 1 && tm) {
    // the cell touches both ends' copper: a short track from one centre line to the other
    const lc = found % LN,
      l = (lc / N) | 0,
      c = lc - l * N,
      at: Pt = [g.x0 + (c % g.nx) * p, g.y0 + ((c / g.nx) | 0) * p]
    const near = (its: Item[] | null | undefined, e: ResolvedPos, own: number, hub?: Map<number, Pt>): Pt =>
      c === own ? [e.x, e.y] : (hub?.get(c) ?? (its && snap(its, layers[l], at, at, req.width, () => true)) ?? at)
    const a = near(tm.src, req.start, sc, srcHub?.[l]),
      b = near(tm.dst, req.end, ec, dstHub?.[l])
    const pts = merge([a, at, b])
    return { tracks: pts.length >= 2 ? [{ layer: layers[l], pts: pts.map(([x, y]) => [nm(x), nm(y)] as Pt) }] : [], vias: [] }
  }
  const runs: { layer: number; pts: Pt[] }[] = []
  if (cg) cg.shared = []
  for (const idx of path) {
    const lc = idx % LN,
      l = (lc / N) | 0,
      c = lc - l * N
    if (F && cg && F.occ[l][c]) cg.shared!.push({ hist: F.hist[l], cell: c })
    const pt: Pt = [g.x0 + (c % g.nx) * p, g.y0 + ((c / g.nx) | 0) * p]
    const last = runs[runs.length - 1]
    if (!last || last.layer !== l) runs.push({ layer: l, pts: [pt] })
    else last.pts.push(pt)
  }
  const c0 = (path[0] % LN) % N,
    cN = (path[path.length - 1] % LN) % N
  const hub0 = srcHub?.[runs[0].layer].get(c0),
    lastRun = runs[runs.length - 1],
    hubN = dstHub?.[lastRun.layer].get(cN)
  if (c0 === sc) runs[0].pts[0] = [req.start.x, req.start.y]
  else if (hub0) runs[0].pts[0] = [hub0[0], hub0[1]]
  if (cN === ec) lastRun.pts[lastRun.pts.length - 1] = [req.end.x, req.end.y]
  else if (hubN) lastRun.pts[lastRun.pts.length - 1] = [hubN[0], hubN[1]]
  const first = runs[0].pts[0],
    last = lastRun.pts[lastRun.pts.length - 1]
  const segHit = (s: RingSet | null | undefined, a: Pt, b: Pt) => !!s && segHits(s, a, b)
  // shortcuts stay off soft keepouts and other legs' copper, which the grid path crosses only where it must
  const softHit = (l: number, a: Pt, b: Pt) => segHit(avoidSets[l], a, b) || (!!F && F.regions[l].some(s => segHit(s, a, b)))
  const setsOf = (its: Item[] | null | undefined, d: number) =>
    its
      ? layers.map(l =>
          its.flatMap(it => {
            const s = tm!.grow(it, l, d)
            return s ? [s] : []
          }),
        )
      : null
  const fenceSets = tm ? setsOf(tm.block, tm.gap + tw / 2) : null
  const srcSets = setsOf(wires(tm?.src), touchOf(req.width)),
    dstSets = setsOf(wires(tm?.dst), touchOf(req.width))
  const srcPads = setsOf(lands(tm?.src), touchOf(req.width)),
    dstPads = setsOf(lands(tm?.dst), touchOf(req.width))
  const ownOk = (l: number, a: Pt, b: Pt) =>
    !(
      (a !== first && srcSets?.[l].some(s => segHits(s, a, b))) ||
      (b !== last && dstSets?.[l].some(s => segHits(s, a, b))) ||
      srcPads?.[l].some(s => !inside(s, a[0], a[1]) && segHits(s, a, b)) ||
      dstPads?.[l].some(s => !inside(s, b[0], b[1]) && segHits(s, a, b))
    )
  const joinOk = (l: number, a: Pt, b: Pt) => q.segFree(layers[l], a, b, req.net, tw) && !softHit(l, a, b) && !fenceSets?.[l].some(s => segHits(s, a, b))
  const segOk = (l: number, a: Pt, b: Pt) => joinOk(l, a, b) && ownOk(l, a, b)
  const out: RouteResult = { tracks: [], vias: [] }
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k]
    if (k > 0) out.vias.push({ x: nm(run.pts[0][0]), y: nm(run.pts[0][1]), layers: [layers[runs[k - 1].layer], layers[run.layer]] })
    let pts = run.pts.length === 1 ? [] : simplify(merge(run.pts), (a, b) => segOk(run.layer, a, b), ortho)
    if (ortho) pts = squareUp(pts)
    if (pts.length >= 2) {
      // a join meets the trunk on its centre line where the straight piece to it is free
      if (k === 0 && pts[0] === first && c0 !== sc && !hub0 && tm?.src)
        pts[0] = snap(tm.src, layers[run.layer], pts[0], pts[1], req.width, (a, b) => joinOk(run.layer, a, b)) ?? pts[0]
      const e = pts.length - 1
      if (k === runs.length - 1 && pts[e] === last && cN !== ec && !hubN && tm?.dst)
        pts[e] = snap(tm.dst, layers[run.layer], pts[e], pts[e - 1], req.width, (a, b) => joinOk(run.layer, b, a)) ?? pts[e]
      out.tracks.push({ layer: layers[run.layer], pts: pts.map(([x, y]) => [nm(x), nm(y)] as Pt) })
    }
  }
  return out
}

/** Where the line from `next` through p meets the centre line of a track of `its` within touch of a track of width w, else the nearest point of it, when the piece from there to `next` is free. */
function snap(its: Item[], layer: string, p: Pt, next: Pt, w: number, free: (a: Pt, b: Pt) => boolean): Pt | null {
  let best: Pt | null = null,
    bd = Infinity
  const ux = p[0] - next[0],
    uy = p[1] - next[1]
  for (const it of its) {
    if (it.kind !== 'track' || it.layer !== layer) continue
    for (let i = 1; i < it.pts.length; i++) {
      const a = it.pts[i - 1],
        b = it.pts[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy
      const den = ux * dy - uy * dx
      let t = den ? ((a[0] - next[0]) * uy - (a[1] - next[1]) * ux) / den : -1
      // a point off the leg's own line ranks behind every point on it
      const off = t < 0 || t > 1
      if (off) t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
      const q: Pt = [a[0] + t * dx, a[1] + t * dy],
        d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d <= it.width / 2 + (off ? w / 2 : w) && d + (off ? 1e3 : 0) < bd) {
        bd = d + (off ? 1e3 : 0)
        best = q
      }
    }
  }
  if (!best || bd % 1e3 < 1e-6) return null
  const q: Pt = [nm(best[0]), nm(best[1])]
  return free(q, next) ? q : null
}

function onOwnCopper(board: Board, req: RouteRequest, x: number, y: number, layer: string): boolean {
  const cu = copperLayers(board.copper)
  for (const it of board.items) {
    if (it.net === undefined || (it.net !== req.net && it.net !== req.pair?.partner)) continue
    if (it.kind !== 'pad' && it.kind !== 'via' && it.kind !== 'track') continue
    if (!copperLayersOf(it, cu).includes(layer)) continue
    if (inside(ringSet(solidRings(it, layer)), x, y)) return true
  }
  return false
}

/** The way along the trunk tracks of `comp` from the end items `from` to J on `layer`, as strips at the trunk's widths; null when there is none. */
function trunkRun(comp: Item[], from: Item[], J: Pt, layer: string, w: number, cu: string[]): Strip[] | null {
  const tracks = comp.filter((it): it is Track => it.kind === 'track' && !overlays.has(it))
  const ids = new Map<string, number>()
  const node = (k: string) => {
    let n = ids.get(k)
    if (n === undefined) ids.set(k, (n = ids.size))
    return n
  }
  const at = (l: string, p: Pt) => node(`${l}|${p[0].toFixed(5)}|${p[1].toFixed(5)}`)
  const adj: { to: number; len: number; seg?: { t: Track; a: Pt; b: Pt } }[][] = []
  const link = (u: number, v: number, len: number, seg?: { t: Track; a: Pt; b: Pt }) => {
    ;(adj[u] ??= []).push({ to: v, len, seg })
    ;(adj[v] ??= []).push({ to: u, len, seg: seg && { t: seg.t, a: seg.b, b: seg.a } })
  }
  const proj = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy
    const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    const q: Pt = [a[0] + s * dx, a[1] + s * dy]
    return { s, q, d: Math.hypot(q[0] - p[0], q[1] - p[1]) }
  }
  const target = at(layer, J)
  const vertices: [string, Pt][] = []
  for (const t of tracks)
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1],
        b = t.pts[i]
      const stops: { s: number; q: Pt }[] = [
        { s: 0, q: a },
        { s: 1, q: b },
      ]
      const add = (p: Pt, reach: number, from?: number) => {
        const x = proj(p, a, b)
        if (x.d > reach) return
        stops.push({ s: x.s, q: x.q })
        if (from !== undefined) link(from, at(t.layer, x.q), 0)
      }
      for (const u of tracks) if (u !== t && u.layer === t.layer) for (const e of [u.pts[0], u.pts[u.pts.length - 1]]) add(e, (t.width + u.width) / 2, at(u.layer, e))
      if (t.layer === layer) add(J, (t.width + w) / 2, target)
      stops.sort((x, y) => x.s - y.s)
      for (let k = 1; k < stops.length; k++) {
        const p = stops[k - 1].q,
          q = stops[k].q,
          len = Math.hypot(q[0] - p[0], q[1] - p[1])
        link(at(t.layer, p), at(t.layer, q), len, len > 1e-9 ? { t, a: p, b: q } : undefined)
      }
      for (const s of stops) vertices.push([t.layer, s.q])
    }
  const sources: number[] = []
  for (const it of comp) {
    if (it.kind !== 'pad' && it.kind !== 'via') continue
    const n = node(`item|${it.id}`)
    if (from.includes(it)) sources.push(n)
    const ls = copperLayersOf(it, cu)
    for (const [l, p] of vertices) if (ls.includes(l) && inside(ringSet(solidRings(it, l)), p[0], p[1])) link(n, at(l, p), 0)
  }
  if (!sources.length || !adj[target]) return null
  const dist = new Float64Array(ids.size).fill(Infinity),
    prev: ({ from: number; seg?: { t: Track; a: Pt; b: Pt } } | undefined)[] = []
  const open = new Set<number>()
  for (const s of sources) {
    dist[s] = 0
    open.add(s)
  }
  while (open.size) {
    let u = -1
    for (const v of open) if (u < 0 || dist[v] < dist[u]) u = v
    open.delete(u)
    if (u === target) break
    for (const e of adj[u] ?? [])
      if (dist[u] + e.len < dist[e.to] - 1e-12) {
        dist[e.to] = dist[u] + e.len
        prev[e.to] = { from: u, seg: e.seg }
        open.add(e.to)
      }
  }
  if (dist[target] === Infinity) return null
  const segs: { t: Track; a: Pt; b: Pt }[] = []
  for (let v = target; prev[v]; v = prev[v]!.from) if (prev[v]!.seg) segs.unshift(prev[v]!.seg!)
  const strips: Strip[] = []
  for (const s of segs) {
    const cur = strips[strips.length - 1]
    if (cur && cur.layer === s.t.layer && cur.width === s.t.width && same(cur.pts[cur.pts.length - 1], s.a)) cur.pts.push(s.b)
    else strips.push({ layer: s.t.layer, width: s.t.width, pts: [s.a, s.b] })
  }
  return strips.map(s => ({ ...s, pts: merge(s.pts).map(([x, y]) => [nm(x), nm(y)] as Pt) }))
}

/** Obstacle growth for a leg's track, via copper and via drill; other copper is already grown by the net's class clearance. */
function legWidths(req: RouteRequest, layout: RouteContext): { tw: number; vw: number; vd: number } {
  const margin = req.clearance ?? BASE_AUTOROUTE.clearance
  const r = layout.rules,
    c = internals.get(layout)?.clearanceTo(req.net, req.net) ?? r.clearance
  return { tw: req.width + 2 * margin, vw: Math.max(req.via.size, req.via.drill + 2 * (r.holeClearance - c)) + 2 * margin, vd: req.via.drill + 2 * margin }
}

function spanOf(stack: string[], a: string, b: string): string[] {
  const i0 = stack.indexOf(a),
    i1 = stack.indexOf(b)
  return i0 < 0 || i1 < 0 ? [a, b] : stack.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)
}

/** Splits each diagonal segment, only ever a short end to an off-grid point, into a horizontal and a vertical one. */
function squareUp(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = out[out.length - 1],
        b = pts[i]
      if (Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) out.push(i === 1 ? [a[0], b[1]] : [b[0], a[1]])
    }
    out.push(pts[i])
  }
  return merge(out)
}

/** 1 nm rounding against float noise. */
const nm = (v: number) => Math.round(v * 1e6) / 1e6
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9

function merge(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const pt of pts) {
    if (out.length && same(out[out.length - 1], pt)) continue
    if (out.length >= 2) {
      const a = out[out.length - 2],
        b = out[out.length - 1]
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = pt[0] - b[0],
        vy = pt[1] - b[1]
      if (Math.abs(ux * vy - uy * vx) < 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy) + 1e-12 && ux * vx + uy * vy > 0) {
        out[out.length - 1] = pt
        continue
      }
    }
    out.push(pt)
  }
  return out
}

const aligned = (a: Pt, b: Pt, ortho: boolean) => {
  const dx = Math.abs(b[0] - a[0]),
    dy = Math.abs(b[1] - a[1])
  return dx < 1e-9 || dy < 1e-9 || (!ortho && Math.abs(dx - dy) < 1e-9)
}

/** Greedy shortcuts to a 45 or 90 degree polyline: from each vertex, the farthest later one reachable straight or through a knee. */
function simplify(pts: Pt[], segFree: (a: Pt, b: Pt) => boolean, ortho = false): Pt[] {
  if (pts.length <= 2) return pts
  const out: Pt[] = [pts[0]]
  let i = 0
  while (i < pts.length - 1) {
    let next = -1
    for (let j = pts.length - 1; j > i + 1 && next < 0; j--) {
      const a = pts[i],
        b = pts[j]
      if (aligned(a, b, ortho)) {
        if (segFree(a, b)) {
          out.push(b)
          next = j
        }
        continue
      }
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        d = Math.min(Math.abs(dx), Math.abs(dy))
      const diag: Pt = [Math.sign(dx) * d, Math.sign(dy) * d]
      const knees: Pt[] = ortho
        ? [
            [a[0], b[1]],
            [b[0], a[1]],
          ]
        : [
            [a[0] + diag[0], a[1] + diag[1]],
            [b[0] - diag[0], b[1] - diag[1]],
          ]
      for (const m of knees)
        if (segFree(a, m) && segFree(m, b)) {
          out.push(m, b)
          next = j
          break
        }
    }
    if (next < 0) {
      out.push(pts[i + 1])
      next = i + 1
    }
    i = next
  }
  return merge(out)
}

export const routers = { maze, straight }

export function getRouter(spec: 'maze' | 'straight' | RouteFn | null | undefined): RouteFn {
  if (typeof spec === 'function') return spec
  if (spec === undefined || spec === null || spec === 'maze') return maze
  if (spec === 'straight') return straight
  throw new CompileError(`unknown routing algorithm ${JSON.stringify(spec)} (use 'maze', 'straight' or a function)`)
}

function padOf(board: Board, pos: Pos): Pad | null {
  if (isPinRef(pos)) {
    const st = partOf(pos.part)
    const ref = st && PART_REFS.get(board)?.get(st)
    return (ref && board.items.find((i): i is Pad => i.kind === 'pad' && i.ref === ref && pinOfPad(st!.pins, i) === pos.pin)) || null
  }
  if (typeof pos !== 'string' || coordString(pos)) return null
  const dot = pos.indexOf('.'),
    ref = pos.slice(0, dot),
    num = pos.slice(dot + 1)
  const pads = board.items.filter((i): i is Pad => i.kind === 'pad' && i.ref === ref)
  return pads.find(p => p.num === num) ?? pads.find(p => p.name === num) ?? null
}
const posLabel = (pos: Pos, pad: Pad | null) =>
  pad ? `${pad.ref}.${isPinRef(pos) ? pos.pin : pad.num}` : typeof pos === 'string' ? JSON.stringify(pos) : JSON.stringify(isPinRef(pos) ? pos.pin : pos)

/** The board's parameters merged with the job's, mm. */
type ResolvedParams = Omit<AutoRouteParams, 'via' | 'avoid'> & JobParams

/** One automatic leg; `own` is the src its copper carries, the X or XZ command's range when known. */
interface Leg {
  from: ResolvedPos
  to: ResolvedPos
  own?: Origin
}
type Origin = { src?: Src; chain?: Src[] }

/** One piece of a pair's centre line, in order: a manual polyline, a via to `layer` at the cursor, or automatic leg k. */
type Piece = { kind: 'pts'; layer: string; pts: Pt[]; auto?: boolean } | { kind: 'via'; layer: string; cross?: boolean } | { kind: 'leg'; k: number }
interface PairRun {
  id: string
  netN: string
  w: number
  g: number
  via: { drill: number; size: number }
  /** what offsetPair spaces the two vias by */
  clearance: number
  pieces: Piece[]
  /** the outline copper of the manual pieces, replaced once the pair is laid out */
  ids: number[]
  startPads: [Pt, Pt]
  endPads: [Pt, Pt]
  /** P start, N start, P end, N end */
  pads: (Pad | null)[]
  skew: number
  uncoupled: number
  /** the finding when the pair's ends are the wrong way round for its path */
  crossed?: string
  start?: ResolvedPos
  endLayer?: string
}

function classClearanceOf(board: Board, rules: Rules, a: string | undefined, b: string | undefined): number {
  return Math.max(rules.clearance, classOf(board, a)?.clearance ?? 0, classOf(board, b)?.clearance ?? 0)
}

export interface AutorouteOptions {
  /** the strictest rules of the variant targets that share the routing */
  rules?: Rules
  /** throw on the first leg that cannot be routed instead of recording a RouteFailure */
  strict?: boolean
  cache?: RouteCache | null
  /** see CompileOptions.progress */
  progress?: (p: RouteProgress) => void
}
/** The router's first pass over every leg, then each negotiation `round` over the legs it routes again. */
export interface RouteProgress {
  done: number
  legs: number
  round?: number
}
/** `loops`: nets with a `.loop()` route; `notes`: the info findings `trunk-narrow` */
export interface AutorouteOutcome {
  failures: RouteFailure[]
  report: RoutingReport
  added: Item[]
  pairs?: PairInfo[]
  routes?: RouteRecord[]
  loops?: string[]
  notes?: DrcMarker[]
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
type Box = [number, number, number, number]
const boxHit = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** An item's box with copper and holes, and a signature of all the router sees of it. */
const sigCache = new WeakMap<Item, { box: Box; sig: string }>()
function itemSig(it: Item, cu: string[]): { box: Box; sig: string } | null {
  if (it.kind === 'zone') return null
  const hit = sigCache.get(it)
  if (hit) return hit
  const ls = copperLayersOf(it, cu)
  const drilled = it.kind === 'pad' && !!it.drill
  if (!ls.length && !drilled) return null
  let pts: Pt[] = [],
    grow = 0,
    geo: unknown
  switch (it.kind) {
    case 'pad':
      pts = it.poly
      grow = it.drill ? Math.max(...it.drill) / 2 : 0
      geo = [
        it.at.map(r4),
        it.poly.map(q => q.map(r4)),
        it.drill,
        it.type,
        it.layers,
        ...(it.clearance !== undefined || it.holeClearance !== undefined ? [[it.clearance ?? null, it.holeClearance ?? null]] : []),
        ...(it.clearanceTo ? [it.clearanceTo] : []),
      ]
      if (it.drill) pts = [...pts, it.at]
      break
    case 'via':
      pts = [it.at]
      grow = it.size / 2
      geo = [it.at.map(r4), it.size, it.drill, it.layers]
      break
    case 'track':
      pts = it.pts
      grow = it.width / 2
      geo = [it.pts.map(q => q.map(r4)), it.width]
      break
    case 'graphic':
      pts = it.paths.flat()
      grow = it.width / 2
      geo = [it.paths.map(r => r.map(q => q.map(r4))), it.width, it.fill, it.closed]
      break
    case 'text':
      pts = it.polys ? it.polys.flatMap(q => q.outer) : it.strokes.flat()
      grow = it.thickness / 2
      geo = it.polys ? it.polys.map(q => [q.outer, ...q.holes].map(r => r.map(q => q.map(r4)))) : [it.strokes.map(r => r.map(q => q.map(r4))), it.thickness]
      break
  }
  if (!pts.length) return null
  const b = boxOf(pts)
  const out = { box: [b[0] - grow, b[1] - grow, b[2] + grow, b[3] + grow] as Box, sig: JSON.stringify([it.kind, it.layer, it.net ?? '', ls, geo]) }
  sigCache.set(it, out)
  return out
}

function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segCross(a, b, c, d)) return 0
  const pd = (p: Pt, u: Pt, v: Pt) => {
    const dx = v[0] - u[0],
      dy = v[1] - u[1],
      l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0
    return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy)
  }
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b))
}

function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** 0 when they cross; collinear segments that do not overlap keep their distance. */
function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a),
    d2 = o(c, d, b),
    d3 = o(a, b, c),
    d4 = o(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b))
}

/** True when two routed tracks or vias of different nets break `gap`, holeClearance or minHoleToHole, exactly. */
function itemsClash(x: Item, y: Item, gap: number, rules: Rules, cu: string[]): boolean {
  if (x.kind === 'via' && y.kind === 'track') return itemsClash(y, x, gap, rules, cu)
  const E = 1e-6
  if (x.kind === 'track' && y.kind === 'track') {
    if (x.layer !== y.layer) return false
    const need = gap + (x.width + y.width) / 2 - E
    for (let i = 1; i < x.pts.length; i++) for (let j = 1; j < y.pts.length; j++) if (segSegDist(x.pts[i - 1], x.pts[i], y.pts[j - 1], y.pts[j]) < need) return true
    return false
  }
  if (x.kind === 'track' && y.kind === 'via') {
    const onLayer = copperLayersOf(y, cu).includes(x.layer)
    const needCu = gap + (x.width + y.size) / 2 - E,
      needHole = rules.holeClearance + (y.drill + x.width) / 2 - E
    for (let i = 1; i < x.pts.length; i++) {
      const d = ptSegDist(y.at, x.pts[i - 1], x.pts[i])
      if ((onLayer && d < needCu) || d < needHole) return true
    }
    return false
  }
  if (x.kind === 'via' && y.kind === 'via') {
    const d = Math.hypot(x.at[0] - y.at[0], x.at[1] - y.at[1]),
      ly = copperLayersOf(y, cu)
    if (copperLayersOf(x, cu).some(l => ly.includes(l)) && d < gap + (x.size + y.size) / 2 - E) return true
    return d < rules.minHoleToHole + (x.drill + y.drill) / 2 - E || d < rules.holeClearance + x.drill / 2 + y.size / 2 - E || d < rules.holeClearance + y.drill / 2 + x.size / 2 - E
  }
  return false
}

/** Up to five items of other nets nearest the line from a to b on the layers tried, nearest first. */
function blockersOf(board: Board, nets: Set<string>, a: Pt, b: Pt, layers: string[], exclude: Set<number>): number[] {
  const cu = copperLayers(board.copper)
  const scored: [number, number][] = []
  for (const it of board.items) {
    if (exclude.has(it.id) || it.kind === 'zone' || it.id < 0) continue
    if (it.net !== undefined && nets.has(it.net)) continue
    const rings = copperLayersOf(it, cu)
      .filter(l => layers.includes(l))
      .flatMap(l => solidRings(it, l))
    if ((it.kind === 'pad' && it.drill) || it.kind === 'via') rings.push(circleRing(it.at[0], it.at[1], it.kind === 'via' ? it.drill / 2 : Math.max(...it.drill!) / 2))
    if (!rings.length) continue
    let d = Infinity
    for (const r of rings) {
      if (inside(ringSet([r]), a[0], a[1]) || inside(ringSet([r]), b[0], b[1])) {
        d = 0
        break
      }
      for (let i = 0, j = r.length - 1; i < r.length && d > 0; j = i++) d = Math.min(d, segDist(a, b, r[j], r[i]))
    }
    scored.push([d, it.id])
  }
  return scored
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
    .slice(0, 5)
    .map(x => x[1])
}

function nearestCopper(board: Board, nets: Set<string>, p: Pt, cu: string[]): { it: Item; d: number } | null {
  let best: { it: Item; d: number } | null = null
  for (const it of board.items) {
    if (it.kind === 'zone' || it.id < 0 || (it.net !== undefined && nets.has(it.net))) continue
    const rings = copperLayersOf(it, cu).flatMap(l => solidRings(it, l))
    if ((it.kind === 'pad' && it.drill) || it.kind === 'via') rings.push(circleRing(it.at[0], it.at[1], it.kind === 'via' ? it.drill / 2 : Math.max(...it.drill!) / 2))
    let d = Infinity
    for (const r of rings) {
      if (inside(ringSet([r]), p[0], p[1])) {
        d = 0
        break
      }
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, ptSegDist(p, r[j], r[i]))
    }
    if (d < Infinity && (!best || d < best.d - 1e-9)) best = { it, d }
  }
  return best
}

/** Places every route's manual commands in document order, then routes the automatic legs by priority and declaration order. */
export function autoroute(board: Board, jobs: AutoRouteJob[], defaults: AutoRouteParams = BASE_AUTOROUTE, opts: AutorouteOptions = {}): AutorouteOutcome {
  const report: RoutingReport = { legs: 0, routed: 0, failed: 0, cached: 0, locked: 0, ripped: 0 }
  const failures: RouteFailure[] = []
  const added: Item[] = []
  if (!jobs.length) return { failures, report, added }
  const rules = opts.rules ?? board.rules
  const cache = opts.cache ?? null
  const cu = copperLayers(board.copper)
  const outerLayers = [cu[0], cu[cu.length - 1]]
  let nextId = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
  const order = (l: string) => cu.indexOf(l)
  const byStack = (ls: string[]) => [...new Set(ls)].sort((a, b) => order(a) - order(b))
  const push = (it: Item) => {
    board.items.push(it)
    added.push(it)
  }
  // a net's class clearance moves the obstacles of every leg, so it is in every key
  const classed = board.classes
    ? (board.schematic?.nets ?? []).flatMap(n => {
        const c = classOf(board, n.name)?.clearance
        return c !== undefined && c > rules.clearance ? [[n.name, c]] : []
      })
    : []
  // rules that only DRC and zone fill read stay out of the key
  const boardKey = JSON.stringify([
    ROUTER_VERSION,
    { ...rules, edge: undefined, maskWeb: undefined, silkMinHeight: undefined, holeClearanceBy: undefined, minHoleToHoleBy: undefined },
    board.copper,
    hash(JSON.stringify(board.outline.map(r => r.map(q => q.map(r4))))),
    ...(classed.length ? [classed] : []),
  ])

  /** `join`: which end of its one leg may join the net's copper; `direct`: the leg reaches its end pads only */
  interface Run {
    job: AutoRouteJob
    P: ResolvedParams
    net?: string
    width: number
    layer: string
    via: { drill: number; size: number }
    legs: Leg[] | null
    fail: (msg: string) => never
    lockKey?: string
    pair?: PairRun
    join?: [boolean, boolean]
    direct?: boolean
  }
  const runs: Run[] = []
  let pairCount = 0
  // layouts built on first use; necks see the pads only
  const lazyFree = (mk: () => RouteContext): IsFree => {
    let l: RouteContext | undefined
    return (ly, x, y, n, w) => (l ??= mk()).isFree(ly, x, y, n, w)
  }
  const pairFrees = (netP: string, netN: string, exclude: Set<number>): PairContext => ({
    free: lazyFree(() => buildLayout(board, exclude, rules)),
    centreFree: lazyFree(() => buildLayout(board, exclude, rules, [], { net: netP, partner: netN })),
    padFree: padFree(),
  })
  let padLayout: IsFree | undefined
  const padFree = (): IsFree => (padLayout ??= lazyFree(() => buildLayout(board, new Set(board.items.filter(i => i.kind !== 'pad').map(i => i.id)), rules)))
  // pass 1: parameters, ends, nets and manual commands, in document order
  for (const job of jobs) {
    const fail = (msg: string): never => {
      throw new CompileError(msg, job.src)
    }
    const name = (l: string) => {
      try {
        return layerName(board, l)
      } catch (e) {
        return fail((e as Error).message)
      }
    }
    // board-wide parameters have raw layer names; flatten resolved the job's
    const board0: ResolvedParams = {
      ...defaults,
      layers: defaults.layers?.map(name),
      prefer: defaults.prefer && Object.fromEntries(Object.entries(defaults.prefer).map(([k, v]) => [name(k), v])),
      via: defaults.via && {
        ...(defaults.via.drill !== undefined ? { drill: mm(defaults.via.drill) } : {}),
        ...(defaults.via.size !== undefined ? { size: mm(defaults.via.size) } : {}),
      },
      avoid: defaults.avoid?.map((a): JobAvoid =>
        a && typeof a === 'object' && !Array.isArray(a) && !isPinRef(a) && 'w' in a
          ? { ring: rectRing(mm(a.x), mm(a.y), mm(a.w), mm(a.h)), ...(a.layer ? { layer: name(a.layer) } : {}) }
          : { pos: a as Pos },
      ),
    }
    const P = mergeAutoroute(board0, job.params)
    let via = { drill: P.via?.drill ?? defaultVia(rules).drill, size: P.via?.size ?? defaultVia(rules).size }
    if (job.from === undefined || job.to === undefined) {
      runs.push({ job, P, net: job.net, width: job.width ?? rules.minTrackWidth, layer: job.layer ?? 'F.Cu', via, legs: null, fail })
      continue
    }
    const padA = padOf(board, job.from),
      padB = padOf(board, job.to)
    let net = job.net
    if (job.infer) {
      const la = posLabel(job.from, padA),
        lb = posLabel(job.to, padB)
      if (padA?.net && padB?.net && padA.net !== padB.net) fail(`route from ${la} to ${lb} joins two nets, ${padA.net} and ${padB.net}`)
      const inferred = padA?.net ?? padB?.net
      if (net !== undefined && inferred !== undefined && net !== inferred) fail(`route from ${la} to ${lb} is given the net ${net}, but ${padA?.net ? la : lb} is on ${inferred}`)
      net ??= inferred
      if (net === undefined)
        fail(
          padA || padB
            ? `route from ${la} to ${lb}: no pad of it is on a net, give one with .net(n)`
            : `route from ${la} to ${lb} has no pad at either end, give its net with .net(n)`,
        )
    }
    let width = job.width ?? rules.minTrackWidth
    let start: ResolvedPos
    try {
      start = resolvePos(board, job.from, job.layer ?? 'F.Cu')
    } catch (e) {
      return fail((e as Error).message)
    }
    let endAt = (layer: string): ResolvedPos => {
      try {
        return resolvePos(board, job.to!, layer)
      } catch (e) {
        return fail((e as Error).message)
      }
    }
    // a pair routes its centre line 2w + g wide between the pad midpoints, each via a disc that holds both
    let pr: PairRun | undefined
    if (job.pair) {
      const netN = job.pair.net
      if (net === undefined || netN === undefined) return fail('a differential pair route needs the nets of both of its tracks')
      const w = width,
        g = job.pair.gap ?? w
      notePair(board, net, netN, g)
      let sN: ResolvedPos
      try {
        sN = resolvePos(board, job.pair.fromN, start.layer)
      } catch (e) {
        return fail((e as Error).message)
      }
      const both = (a: ResolvedPos, b: ResolvedPos, prefer: string, where: string): ResolvedPos => {
        const la = [a.layer, ...(a.layers ?? [])],
          lb = [b.layer, ...(b.layers ?? [])]
        const common = [...new Set(la.filter(l => lb.includes(l)))]
        if (!common.length) return fail(`pair route: the ${where} ends of P and N share no copper layer, P is on ${la.join(', ')} and N on ${lb.join(', ')}`)
        const layer = common.includes(prefer) ? prefer : common.includes(a.layer) ? a.layer : common[0]
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, layer, ...(common.length > 1 ? { layers: byStack(common) } : {}) }
      }
      const s0 = start
      start = both(s0, sN, s0.layer, 'start')
      const endP = (layer: string): [ResolvedPos, ResolvedPos] => {
        try {
          return [resolvePos(board, job.to!, layer), resolvePos(board, job.pair!.toN, layer)]
        } catch (e) {
          return fail((e as Error).message)
        }
      }
      endAt = (layer: string) => {
        const [a, b] = endP(layer)
        return both(a, b, layer, 'end')
      }
      const cl = Math.max(
        itemClearance(board, { kind: 'via', net }, { kind: 'via', net: netN }, rules),
        via.drill + rules.minHoleToHole - via.size,
        rules.holeClearance + (via.drill - via.size) / 2,
      )
      const spacing = Math.max(w + g, via.size + cl)
      const e0 = endP(start.layer)
      pr = {
        id: `pair:${++pairCount}`,
        netN,
        w,
        g,
        via,
        clearance: cl,
        pieces: [],
        ids: [],
        pads: [padA, padOf(board, job.pair.fromN), padB, padOf(board, job.pair.toN)],
        startPads: [
          [s0.x, s0.y],
          [sN.x, sN.y],
        ],
        endPads: [
          [e0[0].x, e0[0].y],
          [e0[1].x, e0[1].y],
        ],
        skew: job.pair.skew ?? 0.1,
        uncoupled: job.pair.uncoupled ?? 5,
      }
      width = 2 * w + g
      via = { drill: spacing + via.drill, size: spacing + via.size }
    }
    const whole: Origin = { src: job.src, ...(job.chain ? { chain: job.chain } : {}) }
    // a step's own range with the route call innermost in the chain, else the call's range
    const own = (st: RouteStep): Origin => (st.src ? { src: st.src, chain: [...(job.chain ?? []), ...(job.src ? [job.src] : [])] } : whole)
    const rid = job.route !== undefined ? { route: job.route } : {}
    const item = (st: RouteStep) => ({ net, ref: job.ref, ...own(st), ...rid })
    const legs: Leg[] = []
    const firstAdded = added.length
    // the path is walked in the frame it was written in
    const m = job.m ?? IDENTITY,
      inv = invert(m)
    let cur: Pt = apply(inv, [start.x, start.y]),
      at: Pt = [start.x, start.y],
      layer = start.layer
    let line: Pt[] = [at]
    // one track per manual command, null between them at a via or leg, for .corner()
    const manual: (Track | null)[] = []
    const flush = (st: RouteStep) => {
      if (line.length >= 2) {
        const id = nextId++
        const t = { kind: 'track', id, layer, ...item(st), pts: line, width } as Track
        push(t)
        manual.push(t)
        if (pr) {
          pr.pieces.push({ kind: 'pts', layer, pts: line })
          pr.ids.push(id)
        }
      }
      line = [at]
    }
    const go = (local: Pt) => {
      cur = local
      at = apply(m, local)
      return at
    }
    let first = true
    for (const st of job.steps ?? [{ op: 'XZ' as const }]) {
      // only the start itself may be reached on several layers
      const from = (): ResolvedPos => (first && start.layers ? { ...start, x: at[0], y: at[1], layer } : { x: at[0], y: at[1], layer })
      switch (st.op) {
        case 'L':
          line.push(go(st.rel ? [cur[0] + st.x, cur[1] + st.y] : [st.x, st.y]))
          flush(st)
          break
        case 'H':
          line.push(go([st.rel ? cur[0] + st.x : st.x, cur[1]]))
          flush(st)
          break
        case 'V':
          line.push(go([cur[0], st.rel ? cur[1] + st.y : st.y]))
          flush(st)
          break
        case 'X': {
          const f0 = from()
          go(st.rel ? [cur[0] + st.x, cur[1] + st.y] : [st.x, st.y])
          pr?.pieces.push({ kind: 'leg', k: legs.length })
          manual.push(null)
          legs.push({ from: f0, to: { x: at[0], y: at[1], layer }, own: own(st) })
          line = [at]
          break
        }
        case 'U': {
          const to = name(st.layer)
          if (to === layer) fail(`route path: U ${st.layer} at (${fmt(at[0])}, ${fmt(at[1])}), the route is on ${layer} already`)
          if (st.cross && !pr) fail('route chain: .cross() is for a differential pair')
          const pair = [layer, to].sort((a, b) => order(a) - order(b)) as [string, string]
          const id = nextId++
          push({ kind: 'via', id, layer: pair[0], ...item(st), at: [at[0], at[1]], drill: via.drill, size: via.size, layers: pair } as Via)
          manual.push(null)
          if (pr) {
            pr.pieces.push({ kind: 'via', layer: to, ...(st.cross ? { cross: true } : {}) })
            pr.ids.push(id)
          }
          layer = to
          break
        }
        case 'Z': {
          const end = endAt(layer)
          if (end.layer !== layer) fail(`route path: Z draws on ${layer}, but ${posLabel(job.to, padB)} is on ${end.layer}; change layer with @<layer> first, or end with XZ`)
          line.push([end.x, end.y])
          at = [end.x, end.y]
          flush(st)
          break
        }
        case 'XZ': {
          pr?.pieces.push({ kind: 'leg', k: legs.length })
          legs.push({ from: from(), to: endAt(layer), own: own(st) })
          break
        }
      }
      first = false
    }
    let lockKey: string | undefined
    if (job.lock) {
      const end = endAt(job.layer ?? 'F.Cu')
      lockKey = hash(
        JSON.stringify([
          'lock',
          net ?? '',
          job.path ?? '',
          [r6(start.x), r6(start.y), start.layer],
          [r6(end.x), r6(end.y), end.layer],
          ...(pr ? [['pair', pr.netN, pr.w, pr.g]] : []),
        ]),
      )
    }
    const cr = job.corner?.radius
    if (!pr && typeof cr === 'number' && cr > 0) {
      const mine = new Set(added.slice(firstAdded).map(i => i.id))
      roundManual(
        manual,
        cr,
        width,
        net,
        lazyFree(() => buildLayout(board, mine, rules)),
      )
    }
    if (pr) {
      pr.start = start
      pr.endLayer = layer
      // a leg at a pair's end starts a straight stub away from its pads, so the tracks do not fan across them
      const stubLine = (pts: Pt[], lyr: string) => {
        const id = nextId++
        push({ kind: 'track', id, layer: lyr, net, ref: job.ref, ...whole, ...rid, pts, width } as Track)
        pr!.ids.push(id)
        return { kind: 'pts' as const, layer: lyr, pts, auto: true }
      }
      const first = pr.pieces[0],
        last = pr.pieces[pr.pieces.length - 1]
      const pctx = pairFrees(net!, pr.netN, new Set(pr.ids))
      const fpOf = (pad: Pad | null): Pt | undefined => {
        const f = pad && board.footprints.find(f => f.ref === pad.ref)
        return f ? f.at : undefined
      }
      const stubJob = {
        w: pr.w,
        g: pr.g,
        nets: [net!, pr.netN] as [string, string],
        minWidth: rules.minTrackWidth,
        margin: P.clearance ?? BASE_AUTOROUTE.clearance,
        ...(job.neck ? { neck: job.neck } : {}),
      }
      if (first?.kind === 'leg') {
        const leg = legs[first.k]
        const s = pairStub(stubJob, pr.startPads, [pr.pads[0], pr.pads[1]], start.layer, fpOf(pr.pads[0]), [leg.to.x, leg.to.y], pctx)
        if (s) {
          const q: Pt = [nm(s[0]), nm(s[1])]
          pr.pieces.unshift(stubLine([[start.x, start.y], q], start.layer))
          leg.from = { x: q[0], y: q[1], layer: start.layer }
        }
      }
      if (last?.kind === 'leg' && job.steps?.[job.steps.length - 1]?.op !== 'X') {
        const leg = legs[last.k],
          e: Pt = [leg.to.x, leg.to.y]
        const s = pairStub(stubJob, pr.endPads, [pr.pads[2], pr.pads[3]], leg.to.layer, fpOf(pr.pads[2]), [leg.from.x, leg.from.y], pctx)
        if (s) {
          const q: Pt = [nm(s[0]), nm(s[1])]
          pr.pieces.push(stubLine([q, e], leg.to.layer))
          leg.to = { x: q[0], y: q[1], layer: leg.to.layer }
        }
      }
      // P must arrive on the side it left on, or the other after an odd number of crossovers
      const ends = pr.pieces.filter(pc => pc.kind === 'pts') as { kind: 'pts'; pts: Pt[] }[]
      const p0 = pr.pieces[0],
        p1 = pr.pieces[pr.pieces.length - 1]
      if (p0?.kind === 'pts' && p1?.kind === 'pts' && ends.length) {
        const d0 = unitOf(p0.pts[0], p0.pts[1]),
          d1 = unitOf(p1.pts[p1.pts.length - 2], p1.pts[p1.pts.length - 1])
        const side = (pads: [Pt, Pt], d: Pt) => (pads[0][0] - pads[1][0]) * d[1] - (pads[0][1] - pads[1][1]) * d[0]
        const square = (pads: [Pt, Pt], d: Pt) => {
          const u = unitOf(pads[0], pads[1])
          return Math.abs(u[0] * d[0] + u[1] * d[1]) < 0.05
        }
        const odd = pr.pieces.filter(pc => pc.kind === 'via' && pc.cross).length % 2 === 1
        const s0 = side(pr.startPads, d0),
          s1 = side(pr.endPads, d1)
        if (square(pr.startPads, d0) && square(pr.endPads, d1) && Math.abs(s0) > 1e-9 && Math.abs(s1) > 1e-9 && s0 > 0 !== (s1 > 0 !== odd)) {
          const hand = (v: number) => (v > 0 ? 'left' : 'right')
          pr.crossed = `the pair would have to cross itself: P leaves its start pad on the ${hand(s0)} of the direction of travel, but its end pad at (${fmt(pr.endPads[0][0])}, ${fmt(pr.endPads[0][1])}) is on the ${hand(s1)} as the path arrives${odd ? ', after its crossover' : ''}; swap P and N at a via pair with .cross(layer) in the chain, or swap the pins at one end`
        }
      }
    } else if (net !== undefined) {
      // neck-down: a stub before an automatic leg, else the end manual tracks split where full width clears the pads
      const endAtLast = job.steps?.length ? job.steps[job.steps.length - 1].op : 'XZ'
      const mine = () => board.items.filter((i): i is Track => i.kind === 'track' && job.route !== undefined && i.route === job.route)
      for (const [pad, atStart] of [
        [padA, true],
        [padB, false],
      ] as const) {
        if (!pad) continue
        const neck = neckOf(pad, width, rules.minTrackWidth, job.neck)
        if (!neck) continue
        const free = padFree()
        const fpAt = board.footprints.find(f => f.ref === pad.ref)?.at
        const leg = atStart ? legs[0] : legs[legs.length - 1]
        const legAtPad = !!leg && (atStart ? same([leg.from.x, leg.from.y], pad.at) : same([leg.to.x, leg.to.y], pad.at) && endAtLast !== 'X')
        const cl = classClearanceOf(board, rules, net, undefined)
        if (legAtPad) {
          const lyr = atStart ? leg.from.layer : leg.to.layer
          const s = neckStub(free, pad, lyr, net, width + 2 * (P.clearance ?? BASE_AUTOROUTE.clearance), neck, cl, fpAt, atStart ? [leg.to.x, leg.to.y] : [leg.from.x, leg.from.y])
          if (!s) continue
          const q: Pt = [nm(s[0]), nm(s[1])]
          push({ kind: 'track', id: nextId++, layer: lyr, net, ref: job.ref, ...whole, ...rid, pts: atStart ? [pad.at, q] : [q, pad.at], width: neck.width } as Track)
          if (atStart) leg.from = { x: q[0], y: q[1], layer: lyr }
          else leg.to = { x: q[0], y: q[1], layer: lyr }
          continue
        }
        const t = mine().find(tr => same(atStart ? tr.pts[0] : tr.pts[tr.pts.length - 1], pad.at) && tr.width === width)
        if (!t) continue
        const pts = atStart ? t.pts : t.pts.slice().reverse()
        const d: Pt = unitOf(pts[0], pts[1])
        const reach = padReach(pad, pad.at, d)
        const len = neckLength(free, t.layer, pts, net, width, reach + neck.length, cl, width > padMinor(pad) + 1e-9 ? reach : 0)
        if (len <= 1e-9) continue
        const hd = atStart ? { width: neck.width, length: len } : null,
          tl = atStart ? null : { width: neck.width, length: len }
        const parts: { pts: Pt[]; prims?: Prim[]; width: number }[] = t.prims
          ? neckPrims(t.prims, width, hd, tl).map(q => ({ ...trackShape(q.prims), width: q.width }))
          : neckPieces(t.pts, width, hd, tl).map(q => ({ pts: q.pts.map(([x, y]) => [nm(x), nm(y)] as Pt), width: q.width }))
        const rest = parts.find(q => q.width === width),
          thin = parts.find(q => q.width !== width)
        if (!thin) continue
        if (rest) {
          t.pts = rest.pts
          if (rest.prims) t.prims = rest.prims
          else delete t.prims
        } else {
          t.width = thin.width
          continue
        }
        const { id: _, prims: _p, ...base } = t
        push({ ...base, id: nextId++, ...thin, width: thin.width } as Track)
      }
    }
    if (pr?.crossed) {
      // not routed: no layout of this path could carry the pair
      const message = `cannot route the pair of nets ${net} and ${pr.netN}: ${pr.crossed}`
      if (opts.strict) fail(message)
      const e = pr.endPads,
        at: ResolvedPos = { x: (e[0][0] + e[1][0]) / 2, y: (e[0][1] + e[1][1]) / 2, layer: pr.endLayer ?? start.layer }
      report.legs += legs.length
      report.failed += legs.length
      failures.push({ net, leg: 1, legs: 1, from: at, to: at, layers: [at.layer], reason: pr.crossed, message, blockers: [], ...whole })
      legs.length = 0
    }
    // a lone automatic leg joins the net's copper, but not at an end the neck moved off its pad, and never for a length or a match
    const single = !job.steps || (job.steps.length === 1 && job.steps[0].op === 'XZ')
    const joins = !pr && !job.direct && net !== undefined && single && (P.algorithm === undefined || P.algorithm === 'maze') && legs.length === 1 && !job.length && !job.match
    const atPad = (pad: Pad | null, e: ResolvedPos) => !pad || same([e.x, e.y], pad.at)
    const join: [boolean, boolean] | undefined = joins ? [atPad(padA, legs[0].from), atPad(padB, legs[0].to)] : undefined
    runs.push({
      job,
      P,
      net,
      width,
      layer: start.layer,
      via,
      legs,
      fail,
      lockKey,
      ...(pr ? { pair: pr } : {}),
      ...(join ? { join } : {}),
      ...(job.direct && !pr ? { direct: true } : {}),
    })
  }

  // pass 2: one task per automatic leg and per whole net, by priority, then declaration order
  const runOrder = runs
    .map((r, i) => ({ r, i, pr: r.P.priority ?? 0 }))
    .sort((a, b) => b.pr - a.pr || a.i - b.i)
    .map(x => x.r)
  // the joining legs of one net and priority take their places widest first, then longest, so trunks carry the width
  {
    const spanOfLeg = (r: Run) => {
      const l = r.legs![0]
      return Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y)
    }
    const groups = new Map<string, number[]>()
    runOrder.forEach((r, i) => {
      if (r.join) {
        const k = `${r.P.priority ?? 0}\u0000${r.net}`
        groups.set(k, [...(groups.get(k) ?? []), i])
      }
    })
    for (const at of groups.values()) {
      const rs = at.map(i => runOrder[i]).sort((a, b) => b.width - a.width || spanOfLeg(b) - spanOfLeg(a))
      at.forEach((i, k) => {
        runOrder[i] = rs[k]
      })
    }
  }
  /** `key` is '' for a lock's result; `wn` is a whole net's index among the whole-net results, -1 for a leg. */
  interface Placed {
    key: string
    a: ResolvedPos
    b: ResolvedPos
    result: RouteResult
    objs: Item[]
    wn: number
  }
  interface Task {
    seq: number
    r: Run
    /** the leg's index in r.legs, -1 for a whole net */
    k: number
    placed: Placed[]
    items: number[]
    result: RouteResult | null
    how?: 'cache' | 'lock' | 'route'
    /** `with`: the leg it collided with last */
    fail?: { reason: string; layers: string[]; key: string; with?: Task }
    /** the failure came from the cache */
    stored?: boolean
    /** the leg of higher priority that took this leg's place, when it did */
    displaced?: Task
    /** the result's grown copper by layers, width, drill and gap */
    memo: Map<string, RingSet | null>
    box?: Box
    shared: { hist: Float32Array; cell: number }[]
    /** the legs whose copper this leg's join or widened trunk lies on */
    on?: Set<Task>
    /** the end that stayed off a trunk too narrow for it: routed to its pad, or joined with the trunk left thin */
    narrow?: Narrow
    /** a joining leg the loop check took off the board; its result stays cached */
    pruned?: boolean
  }
  const tasks: Task[] = []
  for (const r of runOrder)
    for (let k = 0; k < (r.legs ? r.legs.length : 1); k++)
      tasks.push({ seq: tasks.length, r, k: r.legs ? k : -1, placed: [], items: [], result: null, memo: new Map(), shared: [] })
  const firstLegId = nextId
  let wnCount = 0
  const ripupOf = (t: Task) => t.r.P.ripup ?? RIPUP
  const isMaze = (a: AutoRouteParams['algorithm'] | undefined) => a === undefined || a === 'maze'
  const whereOf = (s: Src | undefined) => (s ? ` (${s.file}:${s.line}:${s.col})` : '')
  const bySeq = (x: Task, y: Task) => x.seq - y.seq

  interface Try {
    layers: string[]
    req?: RouteRequest
    key: string
    reason: string
  }
  interface Ctx {
    placed: Set<number>
    viaCount: number
    locked?: LockEntry
    cacheable: boolean
    router: RouteFn
    nets: Set<string>
    twin?: { net: string; partner: string }
    tries(a: ResolvedPos, b: ResolvedPos, layers: string[]): Try[]
    place(t: Task, res: RouteResult, key: string, a: ResolvedPos, b: ResolvedPos, o?: Origin, wn?: number, extra?: Strip[]): void
    /** adds the widened trunk under a placed leg */
    attach(t: Task, strips: Strip[]): void
    failed(a: ResolvedPos, b: ResolvedPos, layers: string[], reason: string, label: string, leg: number, legs: number, o?: Origin): void
    boxAround(a: ResolvedPos, b: ResolvedPos, res: RouteResult): Box
  }
  const ctxs = new Map<Run, Ctx>()
  const valid = (res: RouteResult | undefined | null): res is RouteResult => !!res && Array.isArray(res.tracks) && Array.isArray(res.vias)
  // kind scoped class clearances change the gap to every item, so they are in every signature
  const kindSig =
    board.classes && Object.values(board.classes).some(c => c.clearanceTo)
      ? JSON.stringify(['kinds', Object.entries(board.classes).flatMap(([n, c]) => (c.clearanceTo ? [[n, c.clearanceTo]] : []))])
      : ''
  const sigsIn = (box: Box, skip: (it: Item) => boolean): string => {
    const sigs: string[] = kindSig ? [kindSig] : []
    for (const it of board.items) {
      if (skip(it)) continue
      const s = itemSig(it, cu)
      if (s && boxHit(s.box, box)) sigs.push(s.sig)
    }
    for (const k of board.keepouts ?? [])
      if (boxHit(boxOf(k.outline.flat()), box))
        sigs.push(JSON.stringify(['keepout', k.layers, k.tracks, k.vias, k.pours, k.outline.map(q => q.map(p => p.map(r4))), ...(k.except ? [k.except] : [])]))
    return hash(sigs.sort().join('\n'))
  }
  /** A failed leg's box: any change may let it through. */
  const EVERYWHERE: Box = [-1e6, -1e6, 1e6, 1e6]

  const open = (r: Run): Ctx => {
    const { job, P, net, width, via, fail } = r
    const twin = r.pair && net !== undefined ? { net, partner: r.pair.netN } : undefined
    const nets = new Set([net, r.pair?.netN].filter((n): n is string => n !== undefined))
    const placed = new Set<number>()
    const router = getRouter(P.algorithm)
    const cacheable = !!cache && typeof P.algorithm !== 'function'
    let avoid: RouteRequest['avoid']
    try {
      avoid = P.avoid?.map(a =>
        'ring' in a
          ? a
          : (() => {
              const q = resolvePos(board, a.pos, r.layer)
              return { ring: circleRing(q.x, q.y, AVOID_RADIUS) }
            })(),
      )
    } catch (e) {
      fail((e as Error).message)
    }
    const md = P.maxDetour
    const detour = typeof md === 'number' ? { ratio: md, floor: DETOUR_FLOOR } : { ratio: md?.ratio ?? DETOUR_RATIO, floor: md?.floor ?? DETOUR_FLOOR }
    const c: Ctx = {
      placed,
      viaCount: 0,
      cacheable,
      router,
      nets,
      twin,
      tries: null!,
      place: null!,
      attach: null!,
      failed: null!,
      boxAround: null!,
      ...(r.lockKey && cache ? { locked: cache.lock(r.lockKey) } : {}),
    }
    const request = (start: ResolvedPos, end: ResolvedPos, layers: string[]): RouteRequest => ({
      net,
      width,
      start,
      end,
      layers,
      via,
      viaCost: P.viaCost,
      clearance: P.clearance,
      bend: P.bend,
      ...(P.pitch !== undefined ? { pitch: P.pitch } : {}),
      ...(P.prefer ? { prefer: P.prefer } : {}),
      ...(avoid?.length ? { avoid } : {}),
      ...(P.maxVias !== undefined ? { maxVias: Math.max(0, P.maxVias - c.viaCount) } : {}),
      ...(P.viaInPad ? { viaInPad: true } : {}),
      ...(r.pair ? { pair: { partner: r.pair.netN, width: r.pair.w, gap: r.pair.g } } : {}),
      ...(detour.ratio > 0 ? { maxDetour: detour } : {}),
    })
    // then the outer layers too when the layers were not set
    c.tries = (a, b, layers) => {
      const lists = [layers]
      if (!P.layers && P.maxVias !== 0) {
        const wide = byStack([...layers, ...outerLayers])
        if (wide.length > layers.length) lists.push(wide)
      }
      return lists.map((ls): Try => {
        const reachable = (e: ResolvedPos) => [e.layer, ...(e.layers ?? [])].some(l => ls.includes(l))
        const common = [a.layer, ...(a.layers ?? [])].some(l => [b.layer, ...(b.layers ?? [])].includes(l) && ls.includes(l))
        if (!common && reachable(a) && reachable(b) && P.maxVias !== undefined && P.maxVias - c.viaCount < 1)
          return {
            layers: ls,
            key: '',
            reason: `it changes layer from ${a.layer} to ${b.layer}, but ${P.maxVias === 0 ? 'vias are off for this route, maxVias is 0' : `maxVias is ${P.maxVias} and the route has placed ${c.viaCount}`}`,
          }
        const req = request(a, b, ls)
        const mode = r.direct ? ['direct'] : r.join ? [['join', ...r.join]] : []
        return { layers: ls, req, key: cacheable ? hash(JSON.stringify([boardKey, P.algorithm ?? 'maze', P.priority ?? 0, req, ...mode])) : '', reason: 'no path found' }
      })
    }
    const rid = job.route !== undefined ? { route: job.route } : {}
    c.place = (t, res, key, a, b, o = { src: job.src, ...(job.chain ? { chain: job.chain } : {}) }, wn = -1, extra) => {
      const objs: Item[] = []
      for (const tr of res.tracks) {
        if (!tr.pts || tr.pts.length < 2) continue
        objs.push({ kind: 'track', id: nextId++, layer: layerName(board, tr.layer), net, ref: job.ref, ...o, ...rid, pts: tr.pts.map(([x, y]) => [x, y] as Pt), width } as Track)
      }
      for (const v of res.vias) {
        const pair = v.layers.map(l => layerName(board, l)).sort((x, y) => order(x) - order(y)) as [string, string]
        objs.push({ kind: 'via', id: nextId++, layer: pair[0], net, ref: job.ref, ...o, ...rid, at: [v.x, v.y], drill: via.drill, size: via.size, layers: pair } as Via)
        c.viaCount++
      }
      for (const it of objs) {
        push(it)
        placed.add(it.id)
        t.items.push(it.id)
        owner.set(it.id, t)
      }
      t.placed.push({ key, a, b, result: res, objs, wn })
      t.result = res
      t.memo.clear()
      t.box = undefined
      if (extra?.length) c.attach(t, extra)
    }
    c.attach = (t, strips) => {
      const p = t.placed[t.placed.length - 1]
      if (!p) return
      const o: Origin = { src: job.src, ...(job.chain ? { chain: job.chain } : {}) }
      for (const s of strips) {
        const tr = { kind: 'track', id: nextId++, layer: s.layer, net, ref: job.ref, ...(legOf(t).own ?? o), ...rid, pts: s.pts, width: s.width } as Track
        overlays.add(tr)
        p.objs.push(tr)
        push(tr)
        placed.add(tr.id)
        t.items.push(tr.id)
        owner.set(tr.id, t)
      }
      t.memo.clear()
      t.box = undefined
    }
    const reach = Math.max(rules.clearance, maxClearance(board)) + Math.max(width, via.size) + rules.minHoleToHole + rules.holeClearance + (P.clearance ?? 0) + 0.5
    c.boxAround = (a, b, res) => {
      const pts: Pt[] = [[a.x, a.y], [b.x, b.y], ...res.tracks.flatMap(t => t.pts), ...res.vias.map(v => [v.x, v.y] as Pt)]
      const bx = boxOf(pts)
      return [r4(bx[0] - reach), r4(bx[1] - reach), r4(bx[2] + reach), r4(bx[3] + reach)]
    }
    const describe = (a: ResolvedPos, b: ResolvedPos, layers: string[]) =>
      `net ${net ?? '(no net)'} from (${fmt(a.x)}, ${fmt(a.y)}) on ${a.layer} to (${fmt(b.x)}, ${fmt(b.y)}) on ${b.layer}, layers ${layers.join(', ')}`
    c.failed = (a, b, layers, reason, label, leg, legs, o) => {
      if (opts.strict) throw new CompileError(`cannot route ${label}${describe(a, b, layers)}: ${reason}`, job.src)
      report.failed++
      failures.push({
        ...(net !== undefined ? { net } : {}),
        leg,
        legs,
        from: a,
        to: b,
        layers,
        reason,
        blockers: blockersOf(board, nets, [a.x, a.y], [b.x, b.y], layers, placed),
        ...((o?.src ?? job.src) ? { src: job.src ?? o?.src } : {}),
        ...(job.chain ? { chain: job.chain } : {}),
      })
    }
    return c
  }
  const ctxOf = (r: Run): Ctx => {
    let c = ctxs.get(r)
    if (!c) ctxs.set(r, (c = open(r)))
    return c
  }
  const legOf = (t: Task) => t.r.legs![t.k]
  const layersOf = (t: Task) => {
    const leg = legOf(t)
    return t.r.P.layers ?? byStack([leg.from.layer, leg.to.layer])
  }

  const owner = new Map<number, Task>()
  const store = storeOf(board, rules, cu)
  interface Ends {
    terms: Terms
    connected: boolean
    comps: [Item[], Item[]]
    at: [Item[], Item[]]
  }
  /** A leg's own net as the search sees it: the copper joined to each end, the rest of the net fenced off; null for a pair, a whole net or another router. */
  const endsOf = (t: Task, sides: [boolean, boolean]): Ends | null => {
    const r = t.r,
      net = r.net
    if (r.pair || !r.legs || net === undefined || !isMaze(r.P.algorithm)) return null
    const leg = legOf(t),
      mine = new Set(t.items)
    const its = board.items.filter(it => it.net === net && it.kind !== 'zone' && it.id >= 0 && !mine.has(it.id) && copperLayersOf(it, cu).length)
    const idx = new Map(its.map((it, i) => [it, i]))
    const up = its.map((_, i) => i)
    const find = (i: number): number => {
      while (up[i] !== i) i = up[i] = up[up[i]]
      return i
    }
    for (const l of cu) {
      const on = its.filter(it => copperLayersOf(it, cu).includes(l) && copperRings(it, l).length)
      const boxes = on.map(it => copperBox(it, l))
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++) {
          const a = boxes[i],
            b = boxes[j]
          if (a.x > b.x + b.w || b.x > a.x + a.w || a.y > b.y + b.h || b.y > a.y + a.h) continue
          const x = find(idx.get(on[i])!),
            y = find(idx.get(on[j])!)
          if (x !== y && joined(on[i], on[j], l)) up[x] = y
        }
    }
    const at = (e: ResolvedPos) => its.filter(it => [e.layer, ...(e.layers ?? [])].some(l => copperLayersOf(it, cu).includes(l) && inside(ringSet(solidRings(it, l)), e.x, e.y)))
    const a0 = at(leg.from),
      a1 = at(leg.to)
    const compOf = (seeds: Item[]) => {
      const roots = new Set(seeds.map(it => find(idx.get(it)!)))
      return its.filter(it => roots.has(find(idx.get(it)!)))
    }
    const c0 = compOf(a0),
      c1 = compOf(a1)
    const connected = c0.some(it => c1.includes(it))
    // the copper an end may join is free; everything else of the net is fenced but the pads and vias at the ends, and a disc where a track ends at one
    const keep = new Set([...(sides[0] ? c0 : []), ...(sides[1] ? c1 : [])])
    const lands: Item[] = [...new Set([...a0, ...a1])].filter(it => it.kind === 'pad' || it.kind === 'via')
    const dots = (
      [
        [leg.from, a0],
        [leg.to, a1],
      ] as const
    ).flatMap(([e, at]) => {
      const w = Math.max(0, ...at.map(it => (it.kind === 'track' ? it.width : 0)))
      return w ? [{ kind: 'via', id: -1, layer: cu[0], net, at: [e.x, e.y], drill: 0, size: w, layers: [cu[0], cu[cu.length - 1]] } as Via] : []
    })
    // a pad that nothing joins yet is no fence unless the leg is direct: crossing it joins it and closes no loop
    const sizes = new Map<number, number>()
    for (const it of its) {
      const k = find(idx.get(it)!)
      sizes.set(k, (sizes.get(k) ?? 0) + 1)
    }
    const lone = (it: Item) => !r.direct && it.kind === 'pad' && sizes.get(find(idx.get(it)!)) === 1
    const terms: Terms = {
      src: sides[0] && c0.length ? c0 : null,
      dst: sides[1] && c1.length ? c1 : null,
      block: its.filter(it => !keep.has(it) && !lands.includes(it) && !lone(it)),
      exempt: [...lands, ...dots],
      gap: classClearanceOf(board, rules, net, undefined),
      grow: (it, l, d) => store.copper(it, store.rec(it), l, d),
    }
    return { terms, connected, comps: [c0, c1], at: [a0, a1] }
  }
  // a future `current` on routes and classes would size a shared trunk from the sum of its branch currents here
  const trunkWidth = (t: Task) => t.r.width
  /** The trunk under a joining leg's junctions at the leg's width, or the end whose trunk cannot widen. */
  const widen = (t: Task, res: RouteResult, e: Ends, kept: (0 | 1)[] = []): { strips: Strip[]; narrow?: 0 | 1 } => {
    const leg = legOf(t),
      w = trunkWidth(t),
      strips: Strip[] = []
    const tr = res.tracks
    if (!tr.length) return { strips }
    const ends: [Pt, string, ResolvedPos][] = [
      [tr[0].pts[0], tr[0].layer, leg.from],
      [tr[tr.length - 1].pts[tr[tr.length - 1].pts.length - 1], tr[tr.length - 1].layer, leg.to],
    ]
    let layout: RouteContext | undefined
    for (const side of [0, 1] as const) {
      const [J, l0, end] = ends[side],
        layer = layerName(board, l0)
      if (same(J, [end.x, end.y]) || res.vias.some(v => same([v.x, v.y], J))) continue
      const comp = e.comps[side]
      const run = trunkRun(
        comp.filter(it => (owner.get(it.id)?.seq ?? -1) < t.seq),
        e.at[side],
        J,
        layer,
        w,
        cu,
      )
      if (!run) continue
      if (kept.includes(side)) continue
      for (const s of run) {
        if (s.width >= w - 1e-9) continue
        const q = queries((layout ??= buildLayout(board, new Set(t.items), rules)))
        for (let i = 1; i < s.pts.length; i++) if (!q.segFree(s.layer, s.pts[i - 1], s.pts[i], t.r.net, w)) return { strips: [], narrow: side }
        strips.push({ layer: s.layer, pts: s.pts, width: w })
      }
    }
    return { strips }
  }
  /** The legs a joining leg relies on: those in the copper it joined at each end, or in the copper that already joined its ends. */
  const depsOf = (t: Task, e: Ends, res: RouteResult, sides: [boolean, boolean]): Set<Task> => {
    const on = new Set<Task>(),
      tr = res.tracks,
      leg = legOf(t)
    const empty = !tr.length && !res.vias.length
    const at = (side: 0 | 1) => {
      if (!sides[side]) return false
      if (empty) return e.connected
      const p = side ? tr[tr.length - 1].pts[tr[tr.length - 1].pts.length - 1] : tr[0]?.pts[0],
        end = side ? leg.to : leg.from
      return !p || !same(p, [end.x, end.y])
    }
    for (const side of [0, 1] as const)
      if (at(side))
        for (const it of e.comps[side]) {
          const o = owner.get(it.id)
          if (o && o !== t) on.add(o)
        }
    return on
  }
  interface Solved {
    res: RouteResult
    strips: Strip[]
    on: Set<Task>
    narrow?: Narrow
  }
  /** Routes one try of a leg, joining its net's copper where it may; throws as the router does. */
  const solve = (t: Task, req: RouteRequest, route: (req: RouteRequest) => RouteResult): Solved => {
    const r = t.r
    let sides: [boolean, boolean] = r.join ? [...r.join] : [false, false]
    const e = endsOf(t, sides)
    if (!e) return { res: route(req), strips: [], on: new Set() }
    if (e.connected && (sides[0] || sides[1])) {
      const res = { tracks: [], vias: [] }
      return { res, strips: [], on: depsOf(t, e, res, sides) }
    }
    termsOf.set(req, e.terms)
    const res = route(req)
    if (!r.join || !valid(res)) return { res, strips: [], on: new Set() }
    const w = widen(t, res, e)
    if (w.narrow === undefined) return { res, strips: w.strips, on: depsOf(t, e, res, sides) }
    // the trunk cannot carry the width: the leg runs to its pad instead, or joins and leaves the trunk thin when it cannot
    sides = [...sides]
    sides[w.narrow] = false
    const e2 = endsOf(t, sides)!
    termsOf.set(req, e2.terms)
    try {
      const res2 = route(req)
      if (valid(res2)) {
        const w2 = widen(t, res2, e2, [w.narrow])
        return { res: res2, strips: w2.strips, on: depsOf(t, e2, res2, sides), narrow: { side: w.narrow, kept: false } }
      }
    } catch {
      /* joined, thin */
    }
    const w3 = widen(t, res, e, [w.narrow])
    return { res, strips: w3.strips, on: depsOf(t, e, res, r.join!), narrow: { side: w.narrow, kept: true } }
  }
  /** Lays a joining leg's widened trunk again over the copper as it now stands. */
  const restrip = (t: Task) => {
    if (!t.r.join || !t.result || t.pruned) return
    const c = ctxOf(t.r),
      gone = new Set<number>()
    for (const p of t.placed) p.objs = p.objs.filter(it => !overlays.has(it) || (gone.add(it.id), false))
    if (gone.size) {
      for (const list of [board.items, added]) {
        let w = 0
        for (const it of list) if (!gone.has(it.id)) list[w++] = it
        list.length = w
      }
      t.items = t.items.filter(id => !gone.has(id))
      for (const id of gone) {
        c.placed.delete(id)
        owner.delete(id)
      }
    }
    const sides: [boolean, boolean] = [...t.r.join]
    if (t.narrow && !t.narrow.kept) sides[t.narrow.side] = false
    const e = endsOf(t, sides)
    if (!e) return
    const w = widen(t, t.result, e, t.narrow?.kept ? [t.narrow.side] : [])
    c.attach(t, w.strips)
    t.on = depsOf(t, e, t.result, sides)
  }
  const legCost = (t: Task) =>
    objsOf(t).reduce(
      (s, it) =>
        s +
        (it.kind === 'track'
          ? it.pts.reduce((l, q, i) => (i ? l + Math.hypot(q[0] - it.pts[i - 1][0], q[1] - it.pts[i - 1][1]) : l), 0)
          : it.kind === 'via'
            ? (t.r.P.viaCost ?? BASE_AUTOROUTE.viaCost)
            : 0),
      0,
    )
  /** How many groups the pads of a net fall in through its copper but pours. */
  const padGroups = (net: string): number => {
    const its = board.items.filter(it => it.net === net && it.kind !== 'zone' && copperLayersOf(it, cu).length)
    const up = its.map((_, i) => i)
    const find = (i: number): number => {
      while (up[i] !== i) i = up[i] = up[up[i]]
      return i
    }
    for (const l of cu) {
      const on = its.map((it, i) => [it, i] as const).filter(([it]) => copperLayersOf(it, cu).includes(l) && copperRings(it, l).length)
      for (let a = 0; a < on.length; a++)
        for (let b = a + 1; b < on.length; b++) {
          const x = find(on[a][1]),
            y = find(on[b][1])
          if (x !== y && joined(on[a][0], on[b][0], l)) up[x] = y
        }
    }
    return new Set(its.flatMap((it, i) => (it.kind === 'pad' ? [find(i)] : []))).size
  }
  /** Takes off the costliest joining legs that close a loop in their net while the net's pads stay joined. */
  const prune = () => {
    const live = (t: Task) => t.r.join && !!t.result && !t.pruned && t.items.length > 0
    const nets = [...new Set(tasks.filter(live).map(t => t.r.net!))].sort()
    for (const net of nets) {
      let loops = netLoops(board, new Set([net])).length
      if (!loops) continue
      const groups = padGroups(net)
      const cands = tasks
        .filter(t => live(t) && t.r.net === net)
        .map(t => ({ t, cost: legCost(t) }))
        .sort((a, b) => b.cost - a.cost || b.t.seq - a.t.seq)
      for (const { t } of cands) {
        const ids = new Set(t.items),
          all = [...board.items]
        const drop = (list: Item[]) => {
          let w = 0
          for (const it of list) if (!ids.has(it.id)) list[w++] = it
          list.length = w
        }
        drop(board.items)
        const n = netLoops(board, new Set([net])).length
        if (n < loops && padGroups(net) === groups) {
          const c = ctxOf(t.r)
          drop(added)
          for (const id of ids) {
            c.placed.delete(id)
            owner.delete(id)
          }
          for (const p of t.placed) for (const it of p.objs) if (it.kind === 'via') c.viaCount--
          t.items = []
          t.pruned = true
          t.memo.clear()
          t.box = undefined
          loops = n
          if (!loops) break
        } else board.items.splice(0, board.items.length, ...all)
      }
    }
  }
  /** Whether a joining leg's result met its net's copper away from its pads, or found its ends joined already. */
  const joinedIn = (t: Task, res: RouteResult): boolean => {
    const tr = res.tracks,
      leg = legOf(t)
    if (!tr.length) return !res.vias.length
    const z = tr[tr.length - 1].pts[tr[tr.length - 1].pts.length - 1]
    return !same(tr[0].pts[0], [leg.from.x, leg.from.y]) || !same(z, [leg.to.x, leg.to.y])
  }
  /** The signature of the copper a leg sees: what is around it, and for a leg that joined its whole net up to its own turn. */
  const obsOf = (t: Task, box: Box, skip: (it: Item) => boolean): string => {
    const s = sigsIn(box, skip)
    if (!t.r.join || !t.result || !joinedIn(t, t.result)) return s
    const net = t.r.net,
      sigs: string[] = []
    for (const it of board.items) {
      if (it.net !== net || skip(it) || (owner.get(it.id)?.seq ?? -1) > t.seq) continue
      const g = itemSig(it, cu)
      if (g) sigs.push(g.sig)
    }
    return hash(`${s}\n${sigs.sort().join('\n')}`)
  }

  const prio = (t: Task) => t.r.P.priority ?? 0
  const softOk = (t: Task) => t.k >= 0 && t.how !== 'lock' && isMaze(t.r.P.algorithm) && ripupOf(t) > 0
  const sameNet = (a: Task, b: Task) => {
    const nb = ctxOf(b.r).nets
    for (const n of ctxOf(a.r).nets) if (nb.has(n)) return true
    return false
  }
  const gapOf = (a: Task, b: Task) => {
    let g = rules.clearance
    for (const x of ctxOf(a.r).nets) for (const y of ctxOf(b.r).nets) g = Math.max(g, classClearanceOf(board, rules, x, y))
    return g
  }

  // a pair with a complete centre line stands laid out as its last leg's copper until the end of routing; its ids are below zero
  interface Resv {
    laid: PairLaid | null
    err?: PairGeometryError
    items: Item[]
    owner?: Task
    sig: string
  }
  const resvs = new Map<Run, Resv>()
  let resvId = -1
  const resvIds = (r: Run) => new Set(resvs.get(r)?.items.map(it => it.id) ?? [])
  const objsOf = (t: Task): Item[] => {
    const own = t.placed.flatMap(p => p.objs),
      rv = resvs.get(t.r)
    return rv && rv.owner === t && rv.items.length ? [...own, ...rv.items] : own
  }
  const dropResv = (r: Run) => {
    const rv = resvs.get(r)
    if (!rv) return
    resvs.delete(r)
    if (rv.items.length) {
      const ids = new Set(rv.items.map(it => it.id))
      let w = 0
      for (const it of board.items) if (!ids.has(it.id)) board.items[w++] = it
      board.items.length = w
    }
    if (rv.owner) {
      rv.owner.memo.clear()
      rv.owner.box = undefined
    }
  }
  /** A pair's own centre line and legs, and those of pairs already laid out, whose reservation stands for them. */
  const pairExclude = (r: Run): Set<number> => {
    const ids = new Set<number>()
    for (const [o, rv] of resvs)
      if (o !== r && rv.laid) {
        for (const id of o.pair!.ids) ids.add(id)
        for (const t of tasks) if (t.r === o) for (const id of t.items) ids.add(id)
      }
    for (const id of r.pair!.ids) ids.add(id)
    for (const t of tasks) if (t.r === r) for (const id of t.items) ids.add(id)
    return ids
  }
  const layResv = (r: Run): Resv | null => {
    const pr = r.pair
    if (!pr || pr.crossed) return null
    const own = tasks.filter(t => t.r === r).sort((x, y) => x.k - y.k)
    if (own.some(t => !t.result)) return null
    dropResv(r)
    const owner = own[own.length - 1] as Task | undefined
    let rv: Resv
    try {
      const job = pairJobOf(
        board,
        rules,
        r.net!,
        pr,
        own.map(t => t.result!),
        layerName.bind(null, board),
        r.job.neck,
        r.job.corner,
      )
      const laid = layPairJob(job, pairFrees(r.net!, pr.netN, pairExclude(r)))
      const items: Item[] = []
      for (const t of laid.tracks) {
        const sh = t.prims ? trackShape(t.prims) : { pts: t.pts.map(([x, y]) => [nm(x), nm(y)] as Pt) }
        items.push({ kind: 'track', id: resvId--, layer: t.layer, net: t.role === 'P' ? r.net : pr.netN, ...sh, width: nm(t.width) } as Track)
      }
      for (const v of laid.vias) {
        const span = [...v.layers].sort((a, b) => order(a) - order(b)) as [string, string]
        items.push({
          kind: 'via',
          id: resvId--,
          layer: span[0],
          net: v.role === 'P' ? r.net : pr.netN,
          at: [nm(v.at[0]), nm(v.at[1])],
          drill: pr.via.drill,
          size: pr.via.size,
          layers: span,
        } as Via)
      }
      rv = { laid, items, owner, sig: JSON.stringify(items.map(it => (it.kind === 'track' ? [it.layer, it.net, it.pts, it.width] : it.kind === 'via' ? [it.net, it.at] : null))) }
    } catch (e) {
      if (!(e instanceof PairGeometryError)) throw e
      rv = { laid: null, err: e, items: [], owner, sig: `err:${e.message}` }
    }
    for (const it of rv.items) board.items.push(it)
    if (owner) {
      owner.memo.clear()
      owner.box = undefined
    }
    resvs.set(r, rv)
    return rv
  }
  const boxOfTask = (t: Task): Box => {
    if (t.box) return t.box
    const objs = objsOf(t)
    const pts = objs.flatMap(it => (it.kind === 'track' ? it.pts : it.kind === 'via' ? [it.at] : []))
    const b = pts.length ? boxOf(pts) : [0, 0, -1, -1]
    const m =
      Math.max(0, ...objs.map(it => (it.kind === 'track' ? it.width : it.kind === 'via' ? it.size : 0))) / 2 +
      maxClearance(board) +
      rules.clearance +
      rules.minHoleToHole +
      rules.holeClearance
    return (t.box = [b[0] - m, b[1] - m, b[2] + m, b[3] + m])
  }
  const itemBox = (it: Item): Box => {
    const pts = it.kind === 'track' ? it.pts : it.kind === 'via' ? [it.at] : []
    const b = boxOf(pts),
      m = it.kind === 'track' ? it.width / 2 : it.kind === 'via' ? it.size / 2 : 0
    return [b[0] - m, b[1] - m, b[2] + m, b[3] + m]
  }
  /** The box of the first two items of two legs that break a clearance, or null; holes of any nets keep minHoleToHole. */
  const clash = (a: Task, b: Task): Box | null => {
    if (!a.result || !b.result || !boxHit(boxOfTask(a), boxOfTask(b))) return null
    const at = (x: Item, y: Item): Box => {
      const p = itemBox(x),
        q = itemBox(y)
      return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])]
    }
    const A = objsOf(a),
      B = objsOf(b)
    if (sameNet(a, b)) {
      const vb = B.filter((it): it is Via => it.kind === 'via')
      for (const x of A)
        if (x.kind === 'via') for (const y of vb) if (Math.hypot(x.at[0] - y.at[0], x.at[1] - y.at[1]) < rules.minHoleToHole + (x.drill + y.drill) / 2 - 1e-6) return at(x, y)
      return null
    }
    const gap = gapOf(a, b)
    for (const x of A) for (const y of B) if (itemsClash(x, y, gap, rules, cu)) return at(x, y)
    return null
  }
  const unplace = (t: Task) => {
    if (t.r.pair) dropResv(t.r)
    const ids = new Set(t.items)
    for (const list of [board.items, added]) {
      let w = 0
      for (const it of list) if (!ids.has(it.id)) list[w++] = it
      list.length = w
    }
    const c = ctxOf(t.r)
    for (const id of ids) c.placed.delete(id)
    for (const p of t.placed) for (const it of p.objs) if (it.kind === 'via') c.viaCount--
    for (const id of ids) owner.delete(id)
    t.placed = []
    t.items = []
    t.result = null
    t.memo.clear()
    t.box = undefined
    t.on = undefined
    t.narrow = undefined
    t.pruned = false
    // a leg joined to this one's copper loses its junction and routes again
    for (const d of tasks)
      if (d.result && d.on?.has(t)) {
        onOrphan?.(d)
        unplace(d)
        d.how = undefined
        d.fail = undefined
        d.stored = false
        orphans.push(d)
      }
  }
  const orphans: Task[] = []
  let onOrphan: ((t: Task) => void) | null = null
  const routeOrphans = () => {
    orphans.sort(bySeq)
    while (orphans.length) {
      const o = orphans.shift()!
      if (!o.result && !o.fail && !o.stored) routeHard(o)
    }
  }
  /** Unplaces the soft legs of lower priority, or with `any` of any priority not higher, that t's copper collides with. */
  const displaceBy = (t: Task, any = false): Task[] => {
    const out: Task[] = []
    for (const o of tasks) {
      if (o === t || o.r === t.r || !o.result || !softOk(o) || (any ? prio(o) > prio(t) : prio(o) >= prio(t))) continue
      if (!clash(t, o)) continue
      unplace(o)
      o.how = undefined
      o.fail = undefined
      o.stored = false
      o.displaced = t
      out.push(o)
    }
    return out
  }
  const settleAfter = (t: Task): Task[] => {
    const out = displaceBy(t)
    if (t.r.pair && t.result) {
      const rv = layResv(t.r)
      if (rv?.owner && rv.owner !== t && rv.items.length) out.push(...displaceBy(rv.owner))
    }
    return out
  }

  /** Routes a leg with every copper as an obstacle but the legs of lower priority, which it may displace. */
  const routeHard = (t: Task): boolean => {
    const c = ctxOf(t.r),
      leg = legOf(t)
    const ts = c.tries(leg.from, leg.to, layersOf(t))
    const lower = tasks.filter(o => o !== t && o.r !== t.r && o.result && prio(o) < prio(t) && softOk(o))
    let layout: RouteContext | undefined
    for (const q of ts) {
      if (!q.req) continue
      let s: Solved
      try {
        s = solve(t, q.req, req => c.router(req, (layout ??= buildLayout(board, c.placed, rules, lower.flatMap(objsOf), c.twin))))
      } catch (e) {
        q.reason = (e as Error).message
        continue
      }
      if (!valid(s.res)) {
        q.reason = 'the router returned no geometry'
        continue
      }
      c.place(t, s.res, q.key, leg.from, leg.to, leg.own, -1, s.strips)
      t.how = 'route'
      t.fail = undefined
      t.on = s.on
      t.narrow = s.narrow
      settleAfter(t)
      return true
    }
    const last = ts[ts.length - 1]
    const by = t.displaced ? `; the route of net ${t.displaced.r.net ?? '(no net)'}${whereOf(t.displaced.r.job.src)}, of higher priority, took its place` : ''
    t.fail = { reason: last.reason + by, layers: last.layers, key: last.key }
    return false
  }
  const rerouteDisplaced = () => {
    for (const t of tasks) if (t.k >= 0 && !t.result && t.displaced && !t.fail) routeHard(t)
    routeOrphans()
  }

  /** Routes ratsnest lines of a whole net until it is one island, skipping the lines that failed. */
  const routeNet = (t: Task) => {
    const r = t.r,
      c = ctxOf(r),
      { P, net } = r
    if (net === undefined) r.fail('a track without d or a net has nothing to route')
    const layers = P.layers ?? [r.layer]
    const line = (a: ResolvedPos, b: ResolvedPos, k: number, total: number): RouteResult | null => {
      report.legs++
      const ts = c.tries(a, b, layers)
      for (const q of ts) {
        if (!q.req || !c.cacheable) continue
        const e = cache!.leg(q.key)
        if (e?.result && valid(e.result) && sigsIn(e.box, it => c.placed.has(it.id)) === e.obs) {
          report.cached++
          report.routed++
          c.place(t, e.result, q.key, a, b, undefined, wnCount++)
          return e.result
        }
      }
      let layout: RouteContext | undefined
      for (const q of ts) {
        if (!q.req) continue
        let res: RouteResult
        try {
          res = c.router(q.req, (layout ??= buildLayout(board, c.placed, rules, [], c.twin)))
        } catch (e) {
          q.reason = (e as Error).message
          continue
        }
        if (!valid(res)) {
          q.reason = 'the router returned no geometry'
          continue
        }
        report.routed++
        c.place(t, res, q.key, a, b, undefined, wnCount++)
        return res
      }
      const last = ts[ts.length - 1]
      c.failed(a, b, last.layers, last.reason, '', k, total)
      return null
    }
    const lineKey = (x: { from: Pt; to: Pt }) =>
      [x.from, x.to]
        .map(q => q.map(r4).join(','))
        .sort()
        .join(' ')
    const skip = new Set<string>()
    const all = () => connectivity(board).ratsnest.filter(x => x.net === net)
    let lines = all()
    const total = lines.length
    let guard = lines.length * 2 + 4,
      k = 0
    for (;;) {
      const todo = lines.filter(x => !skip.has(lineKey(x)))
      if (!todo.length) break
      const rn = todo[0]
      const a = endpoint(board, net!, rn.from, r.layer, layers, cu),
        b = endpoint(board, net!, rn.to, r.layer, layers, cu)
      if (guard-- <= 0) {
        c.failed(a, b, layers, `net ${net} is still not connected after routing`, '', ++k, total)
        break
      }
      const res = line(a, b, ++k, total)
      const after = all()
      if (!res) skip.add(lineKey(rn))
      else if (after.length >= lines.length) {
        skip.add(lineKey(rn))
        c.failed(
          a,
          b,
          layers,
          `routing net ${net} from (${fmt(rn.from[0])}, ${fmt(rn.from[1])}) to (${fmt(rn.to[0])}, ${fmt(rn.to[1])}) did not join the two islands`,
          '',
          k,
          total,
        )
      }
      lines = after
    }
  }

  // stored results are placed first, then checked against the copper around them, the last compile's final copper
  const entries = new Map<Task, LegEntry>()
  for (const t of tasks) {
    if (t.k < 0) continue
    const c = ctxOf(t.r),
      leg = legOf(t)
    const kept = c.locked && c.locked.legs.length === t.r.legs!.length ? c.locked.legs[t.k] : null
    if (valid(kept)) {
      c.place(t, kept, '', leg.from, leg.to, leg.own)
      t.how = 'lock'
      continue
    }
    if (!c.cacheable) continue
    for (const q of c.tries(leg.from, leg.to, layersOf(t))) {
      const e = q.req ? cache!.leg(q.key) : undefined
      if (!e) continue
      // a stored failure holds only under the same negotiation bound
      if (e.result === null && e.fail) {
        if (e.fail.ripup === ripupOf(t)) {
          entries.set(t, e)
          t.fail = { reason: e.fail.reason, layers: e.fail.layers, key: q.key }
          t.stored = true
        }
      } else if (valid(e.result)) {
        entries.set(t, e)
        c.place(t, e.result, q.key, leg.from, leg.to, leg.own)
        t.how = 'cache'
        if (e.narrow) t.narrow = { ...e.narrow }
      }
      break
    }
  }
  for (const r of runs) if (r.pair) layResv(r)
  if (entries.size) {
    prune()
    for (const t of tasks) if (t.how === 'cache') restrip(t)
    const stale = new Set<Task>()
    for (const [t, e] of entries) {
      const own = ctxOf(t.r).placed,
        rv = resvIds(t.r)
      if (obsOf(t, e.box, it => own.has(it.id) || rv.has(it.id)) !== e.obs) stale.add(t)
    }
    // with maxVias each request counts the earlier legs' vias, so one stale leg makes the rest stale
    for (const t of [...stale]) if (t.r.P.maxVias !== undefined) for (const o of entries.keys()) if (o.r === t.r) stale.add(o)
    for (const t of stale) {
      if (t.how === 'cache') unplace(t)
      t.how = undefined
      t.fail = undefined
      t.stored = false
    }
  }
  // a cached leg must also keep clear of the legs before it and the locked ones
  for (const t of tasks) {
    if (t.how !== 'cache') continue
    for (const o of tasks) {
      if (o === t || !o.result || (o.seq > t.seq && o.how !== 'lock') || !clash(t, o)) continue
      unplace(t)
      t.how = undefined
      break
    }
  }
  opts.progress?.({ done: 0, legs: tasks.length })
  for (const t of tasks) {
    if (t.k < 0) routeNet(t)
    else if (!t.result && !t.stored) routeHard(t)
    opts.progress?.({ done: t.seq + 1, legs: tasks.length })
  }
  routeOrphans()

  let rounds = 0
  if (tasks.some(t => t.fail && !t.stored && softOk(t))) rounds = negotiate(tasks.filter(t => t.fail && softOk(t)))
  rerouteDisplaced()

  // pairs laid out again against the final copper displace the legs their new layout collides with
  for (let pass = 0; pass < 4; pass++) {
    const before = new Map([...resvs].map(([r, rv]) => [r, rv.sig]))
    for (const r of runs) if (r.pair) dropResv(r)
    let moved = false
    for (const r of runs) {
      const rv = r.pair ? layResv(r) : null
      if (!rv?.owner || rv.sig === before.get(r) || !rv.items.length) continue
      if (displaceBy(rv.owner, true).length) moved = true
    }
    if (!moved) break
    rerouteDisplaced()
    if (pass === 3) {
      for (const r of runs) if (r.pair) dropResv(r)
      for (const r of runs) if (r.pair) layResv(r)
    }
  }

  /** PathFinder negotiation over the soft legs; a leg ignores lower-priority legs, which move instead. Returns the rounds run. */
  function negotiate(failed: Task[]): number {
    const pool = tasks.filter(softOk)
    const bound = Math.max(...failed.map(ripupOf))
    // everything but the soft legs, whose cost comes from the field
    const layouts = new Map<string, RouteContext>()
    const hardLayout = (c: Ctx) => {
      const key = c.twin ? `${c.twin.net}\u0000${c.twin.partner}` : ''
      let l = layouts.get(key)
      if (!l) layouts.set(key, (l = buildLayout(board, new Set(), rules, pool.flatMap(objsOf), c.twin)))
      return l
    }
    const hists = new Map<string, Float32Array>()
    const histOf = (layer: string, g: Grid) => {
      const key = `${layer}\u0000${g.p}\u0000${g.x0}\u0000${g.y0}\u0000${g.nx}\u0000${g.ny}`
      let h = hists.get(key)
      if (!h) hists.set(key, (h = new Float32Array(g.nx * g.ny)))
      return h
    }
    /** Where a track centre of width w, or a via of size w and `drill`, would come closer than `gap` to o. */
    const grownOf = (o: Task, ls: string[], w: number, drill: number | undefined, gap: number): RingSet | null => {
      const key = `${ls.join(',')}\u0000${w}\u0000${drill ?? ''}\u0000${gap}`
      let s = o.memo.get(key)
      if (s !== undefined) return s
      const rings: Ring[] = []
      const objs = objsOf(o)
      for (const l of ls) {
        const cuRings = objs.filter(it => copperLayersOf(it, cu).includes(l)).flatMap(it => solidRings(it, l))
        if (cuRings.length) rings.push(...polysToRings(offset(cuRings, gap + w / 2)))
      }
      for (const it of objs) {
        if (it.kind !== 'via') continue
        rings.push(circleRing(it.at[0], it.at[1], it.drill / 2 + rules.holeClearance + w / 2))
        if (drill !== undefined) rings.push(circleRing(it.at[0], it.at[1], it.drill / 2 + rules.minHoleToHole + drill / 2))
      }
      s = rings.length ? ringSet(polysToRings(union(rings.map(outer)))) : null
      o.memo.set(key, s)
      return s
    }
    const classGap = (t: Task) => {
      let g = 0
      for (const n of ctxOf(t.r).nets) {
        const c = classOf(board, n)
        g = Math.max(g, c?.clearance ?? 0, c?.clearanceTo?.track ?? 0, c?.clearanceTo?.via ?? 0)
      }
      return g
    }
    const holesNear = (o: Task, drill: number): RingSet | null => {
      const key = `holes\u0000${drill}`
      let s = o.memo.get(key)
      if (s !== undefined) return s
      const rings = objsOf(o).flatMap(it => (it.kind === 'via' ? [circleRing(it.at[0], it.at[1], it.drill / 2 + rules.minHoleToHole + drill / 2)] : []))
      s = rings.length ? ringSet(polysToRings(union(rings))) : null
      o.memo.set(key, s)
      return s
    }
    // per cell counts of every soft leg, kept up to date as legs move; own net and lower priority are taken out per search
    interface Shared {
      g: Grid
      region: (o: Task) => RingSet | null
      arr: Uint16Array
      members: Set<Task>
    }
    const shared = new Map<string, Shared>()
    const sharedOf = (key: string, g: Grid, region: (o: Task) => RingSet | null): Shared => {
      let f = shared.get(key)
      if (f) return f
      f = { g, region, arr: new Uint16Array(g.nx * g.ny), members: new Set() }
      for (const o of pool)
        if (o.result) {
          const s = region(o)
          if (s) fillAdd(g, s, f.arr, 1)
          f.members.add(o)
        }
      shared.set(key, f)
      return f
    }
    const lift = (t: Task) => {
      for (const f of shared.values())
        if (f.members.delete(t)) {
          const s = f.region(t)
          if (s) fillAdd(f.g, s, f.arr, -1)
        }
    }
    const drop = (t: Task) => {
      for (const f of shared.values())
        if (t.result && !f.members.has(t)) {
          const s = f.region(t)
          if (s) fillAdd(f.g, s, f.arr, 1)
          f.members.add(t)
        }
    }
    const siblings = (t: Task) => (t.r.pair ? pool.filter(x => x.r === t.r) : [t])
    const takeOff = (t: Task) => {
      const sib = siblings(t)
      for (const x of sib) lift(x)
      unplace(t)
      for (const x of sib) if (x !== t) drop(x)
    }
    // other legs grow by half a cell more than the hard grids, so a path that shares no cell keeps the clearance
    const fieldFor =
      (t: Task) =>
      (g: Grid, layers: string[], spans: string[][], tw: number, vw: number, vd: number): CongestionField => {
        const f = g.p / 2,
          ct = classGap(t),
          gk = `${g.p}\u0000${g.x0}\u0000${g.y0}\u0000${g.nx}\u0000${g.ny}\u0000${ct}`
        const gapTo = (o: Task) => Math.max(rules.clearance, ct, classGap(o))
        const own = pool.filter(o => o !== t && o.result && sameNet(t, o))
        const low = pool.filter(o => o !== t && o.result && !sameNet(t, o) && prio(o) < prio(t))
        const occ = layers.map(l => {
          const sh = sharedOf(`t\u0000${gk}\u0000${l}\u0000${tw}`, g, o => grownOf(o, [l], tw + 2 * f, undefined, gapTo(o)))
          const a = sh.arr.slice()
          for (const o of [...own, ...low])
            if (sh.members.has(o)) {
              const s = sh.region(o)
              if (s) fillAdd(g, s, a, -1)
            }
          return a
        })
        const viaOcc = spans.map(sp => {
          const sh = sharedOf(`v\u0000${gk}\u0000${sp.join(',')}\u0000${vw}\u0000${vd}`, g, o => grownOf(o, sp, vw + 2 * f, vd + 2 * f, gapTo(o)))
          const a = sh.arr.slice()
          for (const o of own) {
            if (sh.members.has(o)) {
              const s = sh.region(o)
              if (s) fillAdd(g, s, a, -1)
            }
            const hs = holesNear(o, vd + 2 * f)
            if (hs) fillAdd(g, hs, a, 1)
          }
          for (const o of low)
            if (sh.members.has(o)) {
              const s = sh.region(o)
              if (s) fillAdd(g, s, a, -1)
            }
          return a
        })
        const regions = layers.map(l =>
          pool.flatMap(o =>
            o === t || !o.result || sameNet(t, o) || prio(o) < prio(t) ? [] : [grownOf(o, [l], tw + 2 * f, undefined, gapTo(o))].filter((x): x is RingSet => !!x),
          ),
        )
        return { occ, viaOcc, hist: layers.map(l => histOf(l, g)), regions }
      }
    const routeSoft = (t: Task, pres: number): boolean => {
      const c = ctxOf(t.r),
        leg = legOf(t)
      const ts = c.tries(leg.from, leg.to, layersOf(t))
      const q = [...ts].reverse().find(x => x.req)
      if (!q) {
        const last = ts[ts.length - 1]
        t.fail = { reason: last.reason, layers: last.layers, key: last.key }
        return false
      }
      const cg: Congestion = { pres, field: fieldFor(t) }
      congestionOf.set(q.req!, cg)
      let s: Solved
      try {
        s = solve(t, q.req!, req => maze(req, hardLayout(c)))
      } catch (e) {
        t.fail = { reason: (e as Error).message, layers: q.layers, key: q.key }
        return false
      }
      c.place(t, s.res, q.key, leg.from, leg.to, leg.own, -1, s.strips)
      t.how = 'route'
      t.fail = undefined
      t.shared = cg.shared ?? []
      t.on = s.on
      t.narrow = s.narrow
      if (t.r.pair) {
        const sib = siblings(t)
        for (const x of sib) lift(x)
        layResv(t.r)
        for (const x of sib) drop(x)
      } else drop(t)
      return true
    }
    const near = (t: Task, box: Box) => {
      if (!t.result || !boxHit(boxOfTask(t), box)) return false
      for (const it of objsOf(t)) {
        if (it.kind === 'via' && boxHit(itemBox(it), box)) return true
        if (it.kind === 'track') for (let i = 1; i < it.pts.length; i++) if (boxHit(boxOf([it.pts[i - 1], it.pts[i]]), box)) return true
      }
      return false
    }

    let pres = PRES_FIRST,
      n = 0
    let todo = [...failed].sort(bySeq)
    let clashes = new Map<Task, Set<Task>>()
    onOrphan = lift
    while (todo.length && n < bound) {
      n++
      const moved: Task[] = []
      for (const [i, t] of todo.entries()) {
        if (t.result) {
          takeOff(t)
          report.ripped++
        }
        if (routeSoft(t, pres)) moved.push(t)
        opts.progress?.({ done: i + 1, legs: todo.length, round: n })
      }
      orphans.sort(bySeq)
      while (orphans.length) {
        const o = orphans.shift()!
        if (o.result || o.fail || o.stored) continue
        if (softOk(o) ? routeSoft(o, pres) : routeHard(o)) moved.push(o)
      }
      clashes = new Map()
      // of two colliding legs the lower priority one routes again, both on a tie
      const note = (a: Task, b: Task) => {
        let s = clashes.get(a)
        if (!s) clashes.set(a, (s = new Set()))
        s.add(b)
      }
      const spots: { at: Box; p: number }[] = []
      for (const t of moved)
        for (const o of pool) {
          const at = o !== t ? clash(t, o) : null
          if (!at) continue
          if (prio(o) <= prio(t)) note(o, t)
          if (prio(t) <= prio(o)) note(t, o)
          spots.push({ at, p: Math.min(prio(t), prio(o)) })
        }
      for (const t of clashes.keys()) for (const s of t.shared) s.hist[s.cell] += HIST_STEP
      pres *= PRES_GROW
      // a collision may need room only its neighbours can give
      const around =
        n >= NEIGHBOURS_FROM
          ? pool.filter(
              o =>
                !clashes.has(o) &&
                spots.some(({ at: b, p }) => prio(o) <= p && near(o, [b[0] - NEIGHBOUR_REACH, b[1] - NEIGHBOUR_REACH, b[2] + NEIGHBOUR_REACH, b[3] + NEIGHBOUR_REACH])),
            )
          : []
      todo = [...clashes.keys(), ...around].sort(bySeq)
    }
    onOrphan = null
    if (!clashes.size) return n
    // out of rounds: the lowest priority leg with the most collisions leaves, the later on a tie, until nothing collides
    const losers: Task[] = []
    while (clashes.size) {
      let worst: Task | undefined
      for (const [t, s] of clashes) {
        if (!worst) {
          worst = t
          continue
        }
        const w = clashes.get(worst)!.size
        if (prio(t) < prio(worst) || (prio(t) === prio(worst) && (s.size > w || (s.size === w && t.seq > worst.seq)))) worst = t
      }
      const partners = [...clashes.get(worst!)!].sort(bySeq)
      for (const s of clashes.values()) s.delete(worst!)
      clashes.delete(worst!)
      for (const [t, s] of [...clashes]) if (!s.size) clashes.delete(t)
      takeOff(worst!)
      report.ripped++
      worst!.fail = { reason: '', layers: [], key: '', with: partners[0] }
      losers.push(worst!)
    }
    for (const t of losers.sort(bySeq)) {
      const w = t.fail!.with!
      if (routeHard(t)) continue
      t.fail = {
        ...t.fail!,
        with: w,
        reason: `no path found that keeps clear of the route of net ${w.r.net ?? '(no net)'}${whereOf(w.r.job.src)}; negotiation stopped after ${n} round${n === 1 ? '' : 's'}, the ripup bound`,
      }
    }
    return n
  }

  routeOrphans()
  prune()
  for (const t of tasks) restrip(t)

  // renumbered in priority and declaration order, so cold, warm and negotiated compiles give the same ids
  {
    const objs = tasks.flatMap(t => t.placed.flatMap(p => p.objs))
    const ids = new Set(objs.map(o => o.id))
    for (const list of [board.items, added]) {
      let w = 0
      for (const it of list) if (!ids.has(it.id)) list[w++] = it
      list.length = w
    }
    nextId = firstLegId
    for (const c of ctxs.values()) c.placed.clear()
    owner.clear()
    for (const t of tasks) {
      t.items = []
      if (t.pruned) continue
      const c = ctxOf(t.r)
      for (const p of t.placed)
        for (const it of p.objs) {
          it.id = nextId++
          push(it)
          t.items.push(it.id)
          c.placed.add(it.id)
          owner.set(it.id, t)
        }
    }
  }
  for (const t of tasks) {
    if (t.k < 0) continue
    report.legs++
    if (t.how === 'cache') report.cached++
    if (t.how === 'lock') report.locked++
    if (t.result) {
      report.routed++
      continue
    }
    if (!t.fail) continue
    const leg = legOf(t),
      n = t.r.legs!.length
    ctxOf(t.r).failed(leg.from, leg.to, t.fail.layers, t.fail.reason, n > 1 ? `automatic leg ${t.k + 1} of ${n}, ` : '', t.k + 1, n, leg.own)
  }
  if (rounds) report.rounds = rounds
  const notes: DrcMarker[] = []
  for (const t of tasks) {
    if (!t.narrow || !t.result || t.pruned) continue
    const leg = legOf(t),
      e = t.narrow.side ? leg.to : leg.from,
      job = t.r.job
    const pad = board.items.find((it): it is Pad => it.kind === 'pad' && it.net === t.r.net && same(it.at, [e.x, e.y]))
    const name = job.route ?? 'a route',
      end = pad ? `pad ${pad.ref}.${pad.num}` : `its end at (${fmt(e.x)}, ${fmt(e.y)})`
    const message = t.narrow.kept
      ? `${name} joins the copper of net ${t.r.net} near ${end}, which stays narrower than its ${fmt(t.r.width)} mm: widening it would break clearance, and no path reaches ${end} itself`
      : `${name} runs to ${end} instead of joining the copper of net ${t.r.net} there: widening that copper to ${fmt(t.r.width)} mm would break clearance`
    notes.push({
      severity: 'info',
      rule: 'trunk-narrow',
      message,
      at: [e.x, e.y],
      layer: e.layer,
      net: t.r.net,
      ...(job.route ? { routeId: job.route } : {}),
      ...(job.src ? { src: job.src } : {}),
      items: t.items,
    })
  }

  if (cache) {
    for (const r of runOrder) {
      if (!r.lockKey || !r.legs) continue
      const results = tasks
        .filter(t => t.r === r)
        .sort((x, y) => x.k - y.k)
        .map(t => t.result)
      cache.putLock(r.lockKey, { ...(r.net !== undefined ? { net: r.net } : {}), ...(r.job.path !== undefined ? { path: r.job.path } : {}), legs: results })
    }
    // hashed over the final copper, whole-net lines placed after a line left out
    const wnOf = new Map<number, number>()
    for (const t of tasks) for (const p of t.placed) if (p.wn >= 0) for (const it of p.objs) wnOf.set(it.id, p.wn)
    for (const t of tasks) {
      const c = ctxOf(t.r)
      if (!c.cacheable) continue
      const rv = resvIds(t.r)
      const skip = (wn: number) => (it: Item) => c.placed.has(it.id) || rv.has(it.id) || (wnOf.get(it.id) ?? -2) > wn
      for (const p of t.placed) {
        if (!p.key) continue
        const box = c.boxAround(p.a, p.b, p.result)
        cache.putLeg(p.key, { obs: p.wn >= 0 ? sigsIn(box, skip(p.wn)) : obsOf(t, box, skip(p.wn)), box, result: p.result, ...(t.narrow ? { narrow: t.narrow } : {}) })
      }
      if (t.k >= 0 && !t.result && t.fail?.key)
        cache.putLeg(t.fail.key, { obs: sigsIn(EVERYWHERE, skip(-1)), box: EVERYWHERE, result: null, fail: { reason: t.fail.reason, layers: t.fail.layers, ripup: ripupOf(t) } })
    }
  }

  // the centre line placeholders leave; a pair whose legs all routed gets its two tracks
  const pairs: PairInfo[] = []
  /** `pool`: every id the pair has had, taken back in order on a new layout, so tuning leaves the board's ids as they were */
  interface PairDone {
    r: Run
    pr: PairRun
    laid: PairLaid
    ids: number[]
    pool: number[]
    whole: Origin
  }
  const done: PairDone[] = []
  const stack = board.stackup ?? board.thickness
  const placePair = (d: PairDone) => {
    const { r, pr, laid, whole } = d
    const rid = r.job.route !== undefined ? { route: r.job.route } : {}
    d.ids = []
    let k = 0
    const take = () => {
      if (k === d.pool.length) d.pool.push(nextId++)
      return d.pool[k++]
    }
    for (const t of laid.tracks) {
      const id = take()
      d.ids.push(id)
      const sh = t.prims ? trackShape(t.prims) : { pts: t.pts.map(([x, y]) => [nm(x), nm(y)] as Pt) }
      push({
        kind: 'track',
        id,
        layer: t.layer,
        net: t.role === 'P' ? r.net : pr.netN,
        ref: r.job.ref,
        ...whole,
        ...rid,
        ...sh,
        width: nm(t.width),
        pair: pr.id,
        role: t.role,
      } as Track)
    }
    for (const v of laid.vias) {
      const id = take()
      d.ids.push(id)
      const span = [...v.layers].sort((a, b) => order(a) - order(b)) as [string, string]
      push({
        kind: 'via',
        id,
        layer: span[0],
        net: v.role === 'P' ? r.net : pr.netN,
        ref: r.job.ref,
        ...whole,
        ...rid,
        at: [nm(v.at[0]), nm(v.at[1])],
        drill: pr.via.drill,
        size: pr.via.size,
        layers: span,
      } as Via)
    }
  }
  const unplacePair = (d: PairDone) => {
    const gone = new Set(d.ids)
    for (const list of [board.items, added]) {
      let w = 0
      for (const it of list) if (!gone.has(it.id)) list[w++] = it
      list.length = w
    }
    d.ids = []
  }
  const pairLength = (laid: PairLaid) => {
    const side = (role: 'P' | 'N') =>
      routeLength(
        laid.tracks.filter(t => t.role === role),
        laid.vias.filter(v => v.role === role),
        stack,
      )
    return Math.max(side('P'), side('N'))
  }
  const finalLaid = new Map(resvs)
  for (const r of runs) if (r.pair) dropResv(r)
  for (const r of runs) {
    const pr = r.pair
    if (!pr) continue
    const own = tasks.filter(t => t.r === r).sort((x, y) => x.k - y.k)
    const gone = new Set([...pr.ids, ...own.flatMap(t => t.items)])
    for (const list of [board.items, added]) {
      let w = 0
      for (const it of list) if (!gone.has(it.id)) list[w++] = it
      list.length = w
    }
    if (own.some(t => !t.result) || pr.crossed) continue
    const whole: Origin = { ...(r.job.src ? { src: r.job.src } : {}), ...(r.job.chain ? { chain: r.job.chain } : {}) }
    try {
      const rv = finalLaid.get(r) ?? (layResv(r), resvs.get(r)!)
      if (!rv.laid) throw rv.err!
      const d: PairDone = { r, pr, laid: rv.laid, ids: [], pool: [], whole }
      placePair(d)
      done.push(d)
    } catch (e) {
      if (!(e instanceof PairGeometryError)) throw e
      const at: ResolvedPos = { x: e.at[0], y: e.at[1], layer: pr.start?.layer ?? r.layer }
      const nets = new Set([r.net!, pr.netN]),
        nb = nearestCopper(board, nets, e.at, cu)
      const why = nb ? `; the copper of another net nearest that point is ${itemLabel(nb.it)}, ${fmt(nb.d)} mm from it` : ''
      const message = `cannot lay out the pair of nets ${r.net} and ${pr.netN}: ${e.message}${why}`
      if (opts.strict) throw new CompileError(message, r.job.src)
      report.routed -= own.length
      report.failed += own.length
      failures.push({ net: r.net, leg: 1, legs: 1, from: at, to: at, layers: [at.layer], reason: e.message + why, message, blockers: nb ? [nb.it.id] : [], ...whole })
    }
  }
  for (const d of done)
    pairs.push({ id: d.pr.id, nets: [d.r.net!, d.pr.netN], width: d.pr.w, gap: d.pr.g, skew: d.pr.skew, maxUncoupled: d.pr.uncoupled, uncoupled: d.laid.uncoupled, ...d.whole })
  // the tuner meanders a pair in its centre line and lays it out again
  const tunePair = (d: PairDone, info: PairInfo, extra: number, tolerance: number, frees: PairFrees): { added: number; note?: string } => {
    unplacePair(d)
    const t = d.r.P.tune
    const res = tunePairCentre(d.laid.job, extra, {
      pair: { free: frees.free, centreFree: frees.centreFree, padFree: padFree() },
      room: frees.room,
      measure: pairLength,
      tolerance,
      ...(frees.over !== undefined ? { over: frees.over } : {}),
      pads: board.items.filter((i): i is Pad => i.kind === 'pad' && (i.net === d.r.net || i.net === d.pr.netN)),
      ...(frees.amplitude !== undefined ? { amplitude: frees.amplitude } : t?.amplitude !== undefined ? { amplitude: mm(t.amplitude) } : {}),
      ...(t?.spacing !== undefined ? { spacing: mm(t.spacing) } : {}),
    })
    if (res.added > 1e-6) {
      d.laid = res.laid
      info.uncoupled = d.laid.uncoupled
    }
    placePair(d)
    return { added: res.added, ...(res.note ? { note: res.note } : {}) }
  }
  const pairState = (l: PairLaid): PairState => ({
    centre: l.job.centre,
    vias: l.job.vias,
    layers: l.job.layers,
    ...(l.job.auto ? { auto: l.job.auto } : {}),
    ...(l.job.radii ? { radii: l.job.radii } : {}),
    tracks: l.tracks.map(t => ({ layer: t.layer, role: t.role, pts: t.pts as [number, number][], width: t.width, ...(t.prims ? { prims: t.prims } : {}) })),
    pvias: l.vias.map(v => ({ role: v.role, at: v.at as [number, number], layers: v.layers })),
    uncoupled: l.uncoupled,
    lengthP: l.lengthP,
    lengthN: l.lengthN,
  })
  const restorePair = (d: PairDone, info: PairInfo, s: PairState) => {
    unplacePair(d)
    const { auto: _auto, radii: _radii, ...job } = d.laid.job
    d.laid = {
      ...d.laid,
      job: { ...job, centre: s.centre, vias: s.vias, layers: s.layers, ...(s.auto ? { auto: s.auto } : {}), ...(s.radii ? { radii: s.radii } : {}) },
      tracks: s.tracks,
      vias: s.pvias,
      uncoupled: s.uncoupled,
      lengthP: s.lengthP,
      lengthN: s.lengthN,
    }
    delete d.laid.clash
    info.uncoupled = s.uncoupled
    placePair(d)
  }
  const tuneIn: TuneRoute[] = []
  for (const r of runs) {
    if (r.job.route === undefined) continue
    const pr = r.pair,
      info = pr ? pairs.find(p => p.id === pr.id) : undefined
    const d = pr ? done.find(x => x.r === r) : undefined
    const routed = !!r.legs && tasks.every(t => t.r !== r || !!t.result) && (!pr || !!info)
    tuneIn.push({
      id: r.job.route,
      ...(r.net !== undefined ? { net: r.net } : {}),
      routed,
      ...(r.job.length ? { length: r.job.length } : {}),
      ...(r.job.match ? { match: r.job.match } : {}),
      ...(r.P.tune ? { tune: r.P.tune } : {}),
      ...(pr
        ? {
            pair: {
              id: pr.id,
              netN: pr.netN,
              w: pr.w,
              g: pr.g,
              skew: pr.skew,
              ...(info ? { info } : {}),
              ...(d && info
                ? {
                    lengthen: (extra: number, tol: number, frees: PairFrees) => tunePair(d, info, extra, tol, frees),
                    state: () => pairState(d.laid),
                    restore: (s: PairState) => restorePair(d, info, s),
                  }
                : {}),
            },
          }
        : {}),
      ...(r.job.src ? { src: r.job.src } : {}),
      ...(r.job.chain ? { chain: r.job.chain } : {}),
    })
  }
  const routes = tuneIn.length ? tuneRoutes(board, tuneIn, { rules, cache: cache ? { get: k => cache.tune(k), put: (k, e) => cache.putTune(k, e) } : null }) : []
  cache?.commit()
  const loops = [...new Set(runs.flatMap(r => (r.job.loop && r.net !== undefined ? [r.net] : [])))]
  return {
    failures,
    report,
    added,
    ...(pairs.length ? { pairs } : {}),
    ...(routes.length ? { routes } : {}),
    ...(loops.length ? { loops } : {}),
    ...(notes.length ? { notes } : {}),
  }
}

/** A complete centre line as one section per copper layer run, the automatic vertices marked. */
function pairJobOf(
  board: Board,
  rules: Rules,
  net: string,
  pr: PairRun,
  results: RouteResult[],
  name: (l: string) => string,
  neck?: { width?: number; length?: number },
  corner?: { radius?: number | 'none' },
): PairJob {
  const start = pr.start!
  const secs: { layer: string; pts: Pt[]; auto: boolean; marks: boolean[]; cross?: boolean }[] = [{ layer: start.layer, pts: [[start.x, start.y]], auto: false, marks: [false] }]
  const add = (layer: string, pts: Pt[], auto: boolean, cross = false) => {
    let cur = secs[secs.length - 1]
    if (cur.layer !== layer) secs.push((cur = { layer, pts: [cur.pts[cur.pts.length - 1]], auto, marks: [cur.marks[cur.marks.length - 1]], ...(cross ? { cross } : {}) }))
    for (const p of pts)
      if (!same(cur.pts[cur.pts.length - 1], p)) {
        cur.pts.push(p)
        cur.marks.push(auto)
      }
  }
  for (const pc of pr.pieces) {
    if (pc.kind === 'pts') add(pc.layer, pc.pts, !!pc.auto)
    else if (pc.kind === 'via') add(pc.layer, [], false, !!pc.cross)
    else for (const t of results[pc.k].tracks) add(name(t.layer), t.pts, true)
  }
  // two vias at one point are one via from the layer before to the layer after
  const runs = secs.filter((s, i) => s.pts.length >= 2 || i === 0 || i === secs.length - 1)
  for (let i = runs.length - 1; i > 0; i--)
    if (runs[i].layer === runs[i - 1].layer) {
      runs[i - 1].pts.push(...runs[i].pts.slice(1))
      runs[i - 1].marks.push(...runs[i].marks.slice(1))
      runs.splice(i, 1)
    }
  const centre: Pt[] = [],
    vias: number[] = [],
    autoVias: number[] = [],
    auto: boolean[] = [],
    crosses: number[] = []
  runs.forEach((s, i) => {
    if (i > 0) {
      if (s.auto) autoVias.push(vias.length)
      if (s.cross) crosses.push(vias.length)
      vias.push(centre.length - 1)
    }
    centre.push(...(i > 0 ? s.pts.slice(1) : s.pts))
    auto.push(...(i > 0 ? s.marks.slice(1) : s.marks))
  })
  auto[0] = false
  auto[auto.length - 1] = false
  if (centre.length < 2) throw new PairGeometryError('the pair centre line has no length', [start.x, start.y])
  // only hand drawn corners are rounded, by default with the pitch
  const rad = corner?.radius === 'none' ? 0 : (corner?.radius ?? pr.w + pr.g)
  const radii = centre.map((_, i) => (rad > 0 && i > 0 && i < centre.length - 1 && !auto[i] && !vias.includes(i) ? rad : 0))
  return {
    id: pr.id,
    nets: [net, pr.netN],
    w: pr.w,
    g: pr.g,
    via: pr.via,
    clearance: pr.clearance,
    copper: itemClearance(board, { kind: 'track', net }, { kind: 'track', net: pr.netN }, rules),
    holeClearance: rules.holeClearance,
    minWidth: rules.minTrackWidth,
    centre,
    vias,
    layers: runs.map(s => s.layer),
    autoVias,
    ...(crosses.length ? { crosses } : {}),
    auto,
    startPads: pr.startPads,
    endPads: pr.endPads,
    pads: pr.pads,
    ...(neck ? { neck } : {}),
    ...(radii.some(r => r > 0) ? { radii } : {}),
    copperLayers: copperLayers(board.copper),
  }
}
const unitOf = (a: Pt, b: Pt): Pt => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}

const rectRing = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]

/** A ratsnest end on its item's layer, the job layer first, then the routing layers. */
function endpoint(board: Board, net: string, pt: Pt, jobLayer: string, layers: string[], cu: string[]): ResolvedPos {
  const at = (it: Item): Pt | null => (it.kind === 'pad' || it.kind === 'via' ? it.at : it.kind === 'track' ? it.pts[0] : null)
  const it = board.items.find(
    i =>
      i.net === net &&
      (() => {
        const a = at(i)
        return !!a && same(a, pt)
      })(),
  )
  const own = it ? copperLayersOf(it, cu) : []
  const layer = own.includes(jobLayer) ? jobLayer : (own.find(l => layers.includes(l)) ?? own[0] ?? jobLayer)
  return { x: pt[0], y: pt[1], layer, ...(own.length > 1 ? { layers: own } : {}) }
}

/** Rounds the corners between joined manual tracks in place: an arc down to the width, else a 45 degree chamfer, else square. */
function roundManual(manual: (Track | null)[], radius: number, width: number, net: string | undefined, free: IsFree): void {
  const lineEnd = (t: Track) => {
    const p = primsOf(t)
    return p[p.length - 1]
  }
  const lineStart = (t: Track) => primsOf(t)[0]
  const joined = (i: number) =>
    i > 0 &&
    i < manual.length &&
    !!manual[i - 1] &&
    !!manual[i] &&
    manual[i - 1]!.layer === manual[i]!.layer &&
    same(manual[i - 1]!.pts[manual[i - 1]!.pts.length - 1], manual[i]!.pts[0])
  const sample = (layer: string, pts: Pt[]) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05))
      for (let k = 0; k <= n; k++) if (!free(layer, a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, net, width)) return false
    }
    return true
  }
  for (let i = 1; i < manual.length; i++) {
    if (!joined(i)) continue
    const t1 = manual[i - 1]!,
      t2 = manual[i]!
    const e = lineEnd(t1),
      s0 = lineStart(t2)
    if (e.kind !== 'line' || s0.kind !== 'line') continue
    const len = (p: { from: Pt; to: Pt }) => Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1])
    const plan = planCorner(e.from, e.to, s0.to, {
      want: radius,
      min: width,
      offsets: [0],
      free: (_k, pts) => sample(t1.layer, pts),
      availIn: len(e),
      availOut: len(s0) * (joined(i + 1) ? 0.5 : 1),
    })
    if (plan.kind === 'sharp') continue
    const v = e.to,
      u1 = unitOf(e.from, v),
      u2 = unitOf(v, s0.to)
    const th = Math.atan2(u2[0] * u1[1] - u2[1] * u1[0], u1[0] * u2[0] + u1[1] * u2[1])
    const cut = plan.kind === 'arc' ? plan.r * Math.tan(Math.abs(th) / 2) : plan.c
    const A: Pt = [v[0] - u1[0] * cut, v[1] - u1[1] * cut],
      B: Pt = [v[0] + u2[0] * cut, v[1] + u2[1] * cut]
    let corner: Prim
    if (plan.kind === 'arc') {
      const sg = th > 0 ? 1 : -1,
        nl: Pt = [u1[1] * sg, -u1[0] * sg]
      corner = { kind: 'arc', from: A, to: B, center: [A[0] + nl[0] * plan.r, A[1] + nl[1] * plan.r], cw: th < 0 }
    } else corner = { kind: 'line', from: A, to: B }
    const p1 = primsOf(t1)
    const s1 = trackShape([...p1.slice(0, -1), { kind: 'line', from: e.from, to: A }, corner])
    const s2 = trackShape([{ kind: 'line', from: B, to: s0.to }, ...primsOf(t2).slice(1)])
    t1.pts = s1.pts
    if (s1.prims) t1.prims = s1.prims
    t2.pts = s2.pts
    if (s2.prims) t2.prims = s2.prims
  }
}
