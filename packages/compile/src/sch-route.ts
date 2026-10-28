// The router's square mode for the schematic: one layer, whole grid steps, 90 degree bends, no vias. A wire may cross another
// net's wire at a price, never run along it or meet it at a bend, end or tee. Nets that do not fit negotiate as the board's
// router does, PathFinder style: shared cells grow dearer each round, by the present factor and a history that stays.
import type { Pt } from '@pcbjs/core/model'

/** The negotiation schedule of the board's router, see autoroute.ts. */
const RIPUP = 12
const PRES_FIRST = 10
const PRES_GROW = 1.5
const HIST_STEP = 1
/** Costs in grid steps: a bend, a crossing of another net's wire. */
const BEND = 2
const CROSS = 3
/** A connection may cost `DETOUR_RATIO` times its distance or the distance plus `DETOUR_FLOOR` steps, whichever is more. */
const DETOUR_RATIO = 3
const DETOUR_FLOOR = 24

/** +x, +y, -x, -y */
const DX = [1, 0, -1, 0],
  DY = [0, 1, 0, -1]
export const dirOf = (side: 'left' | 'right' | 'top' | 'bottom'): number => (side === 'right' ? 0 : side === 'bottom' ? 1 : side === 'left' ? 2 : 3)

/** A pin end: a whole grid point and the direction index a wire leaves it by. */
export interface SquarePin {
  at: Pt
  out: number
}
export interface SquareNet {
  net: string
  pins: SquarePin[]
  /** hand wires of the net as orthogonal polylines on the grid, kept as they are */
  fixed?: Pt[][]
}
export interface SquareInput {
  /** the routing area, whole grid units, x0 y0 x1 y1 inclusive */
  area: [number, number, number, number]
  /** points no wire may touch: symbol bodies, labels */
  blocked: Pt[]
  nets: SquareNet[]
  ripup?: number
}
export interface SquareOutput {
  /** each routed net's edges as polylines, the fixed ones left out */
  wires: Map<string, Pt[][]>
  /** nets that found no room, in input order */
  failed: string[]
  rounds: number
  crossings: number
}

/** A binary heap of state ids by cost, ties broken by insertion order. */
class Heap {
  private k: number[] = []
  private v: number[] = []
  private s: number[] = []
  private n = 0
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const k = this.k,
      v = this.v,
      s = this.s
    let i = k.length
    k.push(key)
    v.push(val)
    s.push(this.n++)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] < key || (k[p] === key && s[p] < s[i])) break
      ;[k[i], k[p]] = [k[p], k[i]]
      ;[v[i], v[p]] = [v[p], v[i]]
      ;[s[i], s[p]] = [s[p], s[i]]
      i = p
    }
  }
  pop(): number {
    const k = this.k,
      v = this.v,
      s = this.s
    const top = v[0],
      lk = k.pop()!,
      lv = v.pop()!,
      ls = s.pop()!
    if (k.length) {
      k[0] = lk
      v[0] = lv
      s[0] = ls
      let i = 0
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1
        let m = i
        const less = (a: number, b: number) => k[a] < k[b] || (k[a] === k[b] && s[a] < s[b])
        if (l < k.length && less(l, m)) m = l
        if (r < k.length && less(r, m)) m = r
        if (m === i) break
        ;[k[i], k[m]] = [k[m], k[i]]
        ;[v[i], v[m]] = [v[m], v[i]]
        ;[s[i], s[m]] = [s[m], s[i]]
        i = m
      }
    }
    return top
  }
}

/** Route every net on the grid: each pin joins its net's tree by the cheapest square path, then the nets negotiate. */
export function squareRoute(input: SquareInput): SquareOutput {
  const [x0, y0, x1, y1] = input.area
  const W = x1 - x0 + 1,
    H = y1 - y0 + 1,
    N = W * H
  const idx = (p: Pt) => (p[1] - y0) * W + (p[0] - x0)
  const inside = (p: Pt) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1
  const ptOf = (i: number): Pt => [x0 + (i % W), y0 + Math.floor(i / W)]
  // edge e: 2i the step +x from node i, 2i + 1 the step +y
  const edge = (i: number, d: number) => (d === 0 ? 2 * i : d === 1 ? 2 * i + 1 : d === 2 ? 2 * (i - 1) : 2 * (i - W) + 1)
  const step = (i: number, d: number): number => {
    const x = i % W,
      y = (i - x) / W
    const nx = x + DX[d],
      ny = y + DY[d]
    return nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx
  }

  const hard = new Uint8Array(N)
  for (const p of input.blocked) if (inside(p)) hard[idx(p)] = 1
  const nets = input.nets
  // the net index + 1 of the pin end at a node, and the way out of it
  const pinNet = new Int32Array(N),
    pinOut = new Int8Array(N).fill(-1)
  nets.forEach((n, k) => {
    for (const p of n.pins)
      if (inside(p.at)) {
        const i = idx(p.at)
        pinNet[i] = k + 1
        pinOut[i] = p.out
      }
  })

  const edgeUse = new Uint16Array(2 * N)
  const edgeFixed = new Uint8Array(2 * N)
  const edgeHist = new Float32Array(2 * N),
    nodeHist = new Float32Array(N)
  // per net, its edges; a node's nets from the edges around it
  const own: Set<number>[] = nets.map(() => new Set())
  const fixed: Set<number>[] = nets.map(() => new Set())
  const nodeNets = new Map<number, Map<number, number>>()
  const touch = (i: number, k: number, by: number) => {
    let m = nodeNets.get(i)
    if (!m) nodeNets.set(i, (m = new Map()))
    const c = (m.get(k) ?? 0) + by
    if (c > 0) m.set(k, c)
    else m.delete(k)
    if (!m.size) nodeNets.delete(i)
  }
  const ends = (e: number): [number, number] => {
    const i = e >> 1
    return [i, e & 1 ? i + W : i + 1]
  }
  const addEdge = (k: number, e: number) => {
    if (own[k].has(e)) return
    own[k].add(e)
    edgeUse[e]++
    const [a, b] = ends(e)
    touch(a, k, 1)
    touch(b, k, 1)
  }
  const dropEdge = (k: number, e: number) => {
    if (!own[k].delete(e)) return
    edgeUse[e]--
    const [a, b] = ends(e)
    touch(a, k, -1)
    touch(b, k, -1)
  }
  nets.forEach((n, k) => {
    for (const line of n.fixed ?? [])
      for (let j = 1; j < line.length; j++) {
        let a = line[j - 1]
        const b = line[j]
        const d = b[0] > a[0] ? 0 : b[1] > a[1] ? 1 : b[0] < a[0] ? 2 : 3
        while (a[0] !== b[0] || a[1] !== b[1]) {
          if (!inside(a)) break
          const e = edge(idx(a), d)
          fixed[k].add(e)
          edgeFixed[e] = 1
          addEdge(k, e)
          a = [a[0] + DX[d], a[1] + DY[d]]
        }
      }
  })
  /** The shape of net k at node i: a bitmask of the four directions its edges leave by. */
  const shape = (k: number, i: number): number => {
    let m = 0
    for (let d = 0; d < 4; d++) {
      const j = step(i, d)
      if (j >= 0 && own[k].has(edge(i, d))) m |= 1 << d
    }
    return m
  }
  const H_ = 0b0101,
    V_ = 0b1010
  /** May net k pass node i straight along axis `ax`, 0 x or 1 y: every other net there runs straight across it. */
  const crossable = (k: number, i: number, ax: number): boolean => {
    const m = nodeNets.get(i)
    if (!m) return true
    for (const o of m.keys()) if (o !== k && shape(o, i) !== (ax === 0 ? V_ : H_)) return false
    return true
  }
  const others = (k: number, i: number): boolean => {
    const m = nodeNets.get(i)
    return !!m && m.size > (m.has(k) ? 1 : 0)
  }

  const S = N * 5
  const cost = new Float64Array(S),
    from = new Int32Array(S)
  const seen = new Uint32Array(S)
  let stamp = 0
  const isTarget = new Uint32Array(N),
    isSource = new Uint32Array(N)
  let tstamp = 0

  /** One connection of net k from `src` nodes to `dst` nodes; soft: other nets are priced, not walls. Returns the node path or null. */
  const search = (k: number, src: number[], dst: number[], wired: Set<number>, pres: number): number[] | null => {
    if (++stamp === 0xffffffff) {
      seen.fill(0)
      stamp = 1
    }
    tstamp++
    for (const t of dst) isTarget[t] = tstamp
    for (const s of src) isSource[s] = tstamp
    // the distance to the targets' bounding box: cheap, and never more than the true distance
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity
    for (const t of dst) {
      const x = t % W,
        y = (t - x) / W
      bx0 = Math.min(bx0, x)
      bx1 = Math.max(bx1, x)
      by0 = Math.min(by0, y)
      by1 = Math.max(by1, y)
    }
    const hOf = (i: number) => {
      const x = i % W,
        y = (i - x) / W
      return Math.max(0, bx0 - x, x - bx1) + Math.max(0, by0 - y, y - by1)
    }
    let dist = Infinity
    for (const s of src)
      for (const t of dst) {
        const a = s % W,
          b = (s - a) / W,
          x = t % W,
          y = (t - x) / W
        dist = Math.min(dist, Math.abs(a - x) + Math.abs(b - y))
      }
    const limit = Math.max(dist * DETOUR_RATIO, dist + DETOUR_FLOOR) + 4 * BEND
    const heap = new Heap()
    for (const s of src) {
      const st = s * 5 + 4
      seen[st] = stamp
      cost[st] = 0
      from[st] = -1
      heap.push(hOf(s), st)
    }
    while (heap.size) {
      const st = heap.pop()
      const i = (st / 5) | 0,
        din = st % 5,
        g = cost[st]
      if (isTarget[i] === tstamp && din !== 4) {
        const path: number[] = []
        for (let x = st; x >= 0; x = from[x]) path.push((x / 5) | 0)
        return path.reverse()
      }
      // a pin end not yet wired is left only outward
      const pinHere = pinNet[i] === k + 1 && !wired.has(i)
      for (let d = 0; d < 4; d++) {
        if (din !== 4 && d === (din + 2) % 4) continue
        if (din === 4 && pinHere && d !== pinOut[i]) continue
        const j = step(i, d)
        if (j < 0 || hard[j]) continue
        const tgt = isTarget[j] === tstamp
        if (pinNet[j] && pinNet[j] !== k + 1) continue
        if (pinNet[j] === k + 1 && !tgt && !wired.has(j)) continue
        if (tgt && pinNet[j] === k + 1 && !wired.has(j) && d !== (pinOut[j] + 2) % 4) continue
        if (isSource[j] === tstamp) continue
        let c = 1 + (din !== 4 && d !== din ? BEND : 0)
        const e = edge(i, d)
        if (edgeUse[e] > (own[k].has(e) ? 1 : 0)) {
          if (edgeFixed[e] || pres === Infinity) continue
          c += pres * (1 + edgeHist[e])
        }
        // the node left behind: straight through a crossing is fine, anything else at another net's node is shared
        if (din !== 4 && others(k, i)) {
          if (d === din && crossable(k, i, d % 2)) c += CROSS
          else {
            if (pres === Infinity) continue
            c += pres * (1 + nodeHist[i])
          }
        }
        if (tgt && others(k, j)) {
          if (pres === Infinity) continue
          c += pres * (1 + nodeHist[j])
        }
        const ng = g + c
        const nst = j * 5 + d
        if (seen[nst] === stamp && cost[nst] <= ng) continue
        const f = ng + hOf(j)
        if (f > limit) continue
        seen[nst] = stamp
        cost[nst] = ng
        from[nst] = st
        heap.push(f, nst)
      }
    }
    return null
  }

  /** Route net k from scratch over what the other nets hold now. */
  const routeNet = (k: number, pres: number): boolean => {
    for (const e of [...own[k]]) if (!fixed[k].has(e)) dropEdge(k, e)
    const n = nets[k]
    // components: the fixed wires with the pins on them, then each pin on its own
    const nodes = new Set<number>()
    for (const e of own[k]) {
      const [a, b] = ends(e)
      nodes.add(a)
      nodes.add(b)
    }
    const comp = new Map<number, number>()
    const parent: number[] = []
    const find = (c: number): number => (parent[c] === c ? c : (parent[c] = find(parent[c])))
    for (const v of nodes) {
      comp.set(v, parent.length)
      parent.push(parent.length)
    }
    for (const e of own[k]) {
      const [a, b] = ends(e)
      parent[find(comp.get(a)!)] = find(comp.get(b)!)
    }
    const pins = n.pins.filter(p => inside(p.at)).map(p => idx(p.at))
    for (const p of pins)
      if (!comp.has(p)) {
        comp.set(p, parent.length)
        parent.push(parent.length)
      }
    const groups = new Map<number, number[]>()
    for (const [v, c] of comp) {
      const r = find(c)
      groups.set(r, [...(groups.get(r) ?? []), v])
    }
    const list = [...groups.values()].filter(g => g.some(v => pins.includes(v)) || g.length > 1)
    if (list.length < 2) return true
    // the tree starts at the group of the first pin; each step joins the group nearest it
    const first = list.findIndex(g => g.includes(pins[0]))
    let tree = list.splice(first < 0 ? 0 : first, 1)[0]
    const wired = new Set(nodes)
    while (list.length) {
      const tx = tree.map(t => ptOf(t))
      const near = (g: number[]) =>
        Math.min(
          ...g.map(v => {
            const p = ptOf(v)
            return Math.min(...tx.map(t => Math.abs(t[0] - p[0]) + Math.abs(t[1] - p[1])))
          }),
        )
      list.sort((a, b) => near(a) - near(b))
      const g = list.shift()!
      // a tee at a node another net crosses would read as a connection
      const dst = tree.filter(v => !others(k, v) && !(pinNet[v] === k + 1 && shape(k, v)))
      const src = g.filter(v => !others(k, v))
      const path = dst.length && src.length ? search(k, src, dst, wired, pres) : null
      if (!path) return false
      for (let j = 1; j < path.length; j++) {
        const a = path[j - 1],
          b = path[j]
        const d = b === a + 1 ? 0 : b === a + W ? 1 : b === a - 1 ? 2 : 3
        addEdge(k, edge(a, d))
      }
      for (const v of path) wired.add(v)
      for (const v of g) wired.add(v)
      tree = [...new Set([...tree, ...g, ...path])]
    }
    return true
  }

  /** Edges and nodes two nets share in a way that is not a crossing, and the nets involved. */
  const conflicts = (): { edges: number[]; nodes: number[]; nets: Set<number> } => {
    const edges: number[] = [],
      nodes: number[] = [],
      bad = new Set<number>()
    for (let k = 0; k < nets.length; k++)
      for (const e of own[k])
        if (edgeUse[e] > 1) {
          edges.push(e)
          bad.add(k)
        }
    for (const [i, m] of nodeNets) {
      if (m.size < 2) continue
      const ks = [...m.keys()]
      const ok = ks.length === 2 && ((shape(ks[0], i) === H_ && shape(ks[1], i) === V_) || (shape(ks[0], i) === V_ && shape(ks[1], i) === H_))
      if (!ok) {
        nodes.push(i)
        for (const k of ks) bad.add(k)
      }
    }
    return { edges: [...new Set(edges)], nodes, nets: bad }
  }

  const order = nets.map((_, k) => k)
  const span = (k: number) => {
    const ps = nets[k].pins.map(p => p.at)
    if (!ps.length) return 0
    const xs = ps.map(p => p[0]),
      ys = ps.map(p => p[1])
    return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)
  }
  order.sort((a, b) => span(a) - span(b) || a - b)
  const failed = new Set<number>()
  for (const k of order) if (!routeNet(k, Infinity)) failed.add(k)
  let rounds = 0
  const limit = input.ripup ?? RIPUP
  let c = conflicts()
  while ((failed.size || c.nets.size) && rounds < limit) {
    rounds++
    const pres = PRES_FIRST * PRES_GROW ** (rounds - 1)
    const again = order.filter(k => failed.has(k) || c.nets.has(k))
    failed.clear()
    for (const k of again) if (!routeNet(k, pres)) failed.add(k)
    c = conflicts()
    for (const e of c.edges) edgeHist[e] += HIST_STEP
    for (const i of c.nodes) nodeHist[i] += HIST_STEP
  }
  // what still collides leaves the board, most collisions first, and tries once more around the rest
  const ripped = new Set<number>()
  while (c.nets.size) {
    const hits = new Map<number, number>()
    for (const e of c.edges) for (let k = 0; k < nets.length; k++) if (own[k].has(e)) hits.set(k, (hits.get(k) ?? 0) + 1)
    for (const i of c.nodes) for (const k of nodeNets.get(i)?.keys() ?? []) hits.set(k, (hits.get(k) ?? 0) + 1)
    const worst = [...hits.entries()].filter(([k]) => c.nets.has(k) && !ripped.has(k) && own[k].size > fixed[k].size).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
    if (worst === undefined) break
    for (const e of [...own[worst]]) if (!fixed[worst].has(e)) dropEdge(worst, e)
    ripped.add(worst)
    c = conflicts()
  }
  for (const k of ripped)
    if (!routeNet(k, Infinity)) {
      failed.add(k)
      for (const e of [...own[k]]) if (!fixed[k].has(e)) dropEdge(k, e)
    }
  for (const k of failed) for (const e of [...own[k]]) if (!fixed[k].has(e)) dropEdge(k, e)

  const wires = new Map<string, Pt[][]>()
  let crossings = 0
  for (const [i, m] of nodeNets) if (m.size === 2) crossings++
  nets.forEach((n, k) => {
    if (failed.has(k)) return
    const free = [...own[k]].filter(e => !fixed[k].has(e))
    if (free.length) wires.set(n.net, polylines(free, ends, ptOf, pinNet, k, own[k]))
  })
  return { wires, failed: nets.filter((_, k) => failed.has(k)).map(n => n.net), rounds, crossings }
}

/** Edges as polylines that break at pin ends, tees and the ends of fixed wires; corners stay inside a polyline. */
function polylines(edges: number[], ends: (e: number) => [number, number], ptOf: (i: number) => Pt, pinNet: Int32Array, k: number, all: Set<number>): Pt[][] {
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => adj.set(a, [...(adj.get(a) ?? []), b])
  for (const e of edges) {
    const [a, b] = ends(e)
    link(a, b)
    link(b, a)
  }
  const degAll = new Map<number, number>()
  for (const e of all) {
    const [a, b] = ends(e)
    degAll.set(a, (degAll.get(a) ?? 0) + 1)
    degAll.set(b, (degAll.get(b) ?? 0) + 1)
  }
  const stop = (v: number) => pinNet[v] === k + 1 || (degAll.get(v) ?? 0) !== 2 || (adj.get(v)?.length ?? 0) !== 2
  const used = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const out: Pt[][] = []
  const walk = (a: number, b: number) => {
    const line = [a, b]
    used.add(key(a, b))
    let prev = a,
      cur = b
    while (!stop(cur)) {
      const next = adj.get(cur)!.find(x => x !== prev && !used.has(key(cur, x)))
      if (next === undefined) break
      used.add(key(cur, next))
      line.push(next)
      prev = cur
      cur = next
    }
    out.push(simplify(line.map(ptOf)))
  }
  const starts = [...adj.keys()].sort((a, b) => a - b)
  for (const v of starts) if (stop(v)) for (const w of adj.get(v)!) if (!used.has(key(v, w))) walk(v, w)
  // loops with no stop
  for (const v of starts) for (const w of adj.get(v)!) if (!used.has(key(v, w))) walk(v, w)
  return out
}

/** The corners of an orthogonal polyline. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    if (out.length && out.at(-1)![0] === p[0] && out.at(-1)![1] === p[1]) continue
    if (out.length >= 2) {
      const a = out.at(-2)!,
        b = out.at(-1)!
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop()
    }
    out.push(p)
  }
  return out
}
