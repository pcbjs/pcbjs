// Rounded corners end to end: .corner() and the class corner, pairs rounded by default with concentric arcs, single routes
// square unless asked, the fallback where an arc would meet other copper, the shape check on a pair with a via pair and on
// examples/usb-hub, and the arcs in the board's tracks.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { routesCopper } from '@pcbjs/compile/pair-info'
import { boardShapeIssues } from '@pcbjs/compile/route-shape'
import { arcRadius } from '@pcbjs/compile/round'
import { near } from './helpers.mjs'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const two = (ref, x, y, a, b) =>
  h(
    'footprint',
    { ref, at: [x, y], nets: { 1: a, 2: b } },
    h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }),
    h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' }),
  )
const arcsOf = b => b.items.filter(i => i.kind === 'track').flatMap(t => (t.prims ?? []).filter(p => p.kind === 'arc').map(p => ({ ...p, t })))
const clean = b => {
  assert.deepEqual(
    b.drc.filter(d => d.rule !== 'single-pad').map(d => `${d.rule}: ${d.message}`),
    [],
  )
  assert.equal(b.unconnected, 0)
}

test('builder: .corner() takes a radius or none; a bad one is a TypeError, a bad class corner a compile error', () => {
  assert.equal(route('A.1', 'B.1').corner(0.5).props.corner, 0.5)
  assert.equal(route('A.1', 'B.1').corner('20mil').props.corner, '20mil')
  assert.equal(route(['A.1', 'A.2'], ['B.1', 'B.2']).corner('none').props.corner, 'none')
  assert.throws(() => route('A.1', 'B.1').corner({ r: 1 }), { name: 'TypeError', message: /radius or 'none'/ })
  assert.throws(() => compileBoard(h(PCB, { name: 'C', classes: { x: { corner: { radius: -1 } } } }, edge()), opts), /corner radius must be a positive length or 'none'/)
  assert.throws(() => compileBoard(h(PCB, { name: 'C', classes: { x: { corner: { r: 1 } } } }, edge()), opts), /corner has an unknown field "r"/)
})

test('single routes: square by default; .corner(r) rounds the corners between manual commands, shorter by (2 - pi / 2) r each', () => {
  const kids = c => [smd('A', 5, 5, 'X'), smd('B', 25, 15, 'X'), c(route('A.1', 'B.1', 'H 15 V 15 Z').width(0.25))]
  const sq = compileBoard(h(PCB, { name: 'S' }, edge(), ...kids(r => r)), opts)
  assert.equal(arcsOf(sq).length, 0)
  const rd = compileBoard(h(PCB, { name: 'S' }, edge(), ...kids(r => r.corner(1))), opts)
  const a = arcsOf(rd)
  assert.equal(a.length, 2)
  for (const p of a) near(arcRadius(p), 1, 1e-6)
  near(routesCopper(sq).get('route:1').length - routesCopper(rd).get('route:1').length, 2 * (2 - Math.PI / 2), 1e-5)
  clean(rd)
  // the class corner applies to its routes, and .corner('none') turns it off
  const { X } = nets({ X: { class: 'r' } })
  const cl = compileBoard(
    h(PCB, { name: 'S', classes: { r: { corner: { radius: 0.5 } } } }, edge(), smd('A', 5, 5, X), smd('B', 25, 15, X), route('A.1', 'B.1', 'H 15 V 15 Z').width(0.25)),
    opts,
  )
  assert.equal(arcsOf(cl).length, 2)
  const off = compileBoard(
    h(
      PCB,
      { name: 'S', classes: { r: { corner: { radius: 0.5 } } } },
      edge(),
      smd('A', 5, 5, X),
      smd('B', 25, 15, X),
      route('A.1', 'B.1', 'H 15 V 15 Z').width(0.25).corner('none'),
    ),
    opts,
  )
  assert.equal(arcsOf(off).length, 0)
})

test('single routes: an arc that would meet a pad on the inside of the corner shrinks, then chamfers; the copper never moves onto it', () => {
  // a pad of another net just inside the corner at (15, 5): a 2 mm arc would cut across it
  const b = compileBoard(
    h(PCB, { name: 'S' }, edge(), smd('A', 5, 5, 'X'), smd('B', 25, 15, 'X'), smd('C', 14.2, 5.8, 'Y', 0.4), route('A.1', 'B.1', 'H 15 V 15 Z').width(0.25).corner(2)),
    opts,
  )
  const a = arcsOf(b),
    first = a.find(p => p.center[0] < 15 && p.center[1] < 10),
    second = a.find(p => p !== first)
  assert.ok(first && arcRadius(first) < 2 - 1e-6 && arcRadius(first) >= 0.25 - 1e-9, a.map(arcRadius).join(' '))
  near(arcRadius(second), 2, 1e-6)
  assert.deepEqual(
    b.drc.filter(d => d.rule === 'clearance'),
    [],
  )
})

test('pairs: every corner drawn by hand is rounded on the centre line by the pitch, both tracks concentric; .corner("none") keeps them square', () => {
  const kids = c => [
    two('J1', 5, 3, 'DP', 'DN'),
    h(
      'footprint',
      { ref: 'J2', at: '25 15 90deg', nets: { 1: 'DP', 2: 'DN' } },
      h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }),
      h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' }),
    ),
    c(route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 15 Z').width(0.2).gap(0.2)),
  ]
  const b = compileBoard(h(PCB, { name: 'P' }, edge(), ...kids(r => r)), opts)
  // the corner: an arc on each track about one centre, the pitch of 0.4 less and more the half pitch
  const a = arcsOf(b),
    outer = a.find(p => Math.abs(arcRadius(p) - 0.6) < 1e-6),
    inner = a.find(p => Math.abs(arcRadius(p) - 0.2) < 1e-6 && p.t.net !== outer.t.net)
  assert.ok(outer && inner)
  near(Math.hypot(outer.center[0] - inner.center[0], outer.center[1] - inner.center[1]), 0, 1e-6)
  // a single right angle leaves the outer track pi h longer, which a U bump on the inner track takes: four more arcs, none
  // below the track width
  assert.equal(a.length, 6)
  assert.ok(a.every(p => arcRadius(p) >= 0.2 - 1e-9))
  clean(b)
  // square: no arc at the corner, only the bump's that tunes the larger skew of a square bend
  const sq = compileBoard(h(PCB, { name: 'P' }, edge(), ...kids(r => r.corner('none'))), opts)
  assert.ok(arcsOf(sq).every(p => Math.hypot(p.center[0] - outer.center[0], p.center[1] - outer.center[1]) > 1))
  assert.deepEqual(boardShapeIssues(b), [])
})

test('pairs: a via pair in a run with rounded corners is clean copper, each track one polyline per layer run, the vias on them', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'P' },
      edge(),
      two('J1', 5, 3, 'DP', 'DN'),
      two('J2', 25, 17, 'DP', 'DN'),
      route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 6 @B.Cu V 10 H 18 @F.Cu H 25 Z').width(0.2).gap(0.2).vias({ drill: 0.3, size: 0.6 }),
    ),
    opts,
  )
  clean(b)
  assert.deepEqual(boardShapeIssues(b), [])
  const vias = b.items.filter(i => i.kind === 'via')
  assert.equal(vias.length, 4)
  for (const v of vias) {
    const ends = b.items.filter(i => i.kind === 'track' && i.net === v.net).flatMap(t => [t.pts[0], t.pts.at(-1)])
    assert.equal(ends.filter(p => Math.hypot(p[0] - v.at[0], p[1] - v.at[1]) < 1e-6).length, 2, 'two tracks end on each via')
  }
  assert.ok(arcsOf(b).length >= 2)
})

test("examples/usb-hub: DRC clean, and every route's copper is free of overlaps and notches", async () => {
  const R = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const { resolveConfig } = await import('@pcbjs/cli/config')
  const { pluginState } = await import('@pcbjs/cli/plugin')
  const { compileServer, compileSlots } = await import('@pcbjs/cli/check')
  const cfg = await resolveConfig([], 'build', undefined, resolve(R, '../examples/usb-hub'))
  const state = pluginState(cfg)
  const server = await compileServer(cfg, state, {})
  try {
    await compileSlots(server, cfg, state.slots, new Map())
  } finally {
    await server.close()
  }
  const [b] = state.slots.flatMap(s => s.compiled ?? []).map(c => c.board)
  assert.ok(b, 'usb-hub compiles')
  assert.deepEqual(
    b.drc.filter(d => d.severity !== 'info').map(d => `${d.rule}: ${d.message}`),
    [],
  )
  assert.deepEqual(
    boardShapeIssues(b).map(i => `${i.route} ${i.kind}: ${i.message}`),
    [],
  )
  // the hub legs drawn with H and L are rounded, and no pair track carries a trapezoid: every bump corner is an arc or a chamfer
  assert.ok(arcsOf(b).filter(p => p.t.pair).length >= 12)
})
