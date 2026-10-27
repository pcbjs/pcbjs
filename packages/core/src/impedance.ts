// Closed-form trace impedance, mm and ohms, within a few percent of the field solver in tests/impedance.test.mjs; no solder mask modelled.
// Microstrip: Hammerstad and Jensen, IEEE MTT-S 1980, with their thickness correction, as KiCad and Qucs.
// Stripline: Wheeler, IEEE MTT 26(11) 1978, as in Wadell, Transmission Line Design Handbook 1991, 3.5.1; offset stripline per Wadell 3.6.
// Edge coupled: IPC-2141A and Wadell, Zdiff = 2 Z0 (1 - 0.48 exp(-0.96 s / h)) microstrip, 2 Z0 (1 - 0.347 exp(-2.9 s / b)) stripline.
import type { Stackup, StackupLayer } from './types.js'

const ETA0 = 376.730313668
/** the er the model assumes for a dielectric layer that gives none */
const DEFAULT_ER = 4.5

/** The geometry of a trace layer as the formulas see it. */
export interface TraceModel {
  kind: 'microstrip' | 'stripline'
  layer: string
  /** copper thickness of the trace layer, mm */
  t: number
  /** dielectric height to the plane, for stripline the one above */
  h: number
  /** stripline: dielectric height to the plane below */
  h2?: number
  /** the thickness weighted er of the dielectrics between the trace and its planes */
  er: number
  /** the reference copper layers */
  planes: string[]
}

type Copper = Extract<StackupLayer, { type: 'copper' }>

/** A trace on `layer` between its nearest copper neighbours; outer layers are microstrip, inner stripline. */
export function traceModel(stackup: Stackup, layer: string): TraceModel {
  if (!stackup || !Array.isArray(stackup.layers)) throw new Error('impedance: the stackup needs a layers array')
  const L = stackup.layers
  const name = canonical(layer)
  const idx = L.findIndex(l => l.type === 'copper' && l.name === name)
  if (idx < 0) throw new Error(`impedance: ${JSON.stringify(layer)} is not a copper layer of the stackup (it has ${L.filter((l): l is Copper => l.type === 'copper').map(l => l.name).join(', ')})`)
  const cu = L[idx] as Copper
  const side = (dir: 1 | -1) => {
    let h = 0, erh = 0
    for (let i = idx + dir; i >= 0 && i < L.length; i += dir) {
      const l = L[i]
      if (l.type === 'copper') return { plane: l.name, h, er: h > 0 ? erh / h : DEFAULT_ER }
      if (l.type === 'core' || l.type === 'prepreg') { h += l.thickness; erh += l.thickness * (l.er ?? DEFAULT_ER) }
    }
    return null
  }
  const up = side(-1), down = side(1)
  if (!up && !down) throw new Error(`impedance: the stackup has no reference plane for ${name}, it needs a copper layer above or below it`)
  for (const s of [up, down]) if (s && !(s.h > 0)) throw new Error(`impedance: no dielectric between ${name} and ${s.plane}`)
  const t = cu.thickness
  if (up && down) {
    const er = (up.er * up.h + down.er * down.h) / (up.h + down.h)
    return { kind: 'stripline', layer: name, t, h: up.h, h2: down.h, er, planes: [up.plane, down.plane] }
  }
  const s = (up ?? down)!
  return { kind: 'microstrip', layer: name, t, h: s.h, er: s.er, planes: [s.plane] }
}

function canonical(layer: string): string {
  const low = String(layer).toLowerCase()
  const alias: Record<string, string> = { top: 'F.Cu', bottom: 'B.Cu', 'f.cu': 'F.Cu', 'b.cu': 'B.Cu' }
  if (alias[low]) return alias[low]
  const m = /^in(\d+)\.cu$/.exec(low)
  return m ? `In${m[1]}.Cu` : layer
}

// ---- microstrip, Hammerstad and Jensen ----

/** Impedance of a zero-thickness microstrip in air, u = w / h. */
const z01 = (u: number) => (ETA0 / (2 * Math.PI)) * Math.log((6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528))) / u + Math.sqrt(1 + 4 / (u * u)))
/** Effective dielectric constant of a zero-thickness microstrip. */
function eeff(u: number, er: number): number {
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7
  const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053)
  return (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 10 / u, -a * b)
}
function microstrip(w: number, m: TraceModel): number {
  const u = w / m.h, t = m.t / m.h
  let ur = u
  if (t > 0) {
    const coth = 1 / Math.tanh(Math.sqrt(6.517 * u))
    const du1 = (t / Math.PI) * Math.log(1 + (4 * Math.E) / (t * coth * coth))
    ur = u + 0.5 * (1 + 1 / Math.cosh(Math.sqrt(m.er - 1))) * du1
  }
  return z01(ur) / Math.sqrt(eeff(ur, m.er))
}

// ---- stripline, Wheeler 1978 ----

/** Symmetric stripline: trace w by t centred between planes b apart. */
function stripSym(w: number, t: number, b: number, er: number): number {
  const x = t / b
  let wp = w / (b - t)
  if (x > 0) {
    const n = 2 / (1 + (2 / 3) * (x / (1 - x)))
    wp += (x / (Math.PI * (1 - x))) * (1 - 0.5 * Math.log((x / (2 - x)) ** 2 + Math.pow(0.0796 * x / (w / b + 1.1 * x), n)))
  }
  const k = 8 / (Math.PI * wp)
  return (30 / Math.sqrt(er)) * Math.log(1 + (4 / (Math.PI * wp)) * (k + Math.sqrt(k * k + 6.27)))
}
function stripline(w: number, m: TraceModel): number {
  const h1 = m.h, h2 = m.h2!
  // each half seen as a symmetric stripline with the trace at that plane's distance, in parallel
  const za = stripSym(w, m.t, 2 * h1 + m.t, m.er), zb = stripSym(w, m.t, 2 * h2 + m.t, m.er)
  return (2 * za * zb) / (za + zb)
}

function single(w: number, m: TraceModel): number {
  return m.kind === 'microstrip' ? microstrip(w, m) : stripline(w, m)
}
function differential(w: number, s: number, m: TraceModel): number {
  if (m.kind === 'microstrip') return 2 * single(w, m) * (1 - 0.48 * Math.exp((-0.96 * s) / m.h))
  const b = m.h + m.h2! + m.t
  return 2 * single(w, m) * (1 - 0.347 * Math.exp((-2.9 * s) / b))
}

const positive = (v: number, what: string) => { if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) throw new Error(`impedance: ${what} must be a positive number of mm, got ${JSON.stringify(v)}`) }

/** Impedance in ohms of a trace `width` mm wide, differential when `gap`, edge to edge, is given. */
export function impedanceOf(stackup: Stackup, layer: string, width: number, gap?: number): number {
  positive(width, 'width')
  const m = traceModel(stackup, layer)
  if (gap === undefined) return single(width, m)
  positive(gap, 'gap')
  return differential(width, gap, m)
}

/** Solve f(x) = target for x in [lo, hi] by bisection on log x; f is monotonic, falling with x unless `rising`. */
function solve(f: (x: number) => number, target: number, what: string, rising = false, lo = 0.005, hi = 50): number {
  if (!(typeof target === 'number' && target > 0 && Number.isFinite(target))) throw new Error(`impedance: the target must be a positive number of ohms, got ${JSON.stringify(target)}`)
  const fl = f(lo), fh = f(hi), min = Math.min(fl, fh), max = Math.max(fl, fh)
  if (!(target >= min && target <= max)) throw new Error(`impedance: ${target} ohms is out of reach for ${what}, which spans ${Math.round(min * 10) / 10} to ${Math.round(max * 10) / 10} ohms`)
  let a = Math.log(lo), b = Math.log(hi)
  for (let i = 0; i < 80; i++) {
    const c = (a + b) / 2
    if ((f(Math.exp(c)) > target) !== rising) a = c; else b = c
  }
  return Math.exp((a + b) / 2)
}

/** The width in mm of a single ended trace of `z0` ohms on `layer`. */
export function traceWidth(stackup: Stackup, layer: string, z0: number): number {
  const m = traceModel(stackup, layer)
  return solve(w => single(w, m), z0, `a trace on ${m.layer}`)
}

/** Width and gap in mm of a pair of `zdiff` ohms: solves the one not given; neither makes them equal. */
export function pairGeometry(stackup: Stackup, layer: string, zdiff: number, opts: { gap?: number; width?: number } = {}): { width: number; gap: number } {
  const m = traceModel(stackup, layer)
  const { gap, width } = opts
  if (gap !== undefined) positive(gap, 'gap')
  if (width !== undefined) positive(width, 'width')
  if (width !== undefined && gap !== undefined) return { width, gap }
  if (gap !== undefined) return { width: solve(w => differential(w, gap, m), zdiff, `a pair on ${m.layer} with a ${gap} mm gap`), gap }
  if (width !== undefined) {
    // the impedance rises with the gap
    return { width, gap: solve(s => differential(width, s, m), zdiff, `a pair of ${width} mm tracks on ${m.layer}`, true) }
  }
  const w = solve(x => differential(x, x, m), zdiff, `a pair on ${m.layer} with the gap equal to the width`)
  return { width: w, gap: w }
}
