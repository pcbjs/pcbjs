// What an event touches in its project's snapshots, for a scoped subscription: the entities whose source ranges an edit or the cursor meets,
// the findings of a delta and their refs, the selection; a compile touches every scope.
import type { EditRange, SessionEvent } from '@pcbjs/core/protocol'
import { changedRanges } from './events.js'
import type { Touched } from './scope.js'
import type { Snapshot } from './snapshots.js'

const boards = (s: Snapshot | null) => (s?.slots ?? []).flatMap(sl => sl.compiled ?? [])

/** Each part ref with its tree path, `R201` and `CH2/R01`. */
function withPaths(s: Snapshot | null, refs: string[]): string[] {
  const out = new Set(refs)
  for (const c of boards(s)) for (const p of c.board.schematic?.parts ?? []) if (out.has(p.ref) && p.path?.length) out.add([...p.path, p.local ?? p.ref].join('/'))
  return [...out]
}

const before = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
const meets = (r: EditRange, s: { start: [number, number]; end: [number, number] }) => before(r.start, s.end) && before(s.start, r.end)

/** The refs made by source ranges of a file that meet any of the ranges; every range of the file without them. */
function refsIn(s: Snapshot | null, file: string, ranges: EditRange[] | null): string[] {
  const out = new Set<string>()
  for (const c of boards(s)) for (const r of c.site.sources?.[file] ?? []) if (!ranges || ranges.some(x => meets(x, r))) for (const ref of r.refs) out.add(ref)
  return [...out]
}

export function touched(e: SessionEvent, cur: Snapshot | null, prev: Snapshot | null, disk: (file: string) => string | null): Touched {
  switch (e.kind) {
    case 'compile':
      return 'all'
    case 'edit': {
      const d = (e as SessionEvent<'edit'>).data
      let ranges = d.ranges
      // a write on disk names no ranges: they come from the text the snapshot compiled
      if (!ranges && cur) {
        const was = cur.texts.get(`${cur.project}/${d.file}`)
        const now = disk(`${cur.project}/${d.file}`)
        ranges = was !== undefined && now !== null ? changedRanges(was, now) : null
      }
      return { files: [d.file], refs: withPaths(cur, refsIn(cur, d.file, ranges)) }
    }
    case 'save': {
      const d = (e as SessionEvent<'save'>).data
      return { files: [d.file], refs: withPaths(cur, refsIn(cur, d.file, null)) }
    }
    case 'cursor': {
      const d = (e as SessionEvent<'cursor'>).data
      const at: [number, number] = [d.line, d.col]
      return { files: [d.file], refs: withPaths(cur, refsIn(cur, d.file, [{ start: at, end: at }])) }
    }
    case 'message': {
      const d = (e as SessionEvent<'message'>).data
      return { files: (d.ranges ?? []).map(r => r.file), refs: withPaths(cur, d.refs ?? []) }
    }
    case 'selection':
      return { files: [], refs: withPaths(cur, (e as SessionEvent<'selection'>).data.refs) }
    case 'message': {
      const d = (e as SessionEvent<'message'>).data
      return { files: (d.ranges ?? []).map(r => r.file), refs: withPaths(cur, [...(d.refs ?? []), ...(d.finding ? [d.finding] : [])]) }
    }
    case 'delivered':
      return { files: [], refs: [] }
    case 'findings': {
      const d = (e as SessionEvent<'findings'>).data
      const ids = new Set([...d.added, ...d.resolved])
      const all = [cur, prev].flatMap(s => [...(s?.findings.values() ?? [])].flat())
      const refs = all.filter(f => ids.has(f.id)).flatMap(f => f.refs)
      return { files: [], refs: [...ids, ...withPaths(cur, [...new Set(refs.flatMap(r => [r, r.split('/')[0]]))])] }
    }
  }
}
