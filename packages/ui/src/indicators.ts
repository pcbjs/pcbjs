// Connection indicators, free of Vue, three.js and the DOM: the unrouted connections of the selection with the copper layer at each end,
// as one arc per connection in 3D, through the board where the ends sit on different sides, and as a two-colour line in 2D; board mm, z up.
import type { SiteData } from '@pcbjs/core/site-data'
import { shapeOf } from '@pcbjs/core/site-shapes'
import { inRing } from './dots'

type Pt = [number, number]
export type Pt3 = [number, number, number]

/** One end of a connection: where it is, the copper layer it is drawn from, and every layer the copper there spans. */
export interface End {
  at: Pt
  layer: string
  layers: string[]
}
export interface Conn {
  net: string
  a: End
  b: End
}

/** What the selection draws, as far as the indicators care. */
export interface Members {
  parts: ReadonlySet<string>
  ids: ReadonlySet<number>
  nets: ReadonlySet<string>
}

const SEGMENTS = 24
/** an arc clears the tallest part under it by this much, mm */
export const CLEAR = 1

/** The copper of a net at a point: a pad, via or track holding it, its layers in stack order; F.Cu when none does. */
export function endAt(board: SiteData, p: Pt, net: string, active: 'F' | 'B' = 'F'): End {
  const hit = (board.items ?? []).find(
    it => it.net === net && (it.kind === 'pad' || it.kind === 'via' || it.kind === 'track') && shapeOf(board, it.id).some(r => inRing(p, r) || near(p, r)),
  )
  const layers = hit ? hit.layers.filter(l => l.endsWith('.Cu')) : ['F.Cu']
  const own = active === 'B' ? 'B.Cu' : 'F.Cu'
  const layer = layers.includes(own) ? own : (layers[0] ?? 'F.Cu')
  return { at: p, layer, layers: layers.length ? layers : ['F.Cu'] }
}
const near = (p: Pt, r: Pt[]) => r.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3)

/** The nets the selection touches: its own nets, its parts' pads and its items. */
export function netsOf(board: SiteData, m: Members): Set<string> {
  const out = new Set(m.nets)
  for (const f of board.footprints) if (m.parts.has(f.ref)) for (const p of f.pads) if (p.net) out.add(p.net)
  for (const it of board.items ?? []) if (m.ids.has(it.id) && it.net) out.add(it.net)
  return out
}

/** The unrouted and partly routed connections of the selection, from the board's ratsnest. */
export function connections(board: SiteData, m: Members | null, active: 'F' | 'B' = 'F'): Conn[] {
  if (!m) return []
  const nets = netsOf(board, m)
  return board.ratsnest.filter(r => nets.has(r.net)).map(r => ({ net: r.net, a: endAt(board, r.from, r.net, active), b: endAt(board, r.to, r.net, active) }))
}

/** The tallest part on a side whose box meets the segment's box, mm above the board; 0 when none does. */
export function tallest(board: SiteData, a: Pt, b: Pt, side: 'F' | 'B'): number {
  const x0 = Math.min(a[0], b[0]),
    x1 = Math.max(a[0], b[0]),
    y0 = Math.min(a[1], b[1]),
    y1 = Math.max(a[1], b[1])
  let h = 0
  for (const f of board.footprints)
    if (f.side === side && f.bbox.x <= x1 && f.bbox.x + f.bbox.w >= x0 && f.bbox.y <= y1 && f.bbox.y + f.bbox.h >= y0) h = Math.max(h, f.height ?? 0)
  return h
}

/** The z of each copper layer, and of the two surfaces of the board. */
export interface Stack {
  z(layer: string): number
  top: number
  bottom: number
}

export interface Curve3 {
  /** the arc, start to end, sampled */
  arc: Pt3[]
  /** a vertical stem through the board to the far end's layer where the ends are on different sides or layers, else null */
  stem: [Pt3, Pt3] | null
  /** where the stem meets the surface, ringed while the board is opaque */
  ring: Pt3 | null
  /** the arc runs under the board, both ends being on the back */
  under: boolean
}

const sideOf = (layer: string): 'F' | 'B' | null => (layer === 'F.Cu' ? 'F' : layer === 'B.Cu' ? 'B' : null)

/** One quadratic arc from pad surface to pad surface, its apex clearing the tallest part under it; across sides or layers it ends above or below the far end, a stem going on to it. */
export function curve3(board: SiteData, c: Conn, s: Stack): Curve3 {
  const sa = sideOf(c.a.layer),
    sb = sideOf(c.b.layer)
  const under = sa === 'B' && sb === 'B'
  const side: 'F' | 'B' = under || (sa === 'B' && sb === null) ? 'B' : 'F'
  const surface = side === 'F' ? s.top : s.bottom
  const dir = side === 'F' ? 1 : -1
  const za = sa === side ? s.z(c.a.layer) : surface
  const crosses = sb !== side
  const zb = crosses ? surface : s.z(c.b.layer)
  const apex = surface + dir * (tallest(board, c.a.at, c.b.at, side) + CLEAR)
  // the control point that puts the curve's middle at the apex
  const ctl: Pt3 = [(c.a.at[0] + c.b.at[0]) / 2, (c.a.at[1] + c.b.at[1]) / 2, 2 * apex - (za + zb) / 2]
  const arc: Pt3[] = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS,
      u = 1 - t
    arc.push([u * u * c.a.at[0] + 2 * u * t * ctl[0] + t * t * c.b.at[0], u * u * c.a.at[1] + 2 * u * t * ctl[1] + t * t * c.b.at[1], u * u * za + 2 * u * t * ctl[2] + t * t * zb])
  }
  const end: Pt3 = [c.b.at[0], c.b.at[1], zb]
  return { arc, stem: crosses ? [end, [c.b.at[0], c.b.at[1], s.z(c.b.layer)]] : null, ring: crosses ? end : null, under }
}

export interface Line2 {
  from: Pt
  to: Pt
  fromLayer: string
  toLayer: string
  /** a filled dot on the active side, a ring for the far side, a ring with the layer's index for an inner layer */
  marks: { at: Pt; kind: 'dot' | 'ring' | 'inner'; index?: number; layer: string }[]
}

/** The 2D form, active side on top: one line from the start layer's colour to the end layer's, a mark at each end. */
export function line2(c: Conn, active: 'F' | 'B'): Line2 {
  const mark = (e: End) => {
    const own = active === 'B' ? 'B.Cu' : 'F.Cu'
    if (e.layers.includes(own)) return { at: e.at, kind: 'dot' as const, layer: own }
    const inner = /^In(\d+)\.Cu$/.exec(e.layer)
    return inner ? { at: e.at, kind: 'inner' as const, index: Number(inner[1]), layer: e.layer } : { at: e.at, kind: 'ring' as const, layer: e.layer }
  }
  const ma = mark(c.a),
    mb = mark(c.b)
  return { from: c.a.at, to: c.b.at, fromLayer: ma.layer, toLayer: mb.layer, marks: [ma, mb] }
}
