// runs before esbuild turns JSX into calls, so the compiler can map board items back to the code that made them
import { under } from './files.js'
import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'
import MagicString from 'magic-string'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { bindingCaptures } from '@pcbjs/compile/internal/scope'
import { isChain, isHelper as helperNamed } from '@pcbjs/core/internal/syntax'
import { toSite } from '@pcbjs/core/internal/textdoc'

/** 1-based, end inclusive; `hash` is 12 hex of the sha1 of the range's text without its own `at` and `side` attributes. */
export interface SrcProp {
  file: string
  line: number
  col: number
  endLine: number
  endCol: number
  hash: string
  /** for a route or via call, the lines of the helper whose caller the call site is */
  fn?: { line: number; endLine: number }
}

const posix = (p: string) => p.split(sep).join('/')

// the pre-check for a binding the compiler may capture
const DECL = /\b(?:const|let)\s/
const BIND = "globalThis[Symbol.for('pcbjs.bindRef')]"
const PLACEMENT = new Set(['at', 'side'])

/** .ts and .tsx under the root, outside node_modules, .pcbjs and `exclude`. */
export function wantsSourceRanges(id: string, root: string, exclude: string[] = []): boolean {
  const file = id.split('?')[0]
  if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return false
  const rel = relative(root, file)
  if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[a-zA-Z]:/.test(rel)) return false
  const parts = rel.split(sep)
  if (parts.includes('node_modules') || parts.includes('.pcbjs')) return false
  // a folder holding the root itself, such as a template inside the repository's packages, excludes nothing of it
  return !exclude.some(d => under(file, d) && !under(root, d))
}

/** Null when there was nothing to inject; `limit` is where a draft's closers start, see session/drafts.ts, and clamps every position. */
export function transformSourceRanges(code: string, id: string, file: string, limit: number | null = null): { code: string; map: ReturnType<MagicString['generateMap']> } | null {
  const path = id.split('?')[0]
  const tsx = path.endsWith('.tsx')
  if (!/['"]@pcbjs\/core['"]/.test(code) && !(tsx && code.includes('<')) && !DECL.test(code)) return null
  const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lc = (o: number) => toSite(sf.getLineAndCharacterOfPosition(limit !== null && o >= limit ? Math.max(0, limit - 1) : o))

  // named imports, renamed or not, and namespace imports
  const named = new Map<string, string>()
  const namespaces = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== '@pcbjs/core') continue
    const clause = st.importClause
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue
    if (ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text)
    else
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue
        if (helperNamed((el.propertyName ?? el.name).text)) named.set(el.name.text, (el.propertyName ?? el.name).text)
      }
  }

  const s = new MagicString(code)
  let edits = 0
  // the innermost function that is not a callback argument, such as of a `.map`: a helper
  const helperFn = (node: ts.Node): string => {
    for (let p = node.parent; p && p !== sf; p = p.parent) {
      if (!ts.isFunctionLike(p)) continue
      let q: ts.Node = p
      while (q.parent && ts.isParenthesizedExpression(q.parent)) q = q.parent
      if (q.parent && (ts.isCallExpression(q.parent) || ts.isNewExpression(q.parent)) && q.parent.arguments?.includes(q as ts.Expression)) continue
      const a = lc(p.getStart(sf)),
        b = lc(p.getEnd() - 1)
      return `, fn: { line: ${a.line}, endLine: ${b.line} }`
    }
    return ''
  }
  const textHash = (start: number, end: number, skip: ts.Node[] = []) => {
    const h = createHash('sha1')
    let at = start
    for (const n of skip) {
      h.update(code.slice(at, n.getFullStart()))
      at = n.getEnd()
    }
    return h.update(code.slice(at, end)).digest('hex').slice(0, 12)
  }
  // an element's own `at` and `side` with the space before them, which a move, turn or flip rewrites and its items' uids leave out
  const placement = (attrs: ts.JsxAttributes | undefined): ts.Node[] =>
    (attrs?.properties ?? []).filter(p => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && PLACEMENT.has(p.name.text))
  const range = (node: ts.Node, fn = false, attrs?: ts.JsxAttributes): string => {
    const a = lc(node.getStart(sf))
    const b = lc(node.getEnd() - 1)
    const v: SrcProp = { file, line: a.line, col: a.col, endLine: b.line, endCol: b.col, hash: textHash(node.getStart(sf), node.getEnd(), placement(attrs)) }
    const tail = fn ? helperFn(node) : ''
    return `{ file: ${JSON.stringify(v.file)}, line: ${v.line}, col: ${v.col}, endLine: ${v.endLine}, endCol: ${v.endCol}, hash: ${JSON.stringify(v.hash)}${tail} }`
  }
  const unwrapExpr = (e: ts.Expression | undefined): ts.Expression | undefined => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression
    return e
  }

  const hasSrcAttr = (attrs: ts.JsxAttributes) => attrs.properties.some(p => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === '__src')
  const isHelper = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) return named.has(callee.text)
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text) &&
      ts.isIdentifier(callee.name) &&
      helperNamed(callee.name.text)
    )
  }
  // last, so it wins over a spread of the props a component received, which may carry the caller's __src
  const tag = (tagName: ts.JsxTagNameExpression, attrs: ts.JsxAttributes, whole: ts.Node) => {
    const ref = attrs.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'ref:at')
    if (ref) s.appendLeft(attrs.end, ` __refSrc={${range(ref)}}`)
    if (hasSrcAttr(attrs)) return
    s.appendLeft(attrs.end, ` __src={${range(whole, false, attrs)}}`)
    edits++
  }

  // `route` for `route` or `pcb.route`
  const helperName = (callee: ts.Expression): string | undefined =>
    !isHelper(callee) ? undefined : ts.isIdentifier(callee) ? named.get(callee.text) : (callee as ts.PropertyAccessExpression).name.text
  // a route(...) call, possibly followed by builder or chain calls
  const onRoute = (e: ts.Expression): boolean => {
    for (let depth = 0; depth < 256; depth++) {
      e = unwrapExpr(e)!
      if (!e || !ts.isCallExpression(e)) return false
      if (helperName(e.expression) === 'route') return true
      if (!ts.isPropertyAccessExpression(e.expression)) return false
      e = e.expression.expression
    }
    return false
  }
  const chainTop = (node: ts.Expression): ts.Expression => {
    while (
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.expression === node &&
      ts.isCallExpression(node.parent.parent) &&
      node.parent.parent.expression === node.parent
    )
      node = node.parent.parent
    return node
  }
  // from the method name to the closing parenthesis
  const chainRange = (node: ts.CallExpression, name: ts.Node): string => {
    const a = lc(name.getStart(sf))
    const b = lc(node.getEnd() - 1)
    return `{ file: ${JSON.stringify(file)}, line: ${a.line}, col: ${a.col}, endLine: ${b.line}, endCol: ${b.col}, hash: ${JSON.stringify(textHash(name.getStart(sf), node.getEnd()))} }`
  }

  let capture = '__pcbjsExpression'
  while (code.includes(capture)) capture += '_'
  let expressions = false
  const suspends = (node: ts.Node): boolean =>
    ts.isAwaitExpression(node) || ts.isYieldExpression(node) || (!ts.isFunctionLike(node) && !!ts.forEachChild(node, n => suspends(n) || undefined))
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !suspends(node.expression)) {
      const expr = node.expression
      const start = lc(expr.getStart(sf)),
        end = lc(expr.end - 1)
      s.appendLeft(expr.getStart(sf), `${capture}(() => (`)
      s.appendRight(expr.end, `), ${JSON.stringify([file, start.line, start.col, end.line, end.col])})`)
      expressions = true
      edits++
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      isChain(node.expression.name.text) &&
      onRoute(node.expression.expression)
    ) {
      s.appendLeft(node.getEnd(), `.__at(${chainRange(node, node.expression.name)})`)
      edits++
    }
    if (ts.isJsxElement(node)) tag(node.openingElement.tagName, node.openingElement.attributes, node)
    else if (ts.isJsxSelfClosingElement(node)) tag(node.tagName, node.attributes, node)
    else if (ts.isCallExpression(node) && isHelper(node.expression) && node.arguments.length > 1) {
      // into a last object literal, else an argument of its own
      const args = node.arguments
      const last = args[args.length - 1]
      const src = range(node, helperName(node.expression) !== 'pour')
      if (ts.isObjectLiteralExpression(last)) {
        if (!last.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === '__src')) {
          if (last.properties.length) s.appendLeft(last.properties[last.properties.length - 1].getEnd(), `, __src: ${src}`)
          else s.appendLeft(last.getEnd() - 1, ` __src: ${src} `)
          edits++
        }
      } else if (!args.some(ts.isSpreadElement)) {
        s.appendLeft(last.getEnd(), `, { __src: ${src} }`)
        edits++
      }
    } else if (ts.isCallExpression(node) && isHelper(node.expression) && node.arguments.length) {
      const arg = node.arguments[0]
      const src = range(node, helperName(node.expression) !== 'pour')
      if (ts.isObjectLiteralExpression(arg)) {
        const own = arg.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === '__src')
        if (!own) {
          const props = arg.properties
          if (props.length) s.appendLeft(props[props.length - 1].getEnd(), `, __src: ${src}`)
          else s.appendLeft(arg.getEnd() - 1, ` __src: ${src} `)
          edits++
        }
      } else if (!ts.isSpreadElement(arg) && helperName(node.expression) === 'wire') {
        // a hand wire is drawn by its whole chain, wire(a).h(2).Z(b)
        s.appendLeft(arg.getEnd(), `, { __src: ${range(chainTop(node))} }`)
        edits++
      } else if (!ts.isSpreadElement(arg)) {
        // the argument must stay what it is: route(NET) and stitch(GND) take a net, keepout(area) a path
        s.appendLeft(arg.getEnd(), `, { __src: ${src} }`)
        edits++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  // each binding goes through the registry's bindRef on globalThis, so the module needs no import; the name of a part is its ref
  const site = (pos: number) => {
    const p = lc(pos)
    return `{ file: ${JSON.stringify(file)}, line: ${p.line}, col: ${p.col} }`
  }
  for (const c of bindingCaptures(sf)) {
    if (c.init) {
      const { name, pos } = c.names[0]
      // the opening left of the start, the closing right of the end: outside any range the visit put at the same offsets
      s.appendLeft(c.init.start, `((v) => { const f = ${BIND}; return f ? f(v, ${JSON.stringify(name)}, ${site(pos)}, ${c.local}) : v })((`)
      s.appendRight(c.init.end, '))')
    } else s.appendRight(c.end, `;{ const f = ${BIND}; if (f) { ${c.names.map(n => `f(${n.name}, ${JSON.stringify(n.name)}, ${site(n.pos)}, ${c.local});`).join(' ')} } }`)
    edits++
  }
  if (expressions)
    s.append(`
function ${capture}(run, src) { try { return run() } catch (error) { try { if (error && typeof error === 'object' && !error.src) { const [file, line, col, endLine, endCol] = src; error.src = { file, line, col, endLine, endCol } } } catch {} throw error } }
`)
  if (!edits) return null
  return { code: s.toString(), map: s.generateMap({ hires: true, source: path, includeContent: true }) }
}

/** `rootOf` is the project root, or for a workspace the root of a file's scope, null for a file in none. */
export function sourceRangesPlugin(rootOf: string | ((file: string) => string | null), exclude: string[] = [], limitOf: (file: string) => number | null = () => null): Plugin {
  return {
    name: 'pcbjs:source-ranges',
    enforce: 'pre',
    transform(code, id) {
      const root = typeof rootOf === 'string' ? rootOf : rootOf(id.split('?')[0])
      if (!root || !wantsSourceRanges(id, root, exclude)) return null
      return transformSourceRanges(code, id, posix(relative(root, id.split('?')[0])), limitOf(id.split('?')[0]))
    },
  }
}
