// The block an edit is in and whether it parses, for the compile hold; docs/vscode.md, Drafts, has the rules.

import ts from 'typescript'
import { parse, type DocModel } from './doc.js'

/** A statement, a JSX tag or child, or the lines of JSX text or of a gap between statements, as offsets of the text after the edit. */
export interface Block {
  start: number
  end: number
  /** what the block's text is parsed inside: statements bare, JSX in a fragment, an opening tag with its closing one */
  wrap: [string, string]
}

const BARE: [string, string] = ['', '']
const FRAGMENT: [string, string] = ['<>', '</>']

/** Where `after` differs from `before`: `[start, end)` of before became `[start, end + delta)`; null when they are equal. */
export function changedSpan(before: string, after: string): { start: number; end: number; delta: number } | null {
  if (before === after) return null
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let tail = 0
  while (tail < max - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++
  return { start, end: before.length - tail, delta: after.length - before.length }
}

/** A statement in a list of them, the unit an edit holds. */
const inList = (n: ts.Node) => {
  const list = (n.parent as { statements?: ts.NodeArray<ts.Node> } | undefined)?.statements
  return !!list && list.includes(n)
}
const jsxChild = (n: ts.Node) =>
  (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxExpression(n) || ts.isJsxFragment(n)) && !!n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))

/** The innermost node of `sf` holding `[start, end]`. */
function deepest(sf: ts.SourceFile, start: number, end: number): ts.Node {
  let n: ts.Node = sf
  for (;;) {
    const c: ts.Node | undefined = n.forEachChild(k => (k.getStart(sf) <= start && end <= k.end ? k : undefined))
    if (!c) return n
    n = c
  }
}

/** The lines of `text` around `[start, end]`. */
function lines(text: string, start: number, end: number): { start: number; end: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const to = text.indexOf('\n', end)
  return { start: from, end: to < 0 ? text.length : to }
}

/** The block of `text` around `[start, end]`, in its own offsets; null when the range is in none, such as a class member. */
export function blockAt(sf: ts.SourceFile, start: number, end: number): Block | null {
  const text = sf.text
  const inner = deepest(sf, start, end)
  if (ts.isJsxText(inner) || ((ts.isJsxElement(inner) || ts.isJsxFragment(inner)) && !inTag(inner, start, sf))) return { ...lines(text, start, end), wrap: FRAGMENT }
  if (ts.isSourceFile(inner) || ts.isBlock(inner) || ts.isModuleBlock(inner)) return { ...lines(text, start, end), wrap: BARE }
  for (let n: ts.Node | undefined = inner; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isJsxOpeningElement(n)) return { start: n.getStart(sf), end: n.end, wrap: ['<>', `</${n.tagName.getText(sf)}></>`] }
    if (ts.isJsxSelfClosingElement(n) || jsxChild(n)) return { start: n.getStart(sf), end: n.end, wrap: FRAGMENT }
    if (inList(n)) return { start: n.getStart(sf), end: n.end, wrap: BARE }
  }
  return null
}

/** True when `at` is inside the element's opening or closing tag rather than among its children. */
function inTag(n: ts.JsxElement | ts.JsxFragment, at: number, sf: ts.SourceFile): boolean {
  const open = ts.isJsxElement(n) ? n.openingElement : n.openingFragment
  const close = ts.isJsxElement(n) ? n.closingElement : n.closingFragment
  return at < open.end || at >= close.getStart(sf)
}

/** The block an edit from `before` to `after` is in, in the offsets of `after`: the held one when the edit stays in it, else the one around it in `before`. */
export function changedBlock(before: DocModel, after: string, held?: Block | null): Block | null {
  const c = changedSpan(before.text, after)
  if (!c) return held ?? null
  if (held && held.start <= c.start && c.end <= held.end) return { ...held, end: held.end + c.delta }
  const b = blockAt(before.sf(), c.start, c.end)
  return b && { ...b, end: b.end + c.delta }
}

/** The offset of the first syntax error of the block parsed on its own, null when it parses. */
export function blockError(text: string, file: string, b: Block): number | null {
  const [head, tail] = b.wrap
  const src = head + text.slice(b.start, b.end) + tail
  const sf = parse(src, file, false)
  const diags = (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? []
  if (!diags.length) return null
  const first = Math.min(...diags.map(d => d.start))
  return Math.max(b.start, Math.min(b.end, b.start + first - head.length))
}
