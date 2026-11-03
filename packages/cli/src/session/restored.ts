// An editor's text no edit of its own produced, opened unlike the disk as a restored hot-exit backup is: disk rules until it edits.
import type { DocumentStore, Holder } from '@pcbjs/lsp'

export interface Restored {
  file: string
  named: string
  holder: Holder
  /** the editor's version of the text it opened */
  version: number
  at: number
}

export interface RestoredOptions {
  realFile(file: string): string
  disk(file: string): string | null
  /** a text held back, or let go: the session logs it and refreshes the findings */
  changed(r: Restored, held: boolean): void
}

export interface RestoredGuard {
  store: DocumentStore
  held(): Restored[]
  /** the held text of a real path */
  get(file: string): (Restored & { text: string }) | undefined
}

/** LSP versions start at 0 or 1, so an open at either is a text the editor has not changed since it loaded it. */
const UNEDITED = 1

/** The store with every editor's unedited open text unlike the disk held back, so a stale buffer never compiles over the file. */
export function restoredGuard(inner: DocumentStore, o: RestoredOptions): RestoredGuard {
  const held = new Map<string, Restored & { text: string }>()
  const free = (file: string) => {
    const r = held.get(file)
    if (!r) return
    held.delete(file)
    o.changed(r, false)
  }
  const store: DocumentStore = {
    ...inner,
    sync(file, text, version, holder) {
      if (holder.role !== 'editor') return inner.sync(file, text, version, holder)
      const k = o.realFile(file)
      const h = held.get(k)
      if (h?.holder.id === holder.id && h.text === text) return true
      const opens = inner.holderOf(k)?.id !== holder.id && h?.holder.id !== holder.id
      const disk = opens && version <= UNEDITED ? o.disk(k) : null
      if (disk !== null && disk !== text) {
        if (h) free(k)
        const r = { file: k, named: file, holder, version, at: Date.now(), text }
        held.set(k, r)
        o.changed(r, true)
        return true
      }
      if (h) free(k)
      return inner.sync(file, text, version, holder)
    },
    release(file, holder) {
      const k = o.realFile(file)
      if (held.get(k)?.holder.id === holder.id) free(k)
      inner.release(file, holder)
    },
    releaseAll(holder) {
      for (const [k, r] of [...held]) if (r.holder.id === holder.id) free(k)
      inner.releaseAll(holder)
    },
  }
  return { store, held: () => [...held.values()].map(({ text: _, ...r }) => r), get: file => held.get(file) }
}
