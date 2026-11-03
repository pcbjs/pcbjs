// The board data of the viewer split into the facets a compile streams as its stages end, see docs/viewer.md; free of Node.
import type { StageName } from './plugin.js'
import type { SiteData, SiteFootprint } from './site-data.js'

/** The views of a board page. */
export type DrawingView = '2d' | '3d' | 'sch'
export type ViewName = DrawingView | 'checks'

type Keys<T> = { readonly [K in keyof T]?: 1 }
interface Spec {
  /** its keys of the board data, in the order it holds them */
  keys: Keys<SiteData> | Keys<ModelFacet>
  /** the views that draw it */
  views: readonly ViewName[]
  /** every viewer of the board takes it, whatever it observes: the header, the tabs and the downloads read it */
  every?: true
}

/** Each facet of a board's data: its keys and the views that need it; the compile's stage table names the stages that make it. */
export const FACETS = {
  meta: {
    keys: {
      name: 1,
      title: 1,
      rev: 1,
      copper: 1,
      thickness: 1,
      rules: 1,
      stackup: 1,
      viewBox: 1,
      bbox: 1,
      outline: 1,
      nets: 1,
      footprints: 1,
      airwires: 1,
      sourcingTags: 1,
      generatedAt: 1,
      dev: 1,
      variant: 1,
      keepouts: 1,
      references: 1,
      grids: 1,
      edit: 1,
      repo: 1,
      transient: 1,
      stale: 1,
      staleError: 1,
      draft: 1,
    },
    views: ['2d', '3d', 'sch', 'checks'],
    every: true,
  },
  sch: { keys: { schematic: 1 }, views: ['sch'] },
  layers: {
    keys: { layers: 1, holes: 1, drills: 1, sources: 1, items: 1, routing: 1, routes: 1, carried: 1, placed: 1 },
    views: ['2d', '3d'],
  },
  shapes: { keys: { shapes: 1 }, views: ['3d'] },
  model: { keys: { models: 1 }, views: ['3d'] },
  findings: { keys: { drc: 1, erc: 1, ratsnest: 1, unconnected: 1, stats: 1 }, views: ['2d', '3d', 'sch', 'checks'] },
  fab: { keys: { bom: 1, fab: 1, svgUrl: 1, timings: 1 }, views: [], every: true },
} as const satisfies Record<string, Spec>

export type FacetName = keyof typeof FACETS
export const FACET_NAMES = Object.keys(FACETS) as readonly FacetName[]
type KeyOf<F extends FacetName> = keyof (typeof FACETS)[F]['keys']
type SiteKey<F extends FacetName> = Extract<KeyOf<F>, keyof SiteData>
type SiteFacet = Exclude<FacetName, 'model'>
type Owned = { [F in SiteFacet]: KeyOf<F> }[SiteFacet]

/** The model facet: each footprint's 3D model, in footprint order. */
export interface ModelFacet {
  models: ({ ref: string } & Pick<SiteFootprint, ModelKey>)[]
}
/** The footprint fields the model facet holds. */
const MODEL_KEYS = ['model', 'step', 'mesh'] as const satisfies readonly (keyof SiteFootprint)[]
type ModelKey = (typeof MODEL_KEYS)[number]
/** A footprint as `meta` holds it: its model is the model facet's. */
export type MetaFootprint = Omit<SiteFootprint, ModelKey>
/** Each facet's data, its keys those of the table. */
export type FacetData = {
  [F in FacetName]: F extends 'model'
    ? ModelFacet
    : F extends 'meta'
      ? Omit<Pick<SiteData, SiteKey<F>>, 'footprints'> & { footprints: MetaFootprint[] }
      : Pick<SiteData, SiteKey<F>>
}
export type Facets = { [F in FacetName]?: FacetData[F] }

// every key of the board data in one facet, and no facet key outside it
const covered: Record<Exclude<keyof SiteData, Owned> | Exclude<Owned, keyof SiteData>, never> = {}
void covered

/** The facets a view draws. */
export const facetsOf = (v: ViewName): FacetName[] => FACET_NAMES.filter(f => (FACETS[f].views as readonly ViewName[]).includes(v))
/** The facets every viewer of a board takes. */
export const EVERY: ReadonlySet<FacetName> = new Set(FACET_NAMES.filter(f => 'every' in FACETS[f]))
const OWNER = new Map<string, FacetName>(FACET_NAMES.flatMap(f => Object.keys(FACETS[f].keys).map(k => [k, f] as const)))

/** A facet's data with its keys in the table's order and none undefined, so it hashes the same however it was made. */
export function ordered<F extends FacetName>(f: F, data: FacetData[F]): FacetData[F] {
  const own = data as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(FACETS[f].keys)) if (own[k] !== undefined) out[k] = own[k]
  return out as unknown as FacetData[F]
}

/** What a `?pcb:<facet>` import names: a stream facet, `board` for the views, `poster` for the static SVG, `module` for the browser compile. */
export type ImportFacet = FacetName | 'board' | 'poster' | 'module'
export const IMPORT_FACETS: readonly ImportFacet[] = [...FACET_NAMES, 'board', 'poster', 'module']

/** The `header` export of a facet module: where it came from and the compile that made it. */
export interface FacetHeader {
  entry: string
  board: string
  target: string | null
  facet: ImportFacet
  /** the compile that made it, counted per project or the session's run */
  run: number
  /** its content */
  hash: string
}

/** What a page shows of a board before its facets load. */
export interface BoardSummary {
  name: string
  title: string
  rev: string
  copper: number
  bbox: { x: number; y: number; w: number; h: number }
  /** width over height of the 2D view and of the schematic page */
  aspect: { '2d': number; sch?: number }
  counts: Record<string, number>
}

/** A board for the views of @pcbjs/ui, as `?pcb:board` exports it: its facets as URLs, fetched as a view needs them. */
export interface BoardRef {
  kind: 'pcbjs-board'
  format: 1
  entry: string
  board: string
  target: string | null
  /** the compile that made it; a newer ref has a higher run */
  run: number
  summary: BoardSummary
  /** asset URLs in a build, dev endpoints in dev */
  facets: Partial<Record<FacetName, string>>
  module?: string
  poster: { '2d': string; sch?: string }
  /** a library board: the URL of its GLB, which compose() places */
  model?: string
  /** a library board: the URL of its reference data, what reference() and compose() read */
  reference?: string
  /** served by a dev server, which pushes a new ref on every compile */
  live?: boolean
  /** dev: the live session compiling the board, at `path` on the page's own dev server, and its project's scope in a workspace */
  session?: { path: string; scope: string | null }
}

/** One facet of one board target as a stage left it. */
export interface FacetOut {
  board: string
  target?: string
  facet: FacetName
  /** the stage that ended */
  stage: string
  hash: string
  data: Record<string, unknown>
}

/** A stage of one target as the status stream reports it. */
export interface StageStatus {
  name: StageName
  state: 'running' | 'done' | 'hit'
  ms: number
  target?: string
  units?: [number, number]
}

/** A board target as a page carries it inline, from the prerender, the dev server's module and `pcbjs:boards`: its facets. */
export interface FacetSet {
  board: string
  target: string | null
  facets: Facets
}

/** A board target's data as the facet set a page carries. */
export const facetSet = (site: SiteData): FacetSet => ({ board: site.name, target: site.variant?.name ?? null, facets: splitSite(site) })

/** One board's data as its facets. */
export function splitSite(site: SiteData): { [F in FacetName]: FacetData[F] } {
  const out = Object.fromEntries(FACET_NAMES.map(f => [f, {}])) as Record<FacetName, Record<string, unknown>>
  for (const [k, v] of Object.entries(site)) if (v !== undefined && OWNER.has(k)) out[OWNER.get(k)!][k] = k === 'footprints' ? (v as SiteFootprint[]).map(withoutModel) : v
  const facets = out as unknown as { [F in FacetName]: FacetData[F] }
  for (const f of FACET_NAMES) (facets as Record<FacetName, unknown>)[f] = ordered(f, facets[f])
  facets.model = modelOf(site.footprints)
  return facets
}

/** The model fields a footprint or a model facet entry sets. */
const modelFields = (m: Pick<SiteFootprint, ModelKey>): Pick<SiteFootprint, ModelKey> => Object.fromEntries(MODEL_KEYS.filter(k => m[k]).map(k => [k, m[k]]))

function modelOf(footprints: readonly SiteFootprint[]): ModelFacet {
  return { models: footprints.map(fp => ({ ref: fp.ref, ...modelFields(fp) })) }
}

function withoutModel(fp: SiteFootprint): MetaFootprint {
  const { model: _m, step: _s, mesh: _h, ...rest } = fp
  return rest
}

// the footprints of a meta and a model facet, the same list while both are the same, so a view keyed on them keeps its bodies
const MODELLED = new WeakMap<readonly MetaFootprint[], { model?: ModelFacet; out: SiteFootprint[] }>()
function withModels(fps: readonly MetaFootprint[], model?: ModelFacet): SiteFootprint[] {
  const was = MODELLED.get(fps)
  if (was && was.model === model) return was.out
  const models = new Map((model?.models ?? []).map(m => [m.ref, m]))
  const out = fps.map(fp => {
    const m = models.get(fp.ref)
    return m ? { ...fp, ...modelFields(m) } : fp
  })
  MODELLED.set(fps, { model, out })
  return out
}

/** The board data of the facets held, `meta` required; what is missing reads as empty, the airwires standing in for the ratsnest. */
export function joinSite(f: Facets): SiteData {
  const meta = f.meta!
  const footprints = withModels(meta.footprints, f.model)
  const stats = { tracks: 0, vias: 0, pads: 0, zones: 0, footprints: meta.footprints.length, nets: meta.nets.length }
  return {
    layers: [],
    holes: '',
    drills: [],
    items: [],
    schematic: { parts: [], nets: [], circuits: [] },
    drc: [],
    erc: [],
    ratsnest: meta.airwires ?? [],
    unconnected: 0,
    stats,
    bom: [],
    fab: { url: '', name: '', files: [], status: 'pending' },
    svgUrl: '',
    ...meta,
    footprints,
    ...f.sch,
    ...f.layers,
    ...f.shapes,
    ...f.findings,
    ...f.fab,
  }
}

/** 16 hex over the JSON of a facet, the same in Node and the browser. */
export function facetHash(data: unknown): string {
  const s = JSON.stringify(data) ?? ''
  let a = 0xdeadbeef,
    b = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0')
}
