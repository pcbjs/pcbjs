// Outers have a positive signed area in board mm, y down, holes a negative one, so a reader needs no containment test.
import type { Board, Item, Pad, Poly, Pt, Ring, Via } from '@pcbjs/core/model'
import type { SiteItem } from '@pcbjs/core/site-data'
import { bbox, bboxOverlap, clipRings, offsetRings, pointInRing, polysToRings, strokeClosed, strokeOpen, union } from '@pcbjs/compile/geom'
import { circleRing } from '@pcbjs/compile/path'
import { copperLayers } from '@pcbjs/compile/layers'
import { copperLayersOf, copperRings } from '@pcbjs/compile/copper'
import { Grid, type Box } from '@pcbjs/compile/spatial'

// 1 µm, far below anything a fab makes
const Q = 1e3
const q = (v: number) => Math.round(v * Q) / Q

function signedArea(r: Ring): number {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return a / 2
}

function clean(r: Ring, outer: boolean): [number, number][] | null {
  const out: [number, number][] = []
  for (const [x, y] of r) {
    const p: [number, number] = [q(x), q(y)]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop()
  if (out.length < 3) return null
  const a = signedArea(out)
  if (a === 0) return null
  if ((a > 0) !== outer) out.reverse()
  return out
}

/** Rings as Clipper gives them, outers positive and holes negative, rounded and cleaned. */
function signed(rings: Ring[]): [number, number][][] {
  const out: [number, number][][] = []
  for (const r of rings) { const c = clean(r, signedArea(r) > 0); if (c) out.push(c) }
  return out
}

function fromPolys(ps: Poly[]): [number, number][][] {
  const out: [number, number][][] = []
  for (const p of ps) {
    const o = clean(p.outer, true)
    if (!o) continue
    out.push(o)
    for (const h of p.holes) { const c = clean(h, false); if (c) out.push(c) }
  }
  return out
}

/** The drill of a pad as a ring: a circle, or a slot with round ends turned with the pad. */
function drillRing(p: Pad): Ring {
  const [w, h] = p.drill!
  if (w === h) return circleRing(p.at[0], p.at[1], w / 2)
  const r = Math.min(w, h) / 2, half = Math.abs(w - h) / 2, alongX = w > h
  const pts: Ring = []
  const n = 12
  for (const s of [1, -1]) for (let i = 0; i <= n; i++) {
    const a = (alongX ? -Math.PI / 2 : 0) + (s > 0 ? 0 : Math.PI) + (Math.PI * i) / n
    const cx = alongX ? s * half : 0, cy = alongX ? 0 : s * half
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  // the hole is drawn rotate(-rot) in the y-down SVG frame, see holesMarkup
  const t = (-p.rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t)
  return pts.map(([x, y]) => [p.at[0] + x * c - y * sn, p.at[1] + x * sn + y * c])
}

function geometry(it: Item): [number, number][][] {
  switch (it.kind) {
    case 'pad': {
      const outer = clean(it.poly, true)
      if (!outer) return []
      const hole = it.drill ? clean(drillRing(it), false) : null
      return hole ? [outer, hole] : [outer]
    }
    case 'via': return [clean(circleRing(it.at[0], it.at[1], it.size / 2), true), clean(circleRing(it.at[0], it.at[1], it.drill / 2), false)].filter(Boolean) as [number, number][][]
    // the stroke the compiler made for its checks, from its cache
    case 'track': return signed(copperRings(it, it.layer))
    case 'zone': return fromPolys(it.fill)
    case 'graphic':
      if (it.fill) return fromPolys(union(it.paths.filter(r => r.length >= 3)))
      return fromPolys(union(it.paths.flatMap((r, i) => polysToRings(it.closed[i] ? strokeClosed(r, it.width) : strokeOpen(r, it.width)))))
    case 'text': return fromPolys(it.polys ?? union(it.strokes.flatMap(r => polysToRings(strokeOpen(r, it.thickness)))))
  }
}

// a drilled hole or a mask opening; its rings are made on first use
interface Cutter { box: Box; owner: number; rings: () => Ring[]; point: Pt }
// layers null: every copper layer
interface Hole extends Cutter { reach: number; layers: Set<string> | null }
// holdsOwner: the opening holds its pad's copper whole, a mask expansion of zero or more
interface Opening extends Cutter { holdsOwner: boolean }

const once = (make: () => Ring[]) => { let r: Ring[] | null = null; return () => (r ??= make()) }
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })

function holesOf(board: Board, cu: string[]): Hole[] {
  const out: Hole[] = []
  for (const it of board.items) {
    if (it.kind === 'via') {
      const ring = clean(circleRing(it.at[0], it.at[1], it.drill / 2), true) ?? circleRing(it.at[0], it.at[1], it.drill / 2)
      const span = copperLayersOf(it, cu)
      out.push({ rings: () => [ring], box: bbox([ring]), point: it.at, reach: it.drill / 2, owner: it.id, layers: span.length === cu.length ? null : new Set(span) })
    } else if (it.kind === 'pad' && it.drill) {
      // a pad's hole is drilled through the whole board, plated or not
      const ring = clean(drillRing(it), true) ?? drillRing(it)
      out.push({ rings: () => [ring], box: bbox([ring]), point: it.at, reach: Math.max(it.drill[0], it.drill[1]) / 2, owner: it.id, layers: null })
    }
  }
  return out
}

function openingsOf(board: Board, side: 'F' | 'B'): Opening[] {
  const out: Opening[] = []
  const layer = `${side}.Mask`
  for (const it of board.items) {
    if (it.kind === 'pad') {
      if (it.maskRings && it.layers.includes(layer)) {
        // the compiler's own rings may run either way
        const rings = fromPolys(union(it.maskRings.map(x => clean(x, true) ?? x)))
        if (rings.length) out.push({ rings: () => rings, box: bbox(rings), point: rings[0][0], owner: it.id, holdsOwner: false })
      } else if (it.layers.includes(`${side}.Cu`)) {
        // the pad grown by its mask expansion, as padMask makes it, built only when another item comes near
        const e = it.maskExpansion ?? board.rules.maskExpansion
        const poly = it.poly
        out.push({ rings: once(() => (e === 0 ? [clean(poly, true) ?? poly] : signed(offsetRings([clean(poly, true) ?? poly], e)))), box: grow(bbox([poly]), Math.max(e, 0)), point: it.at, owner: it.id, holdsOwner: e >= 0 })
      }
    } else if (it.kind !== 'via' && it.layer === layer) {
      const rings = geometry(it)
      if (rings.length) out.push({ rings: () => rings, box: bbox(rings), point: rings[0][0], owner: it.id, holdsOwner: false })
    }
  }
  return out
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

// a track is tested against its centre line, anything else by box alone
function reaches(it: Item, h: Hole): boolean {
  if (it.kind !== 'track') return true
  const lim = it.width / 2 + h.reach
  const p = it.pts
  if (p.length === 1) return Math.hypot(p[0][0] - h.point[0], p[0][1] - h.point[1]) < lim
  for (let i = 1; i < p.length; i++) if (segDist(h.point, p[i - 1], p[i]) < lim) return true
  return false
}

// touching and overlapping included
function segsMeet(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
    const v = (qx - px) * (ry - py) - (qy - py) * (rx - px)
    return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : -1
  }
  const on = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.min(px, qx) - 1e-9 <= rx && rx <= Math.max(px, qx) + 1e-9 && Math.min(py, qy) - 1e-9 <= ry && ry <= Math.max(py, qy) + 1e-9
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy), o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by)
  if (o1 !== o2 && o3 !== o4) return true
  return (o1 === 0 && on(ax, ay, bx, by, cx, cy)) || (o2 === 0 && on(ax, ay, bx, by, dx, dy)) || (o3 === 0 && on(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && on(cx, cy, dx, dy, bx, by))
}

// an item's ring edges in a grid, to ask which rings a cutter crosses
class Edges {
  private seg: Float64Array
  private ringOf: Int32Array
  private ringBoxes: Box[]
  private x0: number; private y0: number; private cell: number; private cols: number; private rows: number
  private start: Int32Array; private list: Int32Array
  constructor(readonly rings: [number, number][][]) {
    this.ringBoxes = rings.map(r => bbox([r]))
    let n = 0
    for (const r of rings) n += r.length
    this.seg = new Float64Array(n * 4); this.ringOf = new Int32Array(n)
    let k = 0
    rings.forEach((r, ri) => {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        this.seg[k * 4] = r[j][0]; this.seg[k * 4 + 1] = r[j][1]; this.seg[k * 4 + 2] = r[i][0]; this.seg[k * 4 + 3] = r[i][1]
        this.ringOf[k++] = ri
      }
    })
    const b = bbox(rings)
    const side = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(n / 4))))
    this.cell = Math.max(b.w, b.h, 1e-3) / side
    this.x0 = b.x; this.y0 = b.y
    this.cols = Math.floor(b.w / this.cell) + 1; this.rows = Math.floor(b.h / this.cell) + 1
    const count = new Int32Array(this.cols * this.rows + 1)
    this.each(k => { count[k + 1]++ })
    for (let i = 1; i < count.length; i++) count[i] += count[i - 1]
    this.start = count.slice()
    this.list = new Int32Array(count[count.length - 1])
    const fill = count.slice()
    this.each((c, e) => { this.list[fill[c]++] = e })
  }
  private col(x: number) { return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell))) }
  private row(y: number) { return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell))) }
  private each(f: (cell: number, edge: number) => void) {
    const s = this.seg
    for (let e = 0; e < this.ringOf.length; e++) {
      const c0 = this.col(Math.min(s[e * 4], s[e * 4 + 2])), c1 = this.col(Math.max(s[e * 4], s[e * 4 + 2]))
      const r0 = this.row(Math.min(s[e * 4 + 1], s[e * 4 + 3])), r1 = this.row(Math.max(s[e * 4 + 1], s[e * 4 + 3]))
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f(r * this.cols + c, e)
    }
  }
  // the cutter's rings are made only when an edge of the item comes near
  crossed(c: Cutter): Set<number> {
    const hit = new Set<number>()
    const q = grow(c.box, 1e-6), s = this.seg
    if (q.x > this.x0 + this.cols * this.cell || q.x + q.w < this.x0 || q.y > this.y0 + this.rows * this.cell || q.y + q.h < this.y0) return hit
    const c0 = this.col(q.x), c1 = this.col(q.x + q.w), r0 = this.row(q.y), r1 = this.row(q.y + q.h)
    let cut: Ring[] | null = null
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) {
      for (let i = this.start[r * this.cols + cc]; i < this.start[r * this.cols + cc + 1]; i++) {
        const e = this.list[i]
        if (hit.has(this.ringOf[e])) continue
        const ax = s[e * 4], ay = s[e * 4 + 1], bx = s[e * 4 + 2], by = s[e * 4 + 3]
        if (Math.max(ax, bx) < q.x || Math.min(ax, bx) > q.x + q.w || Math.max(ay, by) < q.y || Math.min(ay, by) > q.y + q.h) continue
        cut ??= c.rings()
        let meet = false
        for (const cr of cut) {
          for (let m = 0, n = cr.length - 1; m < cr.length && !meet; n = m++) {
            const [cx, cy] = cr[n], [dx, dy] = cr[m]
            if (Math.max(cx, dx) < Math.min(ax, bx) - 1e-9 || Math.min(cx, dx) > Math.max(ax, bx) + 1e-9 || Math.max(cy, dy) < Math.min(ay, by) - 1e-9 || Math.min(cy, dy) > Math.max(ay, by) + 1e-9) continue
            meet = segsMeet(ax, ay, bx, by, cx, cy, dx, dy)
          }
          if (meet) break
        }
        if (meet) hit.add(this.ringOf[e])
      }
    }
    return hit
  }
  // the rings inside the cutter, given that no edge of theirs meets it
  within(c: Cutter): number[] {
    const out: number[] = [], b = c.box
    this.ringBoxes.forEach((r, k) => {
      if (r.x < b.x || r.y < b.y || r.x + r.w > b.x + b.w || r.y + r.h > b.y + b.h) return
      const cut = c.rings(), p = this.rings[k][0]
      let w = 0
      for (const c of cut) if (pointInRing(p, c)) w += signedArea(c) > 0 ? 1 : -1
      if (w > 0) out.push(k)
    })
    return out
  }
  // p is in the copper when the rings round it wind once more as outers than as holes
  inside(p: Pt): boolean {
    let w = 0
    this.rings.forEach((r, i) => {
      const b = this.ringBoxes[i]
      if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h || !pointInRing(p, r)) return
      w += signedArea(r) > 0 ? 1 : -1
    })
    return w > 0
  }
}

// null when no cutter touches; only a cutter that crosses an outer ring makes Clipper cut the whole item, others just grow holes
function subtract(rings: [number, number][][], cutters: Cutter[], own: Pt | null, edgesOf: () => Edges): [number, number][][] | null {
  if (!cutters.length) return null
  const edges = edgesOf()
  const used: Cutter[] = [], hits: number[][] = []
  for (const c of cutters) {
    const hit = edges.crossed(c)
    if (hit.size) { used.push(c); hits.push([...hit]); continue }
    const held = edges.within(c)
    if (held.length === rings.length) return []
    if (held.length || edges.inside(c.point)) { used.push(c); hits.push(held) }
  }
  if (!used.length) return null
  if (hits.some(h => h.some(k => signedArea(rings[k]) > 0))) return cleanSigned(clipRings('difference', rings, used.flatMap(c => c.rings())), own)
  // only holes are crossed: each group of crossed holes and the cutters that meet them is unioned into grown holes
  const n = used.length, up = Array.from({ length: n + rings.length }, (_, i) => i)
  const find = (i: number): number => { while (up[i] !== i) i = up[i] = up[up[i]]; return i }
  const join = (i: number, j: number) => { up[find(i)] = find(j) }
  hits.forEach((h, i) => { for (const k of h) join(i, n + k) })
  const order = used.map((_, i) => i).sort((i, j) => used[i].box.x - used[j].box.x)
  for (let a = 0; a < n; a++) {
    const A = used[order[a]].box
    for (let b = a + 1; b < n; b++) {
      const B = used[order[b]].box
      if (B.x > A.x + A.w) break
      if (bboxOverlap(A, B)) join(order[a], order[b])
    }
  }
  const groups = new Map<number, { cut: number[]; holes: number[] }>()
  const group = (i: number) => { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, g = { cut: [], holes: [] }); return g }
  for (let i = 0; i < n; i++) group(i).cut.push(i)
  const touched = new Set(hits.flat())
  for (const k of touched) group(n + k).holes.push(k)
  const out = rings.filter((_, k) => !touched.has(k))
  for (const g of groups.values()) {
    if (g.cut.length === 1 && !g.holes.length) { for (const r of used[g.cut[0]].rings()) { const h = clean(r, false); if (h) out.push(h) } continue }
    // the union's outers are the grown holes, its holes are copper left inside them
    for (const r of clipRings('union', [...g.holes.map(k => [...rings[k]].reverse() as Ring), ...g.cut.flatMap(i => used[i].rings())])) {
      const c = clean(r, signedArea(r) < 0)
      if (c) out.push(c)
    }
  }
  return own ? cleanSigned(out, own) : out
}

// the outer first and the hole round `own` second
function cleanSigned(rings: Ring[], own: Pt | null): [number, number][][] {
  const out: [number, number][][] = []
  for (const r of rings) { const c = clean(r, signedArea(r) > 0); if (c) out.push(c) }
  if (!own || out.length < 2) return out
  // the viewer finds a hole's centre from the item's second ring
  let hole = -1, best = Infinity
  out.forEach((r, i) => {
    if (signedArea(r) > 0) return
    const b = bbox([r]), d = Math.hypot(b.x + b.w / 2 - own[0], b.y + b.h / 2 - own[1])
    if (d < best) { best = d; hole = i }
  })
  const outer = out.findIndex(r => signedArea(r) > 0)
  if (hole < 0 || outer < 0) return out
  return [out[outer], out[hole], ...out.filter((_, i) => i !== outer && i !== hole)]
}

const SIDES = ['F', 'B'] as const

/** Every item as rings in mm on the layers it occupies; drills cut what they pass through, as on the made board. */
export function siteItems(board: Board): SiteItem[] {
  const cu = copperLayers(board.copper)
  const holes = holesOf(board, cu)
  const holeGrid = holes.length ? new Grid(holes.map(h => h.box)) : null
  const open = { F: openingsOf(board, 'F'), B: openingsOf(board, 'B') }
  const openGrid = { F: open.F.length ? new Grid(open.F.map(o => o.box)) : null, B: open.B.length ? new Grid(open.B.map(o => o.box)) : null }
  const out: SiteItem[] = []
  for (const it of board.items) {
    let rings = geometry(it)
    if (!rings.length) continue
    const copper = copperLayersOf(it, cu)
    const layers = it.kind === 'pad' ? (copper.length ? copper : it.layers) : copper.length ? copper : [it.layer]
    const drill = it.kind === 'via' ? it.drill : it.kind === 'pad' && it.drill ? Math.min(it.drill[0], it.drill[1]) : undefined
    // the copper layers whose holes cut this item: its own, or for silk the copper of its side
    const silk = it.kind !== 'pad' && it.kind !== 'via' && it.layer.endsWith('.SilkS')
    const cutOn = copper.length ? copper : silk ? [`${it.layer[0]}.Cu`] : []
    let box: Box | null = null, edges: Edges | null = null
    const edgesOf = () => (edges ??= new Edges(rings))
    if (cutOn.length && holeGrid) {
      box = bbox(rings)
      const near = holeGrid.query(box).map(i => holes[i]).filter(h => h.owner !== it.id && (h.layers === null || cutOn.some(l => h.layers!.has(l))) && reaches(it, h))
      const cut = subtract(rings, near, drill !== undefined ? (it as Pad | Via).at : null, edgesOf)
      if (cut) { rings = cut; box = bbox(rings); edges = null }
    }
    let covered: SiteItem['covered']
    if (rings.length) for (const side of SIDES) {
      const grid = openGrid[side]
      if (!grid || !copper.includes(`${side}.Cu`)) continue
      box ??= bbox(rings)
      const near = grid.query(box).map(i => open[side][i])
      const part = near.some(o => o.owner === it.id && o.holdsOwner) ? [] : subtract(rings, near, null, edgesOf)
      if (part) (covered ??= {})[side] = part
    }
    out.push({ id: it.id, kind: it.kind, layers: [...layers], ...(it.net ? { net: it.net } : {}), ...(it.ref ? { ref: it.ref } : {}), rings, ...(drill !== undefined ? { drill } : {}), ...(covered ? { covered } : {}) })
  }
  return out
}
