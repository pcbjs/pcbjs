import type { Pt } from './model.js'

type Arc = { from: Pt; to: Pt; center: Pt; radius: number; start: number; sweep: number }
const TAU = 2 * Math.PI
const turn = (angle: number) => ((angle % TAU) + TAU) % TAU
const finite = (p: Pt) => p.length === 2 && p.every(Number.isFinite)
const distance = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** A route A/a arc: positive degrees turn counter-clockwise in y-down coordinates. */
export function chainArc(from: Pt, to: Pt, angle: number): Arc | null {
  if (!finite(from) || !finite(to) || !Number.isFinite(angle) || Math.abs(angle) < 1e-7 || Math.abs(angle) >= 360) return null
  const x = to[0] - from[0], y = to[1] - from[1], chord = Math.hypot(x, y)
  if (chord < 1e-9) return null
  const sweep = angle * Math.PI / 180, d = chord / 2 / Math.tan(sweep / 2)
  const center: Pt = [(from[0] + to[0]) / 2 + y / chord * d, (from[1] + to[1]) / 2 - x / chord * d]
  return { from: [...from], to: [...to], center, radius: distance(from, center), start: Math.atan2(-(from[1] - center[1]), from[0] - center[0]), sweep }
}

/** A point on the original curve, with 0 at its start and 1 at its end. */
export function arcPoint(from: Pt, to: Pt, angle: number, fraction: number): Pt | null {
  const arc = chainArc(from, to, angle)
  if (!arc || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null
  if (fraction === 0) return [...from]
  if (fraction === 1) return [...to]
  return pointAt(arc, fraction)
}

function pointAt(arc: Arc, fraction: number): Pt {
  const a = arc.start + arc.sweep * fraction
  return [arc.center[0] + arc.radius * Math.cos(a), arc.center[1] - arc.radius * Math.sin(a)]
}

/** The nearest point on the swept curve, including its endpoints rather than the unused circle. */
export function arcHit(from: Pt, to: Pt, angle: number, point: Pt): { point: Pt; fraction: number; distance: number } | null {
  const arc = chainArc(from, to, angle)
  if (!arc || !finite(point)) return null
  const a = Math.atan2(-(point[1] - arc.center[1]), point[0] - arc.center[0])
  const progress = turn(arc.sweep > 0 ? a - arc.start : arc.start - a), span = Math.abs(arc.sweep)
  const fraction = distance(point, arc.center) < 1e-9 ? 0.5 : progress <= span + 1e-12 ? Math.min(1, progress / span) : distance(point, from) <= distance(point, to) ? 0 : 1
  const projected = fraction === 0 ? [...from] as Pt : fraction === 1 ? [...to] as Pt : pointAt(arc, fraction)
  return { point: projected, fraction, distance: distance(point, projected) }
}

/** Split sweeps at the projected fraction; a snapped point may change shape while preserving the final endpoint. */
export function splitArc(from: Pt, to: Pt, angle: number, point: Pt): { point: Pt; projected: Pt; fraction: number; first: number; second: number } | null {
  const hit = arcHit(from, to, angle, point)
  if (!hit || hit.fraction <= 1e-8 || hit.fraction >= 1 - 1e-8 || distance(point, from) < 1e-9 || distance(point, to) < 1e-9) return null
  const first = angle * hit.fraction
  return { point: [...point], projected: hit.point, fraction: hit.fraction, first, second: angle - first }
}
