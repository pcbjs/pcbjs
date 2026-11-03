// The editing tools and the assist mode in the 3D view, free of three.js and the DOM: the gesture model and the assist fed with board points
// on the plane of the part's side or the route's layer, so the gestures, the poses and the writes are the 2D view's; what the scene draws, in board mm.
// See docs/editing.md and docs/3d.md.
import { computed } from 'vue'
import type { SiteData, SiteEditNode } from '@pcbjs/core/site-data'
import type { Selection } from '@pcbjs/core/internal/selection'
import { useGesture, type ToolHit } from './gesture'
import { useAssist2d, STEPS } from './assist2d'
import { dotGrid, light, litGrid, LIT, type Dot } from './dots'
import type { AssistContext } from '@pcbjs/core/protocol'
import { levelOf, stepOf, toGrid, fromGrid, type SnapGrid } from './snap'
import type { Drawn } from './selection'
import type { BoardStore } from './board-store'

type Pt = [number, number]
type V3 = { x: number; y: number; z: number }
/** grid lines drawn per axis at most; past it the grid draws its pitch only */
const LINES = 240

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0

/** Where a ray meets the plane at height `z` in the board group's frame, as a board point, y down; null when it never does. */
export function onPlane(o: V3, dir: V3, z: number): Pt | null {
  if (Math.abs(dir.z) < 1e-9) return null
  const t = (z - o.z) / dir.z
  if (t < 0) return null
  return [r6(o.x + t * dir.x), r6(-(o.y + t * dir.y))]
}

/** A board point at height `z` in the board group's frame: x right, y up, z up. */
export const toScene = (p: Pt, z: number): [number, number, number] => [p[0], -p[1], z]

/** The copper layer whose plane a tool works on: the part's side, else the route's layer, else the front. */
export function planeOf(node: SiteEditNode | null, board: Pick<SiteData, 'items'>): string {
  if (!node) return 'F.Cu'
  if (node.caps.includes('placed')) return node.side === 'B' ? 'B.Cu' : 'F.Cu'
  return board.items?.find(it => it.route === node.ref && it.kind === 'track')?.layers[0] ?? 'F.Cu'
}
/** The layer the assist dots stand on: the chain's layer, else its side. */
export const assistPlane = (ctx: AssistContext): string => ctx.layer ?? (ctx.side === 'B' ? 'B.Cu' : 'F.Cu')

/** The grid in effect as line segments over a box, x1 y1 x2 y2 in board mm: the snap step, the pitch alone when that is too dense. */
export function gridSegments(g: SnapGrid, box: [number, number, number, number]): number[] {
  const corners = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ].map(p => toGrid(g, p as Pt))
  const u0 = Math.min(...corners.map(c => c[0])),
    u1 = Math.max(...corners.map(c => c[0])),
    v0 = Math.min(...corners.map(c => c[1])),
    v1 = Math.max(...corners.map(c => c[1]))
  const fine = stepOf(g, levelOf(g, false))
  const s = Math.max(u1 - u0, v1 - v0) / fine > LINES ? g.pitch : fine
  if (Math.max(u1 - u0, v1 - v0) / s > LINES) return []
  const out: number[] = []
  const seg = (a: Pt, b: Pt) => {
    const p = fromGrid(g, a),
      q = fromGrid(g, b)
    out.push(r6(p[0]), r6(p[1]), r6(q[0]), r6(q[1]))
  }
  for (let u = Math.ceil(u0 / s) * s; u <= u1 + 1e-9; u += s) seg([u, v0], [u, v1])
  for (let v = Math.ceil(v0 / s) * s; v <= v1 + 1e-9; v += s) seg([u0, v], [u1, v])
  return out
}

/** Points bucketed by brightness, `steps` buckets, as the 2D view's paths are: the scene draws one point cloud per bucket. */
export function buckets(points: readonly { at: Pt; level: number }[], steps = STEPS): Pt[][] {
  const out: Pt[][] = Array.from({ length: steps }, () => [])
  for (const p of points) out[Math.min(steps - 1, Math.max(0, Math.floor(p.level * steps)))].push(p.at)
  return out
}

/** The dot field as the 3D view draws it: available and faint dots and the pointer's lit grid, each in brightness buckets. */
export function dotBuckets(dots: readonly Dot[], g: SnapGrid | null, anchor: Pt | null, pointer: Pt | null) {
  if (!g) return { ok: [], off: [], lit: [] }
  const lit = (x: Dot) => ({ at: x.at, level: light(x.at, anchor, pointer, g.pitch * LIT) })
  return {
    ok: buckets(dots.filter(x => x.ok).map(lit)),
    off: buckets(dots.filter(x => !x.ok).map(lit)),
    lit: pointer ? buckets(litGrid(g, pointer)) : [],
  }
}

export interface Tools3d {
  board: () => SiteData
  sel: () => Selection
  drawn: () => Drawn | null
  store: BoardStore
  /** the board point under the pointer on the plane of a copper layer, null when the ray misses it */
  planeAt: (e: { clientX: number; clientY: number }, layer: string) => Pt | null
  /** mm per screen pixel at the camera's target */
  px: () => number
}

export function useTools3d(d: Tools3d) {
  let last: Pt = [0, 0]
  // the ray off the plane keeps the last point, so a drag never jumps
  const boardAt = (e: { clientX: number; clientY: number }): Pt => (last = d.planeAt(e, plane.value) ?? last)
  const tl = useGesture({ board: d.board, sel: d.sel, drawn: d.drawn, boardAt, px: d.px, vb: () => [0, 0, 0, 0], store: d.store })
  const as = useAssist2d({ board: d.board, px: d.px, store: d.store, grid: () => tl.grid.value, visualGrid: () => tl.paintGrid.value })
  const plane = computed(() => planeOf(tl.node.value, d.board()))
  const dotPlane = computed(() => (as.ctx.value ? assistPlane(as.ctx.value) : 'F.Cu'))

  /** A press: a dot of the assist first, then the tools; true when taken, so the camera stays still. */
  function down(e: PointerEvent, hit: ToolHit): boolean {
    if (/\/pt:\d+$/.test(d.sel().anchor ?? '') && tl.down(e, hit)) return true
    if (as.on.value) {
      const p = d.planeAt(e, dotPlane.value)
      if (p) as.move(e, p)
      if (as.down(e)) return true
    }
    return tl.down(e, hit)
  }
  /** A pointer move: the assist's pointer on its plane, then the drag; true while a drag owns the pointer. */
  function move(e: PointerEvent): boolean {
    if (as.on.value) {
      const p = d.planeAt(e, dotPlane.value)
      if (p) as.move(e, p)
      else as.leave()
    }
    return tl.move(e)
  }

  /** The grid in effect over the board and a margin, while the tools show. */
  const grid = computed(() => {
    const g = tl.shown.value
    if (!g || !tl.on.value) return []
    const b = d.board().bbox
    return gridSegments(g, [b.x - 5, b.y - 5, b.x + b.w + 5, b.y + b.h + 5])
  })
  /** The anchor's grid as dots through its origin over the board and a margin, in brightness buckets. */
  const gridDots = computed(() => {
    const b = d.board().bbox
    return buckets(tl.dotsOver([b.x - 5, b.y - 5, b.x + b.w + 5, b.y + b.h + 5]))
  })
  const dots = computed(() => {
    const c = as.ctx.value
    return dotBuckets(as.dots.value, c && as.dots.value.length ? dotGrid(c, d.board()) : null, c?.start ?? null, as.pointer.value)
  })

  /** The commands of the key map this view answers, the same as the 2D view's. */
  const command = (id: string): boolean => tl.command(id) || (id === 'up' && as.leaveMode())

  return { tl, as, plane, dotPlane, pose: tl.pose, grid, gridDots, dots, down, move, up: tl.up, cancel: tl.cancel, command }
}
