// A named <g>: one level of hierarchy for the parts placed inside it, nesting into paths, listed with the board's circuits;
// refs stay the parts' own names, and two groups of one path are a compile error. group() is gone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, * as core from '@pcbjs/core'
import { h, nets, bindRef } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 30 })
const board = (props, ...children) => h(PCB, { name: 'Group', ...props }, edge(), ...children)
const part = (b, ref) => b.schematic.parts.find(p => p.ref === ref)

test('named g: the parts placed inside take its name as their path, refs stay their own, and the board lists it', () => {
  const { VCC, GND } = nets()
  const ports = [1, 2].map(n => {
    const { LED } = nets(`L${n}`)
    return { n, x: n * 10, R: R0603('330', { ref: `R${n}` }).connect({ 1: VCC, 2: LED }), D: LED0603('green', { ref: `D${n}` }).connect({ A: LED, K: GND }) }
  })
  const b = compileBoard(board({}, ...ports.map(p => h('g', { name: `P${p.n}` }, h(p.R, { at: `${p.x} 5` }), h(p.D, { at: `${p.x} 10` })))))
  assert.deepEqual(
    ['R1', 'R2', 'D1', 'D2'].map(r => part(b, r)?.path.join('/') + ':' + part(b, r)?.local),
    ['P1:R1', 'P2:R2', 'P1:D1', 'P2:D2'],
  )
  assert.deepEqual(
    b.schematic.circuits.map(c => [c.path.join('/'), c.kind, c.parts.join(',')]),
    [
      ['P1', 'group', 'R1,D1'],
      ['P2', 'group', 'R2,D2'],
    ],
  )
  assert.deepEqual(
    b.erc.filter(d => d.severity === 'error'),
    [],
  )
  assert.equal(typeof core.group, 'undefined', 'group() is gone')
})

test('named g: nested groups make paths, and a group lists its child groups', () => {
  const { A, B } = nets()
  const D1 = bindRef(LED0603('red').connect({ K: A, A: B }), 'D1')
  const R1 = bindRef(R0603('10k').connect({ 1: A, 2: B }), 'R1')
  const b = compileBoard(board({}, h('g', { name: 'Bank' }, h(D1, { at: '5 5' }), h('g', { name: 'Sense', at: '10 0' }, h(R1, { at: '5 5' })))))
  assert.deepEqual(
    ['D1', 'R1'].map(r => [...part(b, r).path, part(b, r).local].join('/')),
    ['Bank/D1', 'Bank/Sense/R1'],
  )
  assert.deepEqual(b.footprints.find(f => f.ref === 'R1').at, [15, 5])
  const bank = b.schematic.circuits.find(c => c.name === 'Bank')
  assert.deepEqual([bank.parts, bank.children], [['D1'], ['Sense']])
})

test('named g: two groups of one path, or a name that is no identifier, is a CompileError', () => {
  const { A, B } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: B }), 'R1')
  const R2 = bindRef(R0603('1k').connect({ 1: A, 2: B }), 'R2')
  assert.throws(
    () => compileBoard(board({}, h('g', { name: 'Twice' }, h(R1, { at: '5 5' })), h('g', { name: 'Twice' }, h(R2, { at: '10 5' })))),
    e => e instanceof CompileError && /two <g> are named Twice/.test(e.message),
  )
  assert.throws(() => compileBoard(board({}, h('g', { name: 'bad name' }, h(R1, { at: '5 5' })), h(R2, { at: '10 5' }))), /<g name>: "bad name" is not a name/)
})
