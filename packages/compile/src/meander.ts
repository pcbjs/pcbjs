// A one sided trombone of U bumps with arc corners. Board mm, y down.
import type { Prim, Pt } from '@pcbjs/core/model'
import type { Side } from './length.js'
import { fillet, flatten, linesOf, primsLength } from './round.js'

/** Meander shape limits, mm. */
export interface MeanderShape {
  /** reach from the segment, centre line to centre line */
  amplitude: number
  /** the smallest gap, edge to edge, between parallel runs; the gap used is max(spacing, width + clearance) */
  spacing: number
  width: number
  clearance: number
  /** corner radius on the centre line; default half the run pitch, never below the width */
  radius?: number
  /** default the width */
  minRadius?: number
  /** lowest bump, so a pair track's bump top does not read as coupled to its partner */
  minAmplitude?: number
}

export interface MeanderOptions extends MeanderShape {
  /** mm */
  extra: number
}

export interface MeanderResult {
  /** from a to b, arcs flattened */
  pts: Pt[]
  prims: Prim[]
  /** mm over the straight segment, measured along the arcs */
  added: number
  bumps: number
  /** square corners with their radii, for a centre line laid out later */
  corners: { pts: Pt[]; radii: number[] }
}

export interface MeanderMiss { why: string }

const R2 = Math.SQRT2
/** length a 90 degree corner loses to a 45 degree chamfer, per unit of leg */
const CH = 2 - R2
/** length a U bump loses to its four arcs, per unit of radius: 8 r of square corner against 2 pi r of arc */
export const U_LOSS = 8 - 2 * Math.PI

/** Centre to centre pitch of parallel runs. */
export function runPitch(o: MeanderShape): number { return o.width + Math.max(o.spacing, o.width + o.clearance) }
export function bumpRadius(o: MeanderShape): number { return Math.max(o.radius ?? runPitch(o) / 2, minRadiusOf(o)) }
const minRadiusOf = (o: MeanderShape) => o.minRadius ?? o.width
export function uExtra(A: number, r: number): number { return 2 * A - U_LOSS * r }
export function uAmplitude(extra: number, r: number): number { return (extra + U_LOSS * r) / 2 }
/** A bump of amplitude 2r, legs of no length. */
export function smallestBump(r: number): number { return uExtra(2 * r, r) }

// the legs between chamfers stay a track width long, so the outline has no step narrower than the track
const chamfer = (A: number, D: number, w: number) => Math.min(Math.min(A, D) / 4, (A - w) / 2)
const chamferOk = (A: number, D: number, w: number) => chamfer(A, D, w) >= w / 8 - 1e-12
function chamferExtra(A: number, D: number, w: number): number { return 2 * A - 4 * CH * chamfer(A, D, w) }
// bisection: chamferExtra grows with the amplitude
function chamferAmplitude(e: number, D: number, w: number, lo: number, hi: number): number {
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (chamferExtra(m, D, w) < e) lo = m; else hi = m }
  return hi
}

interface Plan { r: number; amps: number[]; D: number; chamfer: boolean }
const f2 = (v: number) => v.toFixed(2)

// U bumps at the largest radius that reaches the extra; 45 degree chamfers only when no U fits the amplitude
function plan(L: number, extra: number, o: MeanderShape): Plan | MeanderMiss {
  const D = runPitch(o), Amax = o.amplitude, rmin = minRadiusOf(o), r0 = bumpRadius(o), floor = o.minAmplitude ?? 0
  if (Amax < floor - 1e-12) return { why: `the ${f2(Amax)} mm amplitude is below the lowest bump of ${f2(floor)} mm` }
  if (extra < smallestBump(rmin) - 1e-9) return { why: `${f2(extra)} mm is below the smallest U bump, ${f2(smallestBump(rmin))} mm at the ${f2(rmin)} mm radius` }
  const capAt = (r: number): { N: number; c: number; Dl: number } => {
    if (Amax < 2 * r - 1e-12) return { N: 0, c: 0, Dl: 0 }
    const Dl = Math.max(D, 2 * r), N = Math.floor((L - 2 * r + Dl) / (2 * Dl) + 1e-9)
    return N >= 1 ? { N, c: N * uExtra(Amax, r), Dl } : { N: 0, c: 0, Dl }
  }
  type Pick = { r: number; N: number; c: number; Dl: number }
  let pick: Pick | null = null, most: Pick | null = null
  const STEPS = 24
  for (let i = 0; i <= STEPS; i++) {
    const r = r0 - ((r0 - rmin) * i) / STEPS, k = capAt(r)
    if (!k.N || extra < smallestBump(r) - 1e-9) continue
    if (!most || k.c > most.c + 1e-9) most = { r, ...k }
    const need = Math.ceil(extra / uExtra(Amax, r) - 1e-9)
    if (extra <= k.c + 1e-9 && extra >= need * smallestBump(r) - 1e-9) { pick = { r, ...k }; break }
    if (r0 - rmin < 1e-12) break
  }
  pick ??= most
  if (pick) {
    const { r, N: Nmax, Dl } = pick
    const emax = uExtra(Amax, r)
    const N = Math.ceil(extra / emax - 1e-9)
    let amps: number[]
    if (N > Nmax) amps = Array(Nmax).fill(Amax)
    else {
      const low = Math.max(2 * r, floor)
      const last = uAmplitude(extra - (N - 1) * emax, r)
      // lower the last bump; below a U the last two share the rest; else all alike
      const two = N >= 2 ? uAmplitude((extra - (N - 2) * emax) / 2, r) : 0
      if (last >= low - 1e-12) amps = [...Array(N - 1).fill(Amax), last]
      else if (two >= low - 1e-12) amps = [...Array(N - 2).fill(Amax), two, two]
      else {
        const even = uAmplitude(extra / N, r)
        amps = even >= low - 1e-12 ? Array(N).fill(even) : N > 1 ? Array(N - 1).fill(Amax) : [low]
      }
    }
    if (amps.length) return { r, amps, D: Dl, chamfer: false }
  }
  let short = !!most || capAt(rmin).Dl > 0
  const w = o.width
  if (Amax < 2 * rmin - 1e-12 && chamferOk(Amax, D, w)) {
    let Amin = Amax
    for (let lo = 0, hi = Amax, i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (chamferOk(m, D, w)) { hi = m; Amin = m } else lo = m }
    Amin = Math.max(Amin, floor)
    const Nmax = Math.floor((L - 2 * chamfer(Amax, D, w) + D) / (2 * D) + 1e-9)
    if (Nmax >= 1) {
      const emax = chamferExtra(Amax, D, w), emin = chamferExtra(Amin, D, w), N = Math.ceil(extra / emax - 1e-9)
      const rest = extra - (N - 1) * emax
      const amps = N > Nmax ? Array(Nmax).fill(Amax) : rest >= emin - 1e-9 ? [...Array(N - 1).fill(Amax), chamferAmplitude(rest, D, w, Amin, Amax)] : N > 1 ? Array(N - 1).fill(Amax) : [Amin]
      return { r: 0, amps, D, chamfer: true }
    }
    short = true
  }
  return { why: short ? `the free stretch of ${f2(L)} mm is too short for a U bump` : `no U bump of ${f2(extra)} mm fits within the ${f2(Amax)} mm amplitude` }
}

/** The most a meander adds on a straight stretch `len` mm long, 0 when no bump fits. */
export function meanderCapacity(len: number, shape: MeanderShape): number {
  const p = plan(len, Infinity, shape)
  if ('why' in p) return 0
  return p.amps.reduce((s, A) => s + (p.chamfer ? chamferExtra(A, p.D, shape.width) : uExtra(A, p.r)), 0)
}

/** Maps (s along a to b, t toward the side) to board coordinates. */
function frame(a: Pt, b: Pt, side: Side) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const u: Pt = L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0]
  const sg = side === 'left' ? 1 : -1
  const n: Pt = [u[1] * sg, -u[0] * sg]
  return { L, map: (s: number, t: number): Pt => [a[0] + u[0] * s + n[0] * t, a[1] + u[1] * s + n[1] * t] }
}

/** Replaces segment a to b by U bumps on `side` adding up to `extra` mm; a miss says why none fit, null for a negative extra. */
export function meander(a: Pt, b: Pt, side: Side, o: MeanderOptions): MeanderResult | MeanderMiss | null {
  const { extra } = o
  if (!(extra >= 0) || !(o.amplitude > 0) || !(o.width > 0)) return null
  if (extra < 1e-9) return { pts: [a, b], prims: linesOf([a, b]), added: 0, bumps: 0, corners: { pts: [a, b], radii: [0, 0] } }
  const { L, map } = frame(a, b, side)
  const p = plan(L, extra, o)
  if ('why' in p) return p
  const { amps, D } = p
  const loc: [number, number][] = [[0, 0]], radii: number[] = [0]
  if (p.chamfer) {
    const cs = amps.map(A => chamfer(A, D, o.width))
    let x = (L - ((2 * amps.length - 1) * D + cs[0] + cs[cs.length - 1])) / 2 + cs[0]
    amps.forEach((A, k) => {
      const c = cs[k]
      loc.push([x - c, 0], [x, c], [x, A - c], [x + c, A], [x + D - c, A], [x + D, A - c], [x + D, c], [x + D + c, 0])
      radii.push(0, 0, 0, 0, 0, 0, 0, 0)
      x += 2 * D
    })
  } else {
    let x = (L - ((2 * amps.length - 1) * D + 2 * p.r)) / 2 + p.r
    for (const A of amps) {
      loc.push([x, 0], [x, A], [x + D, A], [x + D, 0])
      radii.push(p.r, p.r, p.r, p.r)
      x += 2 * D
    }
  }
  loc.push([L, 0]); radii.push(0)
  const pts = loc.map(([s, t]) => map(s, t))
  pts[0] = a; pts[pts.length - 1] = b
  const prims = fillet(pts, radii)
  return { pts: flatten(prims), prims, added: primsLength(prims) - L, bumps: amps.length, corners: { pts, radii } }
}
