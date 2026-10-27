// Each tuning step is cached under the route's untuned copper, its aim and the obstacles around it.
import type { Board, Item, PairInfo, Prim, Pt, RouteRecord, Track } from '@pcbjs/core/model'
import type { Length, ResolvedRules as Rules, Src } from '@pcbjs/core/types'
import { mm } from '@pcbjs/core/units'
import { copperLayersOf } from './copper.js'
import { copperLayers } from './layers.js'
import { classOf, CLASS_DEFAULTS, netClearance } from './netclass.js'
import { polylineLength, roomRun, routeLength, segDist, segmentRoom, type FreeSpan, type IsFree, type Room, type Side } from './length.js'
import { meander, meanderCapacity, runPitch, smallestBump, type MeanderMiss, type MeanderResult, type MeanderShape } from './meander.js'
import { linesOf, primOfSegment, primsOf, trackShape } from './round.js'
import { hash, type PairState, type TuneEntry } from './route-cache.js'
import { TuneSpace, type SpaceQuery } from './tune-space.js'

/** Lengths in mm. */
export interface TuneRoute {
  id: string
  net?: string
  /** every leg routed and, for a pair, the pair laid out */
  routed: boolean
  length?: { min?: number; max?: number; target?: number; tolerance?: number }
  match?: { group: string; tolerance?: number }
  /** merged from the board, the class and .rules() */
  tune?: { amplitude?: Length; spacing?: Length; maxAmplitude?: Length }
  pair?: {
    id: string; netN: string; w: number; g: number; skew: number; info?: PairInfo
    lengthen?: (extra: number, tolerance: number, ctx: PairFrees) => { added: number; note?: string }
    state?: () => PairState
    restore?: (s: PairState) => void
  }
  src?: Src
  chain?: Src[]
}

/** `free` tests as one of the pair's nets, `centreFree` as both, `room` adds courtyards and silk. */
export interface PairFrees { free: IsFree; centreFree: IsFree; room: IsFree; amplitude?: number; over?: number }

export interface TuneStore { get(key: string): TuneEntry | undefined; put(key: string, e: TuneEntry): void }
export interface TuneOptions { rules?: Rules; cache?: TuneStore | null }

/** mm */
export const TUNE_DEFAULTS = { amplitude: 1, spacing: 0.6, maxAmplitude: 3 } as const
/** Bumped whenever the tuner changes what it produces, so old cache entries are not reused. */
export const TUNE_VERSION = 'tune-16'
/** Room kept around a meander over the clearance, half the 0.1 mm sample step. */
const MARGIN = 0.05
const STEP = 0.1
const EPS = 1e-6
const nm = (v: number) => Math.round(v * 1e6) / 1e6
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
type Via = Extract<Item, { kind: 'via' }>
type BoxT = [number, number, number, number]

/** The range a route's .length() allows; tolerance from the route, else its class, else 0.1 mm. */
export function lengthRange(board: Board, r: Pick<TuneRoute, 'net' | 'length'>): { min: number; max: number; tolerance: number } | null {
  const l = r.length
  if (!l) return null
  const tolerance = l.tolerance ?? classOf(board, r.net)?.tolerance ?? CLASS_DEFAULTS.tolerance
  if (l.target !== undefined) return { min: Math.max(0, l.target - tolerance), max: l.target + tolerance, tolerance }
  return { min: l.min ?? 0, max: l.max ?? Infinity, tolerance }
}

const matchTolerance = (board: Board, r: TuneRoute) => r.match?.tolerance ?? classOf(board, r.net)?.tolerance ?? CLASS_DEFAULTS.tolerance

interface Grown { added: number; why?: string }

/** Tunes the routes in place and returns a record per route, in the order given. */
export function tuneRoutes(board: Board, routes: TuneRoute[], opts: TuneOptions = {}): RouteRecord[] {
  const rules = opts.rules ?? board.rules
  const cache = opts.cache ?? null
  const cu = copperLayers(board.copper)
  const stack = board.stackup ?? board.thickness
  const records = new Map<string, RouteRecord>()
  for (const r of routes) {
    const range = lengthRange(board, r)
    records.set(r.id, {
      id: r.id, ...(r.net !== undefined ? { net: r.net } : {}), ...(r.pair ? { pair: r.pair.id } : {}),
      ...(range ? { target: { min: range.min, ...(Number.isFinite(range.max) ? { max: range.max } : {}) } } : {}),
      ...(r.match ? { group: r.match.group } : {}),
      ...(r.src ? { src: r.src } : {}), ...(r.chain ? { chain: r.chain } : {}),
    })
  }
  if (!routes.some(r => r.length || r.match || r.pair)) return [...records.values()]

  // rebuilt after a pair is laid out anew
  let own = new Map<string, { tracks: Track[]; vias: Via[] }>()
  let built: TuneSpace | null = null
  const space = { get: () => (built ??= new TuneSpace(board, rules)) }
  const index = () => {
    own = new Map()
    for (const it of board.items) {
      if ((it.kind !== 'track' && it.kind !== 'via') || it.route === undefined) continue
      let e = own.get(it.route)
      if (!e) own.set(it.route, e = { tracks: [], vias: [] })
      if (it.kind === 'track') e.tracks.push(it)
      else e.vias.push(it)
    }
    for (const e of own.values()) { e.tracks.sort((a, b) => a.id - b.id); e.vias.sort((a, b) => a.id - b.id) }
    built = null
  }
  index()
  const copperOf = (id: string) => own.get(id) ?? { tracks: [], vias: [] }
  const measure = (r: TuneRoute): number => {
    const { tracks, vias } = copperOf(r.id)
    if (!r.pair) return routeLength(tracks, vias, stack)
    const side = (role: 'P' | 'N', net: string | undefined) => routeLength(tracks.filter(t => (t.role === 'N') === (role === 'N')), vias.filter(v => v.net === net), stack)
    return Math.max(side('P', r.net), side('N', r.pair.netN))
  }
  const shapeOf = (r: TuneRoute, width: number) => {
    const t = r.tune ?? {}
    const amplitude = t.amplitude !== undefined ? mm(t.amplitude) : TUNE_DEFAULTS.amplitude
    const spacing = t.spacing !== undefined ? mm(t.spacing) : TUNE_DEFAULTS.spacing
    const maxAmplitude = t.maxAmplitude !== undefined ? mm(t.maxAmplitude) : TUNE_DEFAULTS.maxAmplitude
    return { amplitude, spacing, maxAmplitude, width, clearance: netClearance(board, r.net) }
  }

  // the edge band, the silk text floor and the hole rules by side are not routing rules, so a board that sets them keeps its keys
  const globalKey = cache ? hash(JSON.stringify([TUNE_VERSION, { ...rules, edge: undefined, maskWeb: undefined, silkMinHeight: undefined, holeClearanceBy: undefined, minHoleToHoleBy: undefined }, board.copper, stack, board.classes ?? null,
    board.outline.map(r => r.map(q => q.map(r4))), (board.keepouts ?? []).map(k => [k.layers, k.tracks, k.outline.map(r => r.map(q => q.map(r4))), ...(k.except ? [k.except] : [])])])) : ''
  const sigs = new WeakMap<Item, { geo: unknown; box: BoxT; sig: string } | null>()
  const sigOf = (it: Item) => {
    const geo = it.kind === 'track' ? it.pts : it
    const hit = sigs.get(it)
    if (hit !== undefined && (hit === null || hit.geo === geo)) return hit
    const ls = copperLayersOf(it, cu)
    const side = it.layer.endsWith('.CrtYd') || it.layer.endsWith('.SilkS')
    let out: { geo: unknown; box: BoxT; sig: string } | null = null
    if (ls.length || side || (it.kind === 'pad' && it.drill)) {
      let pts: Pt[] = [], g = 0, shape: unknown = null
      switch (it.kind) {
        case 'pad': pts = it.poly; g = it.drill ? Math.max(...it.drill) / 2 : 0; if (it.drill) pts = [...pts, it.at]; shape = [it.poly.map(q => q.map(r4)), it.drill, it.type]; break
        case 'via': pts = [it.at]; g = it.size / 2; shape = [it.at.map(r4), it.size, it.drill]; break
        case 'track': pts = it.pts; g = it.width / 2; shape = [it.pts.map(q => q.map(r4)), it.width]; break
        case 'graphic': pts = it.paths.flat(); g = it.width / 2; shape = [it.paths.map(r => r.map(q => q.map(r4))), it.width, it.fill, it.closed]; break
        case 'text': pts = it.polys ? it.polys.flatMap(q => q.outer) : it.strokes.flat(); g = it.thickness / 2; shape = ls.length ? (it.polys ? it.polys.map(q => [q.outer, ...q.holes].map(r => r.map(q => q.map(r4)))) : [it.strokes.map(r => r.map(q => q.map(r4))), it.thickness]) : boxOf(pts).map(r4); break
        case 'zone': pts = it.outline.flat(); shape = it.outline.map(r => r.map(q => q.map(r4))); break
      }
      if (pts.length) {
        const b = boxOf(pts)
        out = { geo, box: [b[0] - g, b[1] - g, b[2] + g, b[3] + g], sig: JSON.stringify([it.kind, it.layer, it.net ?? '', it.ref ?? '', ls, shape]) }
      }
    }
    sigs.set(it, out)
    return out
  }
  const obsHash = (box: BoxT, skip: Set<number>): string => {
    const parts: string[] = []
    for (const it of board.items) {
      if (skip.has(it.id)) continue
      const s = sigOf(it)
      if (s && s.box[0] <= box[2] && box[0] <= s.box[2] && s.box[1] <= box[3] && box[1] <= s.box[3]) parts.push(s.sig)
    }
    return hash(parts.join('\n'))
  }
  const around = (tracks: Track[], vias: Via[], grow: number): BoxT => {
    const b = boxOf([...tracks.flatMap(t => t.pts), ...vias.map(v => v.at)])
    return [b[0] - grow, b[1] - grow, b[2] + grow, b[3] + grow]
  }
  // a stored step whose surroundings are unchanged is put back instead of run
  const cached = (key: string, tracks: Track[], vias: Via[], reach: number, run: () => { added: number; note?: string; uncoupled?: number }) => {
    const skip = new Set([...tracks, ...vias].map(i => i.id))
    const k = cache ? hash(JSON.stringify([globalKey, key, tracks.map(t => [t.layer, t.width, t.net ?? '', t.pts]), vias.map(v => [v.at, v.layers, v.size])])) : ''
    const e = cache?.get(k)
    if (e && e.tracks.length === tracks.length && obsHash(e.box, skip) === e.obs) {
      tracks.forEach((t, i) => {
        t.pts = e.tracks[i].map(([x, y]) => [x, y] as Pt)
        const p = e.prims?.[i]
        if (p) t.prims = p; else delete t.prims
        built?.update(t)
      })
      cache!.put(k, e)
      return { added: e.added, ...(e.note !== undefined ? { note: e.note } : {}), ...(e.uncoupled !== undefined ? { uncoupled: e.uncoupled } : {}) }
    }
    const box = around(tracks, vias, reach + 2)
    const obs = cache ? obsHash(box, skip) : ''
    const out = run()
    cache?.put(k, { obs, box, tracks: tracks.map(t => t.pts.map(([x, y]) => [x, y] as [number, number])), ...(tracks.some(t => t.prims) ? { prims: tracks.map(t => t.prims ?? null) } : {}), added: nm(out.added), ...(out.note !== undefined ? { note: out.note } : {}), ...(out.uncoupled !== undefined ? { uncoupled: out.uncoupled } : {}) })
    return out
  }

  // courtyards and silk of the parts a route ends on do not block within NEAR_PAD of its pads
  const outerOf = (tracks: Track[], nets: (string | undefined)[]): NonNullable<SpaceQuery['outer']> => {
    const ends = tracks.flatMap(t => [t.pts[0], t.pts[t.pts.length - 1]])
    const pads = board.items.filter((it): it is Extract<Item, { kind: 'pad' }> => it.kind === 'pad' && it.net !== undefined && nets.includes(it.net)
      && ends.some(p => Math.abs(p[0] - it.at[0]) < 5 && Math.abs(p[1] - it.at[1]) < 5 && (inPoly(it.poly, p) || ringDist(it.poly, p) < 0.01)))
    return { refs: new Set(pads.flatMap(p => (p.ref !== undefined ? [p.ref] : []))), pads: pads.map(p => p.poly) }
  }
  const explain = (rooms: Room[], minA: number, where: string): string => {
    let deepest = 0, longest: { run: FreeSpan; layer: string } | null = null
    for (const room of rooms) {
      for (const d of room.depth) if (d > deepest) deepest = d
      const run = roomRun(room, minA + MARGIN)
      if (run && (!longest || run.length > longest.run.length + 1e-9)) longest = { run, layer: room.layer }
    }
    if (deepest <= MARGIN + 0.01) return `no free run ${where}`
    if (!longest) return `the deepest free room ${where} is ${f2(Math.max(0, deepest - MARGIN))} mm, below the smallest meander amplitude of ${f2(minA)} mm`
    const { a, b } = longest.run
    return `the longest free run left ${where} is ${f2(longest.run.length)} mm, at (${f2((a[0] + b[0]) / 2)}, ${f2((a[1] + b[1]) / 2)}) on ${longest.layer}, too short for another bump`
  }
  interface GrowSpec {
    tracks: Track[]
    net?: string
    shape: MeanderShape
    /** preferred first, down to the smallest; `growth` holds larger ones for when these fall short */
    levels: number[]
    growth: number[]
    make(a: Pt, b: Pt, side: Side, extra: number, amp: number): MeanderResult | MeanderMiss | null
    /** a leftover below it is placed only when the overshoot stays within `over` */
    smallest: number
    over: number
    capacity(len: number, amp: number, left: number): number
    only?: (t: Track) => ((i: number) => boolean) | undefined
    outer: NonNullable<SpaceQuery['outer']>
    where: string
    onSplice?: (res: MeanderResult) => void
  }
  // growth amplitudes are tried only when no preferred one can add the rest at once
  const grow = (g: GrowSpec, extra: number): Grown => {
    const minA = g.levels[g.levels.length - 1]
    const reach = Math.max(...g.levels, ...g.growth) + MARGIN
    const keep = g.shape.clearance + MARGIN
    const store = new Map<string, Room>()
    const keyOf = (t: Track, i: number, side: Side) => `${t.id}|${t.pts[i]}|${t.pts[i + 1]}|${side}`
    const roomsOf = (t: Track): { room: Room; key: string }[] => {
      const q: SpaceQuery = { ...(g.net !== undefined ? { net: g.net } : {}), ownWidth: t.width, skip: new Set([t.id]), outer: g.outer }
      const slack = (layer: string, x: number, y: number, w: number) => space.get().slack(layer, x, y, w + 2 * MARGIN, q)
      const own = g.only?.(t), prims = t.prims
      // a bump goes on a straight segment, never on the chord of an arc
      const only = prims ? (i: number) => primOfSegment(prims, i).line && (!own || own(i)) : own
      const out: { room: Room; key: string }[] = []
      for (let i = 0; i + 1 < t.pts.length; i++) {
        if (only && !only(i)) continue
        for (const side of ['left', 'right'] as Side[]) {
          const key = keyOf(t, i, side)
          let room = store.get(key)
          if (!room) store.set(key, room = segmentRoom(t.pts, i, side, slack, t.width, reach, { layer: t.layer, step: STEP, clearance: keep }))
          out.push({ room: room.index === i ? room : { ...room, index: i }, key })
        }
      }
      return out
    }
    let left = extra, guard = 400, miss: string | undefined, small = false
    const dead = new Set<string>()
    // grown to take a leftover below the smallest bump
    let last: { t: Track; pts: Pt[]; prims?: Prim[]; run: FreeSpan; A: number; added: number } | null = null
    const enlarge = (): boolean => {
      if (!last) return false
      const res = g.make(last.run.a, last.run.b, last.run.side, last.added + left, last.A)
      if (!res || 'why' in res || res.added < last.added + EPS) return false
      const cur = { pts: last.t.pts, prims: last.t.prims }
      last.t.pts = last.pts; if (last.prims) last.t.prims = last.prims; else delete last.t.prims
      splice(last.t, last.run.index, res)
      // the room was measured only to the old amplitude
      if (!(res.pts.every(p => segDist(p, last!.run.a, last!.run.b) <= last!.A + 1e-6))) { last.t.pts = cur.pts; if (cur.prims) last.t.prims = cur.prims; else delete last.t.prims; return false }
      space.get().update(last.t)
      left -= res.added - last.added
      last.added = res.added
      return true
    }
    while (left > EPS && guard-- > 0) {
      let ask = left
      if (left < g.smallest - 1e-9) {
        if (enlarge()) continue
        if (g.smallest - left > g.over + 1e-9) { small = true; break }
        ask = g.smallest
      }
      type Pick = { t: Track; run: FreeSpan; A: number; v: number; key: string }
      const bestAt = (A: number): Pick | null => {
        let best: Pick | null = null
        for (const t of g.tracks) for (const { room, key } of roomsOf(t)) {
          if (dead.has(`${key}|${A}`)) continue
          const run = roomRun(room, A + MARGIN)
          if (!run) continue
          const v = Math.min(g.capacity(run.length, A, left), left)
          if (v > EPS && (!best || v > best.v + 1e-9)) best = { t, run, A, v, key }
        }
        return best
      }
      let pick: Pick | null = null
      for (const A of g.levels) { const p = bestAt(A); if (p && (!pick || p.v > pick.v + 1e-9)) pick = p }
      if ((!pick || pick.v < left - EPS) && g.growth.length)
        for (const A of [...g.growth].reverse()) { const p = bestAt(A); if (p && (!pick || p.v > pick.v + 1e-9)) pick = p }
      if (!pick) break
      // never strand a leftover below the smallest bump
      if (pick.v < ask - EPS && ask - pick.v < g.smallest && ask - g.smallest >= g.smallest) ask -= g.smallest
      const res = g.make(pick.run.a, pick.run.b, pick.run.side, ask, pick.A)
      if (!res || 'why' in res || res.added < EPS) { if (res && 'why' in res) miss = res.why; dead.add(`${pick.key}|${pick.A}`); continue }
      if (res.added - left > g.over + 1e-9) { miss = `the smallest bump that fits here adds ${f2(res.added)} mm, more than the ${f2(left)} mm left`; dead.add(`${pick.key}|${pick.A}`); continue }
      const pts = res.pts
      last = { t: pick.t, pts: pick.t.pts, ...(pick.t.prims ? { prims: pick.t.prims } : {}), run: pick.run, A: pick.A, added: res.added }
      splice(pick.t, pick.run.index, res)
      space.get().update(pick.t)
      left -= res.added
      g.onSplice?.(res)
      const mb = boxOf(pts), m = reach + keep + 2 * pick.t.width + 1
      for (const [key, room] of store) {
        const rb = boxOf([room.a, room.b])
        if (rb[0] - m <= mb[2] && mb[0] <= rb[2] + m && rb[1] - m <= mb[3] && mb[1] <= rb[3] + m) store.delete(key)
      }
    }
    if (left > EPS + 1e-4 && !small) enlarge()
    if (left <= EPS + 1e-4) return { added: extra - left }
    if (small || left < g.smallest - 1e-9) return { added: extra - left, why: `the ${f2(left)} mm left is below the smallest U bump of ${f2(g.smallest)} mm` }
    return { added: extra - left, why: miss ?? explain(g.tracks.flatMap(t => roomsOf(t).map(x => x.room)), minA, g.where) }
  }

  const splice = (t: Track, index: number, res: MeanderResult) => {
    const prims = primsOf(t), { k } = primOfSegment(prims, index), q = prims[k]
    const bump = res.prims
    const next: Prim[] = [...prims.slice(0, k), ...linesOf([q.from, bump[0].from]), ...bump, ...linesOf([bump[bump.length - 1].to, q.to]), ...prims.slice(k + 1)]
    const sh = trackShape(next)
    t.pts = sh.pts
    if (sh.prims) t.prims = sh.prims
    else delete t.prims
  }
  const ampsFrom = (top: number, floor: number) => {
    const out: number[] = []
    for (let a = Math.max(top, floor); a > floor + EPS; a *= 0.75) out.push(a)
    out.push(floor)
    return out
  }
  const growthFrom = (amplitude: number, max: number) => {
    const out: number[] = []
    for (let a = max; a > amplitude * 1.1 + EPS; a /= 1.25) out.push(a)
    return out
  }

  const floorFix = (group?: string) => `lengthen the path by hand, by a waypoint or a longer route, or widen the ${group ? 'group\'s ' : ''}tolerance`
  const fixFor = (group?: string) => `a waypoint that leads the route through free board${group ? ', a longer path or a smaller group' : ' or a longer path'} would make room`
  const pairWhy = (r: TuneRoute, st: PairState): string => {
    const pr = r.pair!, { tracks, vias } = copperOf(r.id)
    const pitch = pr.w + pr.g, cw = 2 * pr.w + pr.g, shape = shapeOf(r, cw)
    const q: SpaceQuery = { ...(r.net !== undefined ? { net: r.net } : {}), twin: pr.netN, ownWidth: cw + 2 * MARGIN, skip: new Set([...tracks, ...vias].map(i => i.id)), outer: outerOf(tracks, [r.net, pr.netN]) }
    const slack = (layer: string, x: number, y: number, w: number) => space.get().slack(layer, x, y, w + 2 * MARGIN, q)
    const reach = Math.max(shape.amplitude, shape.maxAmplitude) + MARGIN, bounds = [0, ...st.vias, st.centre.length - 1]
    const rooms: Room[] = []
    for (let k = 0; k + 1 < bounds.length; k++) {
      const sec = st.centre.slice(bounds[k], bounds[k + 1] + 1) as Pt[]
      for (let i = 0; i + 1 < sec.length; i++) for (const side of ['left', 'right'] as Side[])
        rooms.push(segmentRoom(sec, i, side, slack, cw, reach, { layer: st.layers[k], step: STEP, clearance: shape.clearance + MARGIN }))
    }
    return explain(rooms, Math.max(1.2 * pitch, pitch + 0.02), 'beside the centre line')
  }
  const lengthen = (r: TuneRoute, extra: number, tolerance: number, group?: string, over = tolerance): { added: number; note?: string } => {
    if (r.pair) {
      if (!r.pair.lengthen) return { added: 0, note: 'a pair is not length tuned here' }
      const pass = (x: number, amplitude?: number) => {
        const { tracks, vias } = copperOf(r.id)
        const skip = new Set([...tracks, ...vias].map(i => i.id)), twin = r.pair!.netN, outer = outerOf(tracks, [r.net, twin])
        const res = r.pair!.lengthen!(x, tolerance, {
          over: Math.max(0, over - (extra - x)),
          free: (layer, px, py, net, w) => space.get().slack(layer, px, py, w, { ...(net !== undefined ? { net } : {}), skip }) >= 0,
          centreFree: (layer, px, py, net, w) => space.get().slack(layer, px, py, w, { ...(net !== undefined ? { net } : {}), twin: net === twin ? r.net : twin, skip }) >= 0,
          room: (layer, px, py, net, w) => space.get().slack(layer, px, py, w, { ...(net !== undefined ? { net } : {}), twin: net === twin ? r.net : twin, skip, outer }) >= 0,
          ...(amplitude !== undefined ? { amplitude } : {}),
        })
        index()
        return res
      }
      const shape = shapeOf(r, r.pair.w)
      const run = () => {
        const first = pass(extra)
        const done = extra - first.added <= tolerance || shape.maxAmplitude <= shape.amplitude + EPS
        const more = done ? { added: 0 } : pass(extra - first.added, shape.maxAmplitude)
        const added = first.added + more.added
        if (extra - added <= tolerance || !P.state) return { added, ...(!done && 'note' in more && more.note ? { note: more.note } : !done || !first.note ? {} : { note: first.note }) }
        const floor = smallestBump(Math.max(r.pair!.w, (r.pair!.w + r.pair!.g) / 2))
        if (extra - added < floor - EPS) return { added, note: `pair tuning added ${f2(added)} of ${f2(extra)} mm, ${f2(extra - added)} mm missing, below the smallest pair meander of ${f2(floor)} mm, 2 pi - 4 times the larger of the width and half the pitch, which would overshoot; ${floorFix(group)}` }
        return { added, note: `pair tuning added ${f2(added)} of ${f2(extra)} mm, ${f2(extra - added)} mm missing: ${pairWhy(r, P.state())}; ${fixFor(group)}` }
      }
      const P = r.pair
      if (!cache || !P.state || !P.restore) return run()
      const { tracks, vias } = copperOf(r.id)
      const skip = new Set([...tracks, ...vias].map(i => i.id))
      const k = hash(JSON.stringify([globalKey, 'pair', r.net ?? '', P.netN, nm(extra), nm(tolerance), shape, P.state()]))
      const e = cache.get(k)
      if (e?.pair && obsHash(e.box, skip) === e.obs) {
        P.restore(e.pair)
        index()
        cache.put(k, e)
        return { added: e.added, ...(e.note !== undefined ? { note: e.note } : {}) }
      }
      const box = around(tracks, vias, Math.max(shape.amplitude, shape.maxAmplitude) + 2), obs = obsHash(box, skip)
      const out = run()
      cache.put(k, { obs, box, tracks: [], added: nm(out.added), ...(out.note !== undefined ? { note: out.note } : {}), pair: P.state() })
      return out
    }
    const { tracks, vias } = copperOf(r.id)
    if (!tracks.length) return { added: 0, note: 'the route has no tracks to meander' }
    const shape = shapeOf(r, tracks[0].width)
    const levels = ampsFrom(shape.amplitude, runPitch(shape) / 2), growth = growthFrom(shape.amplitude, shape.maxAmplitude)
    const reach = Math.max(shape.amplitude, shape.maxAmplitude)
    return cached(JSON.stringify(['len', r.net ?? '', nm(extra), shape]), tracks, vias, reach, () => {
      const res = grow({
        tracks, ...(r.net !== undefined ? { net: r.net } : {}), shape, levels, growth, where: 'beside the route',
        make: (a, b, side, x, amp) => meander(a, b, side, { extra: x, ...shape, amplitude: amp }),
        capacity: (len, amp) => meanderCapacity(len, { ...shape, amplitude: amp }),
        smallest: smallestBump(shape.width), over,
        outer: outerOf(tracks, [r.net]),
      }, extra)
      const fix = fixFor(group), floor = smallestBump(shape.width)
      if (res.why && extra - res.added < floor - EPS) return { added: res.added, note: `tuning added ${f2(res.added)} of ${f2(extra)} mm, ${f2(extra - res.added)} mm missing, below the smallest U bump of ${f2(floor)} mm, 2 pi - 4 times the track width, which would overshoot; ${floorFix(group)}` }
      return { added: res.added, ...(res.why ? { note: `tuning added ${f2(res.added)} of ${f2(extra)} mm, ${f2(extra - res.added)} mm missing: ${res.why}; ${fix}` } : {}) }
    })
  }
  const note = (r: TuneRoute, res: { added: number; note?: string }) => {
    const rec = records.get(r.id)!
    if (res.added > EPS) rec.tuned = nm((rec.tuned ?? 0) + res.added)
    if (res.note) rec.note = res.note
  }

  // length targets: to the target, else the middle of the range, else the minimum plus half the tolerance
  for (const r of routes) {
    const range = lengthRange(board, r)
    if (!range || !r.routed) continue
    const L = measure(r)
    if (L >= range.min - EPS) continue
    const aim = Number.isFinite(range.max) ? (r.length?.target ?? (range.min + range.max) / 2) : range.min + range.tolerance / 2
    note(r, lengthen(r, aim - L, range.tolerance / 4, undefined, Number.isFinite(range.max) ? range.max - aim : Infinity))
  }

  // match groups: every member into [longest - tolerance, longest], within its own range
  const groups = new Map<string, TuneRoute[]>()
  for (const r of routes) if (r.match) groups.set(r.match.group, [...(groups.get(r.match.group) ?? []), r])
  for (const name of [...groups.keys()].sort()) {
    const members = groups.get(name)!
    const tol = Math.min(...members.map(r => matchTolerance(board, r)))
    for (const r of members) records.get(r.id)!.tolerance = tol
    const ok = members.filter(r => r.routed)
    if (ok.length < 2) continue
    const lengths = new Map(ok.map(r => [r, measure(r)] as const))
    const top = ok.reduce((a, b) => (lengths.get(b)! > lengths.get(a)! + EPS ? b : a))
    const longest = lengths.get(top)!
    for (const r of ok) {
      const L = lengths.get(r)!, own = lengthRange(board, r)
      const lo = Math.max(longest - tol, own?.min ?? 0), hi = Math.min(longest, own?.max ?? Infinity)
      const rec = records.get(r.id)!
      if (hi < longest - tol - EPS) {
        rec.caps = nm(longest - hi)
        const res = L < hi - tol / 2 - EPS ? lengthen(r, hi - Math.min(tol / 2, 0.05) - L, tol / 4, name, Math.min(tol / 2, 0.05)) : { added: 0 }
        note(r, { added: res.added, note: `its own maximum of ${f2(hi)} mm is ${f2(longest - hi)} mm below the longest of group ${name}, ${top.id} at ${f2(longest)} mm, so it caps the group${res.note ? `; ${res.note}` : ''}` })
        continue
      }
      if (L >= lo - EPS || lo > hi + EPS) continue
      note(r, lengthen(r, (lo + hi) / 2 - L, tol / 4, name, (hi - lo) / 2))
    }
  }

  // pair skew: the shorter track gets a meander in a coupled run
  for (const r of routes) {
    const pr = r.pair
    if (!pr || !r.routed) continue
    const { tracks, vias } = copperOf(r.id)
    const P = tracks.filter(t => t.role !== 'N'), N = tracks.filter(t => t.role === 'N')
    const lp = routeLength(P, vias.filter(v => v.net === r.net), stack), ln = routeLength(N, vias.filter(v => v.net === pr.netN), stack)
    const diff = Math.abs(lp - ln)
    if (diff <= pr.skew + EPS || !P.length || !N.length) continue
    const [short, partner, net] = lp < ln ? [P, N, r.net] : [N, P, pr.netN]
    const pitch = pr.w + pr.g
    // a bump top nearer than a pitch would read as a coupled run at the wrong gap
    const hmin = pitch + 0.02
    const s0 = shapeOf(r, pr.w), shape: MeanderShape = { amplitude: s0.amplitude, spacing: s0.spacing, width: pr.w, clearance: s0.clearance, radius: pitch, minRadius: pr.w, minAmplitude: hmin }
    const res = cached(JSON.stringify(['skew', r.net ?? '', pr.netN, nm(diff), shape]), tracks, vias, Math.max(shape.amplitude, hmin), () => {
      let unc = 0
      const g = grow({
        tracks: short, ...(net !== undefined ? { net } : {}), shape, levels: ampsFrom(shape.amplitude, hmin), growth: [],
        where: 'beside the coupled runs of the shorter track',
        make: (a, b, side, extra, amp) => meander(a, b, side, { extra, ...shape, amplitude: amp }),
        capacity: (len, amp) => meanderCapacity(len, { ...shape, amplitude: amp }),
        smallest: smallestBump(pr.w), over: pr.skew,
        only: t => i => partner.some(o => o.layer === t.layer && runsBeside(t.pts[i], t.pts[i + 1], o.pts, 2 * pitch)),
        outer: outerOf(tracks, [r.net, pr.netN]),
        onSplice: m => { unc += bumpUncoupled(m.pts) },
      }, diff)
      const floor = smallestBump(pr.w), left = diff - g.added
      const why = left < floor - EPS ? `the ${f2(left)} mm left is below the smallest skew bump of ${f2(floor)} mm, 2 pi - 4 times the track width, which would overshoot the tolerance; even out the two tracks' paths by hand, or allow the skew with .skew()` : g.why ?? 'no coupled run of the shorter track has room for more'
      return { added: g.added, ...(g.added < diff - pr.skew - EPS ? { note: `the pair skew of ${f2(diff)} mm could be tuned by ${f2(g.added)} mm only: ${why}` } : {}), uncoupled: nm(unc) }
    })
    if (pr.info && res.uncoupled) pr.info.uncoupled = nm(pr.info.uncoupled + res.uncoupled)
    const rec = records.get(r.id)!
    if (res.added > EPS) rec.tuned = nm((rec.tuned ?? 0) + res.added)
    if (res.note) rec.skewNote = res.note
  }
  return [...records.values()]
}

/** Some segment of `other` is parallel to a to b, overlaps it and lies closer than `reach`. */
function runsBeside(a: Pt, b: Pt, other: Pt[], reach: number): boolean {
  const la = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (la < 1e-6) return false
  const u: Pt = [(b[0] - a[0]) / la, (b[1] - a[1]) / la]
  for (let j = 1; j < other.length; j++) {
    const c = other[j - 1], d = other[j]
    const lb = Math.hypot(d[0] - c[0], d[1] - c[1])
    if (lb < 1e-6) continue
    const v: Pt = [(d[0] - c[0]) / lb, (d[1] - c[1]) / lb]
    if (Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-6) continue
    const s0 = (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1], s1 = (d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1]
    if (Math.min(la, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)) < 1e-3) continue
    if (Math.abs((c[0] - a[0]) * u[1] - (c[1] - a[1]) * u[0]) < reach) return true
  }
  return false
}

/** The bump off its chord plus the partner's stretch beside it. */
function bumpUncoupled(pts: Pt[]): number {
  const a = pts[0], b = pts[pts.length - 1]
  const off = pts.map(p => segDist(p, a, b) > 1e-6)
  const first = off.indexOf(true), last = off.lastIndexOf(true)
  if (first < 0) return 0
  const run = pts.slice(first - 1, last + 2)
  const foot = Math.hypot(run[run.length - 1][0] - run[0][0], run[run.length - 1][1] - run[0][1])
  return polylineLength(run) + foot
}

function boxOf(pts: Pt[]): BoxT {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y }
  return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1, y1]
}

function inPoly(r: Pt[], p: Pt): boolean {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c
  return c
}

function ringDist(r: Pt[], p: Pt): number {
  let d = Infinity
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(p, r[j], r[i]))
  return d
}
