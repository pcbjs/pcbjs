// The compile's entry points: a node tree, or an entry the caller loads, through the stages of the stage table; see docs/design.md.
import { cancelPoint, CancelledError, pulsed } from './cancel.js'
import type { Child, Src } from '@pcbjs/core/internal/types'
import { beginCompile, endCompile } from '@pcbjs/core/internal/realm'
import type { Board } from '@pcbjs/core/model'
import type { DepGraph, StageName, View } from '@pcbjs/core/internal/plugin'
import { realm } from '@pcbjs/core/internal/realm'
import { platform } from '@pcbjs/core/platform'
import { FACET_NAMES as VIEWS, type StageStatus } from '@pcbjs/core/site-facets'
import { readStored, servable } from './cache.js'
import { connectivity } from './connectivity.js'
import { CompileError, type CompileOptions } from './flatten.js'
import { planOf, runEntry, type Run } from './runner.js'
import { allCached, opener, STAGE_DEFS, unpackExports } from './stages.js'

export type { DepGraph, Facet, Hook, PcbPlugin, Slot, StageContext, StageDelta, StageInput, StageName, View } from '@pcbjs/core/internal/plugin'
export type { StageDef, UnitDef } from './runner.js'
export type { CheckDef } from './checks.js'
export { defaultsKey, exportsKey } from './runner.js'
export { strictestRules } from './stages.js'
export { cutoutFindings } from './checks.js'
export { CancelledError } from './cancel.js'

/** One output format of the `exports` stage, given what the formats before it returned. */
export interface Exporter {
  name: string
  /** what the format reads beyond the board, such as the fab date; the exports stage is cached only when every format has one */
  key?: string
  /** what the format reads from files for this board, such as model meshes by content hash, in the stage key */
  inputs?(board: Board): string
  /** a Uint8Array is stored as a binary object of its own */
  run(board: Board, done: Readonly<Record<string, unknown>>): unknown
}

/** A stage of a compile, or a unit of one: its time, and with a cache its key and whether its output came from the cache. */
export interface StageTime {
  name: string
  ms: number
  hit?: boolean
  key?: string
  log?: string[]
}

/** One fab target compiled: the board, what each exporter returned and the time of every stage that ran. */
export interface CompileResult {
  board: Board
  exports: Record<string, unknown>
  stages: StageTime[]
  /** served from the cache: the files its compile read */
  files?: string[]
}

/** A stage as it starts, ends or is restored from the cache; `board` the board after it, set on `done` and `hit`; no target for evaluate, which runs once per entry. */
export interface StageEvent {
  name: StageName
  state: 'running' | 'done' | 'hit'
  /** ms it took, 0 for a hit or a start */
  ms: number
  target?: string
  board?: Board
  /** the target's place among the board's targets, which the board gets only once its stages ran */
  variant?: Board['variant']
  /** the formats the exports stage returned */
  exports?: Record<string, unknown>
  /** done of total within the stage: zones for finish */
  units?: [number, number]
}

/** A stage event as the status stream reports it. */
export const stageStatus = (e: StageEvent): StageStatus => ({
  name: e.name,
  state: e.state,
  ms: Math.round(e.ms),
  ...(e.target !== undefined ? { target: e.target } : {}),
  ...(e.units ? { units: e.units } : {}),
})

/** The built-in stages in the order they run. */
export const STAGES: readonly StageName[] = STAGE_DEFS.map(d => d.name)

/** The stages a set of views needs, transitively; every stage when `want` is absent. */
export function demanded(want?: readonly View[]): Set<StageName> {
  for (const v of want ?? []) if (!VIEWS.includes(v)) throw new CompileError(`unknown view ${JSON.stringify(v)}; the views are ${VIEWS.join(', ')}`)
  return planOf(STAGE_DEFS, want)
}

/** The views a stage ends, which the board after it makes final or redraws. */
export const emitted = (stage: string): readonly View[] => STAGE_DEFS.find(d => d.name === stage)?.emits ?? []

/** The stage after which a view is final. */
export const endOf = (v: View): StageName => STAGE_DEFS.filter(d => d.emits?.includes(v)).at(-1)!.name

/** Node tree -> one result per fab target, running the stages the views in `opts.want` need. */
export function compileStages(root: Child, given: CompileOptions = {}): CompileResult[] {
  given.stage?.({ name: 'evaluate', state: 'running', ms: 0 })
  return compileRoot(root, given, 0)
}

/** The entry as the caller's loader evaluates it, Vite's in the CLI, with the options the loading decides, such as the files it read and the patches. */
export type Load = () => Promise<{ root: Child; options?: Partial<CompileOptions> }>

/** One result per fab target of an entry the caller loads: the loading is the evaluate stage, timed, cancelled and reported with the others. */
export async function compileLoaded(load: Load, given: CompileOptions = {}): Promise<CompileResult[]> {
  given.stage?.({ name: 'evaluate', state: 'running', ms: 0 })
  const t0 = performance.now()
  const { root, options } = await load()
  if (given.signal?.aborted) throw new CancelledError()
  return compileRoot(root, { ...given, ...options }, performance.now() - t0)
}

function compileRoot(root: Child, given: CompileOptions, loaded: number): CompileResult[] {
  // a newer epoch for the modules evaluated before this compile, also when it ends before place: their next evaluation drops their parts
  endCompile(beginCompile())
  const run = runOf(given, demanded(given.want))
  return pulsed(cancelPoint(run.opts.signal), () => runEntry(run, root, opener(), loaded).map(t => ({ board: t.board, exports: t.exports, stages: t.stages })))
}

/** The keystroke tier's board, docs/design.md: the plan of `meta` and the manual copper, its first target with its uids and the pair centre lines dropped; the placer off and nothing cached. */
export function sketch(root: Child, given: Pick<CompileOptions, 'files' | 'sourceRoot' | 'signal' | 'defaults'> = {}): { board: Board; target?: string } {
  endCompile(beginCompile())
  const run = runOf({ ...given, cache: false }, planOf(STAGE_DEFS, ['meta'], ['manualCopper']), { placer: false, first: true })
  return pulsed(cancelPoint(run.opts.signal), () => {
    const [t] = runEntry(run, root, opener())
    const centres = t.plan?.centres
    if (centres?.size) t.board.items = t.board.items.filter(it => !centres.has(it.id))
    return { board: t.board, ...(t.name !== undefined ? { target: t.name } : {}) }
  })
}

/** Current-source geometry before an error, without routing, checks, plugins or cache output. */
export function previewBefore(root: Child, src: Src, given: Pick<CompileOptions, 'files' | 'sourceRoot' | 'signal' | 'defaults'> = {}): Board[] {
  endCompile(beginCompile())
  const run = runOf({ ...given, previewBefore: src, cache: false }, planOf(STAGE_DEFS, ['meta', 'sch'], ['manualCopper']), { placer: false, first: false })
  return pulsed(cancelPoint(run.opts.signal), () =>
    runEntry(run, root, opener()).map(t => {
      const runs = t.plan?.runs ?? []
      const routes = runs
        .filter(r => r.job.route !== undefined && !r.job.sub && !r.pair && !runs.some(q => q.job.route === r.job.route && (q.legs.length || q.pair)))
        .map(r => ({
          id: r.job.route!,
          ...(r.net !== undefined ? { net: r.net } : {}),
          pts: r.pts,
          ...(r.job.src ? { src: r.job.src } : {}),
          ...(r.job.chain ? { chain: r.job.chain } : {}),
        }))
      const board = { ...t.board, ...(routes.length ? { routes } : {}), drc: [], erc: [] }
      const { ratsnest, unconnected } = connectivity(board)
      return { ...board, ratsnest, unconnected }
    }),
  )
}

function runOf(given: CompileOptions, plan: Set<StageName>, o: { placer: boolean; first: boolean } = { placer: true, first: false }): Run {
  // the default layer resolved once: the realm's when the caller gave none
  const opts = given.defaults !== undefined ? given : { ...given, defaults: realm().defaults }
  return { opts, defs: STAGE_DEFS, plan, plugins: [], memo: new Map(), freeze: platform().env('PCBJS_FREEZE') === '1', cache: null, ...o }
}

/** One result per target from the cache alone, when every file the last compile of the entry read is unchanged; null otherwise. */
export function servedStages(dir: string, entry: string, current: { env: string; exports: string; defaults: string; hashOf: (file: string) => string }): CompileResult[] | null {
  const records = servable(dir, entry, current)
  if (!records) return null
  const out: CompileResult[] = []
  for (const r of records) {
    const b = r.stages.find(s => s.name === 'board')
    const x = r.stages.filter(s => s.name === 'exports').at(-1)
    const fin = b?.out ? (readStored(dir, b.out) as { board: Board; deps: DepGraph } | undefined) : undefined
    const ex = x?.out ? (readStored(dir, x.out) as { kept?: { exports?: Record<string, unknown> } } | undefined) : undefined
    const exports = ex?.kept?.exports ? unpackExports(dir, ex.kept.exports) : null
    if (!fin?.board || !exports) return null
    const board = fin.board
    if (board.routing) board.routing = allCached(board.routing)
    Object.defineProperty(board, 'deps', { value: fin.deps, enumerable: false, writable: true, configurable: true })
    const stages = r.stages.filter(s => s.name !== 'board').map(s => ({ name: s.name, ms: 0, hit: true, key: s.key }))
    out.push({ board, exports, stages, files: Object.keys(r.files!).filter(f => r.files![f] !== 'missing') })
  }
  return out
}
