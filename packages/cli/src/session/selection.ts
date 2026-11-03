// The selection the session holds per board: set by a viewer, the tree, the editor, the URL or an agent, stamped with a seq
// and sent to every viewer of the board; a selection not set by the editor goes to the editors as one range per member.
import { isAbsolute, join, resolve } from 'node:path'
import type { Board } from '@pcbjs/core/model'
import type { EditorSelection } from '@pcbjs/lsp'
import type { Src } from '@pcbjs/core/internal/types'
import { boardIndex, parseRef, resolveRef, type Resolved } from '@pcbjs/core/ref'
import { emptySelection, isSelection, normalizeSelection, sameSelection, type Ref, type Selection, type SetBy } from '@pcbjs/core/internal/selection'
import { instanceIn } from '@pcbjs/core/internal/instances'
import ts from 'typescript'
import { textDoc } from '@pcbjs/core/internal/textdoc'

/** 1-based, `endCol` inclusive, as `pcbjs/select` takes it. */
export interface SelectRange {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}

const rangeOf = (s: Src | undefined): SelectRange | null => (s ? { file: s.file, line: s.line, col: s.col, endLine: s.endLine ?? s.line, endCol: s.endCol ?? s.col } : null)
const primitiveRange = (s: Src | undefined, textOf?: (file: string) => string | null): SelectRange | null => {
  const range = rangeOf(s)
  const text = s && textOf?.(s.file)
  if (!range || !text) return range
  const doc = textDoc(text), offset = doc.span({ line: range.line, col: range.col }).start
  const sf = ts.createSourceFile(range.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let dot: number | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.getStart(sf) === offset) dot = node.getChildren(sf).find(child => child.kind === ts.SyntaxKind.DotToken)?.getStart(sf)
    if (dot === undefined) ts.forEachChild(node, visit)
  }
  visit(sf)
  return dot === undefined ? range : { ...range, ...doc.site(dot) }
}
/** The span from the first range's start to the last's end in the file most of them are in. */
function spanOf(list: SelectRange[]): SelectRange | null {
  if (!list.length) return null
  const count = new Map<string, number>()
  for (const r of list) count.set(r.file, (count.get(r.file) ?? 0) + 1)
  const file = [...count].sort((a, b) => b[1] - a[1])[0][0]
  const mine = list.filter(r => r.file === file)
  const first = mine.reduce((a, b) => (b.line < a.line || (b.line === a.line && b.col < a.col) ? b : a))
  const last = mine.reduce((a, b) => (b.endLine > a.endLine || (b.endLine === a.endLine && b.endCol > a.endCol) ? b : a))
  return { file, line: first.line, col: first.col, endLine: last.endLine, endCol: last.endCol }
}

/** The view a selection was made in: the PCB views jump to the PCB placement, the schematic to the placement inside `<Schematic>`. */
export type View = import('@pcbjs/core/site-facets').ViewName
export const isView = (v: unknown): v is View => v === '2d' || v === '3d' || v === 'sch' || v === 'checks'
/** A member's range; `place` marks a placement element, whose `at` value the editor jumps to. */
export type MemberRange = SelectRange & { place?: true }
export interface RangeOptions {
  view?: View | null
  /** where a net is declared, by name */
  decl?: (net: string) => SelectRange | null
  text?: (file: string) => string | null
}

const placed = (r: SelectRange | null): MemberRange | null => (r ? { ...r, place: true } : null)

/** An instance's own placement: its `<g>`, else the layout element that placed it, `<Row g={CH2} at="0 10" />`; null for none. */
const instanceAt = (board: Board, path: string): MemberRange | null =>
  placed(rangeOf(board.edit?.find(e => e.ref === path)?.src.at ?? board.edit?.find(e => e.layout && instanceIn(e.frames, board.schematic.circuits) === path)?.layout?.src))

/** Where a member is in the code: a part's or a pad's placement, a route's chain call, an item's range, an instance's placement else the span over its parts, a pour's call, a net's declaration, a finding's first range, in the schematic view as schRange has it; null for none. */
export function memberRange(board: Board, ref: Ref, o: RangeOptions = {}): MemberRange | null {
  if (o.view === 'sch') {
    const part = board.schematic.parts.find(p => p.displayRef && !p.placed && (p.ref === ref || [...p.path, p.local].join('/') === ref))
    if (part) return rangeOf(part.src)
  }
  let t
  try {
    t = resolveRef(boardIndex(board), ref)
  } catch {
    return null
  }
  if (o.view === 'sch') return schRange(board, t, o)
  switch (t.kind) {
    case 'part':
      return placed(rangeOf(t.footprint.src))
    case 'pad':
      return placed(rangeOf(board.footprints.find(f => f.ref === t.ref)?.src))
    case 'group':
      return instanceAt(board, t.path) ?? spanOf(t.parts.flatMap(r => rangeOf(board.footprints.find(f => f.ref === r)?.src) ?? []))
    case 'plane':
      return rangeOf(t.zones[0]?.src)
    case 'net':
      return o.decl?.(t.net.name) ?? null
    case 'route':
      return rangeOf(t.route.src)
    case 'leg':
      return primitiveRange(board.edit?.find(e => e.ref === t.route.id)?.steps?.filter(s => s.op === 'X')[t.leg - 1]?.src, o.text) ?? rangeOf(t.route.src)
    case 'pt':
      return primitiveRange(board.edit?.find(e => e.ref === t.route.id)?.steps?.[t.pt - 1]?.src, o.text) ?? rangeOf(t.route.src)
    case 'item':
      return rangeOf(t.item.src)
    case 'finding':
      return rangeOf(t.finding.src) ?? firstWitness(board, t.finding, o)
  }
  return null
}

/** A finding without a range of its own goes to its first witness: the first part or pad it names, else its net. */
function firstWitness(board: Board, f: { refs?: string[] }, o: RangeOptions): MemberRange | null {
  const refs = f.refs ?? []
  for (const r of [...refs.filter(r => !r.startsWith('net:')), ...refs.filter(r => r.startsWith('net:'))]) {
    const got = memberRange(board, r, o)
    if (got) return got
  }
  return null
}

/** Where a net is declared: its name in the module that exports it, else in the board's own entry; null when no text declares it. */
export function netDecl(model: Board, net: string, text: (file: string) => string | null, entry: string | null, root: string): SelectRange | null {
  const e = model.schematic.nets.find(n => n.name === net)?.export
  const file = e?.module ? (isAbsolute(e.module) ? e.module : join(root, e.module)) : entry
  const src = file && text(file)
  return src ? declRange(file, src, e?.name ?? net) : null
}

/** In the schematic: a part or pad goes to its symbol's placement inside `<Schematic>`, else its declaration; a group to its symbols; a net or a route to its declaration. */
function schRange(board: Board, t: Resolved, o: RangeOptions): MemberRange | null {
  const symbol = (ref: string) => rangeOf(board.schematic.drawing?.symbols.find(s => s.ref === ref && !s.auto)?.src)
  const declared = (ref: string) => rangeOf(board.schematic.parts.find(p => p.ref === ref)?.src)
  switch (t.kind) {
    case 'part':
    case 'pad':
      return placed(symbol(t.ref)) ?? declared(t.ref)
    case 'group':
      return placed(rangeOf(board.schematic.drawing?.sheets.find(s => s.path.join('/') === t.path && !s.auto)?.src)) ?? spanOf(t.parts.flatMap(r => symbol(r) ?? []))
    case 'net':
      return o.decl?.(t.net.name) ?? null
    case 'route':
    case 'leg':
    case 'pt':
      return rangeOf(t.route.src)
    case 'finding':
      return rangeOf(t.finding.src) ?? firstWitness(board, t.finding, o)
  }
  return null
}

/** The 1-based range of `name` where a `const` declares it, plain or destructured, in a file's text; null when none does. */
export function declRange(file: string, text: string, name: string): SelectRange | null {
  if (!/^[\w$]+$/.test(name)) return null
  const m = new RegExp(`\\b(?:const|let|var)\\s+(?:\\{[^}]*?\\b)?${name.replace(/\$/g, '\\$')}\\b`).exec(text)
  if (!m) return null
  const at = m.index + m[0].length - name.length
  const before = text.slice(0, at).split('\n')
  const line = before.length,
    col = before[before.length - 1].length + 1
  return { file, line, col, endLine: line, endCol: col + name.length - 1 }
}

/** The board a reference names alone, `board:Blinky`; null for any other reference. */
export function boardOnly(ref: Ref): string | null {
  try {
    const segs = parseRef(ref)
    return segs.length === 1 && segs[0].kind === 'board' ? segs[0].value : null
  } catch {
    return null
  }
}

/** The `<PCB` of an entry's text, where a board reference jumps; null when the text has none. */
export function pcbRange(file: string, text: string): SelectRange | null {
  const m = /<PCB(?=[\s>/])/.exec(text)
  if (!m) return null
  const before = text.slice(0, m.index).split('\n')
  const line = before.length,
    col = before[before.length - 1].length + 1
  return { file, line, col, endLine: line, endCol: col + m[0].length - 1 }
}

/** A member as the tree names it: a part by its path, `CH2/R01`, a pad under it, a group by its path; anything else as given. */
export function canonicalRef(board: Board, ref: Ref): Ref {
  try {
    const t = resolveRef(boardIndex(board), ref)
    if (t.kind === 'part') return t.path
    if (t.kind === 'group') return t.path
    if (t.kind === 'pad') return `${canonicalRef(board, t.ref)}/${t.pad.num}`
  } catch {}
  return ref
}

/** A reusable source declaration selects one library context, preserving the focused representative when possible. */
export function editorContext(board: Board, input: EditorSelection, previous: Selection | null, rootDir = ''): Partial<Selection> {
  const refs = [...new Set(input.refs.map(ref => canonicalRef(board, ref)))]
  const anchor = input.anchor ? canonicalRef(board, input.anchor) : refs[0] ?? null
  const key = (value: string | undefined) => {
    if (!value) return value
    const at = value.lastIndexOf('#')
    return at < 0 ? value : `${resolve(rootDir, value.slice(0, at))}${value.slice(at)}`
  }
  const candidates = input.library ? board.schematic.circuits.filter(c => key(c.layout) === key(input.library) || key(c.def) === key(input.library)).map(c => c.path.join('/')) : []
  const inside = (ref: string, root: string) => ref === root || ref.startsWith(root + '/')
  if (!candidates.length) return {
    refs, anchor, marks: input.marks, level: null,
    ...(previous?.isolate?.mode === 'library' ? { isolate: null, isolateChoice: null } : {}),
  }
  const focused = previous?.anchor ?? previous?.refs[0]
  const root = candidates.find(c => c === previous?.isolate?.ref) ?? candidates.filter(c => focused && inside(canonicalRef(board, focused), c)).sort((a, b) => b.length - a.length)[0] ?? candidates[0]
  const index = boardIndex(board)
  const ownsRoute = (ref: string) => !!board.edit?.find(n => n.ref === ref)?.frames?.some(f => inside(f.inst, root))
  const ownsItem = (it: Board['items'][number]) => !!it.ref && inside(canonicalRef(board, it.ref), root) || 'route' in it && !!it.route && ownsRoute(it.route)
  const belongs = (ref: string): boolean => {
    if (inside(ref, root)) return true
    try {
      const t = resolveRef(index, ref)
      if (t.kind === 'item') return ownsItem(t.item)
      if (t.kind === 'net') return board.schematic.parts.some(p => inside([...p.path, p.local].join('/'), root) && p.pins.some(pin => pin.net === t.net.name))
      if (t.kind === 'route' || t.kind === 'pt' || t.kind === 'leg') return ownsRoute(t.route.id)
    } catch {}
    return false
  }
  const local = refs.filter(belongs)
  return {
    refs: local.length ? local : [root], anchor: anchor && local.includes(anchor) ? anchor : local[0] ?? root,
    marks: undefined, finding: null, level: root, isolateChoice: null,
    isolate: { ref: root, context: root, instances: candidates, preview: false, mode: 'library' },
  }
}

/** The ranges of every member, the anchor's first; members without one are left out. */
export function selectionRanges(board: Board, sel: Pick<Selection, 'refs' | 'anchor'>, o: RangeOptions = {}): MemberRange[] {
  const order = sel.anchor ? [sel.anchor, ...sel.refs.filter(r => r !== sel.anchor)] : sel.refs
  return order.flatMap(r => memberRange(board, r, o) ?? [])
}

export interface Offer {
  board: string
  selection: Selection
  /** the seq the change was made on */
  base?: number
}

/** The selections of a session, one per board; the last writer by arrival wins, a client's change based on an older seq than its last one is dropped. */
export function selectionStore(findings?: (s: Selection) => readonly { id?: string; refs?: readonly string[] }[] | undefined) {
  const byBoard = new Map<string, Selection>()
  const bases = new WeakMap<object, number>()
  let seq = 0
  const stamp = (s: Selection): Selection => {
    const out = { ...s, seq: ++seq }
    byBoard.set(s.board, out)
    return out
  }
  return {
    get: (board: string): Selection | null => byBoard.get(board) ?? null,
    /** A viewer's selection; null when it is dropped or shows nothing new. */
    offer(client: object, m: Offer, by: Selection['client']): Selection | null {
      if (!isSelection(m.selection) || m.selection.board !== m.board || (m.base !== undefined && (!Number.isSafeInteger(m.base) || m.base < 0))) throw new Error('invalid selection offer')
      const was = byBoard.get(m.board)
      const next = normalizeSelection(m.selection, findings?.(m.selection), was)
      const base = m.base ?? 0
      if (base < (bases.get(client) ?? 0)) return null
      bases.set(client, base)
      if (was && sameSelection(was, next)) return null
      return stamp({ ...next, board: m.board, by: next.by, client: by })
    },
    /** A selection the session itself sets, from the editor or an agent; null when it shows nothing new. */
    set(board: string, change: Partial<Pick<Selection, 'refs' | 'anchor' | 'level' | 'marks' | 'target' | 'snapshot' | 'finding' | 'isolate' | 'isolateChoice'>>, by: SetBy, client: Selection['client']): Selection | null {
      const was = byBoard.get(board) ?? emptySelection(board)
      const refs = change.refs ?? was.refs
      const anchor = change.anchor !== undefined ? change.anchor : (refs[refs.length - 1] ?? null)
      const proposed = { ...was, ...change, refs, anchor, by, client, ...(change.refs !== undefined && change.finding === undefined ? { finding: null } : {}) }
      const next = normalizeSelection(proposed, findings?.(proposed), was)
      if (sameSelection(was, next) && was.by === by) return null
      return stamp(next)
    },
  }
}
export type SelectionStore = ReturnType<typeof selectionStore>
