import type { Board, PairInfo, Pt, Track, Via } from '@pcbjs/core/model'
import { routeLength } from './length.js'

export interface PairCopper {
  id: string
  /** the router's record, absent for tracks that carry a pair id without one */
  info?: PairInfo
  /** [P, N] net names, from the info or the tracks */
  nets: [string | undefined, string | undefined]
  P: Track[]
  N: Track[]
  viasP: Via[]
  viasN: Via[]
  /** routeLength of each side, track length plus via barrels, mm */
  lengthP: number
  lengthN: number
}

const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/** Every pair id with its tracks and vias; a via belongs to a side when on its net and at an end of one of its tracks. */
export function pairsOf(board: Board): PairCopper[] {
  const by = new Map<string, { P: Track[]; N: Track[] }>()
  for (const it of board.items) {
    if (it.kind !== 'track' || it.pair === undefined) continue
    let e = by.get(it.pair)
    if (!e) by.set(it.pair, (e = { P: [], N: [] }))
    ;(it.role === 'N' ? e.N : e.P).push(it)
  }
  const infos = new Map((board.pairs ?? []).map(p => [p.id, p]))
  const vias = board.items.filter((i): i is Via => i.kind === 'via')
  const viasOf = (ts: Track[]) => {
    const net = ts[0]?.net
    const ends = ts.flatMap(t => [t.pts[0], t.pts[t.pts.length - 1]])
    return vias.filter(v => v.net === net && ends.some(e => near(e, v.at)))
  }
  return [...by].map(([id, e]) => {
    const viasP = viasOf(e.P),
      viasN = viasOf(e.N)
    const info = infos.get(id)
    return {
      id,
      ...(info ? { info } : {}),
      nets: info ? [info.nets[0], info.nets[1]] : [e.P[0]?.net, e.N[0]?.net],
      P: e.P,
      N: e.N,
      viasP,
      viasN,
      lengthP: routeLength(e.P, viasP, board.stackup ?? board.thickness),
      lengthN: routeLength(e.N, viasN, board.stackup ?? board.thickness),
    }
  })
}

/** The edge-to-edge gap of the coupled section furthest off `target`; stubs, fans, flares and necks are not coupled. */
export function coupledGap(p: PairCopper, target: number, pads: Pt[] = []): { gap: number; at: Pt; layer: string } | null {
  let worst: { gap: number; at: Pt; layer: string; off: number } | null = null
  const anchors = [...pads, ...p.viasP.map(v => v.at), ...p.viasN.map(v => v.at)]
  const anchored = (q: Pt) => anchors.some(c => near(c, q))
  const atPad = (q: Pt) => pads.some(c => near(c, q))
  const width = p.info?.width
  // by the index of each segment's end point
  const coupled = (t: Track): boolean[] => {
    const n = t.pts.length,
      ok = Array(n).fill(true)
    ok[0] = false
    for (let i = 1; i < n; i++) if (anchored(t.pts[i - 1]) || anchored(t.pts[i])) ok[i] = false
    // a track leaves a pad straight to the pads' edge and fans from there; it leaves a via by its flare at once
    if (atPad(t.pts[0]) && n > 2) ok[2] = false
    if (atPad(t.pts[n - 1]) && n > 2) ok[n - 2] = false
    return ok
  }
  const thin = (t: Track) => width !== undefined && t.width < width - 1e-6
  for (const a of p.P)
    for (const b of p.N) {
      if (a.layer !== b.layer || thin(a) || thin(b)) continue
      const reach = 2 * (target + (a.width + b.width) / 2)
      const ca = coupled(a),
        cb = coupled(b)
      for (let i = 1; i < a.pts.length; i++)
        for (let j = 1; j < b.pts.length; j++) {
          if (!ca[i] || !cb[j]) continue
          const a0 = a.pts[i - 1],
            a1 = a.pts[i],
            b0 = b.pts[j - 1],
            b1 = b.pts[j]
          const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]),
            lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1])
          if (la < 1e-6 || lb < 1e-6) continue
          const u: Pt = [(a1[0] - a0[0]) / la, (a1[1] - a0[1]) / la],
            v: Pt = [(b1[0] - b0[0]) / lb, (b1[1] - b0[1]) / lb]
          if (Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-6 || u[0] * v[0] + u[1] * v[1] < 0) continue
          const s0 = (b0[0] - a0[0]) * u[0] + (b0[1] - a0[1]) * u[1],
            s1 = (b1[0] - a0[0]) * u[0] + (b1[1] - a0[1]) * u[1]
          const lo = Math.max(0, Math.min(s0, s1)),
            hi = Math.min(la, Math.max(s0, s1))
          if (hi - lo < Math.max(1e-3, Math.min(a.width, b.width) / 2)) continue
          const d = Math.abs((b0[0] - a0[0]) * u[1] - (b0[1] - a0[1]) * u[0])
          if (d >= reach) continue
          const gap = d - (a.width + b.width) / 2,
            off = Math.abs(gap - target)
          const m = (lo + hi) / 2
          if (!worst || off > worst.off) worst = { gap, at: [a0[0] + u[0] * m, a0[1] + u[1] * m], layer: a.layer, off }
        }
    }
  return worst && { gap: worst.gap, at: worst.at, layer: worst.layer }
}

/** The copper of one route id and its length with via barrels; for a pair each side, the longer one and the skew. */
export interface RouteCopper {
  id: string
  tracks: Track[]
  vias: Via[]
  pair?: string
  /** mm; for a pair the longer side */
  length: number
  lengthP?: number
  lengthN?: number
  skew?: number
}

/** Every route id with its copper and length, in order of first appearance. */
export function routesCopper(board: Board): Map<string, RouteCopper> {
  const by = new Map<string, { tracks: Track[]; vias: Via[] }>()
  for (const it of board.items) {
    if ((it.kind !== 'track' && it.kind !== 'via') || it.route === undefined) continue
    let e = by.get(it.route)
    if (!e) by.set(it.route, (e = { tracks: [], vias: [] }))
    if (it.kind === 'track') e.tracks.push(it)
    else e.vias.push(it)
  }
  const stack = board.stackup ?? board.thickness
  const out = new Map<string, RouteCopper>()
  for (const [id, e] of by) {
    const pair = e.tracks.find(t => t.pair !== undefined)?.pair
    if (pair === undefined) {
      out.set(id, { id, ...e, length: routeLength(e.tracks, e.vias, stack) })
      continue
    }
    const P = e.tracks.filter(t => t.role !== 'N'),
      N = e.tracks.filter(t => t.role === 'N')
    const netP = P[0]?.net,
      netN = N[0]?.net
    const lengthP = routeLength(
        P,
        e.vias.filter(v => v.net === netP),
        stack,
      ),
      lengthN = routeLength(
        N,
        e.vias.filter(v => v.net === netN),
        stack,
      )
    out.set(id, { id, ...e, pair, length: Math.max(lengthP, lengthN), lengthP, lengthN, skew: Math.abs(lengthP - lengthN) })
  }
  return out
}
