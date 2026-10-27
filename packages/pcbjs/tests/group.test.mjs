// group(): names the parts of a plain object as one instance, passes other fields through, nests, takes arrays, and keeps
// refs flat; the same name twice is a SchematicError.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, circuit, group, layout, isCircuitInstance, SchematicError } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 30 })
const board = (props, ...children) => h(PCB, { name: 'Group', ...props }, edge(), ...children)
// a compile starts a new epoch, so the next test's groups replace this one's
const settle = () => compileBoard(board({}))
const part = (b, ref) => b.schematic.parts.find(p => p.ref === ref)

test('group: names every part of the object, passes other fields through and returns the same object', () => {
  settle()
  const { VCC, GND } = nets()
  const ports = [1, 2].map(n => {
    const { LED } = nets(`L${n}`)
    const o = { n, x: n * 10, label: `port ${n}`, R: R0603('330').connect(VCC, LED), D: LED0603('green').connect({ A: LED, K: GND }) }
    const g = group(`P${n}`, o)
    assert.equal(g, o, 'the same object')
    return g
  })
  const [P1, P2] = ports
  assert.ok(isCircuitInstance(P1))
  assert.deepEqual([P1.name, P1.circuit, P1.path], ['P1', 'group', ['P1']])
  assert.deepEqual(Object.keys(P2), ['n', 'x', 'label', 'R', 'D'], 'the instance properties are not enumerable')
  assert.deepEqual([P2.n, P2.x, P2.label], [2, 20, 'port 2'])
  const b = compileBoard(board({}, ...ports.flatMap(p => [h(p.R, { at: `${p.x} 5` }), h(p.D, { at: `${p.x} 10` })])))
  // refs stay flat, numbered in declaration order
  assert.deepEqual(['R1', 'R2', 'D1', 'D2'].map(r => part(b, r)?.path.join('/') + ':' + part(b, r)?.local), ['P1:R', 'P2:R', 'P1:D', 'P2:D'])
  assert.deepEqual(b.schematic.circuits.map(c => [c.path.join('/'), c.circuit, c.parts.join(',')]), [['P1', 'group', 'R1,D1'], ['P2', 'group', 'R2,D2']])
  assert.deepEqual(b.erc.filter(d => d.severity === 'error'), [])
})

test('group: arrays of parts and nested groups take paths, and hierarchical refs read them', () => {
  settle()
  const { A, B } = nets()
  const inner = group('Sense', { R: R0603('10k').connect(A, B) })
  const G = group('Bank', { LEDS: [LED0603('red').connect(A, B), LED0603('red').connect(A, B)], inner, gain: 3 })
  assert.deepEqual(inner.path, ['Bank', 'Sense'])
  assert.equal(G.inner, inner)
  const parts = [h(G.LEDS[0], { at: '5 5' }), h(G.LEDS[1], { at: '10 5' }), h(G.inner.R, { at: '15 5' })]
  const b = compileBoard(board({}, ...parts))
  assert.deepEqual(['D1', 'D2', 'R1'].map(r => [...part(b, r).path, part(b, r).local].join('/')), ['Bank/LEDS[0]', 'Bank/LEDS[1]', 'Bank/Sense/R'])
  const hier = compileBoard(board({ refStyle: 'hierarchical' }, ...parts))
  assert.deepEqual(hier.footprints.map(f => f.ref).sort(), ['BANK_LEDS_0', 'BANK_LEDS_1', 'BANK_SENSE_R'])
})

test('group: a layout places a group like an instance, and a group works inside a circuit build', () => {
  settle()
  const { V, G } = nets()
  const P = group('Pwr', { R: R0603('1k').connect(V, G), y: 7 })
  const Lay = layout(P, (g, { at }) => h('g', { at }, h(g.R, { at: `0 ${g.y}` })), 'Lay')
  const b = compileBoard(board({}, h(Lay, { g: P, at: '10 0' })))
  assert.deepEqual(b.footprints[0].at, [10, 7])
  assert.equal(b.schematic.circuits[0].layout, 'Lay')
  settle()
  const two = circuit('two', ({ IN, OUT }, { nets: { mid } }) => ({ first: group('first', { R: R0603('1k').connect(IN, mid) }), R2: R0603('1k').connect(mid, OUT) }))
  const T = two({ IN: V, OUT: G }, 'T')
  assert.deepEqual(T.first.path, ['T', 'first'])
  assert.throws(() => circuit('leaky', ({ IN }) => ({ g: group('g', { R: R0603('1k').connect(IN, V) }) }))({ IN: G }), /neither a port nor one of its own nets/)
})

test('group: the same name twice, a reserved key or a part in two groups is a SchematicError', () => {
  settle()
  const { A, B } = nets()
  const R = R0603('1k').connect(A, B)
  group('Twice', { R })
  assert.throws(() => group('Twice', { R: R0603('1k').connect(A, B) }), e => e instanceof SchematicError && /the name Twice is already taken by the group/.test(e.message))
  assert.throws(() => group('Other', { R }), e => e instanceof SchematicError && /already belongs to Twice/.test(e.message))
  assert.throws(() => group('Named', { name: 'x', R: R0603('1k').connect(A, B) }), /the key "name" is reserved/)
  assert.throws(() => group('bad name', {}), /must be an identifier/)
  assert.throws(() => group('Arr', [R]), /takes an object of parts by key/)
  settle()
})
