// The assist mode's dot field, free of Vue and the DOM: the candidate dots a command offers, which are unavailable and why, the falloff
// that lights them around the anchor and the pointer, and the paths one renderer draws; board mm. See docs/editing.md, Assist.
import type { SiteData, SiteItem } from '@pcbjs/core/site-data'
import { shapeOf } from '@pcbjs/core/site-shapes'
import { fromGrid, levelOf, stepOf, toGrid, type SnapGrid } from './snap'
import type { AssistContext } from '@pcbjs/core/protocol'

type Pt = [number, number]

export interface Dot {
  at: Pt
  /** false when the dot sits on another net's copper or in a keepout; drawn faint, still picked */
  ok: boolean
  why?: string
}

/** mm between dots without a grid */
export const FREE_PITCH = 1
/** how far dots reach from the anchor without an outline, in pitches */
export const CLUSTER = 12
/** the pointer lights dots within this many pitches */
export const LIT = 6
const LINE_CAP = 400
const FIELD_CAP = 6000

/** The grid the dots stand on: the context's, else a free 1 mm grid through the anchor. */
export function dotGrid(ctx: AssistContext, board: SiteData): SnapGrid {
  const g = ctx.grid ? board.grids?.find(x => x.name === ctx.grid) : undefined
  if (g) return { name: g.name, pitch: g.pitch, minor: g.minor, origin: g.origin, angle: g.angle, mirror: g.mirror }
  // relative commands count pitches from the anchor, absolute ones whole millimetres
  return { name: '', pitch: FREE_PITCH, minor: [], origin: ctx.relative && ctx.start ? ctx.start : [0, 0], angle: 0, mirror: false }
}

type Box = [number, number, number, number]
const boxOf = (ring: Pt[]): Box => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}
export function inRing(p: Pt, r: readonly Pt[]): boolean {
  let n = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n = !n
  return n
}

/** True on the ring's boundary, where no track may run. */
function onEdge(p: Pt, r: readonly Pt[]): boolean {
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j],
      b = r[i]
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    if (Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) < 1e-6) return true
  }
  return false
}

/** The area dots may fill: the outline's box, else a cluster around the anchor. */
function reach(ctx: AssistContext, board: SiteData, g: SnapGrid): Box {
  const edge = board.outline?.[0]
  if (edge?.length) return boxOf(edge)
  const c = ctx.start ?? [0, 0]
  const r = g.pitch * CLUSTER
  return [c[0] - r, c[1] - r, c[0] + r, c[1] + r]
}

/** Each lattice point of the grid inside a box, x0 y0 x1 y1. */
export function lattice(g: SnapGrid, b: Box): Pt[] {
  const corners: Pt[] = [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[0], b[3]],
    [b[2], b[3]],
  ].map(p => toGrid(g, p as Pt))
  const us = corners.map(p => p[0]),
    vs = corners.map(p => p[1])
  const p = g.pitch
  const out: Pt[] = []
  for (let u = Math.ceil(Math.min(...us) / p); u <= Math.floor(Math.max(...us) / p); u++)
    for (let v = Math.ceil(Math.min(...vs) / p); v <= Math.floor(Math.max(...vs) / p); v++) {
      const q = fromGrid(g, [u * p, v * p])
      if (q[0] >= b[0] - 1e-9 && q[0] <= b[2] + 1e-9 && q[1] >= b[1] - 1e-9 && q[1] <= b[3] + 1e-9) out.push([r6(q[0]), r6(q[1])])
      if (out.length >= FIELD_CAP) return out
    }
  return out
}
const r6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Points along a direction from the anchor, both ways, a pitch apart, within the box. */
function ray(start: Pt, dir: Pt, step: number, b: Box): Pt[] {
  const out: Pt[] = []
  for (const s of [1, -1])
    for (let k = 1; k <= LINE_CAP; k++) {
      const q: Pt = [r6(start[0] + s * k * dir[0] * step), r6(start[1] + s * k * dir[1] * step)]
      if (q[0] < b[0] - 1e-9 || q[0] > b[2] + 1e-9 || q[1] < b[1] - 1e-9 || q[1] > b[3] + 1e-9) break
      out.push(q)
    }
  return out
}

/** The candidate points of a command: a line for H and V on the grid's columns or rows, four directions for L, a matrix for X and `at`. */
export function candidates(ctx: AssistContext, board: SiteData, all = false): Pt[] {
  const g = dotGrid(ctx, board)
  const b = reach(ctx, board, g)
  const s = ctx.start
  const up = ctx.command.toUpperCase()
  if (all || !s || up === 'X' || ctx.command === 'at') return lattice(g, b)
  const a = (g.angle * Math.PI) / 180
  const ux: Pt = [Math.cos(a), -Math.sin(a)],
    uy: Pt = [Math.sin(a), Math.cos(a)]
  if (up === 'H' || up === 'V') {
    const i = up === 'H' ? 0 : 1
    // an absolute H or V lands on the grid's columns or rows, a relative one a pitch at a time from the anchor
    if (ctx.relative || g.angle) return ray(s, i === 0 ? ux : uy, g.pitch, b)
    const out: Pt[] = []
    for (let k = Math.ceil((b[i] - g.origin[i]) / g.pitch); k <= Math.floor((b[i + 2] - g.origin[i]) / g.pitch) && out.length < LINE_CAP * 2; k++) {
      const v = r6(g.origin[i] + k * g.pitch)
      if (Math.abs(v - s[i]) > 1e-9) out.push(i === 0 ? [v, s[1]] : [s[0], v])
    }
    return out
  }
  const diag = (d: number): Pt => [(ux[0] + d * uy[0]) / Math.SQRT2, (ux[1] + d * uy[1]) / Math.SQRT2]
  return [ux, uy, diag(1), diag(-1)].flatMap(d => ray(s, d, d === ux || d === uy ? g.pitch : g.pitch * Math.SQRT2, b))
}

interface Blocker {
  box: Box
  rings: Pt[][]
  why: string
}
/** Other nets' pads, tracks and vias on the layer, and the keepouts on it, each with what to say about it. */
function blockers(ctx: AssistContext, board: SiteData): Blocker[] {
  const layer = ctx.layer ?? (ctx.side === 'B' ? 'B.Cu' : 'F.Cu')
  const out: Blocker[] = []
  const name = (it: SiteItem) => (it.kind === 'pad' && it.ref ? `pad ${it.ref}` : it.kind === 'via' ? 'a via' : `a track${it.route ? ` of ${it.route}` : ''}`)
  if (ctx.command !== 'at')
    for (const it of board.items ?? []) {
      if ((it.kind !== 'pad' && it.kind !== 'track' && it.kind !== 'via') || !it.layers.includes(layer) || (it.net && it.net === ctx.net)) continue
      const rings = shapeOf(board, it.id)
      if (!rings.length) continue
      out.push({ box: boxOf(rings.flat()), rings, why: `on ${name(it)}${it.net ? ` of ${it.net}` : ''}` })
    }
  for (const k of board.keepouts ?? [])
    if (k.layers.includes(layer) || ctx.command === 'at')
      out.push({ box: boxOf(k.outline.flat() as Pt[]), rings: k.outline as Pt[][], why: `in a keepout${k.ref ? ` of ${k.ref}` : ''}` })
  return out
}

/** The dots of a context: candidates inside the outline, each marked unavailable with the reason when it sits on what it may not. */
export function dotField(ctx: AssistContext, board: SiteData, all = false): Dot[] {
  const edge = board.outline?.[0]
  const blocks = blockers(ctx, board)
  return candidates(ctx, board, all)
    .filter(p => !edge?.length || (inRing(p, edge as Pt[]) && !onEdge(p, edge as Pt[])))
    .map(p => {
      const b = blocks.find(x => p[0] >= x.box[0] && p[0] <= x.box[2] && p[1] >= x.box[1] && p[1] <= x.box[3] && x.rings.some(r => inRing(p, r)))
      return b ? { at: p, ok: false, why: b.why } : { at: p, ok: true }
    })
}

/** How lit a dot is: the larger of the anchor's and the pointer's radial falloff, never below a floor so the field stays readable. */
export function light(p: Pt, anchor: Pt | null, pointer: Pt | null, radius: number): number {
  const f = (c: Pt | null, r: number) => (c ? Math.max(0, 1 - Math.hypot(p[0] - c[0], p[1] - c[1]) / r) : 0)
  return Math.max(0.12, f(anchor, radius * 2), f(pointer, radius))
}

/** The dot nearest a point within `tol` mm, else null. */
export function nearest(dots: readonly Dot[], p: Pt, tol: number): Dot | null {
  let best: Dot | null = null,
    d = tol
  for (const x of dots) {
    const e = Math.hypot(x.at[0] - p[0], x.at[1] - p[1])
    if (e <= d) {
      d = e
      best = x
    }
  }
  return best
}

/** The point a typed argument names, so typing feeds the preview as a hover does; null until it names one. */
export function typedPoint(ctx: AssistContext): Pt | null {
  const s = ctx.start,
    t = ctx.typed
  if (!s || !t.length) return null
  switch (ctx.command) {
    case 'H':
      return [t[0], s[1]]
    case 'h':
      return [s[0] + t[0], s[1]]
    case 'V':
      return [s[0], t[0]]
    case 'v':
      return [s[0], s[1] + t[0]]
    case 'L':
    case 'A':
    case 'X':
      return t.length > 1 ? [t[0], t[1]] : null
    case 'l':
    case 'a':
      return t.length > 1 ? [s[0] + t[0], s[1] + t[1]] : null
    default:
      return null
  }
}

/** The text a pick at a point writes, as the session writes it, for the hover chip. */
export function pickText(ctx: AssistContext, at: Pt, command = ctx.command): string {
  const s = ctx.start ?? [0, 0]
  const f = (v: number) => String(Math.round(v * 1000) / 1000 || 0)
  const up = command.toUpperCase()
  const e: Pt = up === 'H' ? [at[0], s[1]] : up === 'V' ? [s[0], at[1]] : at
  const d: Pt = [e[0] - s[0], e[1] - s[1]]
  const arg: Record<string, string> = { H: f(e[0]), h: f(d[0]), V: f(e[1]), v: f(d[1]), L: `${f(e[0])}, ${f(e[1])}`, l: `${f(d[0])}, ${f(d[1])}`, X: `'${f(e[0])} ${f(e[1])}'` }
  return command === 'at' ? `at="${f(at[0])} ${f(at[1])}"` : `.${command}(${arg[command] ?? ''})`
}

/** Dots as one path per brightness step, `steps` of them, so the field is a handful of elements however many dots it has. */
export function dotPaths(points: readonly { at: Pt; level: number }[], r: number, steps = 6): string[] {
  const out = Array.from({ length: steps }, () => '')
  for (const p of points) {
    const i = Math.min(steps - 1, Math.max(0, Math.floor(p.level * steps)))
    out[i] += `M${f4(p.at[0] - r)} ${f4(p.at[1])}a${f4(r)} ${f4(r)} 0 1 0 ${f4(2 * r)} 0a${f4(r)} ${f4(r)} 0 1 0 ${f4(-2 * r)} 0`
  }
  return out
}
const f4 = (v: number) => String(Math.round(v * 1e4) / 1e4)

/** screen pixels a component's grid dots stand apart at least; denser, the dots fall back to the pitch, then to none */
export const ORIGIN_DOT_PX = 6

/** A component's grid as dots: the lattice of its snap step through the component's own origin over a box, lit round `lit`, the origin as drawn. */
export function originDots(g: SnapGrid, origin: Pt, box: Box, px: number, lit: Pt = origin): { at: Pt; level: number }[] {
  const s = [stepOf(g, levelOf(g, false)), g.pitch].find(v => v / px >= ORIGIN_DOT_PX)
  if (!s) return []
  const pts = lattice({ ...g, pitch: s, minor: [], origin }, box)
  return pts.map(at => ({ at, level: light(at, lit, null, g.pitch * LIT) }))
}

/** The cursor-lit grid: every lattice point within `LIT` pitches of the pointer, unbounded by the board, with its falloff. */
export function litGrid(g: SnapGrid, pointer: Pt): { at: Pt; level: number }[] {
  const r = g.pitch * LIT
  const pts = lattice(g, [pointer[0] - r, pointer[1] - r, pointer[0] + r, pointer[1] + r])
  return pts.map(at => ({ at, level: Math.max(0, 1 - Math.hypot(at[0] - pointer[0], at[1] - pointer[1]) / r) })).filter(p => p.level > 0)
}
