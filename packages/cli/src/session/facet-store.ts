// The facets each project holds for its viewers, every board's as the last compile made them, and each one's frame encoded once however
// many viewers take it; see docs/viewer.md and session.md's state synchronisation.
import { EVERY, FACET_NAMES, splitSite, type FacetName } from '@pcbjs/core/site-facets'
import type { FacetMsg, Observe, Run } from '@pcbjs/core/protocol'
import type { Held } from '../project/compiler.js'
import { encode, type Encoded } from './clients.js'

const frames = new WeakMap<FacetMsg, Encoded<'pcbjs:facet'>>()
/** A facet's frame, encoded on first use; a held facet is never changed in place, so its frame stays true. */
export function facetFrame(f: FacetMsg): Encoded<'pcbjs:facet'> {
  let e = frames.get(f)
  if (!e) frames.set(f, (e = encode('pcbjs:facet', f)))
  return e
}

const key = (board: string, target?: string | null) => `${board}|${target ?? ''}`

/** Whether a viewer takes a facet: every board's meta; of the board and target it observes, the facets it names and fab; everything when it never said. */
export function wants(o: Observe | null, f: Pick<FacetMsg, 'board' | 'target' | 'facet'>): boolean {
  if (!o || f.facet === 'meta') return true
  if (o.board !== f.board || (o.target !== null && o.target !== (f.target ?? null))) return false
  return EVERY.has(f.facet) || o.facets.includes(f.facet)
}

/** The facets a project holds per board target, as its viewers should hold them. */
export function facetStore() {
  const held = new Map<string, Map<FacetName, FacetMsg>>()
  return {
    /** Hold a facet; false for one older than the one held, which no viewer gets. */
    put(f: FacetMsg): boolean {
      const k = key(f.board, f.target)
      let m = held.get(k)
      if (!m) held.set(k, (m = new Map()))
      const was = m.get(f.facet)
      if (was && was.run > f.run) return false
      m.set(f.facet, f)
      return true
    },
    /** The finished data of a compile: each facet whose content the viewers do not hold yet, by the hashes its compile thread made; one they hold is held for this run. */
    reconcile(c: Pick<Held, 'site' | 'hashes'>, run: Run): FacetMsg[] {
      const board = c.site.name,
        target = c.site.variant?.name
      const out: FacetMsg[] = []
      let parts: ReturnType<typeof splitSite> | null = null
      for (const name of FACET_NAMES) {
        const hash = c.hashes[name]
        const was = held.get(key(board, target))?.get(name)
        if (!hash) continue
        if (was?.hash === hash) held.get(key(board, target))!.set(name, { ...was, run })
        else
          out.push({
            board,
            ...(target !== undefined ? { target } : {}),
            facet: name,
            stage: 'exports',
            hash,
            data: (parts ??= splitSite(c.site))[name] as unknown as Record<string, unknown>,
            run,
          })
      }
      return out
    },
    /** What a viewer lacks of a board among the facets it observes, by the hashes it holds; every such held facet with `all`. */
    lacking(board: string, target: string | null, o: Observe | null, has: Record<string, string>, all: boolean): FacetMsg[] {
      const m = held.get(key(board, target)) ?? [...held.entries()].find(([k]) => k.startsWith(`${board}|`))?.[1]
      return [...(m?.values() ?? [])].filter(f => (all || has[f.facet] !== f.hash) && (!o || EVERY.has(f.facet) || o.facets.includes(f.facet)))
    },
  }
}
export type FacetStore = ReturnType<typeof facetStore>
