// docs/vscode.md, Drafts, has the rules.
import { sourcePath, under } from '../project/files.js'
import { readFileSync } from 'node:fs'
import type { Range, Tiers } from '@pcbjs/core/protocol'
import { textDoc, type Site } from '@pcbjs/core/internal/textdoc'
import { transformWithEsbuild } from 'vite'
import type { Block } from '@pcbjs/lsp'
import { loadLsp } from './lsp.js'

export interface Span {
  start: number
  end: number
}

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

/** A file whose edit left its block with an error while the cursor is in it: its text waits and the last draft stays compiled. */
export interface Hold {
  file: string
  named: string
  /** 1-based, of the first error */
  line: number
  /** offsets of `text` */
  block: Block
  text: string
}

export interface HoldHooks {
  /** the offset of a type error of `text` in `[start, end]`, null when none */
  typeError?(file: string, text: string, start: number, end: number): number | null
  /** a file's hold began, moved to another line, or ended */
  changed?(file: string, hold: Hold | null): void
  /** a text applied that no compile asked for: the cursor left its held block, or the draft was dropped */
  released?(file: string): void
}

/** The two tiers of an edit in ms, docs/session.md: the keystroke tier after `keystroke`, the full compile after `quiet` with no edit. */
export const TIERS: Tiers = { keystroke: 30, quiet: 300 }

/** The session's tiers: the defaults, or PCBJS_KEYSTROKE_MS and PCBJS_QUIET_MS when set to a number of ms. */
export function tiersOf(env: Record<string, string | undefined> = process.env): Tiers {
  const ms = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d)
  return { keystroke: ms(env.PCBJS_KEYSTROKE_MS, TIERS.keystroke), quiet: ms(env.PCBJS_QUIET_MS, TIERS.quiet) }
}

/** The editor texts of the session: each waits for its tier, see session/scheduler.ts, then applies unless its block holds. */
export interface Drafts {
  /** the editor's text of a file, waiting for its tier; true when it is new to the drafts, null drops the draft at once */
  set(file: string, text: string | null, named?: string): boolean
  /** the keystroke tier of a waiting text as Vite compiles it; null once a later text came or when nothing of it parses */
  sketch(file: string): Promise<Draft | null>
  /** apply a file's waiting text unless its block holds; true while it holds */
  settle(file: string): Promise<boolean>
  /** the editor cursor, 1-based: leaving a held block applies its text */
  cursor(file: string, line: number, col: number): void
  get(file: string): Draft | undefined
  files(): string[]
  holds(): Hold[]
  /** apply every text still waiting or held, and resolve once all are applied */
  flush(): Promise<void>
  dispose(): void
}

interface Waiting {
  prepared?: Promise<Omit<Draft, 'named'>>
  text: string
  named: string
  n: number
}

const readDisk = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    // a file not saved yet
    return null
  }
}

/** The offset of a site in `text`, null past its last line. */
function offsetOf(text: string, s: Site): number | null {
  const d = textDoc(text)
  return s.line > d.lines().length ? null : d.span(s).start
}

/** The drafts of a session; `changed` runs once a file's draft is applied or dropped, so every compile thread gets it. */
export function drafts(changed: (file: string) => void, hooks: HoldHooks = {}): Drafts {
  const map = new Map<string, Draft>()
  const waiting = new Map<string, Waiting>()
  const settling = new Map<string, { n: number; p: Promise<boolean> }>()
  const seq = new Map<string, number>()
  const applying = new Set<Promise<void>>()
  // the last text each file was given, applied or held, for the span the next edit changes
  const seen = new Map<string, string>()
  const held = new Map<string, Hold>()
  let caret: { file: string; line: number; col: number } | null = null
  const track = (p: Promise<void>) => {
    applying.add(p)
    void p.finally(() => applying.delete(p))
    return p
  }
  const hold = (file: string, h: Hold | null) => {
    const was = held.get(file)
    if (!h && !was) return
    if (h) held.set(file, h)
    else held.delete(file)
    if (!h || was?.line !== h.line) hooks.changed?.(file, h)
  }

  const apply = async (file: string, text: string | null, named: string, n: number) => {
    hold(file, null)
    const disk = readDisk(file)
    seen.set(file, text ?? disk ?? '')
    const d = text === null || text === disk ? null : { ...(await prepare(file, text)), named }
    if (seq.get(file) !== n) return
    if (!d) {
      if (map.delete(file)) changed(file)
      return
    }
    map.set(file, d)
    changed(file)
  }

  /** The hold of a text whose block has an error with the cursor in it, else null. */
  const holdOf = async (file: string, text: string, named: string): Promise<Hold | null> => {
    const at = caret?.file === file ? offsetOf(text, caret) : null
    if (at === null) return null
    const { changedBlock, blockError, docOf } = await loadLsp()
    const b = changedBlock(docOf(file, seen.get(file) ?? readDisk(file) ?? ''), text, held.get(file)?.block ?? null)
    if (!b || at < b.start || at > b.end) return null
    // an empty chain call waits for the assist's pick, which needs the board compiled with the call cut
    const waits = EMPTY_CALL.test(text.slice(b.start, b.end))
    const err = blockError(text, file, b) ?? (waits ? null : hooks.typeError?.(file, text, b.start, b.end)) ?? null
    return err === null ? null : { file, named, line: textDoc(text).site(err).line, block: b, text }
  }

  const settleText = async (file: string, w: Waiting) => {
    const h = await holdOf(file, w.text, w.named)
    if (seq.get(file) !== w.n) return
    if (!h) return apply(file, w.text, w.named, w.n)
    seen.set(file, w.text)
    hold(file, h)
  }

  /** The text a file has now as far as the drafts know: waiting, held, applied, or on disk. */
  const current = (file: string) => waiting.get(file)?.text ?? held.get(file)?.text ?? map.get(file)?.text ?? seen.get(file) ?? readDisk(file)

  /** Apply a held text now: the cursor left its block, or a query wants it. */
  const release = (file: string): Promise<void> | null => {
    const h = held.get(file)
    return h && !waiting.has(file) ? track(apply(file, h.text, h.named, seq.get(file) ?? 0)) : null
  }

  return {
    set(file, text, named = file) {
      const n = (seq.get(file) ?? 0) + 1
      seq.set(file, n)
      const edit = text !== null && text !== current(file)
      waiting.delete(file)
      if (text === null) {
        void track(apply(file, null, named, n)).then(() => hooks.released?.(file))
        return false
      }
      if (edit) waiting.set(file, { text, named, n })
      return edit
    },
    async sketch(file) {
      const w = waiting.get(file)
      if (!w) return null
      const d = await (w.prepared ??= prepare(file, w.text))
      return seq.get(file) === w.n && !d.broken ? { ...d, named: w.named } : null
    },
    settle(file) {
      const w = waiting.get(file)
      const was = settling.get(file)
      if (!w) return was && was.n === seq.get(file) ? was.p : Promise.resolve(held.has(file))
      waiting.delete(file)
      const p = track(settleText(file, w)).then(() => held.has(file))
      settling.set(file, { n: w.n, p })
      return p
    },
    cursor(file, line, col) {
      caret = { file, line, col }
      for (const [f, h] of held) {
        const at = f === file ? offsetOf(h.text, { line, col }) : null
        if (at === null || at < h.block.start || at > h.block.end) void release(f)?.then(() => hooks.released?.(f))
      }
    },
    get: file => map.get(file),
    files: () => [...map.keys()],
    holds: () => [...held.values()],
    async flush() {
      for (const [file, w] of [...waiting]) {
        waiting.delete(file)
        void track(apply(file, w.text, w.named, w.n))
      }
      for (const file of [...held.keys()]) void release(file)
      await Promise.all([...applying])
    },
    dispose() {
      waiting.clear()
      map.clear()
      held.clear()
    },
  }
}

/** The first hold of a project, its file relative to the root, as `session/state` and the viewers' heartbeat carry it; null when none. */
export function holdIn(store: Drafts | null | undefined, root: string): { file: string; line: number } | null {
  const h = store?.holds().find(x => under(x.file, root))
  return h ? { file: sourcePath(root, h.file), line: h.line } : null
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
    const start = textDoc(code).offset({ line: at.line - 1, character: 0 })
    // esbuild counts columns in UTF-8 bytes
    return (
      start +
      Buffer.from(code.slice(start, start + at.column))
        .subarray(0, at.column)
        .toString().length
    )
  }
}

/** A chain call written without its argument yet, `.H()`, which the repair cuts though it parses. */
const EMPTY_CALL = /\.\s*(?:[LlHhVvAa]|via)\s*\(\s*\)/

/** The draft of a text: as it is when esbuild takes it, an empty chain call cut, else the repair, retried once with the offset esbuild still rejects. */
export async function prepare(file: string, text: string): Promise<Omit<Draft, 'named'>> {
  const err = await syntaxError(file, text)
  if (err === null && !EMPTY_CALL.test(text)) return { text, code: text, skipped: [], limit: null, broken: false }
  if (err === null) {
    const { cutCalls, docOf } = await loadLsp()
    const c = cutCalls(docOf(file, text).sf())
    return { text, code: c.text, skipped: c.spans, limit: null, broken: false }
  }
  const { repair, docOf } = await loadLsp()
  const sf = docOf(file, text).sf()
  let r = repair(sf)
  let left = r.ok ? await syntaxError(file, r.text) : -1
  if (left !== null && left >= 0) {
    r = repair(sf, [Math.min(left, text.length)])
    left = r.ok ? await syntaxError(file, r.text) : -1
  }
  if (left !== null) return { text, code: text, skipped: [], limit: null, broken: true }
  return { text, code: r.text, skipped: r.skipped, limit: r.limit, broken: false }
}

/** The spans each draft's repair skipped, as LSP ranges of the editor's text. */
export function skippedRanges(store: Drafts | null | undefined): { file: string; ranges: Range[] }[] {
  const out: { file: string; ranges: Range[] }[] = []
  for (const f of store?.files() ?? []) {
    const d = store!.get(f)!
    if (!d.skipped.length) continue
    const doc = textDoc(d.text)
    out.push({ file: d.named, ranges: d.skipped.map(s => doc.range(s)) })
  }
  return out
}
