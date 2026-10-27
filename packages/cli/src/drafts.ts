// docs/editor.md, Drafts, has the rules.
import { readFileSync } from 'node:fs'
import { transformWithEsbuild, type Plugin } from 'vite'
import { loadLsp } from './lsp.js'

export interface Span { start: number; end: number }

export interface Draft {
  /** the file as the editor names it, which may be through a symbolic link */
  named: string
  /** the editor's text */
  text: string
  /** what Vite compiles: the text, or its repair */
  code: string
  /** the spans the repair blanked, offsets of `text` */
  skipped: Span[]
  /** where the repair's closers start: an offset at or past it maps to the one before */
  limit: number | null
  /** neither the text nor a repair compiles: the last good board stays */
  broken: boolean
}

export interface Drafts {
  /** the editor's text of a file, applied after a pause in typing; null drops the draft at once */
  set(file: string, text: string | null, named?: string): void
  get(file: string): Draft | undefined
  files(): string[]
  dispose(): void
}

/** The drafts of a dev server; `changed` runs once a file's draft is applied or dropped. */
export function drafts(changed: (file: string) => void, delayMs = 200): Drafts {
  const map = new Map<string, Draft>()
  const timers = new Map<string, NodeJS.Timeout>()
  const seq = new Map<string, number>()

  const apply = async (file: string, text: string | null, named: string, n: number) => {
    let disk: string | null = null
    try { disk = readFileSync(file, 'utf8') } catch { /* a file not saved yet */ }
    const d = text === null || text === disk ? null : { ...(await prepare(file, text)), named }
    if (seq.get(file) !== n) return
    if (!d) { if (map.delete(file)) changed(file); return }
    map.set(file, d)
    changed(file)
  }

  return {
    set(file, text, named = file) {
      const n = (seq.get(file) ?? 0) + 1
      seq.set(file, n)
      clearTimeout(timers.get(file))
      timers.delete(file)
      if (text === null) { void apply(file, null, named, n); return }
      timers.set(file, setTimeout(() => { timers.delete(file); void apply(file, text, named, n) }, delayMs))
    },
    get: file => map.get(file),
    files: () => [...map.keys()],
    dispose() {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      map.clear()
    },
  }
}

const LOADERS: Record<string, 'ts' | 'tsx' | 'js' | 'jsx'> = { ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx' }

/** The offset of the first syntax error esbuild finds, null when it takes the code. */
export async function syntaxError(file: string, code: string): Promise<number | null> {
  const loader = LOADERS[file.split('.').pop() ?? ''] ?? 'ts'
  try {
    await transformWithEsbuild(code, file, { loader, jsx: 'automatic', tsconfigRaw: {} })
    return null
  } catch (e: any) {
    const at = e?.errors?.[0]?.location as { line: number; column: number } | undefined
    if (!at) return 0
    const lines = code.split('\n')
    const start = lines.slice(0, at.line - 1).reduce((n, l) => n + l.length + 1, 0)
    // esbuild counts columns in UTF-8 bytes
    return start + Buffer.from(lines[at.line - 1] ?? '').subarray(0, at.column).toString().length
  }
}

/** The draft of a text: as it is when esbuild takes it, else the repair, retried once with the offset esbuild still rejects. */
export async function prepare(file: string, text: string): Promise<Omit<Draft, 'named'>> {
  const err = await syntaxError(file, text)
  if (err === null) return { text, code: text, skipped: [], limit: null, broken: false }
  const { repair } = await loadLsp()
  let r = repair(text, file)
  let left = r.ok ? await syntaxError(file, r.text) : -1
  if (left !== null && left >= 0) {
    r = repair(text, file, [Math.min(left, text.length)])
    left = r.ok ? await syntaxError(file, r.text) : -1
  }
  if (left !== null) return { text, code: text, skipped: [], limit: null, broken: true }
  return { text, code: r.text, skipped: r.skipped, limit: r.limit, broken: false }
}

/** Serve each draft in place of its file. */
export function draftsPlugin(store: () => Drafts | null | undefined): Plugin {
  return {
    name: 'pcbjs:drafts',
    enforce: 'pre',
    load(id) {
      return store()?.get(id.split('?')[0])?.code
    },
  }
}

interface Position { line: number; character: number }

/** The spans each draft's repair skipped, as LSP ranges of the editor's text. */
export function skippedRanges(store: Drafts | null | undefined): { file: string; ranges: { start: Position; end: Position }[] }[] {
  const out: { file: string; ranges: { start: Position; end: Position }[] }[] = []
  for (const f of store?.files() ?? []) {
    const d = store!.get(f)!
    if (!d.skipped.length) continue
    const starts = [0]
    for (let i = 0; i < d.text.length; i++) if (d.text.charCodeAt(i) === 10) starts.push(i + 1)
    const at = (o: number): Position => {
      let line = 0
      while (line + 1 < starts.length && starts[line + 1] <= o) line++
      return { line, character: o - starts[line] }
    }
    out.push({ file: d.named, ranges: d.skipped.map(s => ({ start: at(s.start), end: at(s.end) })) })
  }
  return out
}
