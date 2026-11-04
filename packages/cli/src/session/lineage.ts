// A reference from an older snapshot resolved in the current one: exact when it still names something, a finding by its fingerprint,
// else by lineage through the previous snapshot, the source call it came from mapped through the edit to the call the current snapshot minted it from.
import { resolve } from 'node:path'
import { boardIndex, isTreeRef, parseRef, resolveRef as resolveOn } from '@pcbjs/core/ref'
import type { SourceRange } from '@pcbjs/core/site-data'
import { matchFinding, type Finding } from '@pcbjs/export/internal/findings'
import type { Stale } from '@pcbjs/core/protocol'
import type { Snapshot } from './snapshots.js'
import { pointMap, type PointMap } from '../project/textmap.js'

/** What a reference names, as `resolveRef` of @pcbjs/core/ref says, a finding for `drc:` and `erc:`. */
export type RefKind = 'finding' | 'part' | 'pad' | 'group' | 'net' | 'route' | 'leg' | 'pt' | 'pair' | 'item' | 'span' | 'plane' | 'region'

export interface Resolution {
  kind: RefKind
  /** the reference in the current snapshot, in the grammar of docs/refs.md, null when it is gone */
  ref: string | null
  stale: Stale | null
  /** the nearest references by name when it is gone */
  candidates?: string[]
}

/** What a reference would name by its form alone: a finding id, a typed head's kind, a pad under a part, else a part. */
export function kindOf(ref: string): RefKind {
  const segs = parseRef(ref).filter(s => s.kind !== 'board')
  const head = segs[0]?.kind
  if (head === 'drc' || head === 'erc') return 'finding'
  if (head) return (segs.at(-1)!.kind ?? head) as RefKind
  return segs.length > 1 ? 'pad' : 'part'
}

const boards = (s: Snapshot) => s.slots.flatMap(sl => sl.compiled ?? [])
const findings = (s: Snapshot): Finding[] => [...s.findings.values()].flat()
const parts = (s: Snapshot): string[] => [...new Set(boards(s).flatMap(c => c.board.footprints.map(f => f.ref)))]
const nets = (s: Snapshot): string[] => [...new Set(boards(s).flatMap(c => c.board.nets.map(n => n.name)))]

/** What `ref` names in a snapshot, on any of its boards; null when nothing. */
function named(s: Snapshot, ref: string): RefKind | null {
  if (kindOf(ref) === 'finding') return findings(s).some(f => f.id === ref) ? 'finding' : null
  for (const c of boards(s))
    try {
      const r = resolveOn(boardIndex(c.board), ref)
      return r.kind === 'finding' ? 'finding' : r.kind
    } catch {
      /* not on this board */
    }
  return null
}

/** Resolve `ref` in `cur`; `prev` is the snapshot before it, which an older reference is looked up in. */
export function resolveRef(cur: Snapshot, prev: Snapshot | null, ref: string): Resolution {
  const now = named(cur, ref)
  if (now) return { kind: now, ref, stale: null }
  const was = prev ? named(prev, ref) : null
  const kind = was ?? kindOf(ref)
  const found = prev && was ? (kind === 'finding' ? findingLineage(prev, cur, ref) : kind === 'part' || kind === 'pad' ? treeLineage(prev, cur, ref) : null) : null
  if (found) return { kind, ref: found, stale: { reason: 'changed', current: found } }
  return { kind, ref: null, stale: { reason: 'gone' }, candidates: nearest(cur, kind, ref, prev) }
}

/** A part or a pad of `prev` as `cur` names it: the part through its source call, the pad kept under it. */
function treeLineage(prev: Snapshot, cur: Snapshot, ref: string): string | null {
  const [part, ...rest] = ref.split('/')
  const now = parts(cur).includes(part) ? part : partLineage(prev, cur, part)
  return now ? [now, ...rest].join('/') : null
}

const maps = new WeakMap<Snapshot, Map<string, PointMap | null>>()
/** A position in a project file of `prev` as the same position in `cur`, null inside an edit or when the file is not known. */
function mapPoint(prev: Snapshot, cur: Snapshot, rel: string, at: [number, number]): [number, number] | null {
  const abs = resolve(prev.project, rel)
  let byFile = maps.get(cur)
  if (!byFile) maps.set(cur, (byFile = new Map()))
  if (!byFile.has(`${prev.id}|${abs}`)) {
    const a = prev.texts.get(abs),
      b = cur.texts.get(abs)
    byFile.set(`${prev.id}|${abs}`, a === undefined || b === undefined ? null : pointMap(a, b))
  }
  return byFile.get(`${prev.id}|${abs}`)?.(at) ?? null
}

const sources = (s: Snapshot, rel: string): SourceRange[] => boards(s).flatMap(c => c.site.sources?.[rel] ?? [])
const size = (r: SourceRange) => (r.end[0] - r.start[0]) * 1e6 + (r.end[1] - r.start[1])
const same = (a: [number, number] | null, b: [number, number]) => !!a && a[0] === b[0] && a[1] === b[1]

/** The innermost call that made the part in `prev`, mapped into `cur`: the part that call makes now. */
function partLineage(prev: Snapshot, cur: Snapshot, ref: string): string | null {
  let best: { rel: string; r: SourceRange } | null = null
  for (const c of boards(prev))
    for (const [rel, rs] of Object.entries(c.site.sources ?? {})) for (const r of rs) if (r.refs.includes(ref) && (!best || size(r) < size(best.r))) best = { rel, r }
  if (!best) return null
  const { rel, r } = best
  const start = mapPoint(prev, cur, rel, r.start),
    end = mapPoint(prev, cur, rel, r.end)
  const now = sources(cur, rel).find(x => same(start, x.start) && same(end, x.end) && x.refs.length === r.refs.length)
  return now?.refs[r.refs.indexOf(ref)] ?? null
}

/** The finding of `prev` as `cur` reports it: the same fingerprint nearest its position, else the same rule at the mapped source, else on the parts its parts became. */
function findingLineage(prev: Snapshot, cur: Snapshot, id: string): string | null {
  const f = findings(prev).find(x => x.id === id)!
  const same = matchFinding(f, findings(cur))
  if (same) return same.id
  const pool = findings(cur).filter(x => x.kind === f.kind && x.rule === f.rule)
  const s = f.src[0]
  if (s) {
    const at = mapPoint(prev, cur, s.file, s.start)
    const hit = at && pool.find(x => x.src[0]?.file === s.file && same2(x.src[0].start, at))
    if (hit) return hit.id
  }
  const partOf = (r: string) => r.split('/')[0]
  const refs = f.refs.filter(isTreeRef).map(r => (parts(cur).includes(partOf(r)) ? partOf(r) : partLineage(prev, cur, partOf(r))))
  if (refs.length && refs.every(Boolean)) {
    const want = [...refs].sort().join()
    const hit = pool.find(x => x.refs.filter(isTreeRef).map(partOf).sort().join() === want)
    if (hit) return hit.id
  }
  return null
}

const same2 = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1]

/** Up to five references of the kind in `cur`, those sharing the longest prefix with `ref` first. */
function nearest(cur: Snapshot, kind: RefKind, ref: string, prev: Snapshot | null): string[] {
  if (kind === 'finding') {
    const f = prev ? findings(prev).find(x => x.id === ref) : undefined
    return findings(cur)
      .filter(x => !f || x.rule === f.rule)
      .slice(0, 5)
      .map(x => x.id)
  }
  const pool = kind === 'net' ? nets(cur).map(n => `net:${n}`) : kind === 'part' || kind === 'pad' ? parts(cur) : []
  const common = (a: string) => {
    let i = 0
    while (i < a.length && i < ref.length && a[i] === ref[i]) i++
    return i
  }
  return pool
    .map(p => ({ p, n: common(p) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || a.p.localeCompare(b.p))
    .slice(0, 5)
    .map(x => x.p)
}
