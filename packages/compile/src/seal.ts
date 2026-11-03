// The identity of each finding once the checks end: refs, the exact id within the snapshot and the fingerprint across snapshots, see docs/findings.md.
import type { Board, DrcMarker, Item } from '@pcbjs/core/model'
import { itemRef, refRoute } from '@pcbjs/core/ref'
import { digest } from './cache.js'

const r2 = (v: number) => Math.round(v * 100) / 100
const um = (v: number) => Math.round(v * 1000)

/** What a finding concerns, in the grammar: the refs its check gave, its net and route among them, then each item's; deduplicated in that order. */
export function findingRefs(m: DrcMarker, byId: Map<number, Item>): string[] {
  const out = [...(m.refs ?? [])]
  for (const id of m.items ?? []) {
    const it = byId.get(id)
    const r = it && itemRef(it)
    if (r) out.push(r)
  }
  return [...new Set(out)]
}

/** The exact id: `<kind>:<rule>:` and 12 hex over board, target, rule, layer, the sorted uids, or refs for an ERC finding without items, `at` to 0.01 mm and `measured` to 1 µm. */
export function findingId(kind: 'drc' | 'erc', board: string, target: string | undefined, m: DrcMarker, uids: string[]): string {
  const who = uids.length ? [...uids].sort() : kind === 'erc' ? [...(m.refs ?? [])].sort() : []
  const at = m.at ? [r2(m.at[0]), r2(m.at[1])] : null
  return `${kind}:${m.rule}:${digest([board, target ?? null, m.rule, m.layer ?? null, who, at, m.measured ? um(m.measured.value) : null]).slice(0, 12)}`
}

/** A route named by its place, `route:3`, which a route inserted before it renumbers. */
const placed = (r: string) => /^route:\d+$/.test(refRoute(r) ?? '')

/** The fingerprint: 16 hex over board, target, layer, rule and the sorted refs but a route named by its place; no position, so an unrelated edit keeps it. */
export const fingerprintOf = (board: string, target: string | undefined, m: DrcMarker): string =>
  digest([board, target ?? null, m.layer ?? null, m.rule, (m.refs ?? []).filter(r => !placed(r)).sort()]).slice(0, 16)

/** Every finding of the board without an id gets its refs, id and fingerprint; an id taken already is told apart by its message, then its order. */
export function sealFindings(board: Board, target?: string): void {
  const byId = new Map(board.items.map(it => [it.id, it]))
  const taken = new Set([...board.drc, ...board.erc].flatMap(m => (m.id ? [m.id] : [])))
  for (const kind of ['drc', 'erc'] as const)
    board[kind] = board[kind].map(m => {
      if (m.id) return m
      const out: DrcMarker = { ...m }
      out.refs = findingRefs(out, byId)
      const uids = (out.items ?? []).flatMap(id => byId.get(id)?.uid ?? [])
      let id = findingId(kind, board.name, target, out, uids)
      for (let k = 1; taken.has(id); k++) id = `${kind}:${m.rule}:${digest([id, out.message, k]).slice(0, 12)}`
      taken.add(id)
      out.id = id
      out.fingerprint = fingerprintOf(board.name, target, out)
      return out
    })
}
