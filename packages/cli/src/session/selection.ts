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
import { parseSnapshot, type Params } from '@pcbjs/core/protocol'

/** Resolve transport references against the selected model before publishing canonical state. */
export function validateSelection(board: Board, value: Selection, focused = board): Selection {
  if (!isSelection(value) || value.board !== board.name) throw new Error('invalid selection offer')
  const snapshot = value.snapshot ? parseSnapshot(value.snapshot) : null
  if (value.snapshot && (!snapshot || !Number.isSafeInteger(snapshot.run) || snapshot.run < 1)) throw new Error('invalid selection snapshot')
  let index: ReturnType<typeof boardIndex> | undefined
  const resolve = (ref: string) => resolveRef((index ??= boardIndex(board)), ref)
  let focusedIndex: ReturnType<typeof boardIndex> | undefined
  const canonical = (ref: string) => {
    parseRef(ref)
    const symbol = focused.schematic?.parts?.find(p => p.ref === ref || [...(p.path ?? []), p.local ?? p.ref].join('/') === ref)
    if (symbol) return [...(symbol.path ?? []), symbol.local ?? symbol.ref].join('/')
    const found = focused === board ? resolve(ref) : resolveRef((focusedIndex ??= boardIndex(focused)), ref)
    return found.kind === 'part' || found.kind === 'group' ? found.path : found.kind === 'pad' ? `${canonicalRef(board, found.ref)}/${found.pad.num}` : ref
  }
  const refs = [...new Set(value.refs.map(canonical))]
  const anchor = value.anchor ? canonical(value.anchor) : null
  const ancestor = (a: string, b: string) => b.startsWith(a + '/') && !a.startsWith('net:') && !a.startsWith('plane:')
  const members = refs.filter(ref => !refs.some(other => other !== ref && ((ancestor(other, ref) && ref !== anchor) || (ancestor(ref, other) && other === anchor))))
  const container = (ref: string, library = false) => {
    const found = resolve(ref)
    if (found.kind !== 'group' && (library || found.kind !== 'part')) throw new Error(`${ref} is not an isolatable ${library ? 'layout group' : 'part or group'}`)
    return found.path
  }
  const isolation = (v: Selection['isolate']) =>
    v && {
      ...v,
      ref: container(v.ref, v.mode === 'library'),
      context: container(v.context, v.mode === 'library'),
      instances: [...new Set(v.instances.map(ref => container(ref, v.mode === 'library')))],
    }
  if (value.finding && resolve(value.finding).kind !== 'finding') throw new Error('selection finding must name a finding')
  return normalizeSelection({
    ...value,
    refs: members,
    anchor,
    level: value.level ? container(value.level, value.isolate?.mode === 'library') : null,
    isolate: isolation(value.isolate),
    isolateChoice: isolation(value.isolateChoice ?? null),
  })
}

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
  const doc = textDoc(text),
    offset = doc.span({ line: range.line, col: range.col }).start
  const sf = ts.createSourceFile(range.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let dot: number | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.getStart(sf) === offset)
      dot = node
        .getChildren(sf)
        .find(child => child.kind === ts.SyntaxKind.DotToken)
        ?.getStart(sf)
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

/** Resolve an entity to the source expression used by the requesting view. */
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

/** A standalone board reference, without an entity path. */
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

/** Canonical tree path for a part, pad or group. */
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
  const anchor = input.anchor ? canonicalRef(board, input.anchor) : (refs[0] ?? null)
  const key = (value: string | undefined) => {
    if (!value) return value
    const at = value.lastIndexOf('#')
    return at < 0 ? value : `${resolve(rootDir, value.slice(0, at))}${value.slice(at)}`
  }
  const candidates = input.library ? board.schematic.circuits.filter(c => key(c.layout) === key(input.library) || key(c.def) === key(input.library)).map(c => c.path.join('/')) : []
  const inside = (ref: string, root: string) => ref === root || ref.startsWith(root + '/')
  if (!candidates.length)
    return {
      refs,
      anchor,
      marks: input.marks,
      level: null,
      ...(previous?.isolate?.mode === 'library' ? { isolate: null, isolateChoice: null } : {}),
    }
  const focused = previous?.anchor ?? previous?.refs[0]
  const root =
    candidates.find(c => c === previous?.isolate?.ref) ??
    candidates.filter(c => focused && inside(canonicalRef(board, focused), c)).sort((a, b) => b.length - a.length)[0] ??
    candidates[0]
  const index = boardIndex(board)
  const ownsRoute = (ref: string) => !!board.edit?.find(n => n.ref === ref)?.frames?.some(f => inside(f.inst, root))
  const ownsItem = (it: Board['items'][number]) => (!!it.ref && inside(canonicalRef(board, it.ref), root)) || ('route' in it && !!it.route && ownsRoute(it.route))
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
    refs: local.length ? local : [root],
    anchor: anchor && local.includes(anchor) ? anchor : (local[0] ?? root),
    marks: undefined,
    finding: null,
    level: root,
    isolateChoice: null,
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

type RefSelect = Extract<Params<'session/select'>, { refs: string[] }>

const selectionBase = (board: string, previous: Selection | null, target?: string | null): Selection =>
  previous && (target === undefined || target === previous.target) ? previous : emptySelection(board, target ?? null)

/** Target-local context never crosses a refs-form target change. */
export function refsSelection(board: Board, previous: Selection | null, p: RefSelect, focused = board): Selection {
  const base = selectionBase(p.board, previous, p.target)
  const refs = p.refs
  const finding = p.finding !== undefined ? p.finding : (refs.find(ref => [...board.drc, ...board.erc].some(f => f.id === ref)) ?? base.finding)
  return validateSelection(board, { ...base, refs, anchor: p.anchor ?? refs.at(-1) ?? null, level: p.level ?? null, marks: undefined, finding }, focused)
}

/** One state and pending intent per board; stale client bases cannot supersede newer intent. */
export function selectionStore(findings?: (s: Selection) => readonly { id?: string; refs?: readonly string[] }[] | undefined) {
  const byBoard = new Map<string, Selection>()
  const bases = new WeakMap<object, number>()
  const intents = new Map<string, symbol>()
  let seq = 0
  const stamp = (s: Selection): Selection => {
    const out = { ...s, seq: ++seq }
    byBoard.set(s.board, out)
    return out
  }
  const begin = (client: object, m: Offer, by: Selection['client']) => {
    if (!isSelection(m.selection) || m.selection.board !== m.board || (m.base !== undefined && (!Number.isSafeInteger(m.base) || m.base < 0)))
      throw new Error('invalid selection offer')
    const base = m.base ?? 0
    if (base < (bases.get(client) ?? 0)) return null
    bases.set(client, base)
    const intent = Symbol()
    intents.set(m.board, intent)
    return (selection = m.selection): Selection | null => {
      if (intents.get(m.board) !== intent) return null
      intents.delete(m.board)
      const was = byBoard.get(m.board)
      const next = normalizeSelection(selection, findings?.(selection), was)
      return was && sameSelection(was, next) ? null : stamp({ ...next, client: by })
    }
  }
  return {
    begin,
    cancel: () => intents.clear(),
    get: (board: string): Selection | null => byBoard.get(board) ?? null,
    offer: (client: object, m: Offer, by: Selection['client']): Selection | null => begin(client, m, by)?.() ?? null,
    set(
      board: string,
      change: Partial<Pick<Selection, 'refs' | 'anchor' | 'level' | 'marks' | 'target' | 'snapshot' | 'finding' | 'isolate' | 'isolateChoice'>>,
      by: SetBy,
      client: Selection['client'],
    ): Selection | null {
      intents.delete(board)
      const previous = byBoard.get(board) ?? null
      const base = selectionBase(board, previous, change.target)
      const refs = change.refs ?? base.refs
      const anchor = change.anchor !== undefined ? change.anchor : (refs.at(-1) ?? null)
      const proposed = { ...base, ...change, refs, anchor, by, client, ...(change.refs !== undefined && change.finding === undefined ? { finding: null } : {}) }
      const next = normalizeSelection(proposed, findings?.(proposed), previous ?? undefined)
      return previous && sameSelection(previous, next) && previous.by === by ? null : stamp(next)
    },
  }
}
export type SelectionStore = ReturnType<typeof selectionStore>
