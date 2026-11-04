// The text of a viewer tool's edit: a placement's `at` and `side`, a chain call's point, an automatic waypoint; offsets are UTF-16 code units.
import ts from 'typescript'
import { formatNum, parseToken, LENGTH_UNITS, ANGLE_UNITS, type Token } from '@pcbjs/core/internal/units'

import { toSite, type OffsetEdit, type Site } from '@pcbjs/core/internal/textdoc'
export { textDoc, diffEdit, toPosition, toSite, toRange, type TextDoc, type Site, type Span, type OffsetEdit } from '@pcbjs/core/internal/textdoc'
type Pt = [number, number]

/** The 1-based site of an offset in a syntax tree. */
export const siteIn = (sf: ts.SourceFile, offset: number): Site => toSite(sf.getLineAndCharacterOfPosition(offset))

/** One JSX attribute: the whole of it, and its literal's inner text when it is a string literal. */
export interface Attr {
  start: number
  end: number
  /** the inner text of a string literal, absent for an expression the tools cannot rewrite */
  value?: { start: number; end: number; text: string }
}
/** A JSX element starting at an offset, its tag and the `at` and `side` attributes. */
export interface Element {
  tag: string
  /** where a new attribute goes: after the last attribute, before `/>` or `>` */
  insert: number
  spreadEnd?: number
  at?: Attr
  side?: Attr
  /** each attribute's text by name, `g={CH1}` as `{CH1}` */
  attrs: Record<string, { text: string; expr: string | null; start: number; end: number }>
  /** the other attributes as written, for a copy of the element */
  others: string[]
  /** the offset of the self-closing `/>`, or of the closing tag `</Tag>` */
  close: { at: number; self: boolean }
  end: number
}

const unwrap = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression
  return e
}

/** The element whose `<` is at `offset`; null when none starts there. */
export function elementAt(sf: ts.SourceFile, offset: number): Element | null {
  let out: Element | null = null
  const visit = (n: ts.Node): void => {
    if (out) return
    const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null
    if (open && n.getStart(sf) === offset) {
      const attrs = open.attributes.properties
      const self = ts.isJsxSelfClosingElement(n)
      const close = { at: self ? n.end - 2 : (n as ts.JsxElement).closingElement.getStart(sf), self }
      const el: Element = { tag: open.tagName.getText(sf), insert: attrs.length ? attrs[attrs.length - 1].end : open.tagName.end, attrs: {}, others: [], close, end: n.end }
      for (const a of attrs) {
        if (ts.isJsxSpreadAttribute(a)) el.spreadEnd = a.end
        if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name)) {
          const init = a.initializer
          const expr = init && ts.isJsxExpression(init) && init.expression ? init.expression.getText(sf) : null
          el.attrs[a.name.text] = { text: a.getText(sf), expr, start: a.getStart(sf), end: a.end }
          if (a.name.text !== 'at' && a.name.text !== 'side') el.others.push(a.getText(sf))
        } else el.others.push(a.getText(sf))
        if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name) || (a.name.text !== 'at' && a.name.text !== 'side')) continue
        const init = a.initializer
        const lit =
          init && ts.isStringLiteral(init)
            ? init
            : init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(unwrap(init.expression))
              ? (unwrap(init.expression) as ts.StringLiteral)
              : null
        const attr: Attr = { start: a.getStart(sf), end: a.end, ...(lit ? { value: { start: lit.getStart(sf) + 1, end: lit.end - 1, text: lit.text } } : {}) }
        el[a.name.text] = attr
      }
      out = el
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** How a position is written: grid units under a grid, explicit mm for a free drag under one, else bare mm; a field written with a unit keeps it. */
export interface AtStyle {
  /** the pitch of the grid in effect, mm */
  pitch: number | null
  /** cmd or ctrl lifted snapping */
  free: boolean
}

const UNIT_RE = /[a-z]+$/i
/** A length in mm in the unit `was` was written in; bare numbers are grid units under a grid, explicit mm when free there. */
function writeLength(mm: number, was: Token | undefined, o: AtStyle): string {
  if (was?.unit) return formatNum(mm / (LENGTH_UNITS[was.unit] ?? 1), 3) + was.unit
  if (o.pitch === null) return formatNum(mm, 3)
  return o.free ? `${formatNum(mm, 3)}mm` : formatNum(mm / o.pitch, 3)
}
function writeAngle(deg: number, was: Token | undefined): string {
  const d = ((deg % 360) + 360) % 360
  const n = d > 180 + 1e-9 ? d - 360 : d
  if (was?.unit) return formatNum(n / (ANGLE_UNITS[was.unit] ?? 1), 4) + was.unit
  return formatNum(n, 1)
}

/** The new text of an `at` for a position in mm in its frame, pitches applied, and a rotation in degrees; `old` as written keeps its units and an absent zero rotation stays absent. */
export function writeAt(x: number, y: number, rot: number, old: string | undefined, o: AtStyle): string {
  const toks = (old ?? '').trim().split(/\s+/).filter(Boolean)
  const tok = (i: number) => (toks[i] && toks[i] !== 'auto' ? parseToken(toks[i]) : undefined)
  const keep = (i: number, s: string) => (toks[i] === 'auto' ? 'auto' : s)
  const parts = [keep(0, writeLength(x, tok(0), o)), keep(1, writeLength(y, tok(1), o))]
  const turned = Math.abs((((rot % 360) + 540) % 360) - 180) > 1e-6
  if (toks[2] !== undefined || turned) parts.push(keep(2, writeAngle(rot, tok(2))))
  return parts.join(' ')
}

/** The rotation an `at` is written with, degrees; 0 when it has none. */
export function atRotation(at: string | undefined): number {
  const t = at?.trim().split(/\s+/)[2]
  const tok = t && t !== 'auto' ? parseToken(t) : undefined
  return tok ? tok.num * (ANGLE_UNITS[tok.unit] ?? 1) : 0
}

/** The edit that sets the element's `at`: its literal, or the whole attribute when it was an expression, `at={at}` becoming `at="7 10"`. */
export function setAt(el: Element, value: string): OffsetEdit {
  if (!el.at) return { start: el.insert, end: el.insert, newText: ` at="${value}"` }
  if (!el.at.value) return { start: el.at.start, end: el.at.end, newText: `at="${value}"` }
  return { start: el.at.value.start, end: el.at.value.end, newText: value }
}

/** The edit that puts `child` among an element's children, on a line of its own; a self-closing element gets a closing tag. */
export function addChild(text: string, el: Element, start: number, child: string): OffsetEdit {
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', start - 1) + 1))![0]
  if (el.close.self) {
    let s = el.close.at
    while (s > 0 && /[ \t]/.test(text[s - 1])) s--
    return { start: s, end: el.end, newText: `>\n${indent}  ${child}\n${indent}</${el.tag}>` }
  }
  const line = text.lastIndexOf('\n', el.close.at - 1) + 1
  if (/^[ \t]*$/.test(text.slice(line, el.close.at))) return { start: line, end: line, newText: `${indent}  ${child}\n` }
  return { start: el.close.at, end: el.close.at, newText: child }
}

/** The edit that puts the element on side B, `side="B"` inserted, or back on F with the attribute deleted; null when its side is computed. */
export function setSide(text: string, el: Element, side: 'F' | 'B'): OffsetEdit | null {
  if (el.side && !el.side.value) return null
  if (side === 'B') return el.side ? { start: el.side.value!.start, end: el.side.value!.end, newText: 'B' } : { start: el.insert, end: el.insert, newText: ' side="B"' }
  if (!el.side) return null
  let s = el.side.start
  while (s > 0 && /[ \t]/.test(text[s - 1])) s--
  return { start: s, end: el.side.end, newText: '' }
}

/** One chain call: `.L(5, 16)` from its dot, its method, its arguments as written and offsets. */
export interface ChainCall {
  method: string
  dot: number
  name: number
  end: number
  args: { start: number; end: number; text: string; kind: 'number' | 'string' | 'other'; quote?: string }[]
}

/** Change the selected segment's via stage, or the route's initial layer. */
export function routeLayer(sf: ts.SourceFile, offset: number, layer: string): OffsetEdit | null {
  let selected: ts.CallExpression | undefined
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.getStart(sf) === offset) selected = n
    if (!selected) ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!selected) return null
  let top: ts.CallExpression = selected
  while (ts.isPropertyAccessExpression(top.parent) && ts.isCallExpression(top.parent.parent)) top = top.parent.parent
  const calls: ts.CallExpression[] = []
  let current: ts.Expression = top
  while (ts.isCallExpression(current)) {
    calls.unshift(current)
    if (!ts.isPropertyAccessExpression(current.expression)) break
    current = current.expression.expression
  }
  let stage: ts.CallExpression | undefined, initial: ts.CallExpression | undefined
  for (const call of calls) {
    const name = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ''
    if (name === 'layer') initial = call
    if (call.getStart(sf) <= selected.getStart(sf) && call.end <= selected.end && ['via', 'cross'].includes(name)) stage = call
  }
  const target = stage ?? initial
  if (target) {
    const argument = target.arguments[0]
    if (!argument || !ts.isStringLiteral(argument)) return null
    return { start: argument.getStart(sf), end: argument.end, newText: JSON.stringify(layer) }
  }
  const root = calls[0]
  return root ? { start: root.end, end: root.end, newText: `.layer(${JSON.stringify(layer)})` } : null
}

/** The chain call whose method name starts at `offset`; null when none does. */
export function chainCallAt(sf: ts.SourceFile, offset: number): ChainCall | null {
  const text = sf.text
  let out: ChainCall | null = null
  const visit = (n: ts.Node): void => {
    if (out || offset < n.pos || offset >= n.end) return
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.getStart(sf) === offset) {
      const dot = n.expression
        .getChildren(sf)
        .find(child => child.kind === ts.SyntaxKind.DotToken)
        ?.getStart(sf)
      if (dot === undefined) return
      out = {
        method: n.expression.name.text,
        dot,
        name: offset,
        end: n.end,
        args: n.arguments.map(a => {
          const e = unwrap(a)
          const kind = ts.isNumericLiteral(e) || (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) ? 'number' : ts.isStringLiteral(e) ? 'string' : 'other'
          return { start: a.getStart(sf), end: a.end, text: a.getText(sf), kind, ...(kind === 'string' ? { quote: text[a.getStart(sf)] } : {}) }
        }),
      }
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const num = (v: number) => formatNum(v, 3)
/** A coordinate argument rewritten in its own form: a number stays a number, a string keeps its unit and quote. */
function writeArg(a: ChainCall['args'][number], mm: number): string | null {
  if (a.kind === 'number') return num(mm)
  if (a.kind !== 'string') return null
  const t = parseToken(a.text.slice(1, -1))
  if (!t) return null
  return `${a.quote}${t.unit ? formatNum(mm / (LENGTH_UNITS[t.unit] ?? 1), 3) + t.unit : num(mm)}${a.quote}`
}
/** A waypoint string `'x y'` in mm. */
const waypoint = (p: Pt, q = "'") => `${q}${num(p[0])} ${num(p[1])}${q}`

/**
 * The edits that move the end of a chain call to `to`, in the route's frame, `from` being where the call starts; the next call, when relative,
 * is rewritten so its end stays at `next`. Null when the call's arguments are not literals the tool can rewrite.
 */
export function movePoint(call: ChainCall, from: Pt, to: Pt, after?: { call: ChainCall; end: Pt }): OffsetEdit[] | null {
  const own = callArgs(call, from, to)
  if (!own) return null
  if (!after || !/^[lhva]$/.test(after.call.method)) return own
  const next = keepPoint(after.call, to, after.end)
  return next ? [...own, ...next] : null
}

/** Preserve an endpoint when its start moves, promoting a relative axis to a line when necessary. */
export function keepPoint(call: ChainCall, from: Pt, to: Pt): OffsetEdit[] | null {
  if ((/^[Hh]$/.test(call.method) && Math.abs(to[1] - from[1]) > 1e-6) || (/^[Vv]$/.test(call.method) && Math.abs(to[0] - from[0]) > 1e-6)) {
    if (call.args.some(a => a.kind === 'other')) return null
    const relative = call.method === call.method.toLowerCase()
    return [{ start: call.name, end: call.end, newText: relative ? `l(${num(to[0] - from[0])}, ${num(to[1] - from[1])})` : `L(${num(to[0])}, ${num(to[1])})` }]
  }
  return callArgs(call, from, to)
}

/** The arguments of one call so it runs from `from` to `to`. */
function callArgs(call: ChainCall, from: Pt, to: Pt): OffsetEdit[] | null {
  const set = (i: number, mm: number): OffsetEdit | null => {
    const a = call.args[i]
    const t = a && writeArg(a, mm)
    return t === null || t === undefined ? null : { start: a.start, end: a.end, newText: t }
  }
  const all = (list: (OffsetEdit | null)[]) => (list.some(e => e === null) ? null : (list as OffsetEdit[]))
  const one = call.args.length === 1 && call.args[0].kind === 'string' && /^[LX]$/.test(call.method)
  switch (call.method) {
    case 'L':
    case 'X':
      if (one) return [{ start: call.args[0].start, end: call.args[0].end, newText: waypoint(to, call.args[0].quote) }]
      return call.method === 'L' ? all([set(0, to[0]), set(1, to[1])]) : null
    case 'A':
      return all([set(0, to[0]), set(1, to[1])])
    case 'l':
    case 'a':
      return all([set(0, to[0] - from[0]), set(1, to[1] - from[1])])
    case 'H':
      return all([set(0, to[0])])
    case 'h':
      return all([set(0, to[0] - from[0])])
    case 'V':
      return all([set(0, to[1])])
    case 'v':
      return all([set(0, to[1] - from[1])])
    default:
      return null
  }
}

/** An automatic waypoint `.X('x y')` before the call at `dot`, or at the chain's end. */
export const insertWaypoint = (at: number, p: Pt): OffsetEdit => ({ start: at, end: at, newText: `.X(${waypoint(p)})` })

/** A control point `.L('x y')` inserted at `at`, after the call it follows. */
export const insertPoint = (at: number, p: Pt): OffsetEdit => ({ start: at, end: at, newText: `.L(${waypoint(p)})` })

/** The call and its dot removed, for Delete on a control point. */
export const deleteCall = (call: ChainCall): OffsetEdit => ({ start: call.dot, end: call.end, newText: '' })

/** The end of the builder chain of the `route(` call starting at `offset`; null when none starts there. */
export function chainEndOf(sf: ts.SourceFile, offset: number): number | null {
  let out: number | null = null
  const visit = (n: ts.Node): void => {
    if (out !== null) return
    if (ts.isCallExpression(n) && n.getStart(sf) === offset && !ts.isPropertyAccessExpression(n.expression)) {
      let top: ts.Node = n
      while (top.parent && ts.isPropertyAccessExpression(top.parent) && top.parent.parent && ts.isCallExpression(top.parent.parent) && top.parent.parent.expression === top.parent)
        top = top.parent.parent
      out = top.end
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Persist an editing pitch without replacing a group's named coordinate grid. */
export function setGrid(el: Element, pitch: number): OffsetEdit | null {
  const attr = el.attrs.grid
  if (el.spreadEnd !== undefined && (!attr || el.spreadEnd > attr.start)) return null
  const expr = attr?.expr
  let value = `{ snap: ${pitch} }`
  if (expr) {
    const sf = ts.createSourceFile('grid.ts', `(${expr})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const statement = sf.statements[0]
    const object = statement && ts.isExpressionStatement(statement) ? unwrap(statement.expression) : null
    const last = object && ts.isObjectLiteralExpression(object) ? object.properties.at(-1) : undefined
    if (last && ts.isPropertyAssignment(last) && (ts.isIdentifier(last.name) || ts.isStringLiteral(last.name)) && last.name.text === 'snap') {
      value = expr.slice(0, last.initializer.getStart(sf) - 1) + pitch + expr.slice(last.initializer.end - 1)
    } else value = `{ ...(${expr}), snap: ${pitch} }`
  }
  return attr ? { start: attr.start, end: attr.end, newText: `grid={${value}}` } : { start: el.insert, end: el.insert, newText: ` grid={${value}}` }
}
