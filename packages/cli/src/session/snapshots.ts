// A snapshot is one finished compile of a project, `<session>.<run>` of the run that committed it: its boards, findings, file stamps and the unsaved text it
// compiled. Answers carry it in an Envelope; docs/session.md has the model.
import { createHash } from 'node:crypto'
import type { Entry } from '../project/config.js'
import type { BoardOut } from '../project/project.js'
import type { Held } from '../project/compiler.js'
import { boardFindings, type Finding } from '@pcbjs/export/internal/findings'
import { stampFiles } from './scopes.js'
import { snapshotId, type Envelope, type Run, type Stale } from '@pcbjs/core/protocol'

/** One entry as the snapshot holds it: its boards, or null with the error of a failed compile. */
export interface SnapshotSlot {
  entry: Entry
  compiled: Held[] | null
  error: unknown
  conflict: string | null
}

export interface Snapshot {
  id: string
  /** the run that committed it */
  run: Run
  /** the project root */
  project: string
  at: number
  /** a hash of every input it read: the stamps and the unsaved text */
  key: string
  slots: SnapshotSlot[]
  /** size and mtime of every file of its module graph, config and references */
  stamps: Map<string, string>
  /** a hash of the unsaved text it compiled, per file */
  overlay: Map<string, string>
  /** the project's source files as it compiled them, for lineage */
  texts: Map<string, string>
  /** a content hash per facet of each board, `<facet>:<board>` or `<facet>:<board>|<target>`, for the heartbeat */
  facets: Record<string, string>
  /** the findings of each board and target, keyed `<board>` or `<board>|<target>` */
  findings: Map<string, Finding[]>
}

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

/** `<board>` or `<board>|<target>`. */
export const boardKey = (c: Pick<BoardOut, 'board'>): string => (c.board.variant ? `${c.board.name}|${c.board.variant.name}` : c.board.name)

export type SnapshotInput = Pick<Snapshot, 'project' | 'slots' | 'stamps' | 'overlay' | 'texts'>

export interface Snapshots {
  /** the next run, which a compile streams its facets under; one that never commits mints no snapshot */
  reserve(): Run
  /** the run reserved last, null before any */
  last(): Run | null
  /** mint the snapshot of a project's run, a new run when none is given; the one before it stays as the previous */
  commit(s: SnapshotInput, run?: Run): Snapshot
  current(project: string): Snapshot | null
  previous(project: string): Snapshot | null
  /** a snapshot still held: the current or previous of some project */
  get(id: string): Snapshot | null
}

export function snapshots(session: string): Snapshots {
  let n = 0
  const held = new Map<string, { current: Snapshot; previous: Snapshot | null }>()
  return {
    reserve: () => ++n,
    last: () => (n ? n : null),
    commit(s, given) {
      const findings = new Map<string, Finding[]>()
      const facets: Record<string, string> = {}
      for (const sl of s.slots)
        for (const c of sl.compiled ?? []) {
          const k = boardKey(c)
          const f = boardFindings(c.board, s.project)
          findings.set(k, f)
          for (const [name, hash] of Object.entries(c.hashes)) facets[`${name}:${k}`] = hash
        }
      const key = sha(JSON.stringify([[...s.stamps].sort(), [...s.overlay].sort()]))
      const run = given ?? ++n
      const snap: Snapshot = { ...s, id: snapshotId(session, run), run, at: Date.now(), key, facets, findings }
      const h = held.get(s.project)
      // a compile of the same inputs again keeps the previous snapshot, the one an older reference was minted in
      held.set(s.project, { current: snap, previous: h && h.current.key === key ? h.previous : (h?.current ?? null) })
      return snap
    },
    current: p => held.get(p)?.current ?? null,
    previous: p => held.get(p)?.previous ?? null,
    get(id) {
      for (const h of held.values()) {
        if (h.current.id === id) return h.current
        if (h.previous?.id === id) return h.previous
      }
      return null
    },
  }
}

/** What a project looks like now: the hash of each file's unsaved text, and whether a compile or a text is on its way. */
export interface Now {
  overlay(file: string): string | null
  pending: boolean
}

/** Why a snapshot is not the project's state now; null when it is. */
export function staleOf(snap: Snapshot | null, now: Now): Stale | null {
  if (now.pending) return { reason: 'compiling' }
  if (!snap) return { reason: 'changed' }
  return changedFiles(snap, now).length ? { reason: 'changed' } : null
}

/** The files whose disk stamp or unsaved text differs from what the snapshot compiled. */
export function changedFiles(snap: Snapshot, now: Pick<Now, 'overlay'>): string[] {
  const disk = stampFiles(snap.stamps.keys())
  const out: string[] = []
  for (const [f, was] of snap.stamps) {
    const text = now.overlay(f)
    const had = snap.overlay.get(f) ?? null
    if (text !== had || (text === null && disk.get(f) !== was)) out.push(f)
  }
  return out
}

/** True when the snapshot compiled `file` as it is now, so an edit event for it is served. */
export function compiledAsNow(snap: Snapshot, file: string, now: Pick<Now, 'overlay'>): boolean {
  const was = snap.stamps.get(file)
  if (was === undefined) return false
  const text = now.overlay(file)
  if (text !== (snap.overlay.get(file) ?? null)) return false
  return text !== null || stampFiles([file]).get(file) === was
}

/** The files written on disk since the snapshot's compile, whatever text an editor holds for them. */
export function changedOnDisk(snap: Snapshot): string[] {
  const disk = stampFiles(snap.stamps.keys())
  return [...snap.stamps].filter(([f, was]) => disk.get(f) !== was).map(([f]) => f)
}

/** The answer of a query on a snapshot. */
export function envelope<T>(snap: Snapshot, stale: Stale | null, value: T): Envelope<T> {
  const rel = (f: string) => (f.startsWith(snap.project + '/') ? f.slice(snap.project.length + 1) : f)
  return { snapshot: snap.id, stale, overlay: [...snap.overlay.keys()].map(rel).sort(), value }
}
