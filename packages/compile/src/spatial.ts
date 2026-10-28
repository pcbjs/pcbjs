// Queries return indices in ascending order, so a loop over candidates visits pairs as a loop over every pair would.
import type { Pt, Ring } from '@pcbjs/core/model'
import { bbox, bboxOverlap, contactPoint, overlaps } from './geom.js'

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

/** The rings of a large polygon set with a grid over their boxes, to clip an item only against the rings near it. */
export class RingIndex {
  readonly rings: Ring[]
  readonly box: Box
  private grid: Grid | null

  constructor(rings: Ring[]) {
    this.rings = rings
    this.box = bbox(rings)
    this.grid = rings.length > RING_INDEX_MIN ? new Grid(rings.map(r => bbox([r]))) : null
  }

  /** The rings whose boxes overlap `q`, in order; under the nonzero rule they cover inside `q` what all rings cover. */
  near(q: Box): Ring[] {
    if (!this.grid) return this.rings
    return this.grid.query(q).map(i => this.rings[i])
  }
}

/** Ring sets up to this many rings are clipped whole; an index costs more than it saves. */
export const RING_INDEX_MIN = 16

/** Two ring sets restricted to each other's box: what they share is unchanged, the far rings of a pour are dropped. */
function window(a: RingIndex, b: RingIndex): [Ring[], Ring[]] {
  return [a.near(b.box), b.near(a.box)]
}

/** overlaps() of two indexed ring sets, clipping each only against the other's nearby rings. */
export function overlapsNear(a: RingIndex, b: RingIndex): boolean {
  if (!bboxOverlap(a.box, b.box)) return false
  const [ra, rb] = window(a, b)
  return overlaps(ra, rb)
}

/** contactPoint() of two indexed ring sets that overlap. */
export function contactNear(a: RingIndex, b: RingIndex): Pt {
  const [ra, rb] = window(a, b)
  return contactPoint(ra, rb)
}
