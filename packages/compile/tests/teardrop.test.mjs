// Teardrops: copper of the track's net where it leaves a pad, drawn after routing; they join the net, the pours clear around
// them, they never make a clearance finding of their own, and the board, a class and a route turn them on and off.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, route, pour, nets, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { intersection, offset, overlaps, pointInRing, polysToRings } from '../dist/geom.js'
import { near } from './helpers.mjs'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 10 })
const tht = (ref, x, y, net) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size: 1.7, drill: 1, type: 'tht' }))
const smd = (ref, x, y, net) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size: [1.2, 1.2], type: 'smd' }))
const board = (props, ...kids) => compileBoard(h(PCB, { name: 'T', silkRefs: false, ...props }, edge(), ...kids), opts)
const drops = b => b.items.filter(i => i.kind === 'graphic' && i.teardrop)
const at = (b, x, y) => drops(b).some(g => pointInRing([x, y], g.paths[0]))

test('teardrops: off by default, a straight teardrop at each end of a track on THT pads', () => {
  const kids = [tht('J1', 5, 5, 'A'), tht('J2', 25, 5, 'A'), route('J1.1', 'J2.1', 'Z').width(0.3)]
  assert.equal(drops(board({}, ...kids)).length, 0)
  const b = board({ teardrops: { pads: 'tht' } }, ...kids)
  const td = drops(b)
  assert.equal(td.length, 2)
  const track = b.items.find(i => i.kind === 'track')
  for (const g of td) {
    assert.equal(g.net, 'A')
    assert.equal(g.layer, 'F.Cu')
    assert.ok(g.fill && g.closed[0])
    assert.equal(g.teardrop.track, track.id)
  }
  // 0.5 of the 1.7 mm pad past its edge, 0.9 of it wide through the centre: beside the track just off the pad is copper
  assert.ok(at(b, 6.0, 5.35) && at(b, 24.0, 4.65), 'the flanks')
  assert.ok(!at(b, 6.8, 5) && !at(b, 6.0, 5.5), 'no further than 0.85 mm past the edge, no wider than the flank')
  const xs = td.flatMap(g => g.paths[0].map(p => p[0]))
  near(Math.min(...xs.filter(x => x < 15)), 5, 1e-6)
  near(Math.max(...xs.filter(x => x < 15)), 6.7, 1e-6)
  assert.equal(b.unconnected, 0)
  assert.deepEqual(
    b.drc.filter(d => d.severity !== 'info'),
    [],
  )
})

test('teardrops: pads filters by pad type, sizes take fractions or lengths, and bad specs throw', () => {
  const kids = [tht('J1', 5, 5, 'A'), smd('J2', 25, 5, 'A'), route('J1.1', 'J2.1', 'Z').width(0.3)]
  const only = (pads, b = board({ teardrops: { pads } }, ...kids)) => drops(b).map(g => b.items.find(i => i.id === g.teardrop.pad).type)
  assert.deepEqual(only('tht'), ['tht'])
  assert.deepEqual(only('smd'), ['smd'])
  assert.deepEqual(only('all').sort(), ['smd', 'tht'])
  assert.deepEqual(only(undefined, board({ teardrops: true }, ...kids)).sort(), ['smd', 'tht'])
  const b = board({ teardrops: { pads: 'tht', length: '0.4mm' } }, ...kids)
  near(Math.max(...drops(b)[0].paths[0].map(p => p[0])), 5.85 + 0.4, 1e-6)
  assert.throws(() => board({ teardrops: { pads: 'via' } }, ...kids), /teardrops pads must be 'tht', 'smd' or 'all'/)
  assert.throws(() => board({ teardrops: { length: -1 } }, ...kids), /teardrops length must be/)
  assert.throws(() => board({ teardrops: { size: 1 } }, ...kids), /unknown field "size"/)
})

test('teardrops: a class turns them on for its nets, a route turns them off', () => {
  const { P } = nets({ P: { class: 'wire' } })
  const kids = r1 => [tht('J1', 5, 3, P), tht('J2', 25, 3, P), tht('J3', 5, 7, 'B'), tht('J4', 25, 7, 'B'), r1, route('J3.1', 'J4.1', 'Z').width(0.3)]
  const b = board({ classes: { wire: { teardrops: true } } }, ...kids(route('J1.1', 'J2.1', 'Z').width(0.3)))
  assert.deepEqual([...new Set(drops(b).map(g => g.net))], ['P'])
  const off = board({ teardrops: true, classes: { wire: { teardrops: false } } }, ...kids(route('J1.1', 'J2.1', 'Z').width(0.3)))
  assert.deepEqual([...new Set(drops(off).map(g => g.net))], ['B'])
  const route1 = board({ teardrops: true }, ...kids(route('J1.1', 'J2.1', 'Z').width(0.3).teardrops(false)))
  assert.deepEqual([...new Set(drops(route1).map(g => g.net))], ['B'])
  const narrow = board({ classes: { wire: { teardrops: { length: 0.2 } } } }, ...kids(route('J1.1', 'J2.1', 'Z').width(0.3)))
  near(
    Math.max(
      ...drops(narrow)
        .flatMap(g => g.paths[0].map(p => p[0]))
        .filter(x => x < 15),
    ),
    5.85 + 0.34,
    1e-6,
  )
  assert.throws(() => route('J1.1', 'J2.1').teardrops('yes'), /teardrops must be true, false or/)
})

test('teardrops: one that would come too close to other copper shrinks, else drops with an info finding, never a clearance error', () => {
  // a pad of another net just beside the joint
  const near1 = h('footprint', { ref: 'J9', at: [6.25, 5.72], nets: { 1: 'B' } }, h('pad', { num: 1, shape: 'rect', size: [0.4, 0.4], type: 'smd' }))
  const kids = [tht('J1', 5, 5, 'A'), tht('J2', 25, 5, 'A'), route('J1.1', 'J2.1', 'Z').width(0.3), near1]
  const b = board({ teardrops: { pads: 'tht' } }, ...kids)
  assert.deepEqual(
    b.drc.filter(d => d.rule === 'clearance' || d.rule === 'short'),
    [],
  )
  const pad = b.items.find(i => i.kind === 'pad' && i.ref === 'J9')
  // the one at J1 shrinks to 75%: 0.6375 mm past the pad edge
  near(
    Math.max(
      ...drops(b)
        .flatMap(g => g.paths[0].map(p => p[0]))
        .filter(x => x < 15),
    ),
    5.85 + 0.6375,
    1e-6,
  )
  assert.equal(drops(b).length, 2)
  for (const g of drops(b)) assert.ok(!overlaps(polysToRings(offset(g.paths, b.rules.clearance - 0.001)), [pad.poly]), 'keeps the clearance')
  // closer still: no size fits, the teardrop at J1 is dropped and said so
  const touching = h('footprint', { ref: 'J9', at: [6.25, 5.52], nets: { 1: 'B' } }, h('pad', { num: 1, shape: 'rect', size: [0.4, 0.4], type: 'smd' }))
  const c = board({ teardrops: { pads: 'tht' } }, tht('J1', 5, 5, 'A'), tht('J2', 25, 5, 'A'), route('J1.1', 'J2.1', 'Z').width(0.3), touching)
  const dropped = c.drc.filter(d => d.rule === 'teardrop-dropped')
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].severity, 'info')
  assert.match(dropped[0].message, /no teardrop where track A leaves pad J1\.1 on F\.Cu: even at 50% it would meet pad J9\.1 \(B\), closer than 0\.\d+ mm/)
  assert.equal(drops(c).length, 1, 'the other end keeps its own')
  assert.deepEqual(
    c.drc.filter(d => d.severity === 'error'),
    [],
    'J9 itself keeps its clearance to the pad and the track',
  )
})

test('teardrops: a pour of another net clears around them, a pour of their net takes them in', () => {
  const kids = [tht('J1', 5, 5, 'A'), tht('J2', 25, 5, 'A'), route('J1.1', 'J2.1', 'Z').width(0.3)]
  const b = board({ teardrops: { pads: 'tht' } }, ...kids, pour('GND', 'F.Cu', 'M0 0 H30 V10 H0 Z'))
  const zone = b.items.find(i => i.kind === 'zone')
  for (const g of drops(b)) assert.equal(polysToRings(intersection(polysToRings(offset(g.paths, b.rules.clearance - 0.001)), polysToRings(zone.fill))).length, 0)
  assert.deepEqual(
    b.drc.filter(d => d.severity === 'error'),
    [],
  )
})
