// The one authority for open text in a session: every language server syncs into it, the compile and tsc read it, disk rules every other file.
import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { OpenDocs } from './project.js'

/** How a connection's documents reach the store: an editor holds what it syncs, an agent only what no editor holds, a reader never syncs. */
export type DocRole = 'editor' | 'agent' | 'reader'

/** The connection that synced a file. */
export interface Holder {
  id: string
  role: DocRole
  name?: string
}

export interface Doc {
  text: string
  /** the connection's own version */
  version: number
  /** counts every change in the store, for a cache that must never take one text for another */
  seq: number
  holder: Holder
  /** the path as the connection named it, which may go through a symbolic link */
  named: string
}

/** A file's text in the store changed or left it; `doc` null when disk rules again. */
export interface DocChange {
  /** the real path */
  file: string
  named: string
  doc: Doc | null
  by: Holder
}

export interface DocumentStore extends OpenDocs {
  get(file: string): Doc | undefined
  /** false when an editor holds the file and `holder` is an agent: the text stays on its connection */
  sync(file: string, text: string, version: number, holder: Holder): boolean
  /** by the holder only, on save or close */
  release(file: string, holder: Holder): void
  /** every file the holder held, as when its connection closes */
  releaseAll(holder: Holder): void
  holderOf(file: string): Holder | null
  /** the real paths of the open files */
  files(): string[]
  onChange(fn: (c: DocChange) => void): () => void
}

/** The real path of a file, of its folder for one not saved yet. */
export function realFile(file: string): string {
  const abs = resolve(file)
  try {
    return realpathSync(abs)
  } catch {
    try {
      return join(realpathSync(dirname(abs)), basename(abs))
    } catch {
      return abs
    }
  }
}

export function documentStore(): DocumentStore {
  const docs = new Map<string, Doc>()
  const reals = new Map<string, string>()
  const listeners = new Set<(c: DocChange) => void>()
  let seq = 0
  const key = (file: string) => {
    let r = reals.get(file)
    if (r === undefined) reals.set(file, (r = realFile(file)))
    return r
  }
  const emit = (c: DocChange) => {
    for (const fn of listeners) fn(c)
  }
  const drop = (file: string, by: Holder) => {
    const d = docs.get(file)
    if (!d) return
    docs.delete(file)
    emit({ file, named: d.named, doc: null, by })
  }
  return {
    get: file => docs.get(key(file)),
    sync(file, text, version, holder) {
      const k = key(file)
      const cur = docs.get(k)
      if (holder.role === 'reader') return false
      if (holder.role === 'agent' && cur && cur.holder.role === 'editor' && cur.holder.id !== holder.id) return false
      if (cur && cur.text === text && cur.holder.id === holder.id) {
        cur.version = version
        return true
      }
      const doc: Doc = { text, version, seq: ++seq, holder, named: file }
      docs.set(k, doc)
      emit({ file: k, named: file, doc, by: holder })
      return true
    },
    release(file, holder) {
      const k = key(file)
      if (docs.get(k)?.holder.id === holder.id) drop(k, holder)
    },
    releaseAll(holder) {
      for (const [k, d] of [...docs]) if (d.holder.id === holder.id) drop(k, holder)
    },
    holderOf: file => docs.get(key(file))?.holder ?? null,
    files: () => [...docs.keys()],
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
