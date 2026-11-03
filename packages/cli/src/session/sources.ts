// The one place that decides which text of a source file is true, and the one path that writes it: a connection's text in the store,
// a restored buffer that compiles the disk until the editor edits it, else the disk. docs/editing.md has the rules.
import { readFileSync, rmSync } from 'node:fs'
import type { DocumentStore, Holder } from '@pcbjs/lsp'
import type { Against, By, FileEdits, Written } from '@pcbjs/core/protocol'
import { diffEdit, textDoc } from '@pcbjs/core/internal/textdoc'
import type { LspHub } from './lsp.js'
import { applyEdits } from './write.js'
import { restoredGuard, type Restored, type RestoredGuard, type RestoredOptions } from './restored.js'

export type Authority = 'editor' | 'restored' | 'disk'

export interface Source {
  text: string
  authority: Authority
  /** the holder's version of its buffer, null on disk */
  version: number | null
  /** the connection holding the buffer, null on disk */
  holder: Holder | null
  /** the path as the holder named it, the file on disk */
  named: string
}

export interface SourcesOptions {
  hub(): LspHub | null
  /** the project a file belongs to */
  rootOf(file: string): string
  /** the project a channel connected for, null when it named none */
  projectOf(key: unknown): string | null
  realFile(file: string): string
  /** a write of `by` is about to land: the feed names it */
  claim(file: string, by: By): void
  restored: RestoredOptions['changed']
}

export interface Sources {
  read(file: string): Source | null
  /** each file's edits through the editor that holds it, else on disk; a restored file's are made on the disk and replace the editor's buffer */
  write(files: FileEdits[], by: By | null): Promise<Written[]>
  /** a file the session made, removed from disk */
  remove(file: string): Written
  /** the store with restored buffers held back, once the language server loads */
  wrap(store: DocumentStore): DocumentStore
  restored(): Restored[]
}

export const disk = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** The editor version a write is checked against, null for a text on disk. */
export const againstOf = (s: Source | null): Against | null => (s?.holder && s.version !== null ? { holder: s.holder.id, version: s.version } : null)

export function sources(o: SourcesOptions): Sources {
  let guard: RestoredGuard | null = null

  const read = (file: string): Source | null => {
    const doc = o.hub()?.store()?.get(file)
    if (doc) return { text: doc.text, authority: 'editor', version: doc.version, holder: doc.holder, named: doc.named }
    const text = disk(file)
    const r = guard?.get(o.realFile(file))
    if (r && text !== null) return { text, authority: 'restored', version: r.version, holder: r.holder, named: r.named }
    return text === null ? null : { text, authority: 'disk', version: null, holder: null, named: file }
  }

  /** Edits made on the disk text of a restored file, as one edit of the editor's buffer at the version it opened. */
  const overRestored = (f: FileEdits): FileEdits => {
    const r = guard?.get(o.realFile(f.file))
    const base = r ? disk(f.file) : null
    if (!r || base === null || f.create) return f
    const next = textDoc(base).apply(f.edits)
    return { file: f.file, edits: [textDoc(r.text).edit(diffEdit(r.text, next))], against: { holder: r.holder.id, version: r.version } }
  }

  return {
    read,
    write: async (files, by) => {
      const out: Written[] = []
      for (const f of files) {
        if (by) o.claim(f.file, by)
        out.push(...(await applyEdits([overRestored(f)], { hub: o.hub(), root: o.rootOf(f.file), projectOf: o.projectOf })))
      }
      return out
    },
    remove: file => {
      rmSync(file, { force: true })
      return { file, via: 'disk', applied: true }
    },
    wrap: store => (guard = restoredGuard(store, { realFile: o.realFile, disk, changed: o.restored })).store,
    restored: () => guard?.held() ?? [],
  }
}
