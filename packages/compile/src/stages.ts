// The stage table and the stage bodies: each stage declared once with what it runs after, the facets it reads and writes and the views it ends; see docs/design.md.
import type { ResolvedRules as Rules } from '@pcbjs/core/internal/types'
import type { AutoRouteJob, Board, DrcMarker, Footprint, Graphic, RouteRecord } from '@pcbjs/core/model'
import type { DepNode, PcbPlugin } from '@pcbjs/core/internal/plugin'
import { variantSlug, type VariantSpec } from '@pcbjs/core/internal/variants'
import type { PartState } from '@pcbjs/core/internal/part'
import { FONT_FILES } from '@pcbjs/core/internal/outline'
import { pulse } from './cancel.js'
import { RouteCache, routesDir, ROUTER_VERSION } from './route-cache.js'
import { tune, tuneDrawings, TUNE_VERSION } from './tune.js'
import { digest, readBlob, sha1, StageStore } from './cache.js'
import { canon, FACET_NAMES, type FacetName } from './facets.js'
import { fillZones, restoreZoneState, zoneState, type ZoneState } from './zones.js'
import { routeFailedFindings } from './route-findings.js'
import { flatten, rootBoard, variantsOf, CompileError, PART_REFS, type CompileOptions, type Flat } from './flatten.js'
import { chainRings } from './path.js'
import { bbox, mul, orientRings, placement } from './geom.js'
import { stitchBoard } from './stitch.js'
import { immutable } from './items.js'
import { autoroute, planRoutes, routeLegs, type AutorouteOutcome, type RoutePlan, type Tuning } from './autoroute.js'
import { ObstacleWorld } from './obstacles.js'
import { connectivity } from './connectivity.js'
import { resolveEdgeBand } from './drc.js'
import { CHECKS, type CheckCtx, type CheckDef } from './checks.js'
import { silkRefs } from './silk-refs.js'
import { teardrops } from './teardrop.js'
import { matePoints, resolveReferences } from './reference.js'
import { compileSchematic } from './sch.js'
import { checkCycles, depGraph } from './deps.js'
import { gridDeps, gridsUsed, unplacedAnchors } from './grids.js'
import { editNodes } from './edit-model.js'
import { copperPatches, moveRefAt, routeHash, routePatches } from './patches.js'
import { applyPlacement, solvePlacement, type Placement } from './placer.js'
import { followersOf, hideFollowers, placeFollowers, splitJobs } from './follow.js'
import { mintUids } from './uid.js'
import { context, peek, settle, unitReads, type Kept, type Open, type Run, type StageCtx, type StageDef, type Target, type UnitDef } from './runner.js'

/** A target's router: the plan the manual copper stage lays, null for a target that copies its group's lead, then the legs; `hidden`: the followers, not placed yet */
export interface Router {
  plan(board: Board, jobs: AutoRouteJob[]): RoutePlan | null
  route(board: Board, plan: RoutePlan | null, hidden?: string[]): AutorouteOutcome
  /** the route memos its tuning commits, for a routing taken from the stage cache */
  memo(): RouteCache | null
}
/** The router of the legs that end on followers, plan and legs in one. */
export type Follow = (board: Board, jobs: AutoRouteJob[]) => AutorouteOutcome

const fail = (msg: string): never => {
  throw new CompileError(msg)
}

/** What the router reads: the board as placed, its rules, copper, pads and parts, and the route jobs; not its drawings, which only followers and a shared group's tuned copper meet. */
const ROUTING: readonly FacetName[] = ['meta', 'rules', 'stackup', 'outline', 'keepouts', 'parts', 'pads', 'copper', 'frame', 'nets', 'netlist', 'routes', 'rest', 'jobs']
const DRAWN: readonly FacetName[] = [...ROUTING, 'drawings']
/** What the pours, teardrops and stitching read: the copper and pads, their rules and finish jobs, and the drawings only when a stitch keeps off silk or courtyards. */
const FILL: readonly FacetName[] = ['meta', 'rules', 'stackup', 'outline', 'keepouts', 'parts', 'pads', 'copper', 'frame', 'nets', 'routes', 'jobs.finish']

/** Every stage of a compile in the order it runs, declared once; docs/design.md has the table. */
export const STAGE_DEFS: readonly StageDef[] = [
  { name: 'evaluate', after: [], span: 'entry', hooks: [], writes: [] },
  {
    name: 'place',
    after: ['evaluate'],
    span: 'targets',
    emits: ['meta', 'layers', 'shapes', 'model'],
    hooks: ['after'],
    writes: FACET_NAMES,
    units: (t, run) => (run.placer && t.flat.placeJobs.some(j => !j.follow) ? [placer] : []),
    run: placeStage,
  },
  {
    name: 'schematic',
    after: ['place'],
    span: 'targets',
    emits: ['sch'],
    reads: ['meta', 'parts', 'pads', 'nets', 'netlist', 'rest', 'jobs.sch'],
    writes: ['sch'],
    phase: 'erc',
    run: schematicStage,
  },
  { name: 'manualCopper', after: ['place'], span: 'target', unit: 'autoroute', reads: ROUTING, writes: ['copper', 'frame'], ready: routers, run: planStage },
  {
    name: 'autoroute',
    after: ['manualCopper'],
    span: 'target',
    unit: 'autoroute',
    slot: 'beforeRoute',
    reads: t => (t.group ? DRAWN : ROUTING),
    writes: ['copper', 'frame', 'routes'],
    phase: 'route',
    own: t => [ROUTER_VERSION, t.group ?? ''],
    keep: t => ({ value: handOff(t.routed) }),
    back: restored,
    run: routeStage,
  },
  {
    name: 'placeFollowers',
    after: ['autoroute'],
    span: 'target',
    unit: 'autoroute',
    reads: t => (t.followers.length ? DRAWN : ROUTING),
    writes: ['parts', 'pads', 'copper', 'drawings', 'rest'],
    phase: 'route',
    run: followerStage,
  },
  {
    name: 'routeFollowers',
    after: ['placeFollowers'],
    span: 'target',
    unit: 'autoroute',
    reads: t => (t.after.length ? DRAWN : ROUTING),
    writes: ['copper', 'frame', 'routes'],
    phase: 'route',
    run: followerRouteStage,
  },
  {
    name: 'tune',
    after: ['routeFollowers'],
    span: 'target',
    emits: ['layers', 'shapes'],
    reads: ROUTING,
    writes: ['copper', 'frame', 'routes'],
    phase: 'route',
    own: t => [TUNE_VERSION, sha1(JSON.stringify(handOff(t.routed))), tuneDrawings(t.board, t.routed?.tuning?.routes ?? [])],
    looks: t => !!t.routeHit,
    run: tuneStage,
  },
  { name: 'patches', after: ['tune'], span: 'target', writes: ['copper', 'frame', 'pads'], run: patchStage },
  { name: 'finish', after: ['patches'], span: 'target', emits: ['layers', 'shapes'], writes: ['copper', 'drawings', 'frame'], units: () => [pours, silk] },
  {
    name: 'checks',
    after: ['finish', 'schematic'],
    span: 'target',
    emits: ['findings'],
    slot: 'beforeChecks',
    writes: ['findings'],
    units: (t, run) => [conn, ...CHECKS.map(c => checkUnit(run, c))],
    run: t => settle(t),
    checks: true,
  },
  {
    name: 'exports',
    after: ['checks'],
    span: 'closed',
    emits: ['fab'],
    reads: FACET_NAMES,
    writes: [],
    own: exportsOwn,
    keep: (t, store) => packExports(store, t.exports),
    back: (t, kept) => {
      const out = unpackExports(t.store!.dir, kept as Record<string, unknown>)
      if (!out) return false
      t.exports = out
    },
    run: exportAll,
  },
]

// ---- evaluate, place and close: what makes a target and ends it ----

/** The stage bodies that make the targets of an entry and close each. */
export function opener(): Open {
  let node: ReturnType<typeof rootBoard>
  let variants: VariantSpec[] | null
  let names: string[] = []
  return {
    evaluate(root, run) {
      FONT_FILES.clear()
      node = rootBoard(root)
      variants = variantsOf(node)
      names = (variants ?? []).map(t => String(t.name))
      checkTargets(String(node.props.name), variants, names)
      const plugins = run.opts.previewBefore ? [] : registered([...(run.opts.plugins ?? []), ...((node.props.plugins as PcbPlugin[] | undefined) ?? [])], run.defs)
      return { plugins, count: run.first ? 1 : (variants?.length ?? 1) }
    },
    place: (run, i) =>
      flattened(run, node, variants?.[i], variants ? { name: names[i], index: i, names: [...names], ...(variants[i].fab ? { fab: variants[i].fab } : {}) } : undefined),
    close,
  }
}

/** Each variant target named, and each name a distinct file slug. */
function checkTargets(name: string, variants: VariantSpec[] | null, names: string[]): void {
  if (variants && !variants.length) throw new CompileError(`<PCB ${name}>: variants needs at least one target`)
  const seen = new Map<string, number>()
  names.forEach((n, i) => {
    const slug = variantSlug(n)
    if (!slug) throw new CompileError(`<PCB ${name}>: target ${i + 1} name ${JSON.stringify(n)} has no letters or digits`)
    const j = seen.get(slug)
    if (j !== undefined)
      throw new CompileError(
        n === names[j]
          ? `<PCB ${name}>: targets ${j + 1} and ${i + 1} are both named ${JSON.stringify(n)}; give each target a unique name`
          : `<PCB ${name}>: targets ${j + 1} and ${i + 1}, ${JSON.stringify(names[j])} and ${JSON.stringify(n)}, share the file name ${slug}; give each target a distinct name`,
      )
    seen.set(slug, i)
  })
}

/** The plugins in registration order, each checked: a name twice, an unknown slot, stage, facet or hook, or a check rule outside the plugin is a compile error. */
function registered(list: PcbPlugin[], defs: readonly StageDef[]): PcbPlugin[] {
  const names = new Set<string>()
  const slots = new Set(defs.flatMap(d => (d.slot ? [d.slot] : [])))
  for (const p of list) {
    const bad = (msg: string): never => fail(`plugin ${JSON.stringify(p?.name)}: ${msg}`)
    if (!p || typeof p.name !== 'string' || !p.name || p.name.includes('/')) bad('needs a name without a slash')
    if (typeof p.version !== 'string') bad('needs a version string')
    if (p.cacheKey !== undefined && typeof p.cacheKey !== 'string') bad('cacheKey must be a string')
    if (p.cache !== undefined && typeof p.cache !== 'boolean') bad('cache must be a boolean')
    if (names.has(p.name)) bad('is registered twice')
    names.add(p.name)
    for (const s of p.stages ?? []) {
      if (!s.name || s.name.includes('/')) bad(`a stage needs a name without a slash, got ${JSON.stringify(s.name)}`)
      if (!slots.has(s.slot)) bad(`stage ${s.name}: slot ${JSON.stringify(s.slot)} is not ${[...slots].join(' or ')}`)
      facets(s.reads, `stage ${s.name}`, bad)
    }
    for (const when of ['before', 'after'] as const)
      for (const k of Object.keys(p[when] ?? {})) {
        const d = defs.find(x => x.name === k)
        if (!d) bad(`${when}.${k} names no stage; the stages are ${defs.map(x => x.name).join(', ')}`)
        if (!(d!.hooks ?? ['before', 'after']).includes(when)) bad(`${when}.${k} has no board to read; the first hook is after.place`)
      }
    for (const c of p.checks ?? []) {
      if (typeof c.rule !== 'string' || !c.rule.startsWith(`${p.name}.`)) bad(`check rule ${JSON.stringify(c.rule)} must start with ${p.name}.`)
      facets(c.reads, `check ${c.rule}`, bad)
    }
  }
  return list
}

function facets(reads: unknown, what: string, bad: (msg: string) => never): void {
  if (!Array.isArray(reads)) bad(`${what} needs reads, the facets it reads`)
  for (const f of reads as unknown[]) if (!FACET_NAMES.includes(f as FacetName)) bad(`${what} reads ${JSON.stringify(f)}, not a facet; the facets are ${FACET_NAMES.join(', ')}`)
}

/** A target as `place` starts it: the design flattened and the board prepared, with its stage store when the compile has a cache. */
function flattened(run: Run, node: ReturnType<typeof rootBoard>, target: VariantSpec | undefined, variant: Board['variant']): Target {
  run.opts.stage?.({ name: 'place', state: 'running', ms: 0, ...(target ? { target: String(target.name) } : {}), ...(variant ? { variant } : {}) })
  const flat = flatten(node, target, run.opts)
  pulse()
  const board = prepare(flat)
  const c = run.cache
  return {
    ...(target ? { name: String(target.name) } : {}),
    flat,
    board,
    deps: { nodes: [], edges: [] },
    followers: followersOf(flat.placeJobs, flat.autoRoutes),
    first: [],
    after: [],
    found: asErc(flat.erc),
    checked: false,
    exports: {},
    stages: [],
    timings: { route: 0, zones: 0, connectivity: 0, drc: 0, erc: 0 },
    decided: new Map(),
    ...(c ? { store: new StageStore(c.dir, board.name, target ? variantSlug(String(target.name)) : '', c.draft) } : {}),
    ...(variant ? { variant } : {}),
  }
}

/** `place:placer`: the auto placement solved, kept by its inputs, the parts as drawn without their sources, the outline and items around them, the jobs and the seed; `place` applies it. */
const placer: UnitDef = {
  name: 'placer',
  reads: [],
  writes: [],
  own: (t, run) => {
    const { board, flat } = t
    const noSrc = (k: string, v: unknown) => (k === 'src' ? undefined : v)
    const { text, fns } = canon([flat.placeJobs.map(j => ({ ...j, fp: j.fp.ref, src: undefined })), flat.placeSeed], st => flat.partRefs.get(st as PartState))
    // a solver or cost function is code, so its key is the evaluated sources
    return [sha1(JSON.stringify([board.footprints, board.items, board.outline], noSrc)), sha1(text), fns ? run.cache!.evaluate : null]
  },
  keep: t => ({ value: t.placement }),
  back: (t, kept) => void (t.placement = kept as Placement),
  run: t => void (t.placement = solvePlacement(t.board, t.flat.placeJobs, t.flat.placeSeed)),
}

/** `place`: the auto placement applied, references resolved, the route patches checked, and the dependency graph and edit nodes built. */
function placeStage(t: Target, ctx: StageCtx): void {
  const { board, flat, followers } = t
  const placed = t.placement ? applyPlacement(board, flat.placeJobs, t.placement) : []
  pulse()
  if (placed.length) board.placed = placed
  if (flat.mates.length) board.mates = matePoints(flat.mates)
  if (ctx.placer && flat.references?.length) board.references = resolveReferences(flat.references, board, ctx.opts.references, ctx.opts.modelBox)
  pulse()
  ctx.report(...routePatches(board, flat.autoRoutes, flat.patches))
  mintUids(board)
  pulse()
  t.deps = depGraph(board, flat.autoRoutes, flat.references, {
    followers: followers.map(f => ({ ref: f.job.fp.ref, route: f.route })),
    solvers: solverNodes(flat),
    reads: t.placement?.reads ?? [],
    grids: gridDeps(flat),
  })
  checkCycles(t.deps)
  unplacedAnchors(flat)
  if (flat.grids.length) board.grids = gridsUsed(flat)
  const edit = editNodes(board, flat)
  if (edit.length) board.edit = edit
  Object.assign(t, splitJobs(board, flat.autoRoutes, followers))
  Object.defineProperty(board, 'deps', { value: t.deps, enumerable: false, writable: true, configurable: true })
}

/** A solver node per part with at:solver and per route with .solver(), for the dependency graph. */
function solverNodes(f: Flat): DepNode[] {
  const parts = f.placeJobs.filter(j => j.solver).map((j): DepNode => ({ kind: 'solver', ref: j.fp.ref, ...(j.src ? { src: j.src } : {}) }))
  const seen = new Set<string>()
  const routes = f.autoRoutes.flatMap((j): DepNode[] =>
    j.solver && j.route && !seen.has(j.route) && seen.add(j.route) ? [{ kind: 'solver', ref: j.route, ...(j.src ? { src: j.src } : {}) }] : [],
  )
  return [...parts, ...routes]
}

/** The board's timings and stats once its stages through checks ran, and its place among the targets. */
function close(t: Target): void {
  const b = t.board
  const r = (v: number) => Math.round(v * 10) / 10
  const timings = Object.fromEntries(Object.entries(t.timings).map(([k, v]) => [k, r(v)]))
  // not enumerable: timings differ run to run, and board.json stays deterministic
  Object.defineProperty(b, 'timings', { value: timings, enumerable: false, writable: true, configurable: true })
  for (const it of b.items) {
    if (it.kind === 'track') b.stats.tracks++
    else if (it.kind === 'via') b.stats.vias++
    else if (it.kind === 'pad') b.stats.pads++
    else if (it.kind === 'zone') b.stats.zones++
  }
  if (t.variant) b.variant = t.variant
  t.snap = null
}

const asErc = (list: DrcMarker[]) => list.map(m => ({ ...m, kind: 'erc' as const }))

/** The board of a flattened design, its outline, bbox and keepouts set, ready to route. */
export function prepare(f: Flat): Board {
  const edges = f.items.filter((i): i is Graphic => i.kind === 'graphic' && i.layer === 'Edge.Cuts')
  // the zone fill and the DRC offset them with Clipper, which reads direction as outer or hole
  const rings = orientRings(
    chainRings(
      edges.flatMap(e => e.paths),
      edges.flatMap(e => e.closed),
    ).rings,
  )
  const board: Board = {
    name: f.name,
    title: f.title,
    rev: f.rev,
    copper: f.copper,
    thickness: f.thickness,
    stackup: f.stackup,
    ...(f.via ? { via: f.via } : {}),
    rules: resolveEdgeBand(f.rules, f.partRefs, f.items),
    layers: f.layers,
    nets: [...f.netNames].sort().map((name, i) => ({ id: i + 1, name })),
    items: f.items.map(immutable),
    footprints: f.footprints,
    outline: rings,
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    drc: [],
    erc: f.erc,
    schematic: f.schematic,
    ratsnest: [],
    unconnected: 0,
    stats: { tracks: 0, vias: 0, pads: 0, zones: 0, footprints: f.footprints.length, nets: f.netNames.size },
    sourcingTags: f.sourcingTags,
  }
  if (f.cpl) board.cpl = f.cpl
  if (f.fabNotes.length) board.fabNotes = [...f.fabNotes]
  if (Object.keys(f.outlineFonts).length) board.outlineFonts = f.outlineFonts
  if (Object.keys(f.classes).length) board.classes = f.classes
  if (f.keepouts.length) board.keepouts = f.keepouts
  board.bbox = rings.length ? bbox(rings) : bbox(allPoints(board))
  PART_REFS.set(board, f.partRefs)
  return board
}

function allPoints(board: Board) {
  const rings: [number, number][][] = []
  for (const it of board.items) {
    if (it.kind === 'pad') rings.push(it.poly)
    else if (it.kind === 'track') rings.push(it.pts)
    else if (it.kind === 'via') rings.push([it.at])
    else if (it.kind === 'zone') rings.push(...it.outline)
    else if (it.kind === 'graphic') rings.push(...it.paths)
    else if (it.kind === 'text') rings.push([it.at], ...it.strokes, ...(it.polys ?? []).map(q => q.outer))
  }
  return rings
}

// ---- schematic and routing ----

/** `schematic`: the drawing and its ERC, a side branch no copper stage reads. */
function schematicStage(t: Target, ctx: StageCtx): void {
  const { board, flat } = t
  const sch = compileSchematic(board, flat.partRefs, flat.sch)
  board.schematic = { ...board.schematic, drawing: sch.drawing }
  ctx.report(...asErc(sch.findings))
}

/** Before the first target routes: each target's router, a shared group's own, and with a cache the routing a group takes from it as a whole. */
function routers(targets: Target[], run: Run): void {
  const variants = targets.length > 1 || targets[0].name !== undefined
  const { routers, groups } = variants
    ? sharedRouting(
        targets.map(t => t.flat),
        targets.map(t => autoPoses(t.board)),
        targets.map(t => t.name!),
        run.opts,
      )
    : { routers: [ownRouter(targets[0].flat, run.opts)], groups: [] }
  targets.forEach((t, i) => {
    t.route = routers[i]
    if (t.after.length) t.follow = followRouter(t.flat, run.opts, t.name !== undefined ? variantSlug(t.name) : '')
  })
  if (!run.cache) return
  for (const g of groups) {
    for (const i of g) targets[i].group = 'shared'
    const key = digest(g.map(i => [targets[i].name ?? null, ...unitReads(run, targets[i], 'autoroute')]))
    for (const i of g) targets[i].group = key
  }
  // a shared group hits only as a whole
  const hits = new Map(targets.map(t => [t, peek(run, t, 'autoroute')]))
  for (const g of groups) if (g.some(i => !hits.get(targets[i]))) for (const i of g) hits.set(targets[i], undefined)
  for (const t of targets) t.decided.set('autoroute', hits.get(t) ?? null)
}

/** `manualCopper`: every route's manual commands in document order, the followers out of sight. */
function planStage(t: Target): void {
  // routes run after flatten, so a route declared before the parts it connects still sees them; zones fill after, so pours are never obstacles
  const back = hideFollowers(t.board, t.followers)
  try {
    t.plan = t.route!.plan(t.board, t.first)
  } finally {
    back()
  }
}

/** `autoroute`: legs, pair layouts, route records and a route-failed error per failed leg; a target of a shared group takes the lead's copper; the followers are out of sight. */
function routeStage(t: Target, ctx: StageCtx): void {
  const { board, flat } = t
  const back = hideFollowers(board, t.followers)
  let routed: AutorouteOutcome
  try {
    routed = t.route!.route(
      board,
      t.plan ?? null,
      t.followers.map(f => f.job.fp.ref),
    )
  } finally {
    back()
  }
  if (flat.autoRoutes.length || routed.report.legs) board.routing = routed.report
  if (routed.pairs?.length) board.pairs = routed.pairs
  t.routed = routed
  reportRouted(board, routed, ctx)
}

/** The router's findings: an error per failed leg, then its notes. */
function reportRouted(board: Board, routed: AutorouteOutcome, ctx: StageCtx): void {
  // the routes as the router handed them to tune, since the board's records exist only after tune
  ctx.report(...routeFailedFindings(board, routed.failures, routed.tuning?.routes ?? []), ...(routed.notes ?? []))
}

/** `placeFollowers`: each at:follow part beside the copper of its route, once. */
function followerStage(t: Target, ctx: StageCtx): void {
  if (!t.followers.length) return
  const { placed, findings } = placeFollowers(t.board, t.followers)
  if (placed.length) t.board.placed = [...(t.board.placed ?? []), ...placed]
  if (t.flat.mates.length) t.board.mates = matePoints(t.flat.mates)
  ctx.report(...findings)
}

/** `routeFollowers`: the legs of the routes that end on a follower, joined to what the first routing left. */
function followerRouteStage(t: Target, ctx: StageCtx): void {
  if (!t.after.length) return
  const more = t.follow!(t.board, t.after)
  more.tuning?.cache?.commit()
  reportRouted(t.board, more, ctx)
  const routed = joined(t.routed!, more)
  t.board.routing = routed.report
  if (routed.pairs?.length) t.board.pairs = routed.pairs
  t.routed = routed
}

/** What the tune stage takes from a routing, as data: the tuning, or the route records a target of a shared group copied, and the nets with loops. */
interface HandOff {
  tuning?: Omit<Tuning, 'cache'>
  routes?: RouteRecord[]
  loops?: string[]
}
const handOff = (routed?: AutorouteOutcome): HandOff => {
  const t = routed?.tuning
  return {
    ...(t ? { tuning: { routes: t.routes, rules: t.rules, next: t.next } } : {}),
    ...(routed?.routes ? { routes: routed.routes } : {}),
    ...(routed?.loops ? { loops: routed.loops } : {}),
  }
}

/** The routing of a hit once its delta is back: the footprints the compile holds kept, every leg counted as cached, the tuning hand-off rebuilt. */
function restored(t: Target, kept: unknown, prior: Board): void {
  if (t.board.footprints !== prior.footprints) keepFootprints(t.board, prior.footprints)
  if (t.board.routing) t.board.routing = allCached(t.board.routing)
  const memo = t.route?.memo() ?? null
  const h = kept as HandOff | undefined
  t.routed = {
    failures: [],
    report: t.board.routing ?? { legs: 0, routed: 0, failed: 0, cached: 0, held: 0, ripped: 0 },
    added: [],
    ...(h?.tuning ? { tuning: { ...h.tuning, cache: memo } } : {}),
    ...(h?.routes ? { routes: h.routes } : {}),
    ...(h?.loops ? { loops: h.loops } : {}),
  }
  t.routeHit = true
}

/** The footprints a restored delta moved, its followers, written back onto the objects the rest of the compile holds. */
function keepFootprints(board: Board, fps: Footprint[]): void {
  const now = new Map(board.footprints.map(f => [f.ref, f]))
  for (const fp of fps) {
    const n = now.get(fp.ref)
    if (!n || (n.at[0] === fp.at[0] && n.at[1] === fp.at[1] && n.rot === fp.rot)) continue
    moveRefAt(fp, mul(placement(n.at[0], n.at[1], n.rot - fp.rot, false), [1, 0, 0, 1, -fp.at[0], -fp.at[1]]), n.rot - fp.rot)
    Object.assign(fp, n)
  }
  board.footprints = fps
}

/** A routing report as a run that took every leg from the route memo tells it. */
export function allCached(r: NonNullable<Board['routing']>): NonNullable<Board['routing']> {
  const out = { ...r, cached: r.legs - r.held, ripped: 0 }
  delete out.rounds
  return out
}

const COUNTS = ['legs', 'routed', 'failed', 'cached', 'held', 'ripped'] as const

/** Two routings of one board as one: counts summed, lists joined, one tuning over both, the first's cache committing the tunes. */
function joined(a: AutorouteOutcome, b: AutorouteOutcome): AutorouteOutcome {
  const report = { ...a.report }
  for (const k of COUNTS) report[k] += b.report[k]
  const solved = (a.report.solved ?? 0) + (b.report.solved ?? 0)
  if (solved) report.solved = solved
  const rounds = Math.max(a.report.rounds ?? 0, b.report.rounds ?? 0)
  if (rounds) report.rounds = rounds
  const list = <T>(x?: T[], y?: T[]) => (x?.length || y?.length ? { v: [...(x ?? []), ...(y ?? [])] } : null)
  const pairs = list(a.pairs, b.pairs),
    loops = list(a.loops, b.loops),
    notes = list(a.notes, b.notes)
  const tb = b.tuning && shifted(b.tuning, a.pairs?.length ?? 0, a.tuning?.next.length ?? 0)
  const tuning =
    a.tuning && tb ? { routes: [...a.tuning.routes, ...tb.routes], rules: a.tuning.rules, cache: a.tuning.cache, next: [...a.tuning.next, ...tb.next] } : (a.tuning ?? tb)
  return {
    failures: [...a.failures, ...b.failures],
    report,
    added: [...a.added, ...b.added],
    ...(pairs ? { pairs: pairs.v } : {}),
    ...(loops ? { loops: [...new Set(loops.v)] } : {}),
    ...(notes ? { notes: notes.v } : {}),
    ...(tuning ? { tuning } : {}),
  }
}

/** The second routing's tuning with its pairs counted after `pairs` pairs and its id counters after `next` counters. */
function shifted(t: Tuning, pairs: number, next: number): Tuning {
  const routes = t.routes.map(r => (r.pair?.laid ? { ...r, pair: { ...r.pair, laid: { ...r.pair.laid, at: r.pair.laid.at + pairs, next: r.pair.laid.next + next } } } : r))
  return { ...t, routes }
}

/** `tune`: meanders and skew bumps; a target of a shared group got its lead's tuned copper. */
function tuneStage(t: Target): void {
  const { board } = t
  const routed = t.routed
  if (!routed) return
  if (routed.tuning) {
    const routes = tune(board, routed.tuning, routed.added)
    if (routes.length) routed.routes = routes
  }
  if (routed.routes?.length) board.routes = routed.routes.map(r => hashed(t, r))
  // after routes, as the board's keys always were
  if (routed.loops?.length) board.loopNets = routed.loops
  const memo = routed.tuning?.cache
  if (!memo) return
  if (t.routeHit) memo.keepLegs()
  memo.commit()
}

/** `patches`: the copper operations on the tuned board, a warning per stale one. */
function patchStage(t: Target, ctx: StageCtx): void {
  if (!t.flat.patches.length) return
  ctx.report(...copperPatches(t.board, t.flat.patches))
}

/** A route record with the hash its hold or reroute patch names. */
function hashed(t: Target, r: NonNullable<Board['routes']>[number]): NonNullable<Board['routes']>[number] {
  const hash = routeHash(
    t.board,
    t.flat.autoRoutes.filter(j => j.route === r.id),
  )
  return hash ? { ...r, hash } : r
}

/** The route memos of a board, or of one target of it routed on its own: in memory, and on disk when the project has a cache dir. */
function routeCache(f: Flat, opts: CompileOptions, group = ''): RouteCache | null {
  if (opts.cache === false) return null
  return new RouteCache(f.name, group, routesDir(opts.cache?.dir), opts.cache?.draft)
}

/** A target routed on its own, its memos under `group`. */
function ownRouter(f: Flat, opts: CompileOptions, group = ''): Router {
  return {
    plan: (board, jobs) => planRoutes(board, jobs, f.autoroute, { strict: f.strict }),
    route: (board, plan, hidden) =>
      routeLegs(plan!, new ObstacleWorld(board, plan!.rules), {
        ...(hidden?.length ? { hidden } : {}),
        strict: f.strict,
        cache: routeCache(f, opts, group),
        progress: opts.progress,
      }),
    memo: () => routeCache(f, opts, group),
  }
}

/** The router of the legs that end on followers, its memos in a group of their own. */
function followRouter(f: Flat, opts: CompileOptions, group: string): Follow {
  return (board, jobs) => autoroute(board, jobs, f.autoroute, { strict: f.strict, cache: routeCache(f, opts, group ? `${group}-follow` : 'follow'), progress: opts.progress })
}

/** The strictest of several rule sets: every minimum and clearance at its largest. */
export function strictestRules(sets: Rules[]): Rules {
  const out: Rules = { ...sets[0] }
  for (const r of sets.slice(1)) for (const k of STRICT_KEYS) out[k] = Math.max(out[k], r[k])
  return out
}
const STRICT_KEYS = ['clearance', 'minTrackWidth', 'edgeClearance', 'holeClearance', 'minViaDrill', 'minViaDiameter', 'minAnnularRing', 'minHoleToHole'] as const

/** Where the auto placement put each part, exact, which a shared routing must agree on. */
function autoPoses(board: Board): unknown[] {
  const fps = new Map(board.footprints.map(f => [f.ref, f]))
  return (board.placed ?? []).map(p => {
    const fp = fps.get(p.ref)
    return [p.ref, fp?.at ?? null, fp?.rot ?? null, fp?.side ?? null]
  })
}

/** Route the targets of a design with variants: targets with equal copper count and parameters route once under their strictest rules, the others on their own; `placed` each target's auto placements, so targets placed apart never share legs. */
function sharedRouting(flats: Flat[], placed: unknown[][], names: string[], opts: CompileOptions): { routers: Router[]; groups: number[][] } {
  const out: Router[] = flats.map((f, i) => ownRouter(f, opts, flats.length > 1 ? variantSlug(names[i]) : ''))
  // with net classes, the classes and route widths too, which an impedance class makes depend on the stackup
  const fns: unknown[] = []
  const key = (f: Flat, i: number) =>
    JSON.stringify([f.copper, f.via ?? null, f.autoroute, placed[i], ...(Object.keys(f.classes).length ? [f.classes, f.autoRoutes.map(j => j.width ?? null)] : [])], (_, v) =>
      typeof v === 'function' ? `fn${fns.indexOf(v) < 0 ? fns.push(v) - 1 : fns.indexOf(v)}` : v,
    )
  const groups = new Map<string, number[]>()
  flats.forEach((f, i) => {
    if (!f.routeSeparately) groups.set(key(f, i), [...(groups.get(key(f, i)) ?? []), i])
  })
  const many = [...groups.values()].filter(m => m.length > 1)
  for (const members of many) {
    const lead = members[0]
    const rules = strictestRules(members.map(i => flats[i].rules))
    const shared = { targets: members.map(i => names[i]), rules: Object.fromEntries(STRICT_KEYS.map(k => [k, rules[k]])) as Partial<Rules> }
    let result: AutorouteOutcome | null = null
    let leadBoard: Board | null = null
    const f = flats[lead]
    for (const i of members) {
      out[i] = {
        plan: (board, jobs) => (i === lead ? planRoutes(board, jobs, f.autoroute, { rules, strict: f.strict }) : null),
        route: (board, plan) => copied(board, plan),
        memo: () => (i === lead ? routeCache(f, opts) : null),
      }
      const copied = (board: Board, plan: RoutePlan | null): AutorouteOutcome => {
        if (!result) {
          if (i !== lead || !plan) throw new Error('shared routing must start with its lead target')
          result = routeLegs(plan, new ObstacleWorld(board, plan.rules), { strict: f.strict, cache: routeCache(f, opts), progress: opts.progress })
          result.report.shared = shared
          leadBoard = board
          return result
        }
        // the lead's items as its later stages left them, tuned
        const now = new Map(leadBoard!.items.map(it => [it.id, it]))
        let id = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
        const remap = new Map<number, number>()
        for (const it of result.added) {
          remap.set(it.id, id)
          board.items.push(immutable({ ...structuredClone(now.get(it.id) ?? it), id: id++ }))
        }
        const failures = result.failures.map(x => ({ ...x, blockers: x.blockers.map(b => remap.get(b) ?? b) }))
        return {
          failures,
          report: { ...result.report, shared },
          added: [],
          ...(result.pairs ? { pairs: structuredClone(result.pairs) } : {}),
          ...(result.routes ? { routes: structuredClone(result.routes) } : {}),
          ...(result.loops ? { loops: [...result.loops] } : {}),
          ...(result.notes ? { notes: result.notes.map(n => ({ ...structuredClone(n), items: n.items?.map(b => remap.get(b) ?? b) })) } : {}),
        }
      }
    }
  }
  return { routers: out, groups: many }
}

// ---- finish ----

/** `finish:pours`: teardrops, the zone fills and stitching vias, with the zone state the thermal check reads kept beside the delta. */
const pours: UnitDef = {
  name: 'pours',
  reads: t => (t.flat.stitches.some(j => j.silk || j.courtyard) ? [...FILL, 'drawings'] : FILL),
  writes: ['copper', 'frame'],
  phase: 'zones',
  keep: t => ({ value: zoneState(t.board) }),
  back: (t, kept) => restoreZoneState(t.board, kept as ZoneState),
  run: (t, ctx) => {
    const { board, flat } = t
    ctx.report(...teardrops(board, flat.teardrops, flat.routeTeardrops))
    fillZones(board, undefined, ctx.progress)
    if (flat.stitches.length) ctx.report(...stitchBoard(board, flat.stitches))
  },
}

/** `finish:silk`: each part's reference placed on its silk, clear of pads, other silk and the edge. */
const silk: UnitDef = {
  name: 'silk',
  reads: ['meta', 'rules', 'outline', 'parts', 'pads', 'drawings', 'frame', 'jobs.finish'],
  writes: ['drawings', 'frame'],
  phase: 'zones',
  run: (t, ctx) => ctx.report(...asErc(silkRefs(t.board, t.flat.silkRefs))),
}

// ---- checks ----

/** `checks:connectivity`: the ratsnest and the unconnected count, the connectivity the copper checks share made once. */
const conn: UnitDef = {
  name: 'connectivity',
  reads: CHECKS.find(c => c.rule === 'clearance')!.reads,
  writes: ['findings'],
  phase: 'connectivity',
  run: t => {
    const c = connOf(t)
    t.board.ratsnest = c.ratsnest
    t.board.unconnected = c.unconnected
  },
}

const CONN = new WeakMap<Board, ReturnType<typeof connectivity>>()
const connOf = (t: Target) => {
  let c = CONN.get(t.board)
  if (!c) CONN.set(t.board, (c = connectivity(t.board)))
  return c
}

/** A built-in check as a unit of the checks stage, reporting what it finds. */
function checkUnit(run: Run, c: CheckDef): UnitDef {
  return {
    name: c.rule,
    reads: c.reads,
    writes: [],
    phase: c.kind ?? 'drc',
    run: (t, ctx) => {
      const own: CheckCtx = { ...context(run, t, `checks:${c.rule}`), conn: () => connOf(t), jobs: t.flat.autoRoutes }
      ctx.report(...c.run(t.board, own))
    },
  }
}

// ---- exports ----

/** The exports' keys: every format's, and what each reads from files; null when a format has none. */
function exportsOwn(t: Target, run: Run): unknown {
  const c = run.cache
  if (!c?.exports) return null
  return [c.exports, (run.opts.exports ?? []).map(e => e.inputs?.(t.board) ?? null)]
}

/** `exports`: each format in order, a cancel point between them. */
function exportAll(t: Target, ctx: StageCtx): void {
  for (const e of ctx.opts.exports ?? []) {
    pulse()
    t.exports[e.name] = e.run(t.board, t.exports)
  }
}

/** The exports with each binary one stored as a blob of its own and named in its place. */
function packExports(store: StageStore, exports: Record<string, unknown>): Kept {
  const blobs: string[] = []
  const value = Object.fromEntries(
    Object.entries(exports).map(([k, v]) => {
      if (!(v instanceof Uint8Array)) return [k, v]
      const h = store.putBlob(v)
      blobs.push(h)
      return [k, { $blob: h }]
    }),
  )
  return { value, blobs }
}

/** The stored exports with their blobs read back; null when one is gone. */
export function unpackExports(dir: string | null, kept: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(kept)) {
    const h = (v as { $blob?: unknown } | null)?.$blob
    if (typeof h !== 'string') out[k] = v
    else if (!(out[k] = readBlob(dir, h))) return null
  }
  return out
}
