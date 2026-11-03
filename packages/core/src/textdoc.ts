// Positions in a text, one convention per boundary: offsets in UTF-16 code units, LSP positions zero-based, sites one-based with the last column inclusive.
import type { Position, Range, TextEdit } from './protocol.js'

/** A one-based line and column, as a compile site, a cursor or a source range gives it; `endCol` is the last column, inclusive. */
export interface Site {
  line: number
  col: number
  endLine?: number
  endCol?: number
}
/** Offsets, the end exclusive. */
export interface Span {
  start: number
  end: number
}
export interface OffsetEdit extends Span {
  newText: string
}

export const toPosition = (s: { line: number; col: number }): Position => ({ line: s.line - 1, character: s.col - 1 })
export const toSite = (p: Position): Site => ({ line: p.line + 1, col: p.character + 1 })
/** The LSP range of a site; a site without an end is empty. */
export function toRange(s: Site): Range {
  const start = toPosition(s)
  return { start, end: s.endLine !== undefined && s.endCol !== undefined ? { line: s.endLine - 1, character: s.endCol } : start }
}

export interface TextDoc {
  readonly text: string
  /** the offset each line starts at, lines split at `\n` */
  lines(): number[]
  pos(offset: number): Position
  /** a position past its line's end is the end, one past the last line the end of the text */
  offset(p: Position): number
  /** the offsets of a site, empty when it has no end */
  span(s: Site): Span
  site(offset: number): Site
  /** the site of a span, its end the span's last character */
  siteOf(s: Span): Required<Site>
  range(s: Span): Range
  edit(e: OffsetEdit): TextEdit
  /** the text with the edits applied, the last first so earlier offsets hold */
  apply(edits: TextEdit[]): string
}

export function textDoc(text: string): TextDoc {
  let starts: number[] | null = null
  const lines = () => {
    if (starts) return starts
    starts = [0]
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
    return starts
  }
  const pos = (offset: number): Position => {
    const ls = lines()
    let lo = 0,
      hi = ls.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ls[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo, character: offset - ls[lo] }
  }
  const offset = (p: Position): number => {
    const ls = lines()
    if (p.line >= ls.length) return text.length
    const line = Math.max(p.line, 0)
    const end = line + 1 < ls.length ? ls[line + 1] - 1 : text.length
    return Math.min(ls[line] + Math.max(p.character, 0), end)
  }
  const range = (s: Span): Range => ({ start: pos(s.start), end: pos(s.end) })
  const site = (o: number) => toSite(pos(o))
  return {
    text,
    lines,
    pos,
    offset,
    span: s => {
      const r = toRange(s)
      return { start: offset(r.start), end: offset(r.end) }
    },
    site,
    siteOf: s => {
      const a = site(s.start),
        z = site(Math.max(s.start, s.end - 1))
      return { ...a, endLine: z.line, endCol: z.col }
    },
    range,
    edit: e => ({ range: range(e), newText: e.newText }),
    apply: edits => {
      let out = text
      const spans = edits.map(e => ({ s: offset(e.range.start), e: offset(e.range.end), t: e.newText })).sort((a, b) => b.s - a.s || b.e - a.e)
      for (const x of spans) out = out.slice(0, x.s) + x.t + out.slice(x.e)
      return out
    },
  }
}

/** The one edit that turns `a` into `b`: the span between their common head and tail. */
export function diffEdit(a: string, b: string): OffsetEdit {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  return { start: s, end: a.length - e, newText: b.slice(s, b.length - e) }
}
