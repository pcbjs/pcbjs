// Part names as the compiler sees them: a part bound to a constant takes its name as its ref, and a part with no name is extracted to one.
import ts from 'typescript'

/** The ref style: capital letters, then digits; another name is a hint, never an error. */
const REF_STYLE = /^[A-Z]+[0-9]+$/

/** An offset range in the text the language service reads, with what to say or write there. */
export interface NameHint {
  start: number
  end: number
  message: string
}
export interface Extract {
  title: string
  /** the inserted declaration and the replaced call, offsets in the service text */
  edits: { start: number; end: number; newText: string }[]
}

const unwrap = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression
  return e
}

function isPart(n: ts.Node, checker: ts.TypeChecker): boolean {
  try {
    const type = checker.getTypeAtLocation(n)
    const prop = type.getProperty('$$') ?? checker.getApparentType(type).getProperty('$$')
    const t = prop && checker.getTypeOfSymbol(prop)
    return !!t && t.isStringLiteral() && t.value === 'part'
  } catch {
    return false
  }
}

/** Hints for module-level part bindings not named letters then digits: the name is the ref the silk and BOM print. */
export function nameHints(program: ts.Program, file: string): NameHint[] {
  const sf = program.getSourceFile(file)
  if (!sf) return []
  const checker = program.getTypeChecker()
  const out: NameHint[] = []
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || REF_STYLE.test(d.name.text) || !d.initializer || !isPart(d.initializer, checker)) continue
      out.push({
        start: d.name.getStart(sf),
        end: d.name.getEnd(),
        message: `${d.name.text} is this part's ref on the silk and in the BOM; refs read capital letters then digits, such as R3`,
      })
    }
  }
  return out
}

/** The outermost call of a method chain on a part, `R0603('1k').connect(…)`, that holds `n`. */
function chainTop(n: ts.Node): ts.Expression | undefined {
  let call: ts.Node | undefined = n
  while (call && !ts.isCallExpression(call)) call = call.parent
  if (!call) return undefined
  let top = call as ts.Expression
  for (;;) {
    const p: ts.Node = top.parent
    if (ts.isPropertyAccessExpression(p) && p.expression === top && ts.isCallExpression(p.parent) && p.parent.expression === p) top = p.parent
    else if (ts.isCallExpression(p) && p.expression === top) top = p
    else return top
  }
}

/** True when the part already has a name: bound to a constant, keyed in an object such as a circuit's members, or given a ref option. */
function named(e: ts.Expression): boolean {
  let p: ts.Node = e.parent
  while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) p = p.parent
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p)) return true
  let call: ts.Expression = e
  while (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) call = call.expression.expression
  while (ts.isCallExpression(call) && ts.isCallExpression(call.expression)) call = call.expression
  return (
    ts.isCallExpression(call) && call.arguments.some(a => ts.isObjectLiteralExpression(a) && a.properties.some(q => q.name && ts.isIdentifier(q.name) && q.name.text === 'ref'))
  )
}

/** The factory a part call starts with, `R0603` of `R0603('1k').connect(…)`. */
function factoryName(e: ts.Expression): string | undefined {
  let c = e
  while (ts.isCallExpression(c)) c = ts.isPropertyAccessExpression(c.expression) && ts.isCallExpression(c.expression.expression) ? c.expression.expression : c.expression
  return ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : undefined
}

/**
 * Extract the part with no name at `offset` to a module constant carrying the next free number: `const R4 = R0603('1k')…`.
 * `prefix` gives the part's ref prefix when the compiler knows it, else the factory's leading capitals stand in; `taken` are refs in use.
 */
export function extractPart(
  program: ts.Program,
  file: string,
  offset: number,
  prefix?: (call: ts.Expression) => string | undefined,
  taken: Iterable<string> = [],
): Extract | undefined {
  const sf = program.getSourceFile(file)
  if (!sf) return undefined
  const checker = program.getTypeChecker()
  let at: ts.Node | undefined
  const find = (n: ts.Node): void => {
    if (offset < n.getStart(sf) || offset >= n.getEnd()) return
    at = n
    ts.forEachChild(n, find)
  }
  find(sf)
  const top = at && chainTop(at)
  if (!top || !isPart(unwrap(top), checker) || named(top)) return undefined
  // a call in a function may read its locals, so it cannot move to the module
  for (let q: ts.Node = top.parent; q !== sf; q = q.parent) if (ts.isFunctionLike(q)) return undefined
  const pre = prefix?.(top) ?? /^[A-Z]+/.exec(factoryName(top) ?? '')?.[0] ?? 'U'
  const used = new Set(taken)
  for (const st of sf.statements) if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) used.add(d.name.text)
  let k = 1
  while (used.has(`${pre}${k}`)) k++
  const name = `${pre}${k}`
  let stmt: ts.Node = top
  while (stmt.parent && stmt.parent !== sf) stmt = stmt.parent
  const indent = /[^\n]*$/.exec(sf.text.slice(0, stmt.getStart(sf)))![0].replace(/\S.*$/, '')
  return {
    title: `Name this part ${name}`,
    edits: [
      { start: stmt.getStart(sf), end: stmt.getStart(sf), newText: `const ${name} = ${top.getText(sf)}\n${indent}` },
      { start: top.getStart(sf), end: top.getEnd(), newText: name },
    ],
  }
}
