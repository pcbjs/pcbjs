// The bare names of a schematic module: in a file with `import * as X from './m'` and `<PCB schematic={X}>`, every export of
// ./m the file uses without declaring is bound from X by one inserted statement, `;const {A,B}=X;`, at the end of that import.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import ts from 'typescript'

/** A module's file and source text. */
export interface ScopeModule {
  file: string
  source: string
}
/** Finds the module a specifier names from the importing file, or null when it is not a local source file. */
export type ResolveModule = (spec: string, from: string) => ScopeModule | null | undefined

/** One injection: `code` is `source` with `text` inserted at offset `at` of `source`. */
export interface ScopeInjection {
  code: string
  at: number
  text: string
  /** the namespace identifier and the file of its module */
  ns: string
  module: string
  /** the names bound, sorted */
  names: string[]
}

/** Thrown for a file the injector cannot scope, such as one passing two schematic namespaces. */
export class ScopeError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly pos: number,
  ) {
    super(message)
    this.name = 'ScopeError'
  }
}

const EXTS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']
const isFile = (f: string) => {
  try {
    return statSync(f).isFile()
  } catch {
    return false
  }
}

/** Resolves a relative specifier on disk the way a bundler does: as written, with a source extension, `.js` as `.ts`, or an index file. */
export const resolveFile: ResolveModule = (spec, from) => {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  const base = resolve(dirname(from), spec)
  const ext = extname(base)
  const stem = ['.js', '.jsx', '.mjs'].includes(ext) ? base.slice(0, -ext.length) : null
  const tries = [...(EXTS.includes(ext) ? [base] : []), ...EXTS.map(x => base + x), ...(stem ? EXTS.map(x => stem + x) : []), ...EXTS.map(x => resolve(base, 'index' + x))]
  const file = tries.find(isFile)
  return file && existsSync(file) ? { file, source: readFileSync(file, 'utf8') } : null
}

const kindOf = (file: string) => (/\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
const parse = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kindOf(file))
const has = (n: ts.Node, k: ts.SyntaxKind) => !!ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some(m => m.kind === k)

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text)
  else for (const e of name.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, out)
  return out
}

/** The value exports of a module, following `export *` through `resolveModule`; `default` and type-only exports are left out. */
export function moduleExports(mod: ScopeModule, resolveModule: ResolveModule = resolveFile, seen = new Set<string>()): Set<string> {
  const out = new Set<string>()
  if (seen.has(mod.file)) return out
  seen.add(mod.file)
  const sf = parse(mod.file, mod.source)
  const types = new Set<string>(),
    values = new Set<string>()
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) types.add(st.name.text)
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) bindingNames(d.name).forEach(n => values.add(n))
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name && ts.isIdentifier(st.name))
      values.add(st.name.text)
    else if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly) {
      const c = st.importClause
      if (c.name) values.add(c.name.text)
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) values.add(c.namedBindings.name.text)
      else if (c.namedBindings) for (const e of c.namedBindings.elements) if (!e.isTypeOnly) values.add(e.name.text)
    }
  }
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined
      if (!st.exportClause) {
        const m = spec !== undefined ? resolveModule(spec, mod.file) : null
        if (m) for (const n of moduleExports(m, resolveModule, seen)) out.add(n)
      } else if (ts.isNamespaceExport(st.exportClause)) out.add(st.exportClause.name.text)
      else
        for (const e of st.exportClause.elements) {
          const local = (e.propertyName ?? e.name).text
          if (!e.isTypeOnly && (spec !== undefined || !types.has(local) || values.has(local))) out.add(e.name.text)
        }
      continue
    }
    if (!has(st, ts.SyntaxKind.ExportKeyword) || has(st, ts.SyntaxKind.DefaultKeyword)) continue
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) bindingNames(d.name).forEach(n => out.add(n))
    else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st) || ts.isImportEqualsDeclaration(st)) &&
      st.name &&
      ts.isIdentifier(st.name)
    )
      out.add(st.name.text)
  }
  out.delete('default')
  return out
}

/** Names the runtime and the TypeScript libs provide, never taken from a schematic module. */
const GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  'globalThis',
  'undefined',
  'arguments',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'window',
  'document',
  'self',
  'navigator',
  'location',
])

class Scope {
  readonly names = new Set<string>()
  readonly fn: Scope
  constructor(
    readonly parent: Scope | null,
    fn = false,
  ) {
    this.fn = fn || !parent ? this : parent.fn
  }
  has(n: string): boolean {
    return this.names.has(n) || !!this.parent?.has(n)
  }
}

/** The identifiers a file reads as values without declaring or importing them, in order of first use. */
export function freeNames(sf: ts.SourceFile): string[] {
  const refs: [string, Scope][] = []
  const root = new Scope(null)
  const declare = (name: ts.BindingName, s: Scope) => bindingNames(name).forEach(n => s.names.add(n))
  const binding = (name: ts.BindingName, s: Scope) => {
    if (ts.isIdentifier(name)) return
    for (const e of name.elements) {
      if (ts.isOmittedExpression(e)) continue
      if (e.propertyName && ts.isComputedPropertyName(e.propertyName)) visit(e.propertyName.expression, s)
      if (e.initializer) visit(e.initializer, s)
      binding(e.name, s)
    }
  }
  const typeRefs = (n: ts.Node, s: Scope): void => {
    if (ts.isTypeQueryNode(n)) {
      let e: ts.EntityName = n.exprName
      while (ts.isQualifiedName(e)) e = e.left
      refs.push([e.text, s])
      return
    }
    ts.forEachChild(n, c => typeRefs(c, s))
  }
  const fnLike = (n: ts.SignatureDeclaration, s: Scope) => {
    const f = new Scope(s, true)
    if (ts.isFunctionExpression(n) && n.name) f.names.add(n.name.text)
    if (!ts.isArrowFunction(n)) f.names.add('arguments')
    if (n.name && ts.isComputedPropertyName(n.name)) visit(n.name.expression, s)
    for (const p of n.parameters) {
      declare(p.name, f)
      binding(p.name, f)
      if (p.type) typeRefs(p.type, f)
      if (p.initializer) visit(p.initializer, f)
      p.modifiers?.forEach(m => visit(m, f))
    }
    if (n.type) typeRefs(n.type, f)
    const body = (n as ts.FunctionLikeDeclaration).body
    if (body && ts.isBlock(body)) body.statements.forEach(st => visit(st, f))
    else if (body) visit(body, f)
  }
  const klass = (n: ts.ClassLikeDeclaration, s: Scope) => {
    const c = new Scope(s)
    if (n.name) c.names.add(n.name.text)
    n.modifiers?.forEach(m => visit(m, s))
    for (const h of n.heritageClauses ?? []) if (h.token === ts.SyntaxKind.ExtendsKeyword) h.types.forEach(t => visit(t.expression, s))
    for (const m of n.members) {
      if (m.name && ts.isComputedPropertyName(m.name)) visit(m.name.expression, c)
      if (ts.isPropertyDeclaration(m) && m.initializer) visit(m.initializer, c)
      else if (ts.isFunctionLike(m)) fnLike(m, c)
      else if (ts.isClassStaticBlockDeclaration(m)) visit(m.body, c)
    }
  }
  const visit = (n: ts.Node, s: Scope): void => {
    if (ts.isIdentifier(n)) {
      refs.push([n.text, s])
      return
    }
    if (ts.isExpressionWithTypeArguments(n)) return visit(n.expression, s)
    if (ts.isTypeNode(n)) return typeRefs(n, s)
    switch (n.kind) {
      case ts.SyntaxKind.ImportDeclaration: {
        const c = (n as ts.ImportDeclaration).importClause
        if (c?.name) root.names.add(c.name.text)
        if (c?.namedBindings) ts.isNamespaceImport(c.namedBindings) ? root.names.add(c.namedBindings.name.text) : c.namedBindings.elements.forEach(e => root.names.add(e.name.text))
        return
      }
      case ts.SyntaxKind.ImportEqualsDeclaration:
        s.names.add((n as ts.ImportEqualsDeclaration).name.text)
        return
      case ts.SyntaxKind.ExportDeclaration: {
        const e = n as ts.ExportDeclaration
        if (!e.moduleSpecifier && !e.isTypeOnly && e.exportClause && ts.isNamedExports(e.exportClause))
          for (const x of e.exportClause.elements) if (!x.isTypeOnly) refs.push([(x.propertyName ?? x.name).text, s])
        return
      }
      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
        return typeRefs(n, s)
      case ts.SyntaxKind.TypeParameter:
      case ts.SyntaxKind.BreakStatement:
      case ts.SyntaxKind.ContinueStatement:
      case ts.SyntaxKind.MetaProperty:
      case ts.SyntaxKind.JsxClosingElement:
      case ts.SyntaxKind.JsxNamespacedName:
        return
      case ts.SyntaxKind.EnumDeclaration:
        s.names.add((n as ts.EnumDeclaration).name.text)
        return
      case ts.SyntaxKind.ModuleDeclaration: {
        const m = n as ts.ModuleDeclaration
        if (ts.isIdentifier(m.name)) s.names.add(m.name.text)
        return
      }
      case ts.SyntaxKind.VariableDeclarationList: {
        const l = n as ts.VariableDeclarationList
        const target = l.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using) ? s : s.fn
        for (const d of l.declarations) {
          declare(d.name, target)
          binding(d.name, s)
          if (d.type) typeRefs(d.type, s)
          if (d.initializer) visit(d.initializer, s)
        }
        return
      }
      case ts.SyntaxKind.FunctionDeclaration: {
        const f = n as ts.FunctionDeclaration
        if (f.name) s.names.add(f.name.text)
        return fnLike(f, s)
      }
      case ts.SyntaxKind.ClassDeclaration: {
        const c = n as ts.ClassDeclaration
        if (c.name) s.names.add(c.name.text)
        return klass(c, s)
      }
      case ts.SyntaxKind.ClassExpression:
        return klass(n as ts.ClassExpression, s)
      case ts.SyntaxKind.FunctionExpression:
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
      case ts.SyntaxKind.Constructor:
        return fnLike(n as ts.SignatureDeclaration, s)
      case ts.SyntaxKind.Block:
      case ts.SyntaxKind.CaseBlock:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement: {
        const b = new Scope(s)
        ts.forEachChild(n, c => visit(c, b))
        return
      }
      case ts.SyntaxKind.CatchClause: {
        const c = n as ts.CatchClause,
          b = new Scope(s)
        if (c.variableDeclaration) {
          declare(c.variableDeclaration.name, b)
          binding(c.variableDeclaration.name, b)
        }
        c.block.statements.forEach(st => visit(st, b))
        return
      }
      case ts.SyntaxKind.PropertyAccessExpression:
        return visit((n as ts.PropertyAccessExpression).expression, s)
      case ts.SyntaxKind.PropertyAssignment: {
        const p = n as ts.PropertyAssignment
        if (ts.isComputedPropertyName(p.name)) visit(p.name.expression, s)
        return visit(p.initializer, s)
      }
      case ts.SyntaxKind.ShorthandPropertyAssignment: {
        const p = n as ts.ShorthandPropertyAssignment
        refs.push([p.name.text, s])
        if (p.objectAssignmentInitializer) visit(p.objectAssignmentInitializer, s)
        return
      }
      case ts.SyntaxKind.LabeledStatement:
        return visit((n as ts.LabeledStatement).statement, s)
      case ts.SyntaxKind.JsxAttribute: {
        const a = n as ts.JsxAttribute
        if (a.initializer) visit(a.initializer, s)
        return
      }
      case ts.SyntaxKind.JsxOpeningElement:
      case ts.SyntaxKind.JsxSelfClosingElement: {
        const e = n as ts.JsxOpeningElement
        // a lowercase name is an intrinsic element, not a value
        if (!ts.isIdentifier(e.tagName) || !/^[a-z]/.test(e.tagName.text)) visit(e.tagName, s)
        return visit(e.attributes, s)
      }
    }
    ts.forEachChild(n, c => visit(c, s))
  }
  sf.statements.forEach(st => visit(st, root))
  const out: string[] = []
  for (const [n, s] of refs) if (!s.has(n) && !GLOBALS.has(n) && !out.includes(n)) out.push(n)
  return out
}

/** The `import * as X` statements of a file that pass X to a `schematic={X}` attribute. */
function schematicImports(sf: ts.SourceFile): { ns: string; decl: ts.ImportDeclaration; attr: ts.JsxAttribute }[] {
  const ns = new Map<string, ts.ImportDeclaration>()
  for (const st of sf.statements) {
    const b = ts.isImportDeclaration(st) && !st.importClause?.isTypeOnly ? st.importClause?.namedBindings : undefined
    if (b && ts.isNamespaceImport(b)) ns.set(b.name.text, st as ts.ImportDeclaration)
  }
  const out: { ns: string; decl: ts.ImportDeclaration; attr: ts.JsxAttribute }[] = []
  if (!ns.size) return out
  const visit = (n: ts.Node): void => {
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'schematic' && n.initializer && ts.isJsxExpression(n.initializer)) {
      const e = n.initializer.expression
      const d = e && ts.isIdentifier(e) ? ns.get(e.text) : undefined
      if (d && !out.some(o => o.ns === (e as ts.Identifier).text)) out.push({ ns: (e as ts.Identifier).text, decl: d, attr: n })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/**
 * Binds the exports of the schematic namespace the file passes to `<PCB schematic={X}>` that the file uses as free names.
 * Null when the file passes no namespace or uses none of its exports. Two namespaces in one file throw a ScopeError.
 */
export function scopeInject(source: string, resolveModule: ResolveModule = resolveFile, file = 'design.tsx'): ScopeInjection | null {
  if (!source.includes('schematic')) return null
  const sf = parse(file, source)
  const found = schematicImports(sf)
  if (!found.length) return null
  if (found.length > 1) {
    const at = found[1].attr.getStart(sf),
      { line } = sf.getLineAndCharacterOfPosition(at)
    throw new ScopeError(
      `${file}:${line + 1}: <PCB schematic> takes the namespaces ${found.map(f => f.ns).join(' and ')} in one file; put each board with its own schematic module in a file of its own`,
      file,
      at,
    )
  }
  const { ns, decl } = found[0]
  const mod = resolveModule((decl.moduleSpecifier as ts.StringLiteral).text, file)
  if (!mod) return null
  const exported = moduleExports(mod, resolveModule)
  const names = freeNames(sf)
    .filter(n => exported.has(n))
    .sort()
  if (!names.length) return null
  const at = decl.getEnd(),
    text = `;const {${names.join(',')}}=${ns};`
  return { code: source.slice(0, at) + text + source.slice(at), at, text, ns, module: mod.file, names }
}

/** A position in the injected code as a position in the original source; one inside the inserted text maps to its start. */
export const toSource = (inj: Pick<ScopeInjection, 'at' | 'text'> | null | undefined, pos: number): number =>
  !inj || pos <= inj.at ? pos : pos < inj.at + inj.text.length ? inj.at : pos - inj.text.length
/** A position in the original source as a position in the injected code. */
export const toInjected = (inj: Pick<ScopeInjection, 'at' | 'text'> | null | undefined, pos: number): number => (!inj || pos < inj.at ? pos : pos + inj.text.length)

/**
 * A compiler host whose source files under `root` carry their injection; `injections` holds each one by file name, for
 * mapping diagnostics back with `toSource`. A file the injector rejects keeps its text, and its error is in `errors`.
 */
export function scopeHost(options: ts.CompilerOptions, root?: string, base: ts.CompilerHost = ts.createCompilerHost(options, true)) {
  const injections = new Map<string, ScopeInjection>()
  const errors = new Map<string, ScopeError>()
  const want = (f: string) => /\.[jt]sx?$/.test(f) && !f.endsWith('.d.ts') && !f.includes('/node_modules/') && (!root || f.startsWith(root.replace(/\/$/, '') + '/'))
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile(name, lang, onError, fresh) {
      if (!want(name)) return base.getSourceFile(name, lang, onError, fresh)
      const text = base.readFile(name)
      if (text === undefined) return base.getSourceFile(name, lang, onError, fresh)
      let inj: ScopeInjection | null = null
      try {
        inj = scopeInject(text, resolveFile, name)
      } catch (e) {
        if (e instanceof ScopeError) errors.set(name, e)
        else throw e
      }
      if (inj) injections.set(name, inj)
      else injections.delete(name)
      return ts.createSourceFile(name, inj ? inj.code : text, lang, false)
    },
  }
  return { host, injections, errors }
}

/** A diagnostic's file name, start and line and column in the original text of its file. */
export function sourcePosition(d: ts.Diagnostic, injections: ReadonlyMap<string, ScopeInjection>): { file: string; start: number; line: number; col: number } | null {
  if (!d.file || d.start === undefined) return null
  const inj = injections.get(d.file.fileName)
  const start = toSource(inj, d.start)
  const text = inj ? d.file.text.slice(0, inj.at) + d.file.text.slice(inj.at + inj.text.length) : d.file.text
  const lines = text.slice(0, start).split('\n')
  return { file: d.file.fileName, start, line: lines.length, col: lines[lines.length - 1].length + 1 }
}
