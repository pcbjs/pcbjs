// Auto placement, see placement.md: each at:solver in tree order, then a seeded search over the ratsnest half-perimeter
// with courtyard, outline and keepout penalties, group members drawn together and each part's at:cost added.
import type { AutoPlaced, Board, Footprint, Item, Pt } from '@pcbjs/core/model'
import type { PlacedPart, PlaceLayout, PlacePose, PlaceRequest } from '@pcbjs/core/internal/types'
import { partOf } from '@pcbjs/core/internal/part'
import { CompileError, PART_REFS, type PlaceJob } from './flatten.js'
import { apply, invert, mul, placement, pointInRing, rotationOf, type Mat } from './geom.js'
import { moveParts } from './patches.js'
import { solverOrder } from './deps.js'

export type Box = [number, number, number, number]
/** A part's outline points and pads in the frame of its pose, and whether it reaches both sides. */
interface Shape {
  pts: Pt[]
  pads: { at: Pt; net?: string }[]
  tht: boolean
}
interface Mover {
  job: PlaceJob
  shape: Shape
  pose: [number, number, number]
  lo: Pt
  hi: Pt
  box: Box
  pads: Pt[]
}

// weights of the search, per mm of wire, mm² of overlap, mm outside the outline and mm from the group's centre
const W_OVERLAP = 10
const W_EDGE = 20
const W_KEEPOUT = 10
const W_GROUP = 0.5
const GRID = 0.05
/** Nets over this many pads, power nets that pour, count less in the half-perimeter. */
const BIG_NET = 8

const q = (v: number) => Math.round(Math.round(v / GRID) * GRID * 1e6) / 1e6 || 0
const norm = (r: number) => Math.round((((r % 360) + 360) % 360) * 1e6) / 1e6
export const poseMat = (j: PlaceJob, p: readonly number[]) => mul(j.m, placement(p[0], p[1], p[2], j.flip))

/** Seeded and deterministic, mulberry32. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const itemsOf = (board: Board, fp: Footprint): Item[] => board.items.filter(it => it.ref === fp.ref)

/** The part's courtyard points, else its pad corners, and its pads, all in the frame of the pose `m`. */
export function shapeOf(board: Board, fp: Footprint, m: Mat): Shape {
  const inv = invert(m)
  const own = itemsOf(board, fp)
  const yard = own.flatMap(it => (it.kind === 'graphic' && it.layer.endsWith('.CrtYd') ? it.paths.flat() : []))
  const pads = own.filter(it => it.kind === 'pad')
  const pts = yard.length ? yard : pads.flatMap(p => (p.kind === 'pad' ? p.poly : []))
  return {
    pts: pts.map(p => apply(inv, p)),
    pads: pads.map(p => ({ at: apply(inv, (p as { at: Pt }).at), ...(p.net !== undefined ? { net: p.net } : {}) })),
    tht: pads.some(p => p.kind === 'pad' && p.type !== 'smd'),
  }
}

export function boxOf(pts: Pt[], grow = 0): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return pts.length ? [x0 - grow, y0 - grow, x1 + grow, y1 + grow] : [0, 0, 0, 0]
}
export const lap = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const asPart = (box: Box, at: Pt, rot: number, side: 'F' | 'B'): PlacedPart => ({
  x: at[0],
  y: at[1],
  r: rot,
  side,
  box: { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] },
})

/** The pose of every part with an auto slot, followers left for after routing, and the parts each solver read; the board is not moved. */
export interface Placement {
  poses: { ref: string; pose: [number, number, number]; by: AutoPlaced['by'] }[]
  reads: [string, string][]
}

/** Moves each part to its pose, as solvePlacement found it or a cache kept it. */
export function applyPlacement(board: Board, jobs: readonly PlaceJob[], p: Placement): AutoPlaced[] {
  const jobOf = new Map(jobs.map(j => [j.fp.ref, j]))
  return p.poses.map(({ ref, pose, by }) => {
    const j = jobOf.get(ref)!
    const d = mul(poseMat(j, pose), invert(poseMat(j, j.start)))
    moveParts(board, [j.fp], d, norm(rotationOf(d)))
    return { ref, at: pose.map(fmt).join(' '), by, ...(j.src ? { src: j.src } : {}) }
  })
}

export function solvePlacement(board: Board, jobs: readonly PlaceJob[], seed: number): Placement {
  const own = jobs.filter(j => !j.follow)
  if (!own.length) return { poses: [], reads: [] }
  const refs = PART_REFS.get(board)
  const refOf = (v: unknown): string => {
    if (typeof v === 'string') return v
    const st = partOf(v)
    const r = st && refs?.get(st)
    if (!r) throw new CompileError(`layout.part() takes a ref or a part placed on this board, got ${typeof v}`)
    return r
  }
  const jobOf = new Map(jobs.map(j => [j.fp.ref, j]))
  const shapes = new Map<string, Shape>()
  for (const j of jobs) shapes.set(j.fp.ref, shapeOf(board, j.fp, poseMat(j, j.start)))
  const fixedBox = new Map<string, Box>()
  for (const fp of board.footprints) if (!jobOf.has(fp.ref)) fixedBox.set(fp.ref, fixedBoxOf(board, fp))
  const fixedPart = (ref: string): PlacedPart | null => {
    const fp = board.footprints.find(f => f.ref === ref)
    const b = fixedBox.get(ref)
    return fp && b ? asPart(b, fp.at, fp.rot, fp.side) : null
  }
  const outline = board.outline.map(r => r.map(p => [p[0], p[1]] as [number, number]))
  const reads: [string, string][] = []
  const solved = new Map<string, [number, number, number]>()
  // each solver sees the fixed parts and those solved before it
  for (const j of own) {
    if (!j.solver) continue
    const ref = j.fp.ref
    const read = (r: string): PlacedPart | null => {
      if (!jobOf.has(r)) {
        const got = fixedPart(r)
        if (got) reads.push([ref, r])
        return got
      }
      const s = solved.get(r)
      if (!s) throw solverOrder({ kind: 'solver', ref, ...(j.src ? { src: j.src } : {}) }, { kind: 'part', ref: r, ...(jobOf.get(r)!.fp.src ? { src: jobOf.get(r)!.fp.src } : {}) })
      reads.push([ref, r])
      const jr = jobOf.get(r)!
      const m = poseMat(jr, s)
      return asPart(boxOf(shapes.get(r)!.pts.map(p => apply(m, p))), apply(m, [0, 0]), norm(rotationOf(m)), jr.fp.side)
    }
    const layout: PlaceLayout = { part: r => read(refOf(r)), outline }
    const req: PlaceRequest = {
      ref,
      fixed: [...j.fixed],
      ...(j.initial ? { initial: { x: j.initial[0], y: j.initial[1], r: j.initial[2] } } : {}),
      ...(j.cost ? { cost: (x: number, y: number, r: number) => j.cost!(layout, x, y, r) } : {}),
    }
    const pose = j.solver(layout, req)
    if (pose === null) continue
    solved.set(ref, fixedWins(j, checkedPose(pose, ref)))
  }
  const search = own.filter(j => !solved.has(j.fp.ref))
  const result = new Map(solved)
  if (search.length) for (const [ref, pose] of anneal(board, search, shapes, fixedBox, jobOf, solved, refOf, outline, seed)) result.set(ref, pose)
  return { poses: own.map(j => ({ ref: j.fp.ref, pose: result.get(j.fp.ref)!, by: solved.has(j.fp.ref) ? 'solver' : 'placer' })), reads }
}

export const fmt = (v: number) => String(Math.round(v * 1000) / 1000 || 0)

function checkedPose(p: PlacePose, ref: string): [number, number, number] {
  if (!p || typeof p !== 'object' || ![p.x, p.y, p.r ?? 0].every(Number.isFinite))
    throw new CompileError(`${ref}: at:solver must return { x, y, r } in mm and degrees, or null for the placer, got ${JSON.stringify(p)}`)
  return [p.x, p.y, p.r ?? 0]
}
/** A fixed slot constrains every solver: it wins over the pose returned. */
const fixedWins = (j: PlaceJob, p: [number, number, number]): [number, number, number] => j.fixed.map((v, i) => v ?? p[i]) as [number, number, number]

/** A placed part's box: its courtyard, else its pads grown by a quarter millimetre. */
export function fixedBoxOf(board: Board, fp: Footprint): Box {
  const own = itemsOf(board, fp)
  const yard = own.flatMap(it => (it.kind === 'graphic' && it.layer.endsWith('.CrtYd') ? it.paths.flat() : []))
  return yard.length
    ? boxOf(yard)
    : boxOf(
        own.flatMap(p => (p.kind === 'pad' ? p.poly : [])),
        0.25,
      )
}

/** The seeded search: moves and turns of one part at a time, kept by the Metropolis rule on a falling temperature; the best layout seen. */
function anneal(
  board: Board,
  jobs: PlaceJob[],
  shapes: Map<string, Shape>,
  fixedBox: Map<string, Box>,
  jobOf: Map<string, PlaceJob>,
  solved: Map<string, [number, number, number]>,
  refOf: (v: unknown) => string,
  outline: [number, number][][],
  seed: number,
): Map<string, [number, number, number]> {
  const rand = rng(seed)
  const bb = board.bbox
  const frame = (j: PlaceJob): [Pt, Pt] => {
    const inv = invert(j.m)
    const c = [apply(inv, [bb.x, bb.y]), apply(inv, [bb.x + bb.w, bb.y]), apply(inv, [bb.x, bb.y + bb.h]), apply(inv, [bb.x + bb.w, bb.y + bb.h])]
    return [
      [Math.min(...c.map(p => p[0])), Math.min(...c.map(p => p[1]))],
      [Math.max(...c.map(p => p[0])), Math.max(...c.map(p => p[1]))],
    ]
  }
  const movers: Mover[] = jobs.map(j => {
    const [lo, hi] = frame(j)
    const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0]
    const pose = j.fixed.map((v, i) => v ?? (j.initial ? j.initial[i] : i < 2 ? q(mid[i]) : j.start[2])) as [number, number, number]
    return { job: j, shape: shapes.get(j.fp.ref)!, pose, lo, hi, box: [0, 0, 0, 0], pads: [] }
  })
  const index = new Map(movers.map((m, i) => [m.job.fp.ref, i]))
  const place = (m: Mover) => {
    const mat = poseMat(m.job, m.pose)
    m.box = boxOf(m.shape.pts.map(p => apply(mat, p)))
    m.pads = m.shape.pads.map(p => apply(mat, p.at))
  }
  movers.forEach(place)
  // fixed and solved parts as obstacles, followers left out until after routing
  const others: { ref: string; box: Box; side: 'F' | 'B'; tht: boolean }[] = []
  for (const fp of board.footprints) {
    const j = jobOf.get(fp.ref)
    if (index.has(fp.ref) || j?.follow) continue
    if (j) {
      const mat = poseMat(j, solved.get(fp.ref)!)
      others.push({ ref: fp.ref, box: boxOf(shapes.get(fp.ref)!.pts.map(p => apply(mat, p))), side: fp.side, tht: shapes.get(fp.ref)!.tht })
    } else others.push({ ref: fp.ref, box: fixedBox.get(fp.ref)!, side: fp.side, tht: fixedBoxTht(board, fp) })
  }
  const nets = netTable(board, movers, jobOf, solved, shapes)
  const groups = groupTable(board, movers, jobOf)
  const keep = (board.keepouts ?? []).map(k => boxOf(k.outline.flat()))
  const edge = board.rules.edgeClearance
  const layout: PlaceLayout = {
    part: v => {
      const ref = refOf(v)
      const i = index.get(ref)
      if (i !== undefined) {
        const m = movers[i]
        return asPart(m.box, apply(poseMat(m.job, m.pose), [0, 0]), norm(rotationOf(poseMat(m.job, m.pose))), m.job.fp.side)
      }
      const o = others.find(x => x.ref === ref)
      const fp = board.footprints.find(f => f.ref === ref)
      return o && fp ? asPart(o.box, fp.at, fp.rot, fp.side) : null
    },
    outline,
  }
  const local = (i: number): number => {
    const m = movers[i]
    let c = 0
    for (const n of m.shape.pads.map(p => p.net)) if (n !== undefined) c += nets.cost(n, movers)
    for (let k = 0; k < movers.length; k++) if (k !== i && clash(m, movers[k].job.fp.side, movers[k].shape.tht)) c += W_OVERLAP * lap(m.box, movers[k].box)
    for (const o of others) if (clash(m, o.side, o.tht)) c += W_OVERLAP * lap(m.box, o.box)
    c += W_EDGE * outside(m.box, outline, edge)
    for (const k of keep) c += W_KEEPOUT * lap(m.box, k)
    c += W_GROUP * groups.cost(i, movers)
    if (m.job.cost) {
      const u = m.job.cost(layout, m.pose[0], m.pose[1], m.pose[2])
      if (u === null) return Infinity
      if (typeof u !== 'number' || Number.isNaN(u)) throw new CompileError(`${m.job.fp.ref}: at:cost must return a number or null, got ${JSON.stringify(u)}`, m.job.src)
      c += u
    }
    return c
  }
  const total = () => movers.reduce((s, _, i) => s + local(i), 0)
  const steps = Math.min(60000, Math.max(3000, movers.length * 800))
  const free = movers.map(m => m.job.fixed.map(v => v === null))
  const span = movers.map(m => Math.max(m.hi[0] - m.lo[0], m.hi[1] - m.lo[1], 1))
  const step = (i: number, heat: number): [number, number, number] => {
    const m = movers[i]
    const p: [number, number, number] = [...m.pose]
    if (free[i][2] && (!free[i][0] && !free[i][1] ? true : rand() < 0.2)) p[2] = norm(p[2] + [90, 180, 270][Math.floor(rand() * 3)])
    else {
      const r = Math.max(GRID * 2, span[i] * 0.5 * Math.sqrt(heat))
      for (const k of [0, 1] as const) if (free[i][k]) p[k] = q(Math.min(m.hi[k], Math.max(m.lo[k], p[k] + (rand() * 2 - 1) * r)))
    }
    return p
  }
  const movable = movers.map((_, i) => i).filter(i => free[i].some(Boolean))
  if (!movable.length) return new Map(movers.map(m => [m.job.fp.ref, m.pose]))
  // the start temperature from the mean rise of a few trial moves
  let rise = 0,
    n = 0
  for (let k = 0; k < 24; k++) {
    const i = movable[Math.floor(rand() * movable.length)]
    const m = movers[i],
      was = m.pose
    const before = local(i)
    m.pose = step(i, 1)
    place(m)
    const d = local(i) - before
    if (Number.isFinite(d) && d > 0) {
      rise += d
      n++
    }
    m.pose = was
    place(m)
  }
  const t0 = n ? (rise / n) * 2 : 1
  let best = total(),
    bestPoses = movers.map(m => m.pose)
  let cur = best
  for (let k = 0; k < steps; k++) {
    const heat = Math.pow(1e-4, k / steps)
    const i = movable[Math.floor(rand() * movable.length)]
    const m = movers[i],
      was = m.pose
    const before = local(i)
    m.pose = step(i, heat)
    place(m)
    const d = local(i) - before
    if (d <= 0 || (Number.isFinite(d) && rand() < Math.exp(-d / (t0 * heat)))) {
      cur += d
      if (cur < best - 1e-9) {
        best = cur
        bestPoses = movers.map(x => x.pose)
      }
    } else {
      m.pose = was
      place(m)
    }
  }
  return new Map(movers.map((m, i) => [m.job.fp.ref, bestPoses[i]]))
}

const clash = (m: Mover, side: 'F' | 'B', tht: boolean) => m.job.fp.side === side || tht || m.shape.tht
const fixedBoxTht = (board: Board, fp: Footprint) => itemsOf(board, fp).some(p => p.kind === 'pad' && p.type !== 'smd')

/** How far the box's corners lie outside the outline, or inside it closer than the edge clearance. */
export function outside(b: Box, outline: [number, number][][], edge: number): number {
  if (!outline.length) return 0
  let c = 0
  for (const p of [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ] as Pt[]) {
    const inside = outline.filter(r => pointInRing(p, r)).length % 2 === 1
    const d = Math.min(...outline.map(r => ringDist(p, r)))
    if (!inside) c += d + edge
    else if (d < edge) c += edge - d
  }
  return c
}

function ringDist(p: Pt, r: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < r.length; i++) {
    const a = r[i],
      b = r[(i + 1) % r.length]
    const dx = b[0] - a[0],
      dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
  }
  return best
}

/** Each net's fixed pads as a box and its moving pads, with the half-perimeter of both. */
function netTable(board: Board, movers: Mover[], jobOf: Map<string, PlaceJob>, solved: Map<string, [number, number, number]>, shapes: Map<string, Shape>) {
  const fixed = new Map<string, Box>()
  const moving = new Map<string, [number, number][]>()
  const count = new Map<string, number>()
  const grow = (n: string, p: Pt) => {
    const b = fixed.get(n)
    fixed.set(n, b ? [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])] : [p[0], p[1], p[0], p[1]])
  }
  const mi = new Map(movers.map((m, i) => [m.job.fp.ref, i]))
  for (const it of board.items) {
    if (it.kind !== 'pad' || it.net === undefined || it.ref === undefined) continue
    const j = jobOf.get(it.ref)
    if (j?.follow) continue
    count.set(it.net, (count.get(it.net) ?? 0) + 1)
    if (mi.has(it.ref)) continue
    if (j) {
      const s = shapes.get(it.ref)!
      const mat = poseMat(j, solved.get(it.ref)!)
      for (const p of s.pads) if (p.net === it.net) grow(it.net, apply(mat, p.at))
      continue
    }
    grow(it.net, it.at)
  }
  movers.forEach((m, i) =>
    m.shape.pads.forEach((p, k) => {
      if (p.net !== undefined) moving.set(p.net, [...(moving.get(p.net) ?? []), [i, k]])
    }),
  )
  return {
    cost(n: string, ms: Mover[]): number {
      const c = count.get(n) ?? 0
      if (c < 2) return 0
      const f = fixed.get(n)
      let [x0, y0, x1, y1] = f ?? [Infinity, Infinity, -Infinity, -Infinity]
      for (const [i, k] of moving.get(n) ?? []) {
        const p = ms[i].pads[k]
        x0 = Math.min(x0, p[0])
        y0 = Math.min(y0, p[1])
        x1 = Math.max(x1, p[0])
        y1 = Math.max(y1, p[1])
      }
      return (x1 - x0 + (y1 - y0)) * (c > BIG_NET ? BIG_NET / c : 1)
    },
  }
}

/** Each moving part's innermost named group, and its distance from the centre of the group's other parts. */
function groupTable(board: Board, movers: Mover[], jobOf: Map<string, PlaceJob>) {
  const groupOf = groupsByRef(board)
  const key = (m: Mover) => groupOf.get(m.job.fp.ref)
  const members = new Map<string, { fixed: Pt[]; movers: number[] }>()
  for (const fp of board.footprints) {
    const g = groupOf.get(fp.ref)
    if (!g || jobOf.has(fp.ref)) continue
    const e = members.get(g) ?? { fixed: [], movers: [] }
    e.fixed.push(fp.at)
    members.set(g, e)
  }
  movers.forEach((m, i) => {
    const g = key(m)
    if (!g) return
    const e = members.get(g) ?? { fixed: [], movers: [] }
    e.movers.push(i)
    members.set(g, e)
  })
  return {
    cost(i: number, ms: Mover[]): number {
      const g = key(ms[i])
      const e = g ? members.get(g) : undefined
      if (!e || e.fixed.length + e.movers.length < 2) return 0
      const pts = [...e.fixed, ...e.movers.map(k => centre(ms[k].box))]
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
        cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      return pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0)
    },
  }
}

const centre = (b: Box): Pt => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

/** Each part's group path, its named `<g>` and circuit instances, for the parts inside one. */
function groupsByRef(board: Board): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of board.schematic?.parts ?? []) if (p.path?.length) out.set(p.ref, p.path.join('/'))
  return out
}
