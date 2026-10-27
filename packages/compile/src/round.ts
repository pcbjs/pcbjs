// Tracks with arcs, `Track.prims`, beside the flattened polyline `Track.pts` every check reads. Board mm, y down.
import type { Prim, Pt } from '@pcbjs/core/model'
import { arcSweep } from './path.js'

export type Arc = Extract<Prim, { kind: 'arc' }>
const EPS = 1e-9
/** the widest angle one chord of a flattened track arc spans, 5 degrees, and the chord error it keeps within, mm */
const STEP = Math.PI / 36, TOL = 0.005

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const unit = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]); return l < EPS ? [0, 0] : [a[0] / l, a[1] / l] }
/** Signed turn from d1 to d2 in radians, positive for a left turn on the y-down screen. */
export const turnOf = (d1: Pt, d2: Pt) => Math.atan2(d2[0] * d1[1] - d2[1] * d1[0], d1[0] * d2[0] + d1[1] * d2[1])

export const arcRadius = (a: Arc) => dist(a.from, a.center)
/** How many chords a track arc is flattened into: at most 5 degrees and 0.005 mm of chord error each. */
export function chordCount(a: Arc): number {
  const s = Math.abs(arcSweep(a)), r = arcRadius(a)
  return Math.max(1, Math.ceil(s / STEP - 1e-9), Math.ceil(s / (2 * Math.acos(Math.max(0, 1 - TOL / Math.max(r, 0.01)))) - 1e-9))
}

/** The length of one primitive: a line's, or an arc's radius times its sweep. */
export function primLength(p: Prim): number { return p.kind === 'line' ? dist(p.from, p.to) : arcRadius(p) * Math.abs(arcSweep(p)) }
/** The length of a path of primitives, arcs measured along the arc. */
export function primsLength(prims: readonly Prim[]): number { let s = 0; for (const p of prims) s += primLength(p); return s }

/** The polyline of a path: every line's end, and each arc as its chords, `chordCount` of them, ends exact. */
export function flatten(prims: readonly Prim[]): Pt[] {
  if (!prims.length) return []
  const out: Pt[] = [prims[0].from]
  for (const p of prims) {
    if (p.kind === 'arc') {
      const n = chordCount(p), r = arcRadius(p), a0 = Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0]), dt = arcSweep(p)
      for (let i = 1; i < n; i++) { const a = a0 + (dt * i) / n; out.push([p.center[0] + r * Math.cos(a), p.center[1] + r * Math.sin(a)]) }
    }
    out.push(p.to)
  }
  return out.filter((q, i) => i === 0 || dist(q, out[i - 1]) > EPS)
}

/** A polyline as line primitives, zero length segments dropped. */
export function linesOf(pts: readonly Pt[]): Prim[] {
  const out: Prim[] = []
  for (let i = 1; i < pts.length; i++) if (dist(pts[i - 1], pts[i]) > EPS) out.push({ kind: 'line', from: pts[i - 1], to: pts[i] })
  return out
}

/** The primitives of a track: its own when it has them, else its polyline as lines. */
export function primsOf(t: { pts: Pt[]; prims?: Prim[] }): Prim[] { return t.prims?.length ? t.prims : linesOf(t.pts) }

/** True when the path holds an arc. */
export const anyArc = (prims: readonly Prim[] | undefined) => !!prims && prims.some(p => p.kind === 'arc')

/** The path run backwards. */
export function reversePrims(prims: readonly Prim[]): Prim[] {
  return prims.slice().reverse().map(p => (p.kind === 'line' ? { kind: 'line', from: p.to, to: p.from } : { kind: 'arc', from: p.to, to: p.from, center: p.center, cw: !p.cw }))
}

/** Drops zero-length primitives and joins collinear lines, so a lead and the fan that carries on along it are one line. */
export function tidyPrims(prims: readonly Prim[]): Prim[] {
  const out: Prim[] = []
  for (const p of prims) {
    if (p.kind === 'line' ? dist(p.from, p.to) < 1e-7 : dist(p.from, p.to) < 1e-7 || Math.abs(arcSweep(p)) < 1e-7) {
      if (out.length) out[out.length - 1] = { ...out[out.length - 1], to: p.to } as Prim
      continue
    }
    const q = out[out.length - 1]
    if (q && q.kind === 'line' && p.kind === 'line') {
      const u = unit(sub(q.to, q.from)), v = unit(sub(p.to, p.from))
      if (Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-9 && u[0] * v[0] + u[1] * v[1] > 0) { out[out.length - 1] = { kind: 'line', from: q.from, to: p.to }; continue }
    }
    out.push(p)
  }
  return out
}

/** The point `s` mm along a path, clamped to it, and the unit direction of travel there. */
export function pointAt(prims: readonly Prim[], s: number): { p: Pt; d: Pt } {
  let rest = Math.max(0, s)
  for (let k = 0; k < prims.length; k++) {
    const q = prims[k], l = primLength(q)
    if (rest <= l || k === prims.length - 1) return pointIn(q, Math.min(rest, l), l)
    rest -= l
  }
  return { p: [0, 0], d: [1, 0] }
}
function pointIn(q: Prim, s: number, l: number): { p: Pt; d: Pt } {
  if (q.kind === 'line') {
    const d = unit(sub(q.to, q.from)), k = l > EPS ? s / l : 0
    return { p: [q.from[0] + (q.to[0] - q.from[0]) * k, q.from[1] + (q.to[1] - q.from[1]) * k], d }
  }
  const r = arcRadius(q), a = Math.atan2(q.from[1] - q.center[1], q.from[0] - q.center[0]) + (arcSweep(q) * (l > EPS ? s / l : 0))
  const p: Pt = [q.center[0] + r * Math.cos(a), q.center[1] + r * Math.sin(a)]
  // a clockwise arc's tangent on the y-down screen is the radius turned by +90 degrees
  const sg = q.cw ? 1 : -1
  return { p, d: [-Math.sin(a) * sg, Math.cos(a) * sg] }
}

/** Splits a path `s` mm from its start; either side may come out empty. */
export function splitPrims(prims: readonly Prim[], s: number): [Prim[], Prim[]] {
  if (s <= EPS) return [[], prims.slice()]
  let rest = s
  for (let k = 0; k < prims.length; k++) {
    const q = prims[k], l = primLength(q)
    if (rest < l - EPS) {
      const { p } = pointIn(q, rest, l)
      const a: Prim = { ...q, to: p } as Prim, b: Prim = { ...q, from: p } as Prim
      return [[...prims.slice(0, k), a], [b, ...prims.slice(k + 1)]]
    }
    rest -= l
  }
  return [prims.slice(), []]
}

/** Which primitive of `prims` draws segment `i` of `flatten(prims)`, and whether it is a line. */
export function primOfSegment(prims: readonly Prim[], i: number): { k: number; line: boolean } {
  let n = 0
  for (let k = 0; k < prims.length; k++) {
    const q = prims[k]
    const c = q.kind === 'line' ? 1 : chordCount(q)
    if (i < n + c) return { k, line: q.kind === 'line' }
    n += c
  }
  return { k: prims.length - 1, line: prims[prims.length - 1]?.kind === 'line' }
}

/** Rounds vertex i of a polyline with `radii[i] > 0` into a tangent arc; the caller keeps the tangent lengths within the segments. */
export function fillet(pts: readonly Pt[], radii: readonly number[]): Prim[] {
  const n = pts.length
  if (n < 2) return []
  const out: Prim[] = []
  let prev = pts[0]
  for (let i = 1; i < n - 1; i++) {
    const r = radii[i] ?? 0
    const d1 = unit(sub(pts[i], pts[i - 1])), d2 = unit(sub(pts[i + 1], pts[i]))
    const th = turnOf(d1, d2)
    if (!(r > EPS) || Math.abs(th) < 1e-9) { if (dist(prev, pts[i]) > EPS) out.push({ kind: 'line', from: prev, to: pts[i] }); prev = pts[i]; continue }
    const t = r * Math.tan(Math.abs(th) / 2)
    const A: Pt = [pts[i][0] - d1[0] * t, pts[i][1] - d1[1] * t], B: Pt = [pts[i][0] + d2[0] * t, pts[i][1] + d2[1] * t]
    // the centre is on the inside of the turn
    const sg = th > 0 ? 1 : -1, nl: Pt = [d1[1] * sg, -d1[0] * sg]
    const center: Pt = [A[0] + nl[0] * r, A[1] + nl[1] * r]
    if (dist(prev, A) > EPS) out.push({ kind: 'line', from: prev, to: A })
    out.push({ kind: 'arc', from: A, to: B, center, cw: th < 0 })
    prev = B
  }
  if (dist(prev, pts[n - 1]) > EPS) out.push({ kind: 'line', from: prev, to: pts[n - 1] })
  return out
}

/** What a corner becomes: an arc of radius `r` on the line through it, a 45 degree chamfer cutting `c` mm off each side, or sharp. */
export type CornerPlan = { kind: 'arc'; r: number } | { kind: 'chamfer'; c: number } | { kind: 'sharp' }

export interface CornerOptions {
  /** the radius wanted on the line through the corner, mm */
  want: number
  /** the smallest radius before a chamfer: the track width, and for a pair the half pitch plus half the width */
  min: number
  /** how far the arc may reach back along the incoming segment and on along the outgoing one, mm */
  availIn: number
  availOut: number
  /** the sideways offsets of the tracks that follow the line, 0 for a single track, +h and -h for a pair, left positive */
  offsets: number[]
  /** true when track k may take the polyline `pts`, its arc or chamfer; absent, every corner is free */
  free?: (k: number, pts: Pt[]) => boolean
}

/** The plan for corner a, v, b: an arc of `want` if it fits and is free, else smaller down to `min` in fifths, else a 45 degree chamfer, else sharp. */
export function planCorner(a: Pt, v: Pt, b: Pt, o: CornerOptions): CornerPlan {
  const d1 = unit(sub(v, a)), d2 = unit(sub(b, v)), th = turnOf(d1, d2)
  if (Math.abs(th) < 1e-6 || !(o.want > EPS)) return { kind: 'sharp' }
  const tn = Math.tan(Math.abs(th) / 2), avail = Math.min(o.availIn, o.availOut)
  const sg = th > 0 ? 1 : -1
  // only the innermost track moves towards other copper; an outer one moves towards its partner, which follows it
  const inner = Math.max(...o.offsets.map(s => s * sg))
  const tested = (s: number) => s * sg >= inner - 1e-12
  let r = Math.min(o.want, avail / tn)
  for (; r >= o.min - 1e-9; r = r > o.min + 1e-9 ? Math.max(o.min, r * 0.8) : -1) {
    if (!o.free || o.offsets.every((s, k) => !tested(s) || o.free!(k, arcPts(v, d1, d2, th, r, r - s * sg)))) return { kind: 'arc', r }
  }
  // a chamfer as long as the wanted arc would cut, within the segments less the tracks' vertex shifts
  const maxOff = Math.max(0, ...o.offsets.map(Math.abs))
  const c = Math.min(avail - maxOff * Math.tan(Math.abs(th) / 4), o.want * tn)
  // the inner track's chamfer piece must keep a length: 2 c sin(turn / 2) less its two vertex shifts
  if (c > Math.max(0.01, (maxOff * Math.tan(Math.abs(th) / 4)) / Math.sin(Math.abs(th) / 2) + 0.005)) {
    const p0: Pt = [v[0] - d1[0] * c, v[1] - d1[1] * c], p1: Pt = [v[0] + d2[0] * c, v[1] + d2[1] * c]
    if (!o.free || o.offsets.every((s, k) => !tested(s) || o.free!(k, offsetLine([a, p0, p1, b], s).slice(1, 3)))) return { kind: 'chamfer', c }
  }
  return { kind: 'sharp' }
}

/** The flattened arc of a track at radius `rt` about the centre of the line's fillet of radius `r` at v. */
function arcPts(v: Pt, d1: Pt, d2: Pt, th: number, r: number, rt: number): Pt[] {
  const t = r * Math.tan(Math.abs(th) / 2), sg = th > 0 ? 1 : -1
  const A: Pt = [v[0] - d1[0] * t, v[1] - d1[1] * t], nl: Pt = [d1[1] * sg, -d1[0] * sg]
  const c: Pt = [A[0] + nl[0] * r, A[1] + nl[1] * r]
  const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]), sweep = -th
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / STEP))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) { const ang = a0 + (sweep * i) / n; out.push([c[0] + rt * Math.cos(ang), c[1] + rt * Math.sin(ang)]) }
  return out
}

/** A polyline offset sideways by s, left positive, mitred. */
function offsetLine(pts: Pt[], s: number): Pt[] {
  if (Math.abs(s) < EPS) return pts.slice()
  const n = pts.length, d: Pt[] = []
  for (let i = 0; i < n - 1; i++) d.push(unit(sub(pts[i + 1], pts[i])))
  const ln = (q: Pt): Pt => [q[1], -q[0]]
  const out: Pt[] = [[pts[0][0] + ln(d[0])[0] * s, pts[0][1] + ln(d[0])[1] * s]]
  for (let i = 1; i < n - 1; i++) {
    const n1 = ln(d[i - 1]), n2 = ln(d[i]), k = s / (1 + n1[0] * n2[0] + n1[1] * n2[1])
    out.push([pts[i][0] + (n1[0] + n2[0]) * k, pts[i][1] + (n1[1] + n2[1]) * k])
  }
  out.push([pts[n - 1][0] + ln(d[n - 2])[0] * s, pts[n - 1][1] + ln(d[n - 2])[1] * s])
  return out
}

/** Applies corner plans to a polyline: a chamfer becomes two vertices, an arc keeps its vertex. Returns the polyline and each vertex radius. */
export function applyPlans(pts: readonly Pt[], plans: readonly (CornerPlan | null)[]): { pts: Pt[]; radii: number[] } {
  const out: Pt[] = [], radii: number[] = []
  pts.forEach((p, i) => {
    const pl = plans[i]
    if (!pl || pl.kind === 'sharp' || i === 0 || i === pts.length - 1) { out.push(p); radii.push(0); return }
    if (pl.kind === 'arc') { out.push(p); radii.push(pl.r); return }
    const d1 = unit(sub(p, pts[i - 1])), d2 = unit(sub(pts[i + 1], p))
    out.push([p[0] - d1[0] * pl.c, p[1] - d1[1] * pl.c], [p[0] + d2[0] * pl.c, p[1] + d2[1] * pl.c]); radii.push(0, 0)
  })
  return { pts: out, radii }
}

/** Rounds every point of a path to 1e-6 mm, as the router's items are. */
export function roundPrims(prims: readonly Prim[]): Prim[] {
  const nm = (v: number) => Math.round(v * 1e6) / 1e6
  const r = (p: Pt): Pt => [nm(p[0]), nm(p[1])]
  return prims.map(p => (p.kind === 'line' ? { kind: 'line', from: r(p.from), to: r(p.to) } : { kind: 'arc', from: r(p.from), to: r(p.to), center: r(p.center), cw: p.cw }))
}

/** A track's geometry from its primitives: the flattened polyline, and the primitives only when one is an arc. */
export function trackShape(prims: readonly Prim[]): { pts: Pt[]; prims?: Prim[] } {
  const ps = roundPrims(tidyPrims(prims))
  return anyArc(ps) ? { pts: flatten(ps), prims: ps } : { pts: flatten(ps) }
}
