// Pair tuning meanders the centre line before the offset, so both tracks grow alike and keep their gap and skew. Board mm, y down.
import type { Pad, Pt } from '@pcbjs/core/model'
import { longestFreeSegment, type FreeSpan, type IsFree } from './length.js'
import { meander, meanderCapacity, smallestBump } from './meander.js'
import { layPairJob, mergeStraight, type PairContext, type PairJob, type PairLaid } from './pair-lay.js'

export interface PairTuneContext {
  /** `free` must see the board without this pair's own copper; without it the pair is not tuned */
  pair: PairContext
  /** the pads of both nets; with `pair.centreFree` they make the free search faster than `pair.free` */
  pads?: Pad[]
  /** courtyards and silk the room search keeps meanders out of, not tested on the layout */
  room?: IsFree
  /** the pair's length as DRC measures it: the longer of its two tracks with their via barrels, mm */
  measure(laid: PairLaid): number
  /** the largest distance the centre line may move out, mm, default 1; the outer track's edge moves as far */
  amplitude?: number
  /** the smallest gap between the parallel runs of the meander, edge to edge of the pair, mm, default 0.6 */
  spacing?: number
  /** done when within this many mm of the extra; default 0.01 */
  tolerance?: number
  /** how far past the extra the smallest U bump may reach when less than it is left, mm; default the tolerance */
  over?: number
}

export interface PairTuned { job: PairJob; laid: PairLaid; added: number; note?: string }

const MARGIN = 0.05
const EPS = 1e-6

/** Adds `extra` mm to a pair by meanders in its centre line, lowering the amplitude when no stretch has room. */
export function tunePairCentre(job: PairJob, extra: number, ctx: PairTuneContext): PairTuned {
  let laid = layPairJob(job, ctx.pair)
  let cur = laid.job
  const L0 = ctx.measure(laid)
  let L = L0
  const tol = ctx.tolerance ?? 0.01
  const free = ctx.pair.free
  if (!(extra > tol) || !free) return { job: cur, laid, added: 0, ...(extra > tol ? { note: 'no free test to tune the pair with' } : {}) }
  const pitch = job.w + job.g, cw = 2 * job.w + job.g
  // below half the pitch the inner track's arc shrinks to a point
  const rmin = Math.max(job.w, pitch / 2)
  const amin = Math.max(2 * rmin, pitch + 0.02)
  const shape = { amplitude: ctx.amplitude ?? 1, spacing: ctx.spacing ?? 0.6, width: cw, clearance: job.copper, radius: Math.max(pitch, rmin), minRadius: rmin, minAmplitude: amin }
  const amps: number[] = []
  for (let a = Math.max(shape.amplitude, amin); a > amin + EPS; a *= 0.75) amps.push(a)
  amps.push(amin)
  let why: string | undefined
  const disc = Math.max(pitch, job.via.size + job.clearance) + job.via.size
  const place = (base: PairJob, at: number, span: FreeSpan, x: number, A: number): { laid: PairLaid; L: number; added: number } | null => {
    const res = meander(span.a, span.b, span.side, { extra: x, ...shape, amplitude: A })
    if (!res || 'why' in res || res.added < EPS) { if (res && 'why' in res) why = res.why; return null }
    const ins = res.corners.pts.slice(1, -1), insR = res.corners.radii.slice(1, -1)
    const centre = [...base.centre.slice(0, at + 1), ...ins, ...base.centre.slice(at + 1)]
    const shift = ins.length
    const auto = base.auto ? [...base.auto.slice(0, at + 1), ...Array(shift).fill(false), ...base.auto.slice(at + 1)] : undefined
    const radii0 = base.radii ?? base.centre.map(() => 0)
    const radii = [...radii0.slice(0, at + 1), ...insR, ...radii0.slice(at + 1)]
    const next: PairJob = mergeStraight({ ...base, centre, vias: base.vias.map(i => (i > at ? i + shift : i)), ...(auto ? { auto } : {}), radii })
    let laid2: PairLaid
    try { laid2 = layPairJob(next, ctx.pair) } catch { return null }
    if (laid2.clash) return null
    return { laid: laid2, L: ctx.measure(laid2), added: res.added }
  }
  // grown to take a leftover below the smallest bump
  let last: { base: PairJob; L: number; at: number; span: FreeSpan; A: number; added: number } | null = null
  const enlarge = (left: number): boolean => {
    if (!last) return false
    const p = place(last.base, last.at, last.span, last.added + left, last.A)
    if (!p || p.L <= L + EPS) return false
    laid = p.laid; cur = p.laid.job; L = p.L; last.added = p.added
    return true
  }
  let ai = 0
  for (let guard = 0; guard < 32 && ai < amps.length; guard++) {
    let left = extra - (L - L0)
    if (left <= tol) break
    if (left < smallestBump(rmin) - 1e-9) {
      if (enlarge(left)) continue
      if (smallestBump(rmin) - left > (ctx.over ?? tol) + 1e-9) break
      left = smallestBump(rmin)
    }
    const A = amps[ai]
    const viaPts = cur.vias.map(i => cur.centre[i])
    const centreFree = ctx.pair.centreFree, pads = ctx.pads
    const clearOf = (layer: string, x: number, y: number, w: number) =>
      viaPts.every(v => Math.hypot(x - v[0], y - v[1]) >= (disc + w) / 2 + job.copper) && (!pads || pads.every(p => !p.layers.includes(layer) || padDist(p, x, y) >= w / 2 + job.copper + MARGIN))
    const room = ctx.room
    const base: IsFree = centreFree && pads
      ? (layer, x, y, _n, w) => centreFree(layer, x, y, job.nets[0], w + 2 * MARGIN) && clearOf(layer, x, y, w)
      : (layer, x, y, _n, w) => free(layer, x, y, job.nets[0], w + 2 * MARGIN) && free(layer, x, y, job.nets[1], w + 2 * MARGIN) && clearOf(layer, x, y, w)
    const ok: IsFree = room ? (layer, x, y, n, w) => base(layer, x, y, n, w) && room(layer, x, y, job.nets[0], w + 2 * MARGIN) : base
    const bounds = [0, ...cur.vias, cur.centre.length - 1]
    let best: { k: number; span: FreeSpan } | null = null
    for (let k = 0; k + 1 < bounds.length; k++) {
      const sec = cur.centre.slice(bounds[k], bounds[k + 1] + 1)
      const span = longestFreeSegment(sec, ok, cw, A + MARGIN, { layer: cur.layers[k], net: job.nets[0], step: 0.1, clearance: job.copper + MARGIN })
      if (span && (!best || span.length > best.span.length + 1e-9)) best = { k, span }
    }
    if (!best) { ai++; continue }
    const { span } = best
    const at = bounds[best.k] + span.index
    // never strand a leftover below the smallest bump
    const cap = meanderCapacity(span.length, { ...shape, amplitude: A }), sm = smallestBump(rmin)
    const ask = cap < left - EPS && left - cap < sm && left - sm >= sm ? left - sm : left
    const p = place(cur, at, span, ask, A)
    if (!p || p.L <= L + EPS) { ai++; continue }
    last = { base: cur, L, at, span, A, added: p.added }
    laid = p.laid; cur = p.laid.job; L = p.L
  }
  if (extra - (L - L0) > tol) enlarge(extra - (L - L0))
  const added = L - L0
  const small = extra - added < smallestBump(rmin) ? `, below the smallest U bump of ${smallestBump(rmin).toFixed(2)} mm` : why ? `: ${why}` : ': the centre line had no room for more'
  return { job: cur, laid, added, ...(extra - added > tol ? { note: `pair tuning added ${added.toFixed(2)} of ${extra.toFixed(2)} mm${small}` } : {}) }
}

/** Distance from a point to a pad's copper outline, 0 inside it. */
function padDist(p: Pad, x: number, y: number): number {
  const r = p.poly
  let inside = false, d = Infinity
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j], b = r[i]
    if ((b[1] > y) !== (a[1] > y) && x < ((a[0] - b[0]) * (y - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
    d = Math.min(d, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy))
  }
  return inside ? 0 : d
}
