// The patch stage, see docs/patches.md: copper with no source of its own, hold and reroute on the route jobs before the router, via and width after tune.
import type { AutoRouteJob, Board, DrcMarker, Footprint, Item, Pt, Via } from '@pcbjs/core/model'
import type { Hold, Patch, PatchKind } from '@pcbjs/core/internal/patch'
import { opKind } from '@pcbjs/core/internal/patch'
import { boardIndex, parseRef, printRef, resolveRef, RefError } from '@pcbjs/core/ref'
import { coordString } from '@pcbjs/core/internal/units'
import { defaultVia } from '@pcbjs/core/internal/rules'
import { digest } from './cache.js'
import { CompileError, REF_AT, ROUTE_IDS } from './flatten.js'
import { isRoutePoint } from '@pcbjs/core/internal/part'
import { apply, applyRing, type Mat } from './geom.js'
import { applyPrims } from './path.js'
import { copperLayers } from './layers.js'
import { changed, immutable } from './items.js'
import { padOf, resolvePos } from './autoroute.js'
import { marker } from './messages.js'

const um = (v: number) => Math.round(v * 1000)
const ums = (p: readonly number[]) => p.map(um)
const hash12 = (v: unknown): string => digest(['patch', v]).slice(0, 12)
const ROUTE_OPS = new Set<PatchKind>(['hold', 'reroute'])

/** Where an operation applies: route on the jobs before the router, copper after tune. */
export function stageOf(p: Patch): 'route' | 'copper' {
  return ROUTE_OPS.has(opKind(p.op)) ? 'route' : 'copper'
}

/** `hold` and `reroute` written onto the jobs of their route; the stale ones as findings. */
export function routePatches(board: Board, jobs: AutoRouteJob[], patches: readonly Patch[]): DrcMarker[] {
  const out: DrcMarker[] = []
  for (const p of patches) {
    if (stageOf(p) !== 'route') continue
    const { id, leg } = routeTarget(p.ref)
    const own = jobs.filter(j => j.route === id)
    const have = own.length ? routeHash(board, own) : undefined
    const op = p.op as Extract<Patch['op'], { hold: unknown } | { reroute: unknown }>
    if (have === undefined || have !== p.hash || ('reroute' in op && leg === undefined)) {
      out.push(stale(p, have, own[0] && startOf(board, own[0])))
      continue
    }
    if ('hold' in op) holdJobs(own, op.hold)
    else rerouteJobs(own, leg!, op.reroute.through ?? [], p)
  }
  return out
}

/** `via` and `width` on the tuned copper; the stale ones as findings. */
export function copperPatches(board: Board, patches: readonly Patch[]): DrcMarker[] {
  const out: DrcMarker[] = []
  for (const p of patches) {
    if (stageOf(p) !== 'copper') continue
    const have = copperHash(board, p)
    if (have !== p.hash) {
      out.push(stale(p, have, copperAt(board, p)))
      continue
    }
    const op = p.op
    if ('width' in op) setWidth(board, routeTarget(p.ref).id, op.width)
    else addVia(board, p)
  }
  return out
}

/** The hash a patch of `kind` on `ref` must carry on this board, as tools write it; undefined when nothing is there. */
export function targetHash(board: Board, jobs: readonly AutoRouteJob[], ref: string, kind: PatchKind): string | undefined {
  const p = { ref, hash: '', op: { [kind]: null } } as unknown as Patch
  if (ROUTE_OPS.has(kind)) {
    const own = jobs.filter(j => j.route === routeTarget(ref).id)
    return own.length ? routeHash(board, own) : undefined
  }
  return copperHash(board, p)
}

/** The hold patch of a route as this compile left it: its automatic legs before tuning, from the route's record. */
export function holdPatch(board: Board, ref: string, snapshot?: string): Patch {
  const route = resolveRef(boardIndex(board), ref)
  if (route.kind !== 'route') throw new RefError(`${ref}: a hold names a route, such as route:3`)
  const r = route.route
  if (!r.hash) throw new RefError(`${ref}: has no automatic leg to hold`)
  const legs = r.legs ?? []
  if (!legs.length || legs.some(l => !l.copper)) throw new RefError(`${ref}: ${legs.length ? 'a leg did not route, so there is nothing to hold' : 'has no automatic leg to hold'}`)
  const tag = (k: number) => (legs.length > 1 ? { leg: k + 1 } : {})
  const hold: Hold = {
    ...(snapshot ? { snapshot } : {}),
    tracks: legs.flatMap((l, k) => l.copper!.tracks.map(t => ({ ...t, ...tag(k) }))),
    vias: legs.flatMap((l, k) => l.copper!.vias.map(v => ({ ...v, ...tag(k) }))),
  }
  return { ref: r.id, hash: r.hash, op: { hold } }
}

/** 12 hex over each job's request: ends, net, width, layers and chain; never the copper around it. */
export function routeHash(board: Board, jobs: readonly AutoRouteJob[]): string | undefined {
  const end = (e: AutoRouteJob['from'], layer: string) => {
    if (e === undefined) return null
    if (isRoutePoint(e)) return ['pt', ROUTE_IDS.get(e.route) ?? null, e.pt]
    try {
      const q = resolvePos(board, e, layer)
      return [um(q.x), um(q.y), q.layer, padOf(board, e)?.net ?? null]
    } catch {
      return 'unresolved'
    }
  }
  return hash12(
    jobs.map(j => {
      const l = j.layer ?? 'F.Cu'
      return [
        j.net ?? null,
        j.width ?? null,
        j.params.layers ?? null,
        l,
        end(j.from, l),
        end(j.to, l),
        end(j.root, l),
        j.toNet ?? null,
        !!j.whole,
        j.path ?? null,
        j.tree ?? null,
        j.pair ? [end(j.pair.fromN, l), end(j.pair.toN, l), j.pair.gap ?? null] : null,
      ]
    }),
  )
}

/** The inverse of a rotation and translation. */
function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  const a = m[3] / det,
    b = -m[1] / det,
    c = -m[2] / det,
    d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/** Parts moved by the rigid motion `m`, which turns by `turn` degrees: their footprints, items and silk ref places. */
export function moveParts(board: Board, parts: Footprint[], m: Mat, turn: number): void {
  const refs = new Set(parts.map(f => f.ref))
  board.items.forEach((it, i) => {
    if (it.ref !== undefined && refs.has(it.ref)) board.items[i] = changed(it, moved(it, m, turn))
  })
  for (const fp of parts) {
    fp.at = apply(m, fp.at)
    fp.rot = norm(fp.rot + turn)
    moveRefAt(fp, m, turn)
  }
}

/** A part's own silk ref place moved with it. */
export function moveRefAt(fp: Footprint, m: Mat, turn: number): void {
  const ra = REF_AT.get(fp)
  if (ra) REF_AT.set(fp, { at: apply(m, ra.at), rot: norm(ra.rot + turn) })
}

const norm = (r: number) => ((r % 360) + 360) % 360

/** The fields of an item that the rigid motion `m`, turning by `turn` degrees, moves. */
function moved(it: Item, m: Mat, turn: number): Partial<Item> {
  switch (it.kind) {
    case 'pad':
      return {
        at: apply(m, it.at),
        poly: applyRing(m, it.poly),
        ...(it.pasteRings ? { pasteRings: it.pasteRings.map(r => applyRing(m, r)) } : {}),
        ...(it.maskRings ? { maskRings: it.maskRings.map(r => applyRing(m, r)) } : {}),
        rot: norm(it.rot + turn),
      }
    case 'track':
      return { pts: applyRing(m, it.pts), ...(it.prims ? { prims: applyPrims(m, it.prims) } : {}) }
    case 'via':
      return { at: apply(m, it.at) }
    case 'zone':
      return { outline: it.outline.map(r => applyRing(m, r)), ...(it.prims ? { prims: it.prims.map(q => applyPrims(m, q)) } : {}) }
    case 'graphic':
      return { paths: it.paths.map(r => applyRing(m, r)), ...(it.prims ? { prims: it.prims.map(q => applyPrims(m, q)) } : {}) }
    case 'text':
      return {
        at: apply(m, it.at),
        strokes: it.strokes.map(r => applyRing(m, r)),
        ...(it.polys ? { polys: it.polys.map(q => ({ outer: applyRing(m, q.outer), holes: q.holes.map(r => applyRing(m, r)) })) } : {}),
        rot: norm(it.rot + turn),
      }
  }
  return {}
}

/** `route:<id>` and the leg of `route:<id>/leg:<k>`. */
function routeTarget(ref: string): { id: string; leg?: number } {
  let segs
  try {
    segs = parseRef(ref)
  } catch {
    return { id: '' }
  }
  if (segs[0]?.kind === 'board') segs = segs.slice(1)
  const r = segs.findIndex(x => x.kind === 'route')
  if (r < 0) return { id: '' }
  const leg = segs[r + 1]?.kind === 'leg' ? Number(segs[r + 1].value) : undefined
  return { id: printRef(segs.slice(0, r + 1)), ...(leg !== undefined && leg >= 1 ? { leg } : {}) }
}

/** Each automatic leg of the route takes its tracks and vias from the hold, by their `leg`, the first when absent. */
function holdJobs(jobs: AutoRouteJob[], hold: Hold): void {
  const legs: Hold[] = []
  const at = (k: number | undefined) => (legs[(k ?? 1) - 1] ??= { tracks: [], vias: [] })
  for (const t of hold.tracks) at(t.leg).tracks.push(t)
  for (const v of hold.vias) at(v.leg).vias.push(v)
  for (let k = 0; k < legs.length; k++) legs[k] ??= { tracks: [], vias: [] }
  for (const j of jobs) j.hold = legs
}

/** A leg routed again: through each waypoint as legs of its own, or else past the route memo. */
function rerouteJobs(jobs: AutoRouteJob[], leg: number, through: readonly string[], p: Patch): void {
  if (!through.length) {
    for (const j of jobs) j.reroute = [...(j.reroute ?? []), leg]
    return
  }
  let k = 0
  for (const j of jobs) {
    if (j.whole || j.toNet !== undefined) continue
    const steps = j.steps ?? [{ op: 'XZ' as const }]
    const i = steps.findIndex(s => (s.op === 'X' || s.op === 'XZ') && ++k === leg)
    if (i < 0) continue
    const inv = invert(j.m ?? [1, 0, 0, 1, 0, 0])
    const xs = through.map(w => {
      const c = waypoint(p, w)
      const [x, y] = apply(inv, [c.x, c.y])
      return { op: 'X' as const, x, y, rel: false }
    })
    j.steps = [...steps.slice(0, i), ...xs, ...steps.slice(i)]
    return
  }
  throw new CompileError(`patch ${p.ref}: no automatic leg ${leg} of a route with a chain to reroute through waypoints`, p.src)
}

function waypoint(p: Patch, w: string): { x: number; y: number } {
  try {
    const c = coordString(w)
    if (c) return c
  } catch (e) {
    throw new CompileError(`patch ${p.ref}: ${(e as Error).message}`, p.src)
  }
  throw new CompileError(`patch ${p.ref}: a waypoint is "x y", got ${JSON.stringify(w)}`, p.src)
}

/** What a copper operation's meaning depends on: the route geometry for width, the target's identity for via. */
function copperHash(board: Board, p: Patch): string | undefined {
  const k = opKind(p.op)
  if (k === 'width') {
    const id = routeTarget(p.ref).id
    const own = board.items.filter(it => (it.kind === 'track' || it.kind === 'via') && it.route === id)
    return own.length ? hash12(own.map(it => (it.kind === 'track' ? [it.layer, it.pts.map(ums)] : [(it as Via).layers, ums((it as Via).at)]))) : undefined
  }
  const t = viaTarget(board, p.ref)
  return t && hash12(t.identity)
}

/** A via patch's target: a net, a route or a plane, the net a via takes and the layers it spans by default. */
function viaTarget(board: Board, ref: string): { identity: unknown; net?: string; route?: string; layer?: string } | undefined {
  try {
    const r = resolveRef(boardIndex(board), ref)
    if (r.kind === 'net') return { identity: ['net', r.net.name], net: r.net.name }
    if (r.kind === 'route') return { identity: ['route', r.route.id, r.route.net ?? null], ...(r.route.net ? { net: r.route.net } : {}), route: r.route.id }
    if (r.kind === 'plane') return { identity: ['plane', r.layer, r.net], net: r.net, layer: r.layer }
  } catch {
    /* missing */
  }
  return undefined
}

function setWidth(board: Board, id: string, width: number): void {
  if (!(width > 0)) throw new CompileError(`patch ${id}: width must be more than 0 mm, got ${JSON.stringify(width)}`)
  // a changed track gets its uid again when the stage ends
  board.items.forEach((it, i) => {
    if (it.kind === 'track' && it.route === id) board.items[i] = changed(it, { width, uid: undefined })
  })
}

function addVia(board: Board, p: Patch): void {
  const op = (p.op as Extract<Patch['op'], { via: unknown }>).via
  const t = viaTarget(board, p.ref)!
  const cu = copperLayers(board.copper)
  const c = waypoint(p, op.at)
  const span = (op.span ?? [cu[0], cu[cu.length - 1]]).slice().sort((a, b) => cu.indexOf(a) - cu.indexOf(b)) as [string, string]
  for (const l of span) if (!cu.includes(l)) throw new CompileError(`patch ${p.ref}: via span names ${l}, not a copper layer of this board`, p.src)
  const d = defaultVia(board.rules)
  const net = op.net === null ? undefined : (op.net ?? t.net)
  const id = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
  board.items.push(
    immutable({
      kind: 'via',
      id,
      layer: span[0],
      ...(net !== undefined ? { net } : {}),
      at: [c.x, c.y],
      drill: op.drill ?? d.drill,
      size: op.size ?? d.size,
      layers: span,
      ...(t.route ? { route: t.route } : {}),
      ...(p.src ? { src: p.src } : {}),
    } as Via),
  )
}

function startOf(board: Board, job: AutoRouteJob): Pt | undefined {
  try {
    const e = job.from ?? job.root
    if (!e) return undefined
    const q = resolvePos(board, e, job.layer ?? 'F.Cu')
    return [q.x, q.y]
  } catch {
    return undefined
  }
}

/** Where a copper patch's target is: the first point of the route's copper. */
function copperAt(board: Board, p: Patch): Pt | undefined {
  const id = routeTarget(p.ref).id
  const t = board.items.find(it => it.kind === 'track' && it.route === id)
  return t?.kind === 'track' ? t.pts[0] : undefined
}

/** The warning for a patch whose target is gone or has another hash; the patch is skipped. */
function stale(p: Patch, have: string | undefined, at?: Pt): DrcMarker {
  const hold = 'hold' in p.op ? p.op.hold : undefined
  return marker({
    severity: 'warning',
    rule: 'patch-stale',
    at: at ?? [0, 0],
    refs: [p.ref],
    args: { op: opKind(p.op), ref: p.ref, want: p.hash, have: have ?? '', ...(hold?.snapshot ? { snapshot: hold.snapshot } : {}) },
    ...(p.src ? { src: p.src } : {}),
  })
}
