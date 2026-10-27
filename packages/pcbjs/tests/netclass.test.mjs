import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets, variants, defineDefaultBoard, resetDefaults, BASE_BOARD } from '@pcbjs/core'
import { bindPCB } from '@pcbjs/fab'
import { compileBoard, compileBoards, CompileError } from '@pcbjs/compile'
import { classClearance, classOf } from '@pcbjs/compile/netclass'
import { BASE } from '@pcbjs/lib/rules'
import { twoLayer, JLCPCB_4L_7628, traceWidth } from '@pcbjs/lib'
import { near } from './helpers.mjs'

afterEach(() => resetDefaults())

const edge = (w = 20, hh = 10) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const tracks = (b, net) => b.items.filter(i => i.kind === 'track' && (net === undefined || i.net === net))
const vias = b => b.items.filter(i => i.kind === 'via')
const opts = { routeCache: false }

test('net classes: BASE_BOARD has none and a board without classes gets no Board.classes', () => {
  assert.deepEqual(BASE_BOARD.classes, {})
  const { P } = nets({ P: { class: 'power' } })
  const b = compileBoard(h(PCB, { name: 'C' }, edge(), smd('J1', 3, 5, P), smd('J2', 15, 5, P), route('J1.1', 'J2.1')), opts)
  assert.equal(b.classes, undefined)
  // without a class table a tag is a label: no finding, the width stays the rules' minimum
  assert.deepEqual(b.erc.filter(e => e.rule === 'net-class'), [])
  for (const t of tracks(b, 'P')) assert.equal(t.width, BASE.minTrackWidth)
})

test('net classes: resolved in mm with defaults, merged class by class and field by field', () => {
  defineDefaultBoard({ classes: { power: { width: 0.5, clearance: 0.3 }, usb: { gap: '6mil' } } })
  const { P } = nets({ P: { class: 'power' } })
  const b = compileBoard(h(PCB, { name: 'C', classes: { power: { width: '0.6mm', via: { drill: 0.4 } } } }, edge(), smd('J1', 3, 5, P), smd('J2', 15, 5, P)), opts)
  assert.deepEqual(b.classes.power, { width: 0.6, clearance: 0.3, via: { drill: 0.4 }, skew: 0.1, uncoupled: 5, tolerance: 0.1 })
  near(b.classes.usb.gap, 0.1524, 1e-9)
  assert.equal(classOf(b, 'P'), b.classes.power)
})

test('net classes: bad tables throw at the level that gives them', () => {
  assert.throws(() => compileBoard(h(PCB, { name: 'C', classes: { power: { wdith: 0.3 } } }, edge())), /class "power": unknown field "wdith"/)
  assert.throws(() => compileBoard(h(PCB, { name: 'C', classes: { power: { width: -1 } } }, edge())), /width must be a positive length/)
  assert.throws(() => compileBoard(h(PCB, { name: 'C', classes: { z: { impedance: 'x' } } }, edge())), /impedance must be a positive number/)
  assert.throws(() => defineDefaultBoard({ classes: { power: { autoroute: { bend: '30' } } } }), /bend must be/)
})

test('net classes: a route takes the class width and via, under its own width', () => {
  const { P, Q } = nets({ P: { class: 'power' }, Q: { class: 'power' } })
  const b = compileBoard(h(PCB, { name: 'C', classes: { power: { width: 0.5, via: { drill: 0.4, size: 0.8 } } } }, edge(),
    smd('J1', 3, 3, P), smd('J2', 15, 3, P), smd('J3', 3, 7, Q), smd('J4', 15, 7, Q),
    route('J1.1', 'J2.1', 'H 6 U B.Cu H 12 U F.Cu XZ'), route('J3.1', 'J4.1').width(0.3)), opts)
  for (const t of tracks(b, 'P')) assert.equal(t.width, 0.5)
  for (const t of tracks(b, 'Q')) assert.equal(t.width, 0.3)
  assert.equal(vias(b).length, 2)
  for (const v of vias(b)) { assert.equal(v.drill, 0.4); assert.equal(v.size, 0.8) }
  assert.equal(b.unconnected, 0)
  assert.deepEqual(b.drc.filter(d => d.severity === 'error'), [])
})

test('net classes: the class layers bound the router', () => {
  const { P } = nets({ P: { class: 'top' } })
  // a wall of another net across F.Cu: only B.Cu gets around it
  const kids = (r) => [edge(), smd('J1', 5, 5, P), smd('J2', 15, 5, P), h('track', { net: 'W', layer: 'F.Cu', width: 0.4, d: 'M10 0.7 L10 9.3' }), r]
  const stuck = compileBoard(h(PCB, { name: 'C', classes: { top: { layers: ['F.Cu'] } } }, ...kids(route('J1.1', 'J2.1'))), opts)
  assert.equal(stuck.drc.filter(d => d.rule === 'route-failed').length, 1)
  const free = compileBoard(h(PCB, { name: 'C', classes: { top: { layers: ['top', 'bottom'] } } }, ...kids(route('J1.1', 'J2.1'))), opts)
  assert.ok(tracks(free, 'P').some(t => t.layer === 'B.Cu'))
  assert.equal(free.unconnected, 0)
  // the route's own layers win over the class
  const own = compileBoard(h(PCB, { name: 'C', classes: { top: { layers: ['F.Cu'] } } }, ...kids(route('J1.1', 'J2.1').rules({ layers: ['F.Cu', 'B.Cu'] }))), opts)
  assert.equal(own.unconnected, 0)
})

test('net classes: class autoroute parameters sit over the board and under the route', () => {
  const { P } = nets({ P: { class: 'slow' } })
  const board = (r) => h(PCB, { name: 'C', autoroute: { bend: '45' }, classes: { slow: { autoroute: { bend: '90' } } } }, edge(), smd('J1', 3, 3, P), smd('J2', 15, 7, P), r)
  const ortho = compileBoard(board(route('J1.1', 'J2.1')), opts)
  for (const t of tracks(ortho, 'P')) for (let i = 1; i < t.pts.length; i++) assert.ok(t.pts[i][0] === t.pts[i - 1][0] || t.pts[i][1] === t.pts[i - 1][1], '90-degree bends only')
  const diag = compileBoard(board(route('J1.1', 'J2.1').rules({ bend: '45' })), opts)
  assert.ok(tracks(diag, 'P').some(t => t.pts.some((p, i) => i > 0 && p[0] !== t.pts[i - 1][0] && p[1] !== t.pts[i - 1][1])), 'the route itself allows 45 degrees')
})

test('net classes: a class impedance gives the width for the start layer, rounded to 0.01 mm', () => {
  const { S } = nets({ S: { class: 'rf' } })
  const b = compileBoard(h(PCB, { name: 'C', stackup: JLCPCB_4L_7628, classes: { rf: { impedance: 50 } } }, edge(), smd('J1', 3, 5, S), smd('J2', 15, 5, S), route('J1.1', 'J2.1')), opts)
  const want = Math.round(traceWidth(JLCPCB_4L_7628, 'F.Cu', 50) * 100) / 100
  assert.equal(want, 0.37)
  for (const t of tracks(b, 'S')) assert.equal(t.width, want)
  // an explicit class width wins over the impedance
  const c = compileBoard(h(PCB, { name: 'C', stackup: JLCPCB_4L_7628, classes: { rf: { impedance: 50, width: 0.3 } } }, edge(), smd('J1', 3, 5, S), smd('J2', 15, 5, S), route('J1.1', 'J2.1')), opts)
  for (const t of tracks(c, 'S')) assert.equal(t.width, 0.3)
})

test('net classes: an unknown class tag is an ERC warning net-class when the board defines classes', () => {
  const { P } = nets({ P: { class: 'pwr' } })
  const b = compileBoard(h(PCB, { name: 'C', classes: { power: { width: 0.5 } } }, edge(), smd('J1', 3, 5, P), smd('J2', 15, 5, P)), opts)
  const w = b.erc.filter(e => e.rule === 'net-class')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /net P has the class pwr, which the board does not define \(classes: power\)/)
  assert.deepEqual(w[0].at, [3, 5])
})

test('net classes: DRC uses the larger class clearance between two nets', () => {
  const { A, B } = nets({ A: { class: 'hv' } })
  // 0.3 mm between the copper of A and B: clean under the rules, too close for the class
  const parts = () => [edge(), h('track', { net: A, layer: 'F.Cu', width: 0.2, d: 'M2 5 L18 5' }), h('track', { net: B, layer: 'F.Cu', width: 0.2, d: 'M2 5.5 L18 5.5' })]
  const plain = compileBoard(h(PCB, { name: 'C' }, ...parts()), opts)
  assert.deepEqual(plain.drc.filter(d => d.rule === 'clearance'), [])
  const b = compileBoard(h(PCB, { name: 'C', classes: { hv: { clearance: 0.5 } } }, ...parts()), opts)
  const c = b.drc.filter(d => d.rule === 'clearance')
  assert.equal(c.length, 1)
  assert.match(c[0].message, /closer than 0\.5 mm/)
  assert.equal(classClearance(b, 'A', 'B'), 0.5)
  assert.equal(classClearance(b, 'B', 'B'), b.rules.clearance)
  assert.equal(classClearance(b, undefined, 'A'), 0.5)
  // a clearance at or below the rules changes nothing
  const low = compileBoard(h(PCB, { name: 'C', classes: { hv: { clearance: 0.1 } } }, ...parts()), opts)
  assert.deepEqual(low.drc.filter(d => d.rule === 'clearance'), [])
})

test('net classes: a preset and a variant target carry classes under the element', () => {
  const Fab = bindPCB({ name: 'Fab 2-Layer', stackup: twoLayer(), rules: BASE, classes: { power: { width: 0.4, clearance: 0.25 } } })
  assert.deepEqual(Fab.preset.classes, { power: { width: 0.4, clearance: 0.25 } })
  const { P } = nets({ P: { class: 'power' } })
  const kids = () => [edge(), smd('J1', 3, 5, P), smd('J2', 15, 5, P), route('J1.1', 'J2.1')]
  const b = compileBoard(h(Fab, { name: 'C', classes: { power: { width: 0.6 } } }, ...kids()), opts)
  assert.equal(b.classes.power.width, 0.6)
  assert.equal(b.classes.power.clearance, 0.25)
  const V = variants(Fab, { name: 'Wide', board: { classes: { power: { width: 0.8 } } } })
  const [x, y] = compileBoards(h(V, { name: 'C' }, ...kids()), opts)
  assert.equal(x.classes.power.width, 0.4)
  assert.equal(y.classes.power.width, 0.8)
  for (const t of tracks(y, 'P')) assert.equal(t.width, 0.8)
  for (const t of tracks(x, 'P')) assert.equal(t.width, 0.4)
})

test('net classes: a pour keeps the class clearance from other-net copper, and its own where that is larger', async () => {
  const { pour } = await import('@pcbjs/core')
  const { polysToRings, intersection } = await import('@pcbjs/compile/geom')
  const { V5, GND } = nets({ V5: { class: 'power' } })
  const fill = (zoneClearance) => compileBoard(h(PCB, { name: 'Z', classes: { power: { clearance: 0.4 } } }, edge(),
    smd('J1', 5, 5, V5), smd('J2', 15, 5, V5), route('J1.1', 'J2.1', 'Z').width(0.3),
    smd('J3', 10, 8, GND), smd('J4', 18, 8, GND),
    pour(GND, 'F.Cu', 'M0 0 H20 V10 H0 Z', zoneClearance === undefined ? undefined : { clearance: zoneClearance })), opts)
  // the fill covers a point 0.3 mm from the pad edge only when the clearance there is below 0.3
  const covered = (b, x, y) => polysToRings(intersection(polysToRings(b.items.find(i => i.kind === 'zone').fill), [[[x - 0.02, y - 0.02], [x + 0.02, y - 0.02], [x + 0.02, y + 0.02], [x - 0.02, y + 0.02]]])).length > 0
  const b = fill()
  assert.deepEqual(b.drc.filter(d => d.rule === 'clearance' || d.rule === 'short'), [])
  assert.equal(covered(b, 5, 5.5 + 0.3), false, '0.3 mm from the power pad is inside its 0.4 mm class clearance')
  assert.equal(covered(b, 5, 5.5 + 0.5), true)
  // a GND pad has no class: the pour around a GND pad is not touched, and a larger zone clearance still wins
  const wide = fill(0.6)
  assert.equal(covered(wide, 5, 5.5 + 0.5), false)
  assert.deepEqual(wide.drc.filter(d => d.rule === 'clearance'), [])
})
