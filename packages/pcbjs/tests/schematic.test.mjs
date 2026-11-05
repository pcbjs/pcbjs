// The schematic layer: nets and parts as values, the ref registry, ERC and the netlist in the site data.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import PCB, { h, nets, local, bus, NC, part, defineFootprint, isNet, isPart, isPinRef, SchematicError, route, pour, via, bindRef } from '@pcbjs/core'
import { R0603, LED0603, PinHeader, USBC } from '@pcbjs/lib'
import { compileBoard, compileBoards, CompileError } from '@pcbjs/compile'
import { resolvePos } from '@pcbjs/compile/internal/autoroute'
import { siteData } from '@pcbjs/export/internal/site-data'
import { transformSourceRanges } from '@pcbjs/cli/internal/source-ranges'
import { nearPt } from './helpers.mjs'
import { fresh } from './parts.mjs'
// the transform's text hashes, which tests/source-ranges.test.mjs checks, left out of the literals compared here
const plain = s => s.replace(/, hash: "[0-9a-f]{12}"/g, '')

beforeEach(fresh)

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const board = (...children) => h(PCB, { name: 'Sch' }, edge(), ...children)
const errors = b => b.erc.filter(d => d.severity === 'error')
const rule = (b, r) => b.erc.filter(d => d.rule === r)
const refOf = (b, at) => b.footprints.find(f => f.at[0] === at[0] && f.at[1] === at[1])?.ref

test('nets: the same key gives the same net, classes are declared once, identity on the board is the name', () => {
  const n = nets({ VIN: { class: 'power' } })
  assert.equal(n.GND, n.GND)
  assert.ok(isNet(n.GND))
  assert.deepEqual({ ...n.GND }, { $$: 'net', name: 'GND' })
  assert.equal(n.VIN.class, 'power')
  assert.equal(n.GND.class, undefined)
  const other = nets()
  assert.notEqual(other.GND, n.GND)
  const R1 = bindRef(R0603('1k').connect({ 1: n.GND, 2: n.VIN }), 'R1')
  const R2 = bindRef(R0603('1k').connect({ 1: other.GND, 2: n.VIN }), 'R2')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '15 5' })))
  assert.deepEqual(
    b.nets.map(x => x.name),
    ['GND', 'VIN'],
  )
  const sch = b.schematic.nets
  assert.deepEqual(
    sch.map(x => x.name),
    ['GND', 'VIN'],
    'declaration order',
  )
  assert.deepEqual(sch[0].pins, ['R1.1', 'R2.1'])
  assert.equal(sch[1].class, 'power')
})

test('nets: bus gives name0 to name<n-1>', () => {
  const d = bus('D', 4, { class: 'data' })
  assert.deepEqual(
    d.map(x => x.name),
    ['D0', 'D1', 'D2', 'D3'],
  )
  assert.ok(d.every(x => x.class === 'data'))
  assert.throws(() => bus('D', 0), SchematicError)
})

test('nets: local nets are qualified with the instance path, one per instance', () => {
  const { VCC, GND } = nets()
  function Divider({ at, n }) {
    const { mid } = local()
    const top = R0603('10k', { ref: `R${n}` }).connect({ 1: VCC, 2: mid })
    const bot = R0603('10k', { ref: `R${n + 1}` }).connect({ 1: mid, 2: GND })
    return h('g', { at }, h(top, { at: '0 0' }), h(bot, { at: '0 3' }))
  }
  const b = compileBoard(board(h(Divider, { at: '5 5', n: 1 }), h(Divider, { at: '15 5', n: 3 })))
  const names = b.schematic.nets.map(x => x.name)
  assert.ok(names.includes('Divider#1/mid') && names.includes('Divider#2/mid'), names.join(', '))
  const mid = b.schematic.nets.find(x => x.name === 'Divider#2/mid')
  assert.equal(mid.local, true)
  assert.deepEqual(mid.pins.length, 2)
  assert.deepEqual(errors(b), [])
  assert.equal(rule(b, 'single-pin-net').length, 0)
  // parts made during the render take their refs from its props
  assert.deepEqual(b.footprints.map(f => f.ref).sort(), ['R1', 'R2', 'R3', 'R4'])
  assert.equal(refOf(b, [15, 8]), 'R4')
  // outside a render, a label or a counter names the scope
  assert.equal(local('Chan').x.local, true)
})

test('parts: connect by pin name, and the mistakes it rejects at the call site', () => {
  const { A, B, C } = nets()
  const r = R0603('330')
  assert.ok(isPart(r))
  assert.equal(r.connect({ 1: A, 2: B }), r, 'connect returns the same part')
  assert.throws(() => r.connect({ 1: C }), /pin 1 is connected twice/)
  assert.throws(() => R0603('1').connect(A), /connect takes one object of nets by pin name/)
  assert.throws(() => R0603('1').connect(A, B, C), /connect takes one object of nets by pin name/)
  assert.throws(() => R0603('1').connect({ 3: A }), /no pin "3"/)
  assert.throws(() => LED0603('red').connect({ X: A }), /no pin "X"(; did you mean \w+\?)?; its pins are K, A/)
  assert.throws(() => LED0603('red').connect({ 1: A }), /no pin "1"(; did you mean \w+\?)?; its pins are K, A/)
  assert.throws(() => R0603('1').connect({ 1: 'GND', 2: B }), /needs a Net from nets\(\) or NC, got "GND"/)
  assert.throws(() => R0603('1').connect({ 1: A, 2: B }).X, SchematicError)
  const d = LED0603('red').connect({ A: A, K: B })
  assert.equal(d.K.net, B)
  assert.equal(d[1].pad, '1', 'a number key is the pad of that number')
  assert.equal(d[1].net, B)
  assert.equal(d.A, d['A'])
  assert.ok(isPinRef(d.K))
  assert.equal(d.K.part, d)
})

test('parts: NC leaves a pin open on purpose, an unconnected pin is an ERC warning', () => {
  const { A } = nets()
  const J = bindRef(PinHeader(3)().connect({ 1: A, 2: NC, 3: A }), 'J1')
  const K = bindRef(PinHeader(2)().connect({ 1: A }), 'J2')
  const b = compileBoard(board(h(J, { at: '5 5' }), h(K, { at: '15 5' })))
  const pad2 = b.items.find(i => i.kind === 'pad' && i.ref === 'J1' && i.num === '2')
  assert.equal(pad2.net, undefined)
  const warn = rule(b, 'unconnected-pin')
  assert.equal(warn.length, 1)
  assert.match(warn[0].message, /^J2\/2/)
  nearPt(warn[0].at, [15, 7.54], 1e-9)
  const j1 = b.schematic.parts.find(p => p.ref === 'J1')
  assert.deepEqual(j1.pins, [
    { name: '1', net: 'A', nc: false },
    { name: '2', net: null, nc: true },
    { name: '3', net: 'A', nc: false },
  ])
})

test('registry: refs come from the bindings and the ref option, the option winning', () => {
  const { A, B } = nets()
  const Ra = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R3')
  const Rb = bindRef(R0603('2', { ref: 'R1' }).connect({ 1: A, 2: B }), 'Rb')
  const Rc = bindRef(R0603('3').connect({ 1: A, 2: B }), 'R4')
  const Ja = bindRef(PinHeader(2)().connect({ 1: A, 2: B }), 'J1')
  const b = compileBoard(
    board(h(Rc, { at: '5 5' }), h(Ja, { at: '25 5' }), h(Rb, { at: '10 5' }), h(Ra, { at: '15 5' }), h(bindRef(R0603().connect({ 1: A, 2: B }), 'R2'), { at: '20 10' })),
  )
  assert.equal(refOf(b, [10, 5]), 'R1', 'the ref option wins over the binding')
  assert.equal(refOf(b, [15, 5]), 'R3')
  assert.equal(refOf(b, [5, 5]), 'R4')
  assert.equal(refOf(b, [25, 5]), 'J1')
  assert.deepEqual(
    b.schematic.parts.map(p => p.ref),
    ['J1', 'R1', 'R2', 'R3', 'R4'],
  )
  for (const it of b.items) assert.ok(!it.ref?.includes('\u0000'), 'no placeholder ref is left')
})

test('registry: a part placed twice is a CompileError naming both sites', () => {
  const { A, B } = nets()
  const R = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R')
  const at1 = { file: 'main.tsx', line: 3, col: 5, endLine: 3, endCol: 20 }
  const at2 = { file: 'main.tsx', line: 4, col: 5, endLine: 4, endCol: 20 }
  assert.throws(
    () => compileBoard(board(h(R, { at: '5 5', __src: at1 }), h(R, { at: '9 5', __src: at2 }))),
    e => e instanceof CompileError && /R0603\("1"\) is placed twice/.test(e.message) && e.message.includes('main.tsx:3:5') && e.message.includes('main.tsx:4:5'),
  )
})

test('registry: a declared part that is never placed is a compile error, and refs and nets come from the part only', () => {
  const { A, B } = nets()
  const R = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1')
  const C = bindRef(R0603('2').connect({ 1: A, 2: B }), 'R2')
  assert.throws(
    () => compileBoard(board(h(R, { at: '5 5' }))),
    e => e instanceof CompileError && /R2 at .*schematic\.test\.mjs:\d+:\d+ is declared but never placed/.test(e.message),
  )
  void C
  assert.throws(() => compileBoard(board(h(R, { at: '5 5', ref: 'R9' }))), /a placement takes at, side, grid, locked, ref:at and thermal, not ref/)
  assert.throws(() => compileBoard(board(h(R, { at: '5 5', 'net:pad1': 'X' }))), /a placement takes at, side, grid, locked, ref:at and thermal, not net:pad1/)
})

test('ERC: a net with fewer than two pins is a warning', () => {
  const { A, B } = nets()
  const R = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1')
  const S = bindRef(R0603('2').connect({ 1: A, 2: B }), 'R2')
  const b = compileBoard(board(h(R, { at: '5 5' }), h(S, { at: '5 10' })))
  assert.deepEqual(b.erc, [])
  const { P, Q } = nets()
  const T = bindRef(R0603('3').connect({ 1: P, 2: Q }), 'R1')
  const c = compileBoard(board(h(T, { at: '5 5' })))
  const single = rule(c, 'single-pin-net')
  assert.deepEqual(
    single.map(m => m.message),
    ['net P has only one pin, R1.1', 'net Q has only one pin, R1.2'],
  )
  nearPt(single[0].at, [5 - 0.825, 5], 1e-9)
})

test('routes: pin handles are route ends, resolved to the pad centres after placement', () => {
  const { A } = nets()
  const J = bindRef(PinHeader(2)().connect({ 1: A, 2: NC }), 'J1')
  const K = bindRef(PinHeader(2)().connect({ 1: A, 2: NC }), 'J2')
  const b = compileBoard(board(h(J, { at: '5 5' }), h(K, { at: '20 5' }), route(J[1], K[1]).net(A).width(0.25)))
  const t = b.items.filter(i => i.kind === 'track' && i.net === 'A')
  assert.equal(t.length, 1)
  nearPt(t[0].pts[0], [5, 5], 1e-9)
  nearPt(t[0].pts.at(-1), [20, 5], 1e-9)
  assert.equal(b.unconnected, 0)
  const end = resolvePos(b, K[2], 'F.Cu')
  assert.deepEqual([end.x, end.y, end.layer], [20, 7.54, 'F.Cu'])
  const L = bindRef(PinHeader(2)().connect({ 1: A, 2: NC }), 'L')
  assert.throws(() => resolvePos(b, L[1], 'F.Cu'), /not placed on this board/)
})

test('helpers: route, pour and via take a Net, null for no net', () => {
  const { G } = nets()
  const J1 = bindRef(PinHeader(2)(), 'J1')
  const r = route(J1[1], [3, 4, 'B.Cu']).net(G).width(0.3).layers(['B.Cu', 'F.Cu'])
  assert.equal(r.type, 'track')
  assert.deepEqual(r.props.ends, [[3, 4, 'B.Cu']])
  assert.deepEqual(r.props.layers, ['B.Cu', 'F.Cu'])
  assert.equal(route('3 4').net(null).props.net, null)
  assert.deepEqual(pour(G, 'B.Cu', 'M 0 0 H 1 V 1 Z', { priority: 2 }).props, { priority: 2, net: G, layer: 'B.Cu', d: 'M 0 0 H 1 V 1 Z' })
  assert.deepEqual(via(G, '1 2').props, { net: G, at: '1 2' })
  // the source-range transform puts the range into the options, or into an argument of its own
  const code = `import { route, pour, via } from '@pcbjs/core'\nroute(SIG, { at: '1 2' })\npour(GND, 'B.Cu', d)\nvia(GND, at, opts)\n`
  const out = plain(transformSourceRanges(code, '/p/a.ts', 'a.ts').code)
  assert.ok(out.includes(`route(SIG, { at: '1 2', __src: { file: "a.ts", line: 2, col: 1, endLine: 2, endCol: 25 } })`), out)
  assert.ok(out.includes(`pour(GND, 'B.Cu', d, { __src: { file: "a.ts", line: 3, col: 1, endLine: 3, endCol: 20 } })`), out)
  assert.ok(out.includes(`via(GND, at, opts, { __src:`), out)
  const z = pour(G, 'B.Cu', 'M 0 0 H 1 V 1 Z', { __src: { file: 'a.ts', line: 3, col: 1 } })
  assert.deepEqual(z.props.__src, { file: 'a.ts', line: 3, col: 1 })
})

test('factories: a part from the value, then the options; never an element', () => {
  for (const r of [R0603('330'), R0603(330), R0603('330', { dnp: true })]) {
    assert.ok(isPart(r))
    assert.equal(r.value, '330')
    assert.equal(r.prefix, 'R')
    assert.deepEqual(r.pins, ['1', '2'])
  }
  assert.equal(R0603().value, undefined)
  assert.deepEqual(R0603.pins, ['1', '2'])
  assert.equal(R0603.prefix, 'R')
  assert.deepEqual(LED0603.pins, ['K', 'A'])
  assert.equal(LED0603.prefix, 'D')
  assert.deepEqual(PinHeader(3)().pins, ['1', '2', '3'])
  assert.deepEqual(PinHeader(2, { rows: 2 })().pins, ['1', '2', '3', '4'])
  assert.equal(PinHeader(3).prefix, 'J')
  assert.throws(() => PinHeader(0), /pin count/)
  // options alone are a part call without a value, props with `at` are an element, the value is no option
  assert.equal(R0603({ ref: 'R1' }).value, undefined)
  assert.throws(() => R0603({ ref: 'R1', at: '5 5' }), /footprint factory, not an element/)
  assert.throws(() => R0603({ value: '1k' }), /value as its first argument/)
  assert.throws(() => R0603('1k', { value: '2k' }), /value as its first argument/)
  // sourcing keys reach the footprint's fields, a later .source() winning
  fresh()
  const { A, B } = nets()
  const R = bindRef(R0603('4k7').source({ MPN: 'M1', LCSC: 'C1' }).source({ MPN: 'M2' }).connect({ 1: A, 2: B }), 'R1')
  const b = compileBoard(board(h(R, { at: '5 5' })))
  assert.deepEqual(b.footprints[0].fields, { MPN: 'M2', LCSC: 'C1' })
  assert.equal(b.footprints[0].value, '4k7')
  // a user footprint: static metadata and part()
  function Pad1(props) {
    const { children, ...rest } = props
    return h('footprint', rest, h('pad', { num: 1, size: 1 }), children)
  }
  Pad1.pins = ['1']
  Pad1.prefix = 'TP'
  const T = part(Pad1, { value: 'T', ref: 'TP1' }).connect({ 1: A })
  const TP = defineFootprint(Pad1, { pins: ['1'], prefix: 'TP' })
  const U = bindRef(TP('U').connect({ 1: A }), 'TP2')
  const c = compileBoard(board(h(T, { at: '5 5' }), h(U, { at: '9 5' })))
  assert.deepEqual(
    c.footprints.map(f => f.ref),
    ['TP1', 'TP2'],
  )
  // a part with no pins, such as a bare hole
  assert.deepEqual(
    part(function Bare() {
      return null
    }).pins,
    [],
  )
})

test('nets: a string net is a compile error, and strictNets is no rule', () => {
  const { A, B } = nets()
  const R = bindRef(R0603('1').connect({ 1: A, 2: B }), 'R1')
  assert.throws(() => compileBoard(board(h(R, { at: '5 5' }), route('0 0').net('A').width(0.3).H(4))), /a net is a Net from nets\(\), got the string "A"/)
  const ok = compileBoard(board(h(R, { at: '5 5' }), route('4.175 5').net(A).width(0.3).H(2)))
  assert.deepEqual(
    ok.drc.filter(d => d.severity === 'error'),
    [],
  )
  assert.throws(() => compileBoard(h(PCB, { name: 'S', rules: { strictNets: true } }, edge())), /unknown rule "strictNets"/)
})

test('site data: the schematic and the ERC list follow the contract', () => {
  const { VIN, GND } = nets({ VIN: { class: 'power' } })
  const J = bindRef(PinHeader(2)().connect({ 1: VIN, 2: GND }), 'J1')
  const R = bindRef(R0603('1k').connect({ 1: VIN, 2: GND }), 'R1')
  const b = compileBoard(board(h(J, { at: '5 5' }), h(R, { at: '15 5' })))
  const root = b.schematic.parts[0].src.file.replace(/[\\/][^\\/]+$/, '')
  const site = siteData(b, { root, fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: [] })
  assert.deepEqual(
    site.schematic.parts.map(p => [p.ref, p.value, p.prefix, p.placed]),
    [
      ['J1', 'Conn_01x02', 'J', true],
      ['R1', '1k', 'R', true],
    ],
  )
  const r1 = site.schematic.parts[1]
  assert.equal(r1.footprint, 'pcbjs:R_0603_1608Metric')
  assert.deepEqual(r1.pins, [
    { name: '1', net: 'VIN', nc: false },
    { name: '2', net: 'GND', nc: false },
  ])
  assert.equal(r1.src.file, 'schematic.test.mjs')
  assert.deepEqual(Object.keys(r1.src).sort(), ['col', 'file', 'line'])
  assert.deepEqual(site.schematic.nets, [
    { name: 'VIN', class: 'power', local: false, pins: ['J1.1', 'R1.1'] },
    { name: 'GND', local: false, pins: ['J1.2', 'R1.2'] },
  ])
  assert.deepEqual(site.erc, [])
  assert.deepEqual(site.erc, b.erc)
})

// ---- pads and pins: strict mapping, nc pads, multi-pad pins ----

const padFp = (name, pads, { id, ...meta } = {}) => {
  const render = props => {
    const { children, ...rest } = props
    return h('footprint', { ...(id ? { id } : {}), ...rest }, ...pads.map(([num, at, extra = {}]) => h('pad', { num, at, size: 0.6, ...extra })), children)
  }
  Object.defineProperty(render, 'name', { value: name })
  return defineFootprint(render, { prefix: 'U', ...meta })
}

test('pads: a pad matching no pin is a compile error naming the footprint, the pad and the pins, with a suggestion', () => {
  const { V, G } = nets()
  const Reg = padFp(
    'Reg',
    [
      ['1', '0 0', { name: 'VIN' }],
      ['2', '1 0', { name: 'GDN' }],
    ],
    { pins: ['VIN', 'GND'], id: 'test:Reg' },
  )
  const U = bindRef(Reg().connect({ VIN: V, GND: G }), 'U1')
  assert.throws(
    () => compileBoard(board(h(U, { at: '5 5' }))),
    e =>
      e instanceof CompileError &&
      /Reg\(\): pad 2 "GDN" of footprint test:Reg matches no pin; did you mean GND\? Its pins are VIN, GND\./.test(e.message) &&
      /nc on the pad or in the footprint's nc list/.test(e.message),
  )
})

test('pads: the review repro, pins A B C and pads 1:A 2:NC2 3:B 4:C, is an error instead of pad 2 taking net B', () => {
  const { A, B, C } = nets()
  const pads = [
    ['1', '0 0', { name: 'A' }],
    ['2', '1 0', { name: 'NC2' }],
    ['3', '2 0', { name: 'B' }],
    ['4', '3 0', { name: 'C' }],
  ]
  const Mod = padFp('Mod', pads, { pins: ['A', 'B', 'C'] })
  assert.throws(() => compileBoard(board(h(Mod({ ref: 'U1' }).connect({ A, B, C }), { at: '5 5' }))), /Mod\(\): pad 2 "NC2" of footprint Mod matches no pin.*Its pins are A, B, C/)
})

test('pads: nc on the pad or in the factory nc list gives no net and no unconnected-pin finding', () => {
  const { A, B, C } = nets()
  const base = [
    ['1', '0 0', { name: 'A' }],
    ['3', '2 0', { name: 'B' }],
    ['4', '3 0', { name: 'C' }],
  ]
  const OnPad = padFp('OnPad', [...base, ['2', '1 0', { name: 'NC2', nc: true }]], { pins: ['A', 'B', 'C'] })
  const InList = padFp('InList', [...base, ['2', '1 0', { name: 'NC2' }], ['5', '4 0']], { pins: ['A', 'B', 'C'], nc: ['NC2', 5] })
  assert.deepEqual(InList.nc, ['NC2', '5'])
  const P = bindRef(OnPad().connect({ A, B, C }), 'U1'),
    Q = bindRef(InList().connect({ A, B, C }), 'U2')
  const b = compileBoard(board(h(P, { at: '5 5' }), h(Q, { at: '5 10' })))
  for (const ref of ['U1', 'U2']) {
    const pads = b.items.filter(i => i.kind === 'pad' && i.ref === ref)
    assert.deepEqual(pads.map(p => [p.num, p.net]).sort(), [['1', 'A'], ['2', undefined], ['3', 'B'], ['4', 'C'], ...(ref === 'U2' ? [['5', undefined]] : [])])
  }
  assert.deepEqual(errors(b), [])
  assert.equal(rule(b, 'unconnected-pin').length, 0)
  assert.deepEqual(
    b.schematic.parts.find(p => p.ref === 'U2').pins.map(p => p.name),
    ['A', 'B', 'C'],
  )
  // an unconnected pin is still reported; a name both a pin and an nc pad is rejected
  const R = bindRef(OnPad().connect({ A, B }), 'U1')
  assert.equal(rule(compileBoard(board(h(R, { at: '5 5' }))), 'unconnected-pin').length, 1)
  assert.throws(() => padFp('Both', base, { pins: ['A', 'B', 'C'], nc: ['C'] })(), /declares "C" both as a pin and as an nc pad/)
})

test('pads: a pin with several pads routes from the pad nearest the other end; a pad handle addresses one pad', () => {
  const { VB, G } = nets()
  const Usb = padFp(
    'Usb',
    [
      ['A9', '-1.5 0', { name: 'VBUS' }],
      ['B4', '1.5 0', { name: 'VBUS' }],
      ['G', '0 1', { name: 'GND' }],
    ],
    { pins: ['VBUS', 'GND'] },
  )
  const J = bindRef(Usb().connect({ VBUS: VB, GND: G }), 'U1')
  const K = bindRef(PinHeader(2)().connect({ 1: VB, 2: G }), 'J1')
  const ends = (...routes) => {
    const b = compileBoard(board(h(J, { at: '10 5' }), h(K, { at: '25 5' }), ...routes))
    return b.items.filter(i => i.kind === 'track' && i.net === 'VB').map(t => [t.pts[0], t.pts.at(-1)])
  }
  // K is to the right, so J.VBUS starts at B4, x = 11.5
  let [[a, z]] = ends(route(J.VBUS, K[1]).net(VB).width(0.25))
  nearPt(a, [11.5, 5])
  nearPt(z, [25, 5])
  // the other way round: the end is the pin handle
  ;[[a, z]] = ends(route(K[1], J.VBUS).net(VB).width(0.25))
  nearPt(a, [25, 5])
  nearPt(z, [11.5, 5])
  // a pad handle picks A9 although B4 is nearer, by number or by a unique name
  ;[[a]] = ends(route(J['A9'], K[1]).net(VB).width(0.25))
  nearPt(a, [8.5, 5])
  assert.equal(J['A9'], J['A9'])
  assert.equal(J['A9'].pad, 'A9')
  // a "REF.PAD" string is no route end
  assert.throws(() => ends(route('U1.A9', K[1]).net(VB).width(0.25)), /route end "U1\.A9" is no coordinate; a pad is named by its handle/)
  assert.throws(() => J['Z9'], /Usb\(\) has no pin or pad "Z9"/)
})

test('types: every defineFootprint form gives literal pin names, and tsc rejects a bad pin', async () => {
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const dist = fileURLToPath(import.meta.resolve('@pcbjs/core'))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-pins-'))
  const lines = [
    `import { defineFootprint, nets } from ${JSON.stringify(dist)}`,
    `const render = (_props: any) => null`,
    `const { A } = nets()`,
    `const Inline = defineFootprint(render, { pins: ['A', 'B'], prefix: 'U' })`,
    `const LIST = ['IO0', 'IO1'] as const`,
    `const AsConst = defineFootprint(render, { pins: LIST, prefix: 'U', nc: ['3'] })`,
    `function gen<const N extends string>(names: readonly N[]) { return defineFootprint(render, { pins: names, prefix: 'U' }) }`,
    `const Gen = gen(['PA9', 'PA10'])`,
    `const Fn = defineFootprint(render, { pins: (_p: any) => ['X1', 'X2'] as const, prefix: 'Y' })`,
    `const WIDE: string[] = ['IO0']`,
    `const Wide = defineFootprint(render, { pins: WIDE, prefix: 'U' })`,
    `export const ok = [Inline().A, AsConst().IO1, Gen().PA9, Fn().X2, Inline().B, Inline()[7], Wide().connect({ IO0: A }), Inline()[1], Inline().connect({ A })]`,
    `export const bad1 = Inline().C`,
    `export const bad2 = AsConst().IO99`,
    `export const bad3 = Gen().PA99`,
    `export const bad4 = Fn().X3`,
    `export const bad5 = Wide().IO0`,
    `export const bad6 = Inline().connect({ C: A })`,
    `export const bad7 = Inline()['C']`,
  ]
  const file = join(dir, 'fixture.ts')
  writeFileSync(file, lines.join('\n') + '\n')
  try {
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      types: [],
    })
    const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file && resolve(d.file.fileName) === file)
    const byLine = new Map(diags.map(d => [d.file.getLineAndCharacterOfPosition(d.start).line, ts.flattenDiagnosticMessageText(d.messageText, '\n')]))
    const badLines = lines.flatMap((l, i) => (l.startsWith('export const bad') ? [i] : []))
    assert.deepEqual(
      [...byLine.keys()].sort((a, b) => a - b),
      badLines,
      [...byLine.values()].join('\n---\n'),
    )
    assert.match(byLine.get(badLines[1]), /Property 'IO99' does not exist/)
    assert.match(byLine.get(badLines[2]), /Property 'PA99' does not exist/)
    // a widened string[] gives a part without named pin keys, so even a real pin name is an error that points at the list
    assert.match(byLine.get(badLines[4]), /Property 'IO0' does not exist on type 'Part<string(, never)?>'/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pad keys: a number is a pad number, any other key a pin first, then a pad id of the rendered footprint; an unknown key names the nearest pin or pad', () => {
  const { VB, G } = nets()
  const Usb = padFp(
    'Usb',
    [
      ['A9', '-1.5 0', { name: 'VBUS' }],
      ['B4', '1.5 0', { name: 'VBUS' }],
      ['G', '0 1', { name: 'GND' }],
    ],
    { pins: ['VBUS', 'GND'] },
  )
  const J = bindRef(Usb().connect({ VBUS: VB, GND: G }), 'J')
  assert.equal(J['A9'], J.A9)
  assert.equal(J.A9.pad, 'A9')
  assert.ok(isPinRef(J.B4))
  // G is a pad number but no pin, GND a pin
  assert.equal(J.G.pad, 'G')
  assert.equal(J.GND.pad, undefined)
  assert.throws(
    () => J[1],
    e =>
      e instanceof SchematicError &&
      /^Usb\(\) has no pad numbered "1"; a number key is a pad number, never a pin position\. Its pads are A9, B4, G; its pins are VBUS, GND$/.test(e.message),
  )
  assert.throws(
    () => J.B5,
    e => e instanceof SchematicError && /^Usb\(\) has no pin or pad "B5"; did you mean B4\? Its pins are VBUS, GND; its pads are A9, B4, G$/.test(e.message),
  )
  assert.throws(() => J.XYZ, /has no pin or pad "XYZ"\. Its pins are VBUS, GND; its pads are A9, B4, G/)
  // a number is the pad of that number, whatever pin sits there: pin 2 is B, on pad 3
  const { A, B, C } = nets()
  const Swap = padFp(
    'Swap',
    [
      ['1', '0 0', { name: 'A' }],
      ['2', '1 0', { name: 'C' }],
      ['3', '2 0', { name: 'B' }],
      ['4', '3 0', { name: 'C' }],
    ],
    { pins: ['A', 'B', 'C'] },
  )
  const S = bindRef(Swap().connect({ A, B, C }), 'S')
  assert.equal(S[2].pad, '2')
  assert.equal(S[2].net, C)
  assert.equal(S['3'], S[3])
  assert.equal(S[3].net, B)
  assert.equal(S[4].pad, '4')
  assert.throws(() => S[5], /Swap\(\) has no pad numbered "5"; a number key is a pad number, never a pin position\. Its pads are 1, 2, 3, 4; its pins are A, B, C$/)
  // connect takes pin names only, never a pad number
  assert.throws(() => Swap().connect({ 3: B }), /Swap\(\)\.connect: no pin "3"(; did you mean \w+\?)?; its pins are A, B, C/)
  // a pad number that is also the name of the pin on it is that pin, a pin handle
  const P = padFp(
    'Num',
    [
      ['1', '0 0'],
      ['2', '1 0'],
      ['3', '2 0', { name: '1' }],
    ],
    { pins: ['1', '2'] },
  )()
  assert.equal(P[2].pin, '2')
  assert.equal(P[2].pad, undefined)
  // pin 1 is on pad 1 and on pad 3, named 1: the number then means only pad 1
  assert.equal(P[1].pad, '1')
  // a header's pads come from its own props
  const H = bindRef(PinHeader(3)(), 'H')
  assert.equal(H[3].pin, '3')
  assert.equal(H[3].pad, undefined)
  assert.equal(H['3'], H[3])
  assert.throws(() => H[4], /PinHeader\(\) has no pad numbered "4"; a number key is a pad number, never a pin position\. Its pads are 1, 2, 3; its pins are 1, 2, 3$/)
  // the USB-C receptacle: pins win, pads by number
  const U = bindRef(USBC()(), 'U')
  assert.equal(U.B6.pad, 'B6')
  assert.equal(U.DP.pad, undefined)
  assert.throws(() => U.B13, /USBC_16P\(\) has no pin or pad "B13"; did you mean B1\?/)
})

test('pad keys: routes between pad handles compile through compileBoards and end at those pads', () => {
  const { VB, G, D } = nets()
  const Usb = padFp(
    'Usb',
    [
      ['A9', '-1.5 0', { name: 'VBUS' }],
      ['B4', '1.5 0', { name: 'VBUS' }],
      ['G', '0 1', { name: 'GND' }],
      ['T', '0 -1', { name: 'D' }],
    ],
    { pins: ['VBUS', 'GND', 'D'] },
  )
  const J = bindRef(Usb().connect({ VBUS: VB, GND: G, D }), 'U1')
  const K = bindRef(PinHeader(2)().connect({ 1: VB, 2: G }), 'J1')
  const [b] = compileBoards(board(h(J, { at: '10 5' }), h(K, { at: '25 5' }), route(J['A9'], K[1]).net(VB).width(0.25), route(J.G, K[2]).net(G).width(0.25)))
  const ends = net => b.items.filter(i => i.kind === 'track' && i.net === net).map(t => [t.pts[0], t.pts.at(-1)])
  const [[a, z]] = ends('VB')
  nearPt(a, [8.5, 5])
  nearPt(z, [25, 5])
  const [[g]] = ends('G')
  nearPt(g, [10, 6])
  assert.deepEqual(
    b.drc.filter(d => d.severity === 'error'),
    [],
  )
})

test('types: pad ids are typed keys, pin keys win, and tsc rejects an unknown pad id', async () => {
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const core = fileURLToPath(import.meta.resolve('@pcbjs/core'))
  const lib = fileURLToPath(import.meta.resolve('@pcbjs/lib'))
  const kicad = fileURLToPath(import.meta.resolve('@pcbjs/kicad'))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-pads-'))
  const lines = [
    `import { defineFootprint, nets, route, type PadRef, type PinRef } from ${JSON.stringify(core)}`,
    `import { USBC, SOIC, PinHeader, withPins } from ${JSON.stringify(lib)}`,
    `import { kicadFootprint } from ${JSON.stringify(kicad)}`,
    `const render = (_props: any) => null`,
    `const { DP, A } = nets()`,
    `const J1 = USBC('full16')('x').connect({ DP })`,
    `const U1 = SOIC(8)('x')`,
    `const H1 = PinHeader(4)()`,
    `const Inline = defineFootprint(render, { pins: ['VIN', 'GND'], pads: [1, 2, 'EP', 'GND'], prefix: 'U' })`,
    `const PADS = ['T1', 'VIN'] as const`,
    `const AsConst = defineFootprint(render, { pins: ['VIN', 'T2'], pads: PADS, prefix: 'U' })`,
    `const X = Inline()`,
    `const NUMS = [1, 2, 7, 'EP'] as const`,
    `const Nums = defineFootprint(render, { pins: ['IN', '2'], pads: NUMS, prefix: 'U' })`,
    `const N1 = Nums()`,
    `export const b6: PadRef<'B6'> = J1['B6']`,
    `export const s1: PadRef = J1.S1`,
    `export const dp: PinRef = J1.DP`,
    `export const u7: PinRef = U1[7]`,
    `export const ep: PadRef<'EP'> = X.EP`,
    `export const t1: PadRef<'T1'> = AsConst().T1`,
    `export const r = route(J1['B6'], J1['A6']).net(DP).width(0.2)`,
    `export const esc = [J1['B6'], X[2], H1[3]]`,
    `export const conn = X.connect({ VIN: A })['EP']`,
    `// a number is a pad number: typed by the pads listed inline or as const`,
    `export const x1: PadRef<'1'> = X[1]`,
    `export const x2: PadRef<'2'> = X['2']`,
    `export const n7: PadRef<'7'> = N1[7]`,
    `export const n2: PinRef = N1[2]`,
    `export const h9: PinRef = H1[9]`,
    `// @ts-expect-error no pad 3 among the typed pads`,
    `export const bad4 = X[3]`,
    `// @ts-expect-error no pad 8 among the typed pads`,
    `export const bad5 = N1[8]`,
    `// @ts-expect-error 2 is a pin of Nums, a pin handle`,
    `export const bad6: PadRef = N1[2]`,
    `// pin keys win: GND and VIN are pins, so they stay pin handles`,
    `// @ts-expect-error a pin handle is not a pad handle`,
    `export const gnd: PadRef = X.GND`,
    `// @ts-expect-error VIN is a pin of AsConst`,
    `export const vin: PadRef = AsConst().VIN`,
    `// @ts-expect-error no pad B13`,
    `export const bad1 = J1['B13']`,
    `// @ts-expect-error no pad EQ`,
    `export const bad2 = X.EQ`,
    `// withPins names the pins of an untyped KiCad footprint, a pad kept by name included`,
    `const Teensy = withPins(kicadFootprint('Lib:Teensy_4_0'), { G: 'G', 1: 'RX1' })`,
    `export const tg: PinRef = Teensy('~').G`,
    `export const trx: PinRef = Teensy('~').RX1`,
    `export const t3: PinRef = Teensy('~')[3]`,
    `export const tc = Teensy('~').connect({ G: A, 2: A })`,
    `export const sot: PinRef = withPins(SOIC(8), { 1: 'EN' })('x').EN`,
    `// @ts-expect-error withPins named no pin D0`,
    `export const td = Teensy('~').D0`,
    `// @ts-expect-error a power6 receptacle has no B6 pad`,
    `export const bad3 = USBC('power6')().B6`,
  ]
  const file = join(dir, 'fixture.ts')
  writeFileSync(file, lines.join('\n') + '\n')
  try {
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      types: [],
    })
    const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file && resolve(d.file.fileName) === file)
    assert.deepEqual(
      diags.map(d => `${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`),
      [],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
