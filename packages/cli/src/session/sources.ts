// Open editor text, including recovered buffers, is authoritative; otherwise source comes from disk.
import { readFileSync, rmSync } from 'node:fs'
import type { Holder } from '@pcbjs/lsp'
import type { Against, By, FileEdits, Written } from '@pcbjs/core/protocol'
import type { LspHub } from './lsp.js'
import { applyEdits } from './write.js'

export type Authority = 'editor' | 'disk'

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
  /** a write of `by` is about to land: the feed names it */
  claim(file: string, by: By): void
}

export interface Sources {
  read(file: string): Source | null
  /** Each file's edits through its editor, else on disk. */
  write(files: FileEdits[], by: By | null): Promise<Written[]>
  /** a file the session made, removed from disk */
  remove(file: string): Written
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
  const read = (file: string): Source | null => {
    const doc = o.hub()?.store()?.get(file)
    if (doc) return { text: doc.text, authority: 'editor', version: doc.version, holder: doc.holder, named: doc.named }
    const text = disk(file)
    return text === null ? null : { text, authority: 'disk', version: null, holder: null, named: file }
  }

  return {
    read,
    write: async (files, by) => {
      const out: Written[] = []
      for (const f of files) {
        if (by) o.claim(f.file, by)
        out.push(...(await applyEdits([f], { hub: o.hub(), root: o.rootOf(f.file), projectOf: o.projectOf })))
      }
      return out
    },
    remove: file => {
      rmSync(file, { force: true })
      return { file, via: 'disk', applied: true }
    },
  }
}
