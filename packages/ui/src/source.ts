// free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests
import type { RepoLink, SiteData, SourceIndex, SourceRange } from '@pcbjs/core/site-data'

/** A range together with the file it belongs to, as the index keys it. */
export interface Located {
  file: string
  range: SourceRange
}
/** What a cursor position resolves to: the innermost range and every item it and its nested ranges produced. */
export interface CursorHit {
  file: string
  range: SourceRange
  uids: string[]
  refs: string[]
}

type Pos = [number, number]
const cmp = (a: Pos, b: Pos) => a[0] - b[0] || a[1] - b[1]
/** Lines first, columns to break ties, so a one-line range is always smaller than a two-line one. */
const span = (r: SourceRange) => (r.end[0] - r.start[0]) * 1e6 + (r.end[1] - r.start[1])
const within = (inner: SourceRange, outer: SourceRange) => cmp(inner.start, outer.start) >= 0 && cmp(inner.end, outer.end) <= 0
/** True when column `c` is past `start` and at most `end`, both 1-based inclusive: a cursor before `<` or after `>` is outside. */
export const contains = (r: Pick<SourceRange, 'start' | 'end'>, p: Pos) => cmp(p, r.start) > 0 && cmp(p, r.end) <= 0

export function smallest(found: Located[]): Located | null {
  let best: Located | null = null
  for (const f of found) if (!best || span(f.range) < span(best.range)) best = f
  return best
}

/** The innermost range listing an item by its uid, or a footprint by its ref; `whole` skips single path commands. */
export function rangeFor(sources: SourceIndex | undefined, item: { uid: string } | { ref: string }, whole = false): Located | null {
  if (!sources) return null
  const found: Located[] = [],
    own: Located[] = []
  for (const [file, ranges] of Object.entries(sources))
    for (const range of ranges) {
      if (whole && range.seg !== undefined) continue
      if (!('uid' in item ? range.uids.includes(item.uid) : range.refs.includes(item.ref))) continue
      found.push({ file, range })
      // a call that drew the item wins over a shorter call site around it, such as `<Row g={CH1} />` around a pour
      if (!('uid' in item) || !range.outer?.includes(item.uid)) own.push({ file, range })
    }
  return smallest(own.length ? own : found)
}

/** Where a source link goes, its file relative to the root: a range, or a bare position when only a footprint's `src` without an end is known. */
export interface SourceTarget {
  file: string
  start: Pos
  end?: Pos
  /** a clicked pad, `Q1/2`, and its board: the dev server opens its key in the code when the language server finds one */
  pad?: string
  board?: string
  /** a placement element: the dev server opens its `at` value */
  at?: true
}
/** Which end of an item's call chain a link opens: the outermost call that placed its footprint, or the innermost range that drew it. */
export type SourceKind = 'placement' | 'definition'

/** A target's range, a point range when it has no end. */
export const asRange = (t: SourceTarget) => ({ start: t.start, end: t.end ?? t.start })

/** The placement site of a footprint: its `src`, the outermost call that placed it. */
export function placementOf(board: Pick<SiteData, 'footprints'>, ref: string): SourceTarget | null {
  const s = board.footprints?.find(f => f.ref === ref)?.src
  if (!s) return null
  return { file: s.file, start: [s.line, s.col], ...(s.endLine != null && s.endCol != null ? { end: [s.endLine, s.endCol] as Pos } : {}) }
}

/** The definition of a footprint: its `def`, the innermost call site, normally the `<footprint>` element; null when that is the placement. */
export function definitionOf(board: Pick<SiteData, 'footprints'>, ref: string): SourceTarget | null {
  const d = board.footprints?.find(f => f.ref === ref)?.def
  return d ? { file: d.file, start: [d.line, d.col], end: [d.endLine!, d.endCol!] } : null
}

/** Where a source link on an item goes: its footprint's placement or the innermost range that drew it, by `kind`. */
export function sourceTarget(
  board: Pick<SiteData, 'sources' | 'footprints'>,
  item: { id?: number | null; ref?: string | null },
  kind: SourceKind = 'placement',
): SourceTarget | null {
  const placed = item.ref ? placementOf(board, item.ref) : null
  if (kind === 'placement' && placed) return placed
  // a footprint body has no item of its own, so its definition comes from the footprint, not from the smallest range that lists the ref
  if (item.id == null && item.ref) {
    const def = definitionOf(board, item.ref)
    if (def) return def
  }
  const hit = resolveItem(board, item, kind === 'definition')
  return hit ? { file: hit.file, start: hit.range.start, end: hit.range.end } : placed
}

const uidOf = (board: Pick<SiteData, 'items'>, id: number | null | undefined): string | undefined => (id != null ? board.items?.find(x => x.id === id)?.uid : undefined)

/** The innermost range for an item of this view: by its uid first, then by its footprint ref. `whole` skips single path commands. */
export function resolveItem(board: Pick<SiteData, 'sources' | 'items'>, item: { id?: number | null; ref?: string | null }, whole = false): Located | null {
  const uid = uidOf(board, item.id)
  return (uid ? rangeFor(board.sources, { uid }, whole) : null) ?? (item.ref ? rangeFor(board.sources, { ref: item.ref }, whole) : null)
}

/** The path command that drew an item, such as "H 9", with its range; null for an item not drawn by one command of a path string. */
export function commandOf(board: Pick<SiteData, 'sources' | 'items'>, id: number | null | undefined): (Located & { text: string }) | null {
  const uid = uidOf(board, id)
  const hit = uid ? rangeFor(board.sources, { uid }) : null
  return hit && hit.range.seg !== undefined ? { ...hit, text: hit.range.seg } : null
}

/** "main.tsx:30" for a range, "main.tsx:30:21" with the column for one path command, whose text the chip shows beside it. */
export function highlightLabel(h: { file: string; line: number; col?: number; seg?: string }): string {
  const head = h.line ? `${norm(h.file)}:${h.line}` : norm(h.file)
  return h.seg !== undefined && h.col ? `${head}:${h.col}` : head
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')
/** The index key for a file path from the editor: an exact match, else the longest key the path ends with. */
export function fileKey(sources: SourceIndex | undefined, file: string): string | null {
  if (!sources) return null
  const f = norm(file)
  let best: string | null = null
  for (const key of Object.keys(sources)) {
    const k = norm(key)
    if (k === f) return key
    if (f.endsWith('/' + k) && (!best || k.length > norm(best).length)) best = key
  }
  return best
}

/** The innermost range containing a cursor, with the item uids and refs of it and of every range nested inside it. Lines and columns are 1-based. */
export function resolveCursor(sources: SourceIndex | undefined, file: string, line: number, col: number): CursorHit | null {
  const key = fileKey(sources, file)
  if (!key) return null
  const ranges = sources![key]
  const hit = smallest(ranges.filter(r => contains(r, [line, col])).map(range => ({ file: key, range })))
  if (!hit) return null
  return { file: key, range: hit.range, ...itemsIn(ranges, hit.range) }
}

/** The item uids and refs of a range and of every range of the same file nested inside it. */
export function itemsIn(ranges: SourceRange[], outer: SourceRange): { uids: string[]; refs: string[] } {
  const uids = new Set(outer.uids),
    refs = new Set(outer.refs)
  for (const r of ranges)
    if (r !== outer && within(r, outer)) {
      for (const u of r.uids) uids.add(u)
      for (const s of r.refs) refs.add(s)
    }
  return { uids: [...uids], refs: [...refs] }
}

/** The page of a range on the repository host. `dir` is '' or ends with '/'. */
export function repoUrl(repo: RepoLink, file: string, range: Pick<SourceRange, 'start' | 'end'>): string {
  const base = repo.url.replace(/\/+$/, '')
  const seg = (p: string) => p.split('/').map(encodeURIComponent).join('/')
  const path = seg(repo.dir + norm(file)),
    ref = seg(repo.ref)
  const a = range.start[0],
    b = range.end[0]
  switch (repo.kind) {
    case 'github':
      return `${base}/blob/${ref}/${path}#L${a}-L${b}`
    case 'gitlab':
      return `${base}/-/blob/${ref}/${path}#L${a}-${b}`
    case 'gitea':
      return `${base}/src/${ref}/${path}#L${a}-L${b}`
    case 'bitbucket':
      return `${base}/src/${ref}/${path}#lines-${a}:${b}`
    default:
      return `${base}/${path}#L${a}`
  }
}

/** The query of the dev open endpoint: the range, or a bare position when only a footprint's `src` is known. */
export function openQuery(file: string, at: Pick<SourceRange, 'start'> & Partial<Pick<SourceRange, 'end'>> & { pad?: string; board?: string; at?: true }): string {
  const q = new URLSearchParams({ file, line: String(at.start[0]), col: String(at.start[1]) })
  if (at.end) {
    q.set('endLine', String(at.end[0]))
    q.set('endCol', String(at.end[1]))
  }
  if (at.pad) {
    q.set('pad', at.pad)
    if (at.board) q.set('board', at.board)
  }
  if (at.at) q.set('at', '1')
  return q.toString()
}

/** "main.tsx:18:5 to 18:92", or "main.tsx:18:5" for a range that starts and ends at one point. */
export function rangeLabel(file: string, r: Pick<SourceRange, 'start' | 'end'>): string {
  const name = norm(file)
  const head = `${name}:${r.start[0]}:${r.start[1]}`
  return cmp(r.start, r.end) === 0 ? head : `${head} to ${r.end[0]}:${r.end[1]}`
}

/** The footprint ref of every item uid, for views that only know footprints. */
export function refsOfUids(board: Pick<SiteData, 'items'>, uids: Iterable<string>): Set<string> {
  const want = new Set(uids),
    refs = new Set<string>()
  for (const it of board.items ?? []) if (it.ref && it.uid && want.has(it.uid)) refs.add(it.ref)
  return refs
}

/** The pad number of a pad item, for a click that should open the pad's key in the code. */
export const padOf = (board: Pick<SiteData, 'items'>, id: number): string | null => board.items?.find(it => it.id === id)?.pad ?? null
