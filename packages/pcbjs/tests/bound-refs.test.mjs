// Refs from variable names: a part bound to a module-level const or let named like a ref takes that name as its ref.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import PCB, { h, nets, bindRef, SchematicError } from '@pcbjs/core'
import { R0603, LED0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { transformSourceRanges } from '@pcbjs/cli/source-ranges'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 20 })
const board = (...children) => h(PCB, { name: 'Bound' }, edge(), ...children)
const refOf = (b, at) => b.footprints.find(f => f.at[0] === at[0] && f.at[1] === at[1])?.ref
const site = line => ({ file: 'sch.ts', line, col: 7 })

test('bound refs: the variable name is the ref, other parts skip the names taken', () => {
  const { A, B } = nets()
  const Ra = R0603('1').connect(A, B) // declared first, not bound: numbered
  const R1 = bindRef(R0603('2').connect(A, B), 'R2', site(2)) // bound to R2 though declared second
  const Rc = R0603('3').connect(A, B)
  const D7 = bindRef(LED0603().connect(A, B), 'D7', site(4))
  const b = compileBoard(board(h(Ra, { at: '5 5' }), h(R1, { at: '10 5' }), h(Rc, { at: '15 5' }), h(D7, { at: '20 5' })))
  assert.equal(refOf(b, [10, 5]), 'R2')
  assert.equal(refOf(b, [5, 5]), 'R1')
  assert.equal(refOf(b, [15, 5]), 'R3', 'numbering skips R2, taken by name')
  assert.equal(refOf(b, [20, 5]), 'D7')
})

test('bound refs: .ref() wins, the first binding wins, and non-parts and bad names are left alone', () => {
  const { A, B } = nets()
  const p = bindRef(R0603('1').connect(A, B).ref('R9'), 'R4', site(1))
  const q = bindRef(R0603('2').connect(A, B), 'R5', site(2))
  assert.equal(bindRef(q, 'R6', site(3)), q, 'an alias returns the value')
  assert.equal(bindRef(42, 'R7'), 42)
  const r = bindRef(R0603('3').connect(A, B), 'Rx', site(4))
  const b = compileBoard(board(h(p, { at: '5 5' }), h(q, { at: '10 5' }), h(r, { at: '15 5' })))
  assert.equal(refOf(b, [5, 5]), 'R9')
  assert.equal(refOf(b, [10, 5]), 'R5')
  assert.equal(refOf(b, [15, 5]), 'R1')
})

test('bound refs: two parts bound to one name are a SchematicError naming both sites', () => {
  const { A, B } = nets()
  const x = bindRef(R0603('1').connect(A, B), 'R1', { file: 'a.ts', line: 3, col: 7 })
  const y = bindRef(R0603('2').connect(A, B), 'R1', { file: 'b.ts', line: 8, col: 14 })
  assert.throws(
    () => compileBoard(board(h(x, { at: '5 5' }), h(y, { at: '10 5' }))),
    e => e instanceof SchematicError && /two parts are bound to the ref R1/.test(e.message) && e.message.includes('a.ts:3:7') && e.message.includes('b.ts:8:14'),
  )
  // a written footprint with the same ref
  const z = bindRef(R0603('3').connect(A, B), 'R2', site(5))
  assert.throws(
    () => compileBoard(board(h(z, { at: '5 5' }), h(R0603, { ref: 'R2', at: '20 10', nets: { 1: A, 2: B } }))),
    e => e instanceof CompileError && /duplicate ref R2/.test(e.message) && /bound to the variable R2 at sch\.ts:5:7/.test(e.message),
  )
})

test('bound refs: the transform wraps module-level const and let named like a ref, nothing else', () => {
  const code = [
    `import { nets } from './n'`,
    `import { R0603 } from '@pcbjs/lib'`,
    `export const R1 = R0603('1k').connect(A, B)`,
    `let D12 = LED()`,
    `const Rpull = R0603('10k'), [R4, R5] = pair, { R6 } = obj`,
    `function f() { const R7 = R0603() }`,
    `var R8 = R0603()`,
  ].join('\n')
  const out = transformSourceRanges(code, '/p/sch.ts', 'sch.ts').code
  assert.ok(out.includes(`f(v, "R1", { file: "sch.ts", line: 3, col: 14 })`), out)
  assert.ok(out.includes(`f(v, "D12", { file: "sch.ts", line: 4, col: 5 })`), out)
  for (const n of ['Rpull', 'R4', 'R5', 'R6', 'R7', 'R8']) assert.ok(!out.includes(`"${n}"`), n)
  assert.ok(out.includes(`((R0603('1k').connect(A, B)))`), out)
})

test('bound refs: a transformed module gives its parts the names of their variables', async () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = mkdtempSync(join(here, '.bound-'))
  try {
    const src = [
      `import { nets } from '@pcbjs/core'`,
      `import { R0603, PinHeader } from '@pcbjs/lib'`,
      `const { A, B } = nets()`,
      `export const J5 = PinHeader(2).connect(A, B)`,
      `export const J4 = PinHeader(2).connect(A, B)`,
      `export const other = PinHeader(2).connect(A, B)`,
    ].join('\n')
    const t = transformSourceRanges(src, join(dir, 'sch.ts'), 'sch.ts').code
    const js = (await transform(t, { loader: 'ts', format: 'esm' })).code
    writeFileSync(join(dir, 'sch.mjs'), js)
    const m = await import(pathToFileURL(join(dir, 'sch.mjs')).href)
    const b = compileBoard(board(h(m.J5, { at: '5 5' }), h(m.J4, { at: '15 5' }), h(m.other, { at: '25 5' })))
    assert.equal(refOf(b, [5, 5]), 'J5')
    assert.equal(refOf(b, [15, 5]), 'J4')
    assert.equal(refOf(b, [25, 5]), 'J1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
