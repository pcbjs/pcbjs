// The router's obstacles: the world a routing stage works on, and every copper item grown by the clearance and rasterised as a count per cell that follows the world. Board mm, y down.
import type { Board, Item, Keepout, Pt, Ring } from '@pcbjs/core/model'
import type { ResolvedRules as Rules } from '@pcbjs/core/internal/types'
import { offset, polysToRings, union } from './geom.js'
import { copperLayersOf, copperRings } from './copper.js'
import { copperLayers } from './layers.js'
import { circleRing } from './path.js'
import { classNameOf, classOf, overrideBetween } from './netclass.js'
import { pulse } from './cancel.js'
import { boxOf, ringSet, type Box4, type RingSet } from './spatial.js'

/** A search grid: its origin, pitch and size in cells. */
export interface Grid {
  x0: number
  y0: number
  p: number
  nx: number
  ny: number
}
export const gridKey = (g: Grid) => `${g.p}\u0000${g.x0}\u0000${g.y0}\u0000${g.nx}\u0000${g.ny}`

/** Fills cells whose centre is inside the ring set (even-odd), one scanline per row. */
export function fill(g: Grid, s: RingSet, out: Uint8Array, value: number) {
  const rows: number[][] = Array.from({ length: g.ny }, () => [])
  for (const r of s.rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xa, ya] = r[j],
        [xb, yb] = r[i]
      if (ya === yb) continue
      const lo = Math.min(ya, yb),
        hi = Math.max(ya, yb)
      // the rows by a margin of one, the exact test decides: the two can disagree in the last bit and lose a scanline
      const j0 = Math.max(0, Math.ceil((lo - g.y0) / g.p) - 1),
        j1 = Math.min(g.ny - 1, Math.ceil((hi - g.y0) / g.p))
      for (let row = j0; row <= j1; row++) {
        const y = g.y0 + row * g.p
        if (y < lo || y >= hi) continue
        rows[row].push(xa + ((y - ya) * (xb - xa)) / (yb - ya))
      }
    }
  for (let row = 0; row < g.ny; row++) {
    const xs = rows[row]
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.p)),
        i1 = Math.min(g.nx - 1, Math.ceil((xs[k + 1] - g.x0) / g.p) - 1)
      for (let i = i0; i <= i1; i++) out[row * g.nx + i] = value
    }
  }
}

/** Adds delta to every cell whose centre is inside the ring set (even-odd), over the rows the set spans only. */
export function fillAdd(g: Grid, s: RingSet, out: Uint16Array, delta = 1) {
  let y0 = Infinity,
    y1 = -Infinity
  for (const b of s.boxes) {
    if (b[1] < y0) y0 = b[1]
    if (b[3] > y1) y1 = b[3]
  }
  const r0 = Math.max(0, Math.ceil((y0 - g.y0) / g.p) - 1),
    r1 = Math.min(g.ny - 1, Math.ceil((y1 - g.y0) / g.p))
  if (r1 < r0) return
  const rows: number[][] = Array.from({ length: r1 - r0 + 1 }, () => [])
  for (const r of s.rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xa, ya] = r[j],
        [xb, yb] = r[i]
      if (ya === yb) continue
      const lo = Math.min(ya, yb),
        hi = Math.max(ya, yb)
      const j0 = Math.max(r0, Math.ceil((lo - g.y0) / g.p) - 1),
        j1 = Math.min(r1, Math.ceil((hi - g.y0) / g.p))
      for (let row = j0; row <= j1; row++) {
        const y = g.y0 + row * g.p
        if (y < lo || y >= hi) continue
        rows[row - r0].push(xa + ((y - ya) * (xb - xa)) / (yb - ya))
      }
    }
  for (let k0 = 0; k0 < rows.length; k0++) {
    const xs = rows[k0],
      row = k0 + r0
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.p)),
        i1 = Math.min(g.nx - 1, Math.ceil((xs[k + 1] - g.x0) / g.p) - 1)
      for (let i = i0; i <= i1; i++) out[row * g.nx + i] += delta
    }
  }
}

/** Signed area, positive for the orientation Clipper gives an outer ring. */
function signedArea(r: Ring): number {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const q = r[(i + 1) % r.length]
    a += r[i][0] * q[1] - q[0] * r[i][1]
  }
  return a / 2
}
export const outer = (r: Ring): Ring => (signedArea(r) < 0 ? [...r].reverse() : r)
/** An item's copper rings on a layer, drawn outlines turned outer, since a back-side pad's mirrored ring would read as a hole to Clipper. */
export function solidRings(it: Item, layer: string): Ring[] {
  const rs = copperRings(it, layer)
  return it.kind === 'pad' || it.kind === 'via' || (it.kind === 'graphic' && it.fill) ? rs.map(outer) : rs
}

/** The drill of an item, its radius and centre, or null. */
export function holeOf(it: Item): { at: Pt; r: number } | null {
  if (it.kind === 'pad' && it.drill) return { at: it.at, r: Math.max(...it.drill) / 2 }
  if (it.kind === 'via') return { at: it.at, r: it.drill / 2 }
  return null
}
export const isNpth = (it: Item) => it.kind === 'pad' && it.type === 'npth'

interface Rec {
  memo: Map<string, RingSet | null>
  box: Box4 | null
  cells: number[]
  layers: string[]
  hole: { at: Pt; r: number } | null
}

const CELL = 1
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
/** The count grids kept at most, by bytes; the least recently used goes first. */
const MAX_BYTES = 192 * 1024 * 1024

interface Counts {
  g: Grid
  arr: Uint16Array
  add: (it: Item, rec: Rec, sign: number) => void
  used: number
}

/** The obstacles of one board under one set of rules; count grids are made on first use and kept up to date by each add and remove. */
export class ObstacleStore {
  private members = new Map<Item, Rec>()
  private buckets = new Map<number, Item[]>()
  private counts = new Map<string, Counts>()
  private bytes = 0
  private tick = 0
  private loose = new WeakMap<Item, Rec>()
  readonly cu: string[]

  constructor(
    readonly board: Board,
    readonly rules: Rules,
    cu: string[],
  ) {
    this.cu = cu
  }

  /** The copper clearance between a track of a routed net of class clearance cn and an item's net, see overrideBetween. */
  gap(cn: number, other: string | undefined, it?: Item, net?: string): number {
    // an override grows the item where it asks for more; the router never goes below the rules' clearance
    const pad = (it && overrideBetween(this.board, { kind: 'track', net }, it)) || 0
    if (!this.board.classes) return Math.max(this.rules.clearance, pad)
    return Math.max(this.rules.clearance, cn, pad || (classOf(this.board, other)?.clearance ?? 0))
  }
  /** What the count grids of a routed net differ by beyond its class clearance: its class, when that scopes its clearance by kind. */
  scopeOf(net: string | undefined): string {
    return this.board.classes && classOf(this.board, net)?.clearanceTo ? (classNameOf(this.board, net) ?? '') : ''
  }
  /** The hole clearance an item's hole keeps: the rules', or a pad's override where it is larger. */
  holeGap(it: Item): number {
    return it.kind === 'pad' && it.holeClearance !== undefined ? Math.max(this.rules.holeClearance, it.holeClearance) : this.rules.holeClearance
  }
  classGap(net: string | undefined): number {
    return this.board.classes ? (classOf(this.board, net)?.clearance ?? 0) : 0
  }

  private recOf(it: Item): Rec {
    const layers = copperLayersOf(it, this.cu),
      hole = holeOf(it)
    let box: Box4 | null = null
    const grow = (b: Box4) => {
      box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b
    }
    for (const l of layers) for (const r of solidRings(it, l)) if (r.length) grow(boxOf(r))
    if (hole) grow([hole.at[0] - hole.r, hole.at[1] - hole.r, hole.at[0] + hole.r, hole.at[1] + hole.r])
    return { memo: new Map(), box, cells: [], layers, hole }
  }
  /** The record of an item, a member or not. */
  rec(it: Item): Rec {
    const m = this.members.get(it)
    if (m) return m
    let r = this.loose.get(it)
    if (!r) this.loose.set(it, (r = this.recOf(it)))
    return r
  }

  /** An item's copper on a layer grown by d, null when it has none there. */
  copper(it: Item, rec: Rec, layer: string, d: number): RingSet | null {
    const key = `c\u0000${layer}\u0000${d}`
    let s = rec.memo.get(key)
    if (s !== undefined) return s
    s = null
    if (rec.layers.includes(layer)) {
      const rs = solidRings(it, layer)
      if (rs.length) {
        const g = polysToRings(offset(rs, d))
        if (g.length) s = ringSet(g)
      }
    }
    rec.memo.set(key, s)
    return s
  }
  /** An item's hole as a circle of its radius plus extra, null when it has none. */
  hole(rec: Rec, extra: number): RingSet | null {
    if (!rec.hole) return null
    const key = `h\u0000${extra}`
    let s = rec.memo.get(key)
    if (s === undefined) rec.memo.set(key, (s = ringSet([circleRing(rec.hole.at[0], rec.hole.at[1], rec.hole.r + extra)])))
    return s
  }

  /** The members made `items`, once as a world starts: new ones in, the others out; a changed item is a new one, since items are never written. */
  track(items: readonly Item[]) {
    const now = new Set<Item>()
    for (const it of items) {
      pulse()
      now.add(it)
      if (!this.members.has(it)) this.add(it)
    }
    for (const it of [...this.members.keys()]) if (!now.has(it)) this.remove(it)
  }

  add(it: Item) {
    const rec = this.recOf(it)
    this.members.set(it, rec)
    if (rec.box) {
      const [x0, y0, x1, y1] = rec.box
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
        for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
          const k = cellKey(i, j)
          let b = this.buckets.get(k)
          if (!b) this.buckets.set(k, (b = []))
          b.push(it)
          rec.cells.push(k)
        }
    }
    for (const c of this.counts.values()) c.add(it, rec, 1)
  }
  remove(it: Item) {
    const rec = this.members.get(it)!
    this.members.delete(it)
    for (const k of rec.cells) {
      const b = this.buckets.get(k)!
      const i = b.indexOf(it)
      if (i >= 0) b.splice(i, 1)
    }
    for (const c of this.counts.values()) c.add(it, rec, -1)
  }

  /** The members whose box comes within pad of the box [x0, y0, x1, y1]. */
  near(x0: number, y0: number, x1: number, y1: number, pad: number): Item[] {
    const out: Item[] = [],
      seen = new Set<Item>()
    for (let i = Math.floor((x0 - pad) / CELL); i <= Math.floor((x1 + pad) / CELL); i++)
      for (let j = Math.floor((y0 - pad) / CELL); j <= Math.floor((y1 + pad) / CELL); j++)
        for (const it of this.buckets.get(cellKey(i, j)) ?? []) {
          if (seen.has(it)) continue
          seen.add(it)
          const b = this.members.get(it)!.box!
          if (b[0] - pad <= x1 && x0 <= b[2] + pad && b[1] - pad <= y1 && y0 <= b[3] + pad) out.push(it)
        }
    return out
  }

  private grid(key: string, g: Grid, add: (it: Item, rec: Rec, arr: Uint16Array, sign: number) => void): Uint16Array {
    let c = this.counts.get(key)
    if (c) {
      c.used = ++this.tick
      return c.arr
    }
    const arr = new Uint16Array(g.nx * g.ny)
    for (const [it, rec] of this.members) {
      pulse()
      add(it, rec, arr, 1)
    }
    c = { g, arr, add: (it, rec, sign) => add(it, rec, arr, sign), used: ++this.tick }
    this.counts.set(key, c)
    this.bytes += arr.byteLength
    while (this.bytes > MAX_BYTES && this.counts.size > 1) {
      let lru: string | undefined,
        t = Infinity
      for (const [k, v] of this.counts)
        if (k !== key && v.used < t) {
          t = v.used
          lru = k
        }
      if (lru === undefined) break
      this.bytes -= this.counts.get(lru)!.arr.byteLength
      this.counts.delete(lru)
    }
    return arr
  }

  /** Adds sign times an item's track obstacle: copper grown by the clearance plus w/2 when `cu`, hole grown by holeClearance plus w/2 when `hole`. */
  trackFill(g: Grid, it: Item, rec: Rec, layer: string, w: number, cn: number, arr: Uint16Array, sign: number, cu = true, hole = true, net?: string) {
    if (cu) {
      const s = this.copper(it, rec, layer, this.gap(cn, it.net, it, net) + w / 2)
      if (s) fillAdd(g, s, arr, sign)
    }
    if (hole) {
      const s = this.hole(rec, this.holeGap(it) + w / 2)
      if (s) fillAdd(g, s, arr, sign)
    }
  }
  /** The count per cell of every member's track obstacle on a layer for width w and class clearance cn; `net` matters for kind-scoped classes. */
  trackCounts(g: Grid, layer: string, w: number, cn: number, net?: string): Uint16Array {
    const scope = this.scopeOf(net),
      n = scope ? net : undefined
    return this.grid(`t\u0000${gridKey(g)}\u0000${layer}\u0000${w}\u0000${cn}${scope ? `\u0000${scope}` : ''}`, g, (it, rec, arr, sign) =>
      this.trackFill(g, it, rec, layer, w, cn, arr, sign, true, true, n),
    )
  }
  /** Adds sign times an item's hole grown by minHoleToHole plus drill/2, where the centre of a via of that drill may not go. */
  holeFill(g: Grid, rec: Rec, drill: number, arr: Uint16Array, sign: number) {
    const s = this.hole(rec, this.rules.minHoleToHole + drill / 2)
    if (s) fillAdd(g, s, arr, sign)
  }
  holeCounts(g: Grid, drill: number): Uint16Array {
    return this.grid(`h\u0000${gridKey(g)}\u0000${drill}`, g, (_it, rec, arr, sign) => this.holeFill(g, rec, drill, arr, sign))
  }

  /** The count grids dropped, made again on their next use. */
  dropCounts() {
    this.counts.clear()
    this.bytes = 0
  }

  /** The static masks: outside the board shrunk by the edge clearance and w/2, and the keepouts. */
  private masks = new Map<string, Uint8Array | null>()
  mask(key: string, g: Grid, make: () => RingSet | null): Uint8Array | null {
    const k = `${key}\u0000${gridKey(g)}`
    let m = this.masks.get(k)
    if (m === undefined) {
      const s = make()
      m = s ? new Uint8Array(g.nx * g.ny) : null
      if (s && m) fill(g, s, m, 1)
      this.masks.set(k, m)
    }
    return m
  }
}

const STORES = new WeakMap<Board, Map<Rules, ObstacleStore>>()
function storeOf(board: Board, rules: Rules, cu: string[]): ObstacleStore {
  let m = STORES.get(board)
  if (!m) STORES.set(board, (m = new Map()))
  let s = m.get(rules)
  if (!s) m.set(rules, (s = new ObstacleStore(board, rules, cu)))
  return s
}

/** True when the keepout holds the copper of this net out: it is not one of the nets the keepout's `except` lets in. */
export const keptOut = (k: Keepout, net: string | undefined): boolean => !(net !== undefined && k.except?.includes(net))
/** The key of the keepouts a net is let into, '' for none, for the caches of keptSet and viaKeptSet. */
export const exemptKey = (keepouts: Keepout[], net: string | undefined): string =>
  net === undefined
    ? ''
    : keepouts
        .map((k, i) => (keptOut(k, net) ? -1 : i))
        .filter(i => i >= 0)
        .join(',')

/** The hard keepouts of a layer for a track of width w of the net, its centre line kept w/2 outside, or null. */
export function keptSet(keepouts: Keepout[], layer: string, w: number, net?: string): RingSet | null {
  const kept = keepouts.filter(k => k.tracks && k.layers.includes(layer) && keptOut(k, net)).flatMap(k => k.outline)
  return kept.length ? ringSet(polysToRings(offset(kept, w / 2))) : null
}
/** The keepouts that forbid vias of the net on a layer, for a via of this size. */
export function viaKeptSet(keepouts: Keepout[], layer: string, size: number, net?: string): RingSet | null {
  const rings: Ring[] = []
  for (const k of keepouts) if (k.vias && k.layers.includes(layer) && keptOut(k, net)) rings.push(...polysToRings(offset(k.outline, size / 2)))
  return rings.length ? ringSet(polysToRings(union(rings.map(outer)))) : null
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
/** An item's box with copper and holes, and a signature of all the router sees of it; null for what the router never sees. */
const sigCache = new WeakMap<Item, { box: Box4; sig: string }>()
export function itemSig(it: Item, cu: string[]): { box: Box4; sig: string } | null {
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
  const out = { box: [b[0] - grow, b[1] - grow, b[2] + grow, b[3] + grow] as Box4, sig: JSON.stringify([it.kind, it.layer, it.net ?? '', ls, geo]) }
  sigCache.set(it, out)
  return out
}

const hits = (a: Box4, b: Box4) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/**
 * The items a routing stage works on, in board order, written to the board once when the stage ends: the store's buckets and count grids, the per net lists
 * and the signature buckets follow each add and remove, and `time` counts them, so a layout made at one time tells what came and went since.
 */
export class ObstacleWorld {
  readonly store: ObstacleStore
  readonly cu: string[]
  time = 0
  private list: Item[]
  private stale = false
  private live = new Map<number, Item>()
  private born = new Map<Item, number>()
  private nets = new Map<string, Item[]>()
  /** adds after the start and removals, each in time order */
  private log: { it: Item; t: number }[] = []
  private gone: { it: Item; t: number; born: number }[] = []
  private sigs = new Map<number, Item[]>()

  constructor(
    readonly board: Board,
    readonly rules: Rules,
    items: readonly Item[] = board.items,
  ) {
    this.cu = copperLayers(board.copper)
    this.store = storeOf(board, rules, this.cu)
    this.store.track(items)
    this.list = [...items]
    for (const it of items) this.index(it, 0)
  }

  /** The items in board order. */
  items(): Item[] {
    if (this.stale) {
      this.list = this.list.filter(it => this.live.get(it.id) === it)
      this.stale = false
    }
    return this.list
  }
  get(id: number): Item | undefined {
    return this.live.get(id)
  }
  /** The items of a net in board order; the world's own list, never written by the caller. */
  net(name: string | undefined): readonly Item[] {
    return (name !== undefined && this.nets.get(name)) || []
  }
  /** When an item present now joined, 0 for those the stage started with. */
  bornOf(it: Item): number {
    return this.born.get(it) ?? Infinity
  }

  add(items: readonly Item[]): void {
    this.time++
    for (const it of items) {
      this.list.push(it)
      this.index(it, this.time)
      this.log.push({ it, t: this.time })
    }
  }
  remove(ids: ReadonlySet<number>): void {
    this.time++
    for (const id of ids) {
      const it = this.live.get(id)
      if (!it) continue
      this.gone.push({ it, t: this.time, born: this.born.get(it)! })
      this.unindex(it)
      this.stale = true
    }
  }
  /** `it` in place of the item of its id, where that one stood. */
  replace(it: Item): void {
    const old = this.live.get(it.id)!
    const list = this.items()
    this.time++
    this.gone.push({ it: old, t: this.time, born: this.born.get(old)! })
    this.unindex(old)
    list[list.indexOf(old)] = it
    this.index(it, this.time)
    this.log.push({ it, t: this.time })
  }

  /** The items present now that joined after `time`, and those present at `time` gone since. */
  since(time: number): { came: Item[]; went: Item[] } {
    const after = <T extends { t: number }>(l: T[]) => {
      let lo = 0,
        hi = l.length
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (l[m].t > time) hi = m
        else lo = m + 1
      }
      return l.slice(lo)
    }
    return {
      came: after(this.log)
        .map(e => e.it)
        .filter(it => this.born.get(it) !== undefined),
      went: after(this.gone)
        .filter(e => e.born <= time)
        .map(e => e.it),
    }
  }

  /** The items whose box comes within pad of the box, from the store's buckets. */
  near(box: Box4, pad: number): Item[] {
    return this.store.near(box[0], box[1], box[2], box[3], pad)
  }

  /** The signatures of the items the router sees whose box meets `box`, but those `skip` names, in no order. */
  signature(box: Box4, skip: (it: Item) => boolean): string[] {
    const out: string[] = []
    const take = (it: Item) => {
      if (skip(it)) return
      const s = itemSig(it, this.cu)
      if (s && hits(s.box, box)) out.push(s.sig)
    }
    const cells = (Math.floor(box[2]) - Math.floor(box[0]) + 1) * (Math.floor(box[3]) - Math.floor(box[1]) + 1)
    if (cells > this.live.size) {
      for (const it of this.items()) take(it)
      return out
    }
    const seen = new Set<Item>()
    for (let i = Math.floor(box[0]); i <= Math.floor(box[2]); i++)
      for (let j = Math.floor(box[1]); j <= Math.floor(box[3]); j++)
        for (const it of this.sigs.get(cellKey(i, j)) ?? []) {
          if (seen.has(it)) continue
          seen.add(it)
          take(it)
        }
    return out
  }

  private index(it: Item, t: number) {
    this.live.set(it.id, it)
    this.born.set(it, t)
    if (it.net !== undefined) {
      let l = this.nets.get(it.net)
      if (!l) this.nets.set(it.net, (l = []))
      l.push(it)
    }
    for (const k of this.sigCells(it)) {
      let b = this.sigs.get(k)
      if (!b) this.sigs.set(k, (b = []))
      b.push(it)
    }
    if (t) this.store.add(it)
  }
  private unindex(it: Item) {
    this.live.delete(it.id)
    this.born.delete(it)
    if (it.net !== undefined) {
      const l = this.nets.get(it.net)!
      l.splice(l.indexOf(it), 1)
    }
    for (const k of this.sigCells(it)) {
      const b = this.sigs.get(k)!
      b.splice(b.indexOf(it), 1)
    }
    this.store.remove(it)
  }
  private sigCells(it: Item): number[] {
    const s = itemSig(it, this.cu)
    if (!s) return []
    const out: number[] = []
    for (let i = Math.floor(s.box[0]); i <= Math.floor(s.box[2]); i++) for (let j = Math.floor(s.box[1]); j <= Math.floor(s.box[3]); j++) out.push(cellKey(i, j))
    return out
  }
}
