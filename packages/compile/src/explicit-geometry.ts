// Flatten is the coarse declaration evaluator. These products retain its resolved geometry, not its mutable board or JS handles.
import type { AutoRouteJob, Board, Footprint, Item } from '@pcbjs/core/model'
import { isPinRef } from '@pcbjs/core/internal/nets'
import { partOf } from '@pcbjs/core/internal/part'
import { coordString } from '@pcbjs/core/internal/units'
import { byPoints, planRoutes, pointDeps } from './autoroute.js'
import type { BuildGraph } from './build-graph.js'
import { canon } from './facets.js'
import { PART_REFS, ROUTE_IDS, type Flat } from './flatten.js'
import { bbox } from './geom.js'
import { immutable } from './items.js'
import { mintUids } from './uid.js'

type Drawing<T = Item> = T extends Item ? Omit<T, 'id'> : never
type Pose = Pick<Footprint, 'at' | 'rot' | 'side'> & { pending: boolean }
interface Part {
  footprint: Omit<Footprint, 'at' | 'rot' | 'side'>
  items: Drawing[]
}
interface Placed extends Part {
  pose: Pose
}
interface Order {
  refs: string[]
  items: { owner: string | null; index: number }[]
}
type Declaration = Omit<Board, 'items' | 'footprints'>
type RoutingDeclaration = Omit<Declaration, 'bbox' | 'title' | 'rev' | 'stats'>
const owned = new WeakMap<BuildGraph, Set<string>>()
const clone = <T>(value: T): T => structuredClone(value)
const fingerprint = (value: unknown): string => JSON.stringify(value) ?? 'undefined'
const drawing = ({ id: _, ...item }: Item): Drawing => item as Drawing

/** Current explicit geometry, materialized from immutable products. Numeric item ids exist only on the returned board. */
export function explicitGeometry(flat: Flat, source: Board, graph: BuildGraph, sourceRevision: string): Board {
  const keys = new Set<string>()
  const input = <T>(key: string, value: T): void => {
    keys.add(key)
    graph.input(key, clone(value), fingerprint(value))
  }
  const define = <T>(key: string, run: (ctx: { read<T>(key: string): T }) => T): void => {
    keys.add(key)
    graph.define(key, 'explicit-geometry:1', run, fingerprint)
  }
  const refKey = (ref: string, product: string) => `explicit/part/${JSON.stringify(ref)}/${product}`
  const pending = new Set(flat.placeJobs.filter(j => j.follow || j.solver || j.fixed.some(v => v === null)).map(j => j.fp.ref))
  const byRef = new Map(source.footprints.map(fp => [fp.ref, [] as Item[]]))
  const loose: Item[] = []
  const order: Order = { refs: source.footprints.map(fp => fp.ref), items: [] }
  for (const item of source.items) {
    const group = item.ref === undefined ? undefined : byRef.get(item.ref)
    const list = group ?? loose
    order.items.push({ owner: group ? item.ref! : null, index: list.length })
    list.push(item)
  }
  const { items: _, footprints: __, ...declaration } = source
  input('explicit/declaration', declaration)
  const { bbox: _bbox, title: _title, rev: _rev, stats: _stats, ...routing } = declaration
  input('explicit/routing-declaration', routing)
  input('explicit/order', order)
  input('explicit/refs', order.refs)
  input('explicit/drawings', loose.map(drawing))
  for (const fp of source.footprints) {
    const items = byRef.get(fp.ref)!
    const local = new Map(items.map((it, i) => [it.id, i]))
    const { at, rot, side, pads, ...rest } = fp
    input(refKey(fp.ref, 'pose-input'), { at, rot, side, pending: pending.has(fp.ref) } satisfies Pose)
    input(refKey(fp.ref, 'drawing-input'), { footprint: { ...rest, pads: pads.flatMap(id => (local.has(id) ? [local.get(id)!] : [])) }, items: items.map(drawing) } satisfies Part)
    define<Placed | null>(refKey(fp.ref, 'geometry'), ctx => {
      const pose = ctx.read<Pose>(refKey(fp.ref, 'pose-input'))
      return pose.pending ? null : { ...ctx.read<Part>(refKey(fp.ref, 'drawing-input')), pose }
    })
  }

  // Forks and route-point aliases share interpreter state. Independent requests need only their own endpoint geometry.
  const groups = routeGroups(flat)
  for (const group of groups) {
    const key = `explicit/manual-copper/${group.key}`
    const program = canon([group.jobs, flat.autoroute], part => flat.partRefs.get(part as Parameters<typeof flat.partRefs.get>[0]))
    const pointIds = group.jobs.map(j =>
      [j.from, j.to, j.root, j.pair?.fromN, j.pair?.toN].map(p => (p && typeof p === 'object' && 'route' in p ? ROUTE_IDS.get(p.route as object) : null)),
    )
    input(`${key}/program`, [program.text, pointIds, program.fns ? sourceRevision : null])
    define<Drawing[]>(key, ctx => {
      ctx.read(`${key}/program`)
      const board = materialize(ctx, group.refs, true)
      PART_REFS.set(board, flat.partRefs)
      const before = board.items.length
      planRoutes(board, group.jobs, flat.autoroute, { explicit: true })
      return board.items.slice(before).map(drawing)
    })
    // Opaque functions can close over arbitrary evaluated state; their textual body is not a complete dependency key.
    if (program.fns && !sourceRevision) graph.invalidate(key)
  }
  input(
    'explicit/route-groups',
    groups.map(g => g.key),
  )
  define<Drawing[]>('explicit/manual-copper', ctx => ctx.read<string[]>('explicit/route-groups').flatMap(key => ctx.read<Drawing[]>(`explicit/manual-copper/${key}`)))
  for (const key of owned.get(graph) ?? []) if (!keys.has(key)) graph.remove(key)
  owned.set(graph, keys)
  const board = materialize(graph)
  for (const item of graph.read<Drawing[]>('explicit/manual-copper')) board.items.push(immutable({ ...clone(item), id: board.items.length + 1 } as Item))
  PART_REFS.set(board, flat.partRefs)
  mintUids(board)
  board.bbox = board.outline.length ? bbox(board.outline) : bbox(points(board))
  board.stats = { tracks: 0, vias: 0, pads: 0, zones: 0, footprints: board.footprints.length, nets: board.nets.length }
  for (const item of board.items) {
    if (item.kind === 'track') board.stats.tracks++
    else if (item.kind === 'via') board.stats.vias++
    else if (item.kind === 'pad') board.stats.pads++
    else if (item.kind === 'zone') board.stats.zones++
  }
  return board

  function materialize(ctx: { read<T>(key: string): T }, refs?: Set<string>, routing = false): Board {
    const order: Order = refs ? { refs: ctx.read<string[]>('explicit/refs').filter(ref => refs.has(ref)), items: [] } : ctx.read<Order>('explicit/order')
    const parts = new Map(order.refs.map(ref => [ref, ctx.read<Placed | null>(refKey(ref, 'geometry'))]))
    if (refs) for (const [ref, part] of parts) if (part) order.items.push(...part.items.map((_, index) => ({ owner: ref, index })))
    const loose = refs ? [] : ctx.read<Drawing[]>('explicit/drawings')
    const items: Item[] = []
    const ids = new Map<string, number>()
    for (const row of order.items) {
      const item = row.owner === null ? loose[row.index] : parts.get(row.owner)?.items[row.index]
      if (!item) continue
      const id = items.length + 1
      ids.set(JSON.stringify([row.owner, row.index]), id)
      items.push(immutable({ ...clone(item), id } as Item))
    }
    const footprints = order.refs.flatMap(ref => {
      const part = parts.get(ref)
      if (!part) return []
      const { pending: _, ...pose } = clone(part.pose)
      return [{ ...clone(part.footprint), ...pose, pads: part.footprint.pads.flatMap(i => (ids.has(JSON.stringify([ref, i])) ? [ids.get(JSON.stringify([ref, i]))!] : [])) }]
    })
    const declaration: Declaration = routing
      ? {
          ...clone(ctx.read<RoutingDeclaration>('explicit/routing-declaration')),
          title: '',
          rev: '',
          bbox: { x: 0, y: 0, w: 0, h: 0 },
          stats: { tracks: 0, vias: 0, pads: 0, zones: 0, footprints: 0, nets: 0 },
        }
      : clone(ctx.read<Declaration>('explicit/declaration'))
    return { ...declaration, items, footprints }
  }
}

function points(board: Board) {
  return board.items.flatMap(it =>
    it.kind === 'pad'
      ? [it.poly]
      : it.kind === 'track'
        ? [it.pts]
        : it.kind === 'via'
          ? [[it.at]]
          : it.kind === 'zone'
            ? it.outline
            : it.kind === 'graphic'
              ? it.paths
              : [[it.at], ...it.strokes, ...(it.polys ?? []).map(p => p.outer)],
  )
}

/** Only independent, unambiguous requests get an individual identity; everything else keeps the interpreter's coupled semantics. */
function routeGroups(flat: Flat): { key: string; jobs: AutoRouteJob[]; refs?: Set<string> }[] {
  const jobs = byPoints(flat.autoRoutes)
  const identity = (job: AutoRouteJob): string | null =>
    job.route && !/(?:^|\/)route:\d+$/.test(job.route) ? JSON.stringify(['bound', job.route]) : job.src?.hash ? JSON.stringify(['call', job.src.file, job.src.hash]) : null
  const ids = jobs.map(identity)
  const producers = new Set(jobs.flatMap(pointDeps))
  const candidates: ({ key: string; jobs: AutoRouteJob[]; refs: Set<string> } | null)[] = []
  for (const [i, job] of jobs.entries()) {
    const refs = new Set<string>()
    let safe =
      jobs.every(j => j.route) &&
      ids[i] !== null &&
      ids.filter(id => id === ids[i]).length === 1 &&
      !job.whole &&
      !job.pair &&
      job.fork === undefined &&
      job.root === undefined &&
      job.toNet === undefined &&
      !pointDeps(job).length &&
      !producers.has(job.route!) &&
      !job.steps?.some(s => s.op === 'B')
    for (const end of [job.from, job.to]) {
      if (end === undefined) continue
      if (isPinRef(end)) {
        const state = partOf(end.part)
        const ref = state && flat.partRefs.get(state)
        if (ref) refs.add(ref)
        else safe = false
      } else if (typeof end === 'string') {
        try {
          if (!coordString(end)) {
            const dot = end.indexOf('.')
            if (dot > 0) refs.add(end.slice(0, dot))
            else safe = false
          }
        } catch {
          safe = false
        }
      } else if (!Array.isArray(end) && !(end && typeof end === 'object' && 'at' in end)) safe = false
    }
    candidates.push(safe ? { key: ids[i]!, jobs: [job], refs } : null)
  }
  // Keep the coupled interval intact: sorting items by route id would reorder interleaved branches of one route.
  const first = candidates.indexOf(null)
  if (first < 0) return candidates as { key: string; jobs: AutoRouteJob[]; refs: Set<string> }[]
  const last = candidates.lastIndexOf(null)
  return [
    ...(candidates.slice(0, first) as { key: string; jobs: AutoRouteJob[]; refs: Set<string> }[]),
    { key: 'coupled', jobs: jobs.slice(first, last + 1) },
    ...(candidates.slice(last + 1) as { key: string; jobs: AutoRouteJob[]; refs: Set<string> }[]),
  ]
}
