// The viewer's circuit helpers: the instance tree, its filter and the parts and nets of one instance, imported straight from the client TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ancestorKeys, buildTree, enclosingRange, filterTree, findInstance, hasCircuits, instanceNets, instanceNodes, instanceRefs, netLabel, partPathLinks, refsBox } from '../src/circuits.ts'
import { orderNets } from '../src/schematic.ts'

const pin = (name, net) => ({ name, net, nc: false })
const part = (ref, value, path = [], local = ref, nets = []) => ({ ref, value, footprint: 'lib:F', prefix: ref[0], placed: true, pins: nets.map((n, i) => pin(String(i + 1), n)), path, local })
const sch = {
  parts: [
    part('J1', 'header', [], 'J1', ['VCC', 'GND']),
    part('R10', '1k', ['Buck1'], 'R1', ['Buck1/FB', 'GND']),
    part('U1', 'TPS', ['Buck1'], 'U1', ['VCC', 'Buck1/FB']),
    part('R2', '10k', ['Buck1', 'Soft'], 'R1', ['Buck1/Soft/SS']),
    part('D1', 'red', ['CH1'], 'D', ['CH1/led']),
  ],
  nets: [
    { name: 'VCC', local: false, pins: ['J1.1', 'U1.1'] },
    { name: 'Buck1/FB', local: true, pins: ['R10.1', 'U1.2'], path: ['Buck1'] },
    { name: 'Buck1/Soft/SS', local: true, pins: ['R2.1'], path: ['Buck1', 'Soft'] },
    { name: 'CH1/led', local: true, pins: ['D1.1'], path: ['CH1'] },
  ],
  circuits: [
    { path: ['Buck1'], name: 'Buck1', circuit: 'buck', layout: 'BuckLayout', parts: ['U1', 'R10'], children: ['Soft'], placed: true },
    { path: ['Buck1', 'Soft'], name: 'Soft', circuit: 'softStart', parts: ['R2'], children: [], placed: true },
    { path: ['CH1'], name: 'CH1', circuit: 'ledChannel', parts: ['D1'], children: [], placed: false },
  ],
}
const shape = ns => ns.map(n => (n.kind === 'part' ? n.part.ref : { [n.key]: shape(n.children) }))

test('without circuits the tree is the flat part list in ref order', () => {
  const old = { parts: sch.parts.map(({ path, local, ...p }) => p), nets: [] }
  assert.deepEqual(shape(buildTree(old)), ['D1', 'J1', 'R2', 'R10', 'U1'])
  assert.deepEqual(buildTree(undefined), [])
  assert.equal(hasCircuits(old), false)
  assert.equal(hasCircuits(sch), true)
  assert.deepEqual(instanceRefs(old, 'Buck1'), [])
  assert.equal(findInstance(old, 'Buck1'), null)
})

test('board-level parts first, then the top-level instances with their parts and child instances', () => {
  const t = buildTree(sch)
  assert.deepEqual(shape(t), ['J1', { Buck1: ['R10', 'U1', { 'Buck1/Soft': ['R2'] }] }, { CH1: ['D1'] }])
  assert.deepEqual(instanceNodes(t).map(n => [n.key, n.refs]), [['Buck1', ['R2', 'R10', 'U1']], ['Buck1/Soft', ['R2']], ['CH1', ['D1']]])
  assert.deepEqual(instanceRefs(sch, 'Buck1'), ['R2', 'R10', 'U1'])
  assert.equal(findInstance(sch, 'Buck1/Soft').circuit, 'softStart')
  assert.deepEqual(ancestorKeys(['Buck1', 'Soft']), ['Buck1', 'Buck1/Soft'])
})

test('a part whose instance is missing stays at the root', () => {
  const s = { ...sch, parts: [...sch.parts, part('C9', '1u', ['Gone'])] }
  assert.deepEqual(shape(buildTree(s))[0], 'C9')
})

test('the filter keeps matching rows, opens the instances above them, and keeps a matching instance whole', () => {
  const t = buildTree(sch)
  const byRef = filterTree(t, 'r2')
  assert.deepEqual(shape(byRef.nodes), [{ Buck1: [{ 'Buck1/Soft': ['R2'] }] }])
  assert.deepEqual([...byRef.open].sort(), ['Buck1', 'Buck1/Soft'])
  assert.equal(byRef.parts, 1)
  const byName = filterTree(t, 'soft')
  assert.deepEqual(shape(byName.nodes), [{ Buck1: [{ 'Buck1/Soft': ['R2'] }] }])
  assert.deepEqual([...byName.open], ['Buck1'])
  assert.deepEqual(shape(filterTree(t, 'ledchannel').nodes), [{ CH1: ['D1'] }])
  assert.deepEqual(shape(filterTree(t, 'buck1/fb').nodes), [{ Buck1: ['R10', 'U1'] }])
  assert.deepEqual(shape(filterTree(t, 'header').nodes), ['J1'])
  const all = filterTree(t, ' ')
  assert.equal(all.nodes.length, 3)
  assert.equal(all.open.size, 0)
  assert.equal(all.parts, 5)
})

test('an instance owns its local nets, shown as "Buck1 / FB"', () => {
  assert.deepEqual(instanceNets(sch, ['Buck1']).map(n => n.name), ['Buck1/FB'])
  assert.deepEqual(instanceNets(sch, []), [])
  assert.deepEqual(netLabel(sch.nets[1]), { prefix: 'Buck1 / ', name: 'FB' })
  assert.deepEqual(netLabel(sch.nets[2]), { prefix: 'Buck1 / Soft / ', name: 'SS' })
  assert.deepEqual(netLabel({ name: 'VCC' }), { prefix: '', name: 'VCC' })
  assert.deepEqual(netLabel({ name: 'odd', path: ['X'] }), { prefix: 'X / ', name: 'odd' })
  assert.deepEqual(orderNets([], sch).map(n => n.path ?? null), [null, ['Buck1'], ['Buck1', 'Soft'], ['CH1']])
})

test('the Path line links each instance and ends with the local key', () => {
  assert.deepEqual(partPathLinks(sch.parts[3]), { links: [{ name: 'Buck1', key: 'Buck1' }, { name: 'Soft', key: 'Buck1/Soft' }], local: 'R1' })
  assert.equal(partPathLinks(sch.parts[0]), null)
  assert.equal(partPathLinks({ ref: 'R1' }), null)
  assert.equal(partPathLinks(null), null)
})

test('the box of an instance and the innermost range that made all its parts', () => {
  const fps = [{ ref: 'R1', at: [0, 0], bbox: { x: 0, y: 0, w: 2, h: 1 } }, { ref: 'D1', at: [5, 5], bbox: { x: 4, y: 4, w: 2, h: 2 } }]
  assert.deepEqual(refsBox(fps, ['R1', 'D1']), { at: [3, 3], w: 6, h: 6 })
  assert.equal(refsBox(fps, ['X']), null)
  const sources = { 'a.tsx': [{ start: [1, 1], end: [9, 1], ids: [], refs: ['D1', 'R1', 'U1'] }, { start: [2, 1], end: [3, 1], ids: [], refs: ['D1', 'R1'] }, { start: [2, 1], end: [2, 9], ids: [], refs: ['R1'] }] }
  assert.deepEqual(enclosingRange(sources, ['R1', 'D1']).range.start, [2, 1])
  assert.equal(enclosingRange(sources, ['Z']), null)
  assert.equal(enclosingRange(undefined, ['R1']), null)
})
