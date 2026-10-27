import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets, pour, defineFootprint, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { itemClearance } from '@pcbjs/compile/netclass'
import { polysToRings, intersection } from '../../compile/dist/geom.js'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = (w = 20, hh = 10) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const R = { clearance: 0.2, edgeClearance: 0.4, holeClearance: 0.3 }
const errs = (b, rule) => b.drc.filter(d => d.rule === rule)
/** two 1 mm pads of nets A and B whose edges are `gap` apart, with props per pad */
const Two = defineFootprint(({ p1 = {}, p2 = {}, ...props }) => h('footprint', props,
  h('pad', { num: 1, at: '0 0', size: 1, shape: 'rect', ...p1 }), h('pad', { num: 2, at: `${1 + 0.15} 0`, size: 1, shape: 'rect', ...p2 })), { pins: ['1', '2'], prefix: 'U' })
const board = (...kids) => compileBoard(h(PCB, { name: 'O', rules: R }, edge(), ...kids), opts)

test('overrides: a pad clearance is the clearance of every pair the pad is in, as KiCad resolves it', () => {
  const { A, B } = nets()
  const plain = board(h(Two(undefined).connect(A, B), { at: '5 5' }))
  assert.equal(errs(plain, 'clearance').length, 1)
  const one = board(h(Two({}).connect(A, B), { at: '5 5', p1: { clearance: 0.1 } }))
  assert.deepEqual(errs(one, 'clearance'), [], 'one override holds over the rules of the other pad')
  const both = board(h(Two({}).connect(A, B), { at: '5 5', p1: { clearance: 0.1 }, p2: { clearance: '0.12mm' } }))
  assert.deepEqual(errs(both, 'clearance'), [])
  const pad = both.items.find(i => i.kind === 'pad' && i.num === '2')
  assert.equal(pad.clearance, 0.12)
  assert.deepEqual(pad.override, { clearance: 'pad' })
})

test('overrides: a pad clearance above the rules is a finding that names it', () => {
  const { A, B } = nets()
  const Wide = defineFootprint(props => h('footprint', props, h('pad', { num: 1, at: '0 0', size: 1, clearance: 0.5 }), h('pad', { num: 2, at: '1.3 0', size: 1 })), { pins: ['1', '2'], prefix: 'U' })
  const b = board(h(Wide().connect(A, B), { at: '5 5' }))
  const e = errs(b, 'clearance')
  assert.equal(e.length, 1)
  assert.match(e[0].message, /closer than 0\.5 mm \(pad override of U1\.1\)/)
})

test('overrides: part rules apply to every pad, the placement over .rules(), the pad over both', () => {
  const { A, B } = nets()
  const U = Two({}).connect(A, B).rules({ clearance: 0.1 })
  assert.deepEqual(errs(board(h(U, { at: '5 5' })), 'clearance'), [])
  const V = Two({}).connect(A, B).rules({ clearance: 0.1 })
  const placed = board(h(V, { at: '5 5', rules: { clearance: 0.25 } }))
  assert.match(errs(placed, 'clearance')[0].message, /closer than 0\.25 mm \(part override of U1\)/)
  const W = Two({}).connect(A, B).rules({ clearance: 0.3 })
  const padWins = board(h(W, { at: '5 5', p1: { clearance: 0.1 }, p2: { clearance: 0.1 } }))
  assert.deepEqual(errs(padWins, 'clearance'), [])
  assert.deepEqual(padWins.items.find(i => i.kind === 'pad' && i.num === '1').override, { clearance: 'pad' })
  assert.throws(() => Two({}).rules({ clearence: 0.1 }), /unknown rule "clearence"; it takes clearance, edgeClearance, holeClearance, trackWidth/)
  assert.throws(() => Two({}).rules({ clearance: -1 }), /clearance must be a non-negative length/)
})

test('overrides: precedence pad, part, class, board', () => {
  const { A, B } = nets({ A: { class: 'tight' }, B: { class: 'tight' } })
  const mk = (...kids) => compileBoard(h(PCB, { name: 'O', rules: R, classes: { tight: { clearance: 0.1 } } }, edge(), ...kids), opts)
  // the class lowers both nets below the rules
  assert.deepEqual(errs(mk(h(Two({}).connect(A, B), { at: '5 5' })), 'clearance'), [])
  // the part raises its pads over the class
  const part = mk(h(Two({}).connect(A, B).rules({ clearance: 0.2 }), { at: '5 5' }))
  assert.match(errs(part, 'clearance')[0].message, /\(part override of U1\)/)
  // a pad lowers itself under its part, and the other pad still holds its part's
  const pad = mk(h(Two({}).connect(A, B).rules({ clearance: 0.2 }), { at: '5 5', p1: { clearance: 0.1 } }))
  assert.equal(errs(pad, 'clearance').length, 1)
  const [p1, p2] = ['1', '2'].map(n => pad.items.find(i => i.kind === 'pad' && i.num === n))
  assert.equal(itemClearance(pad, p1, p2), 0.2)
})

test('overrides: net.rules defines an anonymous class of that net', () => {
  const { A, B, C } = nets({ C: { class: 'power' } })
  A.rules({ clearance: 0.1 })
  assert.equal(B.rules({ clearance: 0.1 }), B)
  C.rules({ clearance: 0.4 })
  const b = compileBoard(h(PCB, { name: 'O', rules: R, classes: { power: { width: 0.5 } } }, edge(), h(Two({}).connect(A, B), { at: '5 5' }),
    h('footprint', { ref: 'J9', at: '15 5', nets: { 1: C } }, h('pad', { num: 1, size: 1 }))), opts)
  assert.deepEqual(errs(b, 'clearance'), [])
  assert.equal(b.classes['net:A'].clearance, 0.1)
  assert.equal(b.classes['net:C'].width, 0.5, 'merged over its own class')
  assert.equal(b.schematic.nets.find(n => n.name === 'C').class, 'net:C')
  assert.throws(() => A.rules({ width: 1 }), /unknown rule "width"/)
})

test('overrides: part edgeClearance and pad holeClearance', () => {
  const { A } = nets()
  const Edge = defineFootprint(props => h('footprint', props, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'J' })
  // the pad's edge is 0.3 mm from the outline
  const near = (rules) => board(h(Edge().connect(A), { at: '0.8 5', ...(rules ? { rules } : {}) }))
  assert.equal(errs(near(), 'edge-clearance').length, 1)
  assert.deepEqual(errs(near({ edgeClearance: 0.26 }), 'edge-clearance'), [])
  assert.match(errs(near({ edgeClearance: 0.35 }), 'edge-clearance')[0].message, /closer than 0\.35 mm .*\(part override of J1\)/)
  // an unplated hole 0.2 mm from a pad of its own footprint
  const Usb = defineFootprint(({ hc, ...props }) => h('footprint', props, h('pad', { num: 1, at: '0 0', size: 1 }), h('pad', { num: '', type: 'npth', at: '0.9 0', size: 0.4, drill: 0.4, ...(hc ? { holeClearance: hc } : {}) })), { pins: ['1'], prefix: 'J' })
  assert.equal(errs(board(h(Usb().connect(A), { at: '5 5' })), 'hole-to-copper').length, 1)
  const part = board(h(Usb().connect(A).rules({ holeClearance: 0.17 }), { at: '5 5' }))
  assert.deepEqual(errs(part, 'hole-to-copper'), [])
  const pad = board(h(Usb().connect(A), { at: '5 5', hc: 0.17 }))
  assert.equal(errs(pad, 'hole-to-copper').length, 1, 'the pad copper still asks the rules\' 0.3')
})

test('overrides: part trackWidth lets a narrow track join its pads', () => {
  const { A } = nets()
  const P = defineFootprint(props => h('footprint', props, h('pad', { num: 1, size: 0.5 })), { pins: ['1'], prefix: 'J' })
  const mk = (r) => compileBoard(h(PCB, { name: 'O', rules: { ...R, minTrackWidth: 0.15 } }, edge(),
    h(r ? P().connect(A).rules(r) : P().connect(A), { at: '3 5' }), h(P().connect(A), { at: '10 5' }),
    route('J1.1', 'J2.1', 'XZ').width(0.1)), opts)
  assert.equal(errs(mk(), 'track-width').length, 1)
  assert.deepEqual(errs(mk({ trackWidth: 0.1 }), 'track-width'), [])
})

test('overrides: the router and the zone fill keep a pad clearance', () => {
  const { A, B } = nets()
  const P = defineFootprint(props => h('footprint', props, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'J' })
  const Big = defineFootprint(props => h('footprint', props, h('pad', { num: 1, size: [1, 4], shape: 'rect', clearance: 1 })), { pins: ['1'], prefix: 'K' })
  const b = compileBoard(h(PCB, { name: 'O', rules: R }, edge(30, 10), h(P().connect(A), { at: '3 5' }), h(P().connect(A), { at: '27 5' }),
    h(Big().connect(B), { at: '15 5' }), h(P().connect(B), { at: '15 9' }), route('J1.1', 'J2.1')), opts)
  assert.deepEqual(errs(b, 'clearance'), [])
  assert.equal(b.unconnected, 1, 'only B is open')
  const big = b.items.find(i => i.kind === 'pad' && i.ref === 'K1')
  for (const t of b.items.filter(i => i.kind === 'track' && i.net === 'A'))
    for (const [x, y] of t.pts) assert.ok(Math.abs(x - 15) > 0.5 + 1 + t.width / 2 - 1e-6 || Math.abs(y - 5) > 2 + 1 + t.width / 2 - 1e-6, `track point ${x} ${y} keeps 1 mm from the pad`)
  // a pour of A around the pad keeps 1 mm
  const z = compileBoard(h(PCB, { name: 'O', rules: R }, edge(30, 10), h(Big().connect(B), { at: '15 5' }), h(P().connect(B), { at: '15 9' }), pour(A, 'F.Cu', 'M0 0 H30 V10 H0 Z', { islands: 'keep' })), opts)
  const fill = polysToRings(z.items.find(i => i.kind === 'zone').fill)
  const probe = (x, y) => polysToRings(intersection(fill, [[[x - 0.01, y - 0.01], [x + 0.01, y - 0.01], [x + 0.01, y + 0.01], [x - 0.01, y + 0.01]]])).length > 0
  assert.ok(!probe(15.5 + 0.9, 5), 'no fill within 1 mm of the pad')
  assert.ok(probe(15.5 + 1.2, 5), 'fill beyond it')
  void big
})
