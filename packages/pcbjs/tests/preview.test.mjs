// The isolated preview: what a default export becomes on the transient board, compiled with the real compiler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, circuit, layout } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'
import { compileBoards } from '@pcbjs/compile'
import { instantiate, previewRoot, ROW_PITCH, withOutline } from '@pcbjs/cli/preview'

const chan = circuit('pchan', ({ VCC, SW }, { nets: { led } }) => ({
  R: R0603('330').connect(VCC, led),
  D: LED0603('green').connect({ A: led, K: SW }),
}))
const Row = layout(chan, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' }), h(g.D, { at: '6 0 180deg' })), 'PRow')
const compile = r => compileBoards(r.root)[0]
const at = (b, ref) => b.footprints.find(f => f.ref === ref)?.at

test('preview: a default-exported <PCB> is compiled as it is', () => {
  const root = h(PCB, { name: 'Scratch' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 }))
  const r = previewRoot({ default: root })
  assert.equal(r.kind, 'board')
  assert.equal(r.wrapped, false)
  assert.equal(compile(r).name, 'Scratch')
})

test('preview: a part is placed at the origin of a wrapped board, which gets an outline around it', () => {
  const { A, B } = nets()
  const r = previewRoot({ default: R0603('1k').connect(A, B) })
  assert.equal(r.kind, 'part')
  const b = compile(r)
  assert.equal(b.footprints.length, 1)
  assert.deepEqual(b.footprints[0].at, [0, 0])
  const framed = compileBoards(withOutline(r.root, b.bbox))[0]
  assert.equal(framed.outline.length, 1)
})

test('preview: an instance without a layout is a row of its parts at the pitch, with a layout of the file it uses that', () => {
  const { VCC, SW } = nets()
  const inst = chan({ VCC, SW }, 'P1')
  const row = previewRoot({ default: inst })
  assert.equal(row.kind, 'instance')
  const b = compile(row)
  assert.deepEqual(b.footprints.map(f => f.at[0]).sort((x, y) => x - y), [0, ROW_PITCH])
  const laid = compile(previewRoot({ default: inst, Row }))
  assert.deepEqual(laid.footprints.map(f => f.at[0]).sort((x, y) => x - y), [0, 6])
})

test('preview: a layout instantiates its circuit, found in the module or the modules it imports, ports on nets named after them', () => {
  const r = previewRoot({ default: Row }, [{ chan }])
  assert.equal(r.kind, 'layout')
  const b = compile(r)
  assert.equal(b.footprints.length, 2)
  assert.ok(b.nets.some(n => n.name === 'VCC'))
  assert.ok(b.nets.some(n => n.name === 'SW'))
  // the circuit nowhere in reach: nothing to show
  assert.equal(previewRoot({ default: Row }), null)
  const inst = instantiate(chan)
  assert.deepEqual(Object.keys(inst.ports).sort(), ['SW', 'VCC'])
})

test('preview: anything else shows nothing', () => {
  assert.equal(previewRoot({}), null)
  assert.equal(previewRoot({ default: 42 }), null)
  assert.equal(previewRoot({ default: { a: 1 } }), null)
  assert.equal(previewRoot({ default: () => null }), null)
  assert.equal(previewRoot({ default: chan }), null)
})
