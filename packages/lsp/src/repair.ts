// Makes an unsaved buffer compile for the preview; docs/editor.md, Drafts, has the rules.

import ts from 'typescript'

export interface Span {
  start: number
  end: number
}

export interface Repaired {
  /** the overlay with each skipped span blanked and the closers inserted; offsets before `limit` are the overlay's own */
  text: string
  /** blanked spans, in the overlay's offsets */
  skipped: Span[]
  /** where the first closer went in, null when none did; an offset at or past it maps to `limit - 1` */
  limit: number | null
  /** the text parses without syntax errors */
  ok: boolean
}

const DROPS = 4
const CLOSERS = 16
const CLOSABLE = new Set([')', ']', '}', '>', '/', '/>', '`'])
const NO_CLOSING_TAG = 17008
const NO_CLOSING_FRAGMENT = 17014
const UNTERMINATED_STRING = 1002
const UNTERMINATED_TEMPLATE = 1160
const EXPECTED = 1005

interface Diag {
  start: number
  length: number
  code: number
  message: string
}

const kindOf = (file: string) => (/\.[cm]?tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS)

function parse(text: string, file: string): { sf: ts.SourceFile; diags: Diag[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file))
  const raw = (sf as unknown as { parseDiagnostics: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? []
  return { sf, diags: raw.map(d => ({ start: d.start, length: d.length, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') })) }
}

/** An offset of the repaired text in the overlay. */
export function toOverlay(r: Pick<Repaired, 'limit'>, offset: number): number {
  return r.limit !== null && offset >= r.limit ? Math.max(0, r.limit - 1) : offset
}

/** Repairs `text` until TypeScript parses it; `errors` are offsets another parser such as esbuild rejected, each one more syntax error. */
export function repair(text: string, file: string, errors: number[] = []): Repaired {
  let out = text
  let limit: number | null = null
  let added = 0
  const spans: Span[] = []
  let extra = [...errors]
  let drops = 0,
    closes = 0
  let lastClose = ''
  for (;;) {
    const { sf, diags } = parse(out, file)
    const all = [...diags, ...extra.map(start => ({ start, length: 0, code: 0, message: '' }))]
    if (!all.length) break
    const tail = sf.endOfFileToken.pos
    const sig = all.map(d => `${d.start}:${d.code}`).join()
    if (closes < CLOSERS && sig !== lastClose && all.every(d => atEnd(sf, d, tail))) {
      const c = closer(sf, out, all, tail)
      if (c) {
        lastClose = sig
        closes++
        out = out.slice(0, c.at) + c.text + out.slice(c.at)
        if (limit === null) limit = c.at
        added += c.text.length
        continue
      }
    }
    if (drops >= DROPS) break
    const d = all.slice().sort((a, b) => a.start - b.start)[0]
    const span = dropSpan(sf, d)
    if (!span) break
    drops++
    out = out.slice(0, span.start) + blank(out.slice(span.start, span.end)) + out.slice(span.end)
    absorb(spans, span, out)
    spans.push(span)
    extra = extra.filter(p => p < span.start || p >= span.end)
  }
  const ok = !parse(out, file).diags.length && !extra.length
  const back = (o: number) => Math.min(toOverlay({ limit }, o), text.length)
  const skipped = spans.map(s => ({ start: back(s.start), end: Math.max(back(s.start), Math.min(back(s.end - 1) + 1, text.length)) })).filter(s => s.end > s.start)
  return { text: out, skipped: merge(skipped), limit: added ? limit : null, ok }
}

const blank = (s: string) => s.replace(/[^\r\n]/g, ' ')

/** A diagnostic only closing tokens can fix: at the end of the last token, or an element still open there. */
function atEnd(sf: ts.SourceFile, d: Diag, tail: number): boolean {
  if (d.code === NO_CLOSING_TAG || d.code === NO_CLOSING_FRAGMENT) return (unclosed(sf, d)?.end ?? tail) >= tail
  return d.start >= tail && (d.code === UNTERMINATED_STRING || d.code === UNTERMINATED_TEMPLATE || (d.code === EXPECTED && expected(d) !== undefined))
}

/** The element or fragment a missing closing tag diagnostic names. */
function unclosed(sf: ts.SourceFile, d: Diag): ts.JsxElement | ts.JsxFragment | undefined {
  let n = innermost(sf, d.start)
  while (n && !ts.isJsxElement(n) && !ts.isJsxFragment(n)) n = n.parent
  return n
}

function expected(d: Diag): string | undefined {
  const m = /^'(.+)' expected\.$/.exec(d.message)
  return m && CLOSABLE.has(m[1]) ? m[1] : m?.[1] === '</' ? '' : undefined
}

/** The innermost closer the end of the file waits for: a quote, then a bracket or tag end, then the innermost open element. */
function closer(sf: ts.SourceFile, text: string, diags: Diag[], tail: number): { at: number; text: string } | undefined {
  const str = diags.find(d => d.code === UNTERMINATED_STRING || d.code === UNTERMINATED_TEMPLATE)
  if (str) {
    const node = innermost(sf, Math.max(0, str.start - 1))
    const q = node ? text[node.getStart(sf)] : undefined
    return { at: str.start, text: str.code === UNTERMINATED_TEMPLATE ? '`' : q === '"' || q === "'" ? q : '"' }
  }
  const tok = diags.map(expected).find(t => t)
  if (tok) return { at: tail, text: tok }
  const open = diags.filter(d => d.code === NO_CLOSING_TAG || d.code === NO_CLOSING_FRAGMENT).sort((a, b) => b.start - a.start)[0]
  if (!open) return undefined
  if (open.code === NO_CLOSING_FRAGMENT) return { at: tail, text: '</>' }
  const name = /'(.+)'/.exec(open.message)?.[1]
  return name ? { at: tail, text: `</${name}>` } : undefined
}

function innermost(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let found: ts.Node | undefined
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) <= pos && pos < n.end) {
      found = n
      n.forEachChild(visit)
    }
  }
  sf.forEachChild(visit)
  return found
}

const ERR = ts.NodeFlags.ThisNodeHasError

/** The nearest node TypeScript flagged at or before `pos`, else undefined. */
function flagged(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let best: ts.Node | undefined
  const visit = (n: ts.Node) => {
    if (n.getStart(sf) > pos) return
    if (n.flags & ERR && (!best || n.getStart(sf) >= best.getStart(sf))) best = n
    n.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return best
}

function droppable(n: ts.Node): boolean {
  const p = n.parent
  if (!p) return false
  if (ts.isSourceFile(p) || ts.isBlock(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) return true
  if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxExpression(n) || ts.isJsxFragment(n)
  if (ts.isJsxAttributes(p)) return true
  return ts.isObjectLiteralExpression(p)
}

/** The span to blank for a syntax error: the smallest droppable node around it, or a stray token between statements. */
function dropSpan(sf: ts.SourceFile, d: Diag): Span | undefined {
  if (d.code === NO_CLOSING_TAG || d.code === NO_CLOSING_FRAGMENT) {
    // an element closed nowhere inside its parent: without its opening tag, its children join the parent
    const el = unclosed(sf, d)
    const open = el && (ts.isJsxElement(el) ? el.openingElement : el.openingFragment)
    if (open) return { start: open.getStart(sf), end: open.end }
  }
  const inner = innermost(sf, d.start)
  if (!inner && d.length > 0) return { start: d.start, end: d.start + d.length }
  let n: ts.Node | undefined = (d.code ? flagged(sf, d.start) : undefined) ?? inner
  while (n && !ts.isSourceFile(n) && !droppable(n)) n = n.parent
  if (!n || ts.isSourceFile(n)) return d.length > 0 ? { start: d.start, end: d.start + d.length } : undefined
  return { start: n.getStart(sf), end: n.end }
}

/** An earlier span the new one reaches up to the next token, such as an attribute of the element now dropped, joins it. */
function absorb(spans: Span[], span: Span, text: string): void {
  let reach = span.end
  while (reach < text.length && /\s/.test(text[reach])) reach++
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].start < span.start || spans[i].start >= reach) continue
    span.end = Math.max(span.end, spans[i].end)
    spans.splice(i, 1)
  }
}

function merge(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const s of spans.slice().sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}
