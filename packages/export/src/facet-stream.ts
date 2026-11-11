// The facets a compile streams as its stages end, see docs/viewer.md; current explicit geometry precedes solved geometry.
// Free of Node: the CLI's compile threads and the browser compile worker stream through it alike.
import type { Board, Item, Zone } from '@pcbjs/core/model'
import { itemRev } from '@pcbjs/core/ref'
import { emitted, type StageEvent } from '@pcbjs/compile/internal/pipeline'
import { FACET_NAMES, facetHash, ordered, splitSite, type FacetData, type FacetName, type FacetOut, type StageStatus } from '@pcbjs/core/site-facets'
import { findingsFacet, layersFacet, metaFacet, modelFacet, schFacet, shapesFacet, siteItems, type ShapedItem, type SiteData, type SiteOptions } from './site-data.js'
import type { MeshBounds } from './models.js'

export type { FacetOut, StageStatus }
export { stageStatus } from '@pcbjs/compile/internal/pipeline'

// the last finished board of each entry and target in this thread, which a rebuild draws until its stages remake it
const LAST = new Map<string, Board>()
const lastKey = (root: string, rel: string, target?: string) => `${root}\0${rel}\0${target ?? ''}`

export function keepLast(root: string, rel: string, boards: Board[]): void {
  for (const b of boards) LAST.set(lastKey(root, rel, b.variant?.name), b)
}

export function facetOut<F extends FacetName>(board: string, target: string | undefined, facet: F, stage: string, data: FacetData[F]): FacetOut {
  const own = ordered(facet, data) as unknown as Record<string, unknown>
  return { board, ...(target !== undefined ? { target } : {}), facet, stage, hash: facetHash(own), data: own }
}

/** Every facet of a finished board's data, as a warm start sends them at once. */
export function siteFacets(site: SiteData, stage = 'exports'): FacetOut[] {
  const parts = splitSite(site)
  return FACET_NAMES.map(f => facetOut(site.name, site.variant?.name, f, stage, parts[f]))
}

/** A stage that ended: the board after it, the board a live rebuild draws, with the last compile's copper it carries, and what the exports stage returned. */
interface Ended {
  board: Board
  drawn: { board: Board; carried: string[] }
  /** the drawn board's items with their rings, made once for the layers and the shapes */
  items: () => ShapedItem[]
  opts: SiteOptions
  exports?: Record<string, unknown>
}
const BUILD: { [F in FacetName]: (e: Ended) => FacetData[F] | null } = {
  meta: e => metaFacet(e.board, e.opts),
  sch: e => schFacet(e.board, e.opts.root),
  layers: e => layersFacet(e.drawn.board, e.opts.root, e.items(), e.drawn.carried),
  shapes: e => shapesFacet(e.drawn.board, e.items()),
  model: e => modelFacet(e.board, e.opts),
  findings: e => findingsFacet(e.board, e.opts.root),
  fab: e => (e.exports?.site ? splitSite(e.exports.site as SiteData).fab : null),
}

/** The facets of each stage that ends, as the stage table's `emits` names them; tune marks carried fills until finish remakes them. */
export function facetStream(root: string, rel: string, dev: boolean, generatedAt: string, out: (f: FacetOut) => void, meshBounds?: MeshBounds): (e: StageEvent) => void {
  return e => {
    if (e.state === 'running' || !e.board) return
    const facets = emitted(e.name)
    if (!facets.length) return
    const target = e.variant?.name ?? e.target
    const prev = LAST.get(lastKey(root, rel, target))
    const drawn = e.name === 'tune' ? carry(e.board, prev, false) : { board: e.board, carried: [] }
    let items: ShapedItem[] | undefined
    const ended: Ended = {
      board: e.board,
      drawn,
      items: () => (items ??= siteItems(drawn.board)),
      opts: { root, dev, generatedAt, variant: e.variant, meshBounds, ...(e.name === 'manual' ? { airwires: false } : {}) },
      exports: e.exports,
    }
    for (const f of facets) {
      const data = BUILD[f](ended)
      if (data) out(facetOut(e.board.name, target, f, e.name, data))
    }
  }
}

/** The board with the last compile's pour fills on its unfilled pours and, with `copper`, its automatic tracks and vias; `carried` their uids. */
export function carry(now: Board, prev: Board | undefined, copper: boolean): { board: Board; carried: string[] } {
  if (!prev) return { board: now, carried: [] }
  const carried: string[] = []
  const fills = new Map(prev.items.flatMap(it => (it.kind === 'zone' && it.uid && it.fill.length ? [[it.uid, it] as const] : [])))
  const items: Item[] = now.items.map(it => {
    const was = it.kind === 'zone' && !it.fill.length && it.uid ? fills.get(it.uid) : undefined
    // a pour whose declared outline changed keeps its uid and draws no old fill
    if (!was || itemRev(was) !== itemRev(it)) return it
    carried.push(was.uid!)
    return { ...(it as Zone), fill: was.fill, ...(was.prims ? { prims: was.prims } : {}) }
  })
  if (copper) {
    const own = new Set(now.items.map(it => it.uid))
    let id = now.items.reduce((m, it) => Math.max(m, it.id), 0)
    for (const it of prev.items)
      if ((it.kind === 'track' || it.kind === 'via') && (it.route || (it.kind === 'via' && it.stitch)) && it.uid && !own.has(it.uid)) {
        items.push({ ...it, id: ++id })
        carried.push(it.uid)
      }
  }
  return carried.length ? { board: { ...now, items }, carried } : { board: now, carried }
}
