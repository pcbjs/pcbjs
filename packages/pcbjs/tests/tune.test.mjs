// Length tuning: the .length() and .match() builder, route ids on every item, the tuning pass for single routes, match
// groups and pair skew, its determinism through the route cache, the DRC rules length and length-match, the site routes
// and inspect --lengths.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets, resetDefaults } from '@pcbjs/core'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { routesCopper, pairsOf } from '@pcbjs/compile/pair-info'
import { inspectBoard } from '@pcbjs/cli/inspect'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = (w = 40, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const two = (ref, x, y, a, b, rot = 0) => h('footprint', { ref, at: `${x} ${y} ${rot}deg`, nets: { 1: a, 2: b } },
  h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }), h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' }))
const findings = (b, rule) => b.drc.filter(d => d.rule === rule)
const lengthOf = (b, id) => routesCopper(b).get(id).length
const clean = b => { assert.deepEqual(b.drc.filter(d => d.rule !== 'single-pad').map(d => `${d.rule}: ${d.message}`), []); assert.equal(b.unconnected, 0) }

/** Four lines from left pads to right pads 30 mm apart, the first three straight, the last with a jog. */
const bus = (mod = r => r) => [
  ...[0, 1, 2, 3].flatMap(i => [smd(`A${i}`, 5, 4 + i * 4, `D${i}`), smd(`B${i}`, 35, 4 + i * 4, `D${i}`)]),
  ...[0, 1, 2, 3].map(i => mod(route(`A${i}.1`, `B${i}.1`, i === 3 ? 'H 15 V 18 H 25 V 16 Z' : 'Z').width(0.2), i)),
]

test('builder: .length() takes a number or a range, .match() a group and a tolerance; bad input is a TypeError', () => {
  assert.equal(route('J1.1', 'J2.1').length(42).props.length, 42)
  assert.deepEqual(route('J1.1', 'J2.1').length({ min: 40, max: 42 }).props.length, { min: 40, max: 42 })
  assert.deepEqual(route('J1.1', 'J2.1').length({ target: 40, tolerance: 0.2 }).props.length, { target: 40, tolerance: 0.2 })
  assert.deepEqual(route('J1.1', 'J2.1').match('DQ').props.match, { group: 'DQ' })
  assert.deepEqual(route('J1.1', 'J2.1').match('DQ', 0.05).props.match, { group: 'DQ', tolerance: 0.05 })
  assert.deepEqual(route(['J1.1', 'J1.2'], ['J2.1', 'J2.2']).length(30).match('P').props.match, { group: 'P' })
  assert.throws(() => route('J1.1', 'J2.1').length(-1), { name: 'TypeError', message: /positive length/ })
  assert.throws(() => route('J1.1', 'J2.1').length({ lo: 3 }), { name: 'TypeError', message: /field "lo"/ })
  assert.throws(() => route('J1.1', 'J2.1').length({ tolerance: 3 }), { name: 'TypeError', message: /needs min, max or target/ })
  assert.throws(() => route('J1.1', 'J2.1').length({ target: 3, min: 2 }), { name: 'TypeError', message: /not both/ })
  assert.throws(() => route('J1.1', 'J2.1').match(''), { name: 'TypeError', message: /group name/ })
})

test('route ids: route:<n> in document order on every item of a route, manual and automatic; pairs keep pair:<n>', () => {
  const b = compileBoard(h(PCB, { name: 'Ids' }, edge(), smd('A', 5, 5, 'X'), smd('B', 30, 5, 'X'), smd('C', 5, 15, 'Y'), smd('D', 30, 15, 'Y'),
    two('J1', 10, 9, 'DP', 'DN'), two('J2', 25, 9, 'DN', 'DP', 0),
    route('A.1', 'B.1', 'H 10 @B.Cu H 20 @F.Cu XZ').width(0.2), route('C.1', 'D.1').width(0.2),
    route(['J1.1', 'J1.2'], ['J2.2', 'J2.1'], 'V 11 H 25 Z').width(0.2).gap(0.2)), opts)
  const of = id => b.items.filter(i => (i.kind === 'track' || i.kind === 'via') && i.route === id)
  assert.ok(of('route:1').some(i => i.kind === 'via'), 'manual vias carry it')
  assert.ok(of('route:1').filter(i => i.kind === 'track').length >= 3, 'manual and automatic tracks carry it')
  assert.ok(of('route:2').length >= 1)
  assert.deepEqual([...new Set(of('route:3').map(t => t.pair))], ['pair:1'])
  assert.deepEqual(b.routes.map(r => [r.id, r.net, r.pair]), [['route:1', 'X', undefined], ['route:2', 'Y', undefined], ['route:3', 'DP', 'pair:1']])
  assert.ok(b.items.filter(i => i.kind === 'track').every(t => t.route), 'no route track without an id')
})

test('tune: a route shorter than its target gets a meander and lands inside the range, DRC clean', () => {
  const b = compileBoard(h(PCB, { name: 'Len' }, edge(), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(36)), opts)
  const L = lengthOf(b, 'route:1')
  assert.ok(Math.abs(L - 36) <= 0.1 + 1e-6, `length ${L}`)
  assert.ok(b.routes[0].tuned > 5)
  assert.ok(b.items.find(i => i.kind === 'track').pts.length > 4)
  clean(b)
  // a range: tuned to its middle
  const r = compileBoard(h(PCB, { name: 'Len' }, edge(), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length({ min: 33, max: 34 })), opts)
  assert.ok(Math.abs(lengthOf(r, 'route:1') - 33.5) < 1e-3)
  clean(r)
})

test('tune: the tolerance comes from .length(), else the class, else 0.1; a route inside it is left alone', () => {
  const { X } = nets({ X: { class: 'clk' } })
  const loose = compileBoard(h(PCB, { name: 'Len', classes: { clk: { tolerance: 0.5 } } }, edge(), smd('A', 5, 10, X), smd('B', 35, 10, X), route('A.1', 'B.1', 'Z').width(0.2).length(30.4)), opts)
  assert.equal(loose.routes[0].tuned, undefined)
  assert.deepEqual(loose.routes[0].target, { min: 29.9, max: 30.9 })
  clean(loose)
  // 0.4 mm short is below the smallest U bump, 0.46 mm at the 0.2 mm radius: that one bump overshoots, but stays in the range
  const tight = compileBoard(h(PCB, { name: 'Len' }, edge(), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(30.4)), opts)
  assert.ok(Math.abs(lengthOf(tight, 'route:1') - 30.4) <= 0.1 + 1e-6, `${lengthOf(tight, 'route:1')}`)
  clean(tight)
  // 0.2 mm short, inside a 0.1 mm tolerance, cannot be tuned: the finding says why
  const short = compileBoard(h(PCB, { name: 'Len' }, edge(), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(30.2)), opts)
  assert.match(findings(short, 'length')[0].message, /below the smallest U bump of 0\.46 mm/)
})

test('tune: amplitude and spacing come from tune, board wide or per route, and shape the meander', () => {
  const kids = amp => [smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(40).rules({ tune: { amplitude: amp } })]
  const height = b => { const ys = b.items.find(i => i.kind === 'track').pts.map(p => p[1]); return Math.max(...ys) - Math.min(...ys) }
  const big = compileBoard(h(PCB, { name: 'Len' }, edge(), ...kids(2)), opts), small = compileBoard(h(PCB, { name: 'Len' }, edge(), ...kids(0.8)), opts)
  // U bumps reach the amplitude; at 0.8 mm, twice their radius, the last ones may stay a little lower
  assert.ok(Math.abs(height(big) - 2) < 1e-6 && height(small) <= 0.8 + 1e-6 && height(small) > 0.75, `${height(big)} ${height(small)}`)
  const board = compileBoard(h(PCB, { name: 'Len', autoroute: { tune: { amplitude: 1.5 } } }, edge(), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(40)), opts)
  assert.ok(Math.abs(height(board) - 1.5) < 1e-6)
  assert.throws(() => compileBoard(h(PCB, { name: 'Len', autoroute: { tune: { amplitude: -1 } } }, edge()), opts), /tune.amplitude must be a positive length/)
  assert.throws(() => compileBoard(h(PCB, { name: 'Len', autoroute: { tune: { width: 1 } } }, edge()), opts), /tune has an unknown field "width"/)
})

test('tune: a match group is tuned into the tolerance below its longest route, never past it', () => {
  const b = compileBoard(h(PCB, { name: 'Bus' }, edge(), ...bus(r => r.match('DATA'))), opts)
  const ls = [1, 2, 3, 4].map(i => lengthOf(b, `route:${i}`))
  assert.ok(Math.max(...ls) - Math.min(...ls) <= 0.1 + 1e-6, ls.join(' '))
  assert.ok(ls.every(l => l <= ls[3] + 1e-6), `no route past the longest: ${ls.join(' ')}`)
  assert.equal(b.routes[3].tuned, undefined, 'the longest is left alone')
  assert.ok(b.routes.every(r => r.group === 'DATA' && r.tolerance === 0.1))
  clean(b)
})

test('tune: a member with its own max stays under it; when that is below the window it caps the group and the finding says so', () => {
  // the example of the review: D0 may not pass 31 mm, D1 runs 42 mm; D2 may reach 41.95 mm, inside the window
  const kids = [0, 1, 2].flatMap(i => [smd(`A${i}`, 5, 4 + i * 4, `D${i}`), smd(`B${i}`, 35, 4 + i * 4, `D${i}`)])
  const b = compileBoard(h(PCB, { name: 'Cap' }, edge(40, 20), ...kids,
    route('A0.1', 'B0.1', 'Z').width(0.25).length({ max: 31 }).match('G'),
    route('A1.1', 'B1.1', 'H 20 V 14 H 35 Z').width(0.25).match('G'),
    route('A2.1', 'B2.1', 'Z').width(0.25).length({ max: 41.95 }).match('G')), opts)
  const [l0, l1, l2] = [1, 2, 3].map(i => lengthOf(b, `route:${i}`))
  assert.ok(Math.abs(l1 - 42) < 1e-6, `${l1}`)
  assert.ok(l0 <= 31 + 1e-6 && l0 > 30.5, `D0 under its own max: ${l0}`)
  assert.ok(l2 >= 41.9 - 1e-6 && l2 <= 41.95 + 1e-6, `D2 in the window and under its max: ${l2}`)
  assert.deepEqual(findings(b, 'length'), [])
  const [f] = findings(b, 'length-match')
  assert.match(f.message, /^match group G spreads [\d.]+ mm, allowed 0\.1 mm, 1 of 3 routes below its window: shortest route route:1 of net D0 at 3\d\.\d+ mm, longest route route:2 of net D1 at 42 mm; its own maximum of 31\.00 mm is 11\.00 mm below the longest of group G, route:2 at 42\.00 mm, so it caps the group$/)
  assert.equal(b.routes[0].caps, 11)
})

test('tune: a group of pairs and single routes tunes both, the pairs in their centre lines', () => {
  const b = compileBoard(h(PCB, { name: 'Mixed' }, edge(40, 30), two('J1', 5, 4, 'DP', 'DN', 90), two('J2', 35, 4, 'DP', 'DN', 90),
    smd('A', 5, 12, 'S'), smd('B', 35, 12, 'S'), smd('C', 5, 26, 'T'), smd('D', 35, 26, 'T'),
    route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').width(0.2).gap(0.2).match('M', 0.2),
    route('A.1', 'B.1', 'H 12 V 18 H 28 V 12 Z').width(0.2).match('M', 0.2),
    route('C.1', 'D.1', 'Z').width(0.2).match('M', 0.2)), opts)
  const ls = [1, 2, 3].map(i => lengthOf(b, `route:${i}`))
  assert.ok(Math.max(...ls) - Math.min(...ls) <= 0.2 + 1e-6, ls.join(' '))
  assert.ok(Math.abs(ls[1] - 42) < 1e-6, 'the longest, a single route, is left alone')
  assert.ok(b.routes[0].tuned > 5 && b.routes[2].tuned > 5, b.routes.map(r => r.tuned).join(' '))
  const [p] = pairsOf(b)
  assert.ok(Math.abs(p.lengthP - p.lengthN) <= 0.1 + 1e-6, 'the pair keeps its skew')
  clean(b)
})

test('tune: meanders spread over several segments, and grow past the amplitude into maxAmplitude where the board has room', () => {
  // an L of 15 and 22 mm at amplitude 1 and no growth: neither leg alone holds 27 mm
  const L = compileBoard(h(PCB, { name: 'L' }, edge(40, 30), smd('A', 5, 4, 'X'), smd('B', 20, 26, 'X'),
    route('A.1', 'B.1', 'H 20 Z').width(0.2).length(64).rules({ tune: { amplitude: 1, maxAmplitude: 1 } })), opts)
  assert.ok(Math.abs(lengthOf(L, 'route:1') - 64) <= 0.1 + 1e-6, `${lengthOf(L, 'route:1')}`)
  const pts = L.items.filter(i => i.kind === 'track').flatMap(t => t.pts)
  assert.ok(pts.some(([x, y]) => x < 19 && Math.abs(y - 4) > 0.5), 'a meander on the first leg')
  assert.ok(pts.some(([x, y]) => y > 6 && Math.abs(x - 20) > 0.5), 'a meander on the second leg')
  assert.ok(pts.every(([x, y]) => Math.abs(y - 4) <= 1 + 1e-6 || Math.abs(x - 20) <= 1 + 1e-6), 'no higher than the amplitude')
  clean(L)
  // 30 mm at amplitude 1 holds about 35 mm; 50 mm grows the meander, up to 3 mm by default
  const big = compileBoard(h(PCB, { name: 'Grow' }, edge(40, 20), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(80)), opts)
  const ys = big.items.find(i => i.kind === 'track').pts.map(p => p[1])
  assert.ok(Math.abs(lengthOf(big, 'route:1') - 80) <= 0.1 + 1e-6, `${lengthOf(big, 'route:1')}`)
  assert.ok(Math.max(...ys) - Math.min(...ys) > 1.5 && Math.max(...ys.map(y => Math.abs(y - 10))) <= 3 + 1e-6, `height ${Math.max(...ys) - Math.min(...ys)}`)
  clean(big)
})

test('tune: courtyards and silk labels of other parts keep meanders out; the own part only near its pad', () => {
  const cy = (w, hh) => h('rect', { layer: 'F.CrtYd', x: -w / 2, y: -hh / 2, w, h: hh, width: 0.05 })
  const b = compileBoard(h(PCB, { name: 'Yard' }, edge(40, 20),
    h('footprint', { ref: 'A', at: [5, 10], nets: { 1: 'X' } }, h('pad', { num: 1, size: 1, type: 'smd' }), cy(6, 6)),
    smd('B', 35, 10, 'X'),
    h('footprint', { ref: 'U', at: [21, 13] }, cy(16, 4)),
    h('text', { layer: 'F.SilkS', at: '21 7.5', size: 1.5 }, 'LABEL'),
    route('A.1', 'B.1', 'Z').width(0.2).length(40)), opts)
  assert.ok(Math.abs(lengthOf(b, 'route:1') - 40) <= 0.1 + 1e-6, `${lengthOf(b, 'route:1')} ${b.routes[0].note}`)
  const label = b.items.find(i => i.kind === 'text').strokes.flat()
  const [lx0, lx1, ly0, ly1] = [Math.min(...label.map(p => p[0])), Math.max(...label.map(p => p[0])), Math.min(...label.map(p => p[1])), Math.max(...label.map(p => p[1]))]
  for (const [x, y] of b.items.find(i => i.kind === 'track').pts) {
    assert.ok(!(x > 13 - 0.1 && x < 29 + 0.1 && y > 11 - 0.1), `(${x}, ${y}) under U`)
    assert.ok(!(x > lx0 - 0.2 && x < lx1 + 0.2 && y > ly0 - 0.2 && y < ly1 + 0.2), `(${x}, ${y}) through the label`)
    assert.ok(!(x > 2 && x < 8 && Math.hypot(Math.max(0, Math.abs(x - 5) - 0.5), Math.max(0, Math.abs(y - 10) - 0.5)) > 1.2), `(${x}, ${y}) in the courtyard of A away from its pad`)
  }
})

test('tune: a pair whose skew is over its tolerance gets the shorter track meandered on its outer side', () => {
  const b = compileBoard(h(PCB, { name: 'Pair' }, edge(30, 20), two('J1', 10, 3, 'DP', 'DN'), two('J2', 20, 12, 'DP', 'DN', 90),
    route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 12 Z').width(0.2).gap(0.2)), opts)
  const [p] = pairsOf(b)
  assert.ok(Math.abs(p.lengthP - p.lengthN) <= 0.1 + 1e-6, `${p.lengthP} ${p.lengthN}`)
  assert.ok(b.routes[0].tuned > 0)
  clean(b)
})

test('tune: deterministic, and a second compile takes every leg and every tuned route from the cache and gives the same items', async () => {
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { clearRouteCache } = await import('@pcbjs/compile/route-cache')
  const make = (...more) => h(PCB, { name: 'TuneCache' }, edge(40, 42), ...more, ...bus(r => r.match('DATA')),
    smd('E', 5, 25, 'X'), smd('F', 35, 25, 'X'), route('E.1', 'F.1').width(0.2).length(34),
    two('J1', 10, 21, 'DP', 'DN'), two('J2', 22, 27, 'DP', 'DN', 90), route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 23 XZ').width(0.2).gap(0.2),
    // a mixed group: the pair is tuned in its centre line and kept in the cache as a pair
    two('J3', 5, 33, 'QP', 'QN', 90), two('J4', 35, 33, 'QP', 'QN', 90), smd('G', 5, 38, 'Y'), smd('H', 35, 38, 'Y'),
    route(['J3.1', 'J3.2'], ['J4.1', 'J4.2'], 'Z').width(0.2).gap(0.2).match('Q', 0.2), route('G.1', 'H.1', 'H 15 V 40.5 H 25 V 38 Z').width(0.2).match('Q', 0.2))
  clearRouteCache()
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-tune-'))
  try {
    const o = { routeCache: { dir } }
    const cold = compileBoard(make(), o)
    clean(cold)
    assert.ok(cold.routes.find(r => r.id === 'route:7').tuned > 2, 'the pair of group Q is tuned')
    const file = JSON.parse(readFileSync(join(dir, 'TuneCache.json'), 'utf8'))
    const tunes = Object.values(file.groups[''].tunes)
    assert.ok(tunes.length >= 5 && tunes.some(t => t.pair) && tunes.some(t => t.tracks.length), `${tunes.length} tune entries`)
    const warm = compileBoard(make(), o)
    assert.equal(warm.routing.cached, warm.routing.legs)
    assert.ok(warm.routing.legs >= 2)
    assert.deepEqual(warm.items, cold.items)
    assert.deepEqual(warm.routes, cold.routes)
    clearRouteCache()
    const disk = compileBoard(make(), o)
    assert.equal(disk.routing.cached, disk.routing.legs)
    assert.deepEqual(disk.items, cold.items)
    assert.deepEqual(compileBoard(make(), opts).items, cold.items, 'the same without a cache')
    // a stored step is reused only while the board around it is the same: a label put beside the bus tunes it again
    const moved = compileBoard(make(h('text', { layer: 'F.SilkS', at: '20 6', size: 1 }, 'NEW')), o)
    assert.notDeepEqual(moved.items.filter(i => i.kind === 'track' && i.route === 'route:1'), cold.items.filter(i => i.kind === 'track' && i.route === 'route:1'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---- DRC ----

test('DRC length: a route too long for its target is an error with the measured and allowed values and the route call', () => {
  const b = compileBoard(h(PCB, { name: 'Len' }, edge(), smd('A', 5, 10, 'X'), smd('B', 35, 10, 'X'), route('A.1', 'B.1', 'Z').width(0.2).length(20)), opts)
  const [f] = findings(b, 'length')
  assert.ok(f, b.drc.map(d => d.message).join('\n'))
  assert.equal(f.severity, 'error')
  assert.match(f.message, /^route route:1 of net X is 30 mm long, allowed 19\.9 to 20\.1 mm; a route that is too long is never shortened/)
  assert.ok(f.items.length >= 1)
  assert.deepEqual(f.at, b.items.find(i => i.kind === 'track').pts[0])
})

test('DRC length: a route with no room for a meander stays short and says why', () => {
  // a 1.2 mm high board: no room above or below the track
  const b = compileBoard(h(PCB, { name: 'Len' }, edge(40, 1.6), smd('A', 5, 0.8, 'X', 0.5), smd('B', 35, 0.8, 'X', 0.5), route('A.1', 'B.1', 'Z').width(0.2).length(40)), opts)
  const [f] = findings(b, 'length')
  assert.ok(f, b.drc.map(d => d.message).join('\n'))
  assert.match(f.message, /allowed 39\.9 to 40\.1 mm; tuning added 0\.00 of 10\.00 mm, 10\.00 mm missing: the deepest free room beside the route is 0\.\d\d mm, below the smallest meander amplitude of 0\.40 mm; a waypoint that leads the route through free board or a longer path would make room$/)
  // boxed in by keepouts on both sides: no free run at all
  const boxed = compileBoard(h(PCB, { name: 'Len' }, edge(40, 20), smd('A', 5, 10, 'X', 0.5), smd('B', 35, 10, 'X', 0.5),
    h('keepout', { layers: 'all', d: 'M 5.6 0 H 34.4 V 9.85 H 5.6 Z M 5.6 10.15 H 34.4 V 20 H 5.6 Z' }), route('A.1', 'B.1', 'Z').width(0.2).length(40)), opts)
  assert.match(findings(boxed, 'length')[0].message, /10\.00 mm missing: no free run beside the route; a waypoint/)
})

test('DRC length-match: a group spread over its tolerance names the shortest and longest routes', () => {
  // the first line sits on a 1.6 mm strip of board, so it cannot grow to the others
  const b = compileBoard(h(PCB, { name: 'Bus' }, h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 40 V 20 H 0 Z' }),
    h('keepout', { layers: 'all', d: 'M 6 1.8 H 34 V 3.5 H 6 Z M 6 4.5 H 34 V 7 H 6 Z' }),
    ...bus(r => r.match('DATA'))), opts)
  const [f] = findings(b, 'length-match')
  assert.ok(f, b.drc.map(d => d.message).join('\n'))
  assert.equal(f.severity, 'error')
  assert.match(f.message, /^match group DATA spreads [\d.]+ mm, allowed 0\.1 mm, 1 of 4 routes below its window: shortest route route:1 of net D0 at [\d.]+ mm, longest route route:\d of net D\d at [\d.]+ mm; tuning added [\d.]+ of [\d.]+ mm, [\d.]+ mm missing: (the deepest free room beside the route is [\d.]+ mm, below the smallest meander amplitude of [\d.]+ mm|the longest free run left beside the route is [\d.]+ mm, at \([\d.]+, [\d.]+\) on F\.Cu, too short for another bump); a waypoint that leads the route through free board, a longer path or a smaller group would make room$/)
  assert.deepEqual(findings(b, 'length'), [])
})

test('DRC: a pair that cannot be tuned keeps its pair-skew finding', () => {
  // the bend sits in a tight corner of the board: no coupled run of the inner track has room
  const b = compileBoard(h(PCB, { name: 'Pair' }, edge(14, 8), two('J1', 2, 1, 'DP', 'DN'), two('J2', 12, 6, 'DP', 'DN', 90),
    h('keepout', { layers: 'all', d: 'M 2.4 1.6 H 14 V 5.35 H 2.4 Z' }),
    route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 6 Z').width(0.2).gap(0.2)), opts)
  assert.equal(findings(b, 'pair-skew').length, 1, b.drc.map(d => d.message).join('\n'))
})

// ---- site data and inspect ----

test('site routes: every route with its length, a pair with its skew, a group with the range that holds it', async () => {
  const { routeInfos } = await import('@pcbjs/export/site-data')
  const b = compileBoard(h(PCB, { name: 'Bus' }, edge(), ...bus((r, i) => (i < 2 ? r.match('DATA') : i === 2 ? r.length({ min: 31 }) : r))), opts)
  const rs = routeInfos(b).routes
  assert.deepEqual(rs.map(r => r.id), ['route:1', 'route:2', 'route:3', 'route:4'])
  assert.equal(rs[0].group, 'DATA')
  assert.ok(rs.slice(0, 2).every(r => r.length >= r.target.min && r.length <= r.target.max && r.target.max - r.target.min <= 0.2 + 1e-9))
  assert.deepEqual(rs[2].target, { min: 31, max: 1e6 })
  assert.equal(rs[3].target, null)
  assert.ok(rs.every(r => r.length > 29))
  const p = compileBoard(h(PCB, { name: 'Pair' }, edge(30, 20), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DP', 'DN'), route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').width(0.2).gap(0.2)), opts)
  const [pr] = routeInfos(p).routes
  assert.deepEqual([pr.id, pr.net, pr.pair, pr.skew], ['route:1', 'DP', 'pair:1', 0])
})

test('inspect --lengths: one row per route with its status; inspect <net> prints the length of a single route', () => {
  const b = compileBoard(h(PCB, { name: 'Bus' }, edge(), ...bus((r, i) => (i === 0 ? r.length(20) : i < 3 ? r.match('DATA') : r))), opts)
  const r = inspectBoard(b, 'bus.tsx', '/', undefined, { lengths: true })
  const text = r.text.join('\n')
  assert.match(text, /route\s+net\s+pair\s+length\s+target\s+group\s+skew\s+tuned\s+status\s+src/)
  assert.match(text, /route:1\s+D0\s+-\s+30\.00\s+19\.90 to 20\.10\s+-\s+-\s+-\s+long/)
  assert.match(text, /route:2\s+D1\s+-\s+30\.00\s+[\d.]+ to [\d.]+\s+DATA\s+-\s+-\s+ok/)
  assert.equal(r.json.routes.length, 4)
  assert.equal(r.json.routes[0].status, 'long')
  const one = inspectBoard(b, 'bus.tsx', '/', 'D0', { lengths: true })
  assert.equal(one.json.routes.length, 1)
  const net = inspectBoard(b, 'bus.tsx', '/', 'D3')
  assert.match(net.text.join('\n'), /route route:4  length [\d.]+ with vias/)
  assert.equal(net.json.routes[0].id, 'route:4')
})

test('site data: the routes, and the pair of every pair track although the router removed the placeholders', async () => {
  const { siteData } = await import('@pcbjs/export/site-data')
  const b = compileBoard(h(PCB, { name: 'Pair' }, edge(30, 20), two('J1', 10, 3, 'DP', 'DN'), two('J2', 20, 12, 'DP', 'DN', 90),
    route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 12 Z').width(0.2).gap(0.2)), opts)
  const d = siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: '', svgUrl: '', dev: false, bom: [] })
  const tracks = d.items.filter(i => i.kind === 'track')
  assert.deepEqual(tracks.map(t => [t.pair, t.role]), [['pair:1', 'P'], ['pair:1', 'N']])
  assert.deepEqual(d.routes.map(r => [r.id, r.pair, r.skew <= 0.1]), [['route:1', 'pair:1', true]])
})
