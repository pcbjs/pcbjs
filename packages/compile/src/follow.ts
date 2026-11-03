// The follower pass, see placement.md: parts with `at:follow` placed beside the routed copper of their route once, after
// routing, their own connections routed after them; while the first routing runs their copper is out of the router's sight.
import type { AutoPlaced, AutoRouteJob, Board, DrcMarker, Item, Pt } from '@pcbjs/core/model'
import { isPinRef } from '@pcbjs/core/internal/nets'
import { isRoutePoint, partOf } from '@pcbjs/core/internal/part'
import { at as parseAt, mm } from '@pcbjs/core/internal/units'
import { CompileError, PART_REFS, ROUTE_IDS, type PlaceJob } from './flatten.js'
import { apply, invert, mul, placement, rotationOf } from './geom.js'
import { moveParts } from './patches.js'
import { endParts } from './deps.js'
import { boxOf, fixedBoxOf, fmt, lap, outside, poseMat, shapeOf, type Box } from './placer.js'
import { padOf, resolvePos } from './autoroute.js'
import { marker } from './messages.js'
import { immutable } from './items.js'

/** A follower: its job and the id of the route it follows. */
export interface Follower {
  job: PlaceJob
  route: string
}

/** The followers of a board with their routes resolved; a route that is no route of this board is a compile error. */
export function followersOf(jobs: readonly PlaceJob[], routes: readonly AutoRouteJob[]): Follower[] {
  const ids = new Set(routes.map(j => j.route))
  return jobs.flatMap(job => {
    if (!job.follow) return []
    const r = job.follow.route
    const route = typeof r === 'string' ? r : r && typeof r === 'object' ? ROUTE_IDS.get(r) : undefined
    if (!route || !ids.has(route))
      throw new CompileError(
        `${job.fp.ref}: at:follow route must be a route placed on this board, its binding or its id such as 'route:3', got ${typeof r === 'string' ? JSON.stringify(r) : typeof r}`,
        job.src,
      )
    return [{ job, route }]
  })
}

/** The jobs of every route that ends on a follower's pad, routed after the followers are placed, and the rest. */
export function splitJobs(board: Board, jobs: readonly AutoRouteJob[], followers: readonly Follower[]): { first: AutoRouteJob[]; after: AutoRouteJob[] } {
  const refs = new Set(followers.map(f => f.job.fp.ref))
  if (!refs.size) return { first: [...jobs], after: [] }
  const late = new Set(jobs.filter(j => endParts(board, j).some(r => refs.has(r))).map(j => j.route ?? j))
  const after = jobs.filter(j => late.has(j.route ?? j))
  for (const f of followers)
    if (late.has(f.route)) {
      const end = after.find(j => j.route === f.route)
      const on = end && endParts(board, end).find(r => refs.has(r) && r !== f.job.fp.ref)
      if (on)
        throw new CompileError(
          `${f.job.fp.ref}: at:follow follows ${f.route}, which ends on the follower ${on}; the follower pass runs once, so a follower follows a route of the first routing`,
          f.job.src,
        )
    }
  return { first: jobs.filter(j => !late.has(j.route ?? j)), after }
}

/** The followers' items swapped for inert ones while the first routing runs; returns what puts them back. */
export function hideFollowers(board: Board, followers: readonly Follower[]): () => void {
  const refs = new Set(followers.map(f => f.job.fp.ref))
  if (!refs.size) return () => {}
  const kept: [number, Item][] = []
  board.items.forEach((it, i) => {
    if (it.ref === undefined || !refs.has(it.ref)) return
    kept.push([i, it])
    board.items[i] = immutable({ kind: 'graphic', id: it.id, layer: 'Dwgs.User', paths: [], closed: [], width: 0, fill: false } as Item)
  })
  return () => {
    for (const [i, it] of kept) board.items[i] = it
  }
}

/** Every follower placed beside its route; one beside a route with no copper stays where it was drawn, with a warning. */
export function placeFollowers(board: Board, followers: readonly Follower[]): { placed: AutoPlaced[]; findings: DrcMarker[] } {
  const placed: AutoPlaced[] = []
  const findings: DrcMarker[] = []
  // a follower keeps clear of those placed before it, never of those still to come
  const pending = new Set(followers.map(f => f.job.fp.ref))
  for (const f of followers) {
    pending.delete(f.job.fp.ref)
    const segs = segmentsOf(board, f.route)
    const { job } = f
    if (!segs.length) {
      findings.push(marker({ severity: 'warning', rule: 'follow-unrouted', args: { ref: job.fp.ref, route: f.route }, refs: [job.fp.ref, f.route], at: job.fp.at }))
      continue
    }
    const pose = besideRoute(board, f, segs, nearOf(board, job, segs), pending)
    const d = mul(poseMat(job, pose), invert(poseMat(job, job.start)))
    moveParts(board, [job.fp], d, norm(rotationOf(d)))
    placed.push({ ref: job.fp.ref, at: pose.map(fmt).join(' '), by: 'follow', ...(job.src ? { src: job.src } : {}) })
  }
  return { placed, findings }
}

type Seg = { a: Pt; b: Pt; width: number }
const norm = (r: number) => Math.round((((r % 360) + 360) % 360) * 1e6) / 1e6

function segmentsOf(board: Board, route: string): Seg[] {
  const out: Seg[] = []
  for (const it of board.items) if (it.kind === 'track' && it.route === route) for (let i = 1; i < it.pts.length; i++) out.push({ a: it.pts[i - 1], b: it.pts[i], width: it.width })
  return out.filter(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1e-6)
}

/** The point `near` names in board mm: a pin or pad, a part's origin, a position in the frame of `at`; else the route's middle. */
function nearOf(board: Board, job: PlaceJob, segs: Seg[]): Pt {
  const v = job.follow!.near
  if (v === undefined) return middle(segs)
  if (isPinRef(v)) {
    const pad = padOf(board, v)
    if (pad) return pad.at
  } else if (isRoutePoint(v)) {
    try {
      const q = resolvePos(board, v, 'F.Cu')
      return [q.x, q.y]
    } catch (e) {
      throw new CompileError(`${job.fp.ref}: at:follow near ${(e as Error).message}`, job.src)
    }
  } else if (typeof v === 'string') {
    try {
      const [x, y] = parseAt(v)
      return apply(job.m, [x, y])
    } catch (e) {
      throw new CompileError(`${job.fp.ref}: at:follow near ${(e as Error).message}`, job.src)
    }
  } else {
    const st = partOf(v)
    const ref = st && PART_REFS.get(board)?.get(st)
    const fp = ref ? board.footprints.find(p => p.ref === ref) : undefined
    if (fp) return fp.at
  }
  throw new CompileError(`${job.fp.ref}: at:follow near must be a pin or pad handle, a part of this board, a point of a route on it or a position "x y"`, job.src)
}

function middle(segs: Seg[]): Pt {
  const len = (s: Seg) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])
  let left = segs.reduce((t, s) => t + len(s), 0) / 2
  for (const s of segs) {
    const l = len(s)
    if (left <= l) return [s.a[0] + ((s.b[0] - s.a[0]) * left) / l, s.a[1] + ((s.b[1] - s.a[1]) * left) / l]
    left -= l
  }
  return segs[segs.length - 1].b
}

/** How far apart the points along the route a follower tries are, mm; and how many it tries at most. */
const STEP = 0.25
const TRIES = 400
/** How much further from the track than the clearance a follower may sit when the nearer spots are taken, mm. */
const AWAY = [0, 0.25, 0.5, 1, 1.5, 2]

/** Points along the route every STEP, nearest `p` first, each with its segment. */
function stations(segs: Seg[], p: Pt): { seg: Seg; at: Pt }[] {
  const out: { seg: Seg; at: Pt; d: number }[] = []
  for (const s of segs) {
    const n = Math.max(1, Math.ceil(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / STEP))
    for (let k = 0; k <= n; k++) {
      const at: Pt = [s.a[0] + ((s.b[0] - s.a[0]) * k) / n, s.a[1] + ((s.b[1] - s.a[1]) * k) / n]
      out.push({ seg: s, at, d: Math.hypot(at[0] - p[0], at[1] - p[1]) })
    }
  }
  return out.sort((a, b) => a.d - b.d).slice(0, TRIES)
}

/** The pose in the frame of `at` beside the route, from its point nearest `p` outward to the first clear of other parts and copper: turned along the track unless `at` fixes the rotation, clear of it by the clearance. */
function besideRoute(board: Board, f: Follower, segs: Seg[], p: Pt, pending: Set<string>): [number, number, number] {
  const { job } = f
  const shape = shapeOf(board, job.fp, poseMat(job, job.start))
  const sides = job.follow!.side === undefined ? (['left', 'right'] as const) : [job.follow!.side as 'left' | 'right']
  const blocks = obstacles(board, f, pending)
  const outline = board.outline.map(r => r.map(q => [q[0], q[1]] as [number, number]))
  let best: { pose: [number, number, number]; cost: number } | null = null
  for (const { seg, at } of stations(segs, p)) {
    const len = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1])
    const dir: Pt = [(seg.b[0] - seg.a[0]) / len, (seg.b[1] - seg.a[1]) / len]
    const r = job.fixed[2] ?? localRot(job, Math.round((-Math.atan2(dir[1], dir[0]) * 180) / Math.PI / 45) * 45)
    const turn = mul(job.m, placement(0, 0, r, job.flip))
    const pts = shape.pts.map(q => apply(turn, q))
    for (const side of sides)
      for (const extra of job.follow!.distance === undefined ? AWAY : [0]) {
        const n: Pt = side === 'left' ? [dir[1], -dir[0]] : [-dir[1], dir[0]]
        const reach = Math.max(0, ...pts.map(q => -(q[0] * n[0] + q[1] * n[1])))
        const dist = job.follow!.distance !== undefined ? length(job, job.follow!.distance) : seg.width / 2 + board.rules.clearance + reach + extra
        const o: Pt = [at[0] + n[0] * dist, at[1] + n[1] * dist]
        const box = boxOf(pts.map(q => [q[0] + o[0], q[1] + o[1]] as Pt))
        const cost = blocks.reduce((s, b) => s + lap(box, b), 0) + outside(box, outline, board.rules.edgeClearance)
        const l = apply(invert(job.m), o)
        if (!best || cost < best.cost - 1e-9) best = { pose: [round(l[0]), round(l[1]), r], cost }
        if (cost < 1e-9) return best.pose
      }
  }
  return best!.pose
}

const round = (v: number) => Math.round(v * 1000) / 1000 || 0

function length(job: PlaceJob, v: unknown): number {
  try {
    const d = mm(v as string)
    if (Number.isFinite(d) && d >= 0) return d
  } catch {
    /* reported below */
  }
  throw new CompileError(`${job.fp.ref}: at:follow distance must be a length, got ${JSON.stringify(v)}`, job.src)
}

/** The rotation in the frame of `at` that turns the part to `deg` on the board. */
function localRot(job: PlaceJob, deg: number): number {
  const r0 = rotationOf(mul(job.m, placement(0, 0, 0, job.flip)))
  const r90 = rotationOf(mul(job.m, placement(0, 0, 90, job.flip)))
  const s = Math.abs(norm(r90 - r0) - 90) < 1e-6 ? 1 : -1
  return norm(s * (deg - r0))
}

/** What a follower keeps out of: the other parts placed, and the copper of every route but its own, grown by the clearance. */
function obstacles(board: Board, f: Follower, pending: Set<string>): Box[] {
  const c = board.rules.clearance
  const out = board.footprints.filter(fp => fp !== f.job.fp && !pending.has(fp.ref)).map(fp => fixedBoxOf(board, fp))
  for (const it of board.items) {
    if (it.kind === 'track' && it.route !== f.route) for (let i = 1; i < it.pts.length; i++) out.push(boxOf([it.pts[i - 1], it.pts[i]], it.width / 2 + c))
    if (it.kind === 'via') out.push(boxOf([it.at], it.size / 2 + c))
  }
  return out
}
