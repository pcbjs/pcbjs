// Board mm, y down.
import type { Prim, Pt } from '@pcbjs/core/model'
import { primsLength } from './round.js'
import type { Stackup } from '@pcbjs/core/types'

/** Which side of a segment, relative to its direction of travel on a y-down screen; left is the normal [dy, -dx]. */
export type Side = 'left' | 'right'

/** True when a track of this width and net may pass through (x, y) on the layer. */
export type IsFree = (layer: string, x: number, y: number, net: string | undefined, width: number) => boolean

/** mm, segment i running from pts[i] to pts[i + 1]. */
export function segmentLengths(pts: Pt[]): number[] {
  const out: number[] = []
  for (let i = 1; i < pts.length; i++) out.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return out
}

export function polylineLength(pts: Pt[]): number {
  return segmentLengths(pts).reduce((s, l) => s + l, 0)
}

const thick = (l: Stackup['layers'][number]) => ('thickness' in l && typeof l.thickness === 'number' ? l.thickness : 0)

/** The board thickness strictly between the two copper layers a via joins, mm; a number stackup is the board thickness. */
export function viaLength(layers: readonly [string, string], stackup: Stackup | number): number {
  if (layers[0] === layers[1]) return 0
  const total = (s: Stackup) => s.thickness ?? (s.layers.reduce((a, l) => a + thick(l), 0) || 1.6)
  if (typeof stackup === 'number') return stackup
  const idx = (name: string) => stackup.layers.findIndex(l => l.type === 'copper' && l.name === name)
  const a = idx(layers[0]),
    b = idx(layers[1])
  if (a < 0 || b < 0) return total(stackup)
  let s = 0
  for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) s += thick(stackup.layers[i])
  return s
}

/** Track lengths, along their arcs when they have prims, plus `viaLength` for every via, mm. */
export function routeLength(tracks: readonly { pts: Pt[]; prims?: Prim[] }[], vias: readonly { layers: readonly [string, string] }[], stackup: Stackup | number): number {
  let s = 0
  for (const t of tracks) s += t.prims?.length ? primsLength(t.prims) : polylineLength(t.pts)
  for (const v of vias) s += viaLength(v.layers, stackup)
  return s
}

/** The stretch of one segment with room for a meander. */
export interface FreeSpan {
  /** the segment runs from pts[index] to pts[index + 1] */
  index: number
  side: Side
  /** distance in mm from pts[index] along the segment where the free stretch starts and ends */
  from: number
  to: number
  a: Pt
  b: Pt
  /** to - from, mm */
  length: number
}

export interface FreeOptions {
  layer: string
  /** the net of the polyline; isFree lets a track cross copper of its own net */
  net?: string
  /** sample step in mm along and across the segment; default width / 2 clamped to 0.02 to 0.1 */
  step?: number
  /** the meander must also keep this far, edge to edge, from the other segments of the same polyline; default the width */
  clearance?: number
  /** only the segments this accepts are searched, by index; default every segment */
  only?: (index: number) => boolean
}

/** The longest run of free columns `amplitude` mm deep beside any segment and side of a polyline, first on a tie. */
export function longestFreeSegment(pts: Pt[], isFree: IsFree, width: number, amplitude: number, opts: FreeOptions): FreeSpan | null {
  const step = opts.step ?? Math.min(0.1, Math.max(0.02, width / 2))
  const keep = width + (opts.clearance ?? width)
  const M = Math.max(1, Math.ceil(amplitude / step - 1e-9))
  let best: FreeSpan | null = null
  for (let i = 0; i < pts.length - 1; i++) {
    if (opts.only && !opts.only(i)) continue
    const a = pts[i],
      b = pts[i + 1]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 1e-9) continue
    const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L],
      nl: Pt = [u[1], -u[0]]
    const K = Math.max(1, Math.ceil(L / step - 1e-9))
    for (const side of ['left', 'right'] as Side[]) {
      const sg = side === 'left' ? 1 : -1
      const far: Pt = [nl[0] * sg * amplitude, nl[1] * sg * amplitude]
      const bx0 = Math.min(a[0], b[0], a[0] + far[0], b[0] + far[0]) - keep,
        bx1 = Math.max(a[0], b[0], a[0] + far[0], b[0] + far[0]) + keep
      const by0 = Math.min(a[1], b[1], a[1] + far[1], b[1] + far[1]) - keep,
        by1 = Math.max(a[1], b[1], a[1] + far[1], b[1] + far[1]) + keep
      const others: number[] = []
      for (let j = 0; j < pts.length - 1; j++) {
        if (j === i) continue
        const p = pts[j],
          q = pts[j + 1]
        if (Math.max(p[0], q[0]) >= bx0 && Math.min(p[0], q[0]) <= bx1 && Math.max(p[1], q[1]) >= by0 && Math.min(p[1], q[1]) <= by1) others.push(j)
      }
      let runStart = -1
      const columnFree = (k: number) => {
        const s = (L * k) / K
        for (let m = 1; m <= M; m++) {
          const t = (amplitude * m) / M
          const p: Pt = [a[0] + u[0] * s + nl[0] * sg * t, a[1] + u[1] * s + nl[1] * sg * t]
          if (!isFree(opts.layer, p[0], p[1], opts.net, width)) return false
          for (const j of others) if (segDist(p, pts[j], pts[j + 1]) < keep - 1e-9) return false
        }
        return true
      }
      const close = (k0: number, k1: number) => {
        const from = (L * k0) / K,
          to = (L * k1) / K
        if (to - from > 1e-9 && (!best || to - from > best.length + 1e-9))
          best = { index: i, side, from, to, a: [a[0] + u[0] * from, a[1] + u[1] * from], b: [a[0] + u[0] * to, a[1] + u[1] * to], length: to - from }
      }
      for (let k = 0; k <= K; k++) {
        if (columnFree(k)) {
          if (runStart < 0) runStart = k
        } else if (runStart >= 0) {
          close(runStart, k - 1)
          runStart = -1
        }
      }
      if (runStart >= 0) close(runStart, K)
    }
  }
  return best
}

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Replaces a stretch of segment `index` by `replacement`, whose ends lie on that segment in order. */
export function spliceSegment(pts: Pt[], index: number, replacement: Pt[]): Pt[] {
  const out = [...pts.slice(0, index + 1), ...replacement, ...pts.slice(index + 1)]
  return out.filter((p, k) => k === 0 || Math.hypot(p[0] - out[k - 1][0], p[1] - out[k - 1][1]) > 1e-9)
}

/** How far a track centred at (x, y) may move and stay free, mm, negative where it may not pass. */
export type Slack = (layer: string, x: number, y: number, width: number) => number

/** The free height of a column across one side of a segment, every `step` mm along it. */
export interface Room {
  index: number
  side: Side
  a: Pt
  b: Pt
  layer: string
  /** column k stands at k * len / (depth.length - 1) from a */
  len: number
  /** free height of each column, centre line to centre line, up to the reach */
  depth: Float64Array
}

/** The room beside segment `index` on `side`, up to `reach` mm out, striding by the slack where the board is open. */
export function segmentRoom(pts: Pt[], index: number, side: Side, slack: Slack, width: number, reach: number, opts: { layer: string; step?: number; clearance?: number }): Room {
  const step = opts.step ?? 0.1,
    keep = width + (opts.clearance ?? width)
  const a = pts[index],
    b = pts[index + 1]
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const K = Math.max(1, Math.ceil(L / step - 1e-9))
  const depth = new Float64Array(K + 1)
  const room: Room = { index, side, a, b, layer: opts.layer, len: L, depth }
  if (L < 1e-9) return room
  const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L],
    sg = side === 'left' ? 1 : -1,
    n: Pt = [u[1] * sg, -u[0] * sg]
  const far: Pt = [n[0] * reach, n[1] * reach]
  const bx0 = Math.min(a[0], b[0], a[0] + far[0], b[0] + far[0]) - keep,
    bx1 = Math.max(a[0], b[0], a[0] + far[0], b[0] + far[0]) + keep
  const by0 = Math.min(a[1], b[1], a[1] + far[1], b[1] + far[1]) - keep,
    by1 = Math.max(a[1], b[1], a[1] + far[1], b[1] + far[1]) + keep
  const others: number[] = []
  for (let j = 0; j < pts.length - 1; j++) {
    if (j === index) continue
    const p = pts[j],
      q = pts[j + 1]
    if (Math.max(p[0], q[0]) >= bx0 && Math.min(p[0], q[0]) <= bx1 && Math.max(p[1], q[1]) >= by0 && Math.min(p[1], q[1]) <= by1) others.push(j)
  }
  for (let k = 0; k <= K; k++) {
    const s = (L * k) / K,
      x0 = a[0] + u[0] * s,
      y0 = a[1] + u[1] * s
    let t = Math.min(step, reach),
      d = 0
    for (;;) {
      const p: Pt = [x0 + n[0] * t, y0 + n[1] * t]
      let sl = slack(opts.layer, p[0], p[1], width)
      for (const j of others) {
        const e = segDist(p, pts[j], pts[j + 1]) - keep
        if (e < sl) sl = e
      }
      if (sl < -1e-9) break
      if (t + sl >= reach - 1e-9) {
        d = reach
        break
      }
      d = t + Math.max(0, sl)
      t = Math.min(reach, t + Math.max(step, sl))
    }
    depth[k] = d
  }
  return room
}

/** The longest run of columns of a room free to `height`, as a FreeSpan, or null when no column is. */
export function roomRun(room: Room, height: number): FreeSpan | null {
  const K = room.depth.length - 1,
    L = room.len
  let best: FreeSpan | null = null,
    start = -1
  const close = (k0: number, k1: number) => {
    const from = (L * k0) / K,
      to = (L * k1) / K
    if (to - from > 1e-9 && (!best || to - from > best.length + 1e-9)) {
      const u: Pt = [(room.b[0] - room.a[0]) / L, (room.b[1] - room.a[1]) / L]
      best = {
        index: room.index,
        side: room.side,
        from,
        to,
        a: [room.a[0] + u[0] * from, room.a[1] + u[1] * from],
        b: [room.a[0] + u[0] * to, room.a[1] + u[1] * to],
        length: to - from,
      }
    }
  }
  for (let k = 0; k <= K; k++) {
    if (room.depth[k] >= height - 1e-9) {
      if (start < 0) start = k
    } else if (start >= 0) {
      close(start, k - 1)
      start = -1
    }
  }
  if (start >= 0) close(start, K)
  return best
}
