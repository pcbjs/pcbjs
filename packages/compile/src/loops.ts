// Loops in a net's copper, pours left out: holes in the union of a layer's copper, and cycles through vias and plated pads between layers.
import type { Board, DrcMarker, Item, Pt, Ring } from '@pcbjs/core/model'
import { area, centroid, intersection, offset, polysToRings, union } from './geom.js'
import { copperLayers } from './layers.js'
import { copperLayersOf } from './copper.js'
import { inside, ringSet, solidRings, type RingSet } from './obstacles.js'
import { classOf } from './netclass.js'

/** mm²; a smaller hole is a sliver of the offsets, not a loop. */
const MIN_HOLE = 1e-3

/** A loop on one layer has its `hole`; one between layers has its `legs`, each the stretch of a layer's copper `piece` from `a` to `b`. */
export interface Loop {
  net: string
  layer?: string
  at: Pt
  items: Item[]
  hole?: Ring
  legs?: { piece: Ring[]; a: Pt; b: Pt }[]
}

const f2 = (v: number) => v.toFixed(2)

export function loopLabel(it: Item): string {
  if (it.kind === 'pad') return `pad ${it.ref ?? ''}.${it.num}`
  const route = it.kind === 'track' || it.kind === 'via' ? it.route : undefined
  if (it.kind === 'via' && !route) return `via at (${f2(it.at[0])}, ${f2(it.at[1])})`
  return `${it.kind}${route ? ` ${route}` : it.ref ? ` of ${it.ref}` : ''}`
}

const counted = (it: Item, cu: string[]) => it.net !== undefined && it.kind !== 'zone' && copperLayersOf(it, cu).length > 0

/** The loops of every net, or of `only`, over the board's copper but pours. */
export function netLoops(board: Board, only?: Set<string>): Loop[] {
  const cu = copperLayers(board.copper)
  const byNet = new Map<string, Item[]>()
  for (const it of board.items) {
    if (!counted(it, cu) || (only && !only.has(it.net!))) continue
    let l = byNet.get(it.net!)
    if (!l) byNet.set(it.net!, (l = []))
    l.push(it)
  }
  const out: Loop[] = []
  for (const [net, items] of byNet) if (items.length > 2) out.push(...loopsOf(net, items, cu))
  return out
}

function loopsOf(net: string, items: Item[], cu: string[]): Loop[] {
  const out: Loop[] = []
  interface Node {
    layer: string
    ring: RingSet
  }
  const nodes: Node[] = []
  const multi = items.filter(it => copperLayersOf(it, cu).length > 1)
  const ringsOf = new Map<Item, Map<string, Ring[]>>()
  const on = (it: Item, l: string) => {
    let m = ringsOf.get(it)
    if (!m) ringsOf.set(it, (m = new Map()))
    let r = m.get(l)
    if (!r) m.set(l, (r = solidRings(it, l)))
    return r
  }
  for (const layer of cu) {
    const here = items.filter(it => copperLayersOf(it, cu).includes(layer))
    if (!here.length) continue
    const polys = union(here.flatMap(it => on(it, layer)))
    for (const p of polys) {
      nodes.push({ layer, ring: ringSet([p.outer, ...p.holes]) })
      for (const h of p.holes) {
        if (Math.abs(area([h])) < MIN_HOLE) continue
        const near = here.filter(it => intersection(polysToRings(offset(on(it, layer), 0.01)), [h]).length > 0)
        out.push({ net, layer, at: centroid([h]), items: near, hole: h })
      }
    }
  }
  // a bipartite graph of layer pieces and the items that join layers; each independent cycle is one loop
  const centre = (it: Item): Pt => (it.kind === 'pad' || it.kind === 'via' ? it.at : centroid(on(it, copperLayersOf(it, cu)[0])))
  const touches = multi.map(it => {
    const at = centre(it)
    return copperLayersOf(it, cu)
      .map(l => nodes.findIndex(nd => nd.layer === l && inside(nd.ring, at[0], at[1])))
      .filter(n => n >= 0)
  })
  // one pad drawn in parts, or items side by side in copper on every layer they share, join the layers once
  const up = multi.map((_, i) => i)
  const find = (i: number): number => {
    while (up[i] !== i) i = up[i] = up[up[i]]
    return i
  }
  const solidBetween = (a: Pt, b: Pt, n: number) => {
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      if (!inside(nodes[n].ring, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))) return false
    }
    return true
  }
  for (let i = 0; i < multi.length; i++)
    for (let j = i + 1; j < multi.length; j++) {
      const a = multi[i],
        b = multi[j]
      const shared = touches[i].filter(n => touches[j].includes(n))
      const part = a.kind === 'pad' && b.kind === 'pad' && a.ref !== undefined && a.ref === b.ref && a.num !== '' && a.num === b.num
      if (part || (shared.length >= 2 && shared.every(n => solidBetween(centre(a), centre(b), n)))) up[find(i)] = find(j)
    }
  const groups = [...new Set(multi.map((_, i) => find(i)))]
  const V = nodes.length + groups.length
  const adj: { to: number; edge: number }[][] = Array.from({ length: V }, () => [])
  const memberIdx = groups.map(g => multi.flatMap((_, i) => (find(i) === g ? [i] : [])))
  const members = memberIdx.map(ix => ix.map(i => multi[i]))
  const entry = (g: number, n: number) => centre(multi[memberIdx[g - nodes.length].find(i => touches[i].includes(n))!])
  let edges = 0
  groups.forEach((g, k) => {
    const ns = new Set(multi.flatMap((_, i) => (find(i) === g ? touches[i] : [])))
    for (const n of ns) {
      const u = nodes.length + k,
        e = edges++
      adj[u].push({ to: n, edge: e })
      adj[n].push({ to: u, edge: e })
    }
  })
  const parent = new Int32Array(V).fill(-2),
    pedge = new Int32Array(V).fill(-1),
    depth = new Int32Array(V)
  const seen = new Set<number>()
  for (let s = 0; s < V; s++) {
    if (parent[s] !== -2) continue
    parent[s] = -1
    const queue = [s]
    while (queue.length) {
      const u = queue.shift()!
      for (const { to, edge } of adj[u]) {
        if (edge === pedge[u]) continue
        if (parent[to] === -2) {
          parent[to] = u
          pedge[to] = edge
          depth[to] = depth[u] + 1
          queue.push(to)
          continue
        }
        if (seen.has(edge)) continue
        seen.add(edge)
        const pa: number[] = [],
          pb: number[] = []
        let a = u,
          b = to
        while (a !== b) {
          if (depth[a] >= depth[b]) {
            pa.push(a)
            a = parent[a]
          } else {
            pb.push(b)
            b = parent[b]
          }
        }
        const path = [...pa, a, ...pb.reverse()]
        const legs = path.flatMap((v, i) => {
          if (v >= nodes.length) return []
          const prev = path[(i + path.length - 1) % path.length],
            next = path[(i + 1) % path.length]
          return [{ piece: nodes[v].ring.rings, a: entry(prev, v), b: entry(next, v) }]
        })
        const its = new Set<Item>()
        for (const v of path) {
          if (v >= nodes.length) {
            for (const it of members[v - nodes.length]) its.add(it)
            continue
          }
          const nd = nodes[v]
          for (const it of items) if (it.kind === 'track' && it.layer === nd.layer && inside(nd.ring, it.pts[0][0], it.pts[0][1])) its.add(it)
        }
        const vias = [...its].filter(it => it.kind !== 'track') as (Item & { at: Pt })[]
        out.push({ net, at: vias.length ? centroid([vias.map(v => v.at)]) : [0, 0], items: [...its], legs })
      }
    }
  }
  return out
}

function courtyards(board: Board): Map<string, RingSet> {
  const rings = new Map<string, Ring[]>()
  for (const it of board.items) {
    if (it.kind !== 'graphic' || !it.ref || (it.layer !== 'F.CrtYd' && it.layer !== 'B.CrtYd')) continue
    let l = rings.get(it.ref)
    if (!l) rings.set(it.ref, (l = []))
    l.push(...it.paths.filter((p, i) => it.closed[i] && p.length >= 3))
  }
  return new Map([...rings].filter(([, r]) => r.length).map(([ref, r]) => [ref, ringSet(r)]))
}

/** A pin strap: the loop's edges, the hole's outline or each leg's copper, lie in one part's courtyard, and any pads of the loop are of that part. */
function strap(l: Loop, yards: Map<string, RingSet>): boolean {
  const refs = new Set(l.items.flatMap(it => (it.kind === 'pad' ? [it.ref ?? ''] : [])))
  if (refs.size > 1) return false
  const joins = l.items.flatMap(it => (it.kind === 'via' || it.kind === 'pad' ? [it.at] : []))
  return [...(refs.size ? refs : yards.keys())].some(ref => {
    const yard = yards.get(ref)
    if (!yard) return false
    const within = (p: Pt) => inside(yard, p[0], p[1])
    if (l.hole) return l.hole.every(within)
    return (
      joins.every(within) &&
      (l.legs ?? []).every(({ piece, a, b }) =>
        intersection(piece, yard.rings).some(p => {
          const s = ringSet([p.outer, ...p.holes])
          return inside(s, a[0], a[1]) && inside(s, b[0], b[1])
        }),
      )
    )
  })
}

/** DRC `net-loop`: one warning per loop, unless the net's class says `loops: true`, a route of the net has `.loop()`, or the loop is a pin strap of one part. */
export function loopFindings(board: Board): DrcMarker[] {
  const allowed = new Set(board.loopNets ?? [])
  const yards = courtyards(board)
  return netLoops(board)
    .filter(l => !allowed.has(l.net) && !classOf(board, l.net)?.loops && !strap(l, yards))
    .map(l => {
      const names = l.items.slice(0, 6).map(loopLabel)
      const more = l.items.length > 6 ? ` and ${l.items.length - 6} more` : ''
      const src = l.items.find(it => it.kind === 'track' && it.src)?.src
      const m: DrcMarker = {
        severity: 'warning',
        rule: 'net-loop',
        net: l.net,
        at: l.at,
        items: l.items.map(it => it.id),
        message: `net ${l.net} forms a loop${l.layer ? ` on ${l.layer}` : ' between layers'} through ${names.join(', ')}${more}; route it as a tree, or mark it intended with .loop() on a route of the net or loops: true in its class`,
      }
      if (l.layer) m.layer = l.layer
      if (src) m.src = src
      return m
    })
}
