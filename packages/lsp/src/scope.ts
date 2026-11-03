// The names the code can write at an offset, through the language service: each value in scope whose type carries the part or circuit brand; docs/editing.md, Route ends.
import ts from 'typescript'
import type { CodeScope, ScopeValue } from './assist.js'

/** The innermost node around an offset of the service's text. */
function nodeAt(sf: ts.SourceFile, offset: number): ts.Node {
  let n: ts.Node = sf
  for (let inner: ts.Node | undefined = sf; inner;) {
    n = inner
    inner = ts.forEachChild(n, c => (c.getStart(sf) <= offset && offset <= c.end ? c : undefined))
  }
  return n
}

/** `part` or `circuit` when the type's `$$` brand says so. */
function brandOf(checker: ts.TypeChecker, type: ts.Type): ScopeValue['kind'] | null {
  const p = type.getProperty('$$')
  const t = p && checker.getTypeOfSymbol(p)
  return t?.isStringLiteral() && (t.value === 'part' || t.value === 'circuit') ? t.value : null
}

/** The name a declaration binds, `CH2` of `{ CH2: ch2 }`, and the instance name a string argument of its initializing call gives. */
function originOf(d: ts.Declaration, id: string): Pick<ScopeValue, 'origin' | 'arg'> {
  if (ts.isBindingElement(d)) return { origin: d.propertyName && ts.isIdentifier(d.propertyName) ? d.propertyName.text : id }
  const name = ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) ? d.name.text : id
  let init = ts.isVariableDeclaration(d) ? d.initializer : undefined
  while (init && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isNonNullExpression(init))) init = init.expression
  const arg = init && ts.isCallExpression(init) ? init.arguments.find(ts.isStringLiteralLike)?.text : undefined
  return { origin: name, ...(arg ? { arg } : {}) }
}

/** The values in scope at an offset of the service's text that are parts or circuit instances, and every value name in scope. */
export function codeScope(program: ts.Program, file: string, offset: number): CodeScope | undefined {
  const sf = program.getSourceFile(file)
  if (!sf) return undefined
  const checker = program.getTypeChecker()
  const at = nodeAt(sf, offset)
  const values: ScopeValue[] = []
  const names = new Set<string>()
  for (const s of checker.getSymbolsInScope(at, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)) {
    names.add(s.name)
    const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
    const d = target.declarations?.[0]
    if (!d || d.getSourceFile().isDeclarationFile || !(target.flags & ts.SymbolFlags.Value)) continue
    const kind = brandOf(checker, checker.getTypeOfSymbol(target))
    if (kind) values.push({ id: s.name, kind, ...originOf(d, target.name), ...(ts.isParameter(d) ? { param: true } : {}) })
  }
  return { values, names }
}
