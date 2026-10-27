// runs before esbuild turns JSX into calls, so the compiler can map board items back to the code that made them
import { relative, sep } from 'node:path'
import MagicString from 'magic-string'
import ts from 'typescript'
import type { Plugin } from 'vite'

/** 1-based, end inclusive; `lit` is the first character inside its path literal's quotes, `raw` when the literal is plain text. */
export interface SrcProp { file: string; line: number; col: number; endLine: number; endCol: number; lit?: { line: number; col: number }; raw?: true
  /** for a route or via call, the lines of the helper whose caller the call site is */
  fn?: { line: number; endLine: number } }

const PATH_TAGS = new Set(['track', 'path', 'zone'])

const HELPERS = new Set(['route', 'pour', 'via', 'keepout', 'stitch', 'wire'])

// each command of a route chain gets its own range through `.__at(range)`
const CHAIN = new Set(['L', 'l', 'H', 'h', 'V', 'v', 'via', 'Z', 'X'])

const posix = (p: string) => p.split(sep).join('/')

// the same rule as BOUND_REF in @pcbjs/core's schematic
const REF_NAME = /^[A-Z]+[0-9]+$/
// the pre-check for a module-level ref binding
const REF_DECL = /\b(?:const|let)\s+[A-Z]+[0-9]+\s*[:=]/

/** .ts and .tsx under the root, outside node_modules, .pcbjs and `exclude`. */
export function wantsSourceRanges(id: string, root: string, exclude: string[] = []): boolean {
  const file = id.split('?')[0]
  if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return false
  const rel = relative(root, file)
  if (!rel || rel.startsWith('..') || rel.startsWith(sep) || /^[a-zA-Z]:/.test(rel)) return false
  const parts = rel.split(sep)
  if (parts.includes('node_modules') || parts.includes('.pcbjs')) return false
  return !exclude.some(d => file === d || file.startsWith(d.endsWith(sep) ? d : d + sep))
}

/** Null when there was nothing to inject; `limit` is where a draft's closers start, see drafts.ts, and clamps every position. */
export function transformSourceRanges(code: string, id: string, file: string, limit: number | null = null): { code: string; map: ReturnType<MagicString['generateMap']> } | null {
  const path = id.split('?')[0]
  const tsx = path.endsWith('.tsx')
  if (!/['"]@pcbjs\/core['"]/.test(code) && !(tsx && code.includes('<')) && !REF_DECL.test(code)) return null
  const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lc = (o: number) => sf.getLineAndCharacterOfPosition(limit !== null && o >= limit ? Math.max(0, limit - 1) : o)

  // named imports, renamed or not, and namespace imports
  const named = new Map<string, string>()
  const namespaces = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== '@pcbjs/core') continue
    const clause = st.importClause
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue
    if (ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text)
    else for (const el of clause.namedBindings.elements) {
      if (el.isTypeOnly) continue
      if (HELPERS.has((el.propertyName ?? el.name).text)) named.set(el.name.text, (el.propertyName ?? el.name).text)
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
      const a = lc(p.getStart(sf)), b = lc(p.getEnd() - 1)
      return `, fn: { line: ${a.line + 1}, endLine: ${b.line + 1} }`
    }
    return ''
  }
  const range = (node: ts.Node, lit?: ts.Expression, fn = false): string => {
    const a = lc(node.getStart(sf))
    const b = lc(node.getEnd() - 1)
    const v: SrcProp = { file, line: a.line + 1, col: a.character + 1, endLine: b.line + 1, endCol: b.character + 1 }
    let tail = ''
    // a literal without expressions: whether its text is its source
    if (lit && (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit))) {
      const start = lit.getStart(sf) + 1
      const p = lc(start)
      const raw = code.slice(start, lit.getEnd() - 1) === lit.text
      tail = `, lit: { line: ${p.line + 1}, col: ${p.character + 1} }${raw ? ', raw: true' : ''}`
    }
    if (fn) tail += helperFn(node)
    return `{ file: ${JSON.stringify(v.file)}, line: ${v.line}, col: ${v.col}, endLine: ${v.endLine}, endCol: ${v.endCol}${tail} }`
  }
  const unwrapExpr = (e: ts.Expression | undefined): ts.Expression | undefined => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression
    return e
  }
  const dProp = (o: ts.Expression | undefined): ts.Expression | undefined => {
    o = unwrapExpr(o)
    if (!o || !ts.isObjectLiteralExpression(o)) return undefined
    const p = o.properties.find(q => ts.isPropertyAssignment(q) && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name)) && q.name.text === 'd')
    return p && ts.isPropertyAssignment(p) ? unwrapExpr(p.initializer) : undefined
  }
  // the route path of route(a, b, path), the d of pour(net, layer, d), else a `d` in an object argument
  const callLiteral = (node: ts.CallExpression): ts.Expression | undefined => {
    const callee = node.expression
    const name = ts.isIdentifier(callee) ? named.get(callee.text) : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined
    const args = node.arguments
    if ((name === 'route' || name === 'pour') && args.length >= 3) {
      const third = unwrapExpr(args[2])
      if (third && !ts.isObjectLiteralExpression(third)) return third
    }
    for (const a of args) { const d = dProp(a); if (d) return d }
    return undefined
  }
  const jsxLiteral = (tagName: ts.JsxTagNameExpression, attrs: ts.JsxAttributes): ts.Expression | undefined => {
    if (!ts.isIdentifier(tagName) || !PATH_TAGS.has(tagName.text)) return undefined
    const a = attrs.properties.find(p => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'd')
    if (!a || !ts.isJsxAttribute(a) || !a.initializer) return undefined
    if (ts.isStringLiteral(a.initializer)) return a.initializer
    return ts.isJsxExpression(a.initializer) ? unwrapExpr(a.initializer.expression) : undefined
  }
  const hasSrcAttr = (attrs: ts.JsxAttributes) => attrs.properties.some(p => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === '__src')
  const isHelper = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) return named.has(callee.text)
    return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)
      && ts.isIdentifier(callee.name) && HELPERS.has(callee.name.text)
  }
  // last, so it wins over a spread of the props a component received, which may carry the caller's __src
  const tag = (tagName: ts.JsxTagNameExpression, attrs: ts.JsxAttributes, whole: ts.Node) => {
    if (hasSrcAttr(attrs)) return
    s.appendLeft(attrs.end, ` __src={${range(whole, jsxLiteral(tagName, attrs))}}`)
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
    while (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent) node = node.parent.parent
    return node
  }
  // from the method name to the closing parenthesis
  const chainRange = (node: ts.CallExpression, name: ts.Node): string => {
    const a = lc(name.getStart(sf))
    const b = lc(node.getEnd() - 1)
    return `{ file: ${JSON.stringify(file)}, line: ${a.line + 1}, col: ${a.character + 1}, endLine: ${b.line + 1}, endCol: ${b.character + 1} }`
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name) && CHAIN.has(node.expression.name.text) && onRoute(node.expression.expression)) {
      s.appendLeft(node.getEnd(), `.__at(${chainRange(node, node.expression.name)})`)
      edits++
    }
    if (ts.isJsxElement(node)) tag(node.openingElement.tagName, node.openingElement.attributes, node)
    else if (ts.isJsxSelfClosingElement(node)) tag(node.tagName, node.attributes, node)
    else if (ts.isCallExpression(node) && isHelper(node.expression) && node.arguments.length > 1) {
      // positional forms, route(SIG, { … }), pour(GND, 'B.Cu', d), via(GND, at): into a last object literal, else an argument of its own
      const args = node.arguments
      const last = args[args.length - 1]
      const src = range(node, callLiteral(node), helperName(node.expression) !== 'pour')
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
    }
    else if (ts.isCallExpression(node) && isHelper(node.expression) && node.arguments.length) {
      const arg = node.arguments[0]
      const src = range(node, callLiteral(node), helperName(node.expression) !== 'pour')
      if (ts.isObjectLiteralExpression(arg)) {
        const own = arg.properties.some(p => p.name && ts.isIdentifier(p.name) && p.name.text === '__src')
        if (!own) {
          const props = arg.properties
          if (props.length) s.appendLeft(props[props.length - 1].getEnd(), `, __src: ${src}`)
          else s.appendLeft(arg.getEnd() - 1, ` __src: ${src} `)
          edits++
        }
      } else if (!ts.isSpreadElement(arg) && (helperName(node.expression) === 'route' || helperName(node.expression) === 'stitch')) {
        // route(a) starts a chain and stitch(GND) takes a net: the argument must stay what it is
        s.appendLeft(arg.getEnd(), `, { __src: ${src} }`)
        edits++
      } else if (!ts.isSpreadElement(arg) && helperName(node.expression) === 'wire') {
        // a hand wire is drawn by its whole chain, wire(a).h(2).Z(b)
        s.appendLeft(arg.getEnd(), `, { __src: ${range(chainTop(node))} }`)
        edits++
      } else if (!ts.isSpreadElement(arg)) {
        s.appendRight(arg.getStart(sf), 'Object.assign({}, ')
        s.appendLeft(arg.getEnd(), `, { __src: ${src} })`)
        edits++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  // a module-level `const R1 = …` goes through the registry's bindRef on globalThis, so the module needs no import
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) continue
    if (st.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) continue
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !REF_NAME.test(d.name.text) || !d.initializer) continue
      const p = lc(d.name.getStart(sf))
      const at = `{ file: ${JSON.stringify(file)}, line: ${p.line + 1}, col: ${p.character + 1} }`
      // the opening left of the start, the closing right of the end: outside any range the visit put at the same offsets
      s.appendLeft(d.initializer.getStart(sf), `((v) => { const f = globalThis[Symbol.for('pcbjs.bindRef')]; return f ? f(v, ${JSON.stringify(d.name.text)}, ${at}) : v })((`)
      s.appendRight(d.initializer.getEnd(), '))')
      edits++
    }
  }
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
