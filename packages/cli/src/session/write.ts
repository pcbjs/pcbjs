// Source edits from the session: through the editor that holds the file, else any editor of the project, both by LSP
// `workspace/applyEdit`; with no editor attached, on disk by a temporary file and a rename.
import { sameFile, under } from '../project/files.js'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { LanguageServer } from '@pcbjs/lsp'
import type { LspHub } from './lsp.js'
import type { FileEdits, TextEdit, Written } from '@pcbjs/core/protocol'
import { textDoc } from '@pcbjs/core/internal/textdoc'

export interface WriteOptions {
  hub: LspHub | null
  /** the project the edits belong to */
  root: string
  /** the project a channel connected for, null when it named none, as an editor window */
  projectOf?: (key: unknown) => string | null
}

/** The editor to write through: the one the edits were computed against, else the file's holder, else an editor of the project; null when none is attached. */
function editorFor(f: FileEdits, o: WriteOptions): LanguageServer | null {
  const file = f.file
  const servers = (o.hub?.servers() ?? []).filter(s => s.server.holder.role === 'editor' && s.server.initialized)
  const holder = f.against?.holder ?? o.hub?.store()?.holderOf(file)?.id
  const held = holder && servers.find(s => s.server.holder.id === holder)
  if (held) return held.server
  const of = (key: unknown) => o.projectOf?.(key) ?? null
  return servers.find(s => of(s.key) === null || sameFile(of(s.key)!, o.root) || under(file, of(s.key)!))?.server ?? null
}

/** A file's whole text on disk, by a temporary file and a rename, its folder made. */
export function writeText(file: string, text: string): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

const writeDisk = (file: string, edits: TextEdit[], create = false) => writeText(file, textDoc(create ? '' : readFileSync(file, 'utf8')).apply(edits))

/** One file's edits through the editor, at the version they were computed on when that editor held the text, so a buffer that moved on refuses them. */
async function throughEditor(editor: LanguageServer, f: FileEdits, uri: string, root: string): Promise<Written> {
  const version = f.against?.holder === editor.holder.id ? f.against.version : undefined
  const applied = await editor.applyEdit(version === undefined ? { changes: { [uri]: f.edits } } : { documentChanges: [{ textDocument: { uri, version }, edits: f.edits }] })
  if (applied) return { file: f.file, via: 'editor', applied }
  const name = relative(root, f.file) || f.file
  const reason = version === undefined ? `the editor refused the edit of ${name}` : `${name} changed in the editor while the edit was made; nothing was written there`
  return { file: f.file, via: 'editor', applied, reason }
}

/** Each file's edits through an editor while one of the project is attached, never under it on disk. */
export async function applyEdits(files: FileEdits[], o: WriteOptions): Promise<Written[]> {
  const out: Written[] = []
  for (const f of files) {
    const editor = editorFor(f, o)
    const uri = pathToFileURL(f.file).href
    if (editor && f.create) {
      const made = await editor.applyEdit({
        documentChanges: [
          { kind: 'create', uri, options: { ignoreIfExists: true } },
          { textDocument: { uri, version: null }, edits: f.edits },
        ],
      })
      out.push({ file: f.file, via: 'editor', applied: made, ...(!made ? { reason: `the editor refused to create ${relative(o.root, f.file)}` } : {}) })
      continue
    } else if (editor) {
      out.push(await throughEditor(editor, f, uri, o.root))
      continue
    }
    writeDisk(f.file, f.edits, f.create)
    out.push({ file: f.file, via: 'disk', applied: true })
  }
  return out
}
