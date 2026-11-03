// The snap service of the tools, free of Vue and the DOM: grid points, subdivision levels, rotation stops and magnets; board mm and degrees.
import { subdivisionLimit } from '@pcbjs/core/internal/grid'

type Pt = [number, number]

/** A grid as the board data carries it, see GridRecord in @pcbjs/core/model. */
export interface SnapGrid {
  name: string
  pitch: number
  minor: number[]
  maxLevel?: number
  level?: number
  origin: Pt
  angle: number
  mirror: boolean
}
/** The board's default editing grid, in millimetres. */
export const MM_GRID: SnapGrid = { name: 'mm', pitch: 1, minor: [], origin: [0, 0], angle: 0, mirror: false }
/** `fine` one subdivision or rotation stop finer, `free` no snapping */
export interface SnapMods {
  fine: boolean
  free: boolean
}
/** A drag of a part, an instance or a control point: shift lifts snapping, cmd or ctrl locks it to the axis it moved most along. */
export interface DragMods extends SnapMods {
  axis: boolean
}
export const dragMods = (shift: boolean, deep: boolean): DragMods => ({ fine: false, free: shift, axis: deep })
/** `to` kept on the axis through `from` along which it moved most. */
export const onAxis = (from: Pt, to: Pt): Pt => (Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]])

/** degrees between rotation stops: 15 on the ring, 5 with shift; `R` turns 90 */
export const RING_STOP = 15
export const FINE_STOP = 5
export const KEY_TURN = 90
/** screen pixels within which a control point takes a pad centre or a point of its net before the grid */
export const MAGNET_PX = 8

const rad = (d: number) => (d * Math.PI) / 180
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0

/** The step of a subdivision level: 0 the pitch, each level divided by the next factor of `minor`, past them by halves. */
export function stepOf(g: SnapGrid, level: number): number {
  let s = g.pitch
  for (let i = 0; i < Math.min(level, subdivisionLimit(g.maxLevel)); i++) s /= g.minor[i] ?? 2
  return s
}
/** The level a drag snaps at: the first subdivision of `minor`, else the pitch; shift one finer. */
export const levelOf = (g: SnapGrid, fine: boolean): number => Math.min(subdivisionLimit(g.maxLevel), (g.level ?? (g.minor.length ? 1 : 0)) + (fine ? 1 : 0))

/** A board point in the grid's frame, mm along its axes, and back. */
export function toGrid(g: SnapGrid, p: Pt): Pt {
  const a = rad(g.angle),
    x = p[0] - g.origin[0],
    y = p[1] - g.origin[1]
  // the inverse of a turn counter-clockwise on screen, y down
  const u = x * Math.cos(a) - y * Math.sin(a),
    v = x * Math.sin(a) + y * Math.cos(a)
  return [g.mirror ? -u : u, v]
}
export function fromGrid(g: SnapGrid, q: Pt): Pt {
  const a = rad(g.angle),
    u = g.mirror ? -q[0] : q[0],
    v = q[1]
  return [g.origin[0] + u * Math.cos(a) + v * Math.sin(a), g.origin[1] - u * Math.sin(a) + v * Math.cos(a)]
}

/** A point snapped to the grid at the level the mods give; free rounds to 1 µm; no grid leaves it free. */
export function snapPoint(g: SnapGrid | null, p: Pt, m: SnapMods): Pt {
  if (!g || m.free) return [r3(p[0]), r3(p[1])]
  const s = stepOf(g, levelOf(g, m.fine))
  const q = toGrid(g, p)
  const out = fromGrid(g, [Math.round(q[0] / s) * s, Math.round(q[1] / s) * s])
  return [r3(out[0]), r3(out[1])]
}

/** A component's new origin snapped to its grid's lattice through where the component was, as its dots show it: off the grid it stays off by as much. */
export const snapFrom = (g: SnapGrid | null, from: Pt, p: Pt, m: SnapMods): Pt => snapPoint(g && { ...g, origin: from }, p, m)

/** A turn snapped to the ring's stops, counted from the grid's angle so the result lands on a stop; free rounds to 0.1 degree. */
export function snapAngle(deg: number, m: SnapMods, from = 0, base = 0): number {
  if (m.free) return Math.round(deg * 10) / 10
  const stop = m.fine ? FINE_STOP : RING_STOP
  const to = Math.round((from + deg - base) / stop) * stop + base
  return Math.round((to - from) * 1000) / 1000 || 0
}

/** The nearest magnet within `tol` mm of `p`, else null. */
export function magnet(p: Pt, candidates: readonly Pt[], tol: number): Pt | null {
  let best: Pt | null = null,
    d = tol
  for (const c of candidates) {
    const e = Math.hypot(c[0] - p[0], c[1] - p[1])
    if (e <= d) {
      d = e
      best = c
    }
  }
  return best
}

/** A control point's place: a magnet first, else the grid. */
export function snapControl(g: SnapGrid | null, p: Pt, m: SnapMods, magnets: readonly Pt[], tol: number): Pt {
  const hit = m.free ? null : magnet(p, magnets, tol)
  return hit ? [r3(hit[0]), r3(hit[1])] : snapPoint(g, p, m)
}

/** The angle of `p` about `c`, degrees counter-clockwise on screen. */
export const angleAt = (c: Pt, p: Pt): number => (-Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI

/** The coarsest allowed subdivision containing this point, without rounding it onto the grid. */
export function alignedLevel(g: SnapGrid, point: Pt): number | null {
  const q = toGrid(g, point)
  for (let level = 0; level <= subdivisionLimit(g.maxLevel); level++) {
    const step = stepOf(g, level)
    if (q.every(v => Math.abs(v - Math.round(v / step) * step) <= Math.min(1e-6, step * 1e-5))) return level
  }
  return null
}
