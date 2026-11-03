// The geometry the board API measures: each thing as rings, polylines and points grown by a radius, a track being its centre line and half its width.
import type { Item, Pt, Ring } from '@pcbjs/core/model'

export interface Shape {
  /** closed rings: a point inside one is at distance 0 */
  polys: Ring[]
  lines: Ring[]
  points: Pt[]
  /** mm the core geometry is grown by */
  r: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const pointShape = (p: Pt): Shape => ({ polys: [], lines: [], points: [p], r: 0 })

/** The copper or ink of an item as the checks see it. */
export function itemShape(it: Item): Shape {
  switch (it.kind) {
    case 'pad':
      return { polys: [it.poly], lines: [], points: [], r: 0 }
    case 'track':
      return { polys: [], lines: [it.pts], points: [], r: it.width / 2 }
    case 'via':
      return { polys: [], lines: [], points: [it.at], r: it.size / 2 }
    case 'zone':
      return { polys: it.fill.length ? it.fill.map(p => p.outer) : it.outline, lines: [], points: [], r: 0 }
    case 'text':
      return it.polys?.length ? { polys: it.polys.map(p => p.outer), lines: [], points: [], r: 0 } : { polys: [], lines: it.strokes, points: [], r: it.thickness / 2 }
    case 'graphic':
      return it.fill ? { polys: it.paths, lines: [], points: [], r: it.width / 2 } : { polys: [], lines: it.paths, points: [], r: it.width / 2 }
  }
}

export function boxOf(s: Shape): Box | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const p of vertices(s)) {
    x0 = Math.min(x0, p[0])
    y0 = Math.min(y0, p[1])
    x1 = Math.max(x1, p[0])
    y1 = Math.max(y1, p[1])
  }
  if (x0 > x1) return null
  return { x: x0 - s.r, y: y0 - s.r, w: x1 - x0 + 2 * s.r, h: y1 - y0 + 2 * s.r }
}

export function unionBox(bs: (Box | null)[]): Box | null {
  const ok = bs.filter((b): b is Box => !!b)
  if (!ok.length) return null
  const x = Math.min(...ok.map(b => b.x)),
    y = Math.min(...ok.map(b => b.y))
  return { x, y, w: Math.max(...ok.map(b => b.x + b.w)) - x, h: Math.max(...ok.map(b => b.y + b.h)) - y }
}

export const boxesMeet = (a: Box, b: Box, gap = 0): boolean => a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h

function inside(p: Pt, r: Ring): boolean {
  let hit = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i],
      [xj, yj] = r[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The point of segment ab nearest p. */
function nearOn(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
  return [a[0] + t * dx, a[1] + t * dy]
}

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

function crossing(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b[0] - a[0],
    ry = b[1] - a[1],
    sx = d[0] - c[0],
    sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (!den) return null
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den,
    u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * rx, a[1] + t * ry] : null
}

type Seg = [Pt, Pt]
function segs(s: Shape): Seg[] {
  const out: Seg[] = []
  for (const r of s.polys) for (let i = 0; i < r.length; i++) out.push([r[i], r[(i + 1) % r.length]])
  for (const l of s.lines) {
    if (l.length === 1) out.push([l[0], l[0]])
    for (let i = 0; i + 1 < l.length; i++) out.push([l[i], l[i + 1]])
  }
  for (const p of s.points) out.push([p, p])
  return out
}

const vertices = (s: Shape): Pt[] => [...s.polys.flat(), ...s.lines.flat(), ...s.points]

/** The closest points of the two core geometries and their distance, 0 when they cross or one holds the other. */
function core(a: Shape, b: Shape): { d: number; a: Pt; b: Pt } {
  for (const ring of a.polys) for (const p of vertices(b)) if (inside(p, ring)) return { d: 0, a: p, b: p }
  for (const ring of b.polys) for (const p of vertices(a)) if (inside(p, ring)) return { d: 0, a: p, b: p }
  let best = { d: Infinity, a: [0, 0] as Pt, b: [0, 0] as Pt }
  const sb = segs(b)
  for (const [p, q] of segs(a))
    for (const [u, v] of sb) {
      const x = crossing(p, q, u, v)
      if (x) return { d: 0, a: x, b: x }
      for (const m of [p, q]) {
        const n = nearOn(m, u, v)
        if (d2(m, n) < best.d) best = { d: d2(m, n), a: m, b: n }
      }
      for (const m of [u, v]) {
        const n = nearOn(m, p, q)
        if (d2(m, n) < best.d) best = { d: d2(m, n), a: n, b: m }
      }
    }
  return { d: Math.sqrt(best.d), a: best.a, b: best.b }
}

/** Edge to edge: the core distance less both radii, at least 0, with the nearest point on each grown edge. */
export function distance(a: Shape, b: Shape): { d: number; a: Pt; b: Pt } {
  const c = core(a, b)
  if (!Number.isFinite(c.d) || !c.d) return { d: Number.isFinite(c.d) ? 0 : Infinity, a: c.a, b: c.b }
  const d = Math.max(0, c.d - a.r - b.r)
  const ux = (c.b[0] - c.a[0]) / c.d,
    uy = (c.b[1] - c.a[1]) / c.d
  const ra = Math.min(a.r, c.d),
    rb = Math.min(b.r, c.d - ra)
  return { d, a: [c.a[0] + ux * ra, c.a[1] + uy * ra], b: [c.b[0] - ux * rb, c.b[1] - uy * rb] }
}
