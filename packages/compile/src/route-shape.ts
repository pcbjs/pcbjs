// Shape defects of a route's own copper, for the pair layout and tuner tests. Board mm, y down.
import type { Board, Pt, Ring, Track, Via } from '@pcbjs/core/model'
import { strokeOpen, union } from './geom.js'
import { flatten, primsOf, turnOf } from './round.js'

/** One defect of a route's shape. */
export interface ShapeIssue {
  kind: 'overlap' | 'reverse' | 'notch'
  route: string
  layer: string
  at: Pt
  message: string
}

const EPS = 1e-6
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const f3 = (p: Pt) => `(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`

function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): { d: number; at: Pt } {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    const t = o1 / (o1 - o2)
    return { d: 0, at: [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t] }
  }
  const ps = (p: Pt, u: Pt, v: Pt): { d: number; at: Pt } => {
    const dx = v[0] - u[0], dy = v[1] - u[1], l2 = dx * dx + dy * dy
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2))
    const q: Pt = [u[0] + dx * t, u[1] + dy * t]
    return { d: dist(p, q), at: q }
  }
  return [ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b)].reduce((x, y) => (y.d < x.d ? y : x))
}

/** Overlaps, turns back over 150 degrees, and notches of 10 degrees or more in the union outline narrower than the track. */
export function routeShapeIssues(route: string, tracks: Track[], vias: Via[]): ShapeIssue[] {
  const out: ShapeIssue[] = []
  const groups = new Map<string, Track[]>()
  for (const t of tracks) { const k = `${t.layer}\u0000${t.net ?? ''}`; groups.set(k, [...(groups.get(k) ?? []), t]) }
  for (const ts of groups.values()) {
    // the chords of an arc share one primitive index
    const segs: { a: Pt; b: Pt; t: number; k: number }[] = []
    ts.forEach((t, ti) => {
      primsOf(t).forEach((p, k) => {
        const pts = flatten([p])
        for (let i = 1; i < pts.length; i++) segs.push({ a: pts[i - 1], b: pts[i], t: ti, k })
      })
      const pts = t.pts
      for (let i = 1; i + 1 < pts.length; i++) {
        const u: Pt = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], v: Pt = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]
        if (Math.hypot(...u) < EPS || Math.hypot(...v) < EPS) continue
        if (Math.abs(turnOf(u, v)) > (150 * Math.PI) / 180) out.push({ kind: 'reverse', route, layer: t.layer, at: pts[i], message: `${t.net ?? 'a track'} turns back on itself at ${f3(pts[i])}` })
      }
    })
    for (let i = 0; i < ts.length; i++) for (let j = 0; j < ts.length; j++) {
      if (i === j) continue
      const a = ts[i].pts, b = ts[j].pts
      if (dist(a[a.length - 1], b[0]) > EPS || a.length < 2 || b.length < 2) continue
      const u: Pt = [a[a.length - 1][0] - a[a.length - 2][0], a[a.length - 1][1] - a[a.length - 2][1]], v: Pt = [b[1][0] - b[0][0], b[1][1] - b[0][1]]
      if (Math.abs(turnOf(u, v)) > (150 * Math.PI) / 180) out.push({ kind: 'reverse', route, layer: ts[i].layer, at: b[0], message: `${ts[i].net ?? 'a track'} turns back where two of its pieces meet at ${f3(b[0])}` })
    }
    const ends = ts.flatMap(t => [t.pts[0], t.pts[t.pts.length - 1]])
    const shared = (p: Pt) => ends.some(e => dist(e, p) < EPS)
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], q = segs[j]
      if (s.t === q.t && Math.abs(s.k - q.k) <= 1) continue
      const r = segSeg(s.a, s.b, q.a, q.b)
      if (r.d > EPS) continue
      const common = [s.a, s.b].some(p => [q.a, q.b].some(e => dist(p, e) < EPS && dist(p, r.at) < EPS))
      if (common && (s.t !== q.t || shared(r.at)) && !collinearOverlap(s.a, s.b, q.a, q.b)) continue
      out.push({ kind: 'overlap', route, layer: ts[s.t].layer, at: r.at, message: `${ts[s.t].net ?? 'a track'} runs over itself at ${f3(r.at)}` })
    }
  }
  out.push(...notches(route, tracks, vias))
  return out
}

/** True when two segments lie on one line and share more than a point. */
function collinearOverlap(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const u: Pt = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...u)
  if (l < EPS) return false
  const cr = (p: Pt) => Math.abs(u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0])) / l
  if (cr(c) > EPS || cr(d) > EPS) return false
  const s = (p: Pt) => (u[0] * (p[0] - a[0]) + u[1] * (p[1] - a[1])) / l
  return Math.min(l, Math.max(s(c), s(d))) - Math.max(0, Math.min(s(c), s(d))) > EPS
}

/** The notches of the union outline of a route's copper, layer by layer, see routeShapeIssues. */
function notches(route: string, tracks: Track[], vias: Via[]): ShapeIssue[] {
  const out: ShapeIssue[] = []
  const layers = [...new Set(tracks.map(t => t.layer))]
  for (const layer of layers) {
    const ts = tracks.filter(t => t.layer === layer)
    if (!ts.length) continue
    const vs = vias.filter(v => v.layers.includes(layer) || v.layer === layer)
    const rings: Ring[] = []
    for (const t of ts) for (const p of strokeOpen(t.pts, t.width)) rings.push(p.outer, ...p.holes)
    for (const v of vs) {
      const n = 64, r = v.size / 2
      rings.push(Array.from({ length: n }, (_, i): Pt => [v.at[0] + r * Math.cos((2 * Math.PI * i) / n), v.at[1] + r * Math.sin((2 * Math.PI * i) / n)]))
    }
    const skip: { at: Pt; r: number }[] = vs.map(v => ({ at: v.at, r: v.size / 2 + 0.01 }))
    for (const a of ts) for (const b of ts) {
      if (a === b || Math.abs(a.width - b.width) < EPS) continue
      for (const p of [a.pts[0], a.pts[a.pts.length - 1]]) if ([b.pts[0], b.pts[b.pts.length - 1]].some(q => dist(p, q) < EPS)) skip.push({ at: p, r: Math.max(a.width, b.width) / 2 + 0.01 })
    }
    // the outline rounds the caps of free ends, which is not a notch
    const ends = ts.flatMap(t => [t.pts[0], t.pts[t.pts.length - 1]])
    const free = ends.filter(p => ends.filter(q => dist(p, q) < EPS).length === 1 && !vs.some(v => dist(v.at, p) < EPS))
    const atCap = (p: Pt, w: number) => free.some(e => dist(e, p) <= w / 2 + 0.01)
    const widthAt = (p: Pt) => {
      let best = Infinity, w = ts[0].width
      for (const t of ts) for (let i = 1; i < t.pts.length; i++) { const d = segSeg(p, p, t.pts[i - 1], t.pts[i]).d; if (d < best) { best = d; w = t.width } }
      return w
    }
    for (const poly of union(rings)) {
      // a vertex is convex for the copper when it turns the way the outer ring does
      let A = 0
      for (let i = 0; i < poly.outer.length; i++) { const p = poly.outer[i], q = poly.outer[(i + 1) % poly.outer.length]; A += p[0] * q[1] - q[0] * p[1] }
      const o = Math.sign(A)
      for (const ring of [poly.outer, ...poly.holes]) {
      const n = ring.length
      if (n < 3) continue
      const turnAt = (i: number) => {
        const p = ring[(i - 1 + n) % n], q = ring[i], r = ring[(i + 1) % n]
        const u: Pt = [q[0] - p[0], q[1] - p[1]], v: Pt = [r[0] - q[0], r[1] - q[1]]
        return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * o
      }
      const len = (i: number, j: number) => dist(ring[(i + n) % n], ring[(j + n) % n])
      for (let i = 0; i < n; i++) {
        const tau = turnAt(i)
        if (tau > (-10 * Math.PI) / 180) continue
        const v = ring[i]
        if (skip.some(s => dist(s.at, v) < s.r)) continue
        const w = widthAt(v)
        // a notch dents 0.01 mm or more and comes back within a track width; an S bend moves the track further
        let cancels = false
        for (const dir of [1, -1]) {
          const a = ring[(i - dir + n) % n], ux = v[0] - a[0], uy = v[1] - a[1], ul = Math.hypot(ux, uy) || 1
          const off = (p: Pt) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) / ul
          let acc = tau, walked = 0, k = i, depth = 0
          for (let step = 0; step < n && walked < w - 0.005; step++) {
            const nk = k + dir, p = ring[(nk + n) % n]
            walked += len(k, nk)
            if (walked >= w - 0.005 || atCap(p, w)) break
            depth = Math.max(depth, off(p))
            acc += turnAt((nk + n) % n)
            k = nk
            if (acc >= -1e-6) { cancels = depth >= 0.01 && off(p) < w; break }
          }
          if (cancels) break
        }
        if (cancels) out.push({ kind: 'notch', route, layer, at: v, message: `the outline of the copper turns in by ${((-tau * 180) / Math.PI).toFixed(0)} degrees and back within ${w} mm at ${f3(v)}` })
      }
      }
    }
  }
  return out
}

/** The shape defects of every route of a board, by route id. */
export function boardShapeIssues(board: Board): ShapeIssue[] {
  const by = new Map<string, { tracks: Track[]; vias: Via[] }>()
  for (const it of board.items) {
    if ((it.kind !== 'track' && it.kind !== 'via') || it.route === undefined) continue
    let e = by.get(it.route)
    if (!e) by.set(it.route, e = { tracks: [], vias: [] })
    if (it.kind === 'track') e.tracks.push(it)
    else e.vias.push(it)
  }
  return [...by].flatMap(([id, e]) => routeShapeIssues(id, e.tracks, e.vias))
}
