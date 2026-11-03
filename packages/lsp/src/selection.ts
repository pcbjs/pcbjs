// The editor selection model: what each editor selection names on each board, in references of docs/refs.md, which the viewers highlight.

import ts from 'typescript'
import type { DocModel } from './doc.js'
import type { SiteItem, SourceRange } from '@pcbjs/core/site-data'
import type { Src } from '@pcbjs/core/internal/types'
import type { Position, Range, SelectParams } from '@pcbjs/core/protocol'
import { toRange } from '@pcbjs/core/internal/textdoc'
import { toUri, type BoardRef } from './host.js'
import type { Target } from './target.js'
import { abs, before, contains, itemsOf, pathRef, size, tuple, type FileFacts } from './facts.js'

/** What the editor selections name on one board, in references of docs/refs.md. */
export interface EditorSelection {
  board: string
  refs: string[]
  anchor: string | null
  library?: string
  marks?: { points?: [number, number][]; reference?: string; sch?: string[] }
}

type Marks = NonNullable<EditorSelection['marks']>

/** What each selection range names per board: the token under an empty one as `targetOf` finds it, else the code ranges it holds or the innermost around it; the first range gives the anchor. */
export function editorSelection(f: FileFacts, ranges: Range[], targetOf: (p: Position) => Target | undefined, doc?: DocModel): EditorSelection[] {
  const out = new Map(f.all.map(b => [b.site.name, { board: b.site.name, refs: [] as string[], anchor: null as string | null, marks: {} as Marks }]))
  ranges.forEach((r, i) => {
    const empty = r.start.line === r.end.line && r.start.character === r.end.character
    const t = empty ? targetOf(r.start) : undefined
    const code = t?.kind === 'point' ? rangeMembers(f, r, empty, out) : undefined
    const target = t ? targetMembers(f, t, out) : undefined
    const found = code?.size ? code : target ?? rangeMembers(f, r, empty, out)
    for (const [board, refs] of found) {
      const m = out.get(board)
      if (!m) continue
      for (const ref of refs) if (!m.refs.includes(ref)) m.refs.push(ref)
      if (i === 0 && refs.length) m.anchor = refs[0]
    }
  })
  return [...out.values()].map(m => {
    const library = doc && ranges[0] ? libraryAt(f, m.board, ranges[0], doc) : undefined
    return {
      board: m.board,
      refs: m.refs,
      anchor: m.anchor ?? m.refs[0] ?? null,
      ...(library ? { library } : {}),
      ...(m.marks.points || m.marks.reference || m.marks.sch ? { marks: m.marks } : {}),
    }
  })
}

/** The innermost compiled definition whose declaration contains the entire primary selection. */
export function libraryAt(f: FileFacts, board: string, range: Range, doc: DocModel): string | undefined {
  const b = f.all.find(x => x.site.name === board)
  if (!b) return
  const keys = new Map<string, string>()
  for (const c of b.site.schematic.circuits ?? []) {
    for (const key of [c.layout, c.def]) {
      if (!key) continue
      const split = key.lastIndexOf('#')
      if (split >= 0 && abs(b.root, key.slice(0, split)) === f.file) keys.set(key.slice(split + 1), key)
    }
  }
  if (!keys.size) return
  const sf = doc.sf(), start = doc.offset(range.start), end = doc.offset(range.end)
  const factories = new Map<string, 'circuit' | 'layout'>(), namespaces = new Set<string>()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@pcbjs/core') continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        const name = (specifier.propertyName ?? specifier.name).text
        if (!specifier.isTypeOnly && (name === 'circuit' || name === 'layout')) factories.set(specifier.name.text, name)
      }
    }
  }
  const runtimeName = (initializer: ts.Expression): string | undefined => {
    if (!ts.isCallExpression(initializer)) return
    const callee = initializer.expression
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'layout' && !(ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text))) {
      const argument = initializer.arguments[1]
      if (argument) return ts.isStringLiteralLike(argument) ? argument.text : undefined
      const render = initializer.arguments[0]
      if (render && ts.isFunctionExpression(render) && render.name) return render.name.text
      if (render && ts.isIdentifier(render)) return render.text
      const name = circuitName(callee.expression)
      return name ? `${name}Layout` : undefined
    }
    let factory = ts.isIdentifier(callee) ? factories.get(callee.text) : undefined
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) {
      if (callee.name.text === 'circuit' || callee.name.text === 'layout') factory = callee.name.text
    }
    const argument = factory && initializer.arguments[factory === 'circuit' ? 0 : 2]
    return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined
  }
  const circuitName = (expression: ts.Expression, seen = new Set<string>()): string | undefined => {
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression
      if (ts.isIdentifier(callee) && factories.get(callee.text) === 'circuit' || ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && callee.name.text === 'circuit') return runtimeName(expression)
      return circuitName(callee, seen)
    }
    if (!ts.isIdentifier(expression) || seen.has(expression.text)) return
    seen.add(expression.text)
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue
      const declaration = statement.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === expression.text)
      if (declaration?.initializer) {
        const name = circuitName(declaration.initializer, seen)
        if (name) return name
      }
    }
    return b.site.schematic.circuits?.find(c => c.binding === expression.text || c.circuit === expression.text)?.circuit
  }
  let found: string | undefined, span = Infinity
  const visit = (node: ts.Node) => {
    let name: string | undefined, runtime: string | undefined, owner = node
    if (ts.isFunctionDeclaration(node) && node.body) name = node.name?.text
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      name = node.name.text
      runtime = runtimeName(node.initializer)
      const list = node.parent
      if (ts.isVariableDeclarationList(list) && list.declarations.length === 1 && ts.isVariableStatement(list.parent)) owner = list.parent
    }
    const key = (runtime && keys.get(runtime)) || (name && keys.get(name))
    if (key && start >= owner.getStart(sf) && start < owner.end && end <= owner.end && owner.end - owner.getStart(sf) < span) {
      found = key
      span = owner.end - owner.getStart(sf)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** What a target names per board, its points and reference marked. */
function targetMembers(f: FileFacts, t: Target, out: Map<string, { marks: Marks }>): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const b of t.boards) {
    const site = f.all.find(x => x.site.name === b.board)?.site
    if (!site) continue
    found.set(
      b.board,
      b.refs.map(ref => pathRef(site, ref)),
    )
    const m = out.get(b.board)
    if (m && b.points?.length) m.marks.points = [...(m.marks.points ?? []), ...b.points]
    if (m && b.reference) m.marks.reference = b.reference
  }
  return found
}

/** What the code of a range drew per board, the schematic elements it drew marked. */
function rangeMembers(f: FileFacts, r: Range, empty: boolean, out: Map<string, { marks: Marks }>): Map<string, string[]> {
  const code = codeMembers(f, r, empty)
  const found = new Map(code)
  for (const b of f.all) {
    const drawn = schDrawn(b, f.file, r, empty)
    if (!drawn) continue
    const name = b.site.name
    const around = empty
      ? f.rangeAt(
          r.start,
          f.boards.filter(x => x.ref === b),
        )?.range
      : undefined
    // a wire or label inside the board's innermost range is the innermost code, so it wins over what that range drew
    if (empty && code.has(name) && !(around && contains(around, drawn.range))) continue
    const refs = drawn.refs.map(ref => pathRef(b.site, ref))
    found.set(name, empty ? refs : [...(found.get(name) ?? []), ...refs])
    const m = out.get(name)
    if (m) m.marks.sch = [...new Set([...(m.marks.sch ?? []), ...drawn.keys])]
  }
  return found
}

/** The schematic elements a range drew in a file, by their keys and parts: what an empty one sits strictly inside, the innermost with those nested in it, else every one it holds. */
export function schDrawn(b: BoardRef, file: string, r: Range, empty: boolean): { keys: string[]; refs: string[]; range: SourceRange } | null {
  const d = b.site.schematic.drawing
  if (!d) return null
  const ranged: { key: string; ref?: string; range: SourceRange }[] = []
  const add = (key: string, src: Src | undefined, ref?: string) => {
    if (src?.endLine == null || src.endCol == null || abs(b.root, src.file) !== file) return
    ranged.push({ key, ref, range: { start: [src.line, src.col], end: [src.endLine, src.endCol], uids: [], refs: [] } })
  }
  for (const x of d.symbols) if (!x.auto) add(`sym:${x.ref}`, x.src, x.ref)
  for (const w of d.wires) if (!w.auto) add(w.id, w.src)
  for (const l of d.labels) if (!l.auto) add(l.id, l.src)
  const a = tuple(r.start),
    z = tuple(r.end)
  let hit = empty ? [] : ranged.filter(x => !before(x.range.start, a) && !before(z, x.range.end))
  if (!hit.length) {
    // strictly inside: a cursor before the first character or after the last is outside
    const under = ranged.filter(x => before(x.range.start, a) && !before(x.range.end, a)).map(x => x.range)
    if (!under.length) return null
    const best = under.reduce((p, q) => (size(q) < size(p) ? q : p))
    hit = ranged.filter(x => contains(best, x.range))
  }
  const range = hit.reduce((p, q) => (size(q.range) > size(p.range) ? q : p)).range
  return { keys: [...new Set(hit.filter(x => !x.ref).map(x => x.key))], refs: [...new Set(hit.flatMap(x => (x.ref ? [x.ref] : [])))], range }
}

/** The members the code of a range drew, per board: its parts, and its other items as memberOf names them. */
export function codeMembers(f: FileFacts, r: Range, empty: boolean): Map<string, string[]> {
  const a = tuple(r.start),
    z = tuple(r.end)
  const out = new Map<string, string[]>()
  for (const b of f.boards) {
    const inside = empty ? [] : b.ranges.filter(x => !before(x.start, a) && !before(z, x.end))
    const hit = inside.length ? undefined : f.rangeAt(r.start, [b])
    const at = inside.length ? inside : hit ? [hit.range] : []
    const items = itemsOf(b.ref.site)
    const refs = new Set<string>(),
      rest = new Set<string>()
    for (const x of at) {
      const nested = b.ranges.filter(y => !before(y.start, x.start) && !before(x.end, y.end))
      for (const y of nested) {
        for (const p of y.refs) refs.add(p)
        for (const id of y.uids) {
          const it = items.get(id)
          if (!it || (it.ref && y.refs.includes(it.ref))) continue
          const m = memberOf(it)
          if (m) rest.add(m)
        }
      }
    }
    const list = [...refs, ...[...rest].filter(x => !refs.has(x))].map(x => pathRef(b.ref.site, x))
    if (list.length) out.set(b.ref.site.name, list)
  }
  return out
}

/** How the selection names an item no part of its range owns: its route, else its part, else its uid; the one place a new reference kind goes. */
export function memberOf(it: SiteItem): string | undefined {
  return it.generated === 'reference' ? it.uid : it.route ?? (it.ref && it.kind !== 'pad' ? it.ref : it.uid)
}

/** A source range a viewer selects in the editor, 1-based with an inclusive end. */
export interface SelectRange {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
}

/** `pcbjs/select` for ranges, the first the primary, grouped by file in their order. */
export function selectParams(ranges: SelectRange[], reveal: boolean, focus = false): SelectParams {
  const items: SelectParams['items'] = []
  for (const r of ranges) {
    const uri = toUri(r.file)
    let it = items.find(x => x.uri === uri)
    if (!it) items.push((it = { uri, ranges: [] }))
    it.ranges.push(toRange(r))
  }
  return { items, primary: { uri: items[0].uri, index: 0 }, reveal, ...(focus ? { focus } : {}) }
}
