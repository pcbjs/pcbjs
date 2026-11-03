// The assist mode's preview: the trace a dot would write, straight for L, H and V or one automatic leg for X against the current copper,
// and the clearance it breaks; the argument a pick writes; see docs/editing.md, Assist.
import type { Board, Item, Pt } from '@pcbjs/core/model'
import { copperLayers } from '@pcbjs/core/internal/layers'
import { buildLayout, maze, ObstacleWorld, solidRings } from '@pcbjs/compile/internal/autoroute'
import { padLabel } from '@pcbjs/compile/internal/drc'
import type { AssistContext, AssistPreview } from '@pcbjs/core/protocol'

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0
const f3 = (v: number) => String(r3(v))

/** The end of the segment a dot at `at` gives: H keeps the start's y, V its x. */
export function endOf(command: string, start: Pt, at: Pt): Pt {
  const up = command.toUpperCase()
  if (up === 'H') return [at[0], start[1]]
  if (up === 'V') return [start[0], at[1]]
  return at
}

/** The argument text a dot writes for a command, in the route's frame: absolute for upper case, relative to `start` for lower. */
export function argOf(command: string, start: Pt, at: Pt): string {
  const e = endOf(command, start, at)
  const d: Pt = [e[0] - start[0], e[1] - start[1]]
  switch (command) {
    case 'H':
      return f3(e[0])
    case 'h':
      return f3(d[0])
    case 'V':
      return f3(e[1])
    case 'v':
      return f3(d[1])
    case 'L':
      return `${f3(e[0])}, ${f3(e[1])}`
    case 'l':
      return `${f3(d[0])}, ${f3(d[1])}`
    default:
      return `'${f3(e[0])} ${f3(e[1])}'`
  }
}

/** Distance from p to segment ab. */
function toSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy
  const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(a[0] + s * dx - p[0], a[1] + s * dy - p[1])
}
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}
function inRing(p: Pt, r: Pt[]): boolean {
  let n = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n = !n
  return n
}
/** The gap between a segment and a ring's copper, 0 when they touch. */
export function gapTo(a: Pt, b: Pt, ring: Pt[]): number {
  if (inRing(a, ring) || inRing(b, ring)) return 0
  let d = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (crosses(a, b, ring[j], ring[i])) return 0
    d = Math.min(d, toSeg(ring[i], a, b), toSeg(a, ring[j], ring[i]), toSeg(b, ring[j], ring[i]))
  }
  return d
}

const nameOf = (it: Item): string =>
  it.kind === 'pad' ? padLabel(it) : it.kind === 'via' ? `a via at (${f3(it.at[0])}, ${f3(it.at[1])})` : `a track of ${it.kind === 'track' && it.route ? it.route : 'drawn copper'}`

/** Each item of another net the trace comes nearer than the clearance, and the outline it leaves. */
export function clashes(board: Board, tracks: AssistPreview['tracks'], net: string | null, width: number): string[] {
  const c = board.rules.clearance
  const out: string[] = []
  for (const t of tracks)
    for (const it of board.items) {
      if (it.kind !== 'pad' && it.kind !== 'track' && it.kind !== 'via') continue
      if (it.net !== undefined && it.net === net) continue
      for (const ring of solidRings(it, t.layer)) {
        let gap = Infinity
        for (let i = 1; i < t.pts.length; i++) gap = Math.min(gap, gapTo(t.pts[i - 1], t.pts[i], ring) - width / 2)
        if (gap < c - 1e-6) {
          out.push(`clearance: ${f3(Math.max(0, gap))} mm to ${nameOf(it)}${it.net ? ` (${it.net})` : ''} on ${t.layer}, needs ${f3(c)} mm`)
          break
        }
      }
    }
  const edge = board.outline?.[0]
  if (edge?.length) for (const t of tracks) if (t.pts.some(p => !inRing(p, edge))) out.push('outline: the trace leaves the board')
  return [...new Set(out)]
}

const layouts = new WeakMap<Board, ReturnType<typeof buildLayout>>()
/** One automatic leg from `a` to `b` against the board's copper, as the router lays it. */
function leg(board: Board, a: Pt, b: Pt, layer: string, net: string | null, width: number): { tracks: AssistPreview['tracks']; vias: Pt[] } {
  let layout = layouts.get(board)
  if (!layout) layouts.set(board, (layout = buildLayout(new ObstacleWorld(board, board.rules))))
  const r = maze(
    {
      ...(net ? { net } : {}),
      width,
      start: { x: a[0], y: a[1], layer },
      end: { x: b[0], y: b[1], layer },
      layers: copperLayers(board.copper),
      via: { drill: board.rules.minViaDrill, size: board.rules.minViaDiameter },
      bend: '45',
    },
    layout,
  )
  return { tracks: r.tracks.map(t => ({ layer: t.layer, pts: t.pts.map(p => [p[0], p[1]] as Pt) })), vias: r.vias.map(v => [v.x, v.y] as Pt) }
}

/** The trace a dot at `at` previews: a straight segment, or for X one automatic leg; with its clearance findings. */
export function preview(board: Board, a: AssistContext, at: Pt, command = a.command): AssistPreview {
  const t0 = performance.now()
  const width = a.width ?? board.rules.minTrackWidth
  const layer = a.layer ?? 'F.Cu'
  if (!a.start) return { command, tracks: [], vias: [], findings: [], ms: 0 }
  const end = endOf(command, a.start, at)
  if (command !== 'X') {
    const tracks = [{ layer, pts: [a.start, end] }]
    return { command, tracks, vias: [], findings: clashes(board, tracks, a.net, width), ms: performance.now() - t0 }
  }
  try {
    const r = leg(board, a.start, end, layer, a.net, width)
    return { command, ...r, findings: clashes(board, r.tracks, a.net, width), ms: performance.now() - t0 }
  } catch (e) {
    return { command, tracks: [], vias: [], findings: [], error: String((e as Error)?.message ?? e), ms: performance.now() - t0 }
  }
}
