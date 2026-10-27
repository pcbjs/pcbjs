// Board mm, y down. P runs left of the direction of travel, N right; left of d is the normal [dy, -dx].
import type { Prim, Pt } from '@pcbjs/core/model'
import { applyPlans, fillet, linesOf, planCorner, pointAt, primLength, primsLength, reversePrims, splitPrims, tidyPrims } from './round.js'

const EPS = 1e-9

export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
export const scale = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k]
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
/** The z component of a x b. Its sign is not the turn direction on a y-down screen; use `turn` for that. */
export const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
export function unit(a: Pt): Pt { const l = Math.hypot(a[0], a[1]); return l < EPS ? [0, 0] : [a[0] / l, a[1] / l] }
export const leftNormal = (d: Pt): Pt => [d[1], -d[0]]
/** Signed turn angle in radians from direction d1 to d2, positive for a left turn on a y-down screen. */
export function turn(d1: Pt, d2: Pt): number { return Math.atan2(dot(d2, leftNormal(d1)), dot(d1, d2)) }

export function polylineLength(pts: Pt[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i])
  return s
}

/** Removes repeated points and the middle vertex of straight runs. */
export function cleanPolyline(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    if (out.length && dist(out[out.length - 1], p) < EPS) continue
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1]
      const u = sub(b, a), v = sub(p, b)
      if (Math.abs(cross(u, v)) < 1e-9 * Math.hypot(...u) * Math.hypot(...v) + 1e-12 && dot(u, v) > 0) { out[out.length - 1] = p; continue }
    }
    out.push(p)
  }
  return out
}

/** Offsets a polyline by `s` mm, positive to the left, with mitred corners; `fitCentre` first rules out reversed segments. */
export function offsetPolyline(pts: Pt[], s: number): Pt[] {
  const n = pts.length
  if (n < 2) return pts.map(p => [p[0], p[1]] as Pt)
  const d: Pt[] = []
  for (let i = 0; i < n - 1; i++) d.push(unit(sub(pts[i + 1], pts[i])))
  const out: Pt[] = [add(pts[0], scale(leftNormal(d[0]), s))]
  for (let i = 1; i < n - 1; i++) {
    const n1 = leftNormal(d[i - 1]), n2 = leftNormal(d[i])
    const k = s / (1 + dot(n1, n2))
    out.push(add(pts[i], scale(add(n1, n2), k)))
  }
  out.push(add(pts[n - 1], scale(leftNormal(d[n - 2]), s)))
  return out
}

/** L - s tan(t0 / 2) - s tan(t1 / 2) per segment; negative means the offset segment runs backwards. */
export function offsetSegmentLengths(pts: Pt[], s: number): number[] {
  const n = pts.length
  const d: Pt[] = [], L: number[] = []
  for (let i = 0; i < n - 1; i++) { d.push(unit(sub(pts[i + 1], pts[i]))); L.push(dist(pts[i], pts[i + 1])) }
  const tr = (i: number) => (i <= 0 || i >= n - 1 ? 0 : Math.tan(turn(d[i - 1], d[i]) / 2))
  return L.map((l, j) => l - s * tr(j) - s * tr(j + 1))
}

/** A centre line that cannot carry the pair, such as a U turn narrower than the pitch. */
export class PairGeometryError extends Error {
  constructor(message: string, public at: Pt) { super(message); this.name = 'PairGeometryError' }
}

const fmt = (p: Pt) => `(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`

/** Makes a centre line safe to offset by `h` both ways: drops short end segments and merges bends too close together. */
export function fitCentre(centre: Pt[], h: number): Pt[] {
  let pts = cleanPolyline(centre)
  for (let guard = 0; guard < 4 * centre.length + 8; guard++) {
    if (pts.length < 2) throw new PairGeometryError('the pair centre line collapsed while fitting its bends', centre[0])
    for (let i = 1; i < pts.length - 1; i++) {
      const t = turn(unit(sub(pts[i], pts[i - 1])), unit(sub(pts[i + 1], pts[i])))
      if (Math.abs(t) > Math.PI * 0.75 + 1e-6) throw new PairGeometryError(`the pair centre line turns by more than 135 degrees at ${fmt(pts[i])}`, pts[i])
    }
    const lp = offsetSegmentLengths(pts, h), ln = offsetSegmentLengths(pts, -h)
    let j = -1
    for (let k = 0; k < lp.length; k++) if (Math.min(lp[k], ln[k]) < -1e-9) { j = k; break }
    if (j < 0) return pts
    const last = pts.length - 2
    if (j === 0 && j === last) return pts
    if (j === 0) { pts = pts.slice(1); continue }
    if (j === last) { pts = pts.slice(0, -1); continue }
    // merge the bends at pts[j] and pts[j + 1] where segments j - 1 and j + 1 cross
    const a = pts[j], b = pts[j + 1]
    const d0 = unit(sub(a, pts[j - 1])), d2 = unit(sub(pts[j + 2], b))
    const den = cross(d0, d2)
    if (Math.abs(den) < 1e-9) throw new PairGeometryError(`the pair cannot turn back at ${fmt(a)}: the U turn is ${dist(a, b).toFixed(3)} mm wide, narrower than the pitch ${(2 * h).toFixed(3)} mm`, a)
    // a + u d0 = b + v d2
    const ab = sub(b, a)
    const u = cross(ab, d2) / den, v = cross(ab, d0) / den
    const x = add(a, scale(d0, u))
    if (u <= -dist(a, pts[j - 1]) + EPS || v >= dist(b, pts[j + 2]) - EPS)
      throw new PairGeometryError(`the bends of the pair centre line at ${fmt(a)} and ${fmt(b)} are too close for the pitch ${(2 * h).toFixed(3)} mm`, a)
    pts = cleanPolyline([...pts.slice(0, j), x, ...pts.slice(j + 2)])
  }
  throw new PairGeometryError('the pair centre line could not be fitted to its pitch', centre[0])
}

/** Cuts `t` mm off the start, or the end with `fromEnd`; throws when the polyline is not longer. */
export function cutPolyline(pts: Pt[], t: number, fromEnd = false): Pt[] {
  if (t <= EPS) return pts.slice()
  const src = fromEnd ? pts.slice().reverse() : pts
  let rest = t
  for (let i = 0; i < src.length - 1; i++) {
    const l = dist(src[i], src[i + 1])
    if (rest < l - EPS) {
      const p = add(src[i], scale(unit(sub(src[i + 1], src[i])), rest))
      const out = [p, ...src.slice(i + 1)]
      return fromEnd ? out.reverse() : out
    }
    rest -= l
  }
  throw new PairGeometryError(`the pair centre line is too short for a fan of ${t.toFixed(3)} mm`, pts[fromEnd ? pts.length - 1 : 0])
}

export interface PairEnd {
  /** from the pads' midpoint along the centre line, mm */
  advance: number
  coupled: Pt
  P: Pt
  N: Pt
  /** both fan segments, mm */
  uncoupled: number
  /** P's pad is on the right, so the fan segments cross */
  crossed: boolean
}

/** The fan at one end: the smallest advance that keeps each fan segment at 45 degrees or shallower, from `origin`. */
export function pairEnds(padP: Pt, padN: Pt, dir: Pt, pitch: number, at: 'start' | 'end' = 'start', origin?: Pt): PairEnd {
  const d = unit(dir), n = leftNormal(d), u = at === 'start' ? d : scale(d, -1), h = pitch / 2
  const mid = origin ?? scale(add(padP, padN), 0.5)
  let adv = 0
  for (const [pad, sgn] of [[padP, 1], [padN, -1]] as [Pt, number][]) {
    const r = sub(pad, mid)
    adv = Math.max(adv, Math.abs(dot(r, n) - sgn * h) + dot(r, u))
  }
  const coupled = add(mid, scale(u, adv))
  const P = add(coupled, scale(n, h)), N = add(coupled, scale(n, -h))
  return { advance: adv, coupled, P, N, uncoupled: dist(padP, P) + dist(padN, N), crossed: dot(sub(padP, padN), n) < -EPS }
}

export interface PairVias {
  /** centre to centre, max(pitch, viaSize + clearance) */
  spacing: number
  P: Pt
  N: Pt
  before: PairEnd
  after: PairEnd
}

/** Two vias across the bend's bisector, P on the left, so the fans mirror and neither track passes the other's via. */
export function pairVias(at: Pt, dIn: Pt, dOut: Pt, pitch: number, viaSize: number, clearance: number): PairVias {
  const spacing = Math.max(pitch, viaSize + clearance)
  const n = unit(add(leftNormal(unit(dIn)), leftNormal(unit(dOut))))
  const P = add(at, scale(n, spacing / 2)), N = add(at, scale(n, -spacing / 2))
  return { spacing, P, N, before: pairEnds(P, N, dIn, pitch, 'end'), after: pairEnds(P, N, dOut, pitch, 'start') }
}

/** The staggered vias of a crossover, so P and N cross only where they are on different layers; `pSide` +1 for P on the left. */
export function crossVias(at: Pt, dOut: Pt, pitch: number, w: number, viaSize: number, clearance: number, pSide: 1 | -1): { P: Pt; N: Pt; before: number; after: number } {
  const n = leftNormal(unit(dOut)), h = pitch / 2
  const e = Math.max(0, viaSize / 2 + w / 2 + clearance - pitch)
  const H = h + e
  const s = Math.max(viaSize + clearance, Math.SQRT2 * (viaSize / 2 + w / 2 + clearance), pitch + e)
  const P = add(at, scale(n, pSide * H))
  return { P, N: add(P, scale(unit(dOut), s)), before: e, after: 0 }
}

export function pairLengths(P: Pt[], N: Pt[]): { P: number; N: number; skew: number } {
  const lp = polylineLength(P), ln = polylineLength(N)
  return { P: lp, N: ln, skew: Math.abs(lp - ln) }
}

export interface OffsetPairOptions {
  /** pad centres [P, N]; the tracks then start at the pads with a fan in */
  startPads?: [Pt, Pt]
  endPads?: [Pt, Pt]
  /** interior vertices where the pair changes layer */
  vias?: number[]
  /** default 0, which spaces the vias at the pitch */
  viaSize?: number
  /** between the two vias; default 0 */
  clearance?: number
}

export interface OffsetPair {
  P: Pt[]
  N: Pt[]
  /** split at the vias, run k on the layer of section k */
  runsP: Pt[][]
  runsN: Pt[][]
  viasP: Pt[]
  viasN: Pt[]
  /** pad fans, both tracks, mm */
  uncoupled: number
  /** fans at bend via pairs, both tracks, mm; straight flares not counted */
  viaUncoupled: number
  lengthP: number
  lengthN: number
  skew: number
  /** per section, after fans and tight bends were cut */
  centre: Pt[][]
}

/** The pair with sharp corners: `w` track width, `g` gap edge to edge; throws a PairGeometryError when the centre line cannot carry it. */
export function offsetPair(centre: Pt[], w: number, g: number, opts: OffsetPairOptions = {}): OffsetPair {
  const pitch = w + g, h = pitch / 2
  const cuts = [...new Set(opts.vias ?? [])].sort((a, b) => a - b)
  for (const v of cuts) if (!(v > 0 && v < centre.length - 1)) throw new PairGeometryError(`via index ${v} is not an interior vertex of the pair centre line`, centre[0])
  const bounds = [0, ...cuts, centre.length - 1]
  const sections = bounds.slice(0, -1).map((b, k) => cleanPolyline(centre.slice(b, bounds[k + 1] + 1)))
  for (const s of sections) if (s.length < 2) throw new PairGeometryError('a section of the pair centre line has no length', s[0] ?? centre[0])
  const firstDir = (s: Pt[]) => unit(sub(s[1], s[0]))
  const lastDir = (s: Pt[]) => unit(sub(s[s.length - 1], s[s.length - 2]))
  const viaSize = opts.viaSize ?? 0, clearance = opts.clearance ?? 0
  const vias = cuts.map((_, k) => pairVias(sections[k][sections[k].length - 1], lastDir(sections[k]), firstDir(sections[k + 1]), pitch, viaSize, clearance))
  const startEnd = opts.startPads ? pairEnds(opts.startPads[0], opts.startPads[1], firstDir(sections[0]), pitch, 'start', sections[0][0]) : null
  const last = sections.length - 1
  const ls = sections[last]
  const endEnd = opts.endPads ? pairEnds(opts.endPads[0], opts.endPads[1], lastDir(ls), pitch, 'end', ls[ls.length - 1]) : null
  const fitted = sections.map((s, k) => {
    const head = k === 0 ? startEnd?.advance ?? 0 : vias[k - 1].after.advance
    const tail = k === last ? endEnd?.advance ?? 0 : vias[k].before.advance
    let c = cutPolyline(s, head)
    c = cutPolyline(c, tail, true)
    return fitCentre(c, h)
  })
  const runsP: Pt[][] = [], runsN: Pt[][] = []
  let viaUncoupled = 0, uncoupled = 0
  fitted.forEach((c, k) => {
    const p = offsetPolyline(c, h), n = offsetPolyline(c, -h)
    const headP = k === 0 ? opts.startPads?.[0] : vias[k - 1].P, headN = k === 0 ? opts.startPads?.[1] : vias[k - 1].N
    const tailP = k === last ? opts.endPads?.[0] : vias[k].P, tailN = k === last ? opts.endPads?.[1] : vias[k].N
    if (k === 0 && headP && headN) uncoupled += dist(headP, p[0]) + dist(headN, n[0])
    if (k === last && tailP && tailN) uncoupled += dist(tailP, p[p.length - 1]) + dist(tailN, n[n.length - 1])
    if (k > 0) {
      const v = vias[k - 1], straight = Math.abs(turn(lastDir(sections[k - 1]), firstDir(sections[k]))) < 1e-6
      const before = runsP[k - 1], beforeN = runsN[k - 1]
      if (!straight) viaUncoupled += dist(v.P, p[0]) + dist(v.N, n[0]) + dist(v.P, before[before.length - 2]) + dist(v.N, beforeN[beforeN.length - 2])
    }
    runsP.push(cleanPolyline([...(headP ? [headP] : []), ...p, ...(tailP ? [tailP] : [])]))
    runsN.push(cleanPolyline([...(headN ? [headN] : []), ...n, ...(tailN ? [tailN] : [])]))
  })
  const P = runsP.reduce<Pt[]>((acc, r) => acc.concat(acc.length ? r.slice(1) : r), [])
  const N = runsN.reduce<Pt[]>((acc, r) => acc.concat(acc.length ? r.slice(1) : r), [])
  const lens = pairLengths(P, N)
  return { P, N, runsP, runsN, viasP: vias.map(v => v.P), viasN: vias.map(v => v.N), uncoupled, viaUncoupled, lengthP: lens.P, lengthN: lens.N, skew: lens.skew, centre: fitted }
}

export interface PairPathOptions extends OffsetPairOptions {
  /** per vertex corner radius on the centre line, 0 for sharp */
  radii?: number[]
  /** below it a corner is chamfered; never below half the pitch, where the inner track turns sharp */
  minRadius?: number
  /** whether track 0 (P) or 1 (N) may take a corner's polyline on section k's layer */
  free?: (k: number, track: 0 | 1, pts: Pt[]) => boolean
  /** mm, default the width, so a fan is never a step narrower than the track */
  minFan?: number
  /** indices into `vias` where P and N swap sides */
  crosses?: number[]
  /** for the crossover stagger; default pitch / 2 */
  width?: number
}

/** Lengths in mm, arcs along the arc. */
export interface PairPaths {
  /** run k on the layer of section k */
  runsP: Prim[][]
  runsN: Prim[][]
  viasP: Pt[]
  viasN: Pt[]
  /** fans and flares, both tracks, with the stretch one track runs before the other joins */
  uncoupled: number
  lengthP: number
  lengthN: number
  /** per section, chamfers in, with each vertex's radius */
  centre: Pt[][]
  radii: number[][]
}

const key = (p: Pt) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`
const rot = (d: Pt, a: number): Pt => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)]

/** Where a fan from `E` along `d` joins track `O` within 45 degrees, then 67.5 and 90; `s` is negative on O's back extension. */
export function joinFan(E: Pt, d: Pt, O: Prim[], minFan: number, reach: number): { prims: Prim[]; s: number; fan: number } {
  const start = O[0].from, t0 = pointAt(O, 0).d
  const Oe: Prim[] = [{ kind: 'line', from: sub(start, scale(t0, reach)), to: start }, ...O]
  const lim = Math.min(primsLength(Oe), 3 * reach + 4 * dist(E, start) + 1)
  for (const maxA of [Math.PI / 4, (3 * Math.PI) / 8, Math.PI / 2]) {
    const cA = Math.cos(maxA)
    const ok = (p: Pt, t: Pt): boolean => {
      const v = sub(p, E), l = Math.hypot(v[0], v[1])
      if (l < 1e-7) return true
      const u = scale(v, 1 / l)
      if (dot(u, d) < cA - 1e-7) return false
      if (Math.abs(turn(u, t)) > Math.PI / 4 + 1e-7) return false
      // a fan shorter than minFan only where both its bends are under 8 degrees
      const small = (8 * Math.PI) / 180
      return l >= minFan - 1e-7 || Math.abs(cross(v, d)) < 1e-7 || (Math.acos(Math.min(1, dot(u, d))) <= small && Math.abs(turn(u, t)) <= small)
    }
    let s0 = 0, found = -1
    for (const q of Oe) {
      if (s0 > lim) break
      const len = primLength(q)
      if (q.kind === 'line') {
        const t = unit(sub(q.to, q.from)), P0 = q.from
        const cands: number[] = [0]
        for (const r of [d, rot(d, maxA), rot(d, -maxA), rot(t, Math.PI / 4), rot(t, -Math.PI / 4)]) {
          const den = cross(t, r)
          if (Math.abs(den) < 1e-12) continue
          const mu = cross(sub(E, P0), r) / den, lam = cross(sub(E, P0), t) / den
          if (lam > -1e-9) cands.push(mu)
        }
        const bq = dot(sub(P0, E), t), c = dot(sub(P0, E), sub(P0, E)) - minFan * minFan, disc = bq * bq - c
        if (disc >= 0) cands.push(-bq - Math.sqrt(disc), -bq + Math.sqrt(disc))
        const at = cands.filter(m => m >= -1e-9 && m <= len + 1e-9).map(m => Math.min(len, Math.max(0, m))).sort((x, y) => x - y)
        for (const m of at) if (ok(add(P0, scale(t, m)), t)) { found = s0 + m; break }
      } else {
        const n = Math.max(2, Math.ceil(len / 0.01))
        let prev = -1
        for (let i = 0; i <= n; i++) {
          const m = (len * i) / n, { p, d: t } = pointAt([q], m)
          if (ok(p, t)) {
            let lo = prev, hi = m
            if (lo >= 0) for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2, x = pointAt([q], mid); if (ok(x.p, x.d)) hi = mid; else lo = mid }
            found = s0 + hi
            break
          }
          prev = m
        }
      }
      if (found >= 0) break
      s0 += len
    }
    if (found < 0) continue
    // a join just before an arc moves into it, so the track never kinks both ways within a track width
    {
      let acc = 0, arc: { s: number; q: Prim } | null = null
      for (const q of Oe) { const l = primLength(q); if (acc + l > found + 1e-9 && q.kind === 'arc' && acc - found < minFan) { arc = { s: Math.max(acc, found), q }; break } if (acc > found + minFan) break; acc += l }
      if (arc) {
        const here = pointAt(Oe, found), t0 = Math.abs(turn(unit(sub(here.p, E)), here.d))
        let best = { s: found, tr: Number.isFinite(t0) ? t0 : Math.PI }
        const qs = acc, al = primLength(arc.q), n = Math.max(8, Math.ceil(al / 0.005))
        for (let i = 0; i <= n; i++) {
          const m = (al * i) / n
          if (qs + m < found) continue
          const { p, d: tt } = pointAt([arc.q], m)
          if (!ok(p, tt)) continue
          const tr = Math.abs(turn(unit(sub(p, E)), tt))
          if (tr < best.tr - 1e-6) best = { s: qs + m, tr }
        }
        found = best.s
      }
    }
    const X = pointAt(Oe, found).p
    const [, rest] = splitPrims(Oe, found)
    return { prims: tidyPrims([...linesOf([E, X]), ...rest]), s: found - reach, fan: dist(E, X) }
  }
  return { prims: tidyPrims([...linesOf([E, start]), ...O]), s: 0, fan: dist(E, start) }
}

/** Drops the larger radius where a track's two corners do not fit its stretch, so no track runs backwards between them. */
function settle(c: Pt[], radii: number[], h: number): number[] {
  const n = c.length, r = radii.slice()
  const th = c.map((_, i) => (i > 0 && i < n - 1 ? turn(unit(sub(c[i], c[i - 1])), unit(sub(c[i + 1], c[i]))) : 0))
  for (let guard = 0; guard < 2 * n; guard++) {
    let bad = -1
    for (const s of [h, -h]) {
      const off = offsetSegmentLengths(c, s)
      for (let j = 0; j + 1 < n && bad < 0; j++) {
        const t = (i: number) => (r[i] > 0 ? (r[i] - s * Math.sign(th[i])) * Math.tan(Math.abs(th[i]) / 2) : 0)
        if (off[j] - t(j) - t(j + 1) < -1e-9) bad = r[j] >= r[j + 1] ? j : j + 1
      }
      if (bad >= 0) break
    }
    if (bad < 0) return r
    r[bad] = 0
  }
  return r
}

/** `offsetPair` with concentric rounded corners and `joinFan` fans, the layout the router places. */
export function pairPaths(centre: Pt[], w: number, g: number, opts: PairPathOptions = {}): PairPaths {
  const pitch = w + g, h = pitch / 2
  const cuts = [...new Set(opts.vias ?? [])].sort((a, b) => a - b)
  for (const v of cuts) if (!(v > 0 && v < centre.length - 1)) throw new PairGeometryError(`via index ${v} is not an interior vertex of the pair centre line`, centre[0])
  const bounds = [0, ...cuts, centre.length - 1]
  const sections = bounds.slice(0, -1).map((b, k) => cleanPolyline(centre.slice(b, bounds[k + 1] + 1)))
  for (const s of sections) if (s.length < 2) throw new PairGeometryError('a section of the pair centre line has no length', s[0] ?? centre[0])
  const firstDir = (s: Pt[]) => unit(sub(s[1], s[0]))
  const lastDir = (s: Pt[]) => unit(sub(s[s.length - 1], s[s.length - 2]))
  const viaSize = opts.viaSize ?? 0, clearance = opts.clearance ?? 0
  const crossSet = new Set(opts.crosses ?? [])
  const flips: boolean[] = []
  sections.forEach((_, k) => flips.push(k > 0 && (flips[k - 1] !== crossSet.has(k - 1))))
  const vias = cuts.map((_, k) => {
    const at = sections[k][sections[k].length - 1], dIn = lastDir(sections[k]), dOut = firstDir(sections[k + 1])
    if (crossSet.has(k)) {
      const x = crossVias(at, dOut, pitch, opts.width ?? pitch / 2, viaSize, clearance, flips[k] ? -1 : 1)
      return { P: x.P, N: x.N, before: x.before, after: x.after }
    }
    const v = pairVias(at, dIn, dOut, pitch, viaSize, clearance)
    return flips[k] ? { P: v.N, N: v.P, before: v.before.advance, after: v.after.advance } : { P: v.P, N: v.N, before: v.before.advance, after: v.after.advance }
  })
  const startEnd = opts.startPads ? pairEnds(opts.startPads[0], opts.startPads[1], firstDir(sections[0]), pitch, 'start', sections[0][0]) : null
  const last = sections.length - 1
  const ls = sections[last]
  const endEnd = opts.endPads ? (flips[last] ? pairEnds(opts.endPads[1], opts.endPads[0], lastDir(ls), pitch, 'end', ls[ls.length - 1]) : pairEnds(opts.endPads[0], opts.endPads[1], lastDir(ls), pitch, 'end', ls[ls.length - 1])) : null
  const want = new Map<string, number>()
  centre.forEach((p, i) => { const r = opts.radii?.[i] ?? 0; if (r > 0) want.set(key(p), r) })
  const rmin = opts.minRadius ?? Math.max(w, h), minFan = opts.minFan ?? w
  const fitted = sections.map((s, k) => {
    const head = k === 0 ? startEnd?.advance ?? 0 : vias[k - 1].after
    const tail = k === last ? endEnd?.advance ?? 0 : vias[k].before
    let c = cutPolyline(s, head)
    c = cutPolyline(c, tail, true)
    return fitCentre(c, h)
  })
  // fitted again in case a chamfer left the inner track no room
  const rounded = fitted.map((c, k) => {
    const n = c.length
    const wants = c.map((p, i) => (i > 0 && i < n - 1 ? want.get(key(p)) ?? 0 : 0))
    if (!wants.some(r => r > 0)) return { c, radii: wants }
    const th = c.map((_, i) => (i > 0 && i < n - 1 ? Math.abs(turn(unit(sub(c[i], c[i - 1])), unit(sub(c[i + 1], c[i])))) : 0))
    // all of a segment next to an end, half next to a rounded corner, else all but the inner track's shift
    const budget = (i: number, j: number) => {
      const L = dist(c[i], c[j])
      if (j === 0 || j === n - 1) return L
      return wants[j] > 0 ? L / 2 : L - h * Math.tan(th[j] / 2)
    }
    const plans = c.map((p, i) => (wants[i] > 0 ? planCorner(c[i - 1], p, c[i + 1], {
      want: wants[i], min: rmin, availIn: budget(i, i - 1), availOut: budget(i, i + 1), offsets: [h, -h],
      ...(opts.free ? { free: (t: number, pts: Pt[]) => opts.free!(k, (flips[k] ? 1 - t : t) as 0 | 1, pts) } : {}),
    }) : null))
    const a = applyPlans(c, plans)
    let f = a.pts, radii = a.radii
    if (a.pts.length !== c.length) {
      const keep = new Map(a.pts.map((p, i) => [key(p), a.radii[i]] as const))
      try { f = fitCentre(a.pts, h); radii = f.map(p => keep.get(key(p)) ?? 0) } catch { f = c; radii = c.map((_, i) => (plans[i]?.kind === 'arc' ? (plans[i] as { r: number }).r : 0)) }
    }
    return { c: f, radii: settle(f, radii, h) }
  })
  const runsP: Prim[][] = [], runsN: Prim[][] = []
  let uncoupled = 0
  rounded.forEach(({ c, radii }, k) => {
    const sg = c.map((_, i) => (i > 0 && i < c.length - 1 ? Math.sign(turn(unit(sub(c[i], c[i - 1])), unit(sub(c[i + 1], c[i])))) : 0))
    let O: Prim[][] = [h, -h].map(s => fillet(offsetPolyline(c, s), radii.map((r, i) => (r > 0 ? r - s * sg[i] : 0))))
    // P, N turned to offset order, left first
    const byOffset = (e: [Pt, Pt] | undefined): [Pt, Pt] | undefined => (e && flips[k] ? [e[1], e[0]] : e)
    const headE = byOffset(k === 0 ? opts.startPads : [vias[k - 1].P, vias[k - 1].N])
    const tailE = byOffset(k === last ? opts.endPads : [vias[k].P, vias[k].N])
    const reachOf = (E: Pt, p: Pt) => 2 * dist(E, p) + 2 * pitch
    if (headE) {
      const d = firstDir(sections[k])
      const j = O.map((o, t) => joinFan(headE[t], d, o, minFan, reachOf(headE[t], o[0].from)))
      uncoupled += j[0].fan + j[1].fan + Math.abs(j[0].s - j[1].s)
      O = j.map(x => x.prims)
    }
    if (tailE) {
      const d = scale(lastDir(sections[k]), -1)
      const j = O.map((o, t) => { const r = reversePrims(o); return joinFan(tailE[t], d, r, minFan, reachOf(tailE[t], r[0].from)) })
      uncoupled += j[0].fan + j[1].fan + Math.abs(j[0].s - j[1].s)
      O = j.map(x => reversePrims(x.prims))
    }
    runsP.push(flips[k] ? O[1] : O[0]); runsN.push(flips[k] ? O[0] : O[1])
  })
  const lengthP = runsP.reduce((s, r) => s + primsLength(r), 0), lengthN = runsN.reduce((s, r) => s + primsLength(r), 0)
  return { runsP, runsN, viasP: vias.map(v => v.P), viasN: vias.map(v => v.N), uncoupled, lengthP, lengthN, centre: rounded.map(r => r.c), radii: rounded.map(r => r.radii) }
}
