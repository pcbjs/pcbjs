import type { Board, Item, Poly, Pt, Ratsnest, Zone } from '@pcbjs/core/model'
import { area, centroid, offsetRings } from './geom.js'
import { copperLayers } from './layers.js'
import { copperBox, copperIndex, copperLayersOf, copperRings } from './copper.js'
import { Grid, overlapsNear, RingIndex } from './spatial.js'

export interface Connectivity {
  ratsnest: Ratsnest[]
  unconnected: number
  shorts: [Item, Item, string][]
  singles: string[]
  /** other-net pairs whose copper boxes overlap but whose copper does not, by pairKey, so DRC need not clip them again */
  apart?: Set<string>
  /** per ratsnest line, the two islands it joins in words when either holds a pour piece, else undefined */
  islands?: ([string, string] | undefined)[]
  /** the component of each item and pour piece, see connectedGroups */
  groups?: ConnectedGroups
  /** every pour piece, each a node of `groups` */
  pieces?: Piece[]
}

/** Which component each pad lies in, by the union-find root; pads of one component are joined through copper. */
export interface ConnectedGroups {
  of(it: Item): number
}

/** One piece of a pour's fill as an item of its own: the zone with only that polygon, keeping the zone's id. */
export type Piece = Zone & { piece: { zone: Zone; index: number; at: Pt; area: number } }

/** The pieces of a zone's fill, each its own node of connectivity. */
export function pieces(z: Zone): Piece[] {
  return z.fill.map((p: Poly, index) => ({ ...z, fill: [p], piece: { zone: z, index, at: centroid([p.outer]), area: Math.abs(area([p.outer, ...p.holes])) } }))
}

const f2 = (v: number) => v.toFixed(2)
const mm2 = (v: number) => (v >= 0.1 ? f2(v) : v.toFixed(4))
/** A pour piece in words: its layer, centroid and area. */
export const pieceText = (p: Piece) => `the ${p.layer} pour piece at (${f2(p.piece.at[0])}, ${f2(p.piece.at[1])}), ${mm2(p.piece.area)} mm²`

/** The key of an item pair on a layer, the earlier item in board order first. */
export const pairKey = (layer: string, a: Item, b: Item) => `${layer}:${a.id}:${b.id}`

class UF {
  p: number[]
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]]
      i = this.p[i]
    }
    return i
  }
  union(a: number, b: number) {
    this.p[this.find(a)] = this.find(b)
  }
}

function anchor(it: Item): Pt {
  switch (it.kind) {
    case 'pad':
    case 'via':
      return it.at
    case 'track':
      return it.pts[0]
    case 'zone':
      return centroid(it.fill.map(p => p.outer))
    case 'graphic':
      return centroid(it.paths)
    case 'text':
      return it.at
    default:
      return [0, 0]
  }
}

/** How close copper of one net must come to count as touching, mm. */
const TOUCH = 0.001

/** Copper grown by TOUCH, per item and layer: a pour piece meets many same-net items it does not overlap. */
const grown = new WeakMap<Item, Map<string, RingIndex>>()
function grownBy(it: Item, layer: string): RingIndex {
  let m = grown.get(it)
  if (!m) grown.set(it, (m = new Map()))
  let g = m.get(layer)
  if (!g) m.set(layer, (g = new RingIndex(offsetRings(copperRings(it, layer), TOUCH))))
  return g
}
/** Whether two items of one net are joined on a layer: their copper overlaps or touches edge to edge. */
export function joined(a: Item, b: Item, layer: string): boolean {
  return overlapsNear(copperIndex(a, layer), copperIndex(b, layer)) || touches(a, b, layer)
}

/** Whether two items of one net touch edge to edge: the one with fewer vertices grown by TOUCH overlaps the other. */
function touches(a: Item, b: Item, layer: string): boolean {
  const size = (it: Item) => copperRings(it, layer).reduce((n, r) => n + r.length, 0)
  const [s, t] = size(a) <= size(b) ? [a, b] : [b, a]
  return overlapsNear(grownBy(s, layer), copperIndex(t, layer))
}

/** Whether two items are pads of one net tie group, which may touch without a short; null when the board has no net tie. */
export function netTied(board: Board): ((a: Item, b: Item) => boolean) | null {
  const groups = new Map<string, Map<string, number>>()
  for (const fp of board.footprints)
    if (fp.netTie?.length) {
      const m = new Map<string, number>()
      fp.netTie.forEach((g, i) => {
        for (const n of g) m.set(n, i)
      })
      groups.set(fp.ref, m)
    }
  if (!groups.size) return null
  return (a, b) => {
    if (a.kind !== 'pad' || b.kind !== 'pad' || a.ref === undefined || a.ref !== b.ref) return false
    const m = groups.get(a.ref)
    const ga = m?.get(a.num)
    return ga !== undefined && ga === m!.get(b.num)
  }
}

export function connectivity(board: Board): Connectivity {
  const cu = copperLayers(board.copper)
  const tied = netTied(board)
  // each pour piece is a node of its own: a pad in a piece that touches nothing else of its net is cut off
  const items = board.items.flatMap((it): Item[] => (it.net === undefined || !copperLayersOf(it, cu).length ? [] : it.kind === 'zone' ? pieces(it) : [it]))
  const idx = new Map(items.map((it, i) => [it, i]))
  const uf = new UF(items.length)
  const shorts: [Item, Item, string][] = []
  const shortKeys = new Set<string>()
  const apart = new Set<string>()
  // a short and a pair key name the zone, not the piece
  const real = (it: Item): Item => ('piece' in it ? (it as Piece).piece.zone : it)
  for (const layer of cu) {
    const on = items.filter(it => copperLayersOf(it, cu).includes(layer) && copperRings(it, layer).length)
    // grid candidates in the same order as a loop over every pair
    const grid = new Grid(on.map(it => copperBox(it, layer)))
    const touched = new Set<string>()
    for (let i = 0; i < on.length; i++) {
      const a = on[i],
        ia = idx.get(a)!
      for (const j of grid.query(grid.boxes[i])) {
        if (j <= i) continue
        const b = on[j],
          ib = idx.get(b)!
        if (a.net === b.net && uf.find(ia) === uf.find(ib)) continue
        const ra = real(a),
          rb = real(b)
        if (!overlapsNear(copperIndex(a, layer), copperIndex(b, layer))) {
          if (a.net !== b.net) {
            apart.add(pairKey(layer, ra, rb))
            if (tied?.(a, b) && touches(a, b, layer)) uf.union(ia, ib)
          }
          // copper of one net that only touches edge to edge is joined, as in KiCad
          else if (touches(a, b, layer)) uf.union(ia, ib)
          continue
        }
        if (a.net === b.net) uf.union(ia, ib)
        // a net tie joins its pads into one island, each keeping its net, no short
        else if (tied?.(a, b)) uf.union(ia, ib)
        else {
          touched.add(pairKey(layer, ra, rb))
          const k = `${layer}:${ra.id}:${rb.id}`
          if (!shortKeys.has(k)) {
            shortKeys.add(k)
            shorts.push([ra, rb, layer])
          }
        }
      }
    }
    // a zone is apart from an item only when none of its pieces overlaps it
    for (const k of touched) apart.delete(k)
  }
  const byNet = new Map<string, Item[]>()
  for (const it of items) {
    const l = byNet.get(it.net!) ?? []
    l.push(it)
    byNet.set(it.net!, l)
  }
  const ratsnest: Ratsnest[] = []
  const singles: string[] = []
  const words: ([string, string] | undefined)[] = []
  let unconnected = 0
  for (const [net, list] of byNet) {
    const comps = new Map<number, Item[]>()
    for (const it of list) {
      const r = uf.find(idx.get(it)!)
      const l = comps.get(r) ?? []
      l.push(it)
      comps.set(r, l)
    }
    // pour pieces alone are floating copper the islands mode keeps, not a part of the net left out
    for (const [r, c] of comps) if (c.every(it => 'piece' in it)) comps.delete(r)
    const pads = list.filter(i => i.kind === 'pad').length
    if (pads === 1 && comps.size === 1) singles.push(net)
    if (comps.size <= 1) continue
    const islands = [...comps.values()].map(c => ({
      items: c,
      pts: c
        .filter(i => i.kind === 'pad' || i.kind === 'via')
        .map(anchor)
        .concat(c.map(anchor)),
    }))
    while (islands.length > 1) {
      let best: { d: number; a: number; b: number; pa: Pt; pb: Pt } | null = null
      for (let a = 0; a < islands.length; a++)
        for (let b = a + 1; b < islands.length; b++)
          for (const pa of islands[a].pts)
            for (const pb of islands[b].pts) {
              const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1])
              if (!best || d < best.d) best = { d, a, b, pa, pb }
            }
      if (!best) break
      ratsnest.push({ net, from: best.pa, to: best.pb })
      const split = islands[best.a].items.some(it => 'piece' in it) || islands[best.b].items.some(it => 'piece' in it)
      words.push(split ? [islandText(islands[best.a].items), islandText(islands[best.b].items)] : undefined)
      unconnected++
      const merged = { items: [...islands[best.a].items, ...islands[best.b].items], pts: [...islands[best.a].pts, ...islands[best.b].pts] }
      islands.splice(best.b, 1)
      islands.splice(best.a, 1)
      islands.push(merged)
    }
  }
  const groups: ConnectedGroups = {
    of: (it: Item) => {
      const i = idx.get(it)
      return i === undefined ? -1 : uf.find(i)
    },
  }
  return { ratsnest, unconnected, shorts, singles, apart, islands: words, groups, pieces: items.filter((it): it is Piece => 'piece' in it) }
}

/** An island of a net in words: up to three of its pads and its largest pour piece. */
function islandText(items: Item[]): string {
  const ps = items.filter((it): it is Piece => 'piece' in it).sort((a, b) => b.piece.area - a.piece.area)
  const pads = items.flatMap(it => (it.kind === 'pad' ? [`${it.ref ?? '?'}.${it.num}`] : []))
  const who = pads.length ? `${pads.slice(0, 3).join(', ')}${pads.length > 3 ? ` and ${pads.length - 3} more pads` : ''}` : 'tracks and vias'
  if (!ps.length) return who
  return `${who} in ${pieceText(ps[0])}${ps.length > 1 ? ` and ${ps.length - 1} more piece${ps.length > 2 ? 's' : ''}` : ''}`
}
