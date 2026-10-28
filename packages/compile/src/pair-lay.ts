// Board mm, y down; the board is reached only through the IsFree tests of the context.
import type { Pad, Pt } from '@pcbjs/core/model'
import type { IsFree } from './length.js'
import type { Prim } from '@pcbjs/core/model'
import { pairPaths, PairGeometryError, cleanPolyline, turn, leftNormal, pairEnds, pairVias, type PairPaths } from './pair.js'
import { neckLength, neckOf, neckPrims, padReach, type Neck } from './neck.js'
import { flatten, linesOf, primsLength, tidyPrims } from './round.js'

export interface PairJob {
  id: string
  /** [P, N] */
  nets: [string, string]
  /** track width and gap, edge to edge */
  w: number
  g: number
  via: { drill: number; size: number }
  /** between the two vias of a via pair, copper to copper */
  clearance: number
  /** between the two nets */
  copper: number
  holeClearance: number
  minWidth: number
  /** from the start ends' midpoint to the end ends' midpoint, its via vertices and each section's layer */
  centre: Pt[]
  vias: number[]
  layers: string[]
  /** indices into `vias` the tidy may move */
  autoVias?: number[]
  /** indices into `vias` where `.cross()` swaps P and N */
  crosses?: number[]
  /** per vertex: placed by the router, so it may be tidied away */
  auto?: boolean[]
  /** per vertex corner radius, 0 for a sharp corner */
  radii?: number[]
  /** [P, N] */
  startPads: [Pt, Pt]
  endPads: [Pt, Pt]
  /** P start, N start, P end, N end, null for a coordinate end */
  pads: (Pad | null)[]
  neck?: { width?: number; length?: number }
  /** in stack order */
  copperLayers: string[]
}

/** Without a test the layout trusts the centre line. */
export interface PairContext {
  /** one track of the pair against the board's copper but this pair's */
  free?: IsFree
  /** the centre line, 2w + g wide, against the board's copper but this pair's and its pads */
  centreFree?: IsFree
  /** pads only, for the necks */
  padFree?: IsFree
}

export interface PairTrack {
  layer: string
  role: 'P' | 'N'
  pts: Pt[]
  width: number
  prims?: Prim[]
}
/** `layers` are the two section layers it joins, in centre line order. */
export interface PairVia {
  role: 'P' | 'N'
  at: Pt
  layers: [string, string]
}

/** Lengths in mm, tracks only. */
export interface PairLaid {
  /** the centre line tidied when it had to be */
  job: PairJob
  tracks: PairTrack[]
  vias: PairVia[]
  /** fans, bend vias and flares, both tracks */
  uncoupled: number
  lengthP: number
  lengthN: number
  geo: PairPaths
  /** the first point where P and N come closer than the clearance in every layout */
  clash?: Pt
}

const EPS = 1e-9
const STEP = 0.05
const unitOf = (a: Pt, b: Pt): Pt => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
}
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const lengthOf = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + d2(p, pts[i - 1]) : 0), 0)

function ptSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const o1 = o(a, b, c),
    o2 = o(a, b, d),
    o3 = o(c, d, a),
    o4 = o(c, d, b)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b))
}

/** The copper layers a via between two layers passes through. */
function spanOf(stack: string[], a: string, b: string): string[] {
  const i0 = stack.indexOf(a),
    i1 = stack.indexOf(b)
  return i0 < 0 || i1 < 0 ? [a, b] : stack.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)
}

/** Samples every STEP mm. */
function polyFree(free: IsFree, layer: string, pts: Pt[], net: string | undefined, width: number, skip?: (p: Pt) => boolean): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i],
      l = d2(a, b),
      n = Math.max(1, Math.ceil(l / STEP))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const p: Pt = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]
      if (skip?.(p)) continue
      if (!free(layer, p[0], p[1], net, width)) return false
    }
  }
  return true
}

/** Fan origins: each track runs along `d` to the far edge of both pads, so staggered pads fan past each other. */
export function edges(pads: [Pad | null, Pad | null], at: [Pt, Pt], d: Pt): [Pt, Pt] {
  const mid: Pt = [(at[0][0] + at[1][0]) / 2, (at[0][1] + at[1][1]) / 2]
  const along = (q: Pt) => (q[0] - mid[0]) * d[0] + (q[1] - mid[1]) * d[1]
  let far = -Infinity
  for (const [k, pad] of pads.entries()) if (pad) far = Math.max(far, along(at[k]) + padReach(pad, at[k], d))
  return at.map((q, k) => {
    if (!pads[k]) return q
    const t = Math.max(0, far - along(q))
    return [q[0] + d[0] * t, q[1] + d[1] * t] as Pt
  }) as [Pt, Pt]
}

/** Moves fan origins along `d`, up to `cap`, until both fans clear the pads beside them; only pads closer than the pitch fan out. */
export function fanLead(
  free: IsFree | undefined,
  layer: string,
  at: [Pt, Pt],
  d: Pt,
  pitch: number,
  mid: Pt,
  nets: [string, string],
  widths: [number, number],
  cap: number,
): [Pt, Pt] {
  const across = (at[0][0] - at[1][0]) * d[1] - (at[0][1] - at[1][1]) * d[0]
  if (!free || Math.abs(across) >= pitch - EPS) return at
  const left = across >= 0
  for (let t = 0; t <= cap + EPS; t += STEP) {
    const o: [Pt, Pt] = [
      [at[0][0] + d[0] * t, at[0][1] + d[1] * t],
      [at[1][0] + d[0] * t, at[1][1] + d[1] * t],
    ]
    const f = left ? pairEnds(o[0], o[1], d, pitch, 'start', mid) : pairEnds(o[1], o[0], d, pitch, 'start', mid)
    const ends: [Pt, Pt] = left ? [f.P, f.N] : [f.N, f.P]
    if ([0, 1].every(k => polyFree(free, layer, [o[k], ends[k]], nets[k], widths[k]))) return o
  }
  return at
}

/** Lays out the pair along the centre line exactly; throws a PairGeometryError when it cannot carry the pair. */
export function layCentre(job: PairJob, ctx: PairContext = {}): PairLaid {
  const { centre, vias, w, g } = job
  if (centre.length < 2) throw new PairGeometryError('the pair centre line has no length', job.startPads[0])
  // pairPaths puts P on the left, so a P pad on the right swaps the two; the end pads must match or the tracks cross
  const side = (pads: [Pt, Pt], a: Pt, b: Pt) => {
    const d = unitOf(a, b)
    return (pads[0][0] - pads[1][0]) * d[1] - (pads[0][1] - pads[1][1]) * d[0]
  }
  const swap = side(job.startPads, centre[0], centre[1]) < -1e-9
  const endSide = side(job.endPads, centre[centre.length - 2], centre[centre.length - 1])
  const odd = (job.crosses?.length ?? 0) % 2 === 1,
    rightAtEnd = swap !== odd
  if (rightAtEnd ? endSide > 1e-9 : endSide < -1e-9) {
    const e = centre[centre.length - 1]
    throw new PairGeometryError(
      `the P and N pads at the end, (${e[0].toFixed(3)}, ${e[1].toFixed(3)}), are on the other sides than at the start, so the two tracks would cross; P leaves its start pad on the ${swap ? 'right' : 'left'} of the direction of travel and must arrive on the ${rightAtEnd ? 'right' : 'left'}${odd ? ' after its crossover' : ' too'}; swap them at a via pair with .cross(layer)`,
      e,
    )
  }
  const flip = <T>(pn: [T, T]): [T, T] => (swap ? [pn[1], pn[0]] : pn)
  // fanning from the pad's edge, never across the pads beside it
  const d0 = unitOf(centre[0], centre[1]),
    d1 = unitOf(centre[centre.length - 1], centre[centre.length - 2])
  const neckW = (pad: Pad | null) => neckOf(pad, w, job.minWidth, job.neck)?.width ?? w
  const lead = (pads: [Pad | null, Pad | null], at: [Pt, Pt], d: Pt, layer: string): [Pt, Pt] =>
    fanLead(
      ctx.padFree,
      layer,
      edges(pads, at, d),
      d,
      w + g,
      [(at[0][0] + at[1][0]) / 2, (at[0][1] + at[1][1]) / 2],
      job.nets,
      [neckW(pads[0]), neckW(pads[1])],
      job.neck?.length ?? 2,
    )
  const sE = lead([job.pads[0], job.pads[1]], job.startPads, d0, job.layers[0])
  const eE = lead([job.pads[2], job.pads[3]], job.endPads, d1, job.layers[job.layers.length - 1])
  // a rounded corner's arc is checked as the net of its track
  const netOf = (t: 0 | 1) => job.nets[swap ? 1 - t : t]
  const free = ctx.free
  const raw = pairPaths(centre, w, g, {
    startPads: flip(sE),
    endPads: flip(eE),
    vias,
    viaSize: job.via.size,
    clearance: job.clearance,
    width: w,
    ...(job.crosses?.length ? { crosses: job.crosses } : {}),
    ...(job.radii ? { radii: job.radii } : {}),
    ...(free ? { free: (k: number, t: 0 | 1, pts: Pt[]) => polyFree(free, job.layers[k], pts, netOf(t), w) } : {}),
  })
  const geo: PairPaths = swap ? { ...raw, runsP: raw.runsN, runsN: raw.runsP, viasP: raw.viasN, viasN: raw.viasP, lengthP: raw.lengthN, lengthN: raw.lengthP } : raw
  const last = geo.runsP.length - 1
  const ends = (run: Prim[], from: Pt, edgeAt: Pt, to: Pt, edgeTo: Pt, k: number) =>
    tidyPrims([...(k === 0 ? linesOf([from, edgeAt]) : []), ...run, ...(k === last ? linesOf([edgeTo, to]) : [])])
  const runsP = geo.runsP.map((run, k) => ends(run, job.startPads[0], sE[0], job.endPads[0], eE[0], k))
  const runsN = geo.runsN.map((run, k) => ends(run, job.startPads[1], sE[1], job.endPads[1], eE[1], k))
  const uncoupled = geo.uncoupled
  // a neck runs until the full width clears the pads beside it and the partner is a gap away
  const gapMin = Math.min(job.copper, g)
  const neckAt = (pad: Pad | null, run: Pt[], partner: Pt[], layer: string, net: string): Neck | null => {
    if (!pad || !ctx.padFree) return null
    const n = neckOf(pad, w, job.minWidth, job.neck)
    if (!n) return null
    const d = unitOf(run[0], run[1])
    const reach = padReach(pad, run[0], d)
    const padFree = ctx.padFree
    const free: IsFree = (l, x, y, nn, ww) => padFree(l, x, y, nn, ww) && partner.every((q, i) => i === 0 || ptSeg([x, y], partner[i - 1], q) >= (ww + w) / 2 + gapMin - 1e-6)
    const t = neckLength(free, layer, run, net, w, reach + n.length, job.copper, w > Math.min(...pad.size) + EPS ? reach : 0)
    return t > EPS ? { width: n.width, length: t } : null
  }
  const tracks: PairTrack[] = []
  const flatP = runsP.map(r => flatten(r)),
    flatN = runsN.map(r => flatten(r))
  for (const [role, runs, flat, net, ps, pe] of [
    ['P', runsP, flatP, job.nets[0], job.pads[0], job.pads[2]],
    ['N', runsN, flatN, job.nets[1], job.pads[1], job.pads[3]],
  ] as const) {
    runs.forEach((run, k) => {
      const layer = job.layers[k]
      const pts = flat[k],
        other = (role === 'P' ? flatN : flatP)[k]
      const head = k === 0 ? neckAt(ps, pts, other, layer, net) : null
      const tail = k === last ? neckAt(pe, pts.slice().reverse(), other, layer, net) : null
      for (const p of neckPrims(run, w, head, tail)) tracks.push({ layer, role, pts: flatten(p.prims), prims: p.prims, width: p.width })
    })
  }
  const out: PairVia[] = []
  geo.viasP.forEach((vp, j) => {
    const layers: [string, string] = [job.layers[j], job.layers[j + 1]]
    out.push({ role: 'P', at: vp, layers }, { role: 'N', at: geo.viasN[j], layers })
  })
  return { job, tracks, vias: out, uncoupled, lengthP: runsP.reduce((s, r) => s + primsLength(r), 0), lengthN: runsN.reduce((s, r) => s + primsLength(r), 0), geo }
}

/** The first point where P comes closer to N than the clearance or the smaller pair gap. */
export function pairClash(laid: PairLaid): Pt | null {
  // chords of a flattened arc cut inside it by up to 0.002 mm, which concentric arcs do not
  const job = laid.job,
    c = Math.min(job.copper, job.g) - 0.002
  const P = laid.tracks.filter(t => t.role === 'P'),
    N = laid.tracks.filter(t => t.role === 'N')
  for (const a of P)
    for (const b of N) {
      if (a.layer !== b.layer) continue
      const lim = c + (a.width + b.width) / 2
      for (let i = 1; i < a.pts.length; i++)
        for (let j = 1; j < b.pts.length; j++)
          if (segSeg(a.pts[i - 1], a.pts[i], b.pts[j - 1], b.pts[j]) < lim) return [(a.pts[i][0] + b.pts[j][0]) / 2, (a.pts[i][1] + b.pts[j][1]) / 2]
    }
  for (const v of laid.vias) {
    const span = spanOf(job.copperLayers, v.layers[0], v.layers[1])
    for (const t of v.role === 'P' ? N : P) {
      if (!span.includes(t.layer)) continue
      const lim = Math.max(job.copper - 1e-6 + job.via.size / 2, job.holeClearance - 1e-6 + job.via.drill / 2) + t.width / 2
      for (let i = 1; i < t.pts.length; i++) if (ptSeg(v.at, t.pts[i - 1], t.pts[i]) < lim) return v.at
    }
  }
  return null
}

function clearOfOthers(laid: PairLaid, ctx: PairContext): boolean {
  const free = ctx.free
  if (!free) return true
  const job = laid.job
  for (const t of laid.tracks) if (!polyFree(free, t.layer, t.pts, t.role === 'P' ? job.nets[0] : job.nets[1], t.width)) return false
  for (const v of laid.vias)
    for (const l of spanOf(job.copperLayers, v.layers[0], v.layers[1])) if (!free(l, v.at[0], v.at[1], v.role === 'P' ? job.nets[0] : job.nets[1], job.via.size)) return false
  return true
}

function viaPairFree(ctx: PairContext, job: PairJob, at: Pt, dIn: Pt, dOut: Pt, layers: string[]): boolean {
  if (!ctx.free) return true
  const v = pairVias(at, dIn, dOut, job.w + job.g, job.via.size, job.clearance)
  return layers.every(
    l =>
      ctx.free!(l, v.P[0], v.P[1], job.nets[0], job.via.size) &&
      ctx.free!(l, v.N[0], v.N[1], job.nets[0], job.via.size) &&
      ctx.free!(l, v.P[0], v.P[1], job.nets[1], job.via.size) &&
      ctx.free!(l, v.N[0], v.N[1], job.nets[1], job.via.size),
  )
}

/** A centre line vertex; `via` is the index into job.vias, -1 for none. */
interface Vx {
  p: Pt
  via: number
  auto: boolean
  r: number
}
const toVx = (job: PairJob): Vx[] => job.centre.map((p, i) => ({ p, via: job.vias.indexOf(i), auto: !!job.auto?.[i], r: job.radii?.[i] ?? 0 }))
function fromVx(job: PairJob, vs: Vx[]): PairJob {
  const centre = vs.map(v => v.p),
    vias: number[] = []
  vs.forEach((v, i) => {
    if (v.via >= 0) vias.push(i)
  })
  const { radii: _, ...rest } = job
  return { ...rest, centre, vias, auto: vs.map(v => v.auto), ...(vs.some(v => v.r > 0) ? { radii: vs.map(v => v.r) } : {}) }
}
function layerAt(job: PairJob, vs: Vx[], i: number): string {
  let k = 0
  for (let j = 1; j <= i; j++) if (vs[j].via >= 0) k++
  return job.layers[Math.min(k, job.layers.length - 1)]
}

/** Cuts router-placed jogs under half the pitch and turns over 135 degrees where the shortcut is free; null when nothing changed. */
export function tidyCentre(job: PairJob, ctx: PairContext): PairJob | null {
  const pitch = job.w + job.g,
    cw = 2 * job.w + job.g,
    jog = pitch / 2
  const auto = new Set(job.autoVias ?? job.vias.map((_, k) => k))
  let vs = toVx(job)
  const tried = new Set<string>()
  let changed = false
  for (let guard = 0; guard < 4 * vs.length + 8; guard++) {
    let best = -1,
      score = Infinity
    for (let i = 1; i < vs.length - 1; i++) {
      if (tried.has(`${vs[i].p}`) || !vs[i].auto) continue
      const la = d2(vs[i - 1].p, vs[i].p),
        lb = d2(vs[i].p, vs[i + 1].p)
      const t = Math.abs(turn(unitOf(vs[i - 1].p, vs[i].p), unitOf(vs[i].p, vs[i + 1].p)))
      const sharp = t > Math.PI * 0.75 + 1e-6
      if (!sharp && Math.min(la, lb) >= jog - EPS) continue
      if (vs[i].via >= 0) {
        if (!auto.has(vs[i].via)) continue
        const j = la <= lb ? i - 1 : i + 1
        if (j <= 0 || j >= vs.length - 1 || vs[j].via >= 0 || Math.min(la, lb) >= jog - EPS) continue
      }
      const s = sharp ? -1 : la + lb
      if (s < score) {
        score = s
        best = i
      }
    }
    if (best < 0) break
    const v = vs[best]
    if (v.via >= 0) {
      // the via moves onto the jog's far vertex
      const la = d2(vs[best - 1].p, v.p),
        lb = d2(v.p, vs[best + 1].p)
      const j = la <= lb ? best - 1 : best + 1,
        o = la <= lb ? best + 1 : best - 1
      const layer = la <= lb ? layerAt(job, vs, best) : layerAt(job, vs, best - 1)
      const before = layerAt(job, vs, best - 1),
        after = layerAt(job, vs, best)
      const okPath = !ctx.centreFree || polyFree(ctx.centreFree, layer, [vs[j].p, vs[o].p], job.nets[0], cw)
      const nb = la <= lb ? vs[j - 1]?.p : vs[j + 1]?.p
      const dIn = la <= lb ? unitOf(nb ?? vs[j].p, vs[j].p) : unitOf(vs[o].p, vs[j].p),
        dOut = la <= lb ? unitOf(vs[j].p, vs[o].p) : unitOf(vs[j].p, nb ?? vs[j].p)
      const okVia = viaPairFree(ctx, job, vs[j].p, dIn, dOut, [before, after])
      if (!okPath || !okVia) {
        tried.add(`${v.p}`)
        continue
      }
      vs = vs.map((x, i) => (i === j ? { ...x, via: v.via } : x)).filter((_, i) => i !== best)
      changed = true
      continue
    }
    const a = vs[best - 1].p,
      b = vs[best + 1].p
    const layer = layerAt(job, vs, best - 1)
    if (ctx.centreFree && !polyFree(ctx.centreFree, layer, [a, b], job.nets[0], cw)) {
      tried.add(`${v.p}`)
      continue
    }
    vs = vs.filter((_, i) => i !== best)
    changed = true
  }
  if (!changed) return null
  return cleanVias(fromVx(job, vs))
}

/** Removes vertices inside straight runs, keeping ends and vias. */
export function mergeStraight(job: PairJob): PairJob {
  const vs = toVx(cleanVias(job)),
    out: Vx[] = []
  for (let i = 0; i < vs.length; i++) {
    if (i > 0 && i < vs.length - 1 && vs[i].via < 0 && out.length) {
      const a = out[out.length - 1].p,
        b = vs[i].p,
        c = vs[i + 1].p
      if (Math.abs(turn(unitOf(a, b), unitOf(b, c))) < 1e-9) continue
    }
    out.push(vs[i])
  }
  return fromVx(job, out)
}

/** Removes repeated points, keeping vias on their vertices. */
function cleanVias(job: PairJob): PairJob {
  const vs = toVx(job),
    out: Vx[] = []
  for (const v of vs) {
    const prev = out[out.length - 1]
    if (prev && same(prev.p, v.p)) {
      if (v.via >= 0) prev.via = v.via
      continue
    }
    out.push(v)
  }
  return fromVx(job, out)
}

/** Slides clashing automatic via pairs up to four spacings along the centre line to the nearest clean place; null when none moved. */
export function slideVias(job: PairJob, ctx: PairContext): PairJob | null {
  if (!ctx.centreFree) return null
  const free = ctx.centreFree
  const pitch = job.w + job.g,
    cw = 2 * job.w + job.g
  const spacing = Math.max(pitch, job.via.size + job.clearance)
  const auto = new Set(job.autoVias ?? job.vias.map((_, k) => k))
  let cur = job,
    moved = false
  const nearClash = (j: PairJob, at: Pt): boolean => {
    let laid: PairLaid
    try {
      laid = layCentre(j, ctx)
    } catch {
      return true
    }
    const c = pairClash(laid)
    return !!c && d2(c, at) < 4 * spacing + pitch
  }
  for (let k = 0; k < job.vias.length; k++) {
    if (!auto.has(k)) continue
    const vs = toVx(cur)
    const i = vs.findIndex(v => v.via === k)
    if (i <= 0 || i >= vs.length - 1) continue
    const at = vs[i].p
    if (!nearClash(cur, at)) continue
    const before = layerAt(cur, vs, i - 1),
      after = layerAt(cur, vs, i)
    const cands: { s: number; dir: number }[] = []
    for (let s = 0.1; s <= 4 * spacing + 1e-9; s += 0.1) cands.push({ s, dir: 1 }, { s, dir: -1 })
    for (const { s, dir } of cands) {
      let rest = s,
        j = i,
        q: Pt | null = null
      while (j + dir >= 0 && j + dir < vs.length) {
        const a = vs[j].p,
          b = vs[j + dir].p,
          l = d2(a, b)
        if (rest < l - 1e-6) {
          q = [a[0] + ((b[0] - a[0]) * rest) / l, a[1] + ((b[1] - a[1]) * rest) / l]
          break
        }
        if (vs[j + dir].via >= 0 || j + dir === 0 || j + dir === vs.length - 1) break
        rest -= l
        j += dir
      }
      if (!q) continue
      // the stretch from the old via to q now runs on the layer the via left
      const path = dir > 0 ? [...vs.slice(i, j + 1).map(v => v.p), q] : [q, ...vs.slice(j, i + 1).map(v => v.p)]
      const layer = dir > 0 ? before : after
      if (!polyFree(free, layer, path, job.nets[0], cw)) continue
      const seg = dir > 0 ? [vs[j].p, vs[j + 1].p] : [vs[j - 1].p, vs[j].p]
      const dq = unitOf(seg[0], seg[1])
      if (!viaPairFree(ctx, job, q, dq, dq, [before, after])) continue
      const nv = vs.slice()
      nv[i] = { ...nv[i], via: -1 }
      if (dir > 0) nv.splice(j + 1, 0, { p: q, via: k, auto: true, r: 0 })
      else nv.splice(j, 0, { p: q, via: k, auto: true, r: 0 })
      const next = cleanVias(fromVx(cur, nv))
      if (nearClash(next, q)) continue
      cur = next
      moved = true
      break
    }
  }
  return moved ? cur : null
}

/** Adds a square approach a pitch past the pads to an end reached at a slant; null when none is needed or free. */
export function squareEnds(job: PairJob, ctx: PairContext): PairJob | null {
  const pitch = job.w + job.g,
    cw = 2 * job.w + job.g
  let vs = toVx(job),
    changed = false
  const side = (pads: [Pt, Pt], a: Pt, b: Pt) => {
    const d = unitOf(a, b)
    return Math.sign((pads[0][0] - pads[1][0]) * d[1] - (pads[0][1] - pads[1][1]) * d[0])
  }
  for (const at of ['start', 'end'] as const) {
    const ends = at === 'start' ? job.startPads : job.endPads,
      pads = at === 'start' ? job.pads.slice(0, 2) : job.pads.slice(2)
    const i0 = at === 'start' ? 0 : vs.length - 1,
      i1 = at === 'start' ? 1 : vs.length - 2
    const mid = vs[i0].p,
      next = vs[i1].p
    const line = unitOf(ends[0], ends[1])
    const d = unitOf(mid, next)
    let sq: Pt = [-line[1], line[0]]
    if (sq[0] * d[0] + sq[1] * d[1] < 0) sq = [-sq[0], -sq[1]]
    if (Math.abs(sq[0] * d[1] - sq[1] * d[0]) < 0.02) continue
    const other = at === 'start' ? side(job.endPads, vs[vs.length - 2].p, vs[vs.length - 1].p) : side(job.startPads, vs[0].p, vs[1].p)
    const layer = layerAt(job, vs, at === 'start' ? 0 : vs.length - 2)
    for (const s of [sq, [-sq[0], -sq[1]] as Pt]) {
      let ext = 0
      for (const p of pads) if (p) ext = Math.max(ext, padReach(p, mid, s))
      const L = ext + pitch
      const q: Pt = [mid[0] + s[0] * L, mid[1] + s[1] * L]
      if (d2(q, next) < pitch) continue
      const mine = at === 'start' ? side(ends, mid, q) : side(ends, q, mid)
      // a crossover between the ends turns P to the other side
      const want = (job.crosses?.length ?? 0) % 2 ? -other : other
      if (other && mine && mine !== want) continue
      if (ctx.centreFree && !polyFree(ctx.centreFree, layer, [mid, q, next], job.nets[0], cw, p => d2(p, mid) < ext + 1e-6)) continue
      const nv = vs.slice()
      nv.splice(at === 'start' ? 1 : vs.length - 1, 0, { p: q, via: -1, auto: true, r: 0 })
      vs = nv
      changed = true
      break
    }
  }
  return changed ? fromVx(job, vs) : null
}

/** Tries tidied, slid, squared and as-routed centre lines; the first clean layout wins, else one without a P to N clash, else throws. */
export function layPairJob(job: PairJob, ctx: PairContext = {}): PairLaid {
  const gens: ((j: PairJob, c: PairContext) => PairJob | null)[][] = [[tidyCentre], [tidyCentre, slideVias], [tidyCentre, squareEnds], [tidyCentre, slideVias, squareEnds], []]
  let first: PairLaid | null = null,
    ok: PairLaid | null = null,
    err: unknown = null
  const seen = new Set<string>()
  for (const [k, steps] of gens.entries()) {
    let j: PairJob = job
    for (const s of steps) j = s(j, ctx) ?? j
    const key = JSON.stringify([j.centre, j.vias])
    if (seen.has(key)) continue
    seen.add(key)
    let laid: PairLaid
    try {
      laid = layCentre(j, ctx)
    } catch (e) {
      if (!(e instanceof PairGeometryError)) throw e
      err ??= e
      continue
    }
    const clash = pairClash(laid)
    if (clash) laid.clash = clash
    first ??= laid
    if (!clash) ok ??= laid
    const others = !clash && k > 0 && j !== job ? clearOfOthers(laid, ctx) : true
    if (clash || !others) continue
    return laid
  }
  if (ok) return ok
  if (first?.clash)
    throw new PairGeometryError(
      `its tracks would come closer to each other than the clearance near (${first.clash[0].toFixed(3)}, ${first.clash[1].toFixed(3)}), where a via pair or a fan has no room; give the centre line more room there, or place the vias with @<layer> in the path`,
      first.clash,
    )
  throw err
}

/** The end of an automatic pair end's stub: square away from the footprint first, then along, then the compass; null when the ends coincide. */
export function pairStub(
  job: Pick<PairJob, 'w' | 'g' | 'nets' | 'neck' | 'minWidth'> & { margin?: number },
  ends: [Pt, Pt],
  pads: [Pad | null, Pad | null],
  layer: string,
  fp: Pt | undefined,
  toward: Pt,
  ctx: PairContext,
): Pt | null {
  const [a, b] = ends
  const l = d2(a, b)
  if (l < 1e-9) return null
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const pitch = job.w + job.g,
    cw = 2 * job.w + job.g
  const line = unitOf(a, b),
    n: Pt = [-line[1], line[0]]
  const dot = (u: Pt, v: Pt) => u[0] * v[0] + u[1] * v[1]
  const rel = (q: Pt): Pt => [q[0] - mid[0], q[1] - mid[1]]
  const out = fp ? dot(rel(fp), n) : 0
  const sq: Pt = Math.abs(out) > 1e-6 ? (out < 0 ? n : [-n[0], -n[1]]) : dot(rel(toward), n) < 0 ? [-n[0], -n[1]] : n
  const al: Pt = dot(rel(toward), line) >= 0 ? line : [-line[0], -line[1]]
  const dirs: Pt[] = [sq, [-sq[0], -sq[1]], al, [-al[0], -al[1]]]
  // then the eight directions of the compass, nearest the direction to the far end first, for pads in staggered rows
  const tw = unitOf(mid, toward)
  const compass = Array.from({ length: 8 }, (_, k): Pt => [Math.round(Math.cos((k * Math.PI) / 4) * 1e9) / 1e9, Math.round(Math.sin((k * Math.PI) / 4) * 1e9) / 1e9]).sort(
    (u, v) => dot(v, tw) - dot(u, tw),
  )
  for (const c of compass) if (!dirs.some(q => dot(q, c) > 1 - 1e-6)) dirs.push(c)
  const lim = job.neck?.length ?? 2
  const at = (d: Pt, s: number): Pt => [mid[0] + d[0] * s, mid[1] + d[1] * s]
  const s0Of = (d: Pt) => {
    let ext = 0
    for (const p of pads) if (p) ext = Math.max(ext, padReach(p, mid, d))
    return ext + pitch
  }
  if (!ctx.free && !ctx.centreFree) return at(sq, s0Of(sq))
  for (const d of dirs) {
    const side = (a[0] - b[0]) * d[1] - (a[1] - b[1]) * d[0] // > 0: P is left of d
    const [eP, eN] = fanLead(
      ctx.padFree,
      layer,
      edges(pads, ends, d),
      d,
      pitch,
      mid,
      job.nets,
      [neckOf(pads[0], job.w, job.minWidth, job.neck)?.width ?? job.w, neckOf(pads[1], job.w, job.minWidth, job.neck)?.width ?? job.w],
      lim,
    )
    const fan = side >= 0 ? pairEnds(eP, eN, d, pitch, 'start', mid) : pairEnds(eN, eP, d, pitch, 'start', mid)
    const [oP, oN] = side >= 0 ? [fan.P, fan.N] : [fan.N, fan.P]
    const s0 = Math.max(s0Of(d), fan.advance + pitch / 2)
    let s = -1
    for (let t = s0; t <= s0 + lim + EPS; t += STEP) {
      const p = at(d, t)
      // free for two more widths, so the leg has room to leave
      if (
        !ctx.centreFree ||
        [0, cw, 2 * cw].every(k => {
          const q = at(d, t + k)
          return ctx.centreFree!(layer, q[0], q[1], job.nets[0], cw + 2 * (job.margin ?? 0))
        })
      ) {
        s = t
        break
      }
      if (lim <= EPS) break
    }
    if (s < 0) continue
    const e = at(d, s)
    const h = pitch / 2,
      nl = leftNormal(d),
      sg = side >= 0 ? 1 : -1
    const endP: Pt = [e[0] + nl[0] * h * sg, e[1] + nl[1] * h * sg],
      endN: Pt = [e[0] - nl[0] * h * sg, e[1] - nl[1] * h * sg]
    const ok =
      !ctx.free ||
      [
        [a, eP, oP, endP, pads[0], job.nets[0]],
        [b, eN, oN, endN, pads[1], job.nets[1]],
      ].every(([p0, p1, p2, p3, pad, net]) => {
        const nw = neckOf(pad as Pad | null, job.w, job.minWidth, job.neck)?.width ?? job.w
        return polyFree(ctx.free!, layer, cleanPolyline([p0, p1, p2, p3] as Pt[]), net as string, nw)
      })
    if (ok) return e
  }
  return at(sq, s0Of(sq))
}
