import type { Child, ResolvedRules as Rules } from '@pcbjs/core/types'
import type { Board, DrcMarker, Graphic, Ring } from '@pcbjs/core/model'
import type { VariantSpec } from '@pcbjs/core/variants'
import { RouteCache, routesDir } from './route-cache.js'
import { routeFindings } from './route-findings.js'
import { flatten, rootBoard, variantsOf, CompileError, PART_REFS, type CompileOptions, type Flat } from './flatten.js'
import { sourcingErc } from './bom.js'
import { modelErc } from './models.js'
import { variantSlug } from '@pcbjs/core/variants'
import { chainRings } from './path.js'
import { area, bbox, centroid, difference, orientRings, polysToRings } from './geom.js'
import { fillZones } from './zones.js'
import { stitchBoard } from './stitch.js'
import { invalidate } from './copper.js'
import { autoroute } from './autoroute.js'
import { connectivity } from './connectivity.js'
import { copperWeightErc, drc, resolveEdgeBand } from './drc.js'
import { silkRefs } from './silk-refs.js'
import { teardrops } from './teardrop.js'
import { resolveReferences } from './reference.js'
import { compileSchematic } from './sch.js'

export { CompileError }
export { routers } from './autoroute.js'
export type { CompileOptions }
export type { RouteProgress } from './autoroute.js'

/** Node tree -> compiled board: items, zone fills, connectivity, DRC. For a board made with variants(), use compileBoards. */
export function compileBoard(root: Child, opts: CompileOptions = {}): Board {
  const node = rootBoard(root)
  if (variantsOf(node)) throw new CompileError(`<PCB ${node.props.name}> has fab variants: use compileBoards(root), which returns one board per target`)
  return pipeline(flatten(node, undefined, opts), opts)
}

/** Node tree -> one compiled board per fab target, in the order of the variants list; a single board when there are none. */
export function compileBoards(root: Child, opts: CompileOptions = {}): Board[] {
  const node = rootBoard(root)
  const targets = variantsOf(node)
  if (!targets) return [pipeline(flatten(node, undefined, opts), opts)]
  if (!targets.length) throw new CompileError(`<PCB ${node.props.name}>: variants needs at least one target`)
  const names = targets.map(t => String(t.name))
  const seen = new Map<string, number>()
  names.forEach((n, i) => {
    const slug = variantSlug(n)
    if (!slug) throw new CompileError(`<PCB ${node.props.name}>: target ${i + 1} name ${JSON.stringify(n)} has no letters or digits`)
    const j = seen.get(slug)
    if (j !== undefined)
      throw new CompileError(
        n === names[j]
          ? `<PCB ${node.props.name}>: targets ${j + 1} and ${i + 1} are both named ${JSON.stringify(n)}; give each target a unique name`
          : `<PCB ${node.props.name}>: targets ${j + 1} and ${i + 1}, ${JSON.stringify(names[j])} and ${JSON.stringify(n)}, share the file name ${slug}; give each target a distinct name`,
      )
    seen.set(slug, i)
  })
  // every target flattens first, so the shared routing knows all their rules
  const flats = targets.map(t => flatten(node, t, opts))
  const routers = sharedRouting(flats, targets, opts)
  return targets.map((t, index) => {
    const board = pipeline(flats[index], opts, routers[index])
    board.variant = { name: names[index], index, names: [...names], ...(t.fab ? { fab: t.fab } : {}) }
    return board
  })
}

/** The route cache of a board, or of one target of it routed on its own: in memory, and on disk when the project has a routes dir. */
function routeCache(f: Flat, opts: CompileOptions, group = ''): RouteCache | null {
  if (opts.routeCache === false) return null
  return new RouteCache(f.name, group, routesDir(opts.routeCache?.dir), opts.routeCache?.draft)
}

/** The board of a flattened design, its outline, bbox and keepouts set, ready to route. */
function prepare(f: Flat): Board {
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
    revision: f.revision,
    copper: f.copper,
    thickness: f.thickness,
    stackup: f.stackup,
    rules: resolveEdgeBand(f.rules, f.partRefs, f.items),
    layers: f.layers,
    nets: [...f.netNames].sort().map((name, i) => ({ id: i + 1, name })),
    items: f.items,
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

/** The strictest of several rule sets: every minimum and clearance at its largest. */
export function strictestRules(sets: Rules[]): Rules {
  const out: Rules = { ...sets[0] }
  for (const r of sets.slice(1)) for (const k of STRICT_KEYS) out[k] = Math.max(out[k], r[k])
  return out
}
const STRICT_KEYS = ['clearance', 'minTrackWidth', 'edgeClearance', 'holeClearance', 'minViaDrill', 'minViaDiameter', 'minAnnularRing', 'minHoleToHole'] as const

/** Route the targets of a design with variants: targets with equal copper count and parameters route once under their strictest rules, the others on their own. */
function sharedRouting(flats: Flat[], targets: VariantSpec[], opts: CompileOptions): ((board: Board) => ReturnType<typeof autoroute>)[] {
  const out: ((board: Board) => ReturnType<typeof autoroute>)[] = flats.map(
    (f, i) => (board: Board) =>
      autoroute(board, f.autoRoutes, f.autoroute, {
        strict: f.strict,
        cache: routeCache(f, opts, flats.length > 1 ? variantSlug(String(targets[i].name)) : ''),
        progress: opts.progress,
      }),
  )
  // with net classes, the classes and route widths too, which an impedance class makes depend on the stackup
  const fns: unknown[] = []
  const key = (f: Flat) =>
    JSON.stringify([f.copper, f.autoroute, ...(Object.keys(f.classes).length ? [f.classes, f.autoRoutes.map(j => j.width ?? null)] : [])], (_, v) =>
      typeof v === 'function' ? `fn${fns.indexOf(v) < 0 ? fns.push(v) - 1 : fns.indexOf(v)}` : v,
    )
  const groups = new Map<string, number[]>()
  flats.forEach((f, i) => {
    if (!f.routeSeparately) groups.set(key(f), [...(groups.get(key(f)) ?? []), i])
  })
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const lead = members[0]
    const rules = strictestRules(members.map(i => flats[i].rules))
    const shared = { targets: members.map(i => String(targets[i].name)), rules: Object.fromEntries(STRICT_KEYS.map(k => [k, rules[k]])) as Partial<Rules> }
    let result: ReturnType<typeof autoroute> | null = null
    for (const i of members) {
      out[i] = (board: Board) => {
        if (!result) {
          const f = flats[lead]
          if (i !== lead) throw new Error('shared routing must start with its lead target')
          result = autoroute(board, f.autoRoutes, f.autoroute, { rules, strict: f.strict, cache: routeCache(f, opts), progress: opts.progress })
          result.report.shared = shared
          return result
        }
        let id = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
        const remap = new Map<number, number>()
        for (const it of result.added) {
          const copy = structuredClone(it)
          remap.set(it.id, id)
          copy.id = id++
          board.items.push(copy)
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
  return out
}

function pipeline(f: Flat, opts: CompileOptions = {}, route?: (board: Board) => ReturnType<typeof autoroute>): Board {
  const board = prepare(f)
  if (f.references?.length) board.references = resolveReferences(f.references, board, opts.references, opts.modelBox)
  const timings = { route: 0, zones: 0, connectivity: 0, drc: 0, erc: 0 }
  let t0 = performance.now()
  const lap = () => {
    const t = performance.now(),
      d = Math.round((t - t0) * 10) / 10
    t0 = t
    return d
  }
  const sch = compileSchematic(board, f.partRefs, f.sch)
  board.schematic = { ...board.schematic, drawing: sch.drawing }
  board.erc = [...board.erc, ...sourcingErc(board), ...modelErc(board), ...copperWeightErc(board), ...sch.findings].sort((a, c) =>
    a.severity === c.severity ? 0 : a.severity === 'error' ? -1 : 1,
  )
  timings.erc = lap()
  // routes run after flatten, so a route declared before the parts it connects still sees them; zones fill after, so pours are never obstacles
  t0 = performance.now()
  const routed = route ? route(board) : autoroute(board, f.autoRoutes, f.autoroute, { strict: f.strict, cache: routeCache(f, opts), progress: opts.progress })
  if (f.autoRoutes.length || routed.report.legs) board.routing = routed.report
  if (routed.pairs?.length) board.pairs = routed.pairs
  if (routed.routes?.length) board.routes = routed.routes
  if (routed.loops?.length) board.loopNets = routed.loops
  timings.route = lap()
  // tuning, necking and rounding reshape tracks after their copper was cached
  for (const it of board.items) if (it.kind === 'track') invalidate(it)
  // teardrops are never cached: the pours clear around them and DRC sees them
  const drops = teardrops(board, f.teardrops, f.routeTeardrops)
  fillZones(board)
  const stitchFindings = f.stitches.length ? stitchBoard(board, f.stitches) : []
  timings.zones = lap()
  const conn = connectivity(board)
  timings.connectivity = lap()
  board.ratsnest = conn.ratsnest
  board.unconnected = conn.unconnected
  // silk refs last, so the ids of everything before them stay as they were
  const refs = silkRefs(board, f.silkRefs)
  if (refs.length) board.erc = [...board.erc, ...refs].sort((a, c) => (a.severity === c.severity ? 0 : a.severity === 'error' ? -1 : 1))
  board.drc = [...drc(board, conn), ...routeFindings(board, routed.failures), ...cutoutFindings(board.outline)]
    .sort((a, c) => (a.severity === c.severity ? 0 : a.severity === 'error' ? -1 : 1))
    .concat(drops, stitchFindings, routed.notes ?? [])
  timings.drc = lap()
  // not enumerable: timings differ run to run, and board.json stays deterministic
  Object.defineProperty(board, 'timings', { value: timings, enumerable: false, writable: true, configurable: true })
  for (const it of board.items) {
    if (it.kind === 'track') board.stats.tracks++
    else if (it.kind === 'via') board.stats.vias++
    else if (it.kind === 'pad') board.stats.pads++
    else if (it.kind === 'zone') board.stats.zones++
  }
  return board
}

/** DRC `cutout-outside`: an Edge.Cuts ring other than the outline that is not wholly inside it, which a fab cannot cut. */
export function cutoutFindings(outline: Ring[]): DrcMarker[] {
  if (outline.length < 2) return []
  const size = (r: Ring) => Math.abs(area([r]))
  const outer = outline.reduce((x, y) => (size(y) > size(x) ? y : x))
  const out: DrcMarker[] = []
  for (const r of outline) {
    if (r === outer) continue
    const past = difference([r], [outer])
    const a = Math.abs(area(polysToRings(past)))
    if (a > 1e-4)
      out.push({
        severity: 'error',
        rule: 'cutout-outside',
        message: `an Edge.Cuts cutout ${a > size(r) - 1e-4 ? 'lies outside' : 'crosses'} the board outline, ${Math.round(a * 100) / 100} mm² of it off the board`,
        at: centroid(past.map(p => p.outer)),
        layer: 'Edge.Cuts',
      })
  }
  return out
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
