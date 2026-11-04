// Circuits: circuit() with ports and private nets, instances and their indices, refs from the index, hierarchical refs,
// layouts, an unplaced instance as a compile error, sourcing through instances, and the circuits in the site data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import PCB, { h, nets, NC, circuit, layout, route, isCircuit, isCircuitInstance, isNet, SchematicError, bindRef } from '@pcbjs/core'
import { R0603, C0603, LED0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/internal/site-data'
import { bomRows } from '@pcbjs/export/internal/bom'

const edge = (w = 40, hh = 30) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const board = (props, ...children) => h(PCB, { name: 'Circ', ...props }, edge(), ...children)
const errors = b => b.erc.filter(d => d.severity === 'error')
const rule = (b, r) => b.erc.filter(d => d.rule === r)
const refAt = (b, x, y) => b.footprints.find(f => Math.abs(f.at[0] - x) < 1e-9 && Math.abs(f.at[1] - y) < 1e-9)?.ref
// a compile starts a new epoch, so the parts and instances the next test makes replace those this one made after its last compile
const settle = () => compileBoard(board({}))
const site = b => siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: '', svgUrl: '', dev: false, bom: [] })

// a channel: a resistor and an LED joined by the private net led
const channel = circuit('chan', ({ VCC, SW }, { nets: { led } }) => ({
  R: R0603('330').connect({ 1: VCC, 2: led }),
  D: LED0603('green').connect({ A: led, K: SW }),
}))
const Row = layout(channel, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' }), h(g.D, { at: '6 0 180deg' }), route('0.825 0').net(g.nets.led).width(0.3).H(5.175)), 'Row')
const Column = layout(channel, function Column(g, { at }) {
  return h('g', { at }, h(g.R, { at: '0 0 90deg' }), h(g.D, { at: '0 4 90deg' }))
})

test('circuit: an instance has its members, ports, private nets, name, circuit and path', () => {
  const { VCC, SW } = nets()
  assert.ok(isCircuit(channel))
  assert.equal(channel.name, 'chan')
  const A = channel({ VCC, SW }, 'A1')
  assert.ok(isCircuitInstance(A))
  assert.equal(A.$$, 'circuit')
  assert.equal(A.name, 'A1')
  assert.equal(A.circuit, 'chan')
  assert.deepEqual(A.path, ['A1'])
  assert.equal(A.ports.VCC, VCC)
  assert.equal(A.R.value, '330')
  assert.equal(A.R[2].pin, '2')
  assert.equal(A.D.A.pin, 'A')
  assert.ok(isNet(A.nets.led))
  assert.equal(A.nets.led, A.nets.led)
  assert.equal(A.nets.led.local, true)
  assert.throws(() => {
    A.X = 1
  }, TypeError)
  const B = channel({ VCC, SW }, 'B2')
  assert.notEqual(A.nets.led, B.nets.led)
  const b = compileBoard(board({}, h(Row, { g: A, at: '5 5' }), h(Row, { g: B, at: '5 15' })))
  const names = b.schematic.nets.map(n => n.name)
  assert.ok(names.includes('A1/led') && names.includes('B2/led'), names.join(', '))
  const led = b.schematic.nets.find(n => n.name === 'B2/led')
  assert.deepEqual(led.path, ['B2'])
  assert.equal(led.pins.length, 2)
})

test('circuit: the object form is gone, a circuit takes a build function', () => {
  const { A, B } = nets()
  assert.throws(() => circuit('root', { J1: PinHeader(2)().connect({ 1: A, 2: B }) }), /build must be a function/)
  settle()
})

test('circuit: nested instances take their index in the build, paths concatenate, and private nets carry the path', () => {
  const { VIN, GND } = nets()
  const ldo = circuit('ldo', ({ IN, OUT, GND }) => ({ C: C0603('1u').connect({ 1: IN, 2: GND }), R: R0603('10k').connect({ 1: OUT, 2: GND }) }))
  const power = circuit('power', ({ VIN, GND }, { nets: { V3 } }) => ({
    LDO: ldo({ IN: VIN, OUT: V3, GND }, 'LDO1'),
    R01: R0603('100').connect({ 1: V3, 2: GND }),
  }))
  const P = power({ VIN, GND }, 'Power1')
  assert.deepEqual(P.LDO.path, ['Power1', 'LDO1'])
  assert.equal(P.LDO.name, 'LDO1')
  assert.equal(P.LDO.R.value, '10k')
  const J = bindRef(PinHeader(2)().connect({ 1: VIN, 2: GND }), 'J1')
  const b = compileBoard(board({}, h(J, { at: '3 5' }), h(P.LDO.C, { at: '10 5' }), h(P.LDO.R, { at: '15 5' }), h(P.R01, { at: '20 5' })))
  assert.deepEqual(errors(b), [])
  const s = b.schematic
  const byLocal = Object.fromEntries(s.parts.map(p => [p.path.concat(p.local).join('.'), p.ref]))
  assert.deepEqual(byLocal, { J1: 'J1', 'Power1.LDO1.C': 'C11', 'Power1.LDO1.R': 'R11', 'Power1.R01': 'R101' })
  assert.deepEqual(
    s.circuits.map(c => [c.path.join('/'), c.circuit, c.parts, c.children]),
    [
      ['Power1', 'power', ['R101'], ['LDO1']],
      ['Power1/LDO1', 'ldo', ['C11', 'R11'], []],
    ],
  )
  const v3 = s.nets.find(n => n.name === 'Power1/V3')
  assert.deepEqual(v3.path, ['Power1'])
  assert.deepEqual([...v3.pins].sort(), ['R101.1', 'R11.1'])
})

test('circuit: refs are flat, the local name with the instance index, whatever the declaration or placement order', () => {
  const { VCC, SW, GND } = nets()
  const R5 = bindRef(R0603('1').connect({ 1: VCC, 2: GND }), 'R5')
  const A = channel({ VCC, SW }, 'A1')
  const C = bindRef(C0603('100n').connect({ 1: VCC, 2: GND }), 'C1')
  const B = channel({ VCC, SW }, 'B2')
  const R9 = bindRef(R0603('9').connect({ 1: SW, 2: GND }), 'R9')
  const b = compileBoard(board({}, h(Row, { g: B, at: '5 20' }), h(R9, { at: '30 5' }), h(Row, { g: A, at: '5 10' }), h(C, { at: '30 10' }), h(R5, { at: '30 20' })))
  assert.equal(refAt(b, 30, 20), 'R5')
  assert.equal(refAt(b, 5, 10), 'R1')
  assert.equal(refAt(b, 5, 20), 'R2')
  assert.equal(refAt(b, 30, 5), 'R9')
  assert.equal(refAt(b, 30, 10), 'C1')
  assert.deepEqual(
    b.schematic.parts.filter(p => p.path.length).map(p => [p.ref, p.path[0], p.local]),
    [
      ['D1', 'A1', 'D'],
      ['D2', 'B2', 'D'],
      ['R1', 'A1', 'R'],
      ['R2', 'B2', 'R'],
    ],
  )
})

test('circuit: refStyle "hierarchical" names the parts of instances after their path', () => {
  const { VCC, SW, GND } = nets()
  const Buck1 = channel({ VCC, SW }, 'Buck1')
  const plain = bindRef(R0603('1').connect({ 1: VCC, 2: GND }), 'R1')
  const Ch2 = channel({ VCC, SW }, 'Ch2')
  const b = compileBoard(board({ refStyle: 'hierarchical' }, h(Row, { g: Buck1, at: '5 5' }), h(plain, { at: '30 5' }), h(Row, { g: Ch2, at: '5 15' })))
  assert.deepEqual(b.footprints.map(f => f.ref).sort(), ['BUCK1_D', 'BUCK1_R', 'CH2_D', 'CH2_R', 'R1'])
  assert.deepEqual(errors(b), [])
  const p = b.schematic.parts.find(x => x.ref === 'BUCK1_R')
  assert.deepEqual([p.path, p.local], [['Buck1'], 'R'])
  assert.throws(() => compileBoard(board({ refStyle: 'deep' }, h(plain, { at: '5 5' }))), /refStyle must be "flat" or "hierarchical"/)
})

test('circuit: an instance is named by its index, a number after the circuit name or a name ending in digits; none is an error', () => {
  const { VCC, SW } = nets()
  const a = channel({ VCC, SW }, 1)
  const b = channel({ VCC, SW }, 2)
  const c = channel({ VCC, SW }, 'Third3')
  assert.deepEqual([a.name, b.name, c.name], ['chan1', 'chan2', 'Third3'])
  assert.equal(channel.named, undefined, 'named() is gone')
  const board1 = compileBoard(board({}, h(Row, { g: a, at: '5 5' }), h(Row, { g: b, at: '5 10' }), h(Row, { g: c, at: '5 15' })))
  assert.ok(board1.schematic.nets.some(n => n.name === 'chan2/led'))
  assert.throws(() => channel({ VCC, SW }), /an instance needs an index/)
  assert.throws(() => channel({ VCC, SW }, 'not a name'), /an instance needs an index/)
  assert.throws(() => channel({ VCC, SW }, 'Twin'), /a name ending in digits/)
  const x = channel({ VCC, SW }, 'Twin1'),
    y = channel({ VCC, SW }, 'Twin1')
  assert.throws(() => compileBoard(board({}, h(Row, { g: x, at: '5 5' }), h(Row, { g: y, at: '5 10' }))), /two circuit instances on <PCB Circ> are named Twin1/)
})

test('layout: places an instance as an element or a call, and the site data names the layout', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A1')
  const B = channel({ VCC, SW }, 'B2')
  assert.equal(Row.name, 'Row')
  assert.equal(Column.name, 'Column')
  assert.equal(Row.circuit, 'chan')
  const b = compileBoard(board({}, h(Row, { g: A, at: '5 5' }), Column({ g: B, at: '20 5' })))
  assert.equal(refAt(b, 5, 5), 'R1')
  assert.equal(refAt(b, 11, 5), 'D1')
  assert.equal(refAt(b, 20, 5), 'R2')
  assert.equal(refAt(b, 20, 9), 'D2')
  assert.ok(b.items.some(it => it.kind === 'track' && it.net === 'A1/led'))
  const s = site(b).schematic
  const here = fileURLToPath(import.meta.url)
    .replaceAll('\\', '/')
    .replace(/^\//, '')
  assert.deepEqual(s.circuits, [
    { path: ['A1'], name: 'A1', kind: 'circuit', def: `${here}#chan`, circuit: 'chan', layout: `${here}#Row`, parts: ['R1', 'D1'], children: [], placed: true },
    { path: ['B2'], name: 'B2', kind: 'circuit', def: `${here}#chan`, circuit: 'chan', layout: `${here}#Column`, parts: ['R2', 'D2'], children: [], placed: true },
  ])
  assert.deepEqual(s.parts.find(p => p.ref === 'D2').path, ['B2'])
  assert.equal(s.parts.find(p => p.ref === 'D2').local, 'D')
  assert.deepEqual(s.nets.find(n => n.name === 'A1/led').path, ['A1'])
  const other = circuit('other', ({ X }) => ({ R: R0603('1').connect({ 1: X, 2: X }) }))
  assert.throws(() => Row({ g: other({ X: VCC }, 1) }), /lays out the circuit chan, but g is other1, an instance of other/)
  assert.throws(() => Row({}), /needs g=/)
  settle()
})

test('layout: an instance laid out twice is a compile error naming both sites', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A1')
  assert.throws(
    () => compileBoard(board({}, h(Row, { g: A, at: '5 5' }), h(Column, { g: A, at: '20 5' }))),
    e => e instanceof CompileError && /the circuit instance A1 is laid out twice on <PCB Circ>: by Row at .* and by Column at /.test(e.message),
  )
})

test('layout methods preserve placement, overrides, definition keys and instance restrictions', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A1'),
    B = channel({ VCC, SW }, 'B2')
  const render = (g, { at }) => h('g', { at }, h(g.R, { at: '-3 0' }), h(g.D, { at: '3 0' }))
  const Shared = channel.layout(render, 'Shared')
  const OnlyB = B.layout(render, 'OnlyB')
  assert.equal(channel.layout(() => null).name, 'chanLayout')
  assert.equal(B.layout(() => null).name, 'chanLayout')
  assert.equal(channel.layout(function Named() {}).name, 'Named')
  assert.throws(() => OnlyB({ g: A }), /lays out the instance B2/)
  assert.throws(() => Shared({}), /needs g=/)
  assert.throws(() => A.layout(null), /render function is missing/)
  const b = compileBoard(board({}, h(Shared, { g: A, at: '10 10' }, h(A.R, { at: '-5 0' })), h(OnlyB, { g: B, at: '20 20' })))
  assert.equal(refAt(b, 5, 10), 'R1')
  assert.equal(refAt(b, 13, 10), 'D1')
  assert.equal(refAt(b, 17, 20), 'R2')
  const here = fileURLToPath(import.meta.url)
    .replaceAll('\\', '/')
    .replace(/^\//, '')
  assert.deepEqual(
    site(b).schematic.circuits.map(c => c.layout),
    [`${here}#Shared`, `${here}#OnlyB`],
  )
  const invalid = circuit('invalid', () => ({ layout: R0603('1k') }))
  assert.throws(() => invalid({}, 1), /key "layout" is reserved/)
  settle()
})

test('layout: a child of the layout element places one part of that instance in place of the layout placement, in its frame', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A1')
  const B = channel({ VCC, SW }, 'B2')
  const b = compileBoard(board({}, h(Row, { g: A, at: '5 5' }, h(A.R, { at: '1 2' })), h(Row, { g: B, at: '5 15' })))
  assert.deepEqual(errors(b), [])
  assert.equal(refAt(b, 6, 7), 'R1')
  assert.equal(refAt(b, 5, 15), 'R2')
  assert.equal(refAt(b, 11, 5), 'D1')
  assert.throws(() => compileBoard(board({}, h(Row, { g: A, at: '5 5' }, h(B.R, { at: '1 2' })), h(Row, { g: B, at: '5 15' }))), /is no part of A1/)
  assert.throws(
    () => compileBoard(board({}, h(Row, { g: A, at: '5 5' }, h('text', { layer: 'F.SilkS' }, 'x')), h(Row, { g: B, at: '5 15' }))),
    /takes as children only placements of the parts of A1/,
  )
  const Half = layout(channel, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' })), 'Half')
  assert.throws(() => compileBoard(board({}, h(Half, { g: A, at: '5 5' }, h(A.D, { at: '1 2' })), h(Row, { g: B, at: '5 15' }))), /<Half> places no part of A1 that/)
  settle()
})

test('layout: a part of a laid-out instance placed outside the layout is an error; without a layout, parts are placed one by one', () => {
  const { VCC, SW } = nets()
  const solo = circuit('solo', ({ VCC, SW }, { nets: { led } }) => ({ R: R0603('330').connect({ 1: VCC, 2: led }), D: LED0603('red').connect({ A: led, K: SW }) }))
  const Half = layout(solo, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' })), 'Half')
  const A = solo({ VCC, SW }, 'A1')
  assert.throws(
    () => compileBoard(board({}, h(Half, { g: A, at: '5 5' }), h(A.D, { at: '20 5' }))),
    e => e instanceof CompileError && /LED0603\("red"\), A1\/D, is placed at .* outside a layout, while Half lays out A1 at /.test(e.message),
  )
  const B = solo({ VCC, SW }, 'B2')
  const b = compileBoard(board({}, h(B.R, { at: '5 5' }), h(B.D, { at: '20 5' })))
  assert.deepEqual(errors(b), [])
  const c = b.schematic.circuits[0]
  assert.deepEqual([c.name, c.layout, c.placed], ['B2', undefined, true])
})

test('an instance never laid out or placed is a compile error naming it; a partly placed one names its missing parts', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A1')
  const B = channel({ VCC, SW }, 'B2')
  assert.throws(
    () => compileBoard(board({}, h(Row, { g: A, at: '5 5' }))),
    e => e instanceof CompileError && /^the instance B2 of chan at .*circuit\.test\.mjs:\d+:\d+ is declared but never placed on <PCB Circ>/.test(e.message),
  )
  void B
  const C = channel({ VCC, SW }, 'C3')
  assert.throws(
    () => compileBoard(board({}, h(C.R, { at: '5 20' }))),
    e => e instanceof CompileError && /^D3 at .* is declared but never placed on <PCB Circ>/.test(e.message),
  )
})

test('ports: a port left out throws naming it, NC is allowed for a tolerated port, nets cross only through ports', () => {
  const { VCC, SW, GND } = nets()
  assert.throws(
    () => channel({ VCC }, 1),
    e => e instanceof SchematicError && /chan\(…\): the port SW is not connected/.test(e.message),
  )
  assert.throws(() => channel({ VCC, SW: 'SW' }, 1), /the port SW needs a Net from nets\(\) or NC/)
  const en = circuit('en', ({ VIN, EN }) => ({ U: PinHeader(2)().connect({ 1: VIN, 2: EN }) }))
  const E = en({ VIN: VCC, EN: NC }, 'E1')
  assert.equal(E.ports.EN, NC)
  const J = bindRef(PinHeader(2)().connect({ 1: VCC, 2: GND }), 'J1')
  const b = compileBoard(board({}, h(J, { at: '3 5' }), h(E.U, { at: '15 5' })))
  assert.deepEqual(errors(b), [])
  assert.equal(b.schematic.parts.find(p => p.path[0] === 'E1').pins[1].nc, true)
  const leaky = circuit('leaky', ({ A }) => ({ R: R0603('1').connect({ 1: A, 2: GND }) }))
  assert.throws(() => leaky({ A: VCC }, 1), /reaches the net GND, which is neither a port nor one of its own nets/)
  const lost = circuit('lost', ({ A }) => {
    R0603('2').connect({ 1: A, 2: A })
    return { R: R0603('1').connect({ 1: A, 2: A }) }
  })
  assert.throws(() => lost({ A: VCC }, 1), /R0603\("2"\) is made in the build but not returned/)
  const outside = R0603('3')
  const thief = circuit('thief', () => ({ R: outside }))
  assert.throws(() => thief({}, 1), /made outside the build/)
  settle()
})

test('sourcing: .source() on a part of an instance, on each part of an instance, and in its build', () => {
  const { VCC, SW, GND } = nets()
  const A = channel({ VCC, SW }, 'A1')
  const B = channel({ VCC, SW }, 'B2')
  const J = bindRef(PinHeader(2)().connect({ 1: VCC, 2: GND }), 'J1')
  const C = bindRef(C0603('100n').connect({ 1: SW, 2: GND }), 'C1')
  A.R.source({ MPN: 'R330' })
  B.R.source({ MPN: 'R330-B' })
  for (const p of [A.R, A.D]) p.source({ 'MPN:US': 'US-A' })
  const b = compileBoard(board({}, h(J, { at: '3 5' }), h(C, { at: '30 25' }), h(Row, { g: A, at: '5 10' }), h(Row, { g: B, at: '5 20' })))
  const fields = ref => b.footprints.find(f => f.ref === ref).fields
  assert.deepEqual(fields('R1'), { MPN: 'R330', 'MPN:US': 'US-A' })
  assert.deepEqual(fields('D1'), { 'MPN:US': 'US-A' })
  assert.deepEqual(fields('R2'), { MPN: 'R330-B' })
  assert.deepEqual(fields('D2'), {})
  assert.deepEqual(bomRows(b).find(r => r.refs.includes('R2')).refs, ['R2'])
})
