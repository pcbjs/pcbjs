// Circuits: circuit() with ports and private nets, the object form, instances and their names, flat and hierarchical refs,
// layouts, the unplaced-circuit ERC, sourcing through instances, and the circuits in the site data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, NC, circuit, layout, source, route, isCircuit, isCircuitInstance, isNet, SchematicError } from '@pcbjs/core'
import { R0603, C0603, LED0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/site-data'
import { bomRows } from '@pcbjs/export/bom'

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
  R: R0603('330').connect(VCC, led),
  D: LED0603('green').connect({ A: led, K: SW }),
}))
const Row = layout(channel, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' }), h(g.D, { at: '6 0 180deg' }),
  route(g.nets.led, { width: 0.3, d: 'M 0.825 0 H 5.175' })), 'Row')
const Column = layout(channel, function Column(g, { at }) { return h('g', { at }, h(g.R, { at: '0 0 90deg' }), h(g.D, { at: '0 4 90deg' })) })

test('circuit: an instance has its members, ports, private nets, name, circuit and path', () => {
  const { VCC, SW } = nets()
  assert.ok(isCircuit(channel))
  assert.equal(channel.name, 'chan')
  const A = channel({ VCC, SW }, 'A')
  assert.ok(isCircuitInstance(A))
  assert.equal(A.$$, 'circuit')
  assert.equal(A.name, 'A')
  assert.equal(A.circuit, 'chan')
  assert.deepEqual(A.path, ['A'])
  assert.equal(A.ports.VCC, VCC)
  assert.equal(A.R.value, '330')
  assert.equal(A.R[2].pin, '2')
  assert.equal(A.D.A.pin, 'A')
  assert.ok(isNet(A.nets.led))
  assert.equal(A.nets.led, A.nets.led)
  assert.equal(A.nets.led.local, true)
  assert.throws(() => { A.X = 1 }, TypeError)
  const B = channel({ VCC, SW }, 'B')
  assert.notEqual(A.nets.led, B.nets.led)
  const b = compileBoard(board({}, h(Row, { g: A, at: '5 5' }), h(Row, { g: B, at: '5 15' })))
  const names = b.schematic.nets.map(n => n.name)
  assert.ok(names.includes('A/led') && names.includes('B/led'), names.join(', '))
  const led = b.schematic.nets.find(n => n.name === 'B/led')
  assert.deepEqual(led.path, ['B'])
  assert.equal(led.pins.length, 2)
})

test('circuit: the object form makes one instance of parts made beforehand, and its parts can be placed one by one', () => {
  const { A, B } = nets()
  const root = circuit('root', { J1: PinHeader(2).connect(A, B), R1: R0603('1k').connect(A, B) })
  assert.ok(isCircuitInstance(root))
  assert.equal(root.name, 'root')
  assert.deepEqual(root.path, ['root'])
  assert.equal(root.R1.value, '1k')
  const b = compileBoard(board({}, h(root.J1, { at: '5 5' }), h(root.R1, { at: '15 5' })))
  assert.deepEqual(errors(b), [])
  const s = b.schematic
  assert.deepEqual(s.parts.map(p => [p.ref, p.path, p.local]), [['J1', ['root'], 'J1'], ['R1', ['root'], 'R1']])
  assert.deepEqual(s.circuits, [{ path: ['root'], name: 'root', circuit: 'root', parts: ['J1', 'R1'], children: [], placed: true }])
  const part = R0603('1').connect(A, B)
  circuit('one', { P: part })
  assert.throws(() => circuit('two', { P: part }), /already belongs to the circuit instance one/)
  assert.throws(() => circuit('bad', { name: R0603('2') }), /reserved/)
  assert.throws(() => circuit('bad', { X: 3 }), /neither a part nor a circuit instance/)
  settle()
})

test('circuit: nested instances take their key as name, paths concatenate, and private nets carry the path', () => {
  const { VIN, GND } = nets()
  const ldo = circuit('ldo', ({ IN, OUT, GND }) => ({ C: C0603('1u').connect(IN, GND), R: R0603('10k').connect(OUT, GND) }))
  const power = circuit('power', ({ VIN, GND }, { nets: { V3 } }) => ({
    LDO: ldo({ IN: VIN, OUT: V3, GND }),
    Load: R0603('100').connect(V3, GND),
  }))
  const P = power({ VIN, GND }, 'Power')
  assert.deepEqual(P.LDO.path, ['Power', 'LDO'])
  assert.equal(P.LDO.name, 'LDO')
  assert.equal(P.LDO.R.value, '10k')
  const J = PinHeader(2).connect(VIN, GND)
  const b = compileBoard(board({}, h(J, { at: '3 5' }), h(P.LDO.C, { at: '10 5' }), h(P.LDO.R, { at: '15 5' }), h(P.Load, { at: '20 5' })))
  assert.deepEqual(errors(b), [])
  const s = b.schematic
  const byLocal = Object.fromEntries(s.parts.map(p => [p.path.concat(p.local).join('.'), p.ref]))
  assert.deepEqual(byLocal, { J1: 'J1', 'Power.LDO.C': 'C1', 'Power.LDO.R': 'R1', 'Power.Load': 'R2' })
  assert.deepEqual(s.circuits.map(c => [c.path.join('/'), c.circuit, c.parts, c.children]), [
    ['Power', 'power', ['R2'], ['LDO']],
    ['Power/LDO', 'ldo', ['C1', 'R1'], []],
  ])
  const v3 = s.nets.find(n => n.name === 'Power/V3')
  assert.deepEqual(v3.path, ['Power'])
  assert.deepEqual(v3.pins.sort(), ['R1.1', 'R2.1'])
})

test('circuit: refs are flat, numbered per prefix in declaration order, instance by instance and key by key', () => {
  const { VCC, SW, GND } = nets()
  const R0 = R0603('1').connect(VCC, GND)
  const A = channel({ VCC, SW }, 'A')
  const C = C0603('100n').connect(VCC, GND)
  const B = channel({ VCC, SW }, 'B')
  const R9 = R0603('9').connect(SW, GND)
  // placed in another order: the numbering follows the declarations
  const b = compileBoard(board({}, h(Row, { g: B, at: '5 20' }), h(R9, { at: '30 5' }), h(Row, { g: A, at: '5 10' }), h(C, { at: '30 10' }), h(R0, { at: '30 20' })))
  assert.equal(refAt(b, 30, 20), 'R1')
  assert.equal(refAt(b, 5, 10), 'R2')
  assert.equal(refAt(b, 5, 20), 'R3')
  assert.equal(refAt(b, 30, 5), 'R4')
  assert.equal(refAt(b, 30, 10), 'C1')
  assert.deepEqual(b.schematic.parts.filter(p => p.path.length).map(p => [p.ref, p.path[0], p.local]), [['D1', 'A', 'D'], ['D2', 'B', 'D'], ['R2', 'A', 'R'], ['R3', 'B', 'R']])
})

test('circuit: refStyle "hierarchical" names the parts of instances after their path, explicit refs still reserve', () => {
  const { VCC, SW, GND } = nets()
  const Buck1 = channel({ VCC, SW }, 'Buck1')
  const plain = R0603('1').connect(VCC, GND)
  const pinned = channel({ VCC, SW }, 'Ch')
  pinned.R.ref('R7')
  const b = compileBoard(board({ refStyle: 'hierarchical' }, h(Row, { g: Buck1, at: '5 5' }), h(plain, { at: '30 5' }), h(Row, { g: pinned, at: '5 15' })))
  assert.deepEqual(b.footprints.map(f => f.ref).sort(), ['BUCK1_D', 'BUCK1_R', 'CH_D', 'R1', 'R7'])
  assert.deepEqual(errors(b), [])
  const p = b.schematic.parts.find(x => x.ref === 'BUCK1_R')
  assert.deepEqual([p.path, p.local], [['Buck1'], 'R'])
  assert.throws(() => compileBoard(board({ refStyle: 'deep' }, h(plain, { at: '5 5' }))), /refStyle must be "flat" or "hierarchical"/)
})

test('circuit: names come from named(), the second argument, or the circuit name and a counter', () => {
  const { VCC, SW } = nets()
  const a = channel({ VCC, SW })
  const b = channel({ VCC, SW })
  const c = channel.named('Third')({ VCC, SW })
  const d = channel({ VCC, SW }, 'Fourth')
  assert.deepEqual([a.name, b.name, c.name, d.name], ['chan1', 'chan2', 'Third', 'Fourth'])
  const board1 = compileBoard(board({}, h(Row, { g: a, at: '5 5' }), h(Row, { g: b, at: '5 10' }), h(Row, { g: c, at: '5 15' }), h(Row, { g: d, at: '5 20' })))
  assert.ok(board1.schematic.nets.some(n => n.name === 'chan2/led'))
  assert.throws(() => channel({ VCC, SW }, 'not a name'), /must be an identifier/)
  const x = channel({ VCC, SW }, 'Twin'), y = channel({ VCC, SW }, 'Twin')
  assert.throws(() => compileBoard(board({}, h(Row, { g: x, at: '5 5' }), h(Row, { g: y, at: '5 10' }))), /two circuit instances on <PCB Circ> are named Twin/)
})

test('layout: places an instance as an element or a call, and the site data names the layout', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A')
  const B = channel({ VCC, SW }, 'B')
  assert.equal(Row.name, 'Row')
  assert.equal(Column.name, 'Column')
  assert.equal(Row.circuit, 'chan')
  const b = compileBoard(board({}, h(Row, { g: A, at: '5 5' }), Column({ g: B, at: '20 5' })))
  assert.equal(refAt(b, 5, 5), 'R1')
  assert.equal(refAt(b, 11, 5), 'D1')
  assert.equal(refAt(b, 20, 5), 'R2')
  assert.equal(refAt(b, 20, 9), 'D2')
  assert.ok(b.items.some(it => it.kind === 'track' && it.net === 'A/led'))
  const s = site(b).schematic
  assert.deepEqual(s.circuits, [
    { path: ['A'], name: 'A', circuit: 'chan', layout: 'Row', parts: ['R1', 'D1'], children: [], placed: true },
    { path: ['B'], name: 'B', circuit: 'chan', layout: 'Column', parts: ['R2', 'D2'], children: [], placed: true },
  ])
  assert.deepEqual(s.parts.find(p => p.ref === 'D2').path, ['B'])
  assert.equal(s.parts.find(p => p.ref === 'D2').local, 'D')
  assert.deepEqual(s.nets.find(n => n.name === 'A/led').path, ['A'])
  const other = circuit('other', ({ X }) => ({ R: R0603('1').connect(X, X) }))
  assert.throws(() => Row({ g: other({ X: VCC }) }), /lays out the circuit chan, but g is other1, an instance of other/)
  assert.throws(() => Row({}), /needs g=/)
  settle()
})

test('layout: an instance laid out twice is a compile error naming both sites', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A')
  assert.throws(() => compileBoard(board({}, h(Row, { g: A, at: '5 5' }), h(Column, { g: A, at: '20 5' }))),
    e => e instanceof CompileError && /the circuit instance A is laid out twice on <PCB Circ>: by Row at .* and by Column at /.test(e.message))
})

test('layout: a part of a laid-out instance placed outside the layout is an error; without a layout, parts are placed one by one', () => {
  const { VCC, SW } = nets()
  const solo = circuit('solo', ({ VCC, SW }, { nets: { led } }) => ({ R: R0603('330').connect(VCC, led), D: LED0603('red').connect({ A: led, K: SW }) }))
  const Half = layout(solo, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' })), 'Half')
  const A = solo({ VCC, SW }, 'A')
  assert.throws(() => compileBoard(board({}, h(Half, { g: A, at: '5 5' }), h(A.D, { at: '20 5' }))),
    e => e instanceof CompileError && /LED0603\("red"\), A\.D, is placed at .* outside a layout, while Half lays out A at /.test(e.message))
  const B = solo({ VCC, SW }, 'B')
  const b = compileBoard(board({}, h(B.R, { at: '5 5' }), h(B.D, { at: '20 5' })))
  assert.deepEqual(errors(b), [])
  const c = b.schematic.circuits[0]
  assert.deepEqual([c.name, c.layout, c.placed], ['B', undefined, true])
})

test('ERC: an instance never laid out is one unplaced-circuit error; a partly placed one names its missing parts', () => {
  const { VCC, SW } = nets()
  const A = channel({ VCC, SW }, 'A')
  const B = channel({ VCC, SW }, 'B')
  const C = channel({ VCC, SW }, 'C')
  const b = compileBoard(board({}, h(Row, { g: A, at: '5 5' }), h(C.R, { at: '5 20' })))
  const uc = rule(b, 'unplaced-circuit')
  assert.equal(uc.length, 1)
  assert.match(uc[0].message, /^B, an instance of the circuit chan from circuit\.test\.mjs:\d+, is declared but never laid out or placed on the board$/)
  assert.equal(uc[0].severity, 'error')
  const up = rule(b, 'unplaced-part')
  assert.equal(up.length, 1, up.map(d => d.message).join('; '))
  assert.match(up[0].message, /LED0603\("green"\)/)
  const circuits = Object.fromEntries(b.schematic.circuits.map(c => [c.name, c.placed]))
  assert.deepEqual(circuits, { A: true, B: false, C: false })
  // the parts of B are still numbered, after the placed ones, and listed as not placed
  assert.deepEqual(b.schematic.parts.filter(p => p.path[0] === 'B').map(p => [p.ref, p.local, p.placed]), [['D2', 'D', false], ['R3', 'R', false]])
})

test('ports: a port left out throws naming it, NC is allowed for a tolerated port, nets cross only through ports', () => {
  const { VCC, SW, GND } = nets()
  assert.throws(() => channel({ VCC }), e => e instanceof SchematicError && /chan\(…\): the port SW is not connected/.test(e.message))
  assert.throws(() => channel({ VCC, SW: 'SW' }), /the port SW needs a Net from nets\(\) or NC/)
  const en = circuit('en', ({ VIN, EN }) => ({ U: PinHeader(2).connect(VIN, EN) }))
  const E = en({ VIN: VCC, EN: NC }, 'E')
  assert.equal(E.ports.EN, NC)
  const J = PinHeader(2).connect(VCC, GND)
  const b = compileBoard(board({}, h(J, { at: '3 5' }), h(E.U, { at: '15 5' })))
  assert.deepEqual(errors(b), [])
  assert.equal(b.schematic.parts.find(p => p.path[0] === 'E').pins[1].nc, true)
  const leaky = circuit('leaky', ({ A }) => ({ R: R0603('1').connect(A, GND) }))
  assert.throws(() => leaky({ A: VCC }), /reaches the net GND, which is neither a port nor one of its own nets/)
  const lost = circuit('lost', ({ A }) => { R0603('2').connect(A, A); return { R: R0603('1').connect(A, A) } })
  assert.throws(() => lost({ A: VCC }), /R0603\("2"\) is made in the build but not returned/)
  const outside = R0603('3')
  const thief = circuit('thief', () => ({ R: outside }))
  assert.throws(() => thief(), /made outside the build/)
  settle()
})

test('sourcing: source() takes a part of an instance or a whole instance, and factory rules reach parts in circuits', () => {
  const { VCC, SW, GND } = nets()
  const A = channel({ VCC, SW }, 'A')
  const B = channel({ VCC, SW }, 'B')
  const J = PinHeader(2).connect(VCC, GND)
  const C = C0603('100n').connect(SW, GND)
  source(R0603, '330', { MPN: 'R330' })
  source(B.R, { MPN: 'R330-B' })
  source(A, { 'MPN:US': 'US-A' })
  const b = compileBoard(board({}, h(J, { at: '3 5' }), h(C, { at: '30 25' }), h(Row, { g: A, at: '5 10' }), h(Row, { g: B, at: '5 20' })))
  const fields = ref => b.footprints.find(f => f.ref === ref).fields
  assert.deepEqual(fields('R1'), { MPN: 'R330', 'MPN:US': 'US-A' })
  assert.deepEqual(fields('D1'), { 'MPN:US': 'US-A' })
  assert.deepEqual(fields('R2'), { MPN: 'R330-B' })
  assert.deepEqual(fields('D2'), {})
  assert.deepEqual(bomRows(b).find(r => r.refs.includes('R2')).refs, ['R2'])
})
