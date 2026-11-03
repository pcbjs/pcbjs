// Queries return indices in ascending order, so a loop over candidates visits pairs as a loop over every pair would.
import type { Pt, Ring } from '@pcbjs/core/model'
import { bbox, bboxOverlap, contactPoint, overlaps, SCALE } from './geom.js'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A box that no query returns, for an item without geometry. */
export const EMPTY: Box = Object.freeze({ x: 0, y: 0, w: -1, h: -1 })
const valid = (b: Box) => b.w >= 0 && b.h >= 0 && Number.isFinite(b.x + b.y + b.w + b.h)

/** Boxes larger than this many cells on a side skip the grid and are tested on every query. */
const BIG = 16

export class Grid {
  readonly boxes: Box[]
  private cell: number
  private x0: number
  private y0: number
  private cols: number
  private rows: number
  private cells: number[][]
  private big: number[] = []
  private stamp: Uint32Array
  private tick = 0

  /** `cell` is the grid pitch in the boxes' units; by default about the mean box size, at least the board over 1024. */
  constructor(boxes: Box[], cell?: number) {
    this.boxes = boxes
    this.stamp = new Uint32Array(boxes.length)
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      sum = 0,
      n = 0
    for (const b of boxes) {
      if (!valid(b)) continue
      if (b.x < x0) x0 = b.x
      if (b.y < y0) y0 = b.y
      if (b.x + b.w > x1) x1 = b.x + b.w
      if (b.y + b.h > y1) y1 = b.y + b.h
      sum += Math.max(b.w, b.h)
      n++
    }
    if (!n) {
      x0 = y0 = 0
      x1 = y1 = 1
    }
    const span = Math.max(x1 - x0, y1 - y0, 1e-6)
    this.cell = cell && cell > 0 ? cell : Math.max(n ? (2 * sum) / n : span, span / 1024, 1e-6)
    this.x0 = x0
    this.y0 = y0
    this.cols = Math.max(1, Math.floor((x1 - x0) / this.cell) + 1)
    this.rows = Math.max(1, Math.floor((y1 - y0) / this.cell) + 1)
    this.cells = Array.from({ length: this.cols * this.rows }, () => [])
    boxes.forEach((b, i) => {
      if (!valid(b)) return
      const c0 = this.col(b.x),
        c1 = this.col(b.x + b.w),
        r0 = this.row(b.y),
        r1 = this.row(b.y + b.h)
      if (c1 - c0 > BIG || r1 - r0 > BIG) {
        this.big.push(i)
        return
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(i)
    })
  }

  private col(x: number) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)))
  }
  private row(y: number) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)))
  }

  /** Indices of the boxes that overlap `q` grown by `pad`, touching included, ascending; empty boxes never match. */
  query(q: Box, pad = 0): number[] {
    const out: number[] = []
    if (++this.tick === 0xffffffff) {
      this.stamp.fill(0)
      this.tick = 1
    }
    const t = this.tick
    const test = (i: number) => {
      if (this.stamp[i] === t) return
      this.stamp[i] = t
      if (bboxOverlap(this.boxes[i], q, pad)) out.push(i)
    }
    for (const i of this.big) test(i)
    if (q.x - pad <= this.x0 + this.cols * this.cell && q.x + q.w + pad >= this.x0 && q.y - pad <= this.y0 + this.rows * this.cell && q.y + q.h + pad >= this.y0) {
      const c0 = this.col(q.x - pad),
        c1 = this.col(q.x + q.w + pad),
        r0 = this.row(q.y - pad),
        r1 = this.row(q.y + q.h + pad)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) for (const i of this.cells[r * this.cols + c]) test(i)
    }
    return out.sort((a, b) => a - b)
  }
}

export type Box4 = [number, number, number, number]
/** A ring set with a box per ring: the router's obstacles. */
export interface RingSet {
  rings: Ring[]
  boxes: Box4[]
}
export const ringSet = (rings: Ring[]): RingSet => ({ rings, boxes: rings.map(boxOf) })
export function boxOf(r: Ring): Box4 {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of r) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/** Twice the signed area of the triangle a, b, c: the side of a to b that c lies on, 0 on its line. */
export const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

/** Even-odd point in polygon set. */
export function inside(s: RingSet, x: number, y: number): boolean {
  let c = false
  for (let k = 0; k < s.rings.length; k++) {
    const b = s.boxes[k]
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue
    const r = s.rings[k]
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i],
        [xj, yj] = r[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
  }
  return c
}

/** Whether segments ab and cd cross or touch; collinear segments count whatever their overlap. */
export function segCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = orient(c[0], c[1], d[0], d[1], a[0], a[1]),
    d2 = orient(c[0], c[1], d[0], d[1], b[0], b[1]),
    d3 = orient(a[0], a[1], b[0], b[1], c[0], c[1]),
    d4 = orient(a[0], a[1], b[0], b[1], d[0], d[1])
  return (d1 > 0 !== d2 > 0 || d1 === 0 || d2 === 0) && (d3 > 0 !== d4 > 0 || d3 === 0 || d4 === 0)
}

/** True when the segment crosses or touches any ring edge of the set. */
export function hitsEdge(s: RingSet, a: Pt, b: Pt): boolean {
  const sx0 = Math.min(a[0], b[0]),
    sx1 = Math.max(a[0], b[0]),
    sy0 = Math.min(a[1], b[1]),
    sy1 = Math.max(a[1], b[1])
  for (let k = 0; k < s.rings.length; k++) {
    const bx = s.boxes[k]
    if (sx1 < bx[0] || sx0 > bx[2] || sy1 < bx[1] || sy0 > bx[3]) continue
    const r = s.rings[k]
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const p = r[i],
        q = r[j]
      if (Math.max(p[0], q[0]) < sx0 || Math.min(p[0], q[0]) > sx1 || Math.max(p[1], q[1]) < sy0 || Math.min(p[1], q[1]) > sy1) continue
      if (segCross(a, b, p, q)) return true
    }
  }
  return false
}

/** True when the segment ab has a point in the set: an end inside, or an edge crossed. */
export const segHits = (s: RingSet, a: Pt, b: Pt) => inside(s, a[0], a[1]) || inside(s, b[0], b[1]) || hitsEdge(s, a, b)

/** Ring sets up to this many rings are clipped whole; an index costs more than it saves. */
export const RING_INDEX_MIN = 16
/** Edge sets up to this many edges are scanned whole. */
const EDGE_GRID_MIN = 32
/** An edge whose box spans more cells than this is tested on every query instead. */
const LONG = 64

interface EdgeGrid {
  cell: number
  cols: number
  rows: number
  /** the edges of cell c are list[at[c]] to list[at[c + 1]] */
  at: Int32Array
  list: Int32Array
  long: Int32Array
}

/** A ring set with its edges in a grid, in Clipper's 10 nm units, for yes or no questions that need no boolean; `rings` stay as given for Clipper and witnesses. */
export class EdgeSet {
  readonly rings: Ring[]
  readonly box: Box
  readonly size: number
  /** vertices in 10 nm units, ring after ring; the edge k runs from vertex k to vertex next[k] */
  readonly xs: Float64Array
  readonly ys: Float64Array
  readonly next: Int32Array
  /** the first vertex of each ring, and each ring's box in units as x0, y0, x1, y1 */
  readonly starts: Int32Array
  readonly ringBoxes: Float64Array
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  private ringGrid?: Grid
  private grid?: EdgeGrid
  private stamp?: Uint32Array
  private tick = 0

  constructor(rings: Ring[]) {
    this.rings = rings
    this.box = bbox(rings)
    const n = rings.reduce((s, r) => s + r.length, 0)
    this.size = n
    this.xs = new Float64Array(n)
    this.ys = new Float64Array(n)
    this.next = new Int32Array(n)
    this.starts = new Int32Array(rings.length)
    this.ringBoxes = new Float64Array(4 * rings.length)
    let k = 0,
      bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity
    rings.forEach((r, i) => {
      this.starts[i] = k
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity
      for (let j = 0; j < r.length; j++, k++) {
        const x = Math.round(r[j][0] * SCALE),
          y = Math.round(r[j][1] * SCALE)
        this.xs[k] = x
        this.ys[k] = y
        this.next[k] = j + 1 < r.length ? k + 1 : k + 1 - r.length
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
      this.ringBoxes.set([x0, y0, x1, y1], 4 * i)
      if (x0 < bx0) bx0 = x0
      if (y0 < by0) by0 = y0
      if (x1 > bx1) bx1 = x1
      if (y1 > by1) by1 = y1
    })
    this.x0 = bx0
    this.y0 = by0
    this.x1 = bx1
    this.y1 = by1
  }

  /** The rings whose boxes overlap `q`, in order; under the nonzero rule they cover inside `q` what all rings cover. */
  near(q: Box): Ring[] {
    if (this.rings.length <= RING_INDEX_MIN) return this.rings
    this.ringGrid ??= new Grid(this.rings.map(r => bbox([r])))
    return this.ringGrid.query(q).map(i => this.rings[i])
  }

  /** Calls `fn` once with each edge whose box meets the box x0, y0, x1, y1 in units; true when `fn` stopped the walk by returning true. */
  edges(x0: number, y0: number, x1: number, y1: number, fn: (k: number) => boolean | void): boolean {
    if (x0 > this.x1 || x1 < this.x0 || y0 > this.y1 || y1 < this.y0) return false
    const { xs, ys, next } = this
    const meets = (k: number) => {
      const j = next[k]
      return Math.min(xs[k], xs[j]) <= x1 && Math.max(xs[k], xs[j]) >= x0 && Math.min(ys[k], ys[j]) <= y1 && Math.max(ys[k], ys[j]) >= y0
    }
    if (this.size <= EDGE_GRID_MIN) {
      for (let k = 0; k < this.size; k++) if (meets(k) && fn(k)) return true
      return false
    }
    const g = (this.grid ??= this.build())
    const stamp = this.stamp!
    if (++this.tick === 0xffffffff) {
      stamp.fill(0)
      this.tick = 1
    }
    const t = this.tick
    for (const k of g.long) if (meets(k) && fn(k)) return true
    const c0 = this.col(x0, g),
      c1 = this.col(x1, g),
      r0 = this.row(y0, g),
      r1 = this.row(y1, g)
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * g.cols + c
        for (let i = g.at[cell]; i < g.at[cell + 1]; i++) {
          const k = g.list[i]
          if (stamp[k] === t) continue
          stamp[k] = t
          if (meets(k) && fn(k)) return true
        }
      }
    return false
  }

  /** 1 when the point in units lies inside under the nonzero rule, as Clipper fills, 0 on an edge, -1 outside. */
  classify(px: number, py: number): number {
    if (px < this.x0 || px > this.x1 || py < this.y0 || py > this.y1) return -1
    const { xs, ys, next } = this
    let w = 0,
      on = false
    this.edges(px, py, this.x1, py, k => {
      const ax = xs[k],
        ay = ys[k],
        bx = xs[next[k]],
        by = ys[next[k]]
      const o = orient(ax, ay, bx, by, px, py)
      if (o === 0 && Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by)) return (on = true)
      if (ay <= py) {
        if (by > py && o > 0) w++
      } else if (by <= py && o < 0) w--
    })
    return on ? 0 : w !== 0 ? 1 : -1
  }

  private col(x: number, g: { cell: number; cols: number }) {
    return Math.min(g.cols - 1, Math.max(0, Math.floor((x - this.x0) / g.cell)))
  }
  private row(y: number, g: { cell: number; rows: number }) {
    return Math.min(g.rows - 1, Math.max(0, Math.floor((y - this.y0) / g.cell)))
  }

  /** About one cell per edge over the box, each edge listed in every cell its box meets. */
  private build(): EdgeGrid {
    const { xs, ys, next, size } = this
    const w = Math.max(this.x1 - this.x0, 1),
      h = Math.max(this.y1 - this.y0, 1)
    const cell = Math.max(Math.sqrt((w * h) / size), w / 2048, h / 2048, 1)
    const g = { cell, cols: Math.floor(w / cell) + 1, rows: Math.floor(h / cell) + 1 }
    const spans = new Int32Array(4 * size)
    const count = new Int32Array(g.cols * g.rows + 1),
      long: number[] = []
    for (let k = 0; k < size; k++) {
      const j = next[k]
      const c0 = this.col(Math.min(xs[k], xs[j]), g),
        c1 = this.col(Math.max(xs[k], xs[j]), g),
        r0 = this.row(Math.min(ys[k], ys[j]), g),
        r1 = this.row(Math.max(ys[k], ys[j]), g)
      spans.set([c0, c1, r0, r1], 4 * k)
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > LONG) {
        long.push(k)
        spans[4 * k] = -1
        continue
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * g.cols + c + 1]++
    }
    for (let i = 1; i < count.length; i++) count[i] += count[i - 1]
    const list = new Int32Array(count[count.length - 1]),
      fill = count.slice()
    for (let k = 0; k < size; k++) {
      const c0 = spans[4 * k]
      if (c0 < 0) continue
      const c1 = spans[4 * k + 1],
        r0 = spans[4 * k + 2],
        r1 = spans[4 * k + 3]
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) list[fill[r * g.cols + c]++] = k
    }
    this.stamp = new Uint32Array(size)
    return { ...g, at: count, list, long: Int32Array.from(long) }
  }
}

/** How segments pq and uv meet: 2 when they cross at a point inside both, 1 when they only touch or run along each other, 0 when apart. */
function meet(px: number, py: number, qx: number, qy: number, ux: number, uy: number, vx: number, vy: number): number {
  const d1 = orient(ux, uy, vx, vy, px, py),
    d2 = orient(ux, uy, vx, vy, qx, qy),
    d3 = orient(px, py, qx, qy, ux, uy),
    d4 = orient(px, py, qx, qy, vx, vy)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 2
  if (
    (d1 === 0 && onSeg(ux, uy, vx, vy, px, py)) ||
    (d2 === 0 && onSeg(ux, uy, vx, vy, qx, qy)) ||
    (d3 === 0 && onSeg(px, py, qx, qy, ux, uy)) ||
    (d4 === 0 && onSeg(px, py, qx, qy, vx, vy))
  )
    return 1
  return 0
}
/** Whether x, y, on the line through a and b, lies between them. */
const onSeg = (ax: number, ay: number, bx: number, by: number, x: number, y: number) =>
  Math.min(ax, bx) <= x && x <= Math.max(ax, bx) && Math.min(ay, by) <= y && y <= Math.max(ay, by)

/** Visits the edges of the smaller set against the other's edges within `pad()` units of them; `fn` stops the walk by returning true. */
function pairs(a: EdgeSet, b: EdgeSet, pad: () => number, fn: (s: EdgeSet, k: number, t: EdgeSet, m: number) => boolean): void {
  const [s, t] = a.size <= b.size ? [a, b] : [b, a]
  const p = pad()
  s.edges(t.x0 - p, t.y0 - p, t.x1 + p, t.y1 + p, k => {
    const j = s.next[k],
      d = pad()
    return t.edges(Math.min(s.xs[k], s.xs[j]) - d, Math.min(s.ys[k], s.ys[j]) - d, Math.max(s.xs[k], s.xs[j]) + d, Math.max(s.ys[k], s.ys[j]) + d, m => fn(s, k, t, m))
  })
}

/** The most two sets' edges do: 2 when two cross, 1 when some only touch, 0 when none meet. */
function contact(a: EdgeSet, b: EdgeSet): number {
  let found = 0
  pairs(
    a,
    b,
    () => 0,
    (s, k, t, m) => {
      const j = s.next[k],
        n = t.next[m]
      found = Math.max(found, meet(s.xs[k], s.ys[k], s.xs[j], s.ys[j], t.xs[m], t.ys[m], t.xs[n], t.ys[n]))
      return found === 2
    },
  )
  return found
}

/** Whether a ring of `t` near `s` has its first vertex inside `s`: when no edges meet, the one way a set holds part of the other. */
function holds(s: EdgeSet, t: EdgeSet): boolean {
  for (let i = 0; i < t.starts.length; i++) {
    const b = 4 * i,
      v = t.starts[i]
    if (v === (i + 1 < t.starts.length ? t.starts[i + 1] : t.size)) continue
    if (t.ringBoxes[b] > s.x1 || t.ringBoxes[b + 2] < s.x0 || t.ringBoxes[b + 1] > s.y1 || t.ringBoxes[b + 3] < s.y0) continue
    if (s.classify(t.xs[v], t.ys[v]) > 0) return true
  }
  return false
}

/** overlaps() of two sets: with no edges meeting and no vertex held they share no area, else Clipper's boolean on their nearby rings decides with its 1e-9 mm² rule. */
export function overlap(a: EdgeSet, b: EdgeSet): boolean {
  if (!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1)) return false
  if (!contact(a, b) && !holds(a, b) && !holds(b, a)) return false
  return overlaps(a.near(b.box), b.near(a.box))
}

/** The gap between segments pq and uv, 0 when they cross. */
export function segGap(px: number, py: number, qx: number, qy: number, ux: number, uy: number, vx: number, vy: number): number {
  const d1 = orient(ux, uy, vx, vy, px, py),
    d2 = orient(ux, uy, vx, vy, qx, qy),
    d3 = orient(px, py, qx, qy, ux, uy),
    d4 = orient(px, py, qx, qy, vx, vy)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(pointGap(px, py, ux, uy, vx, vy), pointGap(qx, qy, ux, uy, vx, vy), pointGap(ux, uy, px, py, qx, qy), pointGap(vx, vy, px, py, qx, qy))
}
function pointGap(x: number, y: number, ux: number, uy: number, vx: number, vy: number): number {
  const dx = vx - ux,
    dy = vy - uy,
    n = dx * dx + dy * dy
  const t = n ? Math.max(0, Math.min(1, ((x - ux) * dx + (y - uy) * dy) / n)) : 0
  return Math.hypot(x - ux - t * dx, y - uy - t * dy)
}
export const segDist = (p: Pt, q: Pt, a: Pt, b: Pt): number => segGap(p[0], p[1], q[0], q[1], a[0], a[1], b[0], b[1])

/** The gap between two sets edge to edge in mm, up to `limit`, 0 when they overlap or touch; the walk ends once the gap is under `stop`. */
export function distance(a: EdgeSet, b: EdgeSet, limit: number, stop = 0): number {
  const lim = limit * SCALE,
    end = stop * SCALE
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1),
    dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1)
  if (!a.size || !b.size || Math.hypot(dx, dy) >= lim) return limit
  let best = lim
  pairs(
    a,
    b,
    () => best,
    (s, k, t, m) => {
      const j = s.next[k],
        n = t.next[m]
      best = Math.min(best, segGap(s.xs[k], s.ys[k], s.xs[j], s.ys[j], t.xs[m], t.ys[m], t.xs[n], t.ys[n]))
      return best < end || best === 0
    },
  )
  if (best > 0 && (holds(a, b) || holds(b, a))) return 0
  return best < lim ? best / SCALE : limit
}

/** Whether two sets come closer than `d` mm edge to edge, or one holds part of the other. */
export const within = (a: EdgeSet, b: EdgeSet, d: number): boolean => distance(a, b, d, d) < d

/** Whether a point lies inside a set of rings, even-odd, so the holes of a polygon count as outside. */
export function inRings(p: Pt, rings: Ring[]): boolean {
  let n = false
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n = !n
  return n
}

/** The edges of a set of rings, each closed. */
export function* ringEdges(rings: Ring[]): Generator<[Pt, Pt]> {
  for (const r of rings) for (let i = 0; i < r.length; i++) yield [r[i], r[(i + 1) % r.length]]
}

/** The measured gap between two shapes, edge to edge: 0 when they touch or one contains the other. */
export function ringsGap(a: Ring[], b: Ring[]): number {
  if (!a.length || !b.length) return 0
  if ((a[0][0] && inRings(a[0][0], b)) || (b[0][0] && inRings(b[0][0], a))) return 0
  let d = Infinity
  const eb = [...ringEdges(b)]
  for (const [p, q] of ringEdges(a)) for (const [u, v] of eb) d = Math.min(d, segDist(p, q, u, v))
  return d === Infinity ? 0 : d
}

/** The witness of a gap: the nearest points of two sets' edges in mm as given, and the measured gap; 0 and no points for an empty set. */
export function gap(a: EdgeSet, b: EdgeSet): { d: number; pts: Pt[] } {
  let best = { d: Infinity, pts: [] as Pt[] }
  for (const [p, q] of ringEdges(a.rings))
    for (const [u, v] of ringEdges(b.rings)) {
      const c = segClosest(p, q, u, v)
      if (c.d < best.d) best = c
    }
  return best.d === Infinity ? { d: 0, pts: [] } : { d: ringsGap(a.rings, b.rings), pts: best.pts }
}

function segClosest(p: Pt, q: Pt, a: Pt, b: Pt): { d: number; pts: Pt[] } {
  const foot = (x: Pt, u: Pt, v: Pt): Pt => {
    const dx = v[0] - u[0],
      dy = v[1] - u[1],
      n = dx * dx + dy * dy
    const t = n ? Math.max(0, Math.min(1, ((x[0] - u[0]) * dx + (x[1] - u[1]) * dy) / n)) : 0
    return [u[0] + t * dx, u[1] + t * dy]
  }
  let best = { d: Infinity, pts: [] as Pt[] }
  for (const [x, y] of [
    [p, foot(p, a, b)],
    [q, foot(q, a, b)],
    [foot(a, p, q), a],
    [foot(b, p, q), b],
  ] as [Pt, Pt][]) {
    const d = Math.hypot(x[0] - y[0], x[1] - y[1])
    if (d < best.d) best = { d, pts: [x, y] }
  }
  return best
}

/** overlaps() of two sets, clipping each only against the other's nearby rings, Clipper's answer for a witness or a band the edges leave open. */
export function overlapsNear(a: EdgeSet, b: EdgeSet): boolean {
  if (!bboxOverlap(a.box, b.box)) return false
  return overlaps(a.near(b.box), b.near(a.box))
}

/** contactPoint() of two sets that overlap. */
export function contactNear(a: EdgeSet, b: EdgeSet): Pt {
  return contactPoint(a.near(b.box), b.near(a.box))
}
