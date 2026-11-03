// The edit history per client, `session/edit/undo` and `redo`: every tool commit the session wrote, as the text of each file before and
// after, undone by writing the old text back through the session's sources while the file still reads as the edit left it; see docs/editing.md.
import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import type { Against, By, EditResult, FileEdits, Written } from '@pcbjs/core/protocol'
import { diffEdit, textDoc } from '@pcbjs/core/internal/textdoc'
import { againstOf, type Sources } from './sources.js'

interface Change {
  file: string
  /** null for a file the edit created */
  before: string | null
  after: string
}
interface Step {
  txn: string | null
  changes: Change[]
}
export interface HistoryDeps {
  root: string
  sources: Sources
}
const keyOf = (by: By | null) => by?.client ?? ''

export function editHistory(d: HistoryDeps) {
  const done = new Map<string, Step[]>()
  const undone = new Map<string, Step[]>()
  const list = (m: Map<string, Step[]>, by: By | null) => {
    const k = keyOf(by)
    if (!m.has(k)) m.set(k, [])
    return m.get(k)!
  }
  const read = (file: string) => d.sources.read(file)?.text ?? null

  /** A commit's writes, recorded with the text before them; the client's redo list is cleared. */
  async function write(files: FileEdits[], by: By | null): Promise<Written[]> {
    const before = files.map(f => read(f.file))
    const written = await d.sources.write(files, by)
    const changes = files.flatMap((f, i): Change[] => {
      if (!written.find(w => w.file === f.file)?.applied) return []
      const old = before[i]
      return [{ file: f.file, before: f.create && old === null ? null : old, after: textDoc(old ?? '').apply(f.edits) }]
    })
    if (changes.length) {
      list(done, by).push({ txn: null, changes })
      list(undone, by).length = 0
    }
    return written
  }

  /** Name the client's latest unnamed step by the transaction that wrote it. */
  function name(by: By | null, txn: string): void {
    const s = list(done, by)
      .filter(x => x.txn === null)
      .pop()
    if (s) s.txn = txn
  }

  /** One step of the client back or forward, the named one or the latest; refused when a file no longer reads as the step left it. */
  async function step(by: By | null, txn: string | undefined, back: boolean): Promise<EditResult> {
    const from = list(back ? done : undone, by)
    const i = txn ? from.map(s => s.txn).lastIndexOf(txn) : from.length - 1
    if (i < 0) return { txn: txn ?? null, written: [], error: txn ? `no edit ${txn} to ${back ? 'undo' : 'redo'}` : `nothing to ${back ? 'undo' : 'redo'}` }
    const s = from[i]
    const based = new Map<string, Against>()
    for (const c of s.changes) {
      const now = read(c.file)
      if (now !== (back ? c.after : c.before))
        return { txn: s.txn, written: [], error: `${relative(d.root, c.file)} changed since the edit; nothing was ${back ? 'undone' : 'redone'}` }
      const a = againstOf(d.sources.read(c.file))
      if (a) based.set(c.file, a)
    }
    const writes: FileEdits[] = []
    const removed: Written[] = []
    for (const c of s.changes) {
      const was = back ? c.after : (c.before ?? '')
      const to = back ? c.before : c.after
      if (to === null && d.sources.read(c.file)?.authority !== 'editor') removed.push(d.sources.remove(c.file))
      else {
        const a = based.get(c.file)
        writes.push({
          file: c.file,
          edits: [textDoc(was).edit(diffEdit(was, to ?? ''))],
          ...(!back && c.before === null && !existsSync(c.file) ? { create: true as const } : {}),
          ...(a ? { against: a } : {}),
        })
      }
    }
    const written = [...removed, ...(await d.sources.write(writes, by))]
    const refused = written.find(w => !w.applied)
    if (refused) return { txn: s.txn, written, error: refused.reason ?? `nothing was ${back ? 'undone' : 'redone'}` }
    from.splice(i, 1)
    list(back ? undone : done, by).push(s)
    return { txn: s.txn, written }
  }

  return {
    write,
    name,
    undo: (by: By | null, txn?: string) => step(by, txn, true),
    redo: (by: By | null, txn?: string) => step(by, txn, false),
  }
}
export type EditHistory = ReturnType<typeof editHistory>
