import type { Board, Item, Keepout, Pad, Poly, Pt, Ring, Zone } from '@pcbjs/core/model'
import type { IslandMode, ThermalRules } from '@pcbjs/core/types'
import { holeClearanceOn, thermalRules } from '@pcbjs/core/rules'
import { area, bbox, bboxOverlap, difference, intersection, offset, overlaps, polysToRings, union } from './geom.js'
import { copperLayers } from './layers.js'
import { copperBox, copperLayersOf, copperRings, grownHole, grownRings, invalidate } from './copper.js'
import { EMPTY, Grid, RingIndex, type Box } from './spatial.js'
import { joined, pieces } from './connectivity.js'
import { classClearance, maxClassClearance, maxClearance, maxHoleClearance, overrideBetween } from './netclass.js'

// round offsets have 5 um chords inside the arc and the fill takes three, so the clearance cut gets a margin; the min-width pass does not
const FILL_MARGIN = 0.02

/** The thermal pads of a filled zone and how many of their spokes reach its fill; `thin` when the spokes are narrower than the zone min width. */
export interface ThermalReport {
  pads: { pad: Pad; spokes: number }[]
  spokes: number
  minSpokes: number
  spokeWidth: number
  minWidth: number
}
const reports = new WeakMap<Zone, ThermalReport>()
/** What the last fill of a zone did with its thermal pads, for the DRC; undefined for a zone without any. */
export function thermalReport(z: Zone): ThermalReport | undefined {
  return reports.get(z)
}
const solids = new WeakMap<Zone, Set<Pad>>()
/** Whether the last fill of a zone joins a same-net pad solidly: the pad connects solid there and the fill covers part of it. */
export function joinsSolidly(z: Zone, pad: Pad): boolean {
  if (!solids.get(z)?.has(pad) || !z.fill?.length) return false
  const c = copperRings(pad, z.layer)
  return c.length > 0 && overlaps(polysToRings(z.fill), c)
}

/** Fill every pour, highest priority first; with `only`, refill those alone, as stitch() does, the others keeping their fill. */
export function fillZones(board: Board, only?: ReadonlySet<Zone>): void {
  const cu = copperLayers(board.copper)
  const th = thermalRules(board.rules)
  const zones = board.items.filter((i): i is Zone => i.kind === 'zone').sort((a, b) => b.priority - a.priority)
  const edgeInner = board.outline.length ? polysToRings(offset(board.outline, -(board.rules.edgeClearance + FILL_MARGIN))) : null
  const filled = new Set<Zone>()
  // a pad's hole clearance override counts where it is larger than the rules'
  const holeOf = (it: Item, layer: string) => {
    const c = holeClearanceOn(board.rules, layer, it.kind === 'via' ? 'via' : 'pad')
    return (it.kind === 'pad' && it.holeClearance !== undefined ? Math.max(c, it.holeClearance) : c) + FILL_MARGIN
  }
  const holeReach = maxHoleClearance(board) + FILL_MARGIN
  // a box per item that holds its copper on every layer and its hole, to subtract only the items near a zone
  const items = board.items
  // zones are left out: their fill changes during this pass
  const grid = new Grid(items.map(it => (it.kind === 'zone' ? EMPTY : itemBox(it, cu))))
  const zoneAt = items.flatMap((it, i) => (it.kind === 'zone' ? [i] : []))
  for (const z of zones) {
    if (only && !only.has(z)) {
      filled.add(z)
      continue
    }
    // the DRC holds every net pair to classClearance, so the fill does too, per item
    const own = z.clearance ?? board.rules.clearance
    const classed = maxClassClearance(board) > own
    // an item's own clearance toward zones is held against the pour's own, the larger winning, as KiCad holds two local clearances
    const zoneAsk = { kind: 'zone', net: z.net }
    const clearanceTo = (it: Item) => {
      const o = overrideBetween(board, zoneAsk, it)
      return (o !== undefined ? Math.max(z.clearance ?? 0, o) : classed ? Math.max(own, classClearance(board, z.net, it.net)) : own) + FILL_MARGIN
    }
    const clearance = own + FILL_MARGIN,
      reach = Math.max(own, maxClearance(board)) + FILL_MARGIN
    const minW = z.minWidth ?? board.rules.zoneMinWidth
    // every clearance cut lies FILL_MARGIN further out than the rules ask
    const openW = Math.max(0, minW - 2 * FILL_MARGIN)
    let subject: Ring[] = z.outline
    if (edgeInner) subject = polysToRings(intersection(subject, edgeInner))
    // items beyond the box grown by the larger clearance cannot cut this zone; candidates come back in board order
    const near = [...grid.query(bbox(subject), Math.max(reach, holeReach, th.gap) + 0.001), ...zoneAt].sort((a, b) => a - b).map(i => items[i])
    const clip: Ring[] = []
    const thermal: Pad[] = [],
      gaps: Ring[] = [],
      solid: Pad[] = []
    for (const it of near) {
      if (it === z) continue
      if (it.kind === 'zone' && !filled.has(it)) continue // lower priority zones are filled after this one
      if (it.net !== undefined && it.net === z.net && it.kind !== 'zone') {
        // a through-hole pad with no ring on this layer keeps the hole clearance there, see the hole loop below
        if (it.kind !== 'pad' || !copperRings(it, z.layer).length) continue
        const c = it.thermal ?? z.connect ?? 'thermal'
        if (c === 'thermal') {
          thermal.push(it)
          gaps.push(gapRing(it, z.layer, th.gap))
        } else if (c === 'solid') solid.push(it)
        else if (c === 'none') clip.push(...grownRings(it, z.layer, clearance))
        continue
      }
      if (it.kind === 'zone' && it.net === z.net) continue
      if (!copperLayersOf(it, cu).includes(z.layer)) {
        if (it.kind === 'pad' && it.drill && it.net !== z.net) clip.push(...grownHole(it, Math.max(...it.drill) / 2, holeOf(it, z.layer)))
        continue
      }
      const rings = copperRings(it, z.layer)
      if (rings.length) clip.push(...grownRings(it, z.layer, clearanceTo(it)))
    }
    // copper keeps holeClearance from every NPTH and other-net hole edge
    for (const it of near) {
      if (it.kind !== 'pad' && it.kind !== 'via') continue
      const r = it.kind === 'pad' ? (it.drill ? Math.max(...it.drill) / 2 : 0) : it.drill / 2
      if (!r) continue
      if ((it.kind === 'pad' && it.type === 'npth') || it.net === undefined || it.net !== z.net || (it.kind === 'pad' && !copperRings(it, z.layer).length))
        clip.push(...grownHole(it, r, holeOf(it, z.layer)))
    }
    // keepouts set back by FILL_MARGIN like every cut, so the min-width pass removes a neck between two as KiCad's min thickness does
    for (const k of board.keepouts ?? []) if (k.pours && k.layers.includes(z.layer) && !(z.net !== undefined && k.except?.includes(z.net))) clip.push(...keepoutCut(k))
    reports.delete(z)
    const report: ThermalReport | undefined = thermal.length ? { pads: [], spokes: th.spokes, minSpokes: th.minSpokes, spokeWidth: th.spokeWidth, minWidth: minW } : undefined
    if (report) reports.set(z, report)
    let fill = difference(subject, gaps.length ? [...clip, ...gaps] : clip)
    if (report && openW > 0 && th.spokeWidth > minW + 1e-9) {
      // spoke cores shrink and regrow with the fill in its min-width pass
      const shrunk = fill.length ? polysToRings(offset(polysToRings(fill), -openW / 2)) : []
      const cores = spokes(report, z.layer, shrunk, subject, clip, thermal, th, openW / 2)
      fill = shrunk.length ? offset([...shrunk, ...cores], openW / 2) : []
    } else {
      fill = opened(fill, openW)
      // spokes no wider than the min width would not survive the pass: they join after it whole, and the DRC warns
      if (report) {
        const rings = polysToRings(fill),
          pieces = spokes(report, z.layer, rings, subject, clip, thermal, th, 0)
        if (pieces.length) fill = union([...rings, ...pieces])
      }
    }
    z.fill = removeIslands(z, fill, board, filled, cu, islandMode(z, board))
    // so the DRC counts a through-hole pad this fill joins as joined on every layer
    if (solid.length && fill.length) solids.set(z, new Set(solid))
    else solids.delete(z)
    invalidate(z as Item)
    filled.add(z)
  }
}

const keepoutCuts = new WeakMap<Keepout, Ring[]>()
/** A keepout's outline grown by FILL_MARGIN, the cut it makes in a pour. */
function keepoutCut(k: Keepout): Ring[] {
  let v = keepoutCuts.get(k)
  if (!v) keepoutCuts.set(k, (v = polysToRings(offset(k.outline, FILL_MARGIN))))
  return v
}

/** The island mode of a pour: its own, else the rules', else 'remove'. */
function islandMode(z: Zone, board: Board): IslandMode {
  return z.islands ?? board.rules.islands ?? 'remove'
}

/** A fill without its islands, as KiCad removes them: a piece stays when connected to its net's pad, via or pour; records the count and area removed. */
function removeIslands(z: Zone, fill: Poly[], board: Board, filled: Set<Zone>, cu: string[], mode: IslandMode): Poly[] {
  delete z.islandsRemoved
  if (mode === 'keep' || fill.length === 0 || z.net === undefined) return fill
  const own = pieces({ ...z, fill })
  // pads and vias hold a piece, as do the kept pieces of pours filled before this one
  const others: Item[] = []
  const holds = new Set<Item>()
  for (const it of board.items) {
    if (it === z || it.net !== z.net || !copperLayersOf(it, cu).includes(z.layer)) continue
    if (it.kind === 'zone') {
      if (filled.has(it))
        for (const p of pieces(it)) {
          others.push(p)
          holds.add(p)
        }
      continue
    }
    if (it.kind !== 'pad' && it.kind !== 'via' && it.kind !== 'track') continue
    if (!copperRings(it, z.layer).length) continue
    others.push(it)
    if (it.kind !== 'track') holds.add(it)
  }
  const nodes: Item[] = [...own, ...others]
  const parent = nodes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const grid = new Grid(nodes.map(it => copperBox(it, z.layer)))
  for (let i = 0; i < nodes.length; i++)
    for (const j of grid.query(grid.boxes[i], 0.002)) {
      if (j <= i || find(i) === find(j)) continue
      if (joined(nodes[i], nodes[j], z.layer)) parent[find(i)] = find(j)
    }
  const held = new Set<number>()
  nodes.forEach((it, i) => {
    if (holds.has(it)) held.add(find(i))
  })
  const minArea = typeof mode === 'object' ? mode.minArea : Infinity
  const kept: Poly[] = []
  let count = 0,
    removed = 0
  own.forEach((p, i) => {
    if (held.has(find(i)) || p.piece.area >= minArea) {
      kept.push(fill[i])
      return
    }
    count++
    removed += p.piece.area
  })
  if (count) z.islandsRemoved = { count, area: Math.round(removed * 1e4) / 1e4 }
  return count ? kept : fill
}

/** The spoke axes of a pad: direction, where it leaves the pad and where it leaves the gap. */
function axes(pad: Pad, copper: Ring[], outer: Ring[], th: ThermalRules, a0: number): { u: Pt; exit: number; gapExit: number }[] {
  const out: { u: Pt; exit: number; gapExit: number }[] = []
  for (let k = 0; k < th.spokes; k++) {
    // pad.rot and the spoke angle turn counter-clockwise on the y-down screen
    const a = ((pad.rot + a0 + (k * 360) / th.spokes) * Math.PI) / 180,
      u: Pt = [Math.cos(a), -Math.sin(a)]
    const exit = rayExit(copper, pad.at, u),
      gapExit = rayExit(outer, pad.at, u)
    if (exit > 0 && gapExit > exit) out.push({ u, exit, gapExit })
  }
  return out
}

/** The thermal spokes of one zone's pads as rings to merge into its fill, each kept only where it joins pad and `fill`; with `d` > 0 both come shrunk by `d`. */
function spokes(report: ThermalReport, layer: string, fill: Ring[], subject: Ring[], clip: Ring[], pads: Pad[], th: ThermalRules, d: number): Ring[] {
  if (!fill.length) {
    for (const pad of pads) report.pads.push({ pad, spokes: 0 })
    return []
  }
  const inFill = new PointIn(fill),
    subjIdx = new RingIndex(subject),
    clipIdx = new RingIndex(clip)
  const w = th.spokeWidth,
    kept: Ring[] = []
  // a spoke whose far end lies in another pad's spoke is kept after all, as KiCad's filler keeps it
  const misses: { entry: { pad: Pad; spokes: number }; rect: Ring; tip: Pt; u: Pt; t0: number; t1: number }[] = []
  const whole: { pad: Pad; rect: Ring; box: Box }[] = []
  for (const pad of pads) {
    const copper = copperRings(pad, layer),
      outer = [gapRing(pad, layer, th.gap)],
      padBox = bbox(copper)
    const spokeSet = (a0: number): { n: number; pieces: Ring[]; whole: { rect: Ring; tip: Pt; u: Pt; t0: number; t1: number; hit: boolean }[] } => {
      const kept: Ring[] = [],
        whole: { rect: Ring; tip: Pt; u: Pt; t0: number; t1: number; hit: boolean }[] = []
      let n = 0
      for (const { u, exit, gapExit } of axes(pad, copper, outer, th, a0)) {
        // the root lies a spoke width inside the pad edge, or at a small pad's centre, so the spoke overlaps the pad
        const t0 = Math.max(0, exit - w),
          t1 = gapExit + w
        const rect = spokeRect(pad.at, u, t0, t1, w)
        const box = bbox([rect])
        const root = along(pad.at, u, t0 + Math.min(w, exit - t0) / 2),
          tip = along(pad.at, u, gapExit + w / 2)
        const tipInFill = inFill.has(tip)
        const cross = (r: Ring) => crosses(r, box, pad.at, u, t0, t1, w / 2)
        if (!subjIdx.near(box).some(cross) && !clipIdx.near(box).some(cross)) {
          // no ring edge enters the spoke: it lies wholly inside or outside each, so it is whole
          if (!tipInFill) {
            if (inside(subject, tip) && !clipIdx.near(box).some(r => inside([r], tip))) whole.push({ rect, tip, u, t0, t1, hit: false })
            continue
          }
          whole.push({ rect, tip, u, t0, t1, hit: true })
          kept.push(d ? spokeRect(pad.at, u, t0 + d, t1 - d, w - 2 * d) : rect)
          n++
          continue
        }
        let pieces = intersection([rect], subjIdx.near(box))
        const cl = clipIdx.near(box)
        if (cl.length && pieces.length) pieces = difference(polysToRings(pieces), cl)
        let hit = false
        // a piece counts when it touches the pad and reaches the fill
        for (const p of pieces) {
          const rings = polysToRings([p])
          if (!inside(rings, root) && !(bboxOverlap(bbox(rings), padBox) && overlaps(rings, copper))) continue
          if (!(tipInFill && inside(rings, tip)) && !reaches(rings, pad.at, u, gapExit, t1, w / 2, inFill)) continue
          const core = d ? polysToRings(offset(rings, -d)) : rings
          if (!core.length) continue
          kept.push(...core)
          hit = true
        }
        if (hit) n++
      }
      return { n, pieces: kept, whole }
    }
    // fewer than minSpokes reaching the fill: also try the set turned 45 degrees, as KiCad does, and keep the better
    const a0 = (pad.thermalAngle ?? th.angle) === 45 ? 45 : 0
    const first = spokeSet(a0)
    let best = first
    const tried = [first]
    if (best.n < Math.min(th.minSpokes, th.spokes)) {
      const alt = spokeSet(a0 + 45)
      tried.push(alt)
      if (alt.n > best.n) best = alt
    }
    kept.push(...best.pieces)
    const entry = { pad, spokes: best.n }
    report.pads.push(entry)
    for (const set of tried) for (const x of set.whole) whole.push({ pad, rect: x.rect, box: bbox([x.rect]) })
    for (const x of best.whole) if (!x.hit) misses.push({ entry, rect: x.rect, tip: x.tip, u: x.u, t0: x.t0, t1: x.t1 })
  }
  if (misses.length) {
    const grid = new Grid(whole.map(x => x.box))
    for (const m of misses) {
      const pt = { x: m.tip[0], y: m.tip[1], w: 0, h: 0 }
      if (!grid.query(pt).some(k => whole[k].pad !== m.entry.pad && inside([whole[k].rect], m.tip))) continue
      kept.push(d ? spokeRect(m.entry.pad.at, m.u, m.t0 + d, m.t1 - d, w - 2 * d) : m.rect)
      m.entry.spokes++
    }
  }
  return kept
}

/** Whether a cut spoke piece reaches the fill, sampled on a 0.025 by 0.05 mm lattice beyond the gap; can only drop a spoke, never join one. */
function reaches(piece: Ring[], c: Pt, u: Pt, g: number, t1: number, hw: number, fill: PointIn): boolean {
  // across: 0.05 apart and 5 um inside each side, where a spoke cut at a corner meets the fill
  const step = 0.025,
    n = Math.max(1, Math.ceil((2 * hw) / 0.05)),
    e = Math.min(0.005, hw / 2)
  const vs = Array.from({ length: n + 1 }, (_, j) => -hw + e + ((2 * hw - 2 * e) * j) / n)
  let end = -Infinity
  for (const r of piece) for (const q of r) end = Math.max(end, (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1])
  for (let t = g + step / 2; t < Math.min(t1, end); t += step)
    for (const v of vs) {
      const p: Pt = [c[0] + u[0] * t - u[1] * v, c[1] + u[1] * t + u[0] * v]
      if (inside(piece, p) && fill.has(p)) return true
    }
  return false
}

/** Point in a ring set under the nonzero rule, with the edges bucketed in horizontal bands so a query visits only its band. */
export class PointIn {
  private y0: number
  private h: number
  private count: number
  private edges: Float64Array
  private start: Int32Array
  private index: Int32Array
  constructor(rings: Ring[]) {
    let n = 0
    for (const r of rings) n += r.length
    const E = (this.edges = new Float64Array(4 * n))
    let y0 = Infinity,
      y1 = -Infinity,
      j = 0
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const p = r[i],
          q = r[i + 1 < r.length ? i + 1 : 0]
        E[j++] = p[0]
        E[j++] = p[1]
        E[j++] = q[0]
        E[j++] = q[1]
        if (p[1] < y0) y0 = p[1]
        if (p[1] > y1) y1 = p[1]
      }
    const count = (this.count = Math.max(1, Math.min(4096, Math.round(Math.sqrt(n)))))
    this.y0 = n ? y0 : 0
    this.h = (n && y1 > y0 ? y1 - y0 : 1) / count
    const start = (this.start = new Int32Array(count + 1))
    const band = (y: number) => {
      const k = Math.floor((y - this.y0) / this.h)
      return k < 0 ? 0 : k >= count ? count - 1 : k
    }
    for (let e = 0; e < n; e++) {
      const a = E[4 * e + 1],
        b = E[4 * e + 3]
      const hi = band(a > b ? a : b)
      for (let k = band(a < b ? a : b); k <= hi; k++) start[k + 1]++
    }
    for (let k = 0; k < count; k++) start[k + 1] += start[k]
    const at = start.slice(0, count),
      index = (this.index = new Int32Array(start[count]))
    for (let e = 0; e < n; e++) {
      const a = E[4 * e + 1],
        b = E[4 * e + 3]
      const hi = band(a > b ? a : b)
      for (let k = band(a < b ? a : b); k <= hi; k++) index[at[k]++] = e
    }
  }
  has(pt: Pt): boolean {
    const [x, y] = pt
    const k = Math.floor((y - this.y0) / this.h)
    if (k < 0 || k >= this.count) return false
    const E = this.edges,
      index = this.index
    let wn = 0
    for (let i = this.start[k], end = this.start[k + 1]; i < end; i++) {
      const o = 4 * index[i],
        px = E[o],
        py = E[o + 1],
        qx = E[o + 2],
        qy = E[o + 3]
      const side = (qx - px) * (y - py) - (x - px) * (qy - py)
      if (py <= y) {
        if (qy > y && side > 0) wn++
      } else if (qy <= y && side < 0) wn--
    }
    return wn !== 0
  }
}

const GAP_SIDES = 16
const gapRings = new WeakMap<Pad, Map<string, Ring>>()

/** The thermal gap around a pad as a GAP_SIDES polygon on the pad's support lines, at most 2 percent of the radius outside the round offset. */
function gapRing(pad: Pad, layer: string, gap: number): Ring {
  let m = gapRings.get(pad)
  if (!m) gapRings.set(pad, (m = new Map()))
  const key = `${layer}:${gap}`
  const hit = m.get(key)
  if (hit) return hit
  const pts = copperRings(pad, layer).flat(),
    [cx, cy] = pad.at
  const n: Pt[] = [],
    h: number[] = []
  for (let k = 0; k < GAP_SIDES; k++) {
    const a = ((pad.rot + (k * 360) / GAP_SIDES) * Math.PI) / 180,
      u: Pt = [Math.cos(a), -Math.sin(a)]
    let best = -Infinity
    for (const p of pts) best = Math.max(best, (p[0] - cx) * u[0] + (p[1] - cy) * u[1])
    n.push(u)
    h.push(best + gap)
  }
  const ring: Ring = []
  for (let k = 0; k < GAP_SIDES; k++) {
    const a = n[k],
      b = n[(k + 1) % GAP_SIDES],
      ha = h[k],
      hb = h[(k + 1) % GAP_SIDES]
    const det = a[0] * b[1] - a[1] * b[0]
    ring.push([cx + (ha * b[1] - hb * a[1]) / det, cy + (a[0] * hb - b[0] * ha) / det])
  }
  // the orientation of Clipper's outer rings, like the grown copper it stands for
  const r = area([ring]) < 0 ? ring.reverse() : ring
  m.set(key, r)
  return r
}

/** How far along `u` from `c` the ray leaves the convex rings: the largest crossing. */
function rayExit(rings: Ring[], c: Pt, u: Pt): number {
  let best = -Infinity
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const p = r[i],
        q = r[(i + 1) % r.length]
      const ex = q[0] - p[0],
        ey = q[1] - p[1]
      const den = u[0] * ey - u[1] * ex
      if (Math.abs(den) < 1e-12) continue
      const dx = p[0] - c[0],
        dy = p[1] - c[1]
      const t = (dx * ey - dy * ex) / den,
        s = (dx * u[1] - dy * u[0]) / den
      if (s >= -1e-9 && s <= 1 + 1e-9 && t > best) best = t
    }
  return best
}

const along = (c: Pt, u: Pt, t: number): Pt => [c[0] + u[0] * t, c[1] + u[1] * t]

/** The rectangle `w` wide along `u` from `t0` to `t1` past `c`. */
function spokeRect(c: Pt, u: Pt, t0: number, t1: number, w: number): Ring {
  const nx = -u[1] * (w / 2),
    ny = u[0] * (w / 2)
  const a = along(c, u, t0),
    b = along(c, u, t1)
  const r: Ring = [
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
    [a[0] + nx, a[1] + ny],
  ]
  // the orientation of Clipper's outer rings, so the nonzero union and the offset count it as copper, not as a hole
  return area([r]) < 0 ? r.reverse() : r
}

/** Whether a ring edge enters the spoke rectangle with box `b`: when none does, the spoke is wholly inside or outside the ring. */
function crosses(r: Ring, b: Box, c: Pt, u: Pt, t0: number, t1: number, hw: number): boolean {
  const x1 = b.x + b.w,
    y1 = b.y + b.h,
    e = 1e-9
  for (let i = 0; i < r.length; i++) {
    const p = r[i],
      q = r[(i + 1) % r.length]
    if (Math.max(p[0], q[0]) < b.x || Math.min(p[0], q[0]) > x1 || Math.max(p[1], q[1]) < b.y || Math.min(p[1], q[1]) > y1) continue
    // Liang-Barsky in the spoke's frame: s along it, n across it
    const px = p[0] - c[0],
      py = p[1] - c[1],
      qx = q[0] - c[0],
      qy = q[1] - c[1]
    const s0 = px * u[0] + py * u[1],
      n0 = -px * u[1] + py * u[0]
    const ds = qx * u[0] + qy * u[1] - s0,
      dn = -qx * u[1] + qy * u[0] - n0
    let lo = 0,
      hi = 1
    const clip = (den: number, num: number) => {
      if (Math.abs(den) < 1e-15) return num >= -e
      const t = num / den
      if (den > 0) {
        if (t < hi) hi = t
      } else if (t > lo) lo = t
      return lo <= hi
    }
    if (clip(ds, t1 - s0 + e) && clip(-ds, s0 - t0 + e) && clip(dn, hw - n0 + e) && clip(-dn, n0 + hw + e)) return true
  }
  return false
}

/** The nonzero winding of rings around a point is not zero. */
export function inside(rings: Ring[], pt: Pt): boolean {
  let wn = 0
  const [x, y] = pt
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const p = r[i],
        q = r[(i + 1) % r.length]
      const side = (q[0] - p[0]) * (y - p[1]) - (x - p[0]) * (q[1] - p[1])
      if (p[1] <= y) {
        if (q[1] > y && side > 0) wn++
      } else if (q[1] <= y && side < 0) wn--
    }
  return wn !== 0
}

/** A fill with every part narrower than `minW` removed. */
function opened(fill: Poly[], minW: number): Poly[] {
  if (!(minW > 0) || !fill.length) return fill
  const shrunk = offset(polysToRings(fill), -minW / 2)
  return shrunk.length ? offset(polysToRings(shrunk), minW / 2) : []
}

/** The box of an item's copper on every copper layer and of its hole. */
function itemBox(it: Item, cu: string[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  const add = (b: Box) => {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  for (const layer of copperLayersOf(it, cu)) if (copperRings(it, layer).length) add(copperBox(it, layer))
  const r = it.kind === 'pad' ? (it.drill ? Math.max(...it.drill) / 2 : 0) : it.kind === 'via' ? it.drill / 2 : 0
  if (r && (it.kind === 'pad' || it.kind === 'via')) add({ x: it.at[0] - r, y: it.at[1] - r, w: 2 * r, h: 2 * r })
  return x0 === Infinity ? EMPTY : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
