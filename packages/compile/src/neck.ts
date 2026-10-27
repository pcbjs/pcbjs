// Neck-down at pads, where a route is wider than its pad or too close to its neighbours at full width. Board mm, y down.
import type { Pad, Prim, Pt } from '@pcbjs/core/model'
import type { IsFree } from './length.js'
import { primsLength, splitPrims, tidyPrims } from './round.js'

/** The neck of one route: its narrow width and longest length, mm. */
export interface Neck { width: number; length: number }

/** Default longest neck, mm. */
export const NECK_LENGTH = 2
/** Sample step along a track when looking for the end of a neck, mm. */
const STEP = 0.05
const EPS = 1e-9

/** The smaller side of a pad, mm. */
export const padMinor = (pad: Pad): number => Math.min(pad.size[0], pad.size[1])

/** The neck of a route at a pad, clamped to `minWidth` and `width`; null when off or no narrower than the route. */
export function neckOf(pad: Pad | null, width: number, minWidth: number, spec?: { width?: number; length?: number }): Neck | null {
  const length = spec?.length ?? NECK_LENGTH
  if (!(length > EPS)) return null
  const w = Math.min(width, Math.max(minWidth, spec?.width ?? (pad ? Math.min(padMinor(pad), width) : width)))
  return w < width - EPS ? { width: w, length } : null
}

/** The pad's long axis as a unit vector, rotation counter-clockwise on screen. */
export function padAxis(pad: Pad): Pt {
  const t = (pad.rot * Math.PI) / 180
  const [x, y]: Pt = pad.size[0] >= pad.size[1] ? [1, 0] : [0, 1]
  return [x * Math.cos(t) + y * Math.sin(t), -x * Math.sin(t) + y * Math.cos(t)]
}

/** How far a pad reaches from `at` along the unit direction d, mm: its polygon's furthest point. */
export function padReach(pad: Pad, at: Pt, d: Pt): number {
  let ext = 0
  for (const p of pad.poly) ext = Math.max(ext, (p[0] - at[0]) * d[0] + (p[1] - at[1]) * d[1])
  return ext
}

/** The point `s` mm along a polyline from its start, clamped to its end. */
export function pointAt(pts: Pt[], s: number): Pt {
  let rest = s
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (rest <= l || i === pts.length - 1) {
      const k = l > EPS ? Math.min(1, rest / l) : 0
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
    }
    rest -= l
  }
  return pts[pts.length - 1]
}

const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)

/** The neck length a track needs from its pad: past `inPad` and past the last point within `cap` where full width is not free. */
export function neckLength(isFree: IsFree, layer: string, pts: Pt[], net: string | undefined, width: number, cap: number, clearance: number, inPad = 0): number {
  const total = lengthOf(pts)
  const top = Math.min(cap, total)
  let last = -1
  for (let s = 0; s <= top + EPS; s += STEP) {
    const p = pointAt(pts, s)
    if (!isFree(layer, p[0], p[1], net, width)) last = s
  }
  const need = Math.max(inPad, last < 0 ? 0 : last + STEP + clearance)
  return Math.min(need, top)
}

/** Splits a polyline `t` mm from its start, or from its end, into the neck and the rest. */
export function splitAt(pts: Pt[], t: number, fromEnd = false): { neck: Pt[]; rest: Pt[] } {
  const src = fromEnd ? pts.slice().reverse() : pts
  if (t <= EPS) return { neck: [], rest: pts.slice() }
  const out: Pt[] = [src[0]]
  let rest = t, i = 1
  for (; i < src.length; i++) {
    const a = src[i - 1], b = src[i], l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (rest < l - EPS) {
      const k = rest / l, p: Pt = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
      out.push(p)
      const tail = [p, ...src.slice(i)]
      return fromEnd ? { neck: out.reverse(), rest: tail.reverse() } : { neck: out, rest: tail }
    }
    out.push(b)
    rest -= l
  }
  return fromEnd ? { neck: out.reverse(), rest: [] } : { neck: out, rest: [] }
}

const dedupe = (pts: Pt[]) => pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9)

/** A polyline with its width, one track. */
export interface WidePts { pts: Pt[]; width: number }

/** A track split into its head neck, full width middle and tail neck, end to end; empty pieces dropped. */
export function neckPieces(pts: Pt[], width: number, head: Neck | null, tail: Neck | null): WidePts[] {
  const total = lengthOf(pts)
  const h = head && head.length > EPS ? head : null, t = tail && tail.length > EPS ? tail : null
  if (!h && !t) return [{ pts, width }]
  if ((h?.length ?? 0) + (t?.length ?? 0) >= total - EPS) return [{ pts, width: Math.min(h?.width ?? width, t?.width ?? width) }]
  const a = h ? splitAt(pts, h.length) : { neck: [], rest: pts }
  const b = t ? splitAt(a.rest, t.length, true) : { neck: [], rest: a.rest }
  const out: WidePts[] = []
  const add = (q: Pt[], w: number) => { const c = dedupe(q); if (c.length >= 2) out.push({ pts: c, width: w }) }
  if (h) add(a.neck, h.width)
  add(b.rest, width)
  if (t) add(b.neck, t.width)
  return out
}

/** Directions to leave a pad by: its long axis away from the footprint centre, back, then square to it toward `toward` first. */
export function padDirections(pad: Pad, fp: Pt | undefined, toward: Pt): Pt[] {
  const ax = padAxis(pad), sq: Pt = [-ax[1], ax[0]]
  const dot = (v: Pt, d: Pt) => v[0] * d[0] + v[1] * d[1]
  const rel = (q: Pt): Pt => [q[0] - pad.at[0], q[1] - pad.at[1]]
  const out = fp ? dot(rel(fp), ax) : 0
  const a: Pt = Math.abs(out) > 1e-6 ? (out < 0 ? ax : [-ax[0], -ax[1]]) : dot(rel(toward), ax) >= 0 ? ax : [-ax[0], -ax[1]]
  const s: Pt = dot(rel(toward), sq) >= 0 ? sq : [-sq[0], -sq[1]]
  return [a, [-a[0], -a[1]], s, [-s[0], -s[1]]]
}

/** The end of a neck-width stub out of a pad to where `width`, track plus margins, is free; null when none is needed or free. */
export function neckStub(isFree: IsFree, pad: Pad, layer: string, net: string | undefined, width: number, neck: Neck, clearance: number, fp: Pt | undefined, toward: Pt): Pt | null {
  const wide = width > padMinor(pad) + EPS
  if (!wide && isFree(layer, pad.at[0], pad.at[1], net, width)) return null
  for (const d of padDirections(pad, fp, toward)) {
    const edge = padReach(pad, pad.at, d)
    const top = edge + neck.length
    let end = -1
    for (let s = 0; s <= top + EPS; s += STEP) {
      const p: Pt = [pad.at[0] + d[0] * s, pad.at[1] + d[1] * s]
      if (s > edge + EPS && !isFree(layer, p[0], p[1], net, neck.width)) break
      if (s >= edge - EPS && isFree(layer, p[0], p[1], net, width)) {
        // the full width must stay free for one more clearance past the end of the neck
        const q: Pt = [p[0] + d[0] * (clearance + STEP), p[1] + d[1] * (clearance + STEP)]
        if (isFree(layer, q[0], q[1], net, width)) { end = s + clearance + STEP; break }
      }
    }
    if (end > 0) return [pad.at[0] + d[0] * end, pad.at[1] + d[1] * end]
  }
  return null
}

/** `neckPieces` for lines and arcs, an arc cut where its neck ends. */
export function neckPrims(prims: Prim[], width: number, head: Neck | null, tail: Neck | null): { prims: Prim[]; width: number }[] {
  const total = primsLength(prims)
  const h = head && head.length > EPS ? head : null, t = tail && tail.length > EPS ? tail : null
  if (!h && !t) return [{ prims, width }]
  if ((h?.length ?? 0) + (t?.length ?? 0) >= total - EPS) return [{ prims, width: Math.min(h?.width ?? width, t?.width ?? width) }]
  const [hn, rest] = h ? splitPrims(prims, h.length) : [[], prims]
  const [mid, tn] = t ? splitPrims(rest, primsLength(rest) - t.length) : [rest, []]
  const out: { prims: Prim[]; width: number }[] = []
  const add = (q: Prim[], w: number) => { const c = tidyPrims(q); if (c.length) out.push({ prims: c, width: w }) }
  if (h) add(hn, h.width)
  add(mid, width)
  if (t) add(tn, t.width)
  return out
}
