// Units as the editor shows them: each bare number of a length, position or rotation gets its inferred unit, a position under a grid the
// grid's pitch, and the numbers, units and layers inside a coordinate string are tokens of their own; offsets are UTF-16 code units.
import ts from 'typescript'
import { detect, NUMERIC_KINDS, type Hit } from './detect.js'
import { chainCallAt, siteIn } from './edits.js'
import { CHAIN, isChain, type ChainSpec } from '@pcbjs/core/internal/syntax'
import { LENGTH_UNITS, ANGLE_UNITS, parseToken } from '@pcbjs/core/internal/units'
import type { Position } from '@pcbjs/core/protocol'

/** The grid a placement's `at` is written in, as the hint names it. */
export interface HintGrid {
  name: string
  pitch: number
  origin: [number, number]
  angle: number
  /** where cmd+click on the glyph goes: the defineGrid call, else the element that attaches the grid */
  at?: { file: string; line: number; col: number }
}
/** A hint after a bare number: its unit, or under a grid the grid's glyph and pitch. */
export interface UnitHint {
  offset: number
  unit: 'mm' | 'deg'
  grid?: HintGrid
}
export type TokenType = 'number' | 'unit' | 'layer'
export interface UnitToken {
  start: number
  end: number
  type: TokenType
}

/** Names the grid of the element starting at a 1-based line and column, null when it has none. */
export type GridOf = (line: number, col: number) => HintGrid | null
export interface Units {
  hints: UnitHint[]
  tokens: UnitToken[]
  bad: { start: number; end: number; message: string }[]
}
/** A hint of a position's coordinate, with the element whose grid it may be in. */
type Mark = UnitHint & { el?: { line: number; col: number } }

/** The hints and tokens of a file, each coordinate hint under its element's grid. */
export const unitsOf = (sf: ts.SourceFile, gridOf?: GridOf): Units => withGrids(unitMarks(sf), gridOf)

/** The hints with the grid `gridOf` gives each coordinate's element. */
export function withGrids(u: Units, gridOf?: GridOf): Units {
  const hints = u.hints.map(({ el, ...h }: Mark) => {
    const grid = el && gridOf?.(el.line, el.col)
    return grid ? { ...h, grid } : h
  })
  return { ...u, hints }
}

/** The hints and tokens of a file, a coordinate's hint carrying the element it places instead of a grid. */
export function unitMarks(sf: ts.SourceFile): Units {
  const hints: Mark[] = []
  const tokens: UnitToken[] = []
  const bad: { start: number; end: number; message: string }[] = []
  let hits: Hit[] = []
  try {
    hits = detect(sf)
  } catch {
    return { hints, tokens, bad }
  }
  const at = placements(sf)
  /** One token of a string: a number with its unit, a layer, or `auto`; a bare number takes `unit` as a hint. */
  const token = (start: number, s: string, unit: 'mm' | 'deg' | 'layer', el?: { line: number; col: number }) => {
    if (s === 'auto') return
    if (unit === 'layer') {
      tokens.push({ start, end: start + s.length, type: 'layer' })
      return
    }
    const t = parseToken(s)
    if (!t) return
    const num = start + s.length - t.unit.length
    tokens.push({ start, end: num, type: 'number' })
    if (t.unit) {
      const kinds = unit === 'deg' ? ANGLE_UNITS : LENGTH_UNITS
      if (t.unit in kinds) tokens.push({ start: num, end: start + s.length, type: 'unit' })
      else bad.push({ start: num, end: start + s.length, message: `unknown unit ${t.unit}: use ${Object.keys(kinds).filter(Boolean).join(', ')}` })
      return
    }
    hints.push({ offset: start + s.length, unit, ...(el ? { el } : {}) })
  }
  /** Each whitespace-separated word of a string literal with its offset. */
  const words = (start: number, value: string) => [...value.matchAll(/\S+/g)].map(w => ({ at: start + w.index!, s: w[0] }))

  for (const h of hits) {
    const own = at.get(h.start)
    if (h.kind === 'at' && h.context.quote !== 'number') words(h.start, h.value).forEach((w, i) => token(w.at, w.s, i < 2 ? 'mm' : 'deg', i < 2 ? own : undefined))
    else if (h.kind === 'point') words(h.start, h.value).forEach((w, i) => token(w.at, w.s, i < 2 ? 'mm' : 'layer'))
    else if (NUMERIC_KINDS.has(h.kind)) {
      if (h.context.quote === 'number') hints.push({ offset: h.end, unit: 'mm' })
      else token(h.start, h.value.trim(), 'mm')
    } else if (h.kind === 'layer') tokens.push({ start: h.start, end: h.end, type: 'layer' })
    else if (h.kind === 'chainCommand') chainUnits(sf, h, hints, tokens, token)
  }
  tokens.sort((a, b) => a.start - b.start)
  hints.sort((a, b) => a.offset - b.offset)
  return { hints, tokens, bad }
}

/** The arguments of a geometric chain call: lengths in mm, an arc's angle in degrees, a via's layer. */
function chainUnits(sf: ts.SourceFile, h: Hit, hints: UnitHint[], tokens: UnitToken[], token: (start: number, s: string, unit: 'mm' | 'deg' | 'layer') => void): void {
  const call = chainCallAt(sf, h.start)
  if (!call || !isChain(call.method)) return
  const c: ChainSpec = CHAIN[call.method]
  call.args.forEach((a, i) => {
    const kind = c.args[i]
    if (kind === 'layer') {
      if (a.kind === 'string') tokens.push({ start: a.start + 1, end: a.end - 1, type: 'layer' })
      return
    }
    const unit = kind === 'angle' ? 'deg' : 'mm'
    if (!kind) return
    if (a.kind === 'number') hints.push({ offset: a.end, unit })
    else if (a.kind === 'string' && !(c.waypoint && call.args.length === 1)) token(a.start + 1, a.text.slice(1, -1).trim(), unit)
  })
}

/** The 1-based line and column of the innermost JSX element whose tag holds the offset, null when none does. */
export function elementAround(sf: ts.SourceFile, offset: number): { line: number; col: number } | null {
  let out: { line: number; col: number } | null = null
  const visit = (n: ts.Node): void => {
    if (offset < n.pos || offset >= n.end) return
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.getStart(sf) < offset && offset < n.end) {
      const el = ts.isJsxOpeningElement(n) && ts.isJsxElement(n.parent) ? n.parent : n
      out = siteIn(sf, el.getStart(sf))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Each JSX `at` string literal by the offset of its inner text, with the 1-based line and column of its element. */
function placements(sf: ts.SourceFile): Map<number, { line: number; col: number }> {
  const out = new Map<number, { line: number; col: number }>()
  const visit = (n: ts.Node): void => {
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'at' && n.initializer && ts.isStringLiteral(n.initializer)) {
      const el = n.parent.parent
      const start = (ts.isJsxOpeningElement(el) && ts.isJsxElement(el.parent) ? el.parent : el).getStart(sf)
      out.set(n.initializer.getStart(sf) + 1, siteIn(sf, start))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** The label of a grid hint: the dot, the glyph and the pitch, `3·⊞2.54mm`. */
export const GRID_GLYPH = '⊞'
export const gridLabel = (g: HintGrid) => [`·`, GRID_GLYPH, `${Math.round(g.pitch * 1e4) / 1e4}mm`] as const
export const gridTooltip = (g: HintGrid) =>
  `grid ${g.name}: pitch ${Math.round(g.pitch * 1e4) / 1e4} mm, origin ${g.origin.map(v => Math.round(v * 1e3) / 1e3).join(' ')}${g.angle ? `, angle ${Math.round(g.angle * 100) / 100}°` : ''}`

/** The semantic token types this server offers, in legend order; `unit` and `layer` are its own. */
export const TOKEN_TYPES: readonly TokenType[] = ['number', 'unit', 'layer']

/** Tokens in the relative encoding of `textDocument/semanticTokens`. */
export function encodeTokens(pos: (offset: number) => Position, list: UnitToken[]): number[] {
  const out: number[] = []
  let pl = 0,
    pc = 0
  for (const t of list) {
    const { line: l, character: c } = pos(t.start)
    out.push(l - pl, l === pl ? c - pc : c, t.end - t.start, TOKEN_TYPES.indexOf(t.type), 0)
    pl = l
    pc = c
  }
  return out
}
