import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freeNames, moduleExports, scopeInject, ScopeError, toInjected, toSource } from '@pcbjs/compile/scope'
import ts from 'typescript'

const files = {
  '/p/board.sch.ts': `import { nets } from '@pcbjs/core'
export const { GND, VCC } = nets()
export const U1 = 1, R1 = 2
export function helper() {}
export type Shape = number
export interface Box { w: number }
export { Box as Alias }
export * from './more'
export default 3
`,
  '/p/more.ts': `export const J1 = 1\nexport * from './board.sch'\nexport { type T, Q1 } from './q'\n`,
  '/p/other.ts': `export const U1 = 1\n`,
}
const resolve = (spec, from) => {
  const base = new URL(spec, 'file://' + from).pathname
  for (const f of [base, base + '.ts']) if (files[f]) return { file: f, source: files[f] }
  return null
}
const sf = code => ts.createSourceFile('/p/pcb.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

test('scope: the exports of a module, through export * and without types or default', () => {
  const got = [...moduleExports({ file: '/p/board.sch.ts', source: files['/p/board.sch.ts'] }, resolve)].sort()
  assert.deepEqual(got, ['GND', 'J1', 'Q1', 'R1', 'U1', 'VCC', 'helper'])
})

test('scope: free names skip declarations, shadowing, members, intrinsic tags and types', () => {
  const code = `import PCB from '@pcbjs/core'
const a = 1
function f(U1: number) { const R1 = U1; return R1 + J1 }
const o = { U1: 1, VCC, [K]: 2 }
o.GND
type T = typeof Z
let x: Y = 1
try {} catch (E) { E }
label: for (const i of L) { break label }
export default <PCB name="x"><pad num={1} /><U1 at="1 2" /><sch.R1 />{Math.max(1)}{process}</PCB>
`
  assert.deepEqual(freeNames(sf(code)), ['J1', 'VCC', 'K', 'Z', 'L', 'U1', 'sch'])
})

test('scope: injects the used exports after the namespace import, leaving the rest alone', () => {
  const code = `import PCB from '@pcbjs/core'
import * as sch from './board.sch' // the netlist
export default <PCB name="b" schematic={sch}>
  <U1 at="1 2" />
  <J1 at="3 4" />
  {Missing}{Math}
</PCB>
`
  const inj = scopeInject(code, resolve, '/p/pcb.tsx')
  assert.equal(inj.text, ';const {J1,U1}=sch;')
  assert.equal(inj.at, code.indexOf(' // the netlist'))
  assert.deepEqual(inj.names, ['J1', 'U1'])
  assert.equal(inj.module, '/p/board.sch.ts')
  assert.equal(inj.code.split('\n').length, code.split('\n').length)
  const u = code.indexOf('<U1')
  assert.equal(inj.code.slice(toInjected(inj, u), toInjected(inj, u) + 3), '<U1')
  assert.equal(toSource(inj, toInjected(inj, u)), u)
  assert.equal(toSource(inj, inj.at + 3), inj.at)
  assert.equal(toSource(inj, 5), 5)
})

test('scope: a shadowed or member-only use binds nothing', () => {
  const code = `import * as sch from './board.sch'\nconst U1 = 2\nexport default <PCB name="b" schematic={sch}><sch.R1 /><U1 /></PCB>\n`
  assert.equal(scopeInject(code, resolve, '/p/pcb.tsx'), null)
})

test('scope: two schematic namespaces in one file are an error asking for a split', () => {
  const code = `import * as a from './board.sch'\nimport * as b from './other'\nexport const x = <PCB name="a" schematic={a}><U1 /></PCB>\nexport const y = <PCB name="b" schematic={b}><U1 /></PCB>\n`
  assert.throws(
    () => scopeInject(code, resolve, '/p/pcb.tsx'),
    e => e instanceof ScopeError && /a and b in one file/.test(e.message) && e.pos === code.lastIndexOf('schematic='),
  )
})

test('scope: a namespace not passed to schematic, or a drawing passed by name, injects nothing', () => {
  assert.equal(scopeInject(`import * as sch from './board.sch'\nexport default <PCB name="b"><U1 /></PCB>\n`, resolve, '/p/pcb.tsx'), null)
  assert.equal(scopeInject(`import { drawing } from './board.sch'\nexport default <PCB name="b" schematic={drawing}><U1 /></PCB>\n`, resolve, '/p/pcb.tsx'), null)
})
