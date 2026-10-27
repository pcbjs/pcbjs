// Stitching vias, see stitch() in @pcbjs/core: placed on a lattice after the pours fill, then only the pours a via changes refill.
import type { Board, DrcMarker, Graphic, Item, Poly, Pt, Ring, Via, Zone } from '@pcbjs/core/model'
import type { Src } from '@pcbjs/core/types'
import { bbox, intersection, offset, polysToRings, strokeClosed, strokeOpen, union, unionEvenOdd } from './geom.js'
import { circleRing } from './path.js'
import { copperLayers } from './layers.js'
import { copperLayersOf, copperRings, grownRings } from './copper.js'
import { holeClearanceOn } from '@pcbjs/core/rules'
import { classClearance, itemClearance, maxClearance, maxHoleClearance, overrideBetween } from './netclass.js'
import { Grid, type Box } from './spatial.js'
import { fillZones, inside, PointIn } from './zones.js'

/** A stitch() element as flatten records it, lengths in mm, layers resolved, `area` and `origin` in board mm. */
export interface StitchJob {
  net: string
  pitch: number
  /** the copper layers that must have fill of the net, every copper layer when absent */
  layers?: string[]
  padClearance?: number
  drill: number
  size: number
  silk: boolean
  courtyard: boolean
  /** every via lands on origin + k * grid */
  grid?: number
  origin?: Pt
  area?: Ring[]
  src?: Src
  chain?: Src[]
}

// over every clearance, as the fill keeps FILL_MARGIN: polygon chords lie inside their arcs
const MARGIN = 0.01

/** Place the vias of every stitch job on a filled board and refill the pours they change. Returns `stitch-empty` findings. */
export function stitchBoard(board: Board, jobs: readonly StitchJob[]): DrcMarker[] {
  const added: Via[] = [], out: DrcMarker[] = []
  for (const job of jobs) {
    const vias = placeStitches(board, job)
    added.push(...vias)
    if (!vias.length) out.push({ severity: 'info', rule: 'stitch-empty', message: `stitch() of ${job.net} placed no via: ${emptyWhy(board, job)}`, at: job.area ? centre(job.area) : [board.bbox.x + board.bbox.w / 2, board.bbox.y + board.bbox.h / 2], net: job.net, ...(job.src ? { src: job.src } : {}) })
  }
  if (added.length) {
    const touched = touchedZones(board, added)
    if (touched.size) fillZones(board, touched)
  }
  return out
}

const centre = (rings: Ring[]): Pt => { const b = bbox(rings); return [b.x + b.w / 2, b.y + b.h / 2] }

function emptyWhy(board: Board, job: StitchJob): string {
  const cu = copperLayers(board.copper)
  const bare = (job.layers ?? cu).filter(l => !board.items.some(z => z.kind === 'zone' && z.net === job.net && z.layer === l && z.fill.length))
  return bare.length ? `no fill of the net on ${bare.join(', ')}` : 'no lattice point has room for the via in the fill of every listed layer'
}

/** The vias of one job, added to board.items. */
function placeStitches(board: Board, job: StitchJob): Via[] {
  const cu = copperLayers(board.copper)
  const span: [string, string] = [cu[0], cu[cu.length - 1]]
  const R = job.size / 2, rules = board.rules
  let region: Ring[] | null = null
  for (const l of job.layers ?? cu) {
    const fill = board.items.filter((i): i is Zone => i.kind === 'zone' && i.net === job.net && i.layer === l).flatMap(z => polysToRings(z.fill))
    if (!fill.length) return []
    const inner = polysToRings(offset(polysToRings(union(fill)), -(R + MARGIN)))
    region = region ? polysToRings(intersection(region, inner)) : inner
    if (!region.length) return []
  }
  if (!region) return []
  if (job.area) region = polysToRings(intersection(region, polysToRings(unionEvenOdd(job.area))))
  if (board.outline.length) region = polysToRings(intersection(region, polysToRings(offset(board.outline, -(rules.edgeClearance + R + MARGIN)))))
  if (!region.length) return []
  const box = bbox(region)
  const near = (b: Box, d: number) => b.x - d <= box.x + box.w && b.x + b.w + d >= box.x && b.y - d <= box.y + box.h && b.y + b.h + d >= box.y

  // a centre inside any group is blocked
  const ask = { kind: 'via', net: job.net }
  const padGap = job.padClearance ?? rules.clearance
  const reach = R + Math.max(padGap, maxClearance(board), rules.holeClearance, rules.minHoleToHole, rules.silkToPad) + 1
  const cuts: Ring[][] = []
  for (const it of board.items) {
    if (it.kind === 'zone') continue
    if (it.kind === 'pad' || it.kind === 'via') {
      const half = it.kind === 'via' ? it.size / 2 : Math.max(...it.size, ...(it.drill ?? [0]))
      if (!near({ x: it.at[0] - half, y: it.at[1] - half, w: 2 * half, h: 2 * half }, reach)) continue
      if (it.kind === 'pad' && it.layers.some(l => cu.includes(l))) cuts.push(polysToRings(offset([it.poly], R + padGap + MARGIN)))
      const r = it.kind === 'pad' ? (it.drill ? Math.max(...it.drill) / 2 : 0) : it.drill / 2
      if (r) {
        const other = it.net === undefined || it.net !== job.net || (it.kind === 'pad' && it.type === 'npth')
        const d = Math.max(r + job.drill / 2 + rules.minHoleToHole, other ? r + R + rules.holeClearance : 0)
        cuts.push([circleRing(it.at[0], it.at[1], d + MARGIN)])
      }
    }
    if (it.net === job.net) continue
    for (const l of copperLayersOf(it, cu)) {
      const rings = copperRings(it, l)
      if (!rings.length || !near(bbox(rings), reach)) continue
      cuts.push(grownRings(it, l, R + itemClearance(board, ask, it) + MARGIN))
    }
  }
  for (const k of board.keepouts ?? []) if (k.vias && !k.except?.includes(job.net)) cuts.push(polysToRings(offset(k.outline, R + MARGIN)))
  for (const g of board.items) {
    if (g.kind !== 'graphic' && g.kind !== 'text') continue
    if (job.silk && g.layer.endsWith('.SilkS')) {
      const ink = silkInk(g)
      if (ink.length && near(bbox(ink), reach)) cuts.push(polysToRings(offset(ink, R + rules.silkToPad + MARGIN)))
    } else if (job.courtyard && g.kind === 'graphic' && g.layer.endsWith('.CrtYd')) {
      const yard = courtyard(g)
      if (yard.length && near(bbox(yard), reach)) cuts.push(polysToRings(offset(yard, R + MARGIN)))
    }
  }
  const inRegion = new PointIn(region), cutGrid = new Grid(cuts.map(bbox))
  const free = (p: Pt) => inRegion.has(p) && !cutGrid.query({ x: p[0], y: p[1], w: 0, h: 0 }).some(k => inside(cuts[k], p))

  // a via or through-hole pad of the net suppresses the lattice points within the pitch
  const held: Pt[] = []
  for (const it of board.items) {
    if (it.net !== job.net) continue
    if (it.kind === 'via' || (it.kind === 'pad' && it.drill && copperLayersOf(it, cu).length > 1)) held.push(it.at)
  }
  const pitch = job.pitch, snap = pitch / 2, step = job.grid ?? Math.min(0.1, pitch / 20)
  // anchored to the board or the origin, so a change elsewhere does not shift the lattice
  const [ox, oy] = job.origin ?? (job.grid ? [0, 0] : [board.bbox.x + pitch / 2, board.bbox.y + pitch / 2])
  const onGrid = (v: number, o: number) => (job.grid ? o + Math.round((v - o) / job.grid) * job.grid : v)
  const n = Math.floor(snap / step + 1e-9)
  const offsets: Pt[] = []
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) if (Math.hypot(i * step, j * step) <= snap + 1e-9) offsets.push([i * step, j * step])
  offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))
  const placed: Pt[] = []
  const far = (p: Pt, pts: Pt[], d: number) => pts.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) >= d - 1e-9)
  const i0 = Math.ceil((box.x - snap - ox) / pitch), i1 = Math.floor((box.x + box.w + snap - ox) / pitch)
  const j0 = Math.ceil((box.y - snap - oy) / pitch), j1 = Math.floor((box.y + box.h + snap - oy) / pitch)
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const g: Pt = [onGrid(ox + i * pitch, ox), onGrid(oy + j * pitch, oy)]
      if (!far(g, held, pitch)) continue
      for (const o of offsets) {
        const p: Pt = [r4(g[0] + o[0]), r4(g[1] + o[1])]
        if (!free(p) || !far(p, placed, pitch / 2) || !far(p, held, pitch / 2)) continue
        placed.push(p)
        break
      }
    }
  let id = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
  const vias = placed.map(at => ({ kind: 'via', id: id++, layer: span[0], net: job.net, at, drill: job.drill, size: job.size, layers: span, stitch: true, ...(job.src ? { src: job.src } : {}), ...(job.chain ? { chain: job.chain } : {}) }) as Via)
  board.items.push(...vias)
  return vias
}

function silkInk(g: Item): Ring[] {
  if (g.kind === 'text') return g.polys ? polysToRings(g.polys) : g.strokes.flatMap(q => polysToRings(strokeOpen(q, g.thickness)))
  if (g.kind !== 'graphic') return []
  return g.fill ? g.paths.filter(q => q.length >= 3) : g.paths.flatMap((q, i) => polysToRings(g.closed[i] ? strokeClosed(q, g.width) : strokeOpen(q, g.width)))
}

/** The area a courtyard drawing encloses, its line width included. */
function courtyard(g: Graphic): Ring[] {
  const area = g.paths.filter((q, i) => g.closed[i] && q.length >= 3)
  return area.length ? polysToRings(union([...area, ...area.flatMap(q => polysToRings(strokeClosed(q, g.width)))])) : []
}

/** The pours the new vias change, plus lower-priority overlapping pours on the same layer; a via changes a fill only near another net's or by holding an island. */
function touchedZones(board: Board, vias: Via[]): Set<Zone> {
  const cu = copperLayers(board.copper)
  const zones = board.items.filter((i): i is Zone => i.kind === 'zone')
  const reach = Math.max(maxClearance(board), maxHoleClearance(board)) + 0.05
  const viaGrid = new Grid(vias.map(v => ({ x: v.at[0] - v.size / 2, y: v.at[1] - v.size / 2, w: v.size, h: v.size })))
  const boxes = new Map(zones.map(z => [z, bbox(z.outline)]))
  // as fillZones clears it, with a margin
  const gap = (z: Zone, v: Via) => {
    const o = overrideBetween(board, { kind: 'zone', net: z.net }, v)
    const c = o !== undefined ? Math.max(z.clearance ?? 0, o) : Math.max(z.clearance ?? board.rules.clearance, classClearance(board, z.net, v.net))
    return Math.max(v.size / 2 + c, v.drill / 2 + holeClearanceOn(board.rules, z.layer, 'via')) + 0.05
  }
  const out = new Set<Zone>()
  for (const z of zones) {
    const near = viaGrid.query(boxes.get(z)!, reach).map(k => vias[k]).filter(v => copperLayersOf(v, cu).includes(z.layer))
    if (near.some(v => v.net === z.net ? !!z.islandsRemoved && !within(z, v.at, v.size / 2) : closeTo(z, v.at, gap(z, v)))) out.add(z)
  }
  const hits = (a: Box, b: Box) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
  for (let grew = true; grew;) {
    grew = false
    for (const z of zones) {
      if (out.has(z)) continue
      if ([...out].some(t => t.layer === z.layer && t.priority >= z.priority && hits(boxes.get(t)!, boxes.get(z)!))) { out.add(z); grew = true }
    }
  }
  return out
}

/** Whether the disc of radius r about c meets a zone's fill. */
function closeTo(z: Zone, c: Pt, r: number): boolean {
  return z.fill.some(poly => { const d = edgeDistance(poly, c, r); return d === -1 || d < r })
}

/** Whether the disc of radius r about c lies wholly in one piece of a zone's fill, so it holds no removed island. */
function within(z: Zone, c: Pt, r: number): boolean {
  return z.fill.some(poly => edgeDistance(poly, c, r) === -1 && !nearEdge(poly, c, r))
}

const nearEdge = (poly: Poly, c: Pt, r: number) => [poly.outer, ...poly.holes].some(ring => ring.some((p, i) => segDist(p, ring[(i + 1) % ring.length], c) < r))

/** -1 when c lies in the piece, else Infinity when the piece's box is further than r, else the distance to its nearest edge. */
function edgeDistance(poly: Poly, c: Pt, r: number): number {
  const b = bbox([poly.outer])
  if (c[0] + r < b.x || c[0] - r > b.x + b.w || c[1] + r < b.y || c[1] - r > b.y + b.h) return Infinity
  const rings = [poly.outer, ...poly.holes]
  if (inside(rings, c)) return -1
  let d = Infinity
  for (const ring of rings) for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(ring[i], ring[(i + 1) % ring.length], c))
  return d
}

function segDist(p: Pt, q: Pt, c: Pt): number {
  const ex = q[0] - p[0], ey = q[1] - p[1], l2 = ex * ex + ey * ey
  const t = l2 ? Math.max(0, Math.min(1, ((c[0] - p[0]) * ex + (c[1] - p[1]) * ey) / l2)) : 0
  return Math.hypot(p[0] + t * ex - c[0], p[1] + t * ey - c[1])
}
