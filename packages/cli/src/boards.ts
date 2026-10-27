import type { SiteData } from '@pcbjs/export/site-data'
import type { Entry } from './config.js'
import { boardFile, type Compiled } from './project.js'
import { variantSlug } from '@pcbjs/core/variants'

export interface BoardSlot {
  entry: Entry
  /** the last good compile, one per fab target in list order, kept while a later one fails */
  compiled: Compiled[] | null
  /** formatted for the viewer */
  error: string | null
  /** set when an earlier entry already uses this board's name */
  conflict: string | null
  /** dev: size and mtime of every file of its module graph at the last good compile */
  stamps?: Map<string, string>
  /** dev: Date.now() when the last good compile finished */
  doneAt?: number
}

export const slotsFor = (entries: Entry[]): BoardSlot[] => entries.map(entry => ({ entry, compiled: null, error: null, conflict: null }))

/** The first entry to claim a board name keeps it; every later one gets a conflict naming both files. */
export function markConflicts(slots: BoardSlot[]): void {
  const owner = new Map<string, BoardSlot>()
  for (const s of slots) {
    s.conflict = null
    if (!s.compiled) continue
    const name = s.compiled[0].board.name
    const first = owner.get(name)
    if (first) s.conflict = `board name "${name}" is used by both ${first.entry.rel} and ${s.entry.rel}`
    else owner.set(name, s)
  }
}

/** In entry order; a failed compile keeps its last good board. */
export const liveSlots = (slots: BoardSlot[]): BoardSlot[] => slots.filter(s => s.compiled && !s.conflict)

export const errorOf = (s: BoardSlot): string | null => s.error ?? s.conflict

export function errorsByEntry(slots: BoardSlot[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const s of slots) out[s.entry.rel] = errorOf(s)
  return out
}

export const slotName = (s: BoardSlot): string => s.compiled![0].board.name

export interface BoardsIndex {
  /** one per board, or per target of a board with variants */
  boards: { name: string; variant?: string; title: string; revision: string; file: string; entry: string; status: string }[]
  /** one board, however many targets it has */
  single: boolean
}

export function boardsIndex(compiled: Compiled[], single: boolean): BoardsIndex {
  return {
    boards: compiled.map(c => ({
      name: c.board.name, ...(c.board.variant ? { variant: c.board.variant.name } : {}), title: c.board.title, revision: c.board.revision,
      file: boardFile(c.board), entry: c.entry.rel, status: c.site.fab.status,
    })),
    single,
  }
}

export interface BoardsPayload {
  boards: SiteData[]
  single: boolean
  /** by entry path, in entry order */
  errors: Record<string, string | null>
  /** by board name */
  entries: Record<string, string>
}

/** What the virtual module and pcbjs:boards carry; `transient`, dev's isolated preview, goes last with `transient: true`. */
export function boardsPayload(slots: BoardSlot[], transient?: Compiled | null): BoardsPayload {
  const live = liveSlots(slots)
  return {
    boards: [...live.flatMap(s => s.compiled!.map(c => c.site)), ...(transient ? [{ ...transient.site, transient: true }] : [])], single: slots.length === 1, errors: errorsByEntry(slots),
    entries: Object.fromEntries(live.map(s => [slotName(s), s.entry.rel])),
  }
}

interface GraphNode { file: string | null; importers: Set<GraphNode> }

/** Walks importers up the module graph; null when the file is not in it, so the caller recompiles everything. */
export function entriesReaching(modules: Iterable<GraphNode> | undefined, entryFiles: Iterable<string>): Set<string> | null {
  const start = modules ? [...modules] : []
  if (!start.length) return null
  const entries = new Set(entryFiles)
  const hit = new Set<string>()
  const seen = new Set<GraphNode>()
  const stack = start
  while (stack.length) {
    const m = stack.pop()!
    if (seen.has(m)) continue
    seen.add(m)
    if (m.file && entries.has(m.file)) hit.add(m.file)
    for (const i of m.importers) stack.push(i)
  }
  return hit
}

/** `<name>/<file>` or `<name>/<slug>/<file>`; anything else is the legacy single-board form and goes to the first board. */
export function routeEndpoint(path: string, names: string[], slugs: Record<string, string[]> = {}): { name: string; variant?: string; file: string } | null {
  const i = path.indexOf('/')
  let name: string, rest: string
  if (i > 0 && names.includes(decodeURIComponent(path.slice(0, i)))) { name = decodeURIComponent(path.slice(0, i)); rest = path.slice(i + 1) }
  else if (names.length) { name = names[0]; rest = path }
  else return null
  const targets = slugs[name]
  if (!targets?.length) return { name, file: decodeURIComponent(rest) }
  const j = rest.indexOf('/')
  const head = j > 0 ? decodeURIComponent(rest.slice(0, j)) : null
  if (head !== null && targets.includes(head)) return { name, variant: head, file: decodeURIComponent(rest.slice(j + 1)) }
  return { name, variant: targets[0], file: decodeURIComponent(rest) }
}

export function slugsOf(slots: BoardSlot[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const s of liveSlots(slots)) {
    const v = s.compiled![0].board.variant
    if (v) out[slotName(s)] = v.names.map(variantSlug)
  }
  return out
}

/** Vite's `moduleGraph`, or a stand-in in the tests. */
export interface ModuleLookup { getModulesByFile(file: string): Iterable<GraphNode> | undefined }

export interface FocusTarget {
  /** the only live board holding the file, the viewer's own when it is one of several, else the first; null when none */
  board: string | null
  /** or of the first entry that imports the file when none of them has a live board */
  entry: string | null
  /** in entry order */
  boards: string[]
}

/** A shared file never moves a viewer off `current`; an entry file always reaches its own board, also before the first compile. */
export function focusTarget(graph: ModuleLookup | undefined, slots: BoardSlot[], file: string, current: string | null = null): FocusTarget {
  const hit = entriesReaching(graph?.getModulesByFile(file), slots.map(s => s.entry.file)) ?? new Set<string>()
  if (slots.some(s => s.entry.file === file)) hit.add(file)
  const reached = slots.filter(s => hit.has(s.entry.file))
  const live = reached.filter(s => s.compiled && !s.conflict)
  const names = live.map(slotName)
  const board = current != null && names.includes(current) ? current : names[0] ?? null
  const at = board ? live[names.indexOf(board)] : reached[0]
  return { board, entry: at ? at.entry.rel : null, boards: names }
}

export interface IdeBoard { name: string; title: string; entry: string; targets: string[]; status: 'ok' | 'error' | 'incomplete'; draft?: true; skipped?: number }

/** One per entry with a board of its own; `error` marks a last good board, `incomplete` DRC errors or unconnected nets. */
export function ideBoards(slots: BoardSlot[]): { boards: IdeBoard[]; single: boolean; errors: Record<string, string | null> } {
  return {
    boards: liveSlots(slots).map(s => {
      const c = s.compiled!
      return {
        name: slotName(s), title: c[0].board.title || slotName(s), entry: s.entry.rel,
        targets: c.flatMap(t => (t.board.variant ? [t.board.variant.name] : [])),
        status: s.error ? 'error' : c.some(t => t.site.fab.status !== 'ok') ? 'incomplete' : 'ok',
        ...(c[0].site.draft ? { draft: true, skipped: c[0].site.draft.skipped } as const : {}),
      }
    }),
    single: slots.length === 1,
    errors: errorsByEntry(slots),
  }
}
