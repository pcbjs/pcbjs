import type { Board, DrcMarker, Footprint, Item, Net, PairInfo, RouteRecord } from './model.js'
import type { Src } from './types.js'

/** The built-in stages of a compile, in the order they run; see docs/design.md. */
export type StageName =
  'evaluate' | 'manual' | 'place' | 'schematic' | 'manualCopper' | 'autoroute' | 'placeFollowers' | 'routeFollowers' | 'tune' | 'patches' | 'finish' | 'checks' | 'exports'
/** Where a plugin stage runs: after manual copper and before the router, or after finish and before the checks. */
export type Slot = 'beforeRoute' | 'beforeChecks'
/** A part of the board between two stages, each with its own content hash: a cached stage keys on the facets it reads, so `reads` lists them; see docs/plugins.md. */
export type Facet =
  | 'meta'
  | 'rules'
  | 'stackup'
  | 'outline'
  | 'keepouts'
  | 'parts'
  | 'pads'
  | 'copper'
  | 'drawings'
  | 'frame'
  | 'nets'
  | 'netlist'
  | 'routes'
  | 'findings'
  | 'edit'
  | 'plugins'
  | 'stats'
  | 'sch'
  | 'rest'
  | 'jobs'
  | 'jobs.finish'
  | 'jobs.sch'
  | 'models'
/** What a caller of compile wants: the stages run are those these need, transitively. */
export type View = import('./site-facets.js').FacetName

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type DeepReadonly<T> = T extends (...a: any[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** An item a delta adds: the compiler gives it its id and uid. */
export type NewItem = DistributiveOmit<Item, 'id' | 'uid'>
/** A finding a plugin reports, a DRC one unless `kind` says ERC. */
export type FindingInput = DrcMarker & { kind?: 'drc' | 'erc' }

/** What a plugin stage or hook returns; the compiler applies it, the stage never mutates its input. */
export interface StageDelta {
  add?: NewItem[]
  /** item uids, `item:<12 hex>` */
  remove?: string[]
  replace?: { uid: string; item: NewItem }[]
  routes?: RouteRecord[]
  findings?: FindingInput[]
  /** carried on the board under `plugins[name]` */
  data?: Record<string, Json>
}

/** One node of the placement dependency graph, see DepGraph. */
export interface DepNode {
  kind: 'part' | 'grid' | 'route' | 'follower' | 'solver' | 'reference'
  ref: string
  src?: Src
}
/** What must be placed or routed before what: an edge runs from the dependent to what it depends on. */
export interface DepGraph {
  nodes: DepNode[]
  edges: [from: number, to: number, why: string][]
}

/** What `ctx.resolve` finds: a part, a pad as `R1/2`, a net as `net:VCC`, a route as `route:3`, a pair, an item by uid or a finding by id. */
export type Entity = Footprint | Item | Net | RouteRecord | PairInfo | DrcMarker

export interface StageContext {
  board: string
  target?: string
  /** the running stage, `<plugin>/<stage>` for a plugin's */
  stage: string
  resolve(ref: string): Entity | null
  /** one value per scope and key for the whole compile */
  memo<T>(scope: string, key: string, make: () => T): T
  /** a line `check --verbose` prints under the stage */
  log(line: string): void
}

/** What a plugin stage, hook or check reads: the board as the stages before left it, with its dependency graph. */
export type StageInput = DeepReadonly<Board & { deps: DepGraph }>
export type Hook = (board: StageInput, ctx: StageContext) => StageDelta | void

export interface PluginStage {
  name: string
  slot: Slot
  reads: Facet[]
  run(board: StageInput, ctx: StageContext): StageDelta
}

export interface PluginCheck {
  /** `<plugin>.<rule>` */
  rule: `${string}.${string}`
  reads: Facet[]
  run(board: StageInput, ctx: StageContext): FindingInput[]
}

/** A compiler plugin, registered in `defineConfig({ plugins })` and `<PCB plugins>`; see docs/plugins.md. */
export interface PcbPlugin {
  name: string
  version: string
  stages?: PluginStage[]
  before?: Partial<Record<StageName, Hook>>
  after?: Partial<Record<StageName, Hook>>
  checks?: PluginCheck[]
  /** Configuration identity, such as JSON.stringify(options); enables caching unless cache is false. */
  cacheKey?: string
  /** Explicitly opt into caching by version and declared reads, or disable caching. Without a key or opt-in, plugins are uncached. */
  cache?: boolean
}

export function definePlugin(p: PcbPlugin): PcbPlugin {
  return p
}
