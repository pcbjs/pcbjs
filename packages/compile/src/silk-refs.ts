// Silk refs: each label at the first clean spot around its courtyard, sized by the part; see layout.md Silk refs.
import type { Board, DrcMarker, Footprint, Graphic, Pt, Ring, Text } from '@pcbjs/core/model'
import { strokeText } from '@pcbjs/core/text'
import { applyRing, bbox, mul, offset, placement, polysToRings, strokeClosed, strokeOpen } from './geom.js'
import { REF_AT } from './flatten.js'
import { bareHole } from './bare.js'
import { Grid, type Box } from './spatial.js'

/** Label height per mm of the courtyard's short side, the largest height, and the stroke per mm of height. */
const SCALE = 0.2, CEIL = 1.2, STROKE = 0.15
/** Default `silkMinHeight`, mm. */
const FLOOR = 1
/** Fallback search reach, for a part too small to hold its label, and pitch, gap to the courtyard, to other text and labels, and the edge margin, mm. */
const REACH = 3, REACH_SMALL = 1, STEP = 0.25, GAP = 0.2, TEXT_GAP = 0.4, EDGE = 0.2
/** Largest gap between the courtyards of neighbours in a row, mm. */
const ROW_GAP = 2

/** Candidate sides as the label reads, `[along, up, flush]`: above, below, left, right, then the corners, first above or below flush with an end, then diagonally off it. */
export const SIDES: readonly [number, number, boolean][] = [[0, 1, false], [0, -1, false], [-1, 0, false], [1, 0, false],
  [-1, 1, true], [1, 1, true], [-1, -1, true], [1, -1, true], [-1, 1, false], [1, 1, false], [-1, -1, false], [1, -1, false]]

const nm = (v: number) => Math.round(v * 1e6) / 1e6 || 0
const byRef = (a: Footprint, b: Footprint) => a.ref.localeCompare(b.ref, 'en', { numeric: true })

/** Offsets within REACH on the STEP grid, nearest first. */
const OFFSETS: Pt[] = (() => {
  const out: Pt[] = []
  const n = Math.floor(REACH / STEP)
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (Math.hypot(i, j) * STEP <= REACH + 1e-9) out.push([i * STEP, j * STEP])
  return out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || a[1] - b[1] || a[0] - b[0])
})()

const ringOfBox = (b: Box): Ring => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })
const meets = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const within = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
const shared = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
const at = (p: Pt, shape: Box): Box => ({ x: p[0] + shape.x, y: p[1] + shape.y, w: shape.w, h: shape.h })

/** Label height for a courtyard: SCALE of its short side to 0.1 mm, between `floor` and CEIL. */
export function refSize(body: Box, floor: number): number {
  return Math.max(floor, Math.min(CEIL, Math.round(SCALE * Math.min(body.w, body.h) * 10) / 10))
}

/** Label rotation: 90 for a part turned a quarter, else 0, so it reads left to right or bottom to top. */
export function refRotation(rot: number): number {
  const q = rot / 90
  return Math.abs(q - Math.round(q)) < 1e-6 && Math.abs(Math.round(q)) % 2 === 1 ? 90 : 0
}

/** Even-odd point in rings. */
function inside(p: Pt, rings: Ring[]): boolean {
  let n = false
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n = !n
  return n
}

/** Whether a segment crosses the open box. */
function segHitsBox(a: Pt, b: Pt, x0: number, y0: number, x1: number, y1: number): boolean {
  let lo = 0, hi = 1
  const dx = b[0] - a[0], dy = b[1] - a[1]
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as const) {
    if (Math.abs(p) < 1e-15) { if (q <= 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > lo) lo = t } else if (t < hi) hi = t
    if (lo >= hi) return false
  }
  return true
}

/** Whether a box and the area of a set of rings, even-odd, overlap. */
function boxHitsRings(b: Box, rings: Ring[]): boolean {
  const x1 = b.x + b.w, y1 = b.y + b.h
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const p = r[i]
      if (p[0] > b.x && p[0] < x1 && p[1] > b.y && p[1] < y1) return true
      if (segHitsBox(p, r[(i + 1) % r.length], b.x, b.y, x1, y1)) return true
    }
  return inside([b.x + b.w / 2, b.y + b.h / 2], rings)
}

/** Shapes with their boxes, for a grid query. */
class Shapes {
  private grid: Grid
  constructor(private shapes: { box: Box; rings: Ring[] }[]) { this.grid = new Grid(shapes.map(s => s.box)) }
  count(b: Box): number {
    let n = 0
    if (this.shapes.length) for (const k of this.grid.query(b)) { const s = this.shapes[k]; if (meets(s.box, b) && boxHitsRings(b, s.rings)) n++ }
    return n
  }
}

interface Part { fp: Footprint; body: Box; size: number; rot: number }
interface Spot { p: Pt; shape: Box }
interface Look { size: number; thickness: number; draw: (p: Pt, rot: number) => Ring[] }
/** A label taken: `box` is its ink box grown by TEXT_GAP; a `fixed` one came from refAt. */
interface Label { part: Part; p: Pt; rot: number; look: Look; box: Box; fixed: boolean }

/** Draw the silk refs after routing and the zone fill, so routed item ids do not move; returns the `silk-ref` warning and the `silk-ref-hidden` info. */
export function silkRefs(board: Board, on: boolean): DrcMarker[] {
  if (!on || !board.footprints.length) return []
  const r = board.rules
  const floor = r.silkMinHeight ?? FLOOR
  const byId = new Map(board.items.map(it => [it.id, it]))
  const band = r.edge && r.edge.width > 0 && (r.edge.kinds ?? ['silk']).includes('silk') ? r.edge : null
  const excepted = new Set((band?.except ?? []).filter((q): q is string => typeof q === 'string'))
  const insets = new Map<number, { rings: Ring[]; box: Box | null } | null>()
  const innerOf = (d: number) => {
    if (!board.outline.length) return null
    if (!insets.has(d)) { const rings = polysToRings(offset(board.outline, -d)); insets.set(d, { rings, box: rings.length ? bbox(rings) : null }) }
    return insets.get(d)!
  }
  let nextId = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
  const omitted: Footprint[] = [], hidden: Footprint[] = []
  for (const side of ['F', 'B'] as const) {
    const silk = `${side}.SilkS`, cu = `${side}.Cu`
    const fps = board.footprints.filter(f => f.side === side)
    if (!fps.length) continue
    // hard: pad mask openings on this side, kept silkToPad clear, and the text already there
    const hard: { box: Box; rings: Ring[] }[] = []
    for (const it of board.items) {
      if (it.kind === 'pad' && it.layers.includes(cu)) {
        const rings = polysToRings(offset([it.poly], (it.maskExpansion ?? r.maskExpansion) + r.silkToPad))
        if (rings.length) hard.push({ box: bbox(rings), rings })
      } else if (it.kind === 'text' && it.layer === silk && (it.strokes.length || it.polys?.length)) {
        const box = grow(bbox(it.polys ? it.polys.map(q => q.outer) : it.strokes), it.thickness / 2 + TEXT_GAP)
        hard.push({ box, rings: [ringOfBox(box)] })
      }
    }
    // soft: other silk graphics, and the courtyards of the parts on this side
    const soft: { box: Box; rings: Ring[] }[] = []
    for (const it of board.items) {
      if (it.kind !== 'graphic' || it.layer !== silk) continue
      const g = it as Graphic
      const rings = g.fill ? g.paths.filter(q => q.length >= 3) : g.paths.flatMap((q, i) => polysToRings(g.closed[i] ? strokeClosed(q, g.width) : strokeOpen(q, g.width)))
      if (rings.length) soft.push({ box: bbox(rings), rings })
    }
    const hardIdx = new Shapes(hard), softIdx = new Shapes(soft)
    const crtyd = new Map<string, Ring[]>()
    for (const it of board.items) if (it.kind === 'graphic' && it.layer === `${side}.CrtYd` && it.ref) crtyd.set(it.ref, [...(crtyd.get(it.ref) ?? []), ...it.paths])
    const bodies = fps.map(fp => ({ ref: fp.ref, box: courtyard(fp, crtyd.get(fp.ref), byId) }))
    const bodyIdx = new Grid(bodies.map(b => b.box))
    const labels: Label[] = []

    // a box the label may take at all: on the board clear of the edge band, off other labels, pads and text
    const allowed = (b: Box, ref: string, skip?: Label): boolean => {
      const inner = innerOf(band && !excepted.has(ref) ? Math.max(EDGE, band.width) : EDGE)
      if (inner) {
        if (!inner.box || !within(b, inner.box)) return false
        const corners: Pt[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
        if (!corners.every(p => inside(p, inner.rings))) return false
        for (const ring of inner.rings) for (let i = 0; i < ring.length; i++) if (segHitsBox(ring[i], ring[(i + 1) % ring.length], b.x, b.y, b.x + b.w, b.y + b.h)) return false
      }
      return !labels.some(l => l !== skip && meets(l.box, b)) && !hardIdx.count(b)
    }
    // overlap with courtyards, mm², and silk graphics crossed, weighted as half a mm² each; Infinity where not allowed
    const score = (b: Box, ref: string): number => {
      if (!allowed(b, ref)) return Infinity
      let s = 0.5 * softIdx.count(b)
      for (const k of bodyIdx.query(b)) s += shared(bodies[k].box, b)
      return s
    }

    const parts: Part[] = []
    for (const fp of fps) {
      const own = REF_AT.get(fp)
      if (own === false || !fp.pads.length) continue
      // test points, pogo pads, fiducials and mounting holes get no automatic ref; a refAt still draws one
      if (own === undefined && bareHole(board, fp)) continue
      // a footprint that draws its own ref on silk keeps it
      if (board.items.some(it => it.kind === 'text' && it.layer === silk && it.ref === fp.ref && it.text === fp.ref)) continue
      const body = bodies[fps.indexOf(fp)].box
      parts.push({ fp, body, size: refSize(body, floor), rot: refRotation(fp.rot) })
    }

    const laidOut = (part: Part, size: number): Look => {
      const thickness = Math.max(r.silkMinWidth, Math.round(STROKE * size * 100) / 100)
      const laid = strokeText(part.fp.ref, { size, thickness, anchor: 'middle' })
      const dy = size - laid.height / 2
      // mirrored on the back so the ref reads from below
      const draw = (p: Pt, rot: number): Ring[] => {
        let m = placement(p[0], p[1], rot, false)
        if (side === 'B') m = mul(m, placement(0, 0, 0, true))
        return laid.strokes.map(s => applyRing(m, s.map(([a, b]) => [a, b + dy] as Pt)).map(([a, b]) => [nm(a), nm(b)] as Pt))
      }
      return { size, thickness, draw }
    }
    const shapeOf = (draw: (p: Pt, rot: number) => Ring[], rot: number, thickness: number) => grow(bbox(draw([0, 0], rot)), thickness / 2)

    // the spot beside the courtyard on a side, `[along, up]` as the label reads; a corner is flush with that end
    const beside = (body: Box, rot: number, shape: Box, [u, v, flush]: readonly [number, number, boolean]): Spot => {
      const dx = rot === 90 ? -v : u, dy = rot === 90 ? -u : -v
      const fx = flush && rot !== 90, fy = flush && rot === 90
      const x = dx === 0 ? body.x + body.w / 2 - (shape.x + shape.w / 2)
        : fx ? (dx < 0 ? body.x - shape.x : body.x + body.w - (shape.x + shape.w))
        : dx < 0 ? body.x - GAP - (shape.x + shape.w) : body.x + body.w + GAP - shape.x
      const y = dy === 0 ? body.y + body.h / 2 - (shape.y + shape.h / 2)
        : fy ? (dy < 0 ? body.y - shape.y : body.y + body.h - (shape.y + shape.h))
        : dy < 0 ? body.y - GAP - (shape.y + shape.h) : body.y + body.h + GAP - shape.y
      return { p: [nm(x), nm(y)], shape }
    }
    // inside the courtyard over a pad-free area, nearest its centre
    const under = (part: Part, shape: Box): Spot | null => {
      const c: Pt = [part.body.x + part.body.w / 2, part.body.y + part.body.h / 2]
      for (const [ox, oy] of OFFSETS) {
        const p: Pt = [nm(c[0] - (shape.x + shape.w / 2) + ox), nm(c[1] - (shape.y + shape.h / 2) + oy)]
        const b = at(p, shape)
        if (within(b, part.body) && allowed(b, part.fp.ref) && !softIdx.count(b)) return { p, shape }
      }
      return null
    }
    // the nearest allowed spot within `reach` of a side
    const nearest = (part: Part, shape: Box, reach: number): Spot | null => {
      for (const [ox, oy] of OFFSETS) {
        if (Math.hypot(ox, oy) > reach + 1e-9) break
        for (const s of SIDES.slice(0, 4)) {
          const a = beside(part.body, part.rot, shape, s), p: Pt = [nm(a.p[0] + ox), nm(a.p[1] + oy)]
          if (allowed(at(p, shape), part.fp.ref)) return { p, shape }
        }
      }
      return null
    }
    const label = (part: Part, spot: Spot, look: Look, rot = part.rot, fixed = false): Label => ({ part, p: spot.p, rot, look, box: grow(at(spot.p, spot.shape), TEXT_GAP), fixed })
    const take = (part: Part, spot: Spot, look: Look) => { labels.push(label(part, spot, look)) }
    // a side blocked by one movable label: move that label to its first clean spot, else its least overlapping one
    const shove = (part: Part, look: Look, shape: Box): boolean => {
      for (const s of SIDES) {
        const spot = beside(part.body, part.rot, shape, s), b = at(spot.p, shape)
        const blockers = labels.filter(l => meets(l.box, b))
        if (blockers.length !== 1 || blockers[0].fixed || !allowed(b, part.fp.ref, blockers[0])) continue
        const moved = blockers[0], k = labels.indexOf(moved), mine = label(part, spot, look)
        labels[k] = mine
        const other = shapeOf(moved.look.draw, moved.rot, moved.look.thickness)
        const spots = SIDES.map(t => beside(moved.part.body, moved.rot, other, t)), scores = spots.map(t => score(at(t.p, other), moved.part.fp.ref))
        const to = spots[scores.indexOf(Math.min(...scores))]
        if (Math.min(...scores) < Infinity) { labels[k] = label(moved.part, to, moved.look); labels.push(mine); return true }
        labels[k] = moved
      }
      return false
    }

    const place = (part: Part) => {
      const sizes = part.size > floor ? [part.size, floor] : [floor]
      let best: { spot: Spot; look: Look; s: number } | null = null
      for (const size of sizes) {
        const look = laidOut(part, size), shape = shapeOf(look.draw, part.rot, look.thickness)
        for (const side of SIDES) {
          const spot = beside(part.body, part.rot, shape, side), s = score(at(spot.p, shape), part.fp.ref)
          if (s === 0) { take(part, spot, look); return }
          if (s < (best?.s ?? Infinity)) best = { spot, look, s }
        }
      }
      const look = laidOut(part, floor), shape = shapeOf(look.draw, part.rot, look.thickness)
      if (shove(part, look, shape)) return
      const roomy = shape.w <= part.body.w && shape.h <= part.body.h
      const inner = roomy ? under(part, shape) : null
      if (inner) { take(part, inner, look); return }
      if (best) { take(part, best.spot, best.look); return }
      const far = nearest(part, shape, roomy ? REACH : REACH_SMALL)
      if (far) take(part, far, look)
      else (roomy ? omitted : hidden).push(part.fp)
    }

    // rows and columns of the same footprint the same way round take one side together when it is clean for all
    const grouped = new Set<Part>()
    const lines: Part[][] = []
    for (const axis of [0, 1] as const) {
      const lanes = new Map<string, Part[]>()
      for (const p of parts) {
        if (grouped.has(p) || REF_AT.get(p.fp)) continue
        const across = axis === 0 ? p.body.y + p.body.h / 2 : p.body.x + p.body.w / 2
        const key = `${p.fp.id}|${p.rot}|${nm(p.body.w)}x${nm(p.body.h)}|${Math.round(across * 100)}`
        lanes.set(key, [...(lanes.get(key) ?? []), p])
      }
      for (const lane of lanes.values()) {
        const start = (p: Part) => (axis === 0 ? p.body.x : p.body.y), len = (p: Part) => (axis === 0 ? p.body.w : p.body.h)
        lane.sort((a, b) => start(a) - start(b) || byRef(a.fp, b.fp))
        let run: Part[] = []
        const close = () => { if (run.length > 1) { lines.push(run); for (const p of run) grouped.add(p) } run = [] }
        for (const p of lane) {
          const prev = run[run.length - 1]
          if (prev && start(p) - (start(prev) + len(prev)) > ROW_GAP) close()
          run.push(p)
        }
        close()
      }
    }
    lines.sort((a, b) => byRef(a[0].fp, b[0].fp))
    const placeLine = (line: Part[]): boolean => {
      for (const s of SIDES) {
        const mark = labels.length
        for (const part of line) {
          const l = laidOut(part, part.size), spot = beside(part.body, part.rot, shapeOf(l.draw, part.rot, l.thickness), s)
          if (score(at(spot.p, spot.shape), part.fp.ref) !== 0) break
          take(part, spot, l)
        }
        if (labels.length - mark === line.length) return true
        labels.length = mark
      }
      return false
    }
    // a refAt is used as given, and the automatic labels keep clear of it
    for (const part of parts) {
      const own = REF_AT.get(part.fp)
      if (!own) continue
      const look = laidOut(part, part.size), rot = upright(own.rot)
      labels.push(label(part, { p: own.at, shape: shapeOf(look.draw, rot, look.thickness) }, look, rot, true))
    }
    const singles: Part[] = []
    for (const line of lines) if (!placeLine(line)) singles.push(...line)
    singles.push(...parts.filter(p => !grouped.has(p) && !REF_AT.get(p.fp)))
    // the most hemmed in first, then the largest
    const room = new Map(singles.map(part => {
      const l = laidOut(part, part.size), shape = shapeOf(l.draw, part.rot, l.thickness)
      return [part, SIDES.filter(s => score(at(beside(part.body, part.rot, shape, s).p, shape), part.fp.ref) === 0).length]
    }))
    const area = (p: Part) => Math.round(p.body.w * p.body.h * 100)
    singles.sort((a, b) => room.get(a)! - room.get(b)! || area(b) - area(a) || byRef(a.fp, b.fp))
    for (const part of singles) place(part)
    for (const { part: { fp }, p, rot, look } of labels)
      board.items.push({ kind: 'text', id: nextId++, layer: silk, ref: fp.ref, ...(fp.src ? { src: fp.src } : {}), ...(fp.chain ? { chain: fp.chain } : {}), at: p, rot, size: look.size, thickness: look.thickness, text: fp.ref, anchor: 'middle', mirrored: side === 'B', strokes: look.draw(p, rot) } satisfies Text)
  }
  const out: DrcMarker[] = []
  const list = (fps: Footprint[]) => fps.sort(byRef).map(f => f.ref)
  if (omitted.length) {
    const names = list(omitted), many = names.length > 1
    out.push({ severity: 'warning', rule: 'silk-ref', at: omitted[0].at, ...(omitted[0].src ? { src: omitted[0].src } : {}),
      message: `no clear spot within ${REACH} mm for the silk ref${many ? 's' : ''} of ${names.join(', ')}; ${many ? 'they are' : 'it is'} left out, place ${many ? 'them' : 'it'} with refAt="x y rot" or turn ${many ? 'them' : 'it'} off with ref={false}` })
  }
  if (hidden.length) {
    const names = list(hidden), many = names.length > 1
    out.push({ severity: 'info', rule: 'silk-ref-hidden', at: hidden[0].at, ...(hidden[0].src ? { src: hidden[0].src } : {}),
      message: `no clean spot beside the courtyard${many ? 's' : ''} of ${names.join(', ')}, too small to hold ${many ? 'their refs' : 'its ref'}; ${many ? 'they are' : 'it is'} left out, place ${many ? 'them' : 'it'} with refAt="x y rot" or turn ${many ? 'them' : 'it'} off with ref={false}` })
  }
  return out
}

/** A text rotation that reads from below or the right: in (-90, 90]. */
function upright(rot: number): number {
  let a = ((rot % 360) + 360) % 360
  if (a > 90 && a <= 270) a -= 180
  else if (a > 270) a -= 360
  return a
}

/** The box of a footprint's courtyard, else of its pads. */
function courtyard(fp: Footprint, rings: Ring[] | undefined, byId: Map<number, Board['items'][number]>): Box {
  if (rings?.length) return bbox(rings)
  const pads = fp.pads.map(id => byId.get(id)).flatMap(p => (p && p.kind === 'pad' ? [p.poly] : []))
  return pads.length ? bbox(pads) : { x: fp.at[0], y: fp.at[1], w: 0, h: 0 }
}
