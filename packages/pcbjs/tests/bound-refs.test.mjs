// Part names: the binding a part, route or circuit local is captured by names it, an instance index numbers circuit parts,
// a placed part with no name and a bound part or route never placed are compile errors, <Place> places what the file cannot name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import PCB, { h, nets, bindRef, circuit, route, Place, Schematic, SchematicError } from '@pcbjs/core'
import { R0603, LED0603, PinHeader, MountingHole } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { transformSourceRanges } from '@pcbjs/cli/internal/source-ranges'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 20 })
const board = (...children) => h(PCB, { name: 'Bound' }, edge(), ...children)
const refOf = (b, at) => b.footprints.find(f => f.at[0] === at[0] && f.at[1] === at[1])?.ref
const site = line => ({ file: 'sch.ts', line, col: 7 })

test('names: the binding is the ref, any identifier, the first binding wins, a ref option wins over a binding', () => {
  const { A, B } = nets()
  const p = bindRef(R0603('1').connect({ 1: A, 2: B }), 'Rpull', site(1))
  assert.equal(bindRef(p, 'R6', site(2)), p, 'an alias returns the value')
  const q = bindRef(R0603('2', { ref: 'R9' }).connect({ 1: A, 2: B }), 'R4', site(3))
  assert.equal(bindRef(42, 'R7'), 42)
  const b = compileBoard(board(h(p, { at: '5 5' }), h(q, { at: '10 5' })))
  assert.equal(refOf(b, [5, 5]), 'Rpull')
  assert.equal(refOf(b, [10, 5]), 'R9')
})

test('names: two parts of one name are a compile error naming both sites', () => {
  const { A, B } = nets()
  const x = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1', { file: 'a.ts', line: 3, col: 7 })
  const y = bindRef(R0603('2').connect({ 1: A, 2: B }), 'R1', { file: 'b.ts', line: 8, col: 14 })
  assert.throws(
    () => compileBoard(board(h(x, { at: '5 5' }), h(y, { at: '10 5' }))),
    e => e instanceof CompileError && /two parts are named R1/.test(e.message) && e.message.includes('a.ts:3:7') && e.message.includes('b.ts:8:14'),
  )
})

test('names: a placed part with no name is a compile error suggesting the next free name', () => {
  const { A, B } = nets()
  const R1 = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1', site(1))
  const loose = R0603('2').connect({ 1: A, 2: B })
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), h(loose, { at: '10 5' }))),
    e => e instanceof CompileError && /R0603\("2"\) has no name/.test(e.message) && /const R2 = /.test(e.message) && /\{ ref: 'R2' \}/.test(e.message),
  )
})

test('names: the transform captures every const and let binding, destructured names after the statement, function bodies as local', () => {
  const code = [
    `import { R0603 } from '@pcbjs/lib'`,
    `export const R1 = R0603('1k').connect({ 1: A, 2: B })`,
    `let Rpull = R0603('10k')`,
    `const [R4, R5] = pair, { R6 } = obj`,
    `function f() { const R7 = R0603() }`,
    `const n = 3, s = 'x', g = () => 1`,
    `for (const R8 of list) use(R8)`,
  ].join('\n')
  const out = transformSourceRanges(code, '/p/sch.ts', 'sch.ts').code
  assert.ok(out.includes(`f(v, "R1", { file: "sch.ts", line: 2, col: 14 }, false)`), out)
  assert.ok(out.includes(`f(v, "Rpull", { file: "sch.ts", line: 3, col: 5 }, false)`), out)
  for (const n of ['R4', 'R5', 'R6']) assert.ok(out.includes(`f(${n}, "${n}"`), n)
  assert.ok(out.includes(`f(v, "R7", { file: "sch.ts", line: 5, col: 22 }, true)`), out)
  for (const n of ['n', 's', 'g', 'R8']) assert.ok(!out.includes(`"${n}"`), n)
})

test('names: a transformed module names its parts and a bound route, route:vccTrunk, and a bound route never placed is a compile error', async () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = mkdtempSync(join(here, '.bound-'))
  try {
    const src = [
      `import { nets, route } from '@pcbjs/core'`,
      `import { PinHeader } from '@pcbjs/lib'`,
      `const { A, B } = nets()`,
      `export const J5 = PinHeader(2)().connect({ 1: A, 2: B })`,
      `export const J_IN = PinHeader(2)().connect({ 1: A, 2: B })`,
      `export const vccTrunk = route(J5[1], J_IN[1]).width(0.3)`,
    ].join('\n')
    const file = join(dir, 'sch.ts')
    const t = transformSourceRanges(src, file, file).code
    writeFileSync(join(dir, 'sch.mjs'), (await transform(t, { loader: 'ts', format: 'esm' })).code)
    const m = await import(pathToFileURL(join(dir, 'sch.mjs')).href)
    const root = (...kids) => ({ ...board(...kids), props: { ...board().props, __src: { file, line: 1, col: 1 } } })
    const b = compileBoard(root(h(m.J5, { at: '5 5' }), h(m.J_IN, { at: '25 5' }), m.vccTrunk, route(m.J5[2], m.J_IN[2])))
    assert.equal(refOf(b, [5, 5]), 'J5')
    assert.equal(refOf(b, [25, 5]), 'J_IN')
    assert.deepEqual(
      [...new Set(b.items.filter(i => i.kind === 'track').map(i => i.route))].sort(),
      ['route:2', 'route:vccTrunk'],
      'a bound route answers to its name; unbound ones count every route in tree order',
    )
    assert.throws(
      () => compileBoard(root(h(m.J5, { at: '5 5' }), h(m.J_IN, { at: '25 5' }), route(m.J5[2], m.J_IN[2]))),
      e => e instanceof CompileError && /the route vccTrunk at .*sch\.ts:6:14 is bound but never placed/.test(e.message),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('names: a part of a file that placed parts, never placed itself, is a compile error naming it', () => {
  const { A, B } = nets()
  const R1 = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1', site(1))
  const R2 = bindRef(R0603('2').connect({ 1: A, 2: B }), 'R2', site(2))
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }))),
    e => e instanceof CompileError && /R2 at .* is declared but never placed on <PCB Bound>/.test(e.message),
  )
  void R2
})

const channel = circuit('channel', ({ VCC, GND }, { nets: { mid } }) => {
  const R01 = bindRef(R0603('1k').connect({ 1: VCC, 2: mid }), 'R01', site(1), true)
  return { R01, D: LED0603('red').connect({ A: mid, K: GND }) }
})

test('instances: an index names the instance and numbers its parts, letters, index, local digits; none is an error', () => {
  const { VCC, GND } = nets()
  const ch2 = channel({ VCC, GND }, 'CH2')
  const ch7 = channel({ VCC, GND }, 7)
  assert.equal(ch2.name, 'CH2')
  assert.equal(ch7.name, 'channel7')
  assert.throws(
    () => channel({ VCC, GND }),
    e => e instanceof SchematicError && /needs an index/.test(e.message),
  )
  const b = compileBoard(board(h(ch2.R01, { at: '5 5' }), h(ch2.D, { at: '10 5' }), h(ch7.R01, { at: '15 5' }), h(ch7.D, { at: '20 5' })))
  assert.equal(refOf(b, [5, 5]), 'R201', 'ch2.R01 is CH2/R01, ref R201')
  assert.equal(refOf(b, [10, 5]), 'D2')
  assert.equal(refOf(b, [15, 5]), 'R701')
  const r201 = b.schematic.parts.find(p => p.ref === 'R201')
  assert.deepEqual([r201.path, r201.local], [['CH2'], 'R01'])
})

test('instances: a part bound in the build under one name and returned under another is a SchematicError', () => {
  const bad = circuit('bad', ({ VCC, GND }) => {
    const R01 = bindRef(R0603('1k').connect({ 1: VCC, 2: GND }), 'R01', site(1), true)
    return { R: R01 }
  })
  const { VCC, GND } = nets()
  assert.throws(
    () => bad({ VCC, GND }, 1),
    e => e instanceof SchematicError && /named R01 but returned under the key R/.test(e.message),
  )
})

test('<Place> places a part held in an array, on the board and in the schematic; <g name> is a level of the path', () => {
  const { A, B } = nets()
  const LEDS = [1, 2].map(i => LED0603('red', { ref: `D${i}` }).connect({ A, K: B }))
  const J1 = bindRef(PinHeader(2)().connect({ 1: A, 2: B }), 'J1', site(1))
  const drawing = h(Schematic, {}, h(Place, { part: LEDS[1], at: '10 4' }))
  const b = compileBoard(
    h(PCB, { name: 'Place', schematic: { drawing } }, edge(), h('g', { name: 'Row' }, ...LEDS.map((d, i) => h(Place, { part: d, at: `${10 + i * 5} 10` }))), h(J1, { at: '3 5' })),
  )
  assert.equal(refOf(b, [15, 10]), 'D2')
  const d2 = b.schematic.parts.find(p => p.ref === 'D2')
  assert.deepEqual(d2.path, ['Row'])
  assert.ok(b.schematic.circuits.some(c => c.kind === 'group' && c.name === 'Row' && c.parts.includes('D1')))
  assert.ok(b.schematic.drawing.symbols.some(s => s.ref === 'D2' && !s.auto))
  assert.throws(() => Place({ part: 3, at: '1 1' }), /needs part=/)
})

test('a placement takes at, side, grid, ref:at and thermal only; the rest belongs to the part', () => {
  const { A, B } = nets()
  const R1 = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1', site(1))
  for (const k of ['dnp', 'bom', 'fields', 'model', 'rules', 'ref', 'nets'])
    assert.throws(
      () => compileBoard(board(h(R1, { at: '5 5', [k]: k === 'ref' ? false : {} }))),
      e => e instanceof CompileError && new RegExp(`a placement takes at, side, grid, ref:at and thermal, not ${k}`).test(e.message),
      k,
    )
})

test('MountingHole as a part: a part never connected raises no unconnected-pin, a connected one does for a pin it leaves out', () => {
  const { A, B } = nets()
  const H1 = bindRef(MountingHole(3.2, { pad: true })(), 'H1', site(1))
  const J1 = bindRef(PinHeader(3)().connect({ 1: A, 2: B }), 'J1', site(2))
  const b = compileBoard(board(h(H1, { at: '30 10' }), h(J1, { at: '5 5' })))
  const open = b.erc.filter(f => f.rule === 'unconnected-pin').map(f => f.message)
  assert.equal(open.length, 1, open.join('\n'))
  assert.match(open[0], /^J1\/3/)
  assert.equal(b.items.find(i => i.kind === 'pad' && i.ref === 'H1').net, undefined)
})

test('removed forms are errors: positional connect, a value in the options, a factory as an element, a string net, a REF.PIN end', () => {
  const { A, B } = nets()
  assert.throws(
    () => R0603('1').connect(A, B),
    e => e instanceof SchematicError && /takes one object of nets by pin name/.test(e.message),
  )
  assert.throws(
    () => R0603({ value: '1k' }),
    e => e instanceof SchematicError && /value as its first argument/.test(e.message),
  )
  assert.throws(
    () => R0603('1k', { fields: {} }),
    e => e instanceof SchematicError && /unknown part option "fields"/.test(e.message),
  )
  assert.throws(() => R0603({ ref: 'R1', at: '5 5' }), /footprint factory, not an element/)
  const R1 = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1', site(1))
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route('1 1').net('A').H(3))),
    e => e instanceof CompileError && /got the string "A"/.test(e.message),
  )
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route('R1.1', '9 9'))),
    e => e instanceof CompileError && /is no coordinate; a pad is named by its handle/.test(e.message),
  )
  assert.throws(
    () => compileBoard(board(h('footprint', { ref: 'U9', at: '5 5' }, h('pad', { num: 1, size: 1 })))),
    e => e instanceof CompileError && /<footprint> draws the footprint of a part/.test(e.message),
  )
})
