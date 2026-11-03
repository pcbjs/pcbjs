// The live board of a dev page: facets in, stale ones and those of compiles an edit made stale dropped, the edit's affected set drawn
// half-opaque with the keystroke tier's sketch over it, and the checks that tell the view fell out of sync with the session; free of Vue
// and the DOM so Node imports it in the tests. See docs/viewer.md.
import { EVERY, FACET_NAMES, facetHash, joinSite, type FacetName, type Facets, type FacetSet } from '@pcbjs/core/site-facets'
import type { SiteData, SiteShapes } from '@pcbjs/core/site-data'
import { joinShapes } from '@pcbjs/core/site-shapes'
import type { Desync, FacetMsg, Invalidate, Observe, Run, StateMsg } from '@pcbjs/core/protocol'

export interface Held {
  run: Run | null
  /** null until asked for, for data that came whole */
  hash: string | null
  data: Record<string, unknown>
}
/** The keystroke tier's layers of the entity being typed, until a facet of a later run redraws the layers. */
export interface Sketch {
  run: Run
  replaces: string[]
  data: Record<string, unknown>
}
export interface LiveBoard {
  key: string
  facets: Partial<Record<FacetName, Held>>
  sketch?: Sketch
  /** the newest run an edit made stale: no facet of it or older is taken */
  edit?: Run
}
export const boardKey = (board: string, target?: string | null) => (target ? `${board}|${target}` : board)
export const keyOfSite = (s: Pick<SiteData, 'name' | 'variant'>) => boardKey(s.name, s.variant?.name)
/** A run's place in the session's order, -1 for none. */
export const runN = (r: Run | null | undefined): number => r ?? -1
export const heldRun = (b: LiveBoard): Run | null => Object.values(b.facets).reduce<Run | null>((a, h) => (runN(h!.run) > runN(a) ? h!.run : a), null)

/** The facets of a board target that came whole, from the page's data or `pcbjs:boards`, hashed only when asked. */
export function liveOf(set: FacetSet, run: Run | null): LiveBoard {
  const facets = Object.entries(set.facets).map(([f, data]) => [f, { run, hash: null, data }])
  return { key: boardKey(set.board, set.target), facets: Object.fromEntries(facets) }
}
export const hashOf = (h: Held): string => (h.hash ??= facetHash(h.data))

/** A board target that came whole at `run` over what is held of it: each facet held older, or missing, taken from it; the meta of a failed compile's stale board always. */
export function mergeLive(h: LiveBoard | undefined, set: FacetSet, run: Run | null): { live: LiveBoard; changed: boolean } {
  const whole = liveOf(set, run)
  if (!h) return { live: whole, changed: true }
  const n = runN(run)
  let changed = false
  for (const f of FACET_NAMES) {
    const was = h.facets[f]
    // a newer run held stays, but with no run on either side the board that came last wins
    const newer = was && runN(was.run) >= n && !(n < 0 && was.run === null)
    if (!whole.facets[f] || (newer && !(f === 'meta' && set.facets.meta?.stale))) continue
    h.facets[f] = whole.facets[f]
    changed = true
  }
  if (h.sketch && h.sketch.run < n) {
    delete h.sketch
    changed = true
  }
  return { live: h, changed }
}

/** The board's data from its facets, the sketch drawn over its layers and its shapes. */
export function siteOfLive(b: LiveBoard): SiteData {
  const site = joinSite(Object.fromEntries(Object.entries(b.facets).map(([f, h]) => [f, h!.data])) as Facets)
  const d = b.sketch?.data as Partial<SiteData> | undefined
  if (!d) return site
  const svg = new Map((d.layers ?? []).map(l => [l.id, l.svg]))
  return {
    ...site,
    layers: site.layers.map(l => (svg.has(l.id) ? { ...l, svg: l.svg + svg.get(l.id) } : l)),
    items: [...(site.items ?? []), ...(d.items ?? [])],
    ...(site.shapes && d.shapes ? { shapes: withSketch(site.shapes, d.shapes) } : {}),
  }
}

// the shapes of the board with those of its sketch, the same while both are, so the 3D view rebuilds only when either changes
const SKETCHED = new WeakMap<SiteShapes, { sketch: SiteShapes; out: SiteShapes }>()
function withSketch(board: SiteShapes, sketch: SiteShapes): SiteShapes {
  const was = SKETCHED.get(board)
  if (was?.sketch === sketch) return was.out
  const out = joinShapes(board, sketch)
  SKETCHED.set(board, { sketch, out })
  return out
}

/** A facet in: the board's data when it took it, `dropped` when older than the one of its kind the board holds, `bad` when its data is not what its hash says. */
export function takeFacet(boards: Map<string, LiveBoard>, m: FacetMsg): { site: SiteData | null; dropped?: boolean; bad?: boolean } {
  const key = boardKey(m.board, m.target)
  let b = boards.get(key)
  const n = m.run
  // a compile an edit made stale: never applied, whatever reached the page before the cancel did
  if (b && (n <= runN(b.edit) || n < runN(m.partial ? b.sketch?.run : b.facets[m.facet]?.run))) return { site: null, dropped: true }
  const hash = facetHash(m.data)
  if (hash !== m.hash) return { site: null, bad: true }
  if (!b) boards.set(key, (b = { key, facets: {} }))
  if (m.partial) b.sketch = { run: m.run, replaces: m.partial.replaces, data: m.data }
  else {
    // the same content keeps the data held, so what a view built from it stands
    const was = b.facets[m.facet]
    b.facets[m.facet] = { run: m.run, hash, data: was?.hash === hash ? was.data : m.data }
    if (m.facet === 'layers' && b.sketch && b.sketch.run < n) delete b.sketch
  }
  return { site: b.facets.meta ? siteOfLive(b) : null }
}

/** An invalidate in: the board's facets of compiles up to its `edit` are stale from now on. */
export function takeInvalidate(boards: Map<string, LiveBoard>, m: Invalidate): void {
  const b = boards.get(boardKey(m.board, m.target))
  if (b && m.edit !== undefined && m.edit > runN(b.edit)) b.edit = m.edit
}

/** A committed drag held as drawn: the run of the facets the dragged parts are drawn from, meta for the bodies and the edit nodes and layers for the 2D drawing, at the commit. */
export type Hold = Record<'meta' | 'layers', Run | null>
export const holdOf = (b: LiveBoard | undefined): Hold => ({ meta: b?.facets.meta?.run ?? null, layers: b?.facets.layers?.run ?? null })
/** True while a facet still draws the parts where they were before the commit: no newer than at the commit, nor than an edit's stale runs. */
export const holding = (b: LiveBoard | undefined, h: Hold, f: keyof Hold): boolean => runN(b?.facets[f]?.run) <= Math.max(runN(h[f]), runN(b?.edit))

type Pose = [number, number, number]
/** Where a dragged part is drawn from a facet whose own pose of it is `at`: moved by the drag while the facet is held, else as the facet says. */
export const drawnPose = (at: Pose, u: { delta?: [number, number]; angle?: number } | null, held: boolean): Pose =>
  held && u ? [at[0] + (u.delta?.[0] ?? 0), at[1] + (u.delta?.[1] ?? 0), at[2] + (u.angle ?? 0)] : at

/** The ids of the items a sketch draws, drawn where the sketch puts them and never moved by a held drag. */
export const sketchIds = (b: LiveBoard | undefined): Set<number> => new Set(((b?.sketch?.data.items ?? []) as { id: number }[]).map(it => it.id))

/** What an edit makes stale on the board as drawn, its affected set alone, sketch or not: item ids, parts, nets for the ratsnest and findings, each until the facet that resolves it is newer; `gone` the items a sketch stands in for. */
export interface Stale {
  ids: Set<number>
  refs: Set<string>
  nets: Set<string>
  findings: Set<string>
  gone: Set<number>
}
export const NONE: Stale = { ids: new Set(), refs: new Set(), nets: new Set(), findings: new Set(), gone: new Set() }

export function staleOf(b: LiveBoard | undefined, site: SiteData, inv: Invalidate | undefined): Stale {
  if (!b || (!inv && !b.sketch)) return NONE
  const sketched = sketchIds(b)
  const replaced = new Set(b.sketch?.replaces)
  const gone = new Set<number>()
  for (const it of site.items ?? []) if (it.uid && replaced.has(it.uid) && !sketched.has(it.id)) gone.add(it.id)
  const set = inv ?? seedOf(site, replaced)
  // facets no newer than this still draw the board from before the edit
  const base = inv ? inv.run : b.sketch!.run - 1
  const old = (f: FacetName) => runN(b.facets[f]?.run) <= base
  const uids = new Set([...set.uids, ...replaced])
  const carried = new Set(site.carried ?? [])
  const ids = new Set<number>()
  const layersOld = old('layers')
  for (const it of site.items ?? []) if (it.uid && uids.has(it.uid) && !sketched.has(it.id) && !gone.has(it.id) && (layersOld || carried.has(it.uid))) ids.add(it.id)
  const refs = old('meta') ? new Set(set.refs.filter(r => !r.startsWith('net:'))) : new Set<string>()
  const nets = old('findings') ? new Set(set.refs.filter(r => r.startsWith('net:')).map(r => r.slice(4))) : new Set<string>()
  const findings = old('findings') ? new Set(set.findings) : new Set<string>()
  return { ids, refs, nets, findings, gone }
}

/** What a sketch's `replaces` makes stale until its invalidate comes: those items, their parts and their nets. */
function seedOf(site: SiteData, replaced: ReadonlySet<string>): Pick<Invalidate, 'uids' | 'refs' | 'findings'> {
  const refs = new Set<string>()
  for (const it of site.items ?? [])
    if (it.uid && replaced.has(it.uid)) {
      if (it.ref) refs.add(it.ref)
      if (it.net) refs.add(`net:${it.net}`)
    }
  return { uids: [...replaced], refs: [...refs], findings: [] }
}

/** Whether the session keeps a held facet current for a page that observes `o`; every facet when it said nothing. */
export function observes(o: Observe | null | undefined, facet: FacetName, key: string): boolean {
  if (!o || facet === 'meta') return true
  const [board, target] = key.split('|')
  if (board !== o.board || (o.target !== null && o.target !== (target ?? null))) return false
  return EVERY.has(facet) || o.facets.includes(facet)
}

/** The heartbeat against what the board holds: a facet it holds of the same run with another hash, or an older one with no compile on its way; a facet the page does not observe is not sent, so not compared. */
export function compareState(boards: Map<string, LiveBoard>, st: StateMsg, o?: Observe | null): Desync | null {
  const at = runN(st.run)
  for (const [k, hash] of Object.entries(st.facets)) {
    const i = k.indexOf(':')
    const facet = k.slice(0, i) as FacetName,
      key = k.slice(i + 1)
    const h = boards.get(key)?.facets[facet]
    if (!h || !observes(o, facet, key)) continue
    const n = runN(h.run)
    if (n > at || hashOf(h) === hash) continue
    const [board, target] = key.split('|')
    if (n === at) return { condition: 'hash', board, target: target ?? null, run: h.run, facet }
    if (n < at && !st.pending) return { condition: 'behind', board, target: target ?? null, run: h.run, facet }
  }
  return null
}

/** An invalidate naming a part or item the board does not hold at the run it was computed from. */
export function unknownIn(b: LiveBoard | undefined, site: SiteData | undefined, inv: Invalidate): Desync | null {
  if (!b || !site || b.facets.meta?.run !== inv.run || b.facets.layers?.run !== inv.run) return null
  const refs = new Set(site.footprints.map(f => f.ref))
  const uids = new Set((site.items ?? []).flatMap(it => (it.uid ? [it.uid] : [])))
  const miss = inv.refs.some(r => !r.startsWith('net:') && !refs.has(r)) || (uids.size > 0 && inv.uids.some(u => !uids.has(u)))
  return miss ? { condition: 'unknown', board: inv.board, target: inv.target ?? null, run: inv.run } : null
}

/** Frame numbers gapless from the first one seen; a reconnect starts again. */
export function seqTracker() {
  let last: number | null = null
  return {
    /** null, or the gap: the number expected and the one that came */
    see(seq: number | undefined): { expected: number; got: number } | null {
      if (typeof seq !== 'number') return null
      const gap = last !== null && seq !== last + 1 ? { expected: last + 1, got: seq } : null
      last = seq
      return gap
    },
    reset() {
      last = null
    },
    last: () => last,
  }
}

/** ms within which three incidents make the view give up resyncing quietly */
export const REPEAT_MS = 60_000
export const repeated = (times: number[], now: number) => times.filter(t => now - t < REPEAT_MS).length >= 3
