// The tuner's obstacles; the copper rules follow buildLayout's free test, measured exactly instead of on offset polygons. Board mm, y down.
import type { Board, Item, Pt, Ring } from '@pcbjs/core/model'
import type { ResolvedRules as Rules } from '@pcbjs/core/types'
import { Grid, type Box } from './spatial.js'
import { copperLayers } from './layers.js'
import { copperLayersOf, copperRings } from './copper.js'
import { classOf, padClearanceTo } from './netclass.js'
import { segDist } from './length.js'

/** How near its own pad a meander may enter the courtyard and silk of the part it ends on, mm. */
export const NEAR_PAD = 1
/** The largest slack reported, the room search's stride over open board, mm. */
const CAP = 0.5

type Shape = { t: 'disc'; c: Pt; r: number } | { t: 'seg'; a: Pt; b: Pt; r: number } | { t: 'ring'; ring: Ring }
type Cls = 'cu' | 'hole' | 'keep' | 'crt' | 'silk' | 'edge'
interface Prim {
  cls: Cls
  layers: string[]
  net?: string
  except?: string[]
  npth?: boolean
  ref?: string
  item: number
  shape: Shape
  box: Box
  /** a pad's clearance and hole clearance overrides */
  cl?: number
  hcl?: number
}

export interface SpaceQuery {
  /** plated holes of this net do not count */
  net?: string
  /** the pair partner, whose copper counts as the track's own */
  twin?: string
  /** with it, own-net copper blocks too, at this width over the board clearance */
  ownWidth?: number
  /** item ids left out, the tuned track itself */
  skip?: ReadonlySet<number>
  /** with it, courtyards and silk block on the outer layers, except those of `refs` within NEAR_PAD of one of `pads` */
  outer?: { refs: ReadonlySet<string>; pads: Ring[] }
}

export class TuneSpace {
  private prims: (Prim | null)[] = []
  private byItem = new Map<number, number[]>()
  private grid: Grid | null = null
  private live: number[] = []
  private gap: number
  private cu: string[]
  private edges: [Pt, Pt][] = []
  private rows = new Map<number, number[]>()

  constructor(
    private board: Board,
    private rules: Rules,
  ) {
    this.cu = copperLayers(board.copper)
    let gap = Math.max(rules.clearance, rules.holeClearance, rules.edgeClearance, NEAR_PAD)
    for (const c of Object.values(board.classes ?? {})) if (typeof c?.clearance === 'number') gap = Math.max(gap, c.clearance)
    for (const it of board.items) if (it.kind === 'pad') gap = Math.max(gap, it.clearance ?? 0, it.clearanceTo?.track ?? 0, it.holeClearance ?? 0)
    this.gap = gap
    for (const it of board.items) this.add(it)
    for (const k of board.keepouts ?? [])
      if (k.tracks) for (const ring of k.outline) this.push({ cls: 'keep', layers: k.layers, ...(k.except ? { except: k.except } : {}), item: -1, shape: { t: 'ring', ring } })
    for (const ring of board.outline)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j],
          b = ring[i]
        this.edges.push([a, b])
        this.push({ cls: 'edge', layers: this.cu, item: -1, shape: { t: 'seg', a, b, r: 0 } })
        const y0 = Math.floor(Math.min(a[1], b[1])),
          y1 = Math.floor(Math.max(a[1], b[1]))
        for (let y = y0; y <= y1; y++) {
          let row = this.rows.get(y)
          if (!row) this.rows.set(y, (row = []))
          row.push(this.edges.length - 1)
        }
      }
  }

  update(it: Item) {
    this.remove(it.id)
    this.add(it)
  }

  remove(id: number) {
    for (const k of this.byItem.get(id) ?? []) this.prims[k] = null
    this.byItem.delete(id)
    this.grid = null
  }

  private push(p: Omit<Prim, 'box'>) {
    const s = p.shape
    let box: Box
    if (s.t === 'disc') box = { x: s.c[0] - s.r, y: s.c[1] - s.r, w: 2 * s.r, h: 2 * s.r }
    else if (s.t === 'seg')
      box = { x: Math.min(s.a[0], s.b[0]) - s.r, y: Math.min(s.a[1], s.b[1]) - s.r, w: Math.abs(s.a[0] - s.b[0]) + 2 * s.r, h: Math.abs(s.a[1] - s.b[1]) + 2 * s.r }
    else box = ringBox(s.ring)
    const k = this.prims.push({ ...p, box }) - 1
    if (p.item >= 0) {
      const l = this.byItem.get(p.item)
      if (l) l.push(k)
      else this.byItem.set(p.item, [k])
    }
    this.grid = null
  }

  private add(it: Item) {
    const base = {
      item: it.id,
      ...(it.net !== undefined ? { net: it.net } : {}),
      ...(it.ref !== undefined ? { ref: it.ref } : {}),
      ...(it.kind === 'pad' && padClearanceTo(it, 'track') !== undefined ? { cl: padClearanceTo(it, 'track') } : {}),
      ...(it.kind === 'pad' && it.holeClearance !== undefined ? { hcl: it.holeClearance } : {}),
    }
    const ls = copperLayersOf(it, this.cu)
    const segs = (cls: Cls, layers: string[], pts: Pt[], r: number, closed = false) => {
      for (let i = 1; i < pts.length; i++) this.push({ cls, layers, ...base, shape: { t: 'seg', a: pts[i - 1], b: pts[i], r } })
      if (closed && pts.length > 2) this.push({ cls, layers, ...base, shape: { t: 'seg', a: pts[pts.length - 1], b: pts[0], r } })
      if (pts.length === 1) this.push({ cls, layers, ...base, shape: { t: 'disc', c: pts[0], r } })
    }
    if (it.kind === 'pad' && it.drill) this.push({ cls: 'hole', layers: this.cu, ...base, npth: it.type === 'npth', shape: { t: 'disc', c: it.at, r: Math.max(...it.drill) / 2 } })
    if (it.kind === 'via') this.push({ cls: 'hole', layers: this.cu, ...base, shape: { t: 'disc', c: it.at, r: it.drill / 2 } })
    if (ls.length) {
      switch (it.kind) {
        case 'pad':
          this.push({ cls: 'cu', layers: ls, ...base, shape: { t: 'ring', ring: it.poly } })
          break
        case 'via':
          this.push({ cls: 'cu', layers: ls, ...base, shape: { t: 'disc', c: it.at, r: it.size / 2 } })
          break
        case 'track':
          segs('cu', ls, it.pts, it.width / 2)
          break
        case 'graphic':
          it.paths.forEach((p, i) =>
            it.fill && p.length >= 3 ? this.push({ cls: 'cu', layers: ls, ...base, shape: { t: 'ring', ring: p } }) : segs('cu', ls, p, it.width / 2, it.closed[i]),
          )
          break
        case 'text':
          if (it.polys) for (const q of it.polys) this.push({ cls: 'cu', layers: ls, ...base, shape: { t: 'ring', ring: q.outer } })
          else for (const s of it.strokes) segs('cu', ls, s, it.thickness / 2)
          break
        default:
          for (const ring of copperRings(it, ls[0])) this.push({ cls: 'cu', layers: ls, ...base, shape: { t: 'ring', ring } })
      }
      return
    }
    // a part's silk outline lies inside its courtyard, so only board silk drawings count
    const side = it.layer.startsWith('F.') ? this.cu[0] : it.layer.startsWith('B.') ? this.cu[this.cu.length - 1] : undefined
    if (!side) return
    if (it.layer.endsWith('.CrtYd') && it.kind === 'graphic' && it.ref !== undefined)
      it.paths.forEach((p, i) =>
        it.closed[i] && p.length >= 3 ? this.push({ cls: 'crt', layers: [side], ...base, shape: { t: 'ring', ring: p } }) : segs('crt', [side], p, it.width / 2),
      )
    else if (it.layer.endsWith('.SilkS')) {
      if (it.kind === 'text' && (it.strokes.length || it.polys?.length)) {
        // a label blocks its whole box, so a meander never runs between its letters
        const b = ringBox(it.polys ? it.polys.flatMap(q => q.outer) : it.strokes.flat()),
          g = it.thickness / 2
        this.push({
          cls: 'silk',
          layers: [side],
          ...base,
          shape: {
            t: 'ring',
            ring: [
              [b.x - g, b.y - g],
              [b.x + b.w + g, b.y - g],
              [b.x + b.w + g, b.y + b.h + g],
              [b.x - g, b.y + b.h + g],
            ],
          },
        })
      } else if (it.kind === 'graphic' && it.ref === undefined)
        it.paths.forEach((p, i) =>
          it.fill && p.length >= 3 ? this.push({ cls: 'silk', layers: [side], ...base, shape: { t: 'ring', ring: p } }) : segs('silk', [side], p, it.width / 2, it.closed[i]),
        )
    }
  }

  private index(): Grid {
    if (this.grid) return this.grid
    this.live = []
    const boxes: Box[] = []
    this.prims.forEach((p, k) => {
      if (p) {
        this.live.push(k)
        boxes.push(p.box)
      }
    })
    return (this.grid = new Grid(boxes))
  }

  /** Even-odd over the outline rings; true for a board without one. */
  private onBoard(x: number, y: number): boolean {
    if (!this.edges.length) return true
    let c = false
    for (const e of this.rows.get(Math.floor(y)) ?? []) {
      const [[xi, yi], [xj, yj]] = this.edges[e]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }

  /** How far a track centred at (x, y) may move and stay clear, capped at CAP, negative where it may not be. */
  slack(layer: string, x: number, y: number, width: number, q: SpaceQuery): number {
    if (!this.onBoard(x, y)) return -1
    const g = this.index(),
      hw = width / 2
    let s = CAP
    const own = (n: string | undefined) => q.net !== undefined && (n === q.net || (q.twin !== undefined && n === q.twin))
    const exempt = (p: Prim) => {
      if (!q.outer || p.ref === undefined || !q.outer.refs.has(p.ref)) return -Infinity
      let d = Infinity
      for (const pad of q.outer.pads) d = Math.min(d, ringDist(pad, x, y))
      return NEAR_PAD - d
    }
    for (const i of g.query({ x, y, w: 0, h: 0 }, hw + this.gap + CAP)) {
      const p = this.prims[this.live[i]]!
      if (!p.layers.includes(layer)) continue
      let d: number
      switch (p.cls) {
        case 'cu':
          if (q.skip?.has(p.item)) continue
          if (own(p.net)) {
            if (q.ownWidth === undefined) continue
            d = dist(p.shape, x, y) - q.ownWidth / 2 - this.rules.clearance
          } else d = dist(p.shape, x, y) - hw - Math.max(this.clearanceTo(q.net, p.net), p.cl ?? 0)
          break
        case 'hole':
          if (!p.npth && own(p.net)) continue
          d = dist(p.shape, x, y) - hw - Math.max(this.rules.holeClearance, p.hcl ?? 0)
          break
        case 'keep':
          if (q.net !== undefined && p.except?.includes(q.net)) continue
          d = dist(p.shape, x, y) - hw
          break
        case 'edge':
          d = dist(p.shape, x, y) - hw - this.rules.edgeClearance
          break
        case 'crt':
        case 'silk':
          if (!q.outer) continue
          d = Math.max(dist(p.shape, x, y) - hw, exempt(p))
          break
      }
      if (d < s) {
        s = d
        if (s < 0) return s
      }
    }
    return s
  }

  private clearanceTo(net: string | undefined, other: string | undefined): number {
    if (!this.board.classes) return this.rules.clearance
    return Math.max(this.rules.clearance, classOf(this.board, net)?.clearance ?? 0, classOf(this.board, other)?.clearance ?? 0)
  }
}

/** Edge to edge; a point inside a ring is at -1. */
function dist(s: Shape, x: number, y: number): number {
  if (s.t === 'disc') return Math.hypot(x - s.c[0], y - s.c[1]) - s.r
  if (s.t === 'seg') return segDist([x, y], s.a, s.b) - s.r
  return inRing(s.ring, x, y) ? -1 : ringDist(s.ring, x, y)
}

function ringDist(r: Ring, x: number, y: number): number {
  let d = Infinity
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist([x, y], r[j], r[i]))
  return d
}

/** Even-odd point in ring. */
export function inRing(r: Ring, x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c
  return c
}

function ringBox(r: Pt[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of r) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
