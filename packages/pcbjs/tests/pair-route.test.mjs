// Differential pairs end to end: route() with array ends, flatten's nets, width and gap, the router's centre line and its
// two tracks, the cache and rip up, class clearance in the router, the pair DRC rules and inspect.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets, resetDefaults } from '@pcbjs/core'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { drc } from '@pcbjs/compile/drc'
import { connectivity } from '@pcbjs/compile/connectivity'
import { clearRouteCache } from '@pcbjs/compile/route-cache'
import { pairsOf, coupledGap } from '@pcbjs/compile/pair-info'
import { inspectBoard } from '@pcbjs/cli/inspect'
import { pairGeometry, traceWidth, JLCPCB_4L_7628 } from '@pcbjs/lib'
import { near } from './helpers.mjs'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
/** Two smd pads 0.5 mm apart side by side, pad 1 on `a` at -x, pad 2 on `b` at +x. */
const two = (ref, x, y, a, b) => h('footprint', { ref, at: [x, y], nets: { 1: a, 2: b } },
  h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }), h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' }))
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const board = (props, ...children) => h(PCB, { name: 'Pair', ...props }, edge(), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DP', 'DN'), ...children)
const pair = (path, w = 0.2, g = 0.2) => route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], path).width(w).gap(g)
const tracks = (b, net) => b.items.filter(i => i.kind === 'track' && (net === undefined || i.net === net))
const vias = b => b.items.filter(i => i.kind === 'via')
const findings = (b, rule) => b.drc.filter(d => d.rule === rule)
const errors = b => b.drc.filter(d => d.severity === 'error')
const clean = b => { assert.deepEqual(b.drc.filter(d => d.rule !== 'single-pad').map(d => `${d.rule}: ${d.message}`), []); assert.equal(b.unconnected, 0) }

// ---- the builder ----

test('pair builder: array ends make a pair route, P first, and the pair methods set its props', () => {
  const r = route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 8 XZ').gap(0.15).skew('0.05mm').impedance(90)
  assert.equal(r.props.pair, true)
  assert.deepEqual(r.props.from, ['J1.1', 'J1.2'])
  assert.deepEqual(r.props.to, ['J2.1', 'J2.2'])
  assert.equal(r.props.gap, 0.15)
  assert.equal(r.props.skew, '0.05mm')
  assert.equal(r.props.impedance, 90)
  // a coordinate tuple is still one end
  const t = route([3, 4], ['5mm', '4mm', 'B.Cu'])
  assert.equal(t.props.pair, undefined)
  assert.deepEqual(t.props.from, [3, 4])
  assert.equal(route('J1.1', 'J2.1').impedance(50).props.impedance, 50)
})

test('pair builder: mixing an array end with a single end, a mixed array and the pair methods on a single route are TypeErrors', () => {
  assert.throws(() => route(['J1.1', 'J1.2'], 'J2.1'), { name: 'TypeError', message: /a is a pair end \[P, N\] but b is a single end/ })
  assert.throws(() => route('J1.1', ['J2.1', 'J2.2']), { name: 'TypeError', message: /b is a pair end/ })
  assert.throws(() => route(['J1.1', 3], ['J2.1', 'J2.2']), { name: 'TypeError', message: /mixes a position and a length/ })
  assert.throws(() => route('J1.1', 'J2.1').gap(0.2), { name: 'TypeError', message: /gap\(\) is for a differential pair/ })
  assert.throws(() => route('J1.1', 'J2.1').skew(0.2), { name: 'TypeError', message: /skew\(\) is for a differential pair/ })
  assert.throws(() => route('J1.1', 'J2.1').impedance(-5), { name: 'TypeError', message: /positive number of ohms/ })
})

// ---- flatten ----

test('pair flatten: the nets come from the pads, checked: P pads on one net, N pads on another', () => {
  const b = compileBoard(board({}, pair('Z')), opts)
  const [p] = b.pairs
  assert.deepEqual(p.nets, ['DP', 'DN'])
  assert.equal(p.id, 'pair:1')
  // P ends on two nets
  assert.throws(() => compileBoard(h(PCB, { name: 'Pair' }, edge(), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'X', 'DN'), pair('Z')), opts),
    e => e instanceof CompileError && /the P ends J1\.1 and J2\.1 are on two nets, DP and X/.test(e.message))
  // P and N on one net
  assert.throws(() => compileBoard(h(PCB, { name: 'Pair' }, edge(), two('J1', 10, 3, 'D', 'D'), two('J2', 10, 17, 'D', 'D'), pair('Z')), opts),
    e => e instanceof CompileError && /are all on net D; a pair joins two nets/.test(e.message))
  // N ends on no net
  assert.throws(() => compileBoard(h(PCB, { name: 'Pair' }, edge(), two('J1', 10, 3, 'DP', 'DN'), route(['J1.1', '5 5'], ['10 17', '11 17'], 'Z')), opts),
    e => e instanceof CompileError && /neither N end is a pad on a net/.test(e.message))
})

test('pair flatten: gap from .gap(), else the class, else the width; skew and uncoupled from the class, else 0.1 and 5', () => {
  const plain = compileBoard(board({}, route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').width(0.25)), opts)
  assert.deepEqual([plain.pairs[0].width, plain.pairs[0].gap, plain.pairs[0].skew, plain.pairs[0].maxUncoupled], [0.25, 0.25, 0.1, 5])
  const { DP, DN } = nets({ DP: { class: 'usb' }, DN: { class: 'usb' } })
  const classed = compileBoard(h(PCB, { name: 'Pair', classes: { usb: { width: 0.2, gap: 0.18, skew: 0.05, uncoupled: 3 } } }, edge(),
    two('J1', 10, 3, DP, DN), two('J2', 10, 17, DP, DN), route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z')), opts)
  const [c] = classed.pairs
  assert.deepEqual([c.width, c.gap, c.skew, c.maxUncoupled], [0.2, 0.18, 0.05, 3])
})

test('pair flatten: .impedance() sets width and gap from the stackup, holding an explicit .gap() or .width(); a single route gets its width', () => {
  const s = JLCPCB_4L_7628
  const r2 = v => Math.round(v * 100) / 100
  const at = (...r) => compileBoard(h(PCB, { name: 'Pair', stackup: s }, edge(), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DP', 'DN'), smd('K1', 3, 3, 'S'), smd('K2', 3, 17, 'S'), ...r), opts)
  const both = at(route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').impedance(90)).pairs[0]
  const free = pairGeometry(s, 'F.Cu', 90)
  assert.deepEqual([both.width, both.gap], [r2(free.width), r2(free.gap)])
  const held = at(route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').impedance(90).gap(0.15)).pairs[0]
  assert.equal(held.gap, 0.15)
  assert.equal(held.width, r2(pairGeometry(s, 'F.Cu', 90, { gap: 0.15 }).width))
  const wide = at(route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').impedance(90).width(0.3)).pairs[0]
  assert.equal(wide.width, 0.3)
  assert.equal(wide.gap, r2(pairGeometry(s, 'F.Cu', 90, { width: 0.3 }).gap))
  const single = at(route('K1.1', 'K2.1', 'Z').impedance(50))
  for (const t of tracks(single, 'S')) assert.equal(t.width, r2(traceWidth(s, 'F.Cu', 50)))
  const given = at(route('K1.1', 'K2.1', 'Z').impedance(50).width(0.4))
  for (const t of tracks(given, 'S')) assert.equal(t.width, 0.4)
})

// ---- the router ----

test('pair router: a straight pair is two tracks a pitch apart with the pair id and roles, fanned into the pads', () => {
  const b = compileBoard(board({}, pair()), opts)
  clean(b)
  const [P] = tracks(b, 'DP'), [N] = tracks(b, 'DN')
  assert.equal(tracks(b).length, 2)
  assert.deepEqual([P.pair, P.role, P.width, N.pair, N.role], ['pair:1', 'P', 0.2, 'pair:1', 'N'])
  // from the pad centres, straight to the pad edges, then 45 degrees in to the pitch, 0.4 apart centre to centre
  assert.deepEqual(P.pts[0], [9.75, 3])
  assert.deepEqual(P.pts[1], [9.75, 3.5])
  assert.deepEqual(N.pts[N.pts.length - 1], [10.25, 17])
  near(P.pts[2][0], 9.8, 1e-9)
  near(N.pts[2][0] - P.pts[2][0], 0.4, 1e-9)
  const [p] = pairsOf(b)
  near(p.lengthP, p.lengthN, 1e-9)
  near(coupledGap(p, 0.2, b.items.filter(i => i.kind === 'pad').map(i => i.at)).gap, 0.2, 1e-9)
})

test('pair router: @layer in the centre line puts a via pair across the run, one via per net, and the tracks change layer', () => {
  const b = compileBoard(board({}, pair('V 8 @B.Cu V 12 @F.Cu Z')), opts)
  clean(b)
  const vs = vias(b)
  assert.equal(vs.length, 4)
  assert.deepEqual(vs.map(v => v.net).sort(), ['DN', 'DN', 'DP', 'DP'])
  assert.deepEqual(tracks(b, 'DP').map(t => t.layer), ['F.Cu', 'B.Cu', 'F.Cu'])
  // P runs on the side of its start pad, -x here, so its vias are on that side too
  for (const v of vs) assert.ok(v.net === 'DP' ? v.at[0] < 10 : v.at[0] > 10)
  const [p] = pairsOf(b)
  near(p.lengthP, p.lengthN, 1e-9)
  assert.equal(p.viasP.length, 2)
})

test('pair router: an automatic leg routes the centre line around other copper, both nets own copper', () => {
  const b = compileBoard(board({}, smd('X1', 10, 10, 'B', 3), pair()), opts)
  clean(b)
  // X1 reaches 1.5 mm either side of x = 10: both tracks pass it further out
  for (const t of tracks(b)) assert.ok(t.pts.some(([x]) => Math.abs(x - 10) > 1.5 + 0.1524 + 0.1 - 1e-9), `${t.net} goes around X1`)
  assert.equal(b.pairs[0].id, 'pair:1')
})

test('pair router: the cache replays a pair leg, and an edit elsewhere keeps it', () => {
  clearRouteCache()
  const parts = () => [smd('X1', 10, 10, 'B', 3), pair()]
  const first = compileBoard(board({}, ...parts()))
  const again = compileBoard(board({}, ...parts(), h('text', { layer: 'F.SilkS', at: '25 18', size: 1 }, 'rev 2')))
  assert.equal(again.routing.cached, 1)
  assert.deepEqual(tracks(again).map(t => t.pts), tracks(first).map(t => t.pts))
  // the key holds w and g: another gap routes again
  const other = compileBoard(board({}, smd('X1', 10, 10, 'B', 3), pair(undefined, 0.2, 0.25)))
  assert.equal(other.routing.cached, 0)
  clean(other)
  clearRouteCache()
})

test('pair router: rip up moves a single route out of the way of a pair', () => {
  clearRouteCache()
  // A runs straight across between pads too close to the edges, declared first; the pair can only pass through it
  const b = compileBoard(h(PCB, { name: 'PairRip' }, edge(20, 20), two('J1', 10, 2, 'DP', 'DN'), two('J2', 10, 18, 'DP', 'DN'),
    smd('A1', 0.9, 10, 'A'), smd('A2', 19.1, 10, 'A'), route('A1.1', 'A2.1').width(0.25).layers(['F.Cu']),
    route(['J1.1', 'J1.2'], ['J2.1', 'J2.2']).width(0.2).gap(0.2).layers(['F.Cu'])), opts)
  assert.deepEqual(findings(b, 'route-failed'), [])
  assert.ok(b.routing.ripped >= 1)
  assert.equal(b.unconnected, 0)
  assert.deepEqual(errors(b), [])
  assert.equal(tracks(b, 'DP').length, 1)
  clearRouteCache()
})

test('pair router: pads mirrored between the ends cannot be joined without crossing, a route-failed at the end found before routing', () => {
  const b = compileBoard(h(PCB, { name: 'Pair' }, edge(), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DN', 'DP'),
    route(['J1.1', 'J1.2'], ['J2.2', 'J2.1'], 'Z').width(0.2).gap(0.2)), opts)
  const [f] = findings(b, 'route-failed')
  assert.match(f.message, /cannot route the pair of nets DP and DN: the pair would have to cross itself: P leaves its start pad on the right of the direction of travel, but its end pad at \(10\.25, 17\) is on the left as the path arrives; swap P and N at a via pair with \.cross\(layer\)/)
  assert.deepEqual(f.at, [10, 17])
  assert.equal(tracks(b).length, 0, 'a pair that cannot be laid out places no copper')
  assert.throws(() => compileBoard(h(PCB, { name: 'Pair', strict: true }, edge(), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DN', 'DP'),
    route(['J1.1', 'J1.2'], ['J2.2', 'J2.1'], 'Z').width(0.2).gap(0.2)), opts), CompileError)
})

test('pair router: a locked pair keeps its centre line', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-pair-'))
  try {
    clearRouteCache()
    const o = { routeCache: { dir } }
    const bent = compileBoard(board({}, smd('X1', 10, 10, 'B', 3), pair().lock()), o)
    clearRouteCache()
    const kept = compileBoard(board({}, pair().lock()), o)
    assert.equal(kept.routing.locked, 1)
    assert.deepEqual(tracks(kept).map(t => t.pts), tracks(bent).map(t => t.pts))
  } finally { rmSync(dir, { recursive: true, force: true }); clearRouteCache() }
})

// ---- class clearance in the router ----

test('class clearance: the router keeps a class clearance from other copper and DRC stays clean', () => {
  const { A } = nets({ A: { class: 'wide' } })
  const parts = [smd('J1', 3, 5, A), smd('J2', 17, 5, A), smd('X1', 10, 5.6, 'B', 1)]
  const b = compileBoard(h(PCB, { name: 'Wide', classes: { wide: { clearance: 0.4 } } }, edge(20, 10), ...parts, route('J1.1', 'J2.1').width(0.25)), opts)
  assert.deepEqual(errors(b), [])
  const x1 = b.items.find(i => i.kind === 'pad' && i.ref === 'X1')
  // the distance from the track's edge to the pad's edge, sampled along the track
  let min = Infinity
  for (const t of tracks(b, 'A'))
    for (let i = 1; i < t.pts.length; i++)
      for (let k = 0; k <= 200; k++) {
        const s = k / 200, x = t.pts[i - 1][0] + s * (t.pts[i][0] - t.pts[i - 1][0]), y = t.pts[i - 1][1] + s * (t.pts[i][1] - t.pts[i - 1][1])
        const dx = Math.max(x1.at[0] - 0.5 - x, 0, x - x1.at[0] - 0.5), dy = Math.max(x1.at[1] - 0.5 - y, 0, y - x1.at[1] - 0.5)
        min = Math.min(min, Math.hypot(dx, dy) - t.width / 2)
      }
  assert.ok(min >= 0.4 - 1e-6, `the track keeps ${min} mm from X1`)
  // without the class the route runs closer
  const plain = compileBoard(h(PCB, { name: 'Wide' }, edge(20, 10), smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('X1', 10, 5.6, 'B', 1), route('J1.1', 'J2.1').width(0.25)), opts)
  assert.notDeepEqual(tracks(plain, 'A').map(t => t.pts), tracks(b, 'A').map(t => t.pts))
})

// ---- DRC ----

test('pair DRC: pair-skew when one track runs longer, with the source, the nets, both lengths and the tolerance', () => {
  // one right-angle bend: the outer track is a pitch longer, and a keepout inside the bend leaves the inner track no room
  // for a meander, see tune.test.mjs for the tuned case
  const b = compileBoard(h(PCB, { name: 'Pair' }, edge(), two('J1', 10, 3, 'DP', 'DN'), h('footprint', { ref: 'J2', at: '20 12 90deg', nets: { 1: 'DP', 2: 'DN' } },
    h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }), h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' })),
  h('keepout', { layers: 'all', d: 'M 10.4 3.6 H 30 V 11.6 H 10.4 Z' }),
  route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 12 Z').width(0.2).gap(0.2)), opts)
  const [s] = findings(b, 'pair-skew')
  assert.ok(s, b.drc.map(d => d.message).join('\n'))
  assert.equal(s.severity, 'error')
  assert.match(s.message, /^pair DP\/DN \(pair:1\): the tracks differ in length by 0\.\d+ mm, DP [\d.]+ mm and DN [\d.]+ mm with their vias, allowed 0\.1 mm; the pair skew of [\d.]+ mm could be tuned by 0\.00 mm only: no free run beside the coupled runs of the shorter track$/)
  assert.equal(s.items.length, 2)
  // a looser .skew() passes it
  const ok = compileBoard(h(PCB, { name: 'Pair' }, edge(), two('J1', 10, 3, 'DP', 'DN'), h('footprint', { ref: 'J2', at: '20 12 90deg', nets: { 1: 'DP', 2: 'DN' } },
    h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }), h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' })),
  route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'V 12 Z').width(0.2).gap(0.2).skew(0.5)), opts)
  assert.deepEqual(findings(ok, 'pair-skew'), [])
})

test('pair DRC: pair-uncoupled warns above the class limit', () => {
  const { DP, DN } = nets({ DP: { class: 'usb' }, DN: { class: 'usb' } })
  const b = compileBoard(h(PCB, { name: 'Pair', classes: { usb: { uncoupled: 0.1 } } }, edge(), two('J1', 10, 3, DP, DN), two('J2', 10, 17, DP, DN), route(['J1.1', 'J1.2'], ['J2.1', 'J2.2'], 'Z').width(0.2).gap(0.2)), opts)
  const [u] = findings(b, 'pair-uncoupled')
  assert.equal(u.severity, 'warning')
  // pads 0.5 mm apart at a 0.4 mm pitch: each fan runs a track width long, shallow, so it is no step in the copper
  assert.match(u.message, /^pair DP\/DN \(pair:1\): 0\.8 mm of the two tracks run uncoupled at the ends and the vias, allowed 0\.1 mm$/)
})

test('pair DRC: pair-gap when a coupled section is off the pair gap, only with both tracks of a pair id', () => {
  const b = compileBoard(board({}, pair('Z')), opts)
  assert.deepEqual(findings(b, 'pair-gap'), [])
  const N = tracks(b, 'DN')[0]
  N.pts = N.pts.map(([x, y], i) => (i > 1 && i < N.pts.length - 2 ? [x + 0.05, y] : [x, y]))
  const out = drc(b, connectivity(b))
  const [g] = out.filter(d => d.rule === 'pair-gap')
  assert.match(g.message, /the coupled tracks are 0\.25 mm apart edge to edge, the pair gap is 0\.2 mm, allowed off by 0\.01 mm/)
  // one track alone is no pair to check
  b.items = b.items.filter(i => i !== N)
  assert.deepEqual(drc(b, connectivity(b)).filter(d => d.rule.startsWith('pair-')), [])
})

// ---- inspect ----

test('pair inspect: a net of a pair prints its partner, width, gap and the length of each track', () => {
  const b = compileBoard(board({}, pair('V 8 @B.Cu V 12 @F.Cu Z')), opts)
  const r = inspectBoard(b, 'main.tsx', '/', 'DN')
  const line = r.text.find(l => l.startsWith('pair '))
  assert.match(line, /^pair pair:1 {2}N of DP\/DN {2}partner DP {2}width 0\.20 {2}gap 0\.20 {2}length DP [\d.]+ DN [\d.]+ with vias {2}skew 0\.00 of 0\.10 {2}uncoupled [\d.]+ of 5\.00$/)
  assert.equal(r.json.pairs[0].tracks.length, 6)
  assert.equal(r.json.pairs[0].partner, 'DP')
  assert.ok(r.text.some(l => /^ {2}#\d+ +N +DN +B\.Cu +0\.20 +[\d.]+$/.test(l)))
})

// ---- reviewer reproductions: the router's own pair output passes DRC ----

/** A connector row: pads 0.5 mm apart along y from (x, y0), 1.3 x 0.3 mm, nets in pin order. */
const row = (ref, x, y0, ns, rot = 0) => h('footprint', { ref, at: [x, y0], rot, nets: Object.fromEntries(ns.map((n, i) => [i + 1, n])) },
  ...ns.map((_, i) => h('pad', { num: i + 1, at: [0, i * 0.5], size: [1.3, 0.3], type: 'smd' })))
/** Every DRC finding but those of nets left open on purpose and single pads. */
const real = (b, open = []) => b.drc.filter(d => d.rule !== 'single-pad' && !(d.rule === 'unconnected' && open.some(n => d.message.includes(`net ${n} `)))).map(d => `${d.rule}: ${d.message}`)

test('pair router: autorouted pairs from 0.5 mm pitch rows with grounds between start at the midpoint, fan symmetric and pass DRC', () => {
  const ns = ['GND', 'AP', 'AN', 'GND', 'BP', 'BN', 'GND']
  for (const [dy, x2] of [[0, 26.97], [3.13, 26.97], [-2.21, 20.33], [5.07, 15.41]]) {
    const b = compileBoard(h(PCB, { name: 'Rows' }, edge(), row('J1', 3.03, 6.07, ns), row('J2', x2, 6.07 + dy, ns, 180),
      route(['J1.2', 'J1.3'], ['J2.2', 'J2.3']).width(0.29).gap(0.29), route(['J1.5', 'J1.6'], ['J2.5', 'J2.6']).width(0.29).gap(0.29)), opts)
    assert.deepEqual(real(b, ['GND']), [], `J2 at ${x2}, dy ${dy}`)
    for (const id of ['pair:1', 'pair:2']) {
      const P = b.items.find(i => i.kind === 'track' && i.pair === id && i.role === 'P'), N = b.items.find(i => i.kind === 'track' && i.pair === id && i.role === 'N')
      // straight out of the pads to their edge, then mirror image fans about the pads' midpoint
      near((P.pts[2][1] + N.pts[2][1]) / 2, (P.pts[0][1] + N.pts[0][1]) / 2, 1e-6)
      near(P.pts[2][0], N.pts[2][0], 1e-6)
    }
  }
})

test('pair router: a pair between coordinate ends takes both nets with .net(P, N), and a diagonal last leg into them does not pinch', () => {
  const { DP, DN } = nets()
  const b = compileBoard(h(PCB, { name: 'Coords' }, edge(),
    route([[3, 5], [3, 5.58]], [[18.4, 10.83], [18.4, 11.41]], 'X 17.4 10.12 Z').width(0.29).gap(0.29).net(DP, DN),
    route([[3, 15], [3, 15.58]], [[18.4, 12.83], [18.4, 13.41]]).width(0.29).gap(0.29).net('QP', 'QN')), opts)
  assert.deepEqual(b.pairs.map(p => p.nets), [['DP', 'DN'], ['QP', 'QN']])
  assert.deepEqual(b.drc.filter(d => d.severity === 'error').map(d => `${d.rule}: ${d.message}`), [])
  assert.throws(() => route('J1.1', 'J2.1').net('A', 'B'), { name: 'TypeError', message: /second net for a differential pair only/ })
  // with pads the N net must agree
  assert.throws(() => compileBoard(board({}, pair('Z').net('DP', 'X')), opts), e => e instanceof CompileError && /given the N net X, but its N ends are on DN/.test(e.message))
})

test('pair router: the end stub into staggered rows leaves in the first free direction, not into the next pins', () => {
  // a magjack like the eth-phy board's: pins 1.02 mm apart in y, odd pins at x 6, even pins at x 7.78
  const sig = ['CT', 'AP', 'AN', 'BP', 'BN', 'CT2']
  const jack = h('footprint', { ref: 'J1', at: [2, 4], nets: Object.fromEntries(sig.map((n, i) => [i + 1, n])) },
    ...sig.map((_, i) => h('pad', { num: i + 1, at: [i % 2 ? 7.78 : 6, i * 1.02], size: [1.3, 1.3], shape: 'circle', type: 'thru', drill: 0.9 })))
  const b = compileBoard(h(PCB, { name: 'Jack' }, edge(), jack, row('U1', 26, 6, ['AP', 'AN', 'G', 'BP', 'BN']),
    route(['J1.2', 'J1.3'], ['U1.1', 'U1.2']).width(0.16).gap(0.16), route(['J1.4', 'J1.5'], ['U1.4', 'U1.5']).width(0.16).gap(0.16)), opts)
  assert.deepEqual(b.drc.filter(d => d.severity === 'error').map(d => `${d.rule}: ${d.message}`), [])
  assert.equal(b.pairs.length, 2)
})

test('neck: a route wider than its 0.5 mm pitch pad necks down at the pad, autorouted or drawn, and length 0 turns it off', () => {
  const pads = () => [row('J1', 3, 6, ['G1', 'S', 'G2']), h('footprint', { ref: 'T1', at: [20, 12], nets: { 1: 'S' } }, h('pad', { num: 1, size: [1.5, 1.5], type: 'smd' }))]
  for (const path of ['XZ', 'H 8 XZ', 'H 8 V 12 H 20']) {
    const b = compileBoard(h(PCB, { name: 'Neck' }, edge(), ...pads(), route('J1.2', 'T1.1', path + (path.endsWith('Z') ? '' : ' Z')).width(0.6)), opts)
    assert.deepEqual(real(b), [], path)
    const ts = tracks(b, 'S')
    const neck = ts.find(t => t.width === 0.3)
    assert.ok(neck, `${path}: a neck at the pad's 0.3 mm`)
    assert.deepEqual(neck.pts[0], [3, 6.5])
    assert.ok(ts.some(t => t.width === 0.6))
  }
  const off = compileBoard(h(PCB, { name: 'Neck' }, edge(), ...pads(), route('J1.2', 'T1.1', 'H 8 V 12 H 20 Z').width(0.6).neck({ length: 0 })), opts)
  assert.ok(findings(off, 'clearance').length > 0)
  const narrow = compileBoard(h(PCB, { name: 'Neck', classes: { s: { neck: { width: 0.2 } } } }, edge(), ...pads(), route('J1.2', 'T1.1', 'H 8 V 12 H 20 Z').width(0.6).net(nets({ S: { class: 's' } }).S)), opts)
  assert.ok(tracks(narrow, 'S').some(t => t.width === 0.2), 'the class neck width')
  assert.throws(() => route('J1.2', 'T1.1').neck({ depth: 1 }), { name: 'TypeError', message: /takes \{ width\?, length\? \}/ })
})

test('neck: a pair wider than its pads necks at both ends, fans clear of the pads beside them and passes DRC', () => {
  const ns = ['G1', 'AP', 'AN', 'G2']
  const b = compileBoard(h(PCB, { name: 'PairNeck' }, edge(), row('J1', 3.03, 6.07, ns), row('J2', 26.97, 9.13, ns, 180),
    route(['J1.2', 'J1.3'], ['J2.2', 'J2.3']).width(0.6).gap(0.2)), opts)
  assert.deepEqual(real(b, ['G1', 'G2']), [])
  const own = b.items.filter(i => i.kind === 'track' && i.pair === 'pair:1')
  assert.deepEqual([...new Set(own.map(t => t.width))].sort(), [0.3, 0.6])
  // the necks are not read as coupled at the wrong gap
  assert.equal(findings(b, 'pair-gap').length, 0)
})

test('pair length: .length() meanders the centre line to the target, and a match group of pairs closes', () => {
  const ns = ['G1', 'AP', 'AN', 'G2', 'BP', 'BN', 'G3']
  const one = compileBoard(h(PCB, { name: 'Len' }, edge(), row('J1', 3.03, 6.07, ns), row('J2', 26.97, 9.13, ns, 180),
    route(['J1.2', 'J1.3'], ['J2.2', 'J2.3']).width(0.2).gap(0.2).length(30)), opts)
  assert.deepEqual(real(one, ['G1', 'G2', 'G3', 'BP', 'BN']), [])
  const r = one.routes.find(x => x.id === 'route:1')
  assert.ok(r.tuned > 4, `tuned ${r.tuned}`)
  const [p] = pairsOf(one)
  assert.ok(p.lengthP >= 29.9 && p.lengthP <= 30.1 && Math.abs(p.lengthP - p.lengthN) <= 0.1, `${p.lengthP} ${p.lengthN}`)
  // two pairs, one 6 mm longer: the shorter is meandered until the group is within its tolerance
  const two = compileBoard(h(PCB, { name: 'Match' }, edge(), row('J1', 3.03, 6.07, ns), row('J2', 26.97, 9.13, ns, 180), row('J3', 20.97, 13.13, ns, 180),
    route(['J1.2', 'J1.3'], ['J2.2', 'J2.3']).width(0.2).gap(0.2).match('M', 0.2), route(['J1.5', 'J1.6'], ['J3.5', 'J3.6']).width(0.2).gap(0.2).match('M', 0.2)), opts)
  assert.deepEqual(real(two, ['G1', 'G2', 'G3', 'AP', 'AN', 'BP', 'BN']).filter(m => !m.startsWith('unconnected')), [])
  const ls = pairsOf(two).map(q => Math.max(q.lengthP, q.lengthN))
  assert.ok(Math.abs(ls[0] - ls[1]) <= 0.2, ls.join(' '))
})
