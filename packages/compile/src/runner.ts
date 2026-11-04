// The stage runner: plans what a compile needs from the stage table, runs each target through it with hooks and plugin stages, and keys, stores and restores each cached unit; see docs/design.md.
import type { Child } from '@pcbjs/core/internal/types'
import type { Board, Item } from '@pcbjs/core/model'
import type { DepGraph, Entity, FindingInput, Hook, PcbPlugin, Slot, StageContext, StageDelta, StageInput, StageName, View } from '@pcbjs/core/internal/plugin'
import type { BoardSpec } from '@pcbjs/core/internal/defaults'
import { boardIndex, resolveRef, RefError } from '@pcbjs/core/ref'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { isPinRef } from '@pcbjs/core/internal/nets'
import { partOf, type PartState } from '@pcbjs/core/internal/part'
import { FONT_FILES } from '@pcbjs/core/internal/outline'
import { platform } from '@pcbjs/core/platform'
import { pulse } from './cancel.js'
import { cacheDir, compileId, digest, dropIndexes, indexName, prune, sha1, writeMeta, StageStore } from './cache.js'
import { applyDelta, canon, delta, FACET_NAMES, fieldsOf, snapshot, type Delta, type FacetName, type Snapshot } from './facets.js'
import { CompileError, ROUTE_IDS, type CompileOptions, type Flat } from './flatten.js'
import { modelFiles } from './models.js'
import { deepFreeze, immutable } from './items.js'
import { mintUids } from './uid.js'
import { sealFindings } from './seal.js'
import type { Exporter, StageEvent, StageTime } from './pipeline.js'

export interface Timings {
  route: number
  zones: number
  connectivity: number
  drc: number
  erc: number
}

/** A finding as a stage reports it; `plugin` names the plugin that reported it. */
export type Found = FindingInput & { plugin?: string }

/** What a stage body reports through. */
export interface StageCtx {
  opts: CompileOptions
  /** the auto placement and references, off for the keystroke tier */
  placer: boolean
  report(...found: Found[]): void
  /** done of total within the stage, for its status */
  progress(done: number, of: number): void
}

/** The facets a step's output depends on, the same for every target or decided by the target. */
export type Reads = readonly FacetName[] | ((t: Target) => readonly FacetName[])

/** What a cached step stores beside the board's delta, with the binary objects it names. */
export interface Kept {
  value: unknown
  blobs?: string[]
}

/** A step the runner caches on its own: a stage, a part of one, or a plugin's stage or check. */
export interface UnitDef {
  name: string
  /** the facets its output depends on, all of them; a step without reads always runs */
  reads?: Reads
  /** the facets it may change; under PCBJS_FREEZE a change to any other throws */
  writes: readonly FacetName[]
  phase?: keyof Timings
  /** what keys it beyond the facets it reads, such as exporter keys and model files; null when it can never be cached */
  own?(t: Target, run: Run): unknown
  /** the plugin whose code it runs, in its key by name and version */
  plugin?: PcbPlugin
  /** what it stores beside the board's delta */
  keep?(t: Target, store: StageStore): Kept
  /** the kept value put back after the delta, on a hit; false, before changing anything, when it no longer fits */
  back?(t: Target, kept: unknown, prior: Board): boolean | void
  run?(t: Target, ctx: StageCtx): void
}

/** One stage, declared once: the stages it runs after, its reads and writes, the views it ends, and its body. */
export interface StageDef extends UnitDef {
  name: StageName
  after: readonly StageName[]
  /** the views the board after it makes final, or redraws */
  emits?: readonly View[]
  /** `entry` once per entry, `targets` for every target before the next stage, `target` each target through its stages in turn, `closed` once its board is closed */
  span: 'entry' | 'targets' | 'target' | 'closed'
  /** the hooks a plugin may set on it, which need a board to read */
  hooks?: readonly ('before' | 'after')[]
  /** the plugin stages of this slot run just before it */
  slot?: Slot
  /** the cached unit it is stored in when several stages store as one, named as the unit */
  unit?: string
  /** steps cached on their own, run in order before its body */
  units?(t: Target, run: Run): UnitDef[]
  /** once with every target before the first runs it */
  ready?(targets: Target[], run: Run): void
  /** the cache is looked up only when it holds */
  looks?(t: Target): boolean
  /** the plugins' checks run at its end, each a unit of its own */
  checks?: true
}

export interface Run {
  opts: CompileOptions
  defs: readonly StageDef[]
  plan: Set<StageName>
  plugins: PcbPlugin[]
  memo: Map<string, unknown>
  freeze: boolean
  cache: CacheRun | null
  /** the auto placement and references, off for the keystroke tier */
  placer: boolean
  /** the first target alone, as the keystroke tier draws it */
  first: boolean
}

/** A compile with stage outputs cached: what keys every stage. */
export interface CacheRun {
  dir: string | null
  draft: boolean
  cid: string
  evaluate: string
  files: Record<string, string>
  entry?: string
  env: string
  defaults: string
  /** the formats' keys, null when one has none and exports always run */
  exports: string | null
}

/** One fab target on its way through the stages. */
export interface Target {
  /** the variant target's name */
  name?: string
  flat: Flat
  board: Board
  deps: DepGraph
  route?: import('./stages.js').Router
  /** the router of the followers' own legs */
  follow?: import('./stages.js').Follow
  plan?: import('./autoroute.js').RoutePlan | null
  routed?: import('./autoroute.js').AutorouteOutcome
  /** the routing came from the stage cache */
  routeHit?: boolean
  /** the parts with at:follow, and the jobs routed before and after they are placed */
  followers: import('./follow.js').Follower[]
  first: import('@pcbjs/core/model').AutoRouteJob[]
  after: import('@pcbjs/core/model').AutoRouteJob[]
  /** every finding a built-in stage or a plugin reported before the checks put them on the board, in report order */
  found: Found[]
  checked: boolean
  exports: Record<string, unknown>
  stages: StageTime[]
  timings: Timings
  /** with a cache: the target's store, the board's facets as they stand, null once a step changed the board, and the facets of what flatten collected */
  store?: StageStore
  snap?: Snapshot | null
  jobs?: Record<string, string>
  /** each model file by path, its sha1 or 'missing', as the compile found them */
  models?: Record<string, string>
  /** a target of a shared routing group: the routing reads of every member */
  group?: string
  /** a unit's lookup made before the target reached it, null for a miss */
  decided: Map<string, Stored | null>
  variant?: Board['variant']
  /** the auto placement, solved or taken from the cache */
  placement?: import('./placer.js').Placement
}

/** The stored output of a cached unit: the board's delta, the findings it reported and what its steps kept. */
export interface Stored {
  delta: Delta
  found: Found[]
  kept?: Record<string, unknown>
}

/** What the runner takes from the stage bodies: the entry evaluated into targets, each target placed and closed. */
export interface Open {
  evaluate(root: Child, run: Run): { plugins: PcbPlugin[]; count: number }
  place(run: Run, i: number): Target
  close(t: Target): void
}

const fail = (msg: string): never => {
  throw new CompileError(msg)
}

/** The stages that make the views in `want` and every stage they run after; every stage when `want` is absent. */
export function planOf(defs: readonly StageDef[], want?: readonly View[], more: readonly StageName[] = []): Set<StageName> {
  const byName = new Map(defs.map(d => [d.name, d]))
  const out = new Set<StageName>()
  const add = (s: StageName) => {
    if (out.has(s)) return
    out.add(s)
    byName.get(s)!.after.forEach(add)
  }
  if (!want) defs.forEach(d => add(d.name))
  else for (const v of want) defs.filter(d => d.emits?.includes(v)).forEach(d => add(d.name))
  more.forEach(add)
  return out
}

/** Every target of the entry through the planned stages; `loaded` the ms the caller took to evaluate it. */
export function runEntry(run: Run, root: Child, open: Open, loaded = 0): Target[] {
  const t0 = performance.now()
  const ev = open.evaluate(root, run)
  run.plugins = ev.plugins
  run.cache = cacheRun(run.opts, run.plugins)
  const evaluated: StageTime = { name: 'evaluate', ms: loaded + performance.now() - t0, ...(run.cache ? { hit: false, key: run.cache.evaluate } : {}) }
  entryEvent(run, 'evaluate', 'done', evaluated.ms)
  const defs = run.defs.filter(d => run.plan.has(d.name))
  const span = (s: StageDef['span']) => defs.filter(d => d.span === s)
  // the first stage across targets makes them: every target places first, so a shared routing knows all their rules
  const [place, ...across] = span('targets')
  const targets = Array.from({ length: ev.count }, (_, i) => placed(run, open, place, i, evaluated))
  try {
    for (const d of across) for (const t of targets) steps(run, t, [d])
    for (const d of defs) d.ready?.(targets, run)
    for (const t of targets) {
      steps(run, t, span('target'))
      open.close(t)
      steps(run, t, span('closed'))
      finalBoard(run, t)
    }
    commit(run, targets, true)
    return targets
  } catch (e) {
    // what finished before a cancel or an error stays, so the next compile reuses it
    commit(run, targets, false)
    throw e
  }
}

/** `place` for one target: flattened by the stage bodies, its cache started, then the stage with its units and hooks, timed from the flatten, its inputs frozen. */
function placed(run: Run, open: Open, place: StageDef, i: number, evaluated: StageTime): Target {
  pulse()
  const t0 = performance.now()
  const t = open.place(run, i)
  t.stages.push(evaluated)
  if (run.cache) startCache(run.cache, t)
  stage(run, t, place)
  const st = t.stages.find(s => s.name === place.name)!
  st.ms = performance.now() - t0
  if (run.cache) placeEntry(run.cache, t, st)
  if (run.freeze) [t.deps, t.flat.autoRoutes, t.flat.stitches].forEach(deepFreeze)
  return t
}

/** Planned stages of one target in table order, consecutive stages of one unit run and stored as one. */
function steps(run: Run, t: Target, defs: StageDef[]): void {
  for (let i = 0; i < defs.length;) {
    const name = defs[i].unit ?? defs[i].name
    let j = i + 1
    while (j < defs.length && (defs[j].unit ?? defs[j].name) === name) j++
    unit(run, t, name, defs.slice(i, j))
    i = j
  }
}

/** A stage or a run of stages stored as one: restored from the cache when its key hits, else run and stored. */
function unit(run: Run, t: Target, name: string, defs: StageDef[]): void {
  const whole = run.defs.filter(d => (d.unit ?? d.name) === name).every(d => run.plan.has(d.name) && d.reads)
  const key = whole ? unitKey(run, t, name, defs, defs) : null
  const out = key && defs.every(d => d.looks?.(t) ?? true) ? lookup(t, name, key) : undefined
  if (out && restore(run, t, defs, out)) {
    hit(run, t, name, key!, defs)
    return
  }
  const before = key ? snap(t) : null
  const from = t.found.length
  const t0 = performance.now()
  for (const d of defs) stage(run, t, d)
  if (key) store(run, t, name, key, defs, before!, from, performance.now() - t0)
}

/** One built-in stage run: its slot's plugin stages, a cancel point, its hooks around its units, its body and the plugins' checks; with units, a hit when every keyed one hit. */
function stage(run: Run, t: Target, d: StageDef): void {
  if (d.slot) slot(run, t, d)
  pulse()
  emit(run, t, d.name, 'running', 0)
  hooks(run, t, 'before', d.name)
  const t0 = performance.now()
  const mark = t.stages.length
  for (const u of d.units?.(t, run) ?? []) part(run, t, d, u)
  if (d.run) body(run, t, d, d)
  if (d.checks) pluginChecks(run, t)
  const ms = performance.now() - t0
  const keyed = d.units ? t.stages.slice(mark).filter(s => s.key) : []
  t.stages.push({ name: d.name, ms, ...(keyed.length ? { hit: keyed.every(s => s.hit) } : {}) })
  if (d.phase) t.timings[d.phase] += ms
  hooks(run, t, 'after', d.name)
  frozen(run, t, d.name)
  emit(run, t, d.name, 'done', ms)
}

/** A step's body: reporting into the target, the uids minted, and under PCBJS_FREEZE every facet it changed checked against its writes. */
function body(run: Run, t: Target, d: StageDef, u: UnitDef): void {
  const was = run.freeze ? snapshot(t.board).facets : null
  pulse()
  u.run!(t, { opts: run.opts, placer: run.placer, report: (...found) => void t.found.push(...found), progress: (done, of) => emit(run, t, d.name, 'running', 0, [done, of]) })
  // a step that writes nothing adds no item, and runs before place mints the first uids
  if (u.writes.length) mintUids(t.board)
  t.snap = null
  pulse()
  if (!was) return
  const now = snapshot(t.board).facets
  const wrote = Object.keys(now).filter(f => now[f] !== was[f] && !u.writes.includes(f as FacetName))
  if (wrote.length) throw new Error(`${u.name} wrote ${wrote.join(', ')}, which its writes do not list`)
}

/** A unit of a stage, `<stage>:<unit>`, cached on its own reads. */
function part(run: Run, t: Target, d: StageDef, u: UnitDef): void {
  const name = `${d.name}:${u.name}`
  const key = u.reads ? unitKey(run, t, name, [u], []) : null
  const out = key ? lookup(t, name, key) : undefined
  if (out && restore(run, t, [u], out)) {
    taken(t, key!)
    t.stages.push({ name, ms: 0, hit: true, key: key! })
    return
  }
  pulse()
  const before = key ? snap(t) : null
  const from = t.found.length
  const t0 = performance.now()
  body(run, t, d, u)
  const ms = performance.now() - t0
  t.stages.push({ name, ms })
  if (u.phase) t.timings[u.phase] += ms
  if (key) store(run, t, name, key, [u], before!, from, ms)
}

/** A unit's key: its name, the compile, its plugins, the hashes of every facet it reads and what it reads beyond them; null without a cache or when it can never hit. */
function unitKey(run: Run, t: Target, name: string, steps: UnitDef[], defs: StageDef[]): string | null {
  const c = run.cache
  if (!c || !t.store) return null
  const plugins = [...new Set([...steps.flatMap(s => (s.plugin ? [s.plugin] : [])), ...inner(run, defs)])]
  if (plugins.some(p => p.cache === false || (p.cacheKey === undefined && p.cache !== true))) return null
  const own = steps.map(s => (s.own ? s.own(t, run) : undefined))
  if (own.some(o => o === null)) return null
  const reads = readsOf(run, t, steps, defs)
  const f = reads.size ? snap(t)!.facets : {}
  return digest([name, c.cid, plugins.map(p => [p.name, p.version, p.cacheKey]), ...[...reads].sort().map(n => `${n}=${f[n]}`), ...own.filter(o => o !== undefined)])
}

/** What a unit reads: its steps' reads, its plugin stages' reads, and every facet when a plugin hooks one of its stages. */
function readsOf(run: Run, t: Target, steps: UnitDef[], defs: StageDef[]): Set<FacetName> {
  if (defs.some(d => run.plugins.some(p => p.before?.[d.name] || p.after?.[d.name]))) return new Set(FACET_NAMES)
  const own = steps.flatMap(s => (typeof s.reads === 'function' ? s.reads(t) : (s.reads ?? [])))
  const slots = defs.flatMap(d => (d.slot ? run.plugins.flatMap(p => (p.stages ?? []).filter(s => s.slot === d.slot).flatMap(s => s.reads as FacetName[])) : []))
  return new Set([...own, ...slots])
}

const unitDefs = (run: Run, name: string): StageDef[] => run.defs.filter(d => (d.unit ?? d.name) === name && run.plan.has(d.name))

/** The facets a unit of stages reads, each as `name=hash`, for a key over several targets. */
export function unitReads(run: Run, t: Target, name: string): string[] {
  const defs = unitDefs(run, name)
  const f = snap(t)!.facets
  return [...readsOf(run, t, defs, defs)].sort().map(n => `${n}=${f[n]}`)
}

/** A unit's stored output for a target before it reaches the unit, as one decision for several targets; undefined for a miss. */
export function peek(run: Run, t: Target, name: string): Stored | undefined {
  const defs = unitDefs(run, name)
  const key = defs.every(d => d.reads) ? unitKey(run, t, name, defs, defs) : null
  return key ? stored(t, key) : undefined
}

/** The plugins whose code runs inside a unit of stages: their hooks and their slot stages. */
function inner(run: Run, defs: StageDef[]): PcbPlugin[] {
  return run.plugins.filter(p => defs.some(d => p.before?.[d.name] || p.after?.[d.name] || (d.slot && p.stages?.some(s => s.slot === d.slot))))
}

/** The stored output a key names: a decision made before the target reached the unit, else the store's. */
function lookup(t: Target, name: string, key: string): Stored | undefined {
  const decided = t.decided.get(name)
  if (decided !== undefined) return decided ?? undefined
  return stored(t, key)
}

/** The stored output under a key, when its object is there and whole. */
export function stored(t: Target, key: string): Stored | undefined {
  const e = t.store!.find(key)
  const out = e ? (t.store!.read(e) as Stored | undefined) : undefined
  return out?.delta ? out : undefined
}

/** A stored output applied: its delta, its findings, then what each step kept; false, and nothing changed, when it does not fit the board. */
function restore(run: Run, t: Target, steps: UnitDef[], s: Stored): boolean {
  const prior = { ...t.board }
  if (!applyDelta(t.board, s.delta, snap(t)!.facets.frame)) return false
  for (const u of steps) if (u.back && u.back(t, s.kept?.[u.name], prior) === false) return false
  t.found.push(...s.found)
  t.snap = null
  return true
}

/** A unit that hit: listed again in the index, each of its stages timed as a hit and frozen, the hit streamed. */
function hit(run: Run, t: Target, name: string, key: string, defs: StageDef[]): void {
  taken(t, key)
  for (const d of defs) t.stages.push({ name: d.name, ms: 0, ...(d.name === name || (defs[0] === d && !defs.some(x => x.name === name)) ? { hit: true, key } : {}) })
  for (const d of defs) {
    frozen(run, t, d.name)
    emit(run, t, d.name, 'hit', 0)
  }
}

/** An entry that hit, listed again in this compile's index. */
const taken = (t: Target, key: string): void => t.store!.hit(t.store!.find(key)!)

/** A unit that ran, stored under its key: the board's delta, the findings it reported since `from` and what its steps keep. */
function store(run: Run, t: Target, name: string, key: string, steps: UnitDef[], before: Snapshot, from: number, ms: number): void {
  const blobs: string[] = []
  const kept: Record<string, unknown> = {}
  for (const u of steps)
    if (u.keep) {
      const k = u.keep(t, t.store!)
      kept[u.name] = k.value
      blobs.push(...(k.blobs ?? []))
    }
  const out: Stored = { delta: delta(before, t.board, snap(t)!), found: t.found.slice(from), ...(Object.keys(kept).length ? { kept } : {}) }
  const e = t.store!.put(name, key, out, ms)
  if (blobs.length) e.blobs = blobs
  const st = [...t.stages].reverse().find(s => s.name === name) ?? t.stages.at(-1)!
  Object.assign(st, { key, hit: false })
  // after the put, so a cancel here keeps the unit's output
  pulse()
}

/** The board's facets as they stand, taken again only after a step changed the board. */
export function snap(t: Target): Snapshot | null {
  if (!t.store) return null
  return (t.snap ??= snapshot(t.board, extraFacets(t)))
}

const extraFacets = (t: Target): Record<string, string> => ({ ...t.jobs, ...(t.models ? { models: sha1(JSON.stringify(t.models)) } : {}) })

/** Under PCBJS_FREEZE, the board fields of every facet no later planned stage writes, deep-frozen once a stage ends. */
function frozen(run: Run, t: Target, name: StageName): void {
  if (!run.freeze) return
  const at = run.defs.findIndex(d => d.name === name)
  const later = new Set(
    run.defs
      .slice(at + 1)
      .filter(d => run.plan.has(d.name))
      .flatMap(d => [...d.writes, ...(d.units?.(t, run) ?? []).flatMap(u => u.writes)])
      .flatMap(f => fieldsOf(t.board, f)),
  )
  for (const k of Object.keys(t.board)) if (!later.has(k) && !OPEN.has(k)) deepFreeze((t.board as any)[k])
}
// what is written after the stages: the findings and plugin data through deltas, the stats as the board closes
const OPEN = new Set(['drc', 'erc', 'ratsnest', 'unconnected', 'plugins', 'stats'])

// ---- hooks and plugins ----

function hooks(run: Run, t: Target, when: 'before' | 'after', name: StageName): void {
  for (const p of run.plugins) {
    const hook: Hook | undefined = p[when]?.[name]
    if (hook) plugged(run, t, p, `${when}:${name}`, ctx => hook(view(run, t), ctx))
  }
}

/** The plugin stages of a stage's slot: inside its unit when it is stored with others, else each a unit of its own on its reads. */
function slot(run: Run, t: Target, d: StageDef): void {
  const alone = !d.unit
  for (const p of run.plugins)
    for (const s of p.stages ?? [])
      if (s.slot === d.slot) {
        pulse()
        if (!alone) plugged(run, t, p, s.name, ctx => s.run(view(run, t), ctx))
        else pluginUnit(run, t, p, s.name, s.reads as FacetName[], ctx => s.run(view(run, t), ctx))
      }
}

/** A plugin stage or check cached on its own reads and the plugin's name and version. */
function pluginUnit(run: Run, t: Target, p: PcbPlugin, name: string, reads: readonly FacetName[], fn: (ctx: StageContext) => StageDelta | void): void {
  const full = `${p.name}/${name}`
  const key = unitKey(run, t, full, [{ name: full, reads, writes: [], plugin: p }], [])
  const out = key ? lookup(t, full, key) : undefined
  if (out && restore(run, t, [], out)) {
    if (t.checked && out.found.length) settle(t)
    taken(t, key!)
    t.stages.push({ name: full, ms: 0, hit: true, key: key! })
    return
  }
  const before = key ? snap(t) : null
  const from = t.found.length
  const t0 = performance.now()
  plugged(run, t, p, name, fn)
  if (key) store(run, t, full, key, [], before!, from, performance.now() - t0)
}

/** The plugins' checks, each a unit, after the built-in findings are sealed. */
function pluginChecks(run: Run, t: Target): void {
  for (const p of run.plugins)
    for (const c of p.checks ?? []) {
      pulse()
      pluginUnit(run, t, p, c.rule, c.reads as FacetName[], ctx => ({ findings: c.run(view(run, t), ctx).map(f => ({ ...f, rule: c.rule })) }))
    }
}

/** Run one plugin stage or hook, timed, and apply its delta. */
function plugged(run: Run, t: Target, p: PcbPlugin, stage: string, body: (ctx: StageContext) => StageDelta | void): void {
  const name = `${p.name}/${stage}`
  const log: string[] = []
  const t0 = performance.now()
  const delta = body(context(run, t, name, log))
  if (delta && typeof (delta as { then?: unknown }).then === 'function') fail(`plugin stage ${name} returned a promise; plugin stages run synchronously`)
  apply(t, p.name, delta)
  mintUids(t.board)
  t.snap = null
  t.stages.push({ name, ms: performance.now() - t0, ...(log.length ? { log } : {}) })
}

/** What a stage, hook or check is given beside the board. */
export function context(run: Run, t: Target, stage: string, log: string[] = []): StageContext {
  return {
    board: t.board.name,
    ...(t.name !== undefined ? { target: t.name } : {}),
    stage,
    resolve: ref => resolve(t.board, ref),
    memo: <T>(scope: string, key: string, make: () => T): T => {
      const k = `${scope}\u0000${key}`
      if (!run.memo.has(k)) run.memo.set(k, make())
      return run.memo.get(k) as T
    },
    log: line => void log.push(line),
  }
}

/** Any reference of the grammar as the model object it names; null when it names nothing or nothing with one, a compile error when it names several. */
function resolve(board: Board, ref: string): Entity | null {
  try {
    const r = resolveRef(boardIndex(board), ref)
    switch (r.kind) {
      case 'part':
        return r.footprint
      case 'pad':
        return r.pad
      case 'net':
        return r.net
      case 'route':
        return r.route
      case 'pair':
        return r.pair
      case 'item':
        return r.item
      case 'finding':
        return r.finding
      default:
        return null
    }
  } catch (e) {
    if (e instanceof RefError && / names several: /.test(e.message)) fail(e.message)
    return null
  }
}

/** What a plugin reads: the live board, or under PCBJS_FREEZE a deep-frozen copy, so a write throws. */
function view(run: Run, t: Target): StageInput {
  if (!run.freeze) return t.board as StageInput
  return deepFreeze({ ...structuredClone(t.board), deps: t.deps }) as StageInput
}

/** A delta applied to the target's board: new arrays, never the old ones written. */
function apply(t: Target, plugin: string, d: StageDelta | void): void {
  if (!d) return
  const b = t.board
  if (d.remove?.length || d.replace?.length) {
    const gone = new Set(d.remove ?? [])
    const swap = new Map((d.replace ?? []).map(r => [r.uid, r.item]))
    b.items = b.items.flatMap(it => (gone.has(it.uid!) ? [] : swap.has(it.uid!) ? [immutable({ ...swap.get(it.uid!), id: it.id } as Item)] : [it]))
  }
  if (d.add?.length) {
    let id = b.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
    b.items = [...b.items, ...d.add.map(it => immutable({ ...it, id: id++ } as Item))]
  }
  if (d.routes?.length) b.routes = [...(b.routes ?? []), ...d.routes]
  if (d.findings?.length) {
    t.found.push(...d.findings.map(f => ({ ...f, plugin })))
    if (t.checked) settle(t)
  }
  if (d.data) b.plugins = { ...b.plugins, [plugin]: { ...b.plugins?.[plugin], ...d.data } }
}

const RANK = { error: 0, warning: 1, info: 2 }
const bySeverity = <T extends { severity: keyof typeof RANK }>(list: T[]) => list.sort((a, c) => RANK[a.severity] - RANK[c.severity])

/** Every finding reported so far onto the board, sealed: of each kind the built-in ones by severity, then the plugins' in the order they came. */
export function settle(t: Target): void {
  const of = (kind: 'drc' | 'erc') => {
    const own = t.found.filter(f => (f.kind ?? 'drc') === kind)
    return [...bySeverity(own.filter(f => !f.plugin)), ...own.filter(f => f.plugin)].map(({ kind: _k, plugin: _p, ...m }) => m)
  }
  t.board.drc = of('drc')
  t.board.erc = of('erc')
  t.checked = true
  sealFindings(t.board, t.name)
  t.snap = null
}

// ---- events ----

export function entryEvent(run: Run, name: StageName, state: StageEvent['state'], ms: number): void {
  run.opts.stage?.({ name, state, ms })
}

function emit(run: Run, t: Target, name: StageName, state: StageEvent['state'], ms: number, units?: [number, number]): void {
  const on = run.opts.stage
  if (!on) return
  const after = state !== 'running'
  on({
    name,
    state,
    ms,
    ...(t.name !== undefined ? { target: t.name } : {}),
    ...(t.variant ? { variant: t.variant } : {}),
    ...(after ? { board: t.board } : {}),
    ...(after && name === 'exports' ? { exports: t.exports } : {}),
    ...(units ? { units } : {}),
  })
}

// ---- the cache ----

function cacheRun(opts: CompileOptions, plugins: PcbPlugin[]): CacheRun | null {
  const c = opts.cache
  if (c === false || !c?.files) return null
  const cid = compileId()
  const env = c.env ?? ''
  const defaults = defaultsKey(opts.defaults ?? null)
  const files = { ...c.files }
  // a draft's text is not what the files hold, so a design function in it never hits
  const evaluate = c.draft ? `draft:${Math.random()}` : digest(['evaluate', cid, env, defaults, Object.entries(files).sort()])
  const list = opts.exports ?? []
  const exports = list.every(e => e.key !== undefined) ? exportsKey(list) : null
  return { dir: cacheDir(c.dir), draft: !!c.draft, cid, evaluate, files, ...(c.entry ? { entry: c.entry } : {}), env, defaults, exports }
}

/** The key of a default layer, as the index records it. */
export const defaultsKey = (spec: BoardSpec | null): string => sha1(canon(spec, () => undefined).text)

/** The key of a list of formats, as the index records it. */
export const exportsKey = (list: readonly Exporter[]): string => digest(list.map(e => [e.name, e.key ?? null]))

/** The target's store, the facets of what flatten collected and its model files, and the evaluate entry. */
function startCache(c: CacheRun, t: Target): void {
  t.store ??= new StageStore(c.dir, t.board.name, t.name !== undefined ? slugOf(t.name) : '', c.draft)
  t.jobs = jobFacets(c, t)
  t.models = hashFiles(modelFilesOf(t.board))
  t.snap = null
  t.store.put('evaluate', c.evaluate, undefined, t.stages[0].ms)
}

/** The place entry, which always runs: keyed on the evaluation, for the index. */
function placeEntry(c: CacheRun, t: Target, st: StageTime): void {
  const key = digest(['place', c.cid, c.evaluate, t.name ?? null])
  t.store!.put('place', key, undefined, st.ms)
  Object.assign(st, { key, hit: false })
}

const slugOf = (name: string): string => variantSlug(name)
const modelFilesOf = (board: Board): string[] => modelFiles(board)

/** The facets of what flatten collected for later stages: the route jobs, the finish jobs and the schematic's. */
function jobFacets(c: CacheRun, t: Target): Record<string, string> {
  const f = t.flat
  const refOf = (st: object) => f.partRefs.get(st as PartState)
  const h = (v: unknown) => {
    const { text, fns } = canon(v, refOf)
    return sha1(fns ? `${text}\0${c.evaluate}` : text)
  }
  const follow = followSpecs(f)
  return {
    jobs: h([f.autoRoutes, f.autoroute, f.strict, f.routeSeparately, ...(follow.length ? [follow] : [])]),
    'jobs.finish': h([f.teardrops, f.routeTeardrops, f.stitches, f.silkRefs]),
    'jobs.sch': h([f.sch ?? null, [...f.partRefs.values()]]),
  }
}

/** What the follower pass reads of each at:follow, refs for the parts and routes it names. */
function followSpecs(f: Flat): unknown[] {
  const refOf = (v: unknown) => {
    const st = partOf(isPinRef(v) ? v.part : v)
    return st ? [f.partRefs.get(st) ?? null, isPinRef(v) ? (v.pad ?? v.pin) : null] : v
  }
  return f.placeJobs.flatMap(j => {
    const w = j.follow
    if (!w) return []
    const route = typeof w.route === 'string' ? w.route : ROUTE_IDS.get(w.route as object)
    return [[j.fp.ref, route ?? null, w.near === undefined ? null : refOf(w.near), w.side ?? null, w.distance ?? null, j.fixed, j.start, j.m, j.flip]]
  })
}

/** The final board under a key over all its facets, so a start whose files all match serves it as it is; only when the last stage was cached. */
function finalBoard(run: Run, t: Target): void {
  const c = run.cache
  const last = run.defs.at(-1)!.name
  if (!c || c.draft || !t.store || !t.stages.filter(s => s.name === last).at(-1)?.key) return
  const f = snap(t)!.facets
  const key = digest(['board', c.cid, ...FACET_NAMES.map(n => `${n}=${f[n]}`)])
  const e = t.store.find(key)
  if (e && t.store.has(e)) return t.store.hit(e)
  t.store.put('board', key, { board: t.board, deps: t.deps }, 0)
}

/** Each target's index: what it ran or hit, and with every stage done the files that let a start serve it; then the prune. */
function commit(run: Run, targets: Target[], done: boolean): void {
  const c = run.cache
  if (!c || c.draft || !c.dir) return
  const complete = done && run.plan.size === run.defs.length && c.exports !== null && run.plugins.length === 0
  targets.forEach((t, i) => {
    if (!t.store) return
    const files = { ...c.files, ...readFiles(t.board), ...t.models }
    t.store.commit({
      order: i,
      targets: targets.length,
      ...(c.entry ? { entry: c.entry } : {}),
      evaluate: c.evaluate,
      env: c.env,
      defaults: c.defaults,
      ...(c.exports ? { exports: c.exports } : {}),
      files,
      complete,
    })
  })
  if (done && c.entry) dropIndexes(c.dir, c.entry, new Set(targets.map(t => indexName(t.board.name, t.name !== undefined ? slugOf(t.name) : ''))))
  writeMeta(c.dir)
  prune(c.dir)
}

/** What the compile read outside the module graph beyond the models, by content: each referenced board's files and the fonts. */
const readFiles = (board: Board): Record<string, string> => hashFiles([...(board.references ?? []).flatMap(r => r.files ?? []), ...FONT_FILES])

function hashFiles(files: readonly string[]): Record<string, string> {
  const p = platform()
  const out: Record<string, string> = {}
  for (const f of files) {
    const bytes = p.read(f)
    out[f] = bytes ? sha1(bytes) : 'missing'
  }
  return out
}
