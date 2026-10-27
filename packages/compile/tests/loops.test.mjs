import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { netLoops } from '../dist/loops.js'
import { clearRouteCache } from '../dist/route-cache.js'

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const board = (props, ...children) => h(PCB, { name: 'Loops', ...props }, edge(), ...children)
const opts = { routeCache: false }
const tracks = (b, id) => b.items.filter(i => i.kind === 'track' && (id === undefined || i.route === id))
const rule = (b, r) => b.drc.filter(d => d.rule === r)
const same = (p, q, tol = 1e-6) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol
const ends = ts => [ts[0].pts[0], ts[ts.length - 1].pts[ts[ts.length - 1].pts.length - 1]]
const length = ts => ts.reduce((s, t) => s + t.pts.reduce((l, q, i) => (i ? l + Math.hypot(q[0] - t.pts[i - 1][0], q[1] - t.pts[i - 1][1]) : l), 0), 0)
/** Distance from p to the centre line of a track. */
const toTrack = (p, t) => Math.min(...t.pts.slice(1).map((b, i) => {
  const a = t.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
  const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(a[0] + s * dx - p[0], a[1] + s * dy - p[1])
}))

test('join: a leg to a pad that already has a track joins that track, a Y and no diamond', () => {
  // the owner's case: the resistor's leg crossed the hand route from the same connector pad to the IC
  const b = compileBoard(board({},
    smd('J1', 25, 8, 'DP'), smd('U1', 4, 15, 'DP'), smd('R1', 8, 4, 'DP'),
    route('J1.1', 'U1.1', 'H 22 L 13 10 Z').width(0.25),
    route('R1.1', 'J1.1').width(0.25).layers(['F.Cu']),
  ), opts)
  assert.deepEqual(rule(b, 'net-loop'), [])
  assert.deepEqual(b.drc.filter(d => d.severity === 'error'), [])
  const leg = tracks(b, 'route:2'), [a, z] = ends(leg)
  assert.ok(same(a, [8, 4]), 'the leg leaves its own pad')
  assert.ok(!same(z, [25, 8]), 'and does not run on to the connector pad')
  assert.ok(Math.min(...tracks(b, 'route:1').map(t => toTrack(z, t))) < 1e-6, 'it ends on the centre line of the hand route')
  assert.ok(length(leg) < Math.hypot(17, 4), 'shorter than the way to the pad')
})

test('join: the leg meets the trunk at its cheapest point', () => {
  const b = compileBoard(board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'),
    route('A.1', 'B.1', 'Z').width(0.3),
    route('C.1', 'A.1').width(0.3).layers(['F.Cu']),
  ), opts)
  const leg = tracks(b, 'route:2'), [, z] = ends(leg)
  assert.ok(Math.abs(z[0] - 15) < 0.2 && Math.abs(z[1] - 12) < 1e-6, `straight down onto the trunk, ended at ${z}`)
  assert.ok(Math.abs(length(leg) - 8) < 0.2)
  assert.deepEqual(rule(b, 'net-loop'), [])
})

test('join: legs of one net route widest first, so the thin one joins the wide one', () => {
  const b = compileBoard(board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'),
    route('C.1', 'B.1').width(0.2).layers(['F.Cu']),
    route('A.1', 'B.1').width(0.5).layers(['F.Cu']),
  ), opts)
  const wide = tracks(b, 'route:2'), thin = tracks(b, 'route:1')
  assert.ok(wide.every(t => t.width === 0.5))
  assert.deepEqual(ends(wide).map(p => p.map(Math.round)), [[5, 12], [25, 12]], 'the wide leg runs pad to pad')
  assert.ok(!same(ends(thin)[1], [25, 12]), 'the thin leg joins the wide one')
  assert.ok(Math.min(...wide.map(t => toTrack(ends(thin)[1], t))) < 0.3)
})

test('join: a wider leg widens the trunk it joins from its pad to the junction', () => {
  const b = compileBoard(board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'),
    route('A.1', 'B.1', 'Z').width(0.2),
    route('C.1', 'B.1').width(0.5).layers(['F.Cu']),
  ), opts)
  const own = tracks(b, 'route:2'), [, z] = ends(own.filter(t => t.pts.some(p => p[1] < 11)))
  assert.ok(!same(z, [25, 12]), 'the wide leg joins the trunk')
  const strip = own.find(t => t.pts.every(p => Math.abs(p[1] - 12) < 1e-6))
  assert.ok(strip, 'a 0.5 mm strip lies on the trunk')
  assert.equal(strip.width, 0.5)
  const xs = strip.pts.map(p => p[0]).sort((x, y) => x - y)
  assert.ok(Math.abs(xs[1] - 25) < 1e-6 && Math.abs(xs[0] - z[0]) < 1e-6, `from the junction to B, got ${xs}`)
  assert.deepEqual(b.drc.filter(d => d.severity !== 'info'), [])
  assert.deepEqual(rule(b, 'trunk-narrow'), [])
})

test('join: a trunk with no room to widen sends the leg to its pad, with the info finding trunk-narrow', () => {
  // other-net pads 0.35 mm off each side of a 0.2 mm trunk: 0.15 mm of clearance, too little for 0.5 mm
  const b = compileBoard(board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'),
    smd('X1', 20, 12.85, 'X', 1), smd('X2', 20, 11.15, 'Y', 1),
    route('A.1', 'B.1', 'Z').width(0.2),
    route('C.1', 'B.1').width(0.5).layers(['F.Cu']),
  ), opts)
  const [f] = rule(b, 'trunk-narrow')
  assert.ok(f, 'trunk-narrow is reported')
  assert.equal(f.severity, 'info')
  assert.equal(f.routeId, 'route:2')
  assert.match(f.message, /route:2 runs to pad B\.1 instead of joining the copper of net N there: widening that copper to 0\.5 mm would break clearance/)
  assert.ok(same(ends(tracks(b, 'route:2'))[1], [25, 12]), 'the leg reaches B itself')
  assert.deepEqual(b.drc.filter(d => d.severity === 'error'), [])
})

test('direct: .direct() reaches the pad and never joins the copper on the way', () => {
  const parts = [smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'), route('A.1', 'B.1', 'Z').width(0.3)]
  const b = compileBoard(board({}, ...parts, route('C.1', 'A.1').width(0.3).layers(['F.Cu']).direct()), opts)
  const leg = tracks(b, 'route:2')
  assert.deepEqual(ends(leg).map(p => p.map(v => Math.round(v * 1e6) / 1e6)), [[15, 4], [5, 12]])
  // it keeps the clearance from the trunk until the pad
  const trunk = tracks(b, 'route:1')[0]
  for (const t of leg) for (const p of t.pts) if (Math.hypot(p[0] - 5, p[1] - 12) > 1) assert.ok(toTrack(p, trunk) > 0.3, `${p} stays off the trunk`)
  assert.deepEqual(rule(b, 'net-loop'), [])
})

test('fence: copper of the net that joins neither end is an obstacle, so the leg cannot loop through it', () => {
  // an island of N across the straight line from A to B
  const b = compileBoard(board({},
    smd('A', 5, 10, 'N'), smd('B', 25, 10, 'N'), smd('D', 15, 6, 'N'), smd('E', 15, 14, 'N'),
    route('D.1', 'E.1', 'Z').width(0.3),
    route('A.1', 'B.1').width(0.3).layers(['F.Cu']),
  ), opts)
  const island = tracks(b, 'route:1')[0], leg = tracks(b, 'route:2')
  for (const t of leg) for (const p of t.pts) assert.ok(toTrack(p, island) > 0.3 || Math.hypot(p[0] - 5, p[1] - 10) < 1e-6 || Math.hypot(p[0] - 25, p[1] - 10) < 1e-6)
  assert.ok(leg.every(t => t.pts.every(p => p[1] < 5.6 || p[1] > 14.4 || p[0] < 14 || p[0] > 16)), 'it goes round the island')
  assert.deepEqual(rule(b, 'net-loop'), [])
})

test('join: a leg whose ends the net already joins places nothing', () => {
  const b = compileBoard(board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'),
    route('A.1', 'B.1').width(0.3), route('B.1', 'C.1').width(0.3), route('C.1', 'A.1').width(0.3),
  ), opts)
  assert.equal(tracks(b, 'route:3').length, 0)
  assert.equal(b.routing.routed, 3)
  assert.deepEqual(rule(b, 'net-loop'), [])
  assert.equal(b.unconnected, 0)
})

test('net-loop: a hand-routed cycle is a warning naming the net, its segments and the source, unless .loop() or loops: true says so', () => {
  const src = { file: 'main.tsx', line: 7, col: 5, endLine: 7, endCol: 30 }
  const ring = loop => [
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'),
    route('A.1', 'B.1', 'Z', { __src: src }).width(0.3), route('B.1', 'C.1', 'Z').width(0.3), loop(route('C.1', 'A.1', 'Z').width(0.3)),
  ]
  const b = compileBoard(board({}, ...ring(r => r)), opts)
  const [f] = rule(b, 'net-loop')
  assert.equal(rule(b, 'net-loop').length, 1)
  assert.equal(f.severity, 'warning')
  assert.equal(f.net, 'N')
  assert.equal(f.layer, 'F.Cu')
  assert.deepEqual(f.src, src)
  assert.match(f.message, /net N forms a loop on F\.Cu through .*track route:1.*track route:2.*track route:3/)
  assert.equal(f.items.length, 6, 'three pads and three tracks')
  assert.deepEqual(rule(compileBoard(board({}, ...ring(r => r.loop())), opts), 'net-loop'), [], '.loop() on one route')
  const { N } = nets({ N: { class: 'ring' } })
  const tagged = [smd('A', 5, 12, N), smd('B', 25, 12, N), smd('C', 15, 4, N), route('A.1', 'B.1', 'Z').width(0.3), route('B.1', 'C.1', 'Z').width(0.3), route('C.1', 'A.1', 'Z').width(0.3)]
  assert.deepEqual(rule(compileBoard(board({ classes: { ring: { loops: true } } }, ...tagged), opts), 'net-loop'), [], 'loops: true in the class')
})

test('net-loop: two paths between the same pads on two layers are a loop through vias', () => {
  const b = compileBoard(board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'),
    route('A.1', 'B.1', 'Z').width(0.3),
    route('A.1', 'B.1', 'V 16 @B.Cu H 25 @F.Cu Z').width(0.3),
  ), opts)
  const loops = rule(b, 'net-loop')
  assert.equal(loops.length, 1)
  assert.equal(netLoops(b).length, 1)
})

test('net-loop: a pin strap whose loop lies in one part\'s courtyard is not reported, one that leaves it is', () => {
  const part = (...pads) => h('footprint', { ref: 'U1', at: [15, 10], nets: { 1: 'N', 2: 'N' } },
    h('rect', { layer: 'F.CrtYd', x: -4, y: -3, w: 8, h: 6, width: 0.05 }), ...pads)
  const pads = [h('pad', { num: 1, at: [-1, 0], size: 0.6, type: 'smd' }), h('pad', { num: 2, at: [1, 0], size: 0.6, type: 'smd' })]
  const strap = (low, via = false) => compileBoard(board({}, part(...pads),
    route('U1.1', 'U1.2', 'V 9 H 16 Z').width(0.2), route('U1.1', 'U1.2', via ? `V ${low} @B.Cu H 16 @F.Cu Z` : `V ${low} H 16 Z`).width(0.2)), opts)
  for (const via of [false, true]) {
    assert.equal(netLoops(strap(11, via)).length, 1)
    assert.deepEqual(rule(strap(11, via), 'net-loop'), [], 'inside the courtyard')
    assert.equal(rule(strap(14, via), 'net-loop').length, 1, 'out of the courtyard')
  }
})

test('join: a warm compile places every joining leg from the cache and gives the same copper', () => {
  clearRouteCache()
  const make = () => board({},
    smd('A', 5, 12, 'N'), smd('B', 25, 12, 'N'), smd('C', 15, 4, 'N'), smd('D', 20, 17, 'N'),
    route('A.1', 'B.1', 'Z').width(0.2),
    route('C.1', 'B.1').width(0.4).layers(['F.Cu']), route('D.1', 'A.1').width(0.25).layers(['F.Cu']),
  )
  const cold = compileBoard(make(), { routeCache: { dir: null } })
  const warm = compileBoard(make(), { routeCache: { dir: null } })
  assert.equal(warm.routing.cached, warm.routing.legs)
  assert.deepEqual(warm.items, cold.items)
  clearRouteCache()
})
