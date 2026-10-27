import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, variants, defineDefaultBoard, resetDefaults, BASE_BOARD } from '@pcbjs/core'
import { bindPCB } from '@pcbjs/fab'
import { compileBoard, compileBoards, CompileError } from '@pcbjs/compile'
import { BASE } from '@pcbjs/lib/rules'
import { twoLayer } from '@pcbjs/lib/stackups'
import { transformSourceRanges } from '@pcbjs/cli/source-ranges'
import { resolvePos } from '@pcbjs/compile/autoroute'
import { compiledBase } from './fixtures.mjs'
import { nearPt } from './helpers.mjs'

const errors = b => b.drc.filter(d => d.severity === 'error')
const tracks = (b, net) => b.items.filter(i => i.kind === 'track' && (net === undefined || i.net === net))
const vias = b => b.items.filter(i => i.kind === 'via')
const edge = (w = 20, hh = 10) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
/** One smd pad footprint on F.Cu. */
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const board = (...children) => h(PCB, { name: 'Route' }, edge(), ...children)
const strictBoard = (...children) => h(PCB, { name: 'Route', strict: true }, edge(), ...children)
const failedOf = b => b.drc.filter(d => d.rule === 'route-failed')

test('autoroute: maze goes around a pad of another net', () => {
  const b = compileBoard(board(
    smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'), smd('X1', 10, 5, 'B', 3),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.25, d: { start: 'J1.1', end: 'J2.1' } }),
  ))
  const [t] = tracks(b, 'A')
  assert.equal(tracks(b, 'A').length, 1)
  assert.ok(t.pts.length > 2, 'the route bends around the obstacle')
  nearPt(t.pts[0], [5, 5], 1e-9)
  nearPt(t.pts[t.pts.length - 1], [15, 5], 1e-9)
  assert.equal(vias(b).length, 0)
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
})

test('autoroute: maze changes layer with two vias when F.Cu is walled off', () => {
  const b = compileBoard(board(
    smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'),
    h('track', { net: 'B', layer: 'F.Cu', width: 0.4, d: 'M10 0.7 L10 9.3' }),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.25, d: { start: 'J1.1', end: 'J2.1', layers: ['F.Cu', 'B.Cu'] } }),
  ))
  assert.equal(vias(b).length, 2)
  for (const v of vias(b)) assert.deepEqual(v.layers, ['F.Cu', 'B.Cu'])
  assert.ok(tracks(b, 'A').some(t => t.layer === 'B.Cu'))
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
})

test('autoroute: a track without d connects every pad of its net', () => {
  const b = compileBoard(board(
    smd('J1', 3, 3, 'A'), smd('J2', 15, 3, 'A'), smd('J3', 9, 8, 'A'), smd('X1', 9, 3, 'B', 2),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.25 }),
  ))
  assert.ok(tracks(b, 'A').length >= 2)
  assert.equal(b.unconnected, 0)
  assert.deepEqual(errors(b), [])
})

test('autoroute: the straight router draws one segment', () => {
  const b = compileBoard(board(
    smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.25, d: { start: 'J1.1', end: 'J2.1', algorithm: 'straight' } }),
  ))
  const ts = tracks(b, 'A')
  assert.equal(ts.length, 1)
  assert.deepEqual(ts[0].pts, [[5, 5], [15, 5]])
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
})

test('autoroute: an enclosed pad is a route-failed finding naming the net, and a CompileError with strict', () => {
  const kids = [smd('J1', 5, 5, 'SIG'), smd('J2', 15, 5, 'SIG'),
    h('track', { net: 'B', layer: 'F.Cu', width: 0.5, d: 'M3 3 L7 3 L7 7 L3 7 Z' }),
    h('track', { net: 'SIG', layer: 'F.Cu', width: 0.25, d: { start: 'J1.1', end: 'J2.1', layers: ['F.Cu'] } })]
  const b = compileBoard(board(...kids))
  const [f] = failedOf(b)
  assert.equal(failedOf(b).length, 1)
  assert.match(f.message, /SIG/)
  assert.match(f.message, /F\.Cu/)
  assert.equal(b.unconnected, 1, 'the ratsnest keeps the connection')
  assert.throws(() => compileBoard(strictBoard(...kids)), e => e instanceof CompileError && /SIG/.test(e.message) && /F\.Cu/.test(e.message))
})

test('autoroute: resolvePos finds the pad centre', () => {
  const b = compiledBase()
  const p = resolvePos(b, 'J1.2', 'F.Cu')
  nearPt([p.x, p.y], [2, 4.54], 1e-12)
  assert.equal(p.layer, 'F.Cu')
  assert.equal(resolvePos(b, 'J1.2', 'B.Cu').layer, 'B.Cu')
  assert.deepEqual(resolvePos(b, [1, '2mm', 'bottom'], 'F.Cu'), { x: 1, y: 2, layer: 'B.Cu' })
  assert.throws(() => resolvePos(b, 'J9.1', 'F.Cu'), CompileError)
  assert.throws(() => resolvePos(b, 'J1.7', 'F.Cu'), CompileError)
})

test('autoroute: a custom RouteFn gets a Layout and its geometry is placed', () => {
  let seen
  const fn = (req, layout) => {
    seen = { req, layout, obs: layout.obstacles('F.Cu', req.net, req.width), free: layout.isFree('F.Cu', 10, 2, req.net, req.width), blocked: layout.isFree('F.Cu', 10, 5, req.net, req.width) }
    return { tracks: [{ layer: 'F.Cu', pts: [[req.start.x, req.start.y], [7, 2], [13, 2], [req.end.x, req.end.y]] }], vias: [] }
  }
  const b = compileBoard(board(
    smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'), smd('X1', 10, 5, 'B', 3),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.25, d: { start: 'J1.1', end: 'J2.1', algorithm: fn } }),
  ))
  assert.equal(typeof seen.layout.obstacles, 'function')
  assert.equal(typeof seen.layout.isFree, 'function')
  assert.ok(seen.obs.length >= 1)
  assert.equal(seen.free, true)
  assert.equal(seen.blocked, false)
  assert.deepEqual(seen.req.layers, ['F.Cu'])
  assert.deepEqual(tracks(b, 'A')[0].pts, [[5, 5], [7, 2], [13, 2], [15, 5]])
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
})

// ---- route(a, b, path) ----

afterEach(() => resetDefaults())
const segs = t => t.pts.slice(1).map((p, i) => [t.pts[i], p])
const axisOnly = ts => ts.every(t => segs(t).every(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9))
const hasDiagonal = ts => ts.some(t => segs(t).some(([a, b]) => Math.abs(a[0] - b[0]) > 0.05 && Math.abs(a[1] - b[1]) > 0.05))
const near = (a, b, tol = 1e-6) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol
const clean = b => { assert.deepEqual(errors(b), []); assert.equal(b.unconnected, 0) }

test('route(a, b): omitted path autoroutes all the way, the net comes from the pads, the width from minTrackWidth', () => {
  const b = compileBoard(board(smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'), smd('X1', 10, 5, 'B', 3), route('J1.1', 'J2.1')))
  const ts = tracks(b, 'A')
  assert.ok(ts.length >= 1 && ts[0].pts.length > 2, 'bends around X1')
  for (const t of ts) assert.equal(t.width, BASE.minTrackWidth)
  clean(b)
})

test('route(a, b, path): @ places a via at the cursor and the route goes on on that layer', () => {
  const b = compileBoard(board(smd('J1', 3, 5, 'A'), route('J1.1', '15 5 B.Cu', 'H 8 @B.Cu XZ').width(0.25)))
  const [v] = vias(b)
  assert.equal(vias(b).length, 1)
  assert.deepEqual(v.at, [8, 5])
  assert.deepEqual(v.layers, ['F.Cu', 'B.Cu'])
  const ts = tracks(b, 'A')
  assert.deepEqual(ts.find(t => t.layer === 'F.Cu').pts, [[3, 5], [8, 5]])
  const back = ts.find(t => t.layer === 'B.Cu')
  nearPt(back.pts[0], [8, 5]); nearPt(back.pts[back.pts.length - 1], [15, 5])
  assert.deepEqual(errors(b), [])
})

test('route(a, b, path): @bottom and U B.Cu place the same via as @B.Cu', () => {
  const at = path => compileBoard(board(smd('J1', 3, 5, 'A'), route('J1.1', '15 5 B.Cu', path).width(0.25)))
  const ref = vias(at('H 8 @B.Cu XZ'))
  assert.deepEqual(vias(at('H 8 @bottom XZ')), ref)
  assert.deepEqual(vias(at('H 8 @ B.Cu XZ')), ref)
  assert.deepEqual(vias(at('H 8 U B.Cu XZ')), ref)
})

test('route(a, b, path): three automatic legs through two control points, 0 DRC errors', () => {
  const b = compileBoard(board(smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('X1', 10, 5, 'B', 2),
    route('J1.1', 'J2.1', 'X 7 2 X 13 8 XZ').width(0.25)))
  const pts = tracks(b, 'A').flatMap(t => t.pts)
  assert.ok(pts.some(p => near(p, [7, 2])) && pts.some(p => near(p, [13, 8])), 'passes through both control points')
  clean(b)
})

test('route(a, b, path): manual legs mix with automatic ones and are placed as drawn', () => {
  const b = compileBoard(board(smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('X1', 10, 3, 'B', 2),
    route('J1.1', 'J2.1', 'L 6 3 X 14 3 Z').width(0.25)))
  const ts = tracks(b, 'A')
  assert.ok(ts.some(t => t.pts.length === 2 && near(t.pts[0], [3, 5]) && near(t.pts[1], [6, 3])), 'the L leg')
  assert.ok(ts.some(t => t.pts.length === 2 && near(t.pts[0], [14, 3]) && near(t.pts[1], [17, 5])), 'the Z leg')
  assert.ok(ts.length >= 3)
  clean(b)
})

test('route(a, b, path): relative commands work in the frame of a rotated group', () => {
  const r1 = compileBoard(board(h('g', { at: '5 5 90deg' }, route('0 0', '0 4', 'v 2 Z').net('A').width(0.25))))
  const r2 = compileBoard(board(h('g', { at: '5 5 90deg' }, route('0 0', '0 4', 'V 2 Z').net('A').width(0.25))))
  // one track per command, joined here into the polyline they draw
  const joined = ts => [ts[0].pts[0], ...ts.flatMap(x => x.pts.slice(1))]
  const t = { pts: joined(tracks(r1, 'A')) }
  assert.deepEqual(t.pts, joined(tracks(r2, 'A')))
  nearPt(t.pts[0], [5, 5], 1e-9)
  nearPt(t.pts[1], [(t.pts[0][0] + t.pts[2][0]) / 2, (t.pts[0][1] + t.pts[2][1]) / 2], 1e-9)
  assert.ok(Math.hypot(t.pts[2][0] - 5, t.pts[2][1] - 5) > 3.99)
})

test('route(a, b, path): Z onto a pad on another layer is an error that says to change layer', () => {
  assert.throws(() => compileBoard(board(smd('J1', 3, 5, 'A'), smd('J2', 15, 5, 'A'), route('J1.1', 'J2.1', 'H 8 @B.Cu Z'))),
    e => e instanceof CompileError && /Z draws on B\.Cu, but J2\.1 is on F\.Cu/.test(e.message))
})

test('route(a, b): net inference, two nets and no net are errors', () => {
  assert.throws(() => compileBoard(board(smd('J1', 3, 5, 'A'), smd('J2', 15, 5, 'B'), route('J1.1', 'J2.1'))),
    e => e instanceof CompileError && /joins two nets, A and B/.test(e.message))
  assert.throws(() => compileBoard(board(route('2 2', '8 2'))), e => e instanceof CompileError && /no pad at either end, give its net with \.net\(n\)/.test(e.message))
  assert.throws(() => compileBoard(board(smd('J1', 3, 5, 'A'), route('J1.1', '8 5').net('B'))), e => e instanceof CompileError && /given the net B, but J1\.1 is on A/.test(e.message))
  const b = compileBoard(board(route('2 2', '8 2').net('A')))
  assert.equal(tracks(b, 'A').length, 1)
  const one = compileBoard(board(smd('J1', 3, 5, 'A'), route('J1.1', '8 5')))
  assert.equal(tracks(one, 'A').length, 1, 'one pad is enough')
})

test('route(a, b): the builder methods change the pending route and return it', () => {
  const r = route('J1.1', 'J2.1', 'XZ')
  assert.equal(r.type, 'track')
  assert.equal(r.width(0.3).layer('B.Cu').layers(['B.Cu', 'F.Cu']).vias({ drill: 0.3, size: 0.6 }).rules({ bend: '90' }).priority(2).net('A'), r)
  assert.deepEqual(r.props, { from: 'J1.1', to: 'J2.1', path: 'XZ', width: 0.3, layer: 'B.Cu', layers: ['B.Cu', 'F.Cu'], via: { drill: 0.3, size: 0.6 }, auto: { bend: '90', priority: 2 }, net: 'A' })
  r.vias(false)
  assert.equal(r.props.auto.maxVias, 0)
  r.vias(true)
  assert.equal(r.props.auto.maxVias, undefined)
  assert.deepEqual(Object.keys(r), ['$$', 'type', 'props', 'children'], 'the methods are not enumerable')
})

test('route(a, b): the source range lands in a trailing argument or in an object end, never in the route', () => {
  const code = `import { route } from '@pcbjs/core'\nroute(J1[3], Q1[1], 'V 1 XZ').width(1)\nroute(Q1[2], { at: '1 2', layer: 'B.Cu' })\n`
  const out = transformSourceRanges(code, '/p/a.ts', 'a.ts').code
  assert.ok(out.includes(`route(J1[3], Q1[1], 'V 1 XZ', { __src: { file: "a.ts", line: 2, col: 1, endLine: 2, endCol: 29, lit: { line: 2, col: 22 }, raw: true } }).width(1)`), out)
  const src = { file: 'a.ts', line: 2, col: 1 }
  const r = route('J1.1', 'J2.1', 'V 1 XZ', { __src: src })
  assert.deepEqual(r.props, { from: 'J1.1', to: 'J2.1', path: 'V 1 XZ', __src: src })
  const q = route('J1.1', { at: '1 2', layer: 'B.Cu', __src: src })
  assert.deepEqual(q.props, { from: 'J1.1', to: { at: '1 2', layer: 'B.Cu' }, __src: src })
})

test('autoroute: bend 90 makes only horizontal and vertical segments', () => {
  const b = compileBoard(board(smd('J1', 3, 2, 'A'), smd('J2', 15, 8, 'A'), route('J1.1', 'J2.1').width(0.25).rules({ bend: '90' })))
  assert.ok(axisOnly(tracks(b, 'A')))
  const d = compileBoard(board(smd('J1', 3, 2, 'A'), smd('J2', 15, 8, 'A'), route('J1.1', 'J2.1').width(0.25)))
  assert.ok(hasDiagonal(tracks(d, 'A')), 'the default 45 makes a diagonal')
  clean(b)
})

test('autoroute: prefer sends a long vertical run to the layer that prefers v', () => {
  const run = auto => compileBoard(board(smd('J1', 5, 1.5, 'A'), smd('J2', 5, 8.5, 'A'),
    route('J1.1', 'J2.1').width(0.25).layers(['F.Cu', 'B.Cu']).rules({ viaCost: 1, ...auto })))
  assert.equal(vias(run({})).length, 0, 'without prefer it stays on F.Cu')
  const b = run({ prefer: { 'F.Cu': 'h', 'B.Cu': 'v' } })
  assert.equal(vias(b).length, 2)
  assert.ok(tracks(b, 'A').some(t => t.layer === 'B.Cu'))
})

test('autoroute: vias(false), maxVias 0, makes a change of layer unroutable with a clear error', () => {
  assert.throws(() => compileBoard(strictBoard(smd('J1', 3, 5, 'A'), route('J1.1', '15 5 B.Cu').vias(false))),
    e => e instanceof CompileError && /changes layer from F\.Cu to B\.Cu, but vias are off for this route, maxVias is 0/.test(e.message))
  assert.match(failedOf(compileBoard(board(smd('J1', 3, 5, 'A'), route('J1.1', '15 5 B.Cu').rules({ maxVias: 0 }))))[0].message, /maxVias is 0/)
  const ok = compileBoard(board(smd('J1', 3, 5, 'A'), route('J1.1', '15 5 B.Cu').rules({ maxVias: 1 })))
  assert.equal(vias(ok).length, 1)
})

test('autoroute: a failed leg names its index and its ends', () => {
  const kids = [smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'),
    h('track', { net: 'B', layer: 'F.Cu', width: 0.5, d: 'M8 3 L12 3 L12 7 L8 7 Z' }),
    route('J1.1', 'J2.1', 'X 10 5 XZ').layers(['F.Cu'])]
  assert.throws(() => compileBoard(strictBoard(...kids)),
    e => e instanceof CompileError && /automatic leg 1 of 2, net A from \(3, 5\) on F\.Cu to \(10, 5\) on F\.Cu/.test(e.message))
  const [f] = failedOf(compileBoard(board(...kids)))
  assert.match(f.message, /leg 1 of 2 of net A from \(3, 5\) on F\.Cu to \(10, 5\) on F\.Cu/)
  assert.deepEqual([f.route.leg, f.route.legs], [1, 2])
})

test('autoroute: priority runs a later route first, so it gets the straight path', () => {
  const parts = [smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('K1', 10, 2, 'B'), smd('K2', 10, 8, 'B')]
  const plain = compileBoard(board(...parts, route('J1.1', 'J2.1').width(0.25), route('K1.1', 'K2.1').width(0.25)))
  assert.equal(tracks(plain, 'A')[0].pts.length, 2, 'declared first, A runs straight')
  const pri = compileBoard(board(...parts, route('J1.1', 'J2.1').width(0.25), route('K1.1', 'K2.1').width(0.25).priority(1)))
  assert.equal(tracks(pri, 'B')[0].pts.length, 2, 'with priority 1, B runs straight')
  assert.ok(tracks(pri, 'A').flatMap(t => t.pts).length > 2, 'and A goes around it')
  clean(pri)
})

test('autoroute: a route declared before the parts it connects and the parts in its way still sees them', () => {
  const b = compileBoard(board(route('J1.1', 'J2.1').width(0.25), smd('X1', 10, 5, 'B', 3), smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A')))
  assert.ok(tracks(b, 'A')[0].pts.length > 2, 'bends around X1')
  clean(b)
})

test('autoroute: board-wide defaults flow from defineDefaultBoard, a preset and a variant target; the route\'s own wins', () => {
  const pads = [smd('J1', 3, 2, 'A'), smd('J2', 15, 8, 'A')]
  assert.equal(BASE_BOARD.autoroute.bend, '45')
  assert.equal(BASE_BOARD.autoroute.viaCost, 5)
  defineDefaultBoard({ autoroute: { bend: '90' } })
  assert.ok(axisOnly(tracks(compileBoard(board(...pads, route('J1.1', 'J2.1').width(0.25))), 'A')), 'from defineDefaultBoard')
  assert.ok(hasDiagonal(tracks(compileBoard(board(...pads, route('J1.1', 'J2.1').width(0.25).rules({ bend: '45' }))), 'A')), 'the route wins')
  resetDefaults()
  const Fab = bindPCB({ name: 'Ortho 2-Layer', fab: 'Ortho', stackup: twoLayer(), rules: BASE, autoroute: { bend: '90' } })
  assert.deepEqual(Fab.preset.autoroute, { bend: '90' })
  const viaFab = (...kids) => h(Fab, { name: 'P' }, edge(), ...kids)
  assert.ok(axisOnly(tracks(compileBoard(viaFab(...pads, route('J1.1', 'J2.1').width(0.25))), 'A')), 'from the preset')
  assert.ok(hasDiagonal(tracks(compileBoard(h(Fab, { name: 'P', autoroute: { bend: '45' } }, edge(), ...pads, route('J1.1', 'J2.1').width(0.25))), 'A')), '<PCB autoroute> over the preset')
  const V = variants({ name: 'Ortho', board: { autoroute: { bend: '90' } } }, { name: 'Free' })
  const [o, f] = compileBoards(h(V, { name: 'V' }, edge(), ...pads, route('J1.1', 'J2.1').width(0.25)))
  assert.ok(axisOnly(tracks(o, 'A')) && hasDiagonal(tracks(f, 'A')), 'per variant target')
  assert.throws(() => compileBoard(h(PCB, { name: 'X', autoroute: { bend: '30' } }, edge())), e => e instanceof CompileError && /bend must be '45' or '90'/.test(e.message))
  assert.throws(() => compileBoard(h(PCB, { name: 'X', autoroute: { pich: 1 } }, edge())), /unknown parameter "pich"/)
})

test('autoroute: avoid keeps a route out of a soft keepout when there is room', () => {
  const run = auto => compileBoard(board(smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), route('J1.1', 'J2.1').width(0.25).rules(auto)))
  assert.equal(tracks(run({}), 'A')[0].pts.length, 2)
  const b = run({ avoid: [{ x: 8, y: 3, w: 4, h: 4 }] })
  const pts = tracks(b, 'A').flatMap(t => t.pts)
  assert.ok(pts.length > 2 && pts.every(p => !(p[0] > 8 && p[0] < 12 && p[1] > 3 && p[1] < 7)), 'goes around the rectangle')
  clean(b)
})

// ---- router hardening ----

const shorts = b => b.drc.filter(d => d.rule === 'short' || d.rule === 'clearance')
const holeErrors = b => b.drc.filter(d => d.rule === 'hole-to-hole' || d.rule === 'hole-to-copper')
const inPad = (pad, [x, y]) => { const r = pad.poly; let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c } return c }
const holeGap = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) - a.drill / 2 - b.drill / 2

test('autoroute: a back-side pad stays an obstacle when another ring on its layer lies lower (the badge and stm32 short)', () => {
  // A part on the back is mirrored, so its pad rings run clockwise. The router offset every ring of a layer as one set, and
  // Clipper took the clockwise pad for a hole whenever the lowest ring on the layer ran the usual way: here the X track.
  const coin = h('footprint', { ref: 'BT1', at: [10, 5], side: 'B', nets: { 1: 'GND' } }, h('pad', { num: 1, size: 4, shape: 'circle', type: 'smd' }))
  const low = h('track', { net: 'X', layer: 'B.Cu', width: 0.3, d: 'M2 9 L18 9' })
  const b = compileBoard(board(coin, low, route('2 5 B.Cu', '18 5 B.Cu').net('A').width(0.2).layers(['B.Cu'])))
  assert.deepEqual(shorts(b), [])
  assert.ok(tracks(b, 'A').flatMap(t => t.pts).length > 2, 'the route bends around the coin cell contact')
  // the stm32 case: 0603 capacitors on the back, turned 180 degrees, under a straight back-side route
  const cap = (ref, x) => h('footprint', { ref, at: [x, 5, 180], side: 'B', nets: { 1: 'V', 2: 'G' } },
    h('pad', { num: 1, at: [-0.8, 0], size: [0.9, 0.95], shape: 'rect', type: 'smd' }), h('pad', { num: 2, at: [0.8, 0], size: [0.9, 0.95], shape: 'rect', type: 'smd' }))
  const s = compileBoard(board(cap('C1', 8), cap('C2', 12), low, route('2 5 B.Cu', '18 5 B.Cu').net('A').width(0.2).layers(['B.Cu'])))
  assert.deepEqual(shorts(s), [])
})

test('autoroute: a via keeps minHoleToHole from every hole, of any net', () => {
  const hole = h('footprint', { ref: 'H1', at: [17, 6] }, h('pad', { num: '', size: 1, drill: 1, type: 'npth' }))
  const b = compileBoard(board(smd('J1', 3, 5, 'A'), hole, route('J1.1', '17 5 B.Cu').width(0.2)))
  const [v] = vias(b)
  assert.equal(vias(b).length, 1)
  assert.ok(Math.hypot(v.at[0] - 17, v.at[1] - 6) >= 0.5 + BASE.minHoleToHole + v.drill / 2, `via at ${v.at} is too close to the hole`)
  assert.deepEqual(holeErrors(b), [])
  // a through-hole end of the same net is reached on the layer the route arrives on, without a via beside its hole
  const tht = h('footprint', { ref: 'J2', at: [15, 5], nets: { 1: 'A' } }, h('pad', { num: 1, size: 1.7, drill: 1, type: 'tht' }))
  const wall = h('track', { net: 'B', layer: 'F.Cu', width: 0.25, d: 'M12.5 2.5 L17.5 2.5 L17.5 7.5 L12.5 7.5 Z' })
  const t = compileBoard(board(smd('J1', 3, 5, 'A'), tht, wall, route('J1.1', 'J2.1').width(0.2)))
  assert.equal(vias(t).length, 1, 'one via down, none back up beside the hole')
  for (const v of vias(t)) assert.ok(holeGap(v, { at: [15, 5], drill: 1 }) >= BASE.minHoleToHole)
  assert.deepEqual(holeErrors(t), [])
  assert.deepEqual(shorts(t), [])
  assert.equal(t.unconnected, 0)
})

test('autoroute: two routes to one back pad do not stack their vias', () => {
  const back = h('footprint', { ref: 'K1', at: [15, 5], side: 'B', nets: { 1: 'A' } }, h('pad', { num: 1, size: 1, type: 'smd' }))
  const b = compileBoard(board(smd('J1', 3, 3, 'A'), smd('J2', 3, 7, 'A'), back, route('J1.1', 'K1.1').width(0.2), route('J2.1', 'K1.1').width(0.2).direct()))
  // the second route reaches the pad itself, so each route brings its own via
  const vs = vias(b)
  assert.ok(vs.length >= 2)
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) assert.ok(holeGap(vs[i], vs[j]) >= BASE.minHoleToHole, 'vias keep minHoleToHole')
  const pad = b.items.find(i => i.kind === 'pad' && i.ref === 'K1')
  for (const v of vs) assert.ok(!inPad(pad, v.at), 'no via inside the pad')
  assert.deepEqual(holeErrors(b), [])
})

test('autoroute: a via never lands inside an SMD pad unless the route sets viaInPad', () => {
  // the pad is fenced in on F.Cu so tightly that the only way down is a via inside it
  const fence = h('track', { net: 'B', layer: 'F.Cu', width: 0.2, d: 'M3.75 3.75 L6.25 3.75 L6.25 6.25 L3.75 6.25 Z' })
  const kids = [h('footprint', { ref: 'J1', at: [5, 5], nets: { 1: 'A' } }, h('pad', { num: 1, size: 1, shape: 'rect', type: 'smd' })), fence]
  const no = compileBoard(board(...kids, route('J1.1', '15 5 B.Cu').width(0.2)))
  assert.equal(vias(no).length, 0)
  assert.equal(no.drc.filter(d => d.rule === 'route-failed').length, 1)
  const yes = compileBoard(board(...kids, route('J1.1', '15 5 B.Cu').width(0.2).rules({ viaInPad: true })))
  const pad = yes.items.find(i => i.kind === 'pad' && i.ref === 'J1')
  assert.equal(vias(yes).length, 1)
  assert.ok(inPad(pad, vias(yes)[0].at), 'the via is in the pad')
  assert.deepEqual(errors(yes), [])
  assert.throws(() => compileBoard(board(...kids, route('J1.1', '15 5 B.Cu').rules({ viaInPad: 'yes' }))), /viaInPad must be true or false/)
})

test('autoroute: a through via from a two-layer route respects copper on the inner layers it spans', () => {
  const b4 = (...kids) => h(PCB, { name: 'Route4', copper: 4 }, edge(), ...kids)
  const stripe = h('track', { net: 'B', layer: 'In1.Cu', width: 0.5, d: 'M17 0.6 L17 9.4' })
  const b = compileBoard(b4(smd('J1', 3, 5, 'A'), stripe, route('J1.1', '17 5 B.Cu').width(0.2).layers(['F.Cu', 'B.Cu'])))
  const [v] = vias(b)
  assert.equal(vias(b).length, 1)
  assert.deepEqual(v.layers, ['F.Cu', 'B.Cu'])
  assert.ok(Math.abs(v.at[0] - 17) >= 0.25 + BASE.clearance + v.size / 2, `via at ${v.at} overlaps the In1.Cu stripe`)
  assert.deepEqual(shorts(b), [])
})

test('autoroute: an SMD to SMD leg that one layer cannot carry widens to the outer layers by itself', () => {
  const wall = h('track', { net: 'B', layer: 'F.Cu', width: 0.4, d: 'M10 0.7 L10 9.3' })
  const b = compileBoard(board(smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'), wall, route('J1.1', 'J2.1').width(0.2)))
  assert.equal(vias(b).length, 2)
  assert.ok(tracks(b, 'A').some(t => t.layer === 'B.Cu'))
  clean(b)
  // a whole-net track widens the same way
  const w = compileBoard(board(smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'), wall, h('track', { net: 'A', layer: 'F.Cu', width: 0.2 })))
  assert.equal(w.unconnected, 0)
  assert.deepEqual(errors(w), [])
  // set layers are kept as given
  const f = compileBoard(board(smd('J1', 5, 5, 'A'), smd('J2', 15, 5, 'A'), wall, route('J1.1', 'J2.1').width(0.2).layers(['F.Cu'])))
  assert.equal(f.drc.filter(d => d.rule === 'route-failed').length, 1)
})

// ---- variants route once ----

test('variants: the targets route once under the strictest rules and share the copper, unless a target routes separately', async () => {
  const { routers } = await import('@pcbjs/compile')
  let calls = 0
  const counted = (req, ctx) => { calls++; return routers.maze(req, ctx) }
  const parts = [smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('X1', 10, 5, 'B', 3), route('J1.1', 'J2.1').width(0.2).rules({ algorithm: counted })]
  const V = variants({ name: 'Tight', rules: { clearance: 0.15 } }, { name: 'Loose', rules: { clearance: 0.3 } })
  const [t, l] = compileBoards(h(V, { name: 'V' }, edge(), ...parts))
  assert.equal(calls, 1, 'one routing for both targets')
  assert.deepEqual(tracks(t, 'A').map(x => x.pts), tracks(l, 'A').map(x => x.pts))
  assert.equal(t.routing.shared.rules.clearance, 0.3)
  assert.deepEqual(t.routing.shared.targets, ['Tight', 'Loose'])
  clean(t); clean(l)
  assert.equal(t.rules.clearance, 0.15, 'each target keeps its own rules for DRC')
  calls = 0
  const S = variants({ name: 'Tight', rules: { clearance: 0.15 } }, { name: 'Loose', rules: { clearance: 0.3 }, routeSeparately: true })
  const [t2, l2] = compileBoards(h(S, { name: 'V' }, edge(), ...parts))
  assert.equal(calls, 2)
  assert.equal(t2.routing.shared, undefined)
  assert.equal(l2.routing.shared, undefined)
  assert.throws(() => variants({ name: 'X', routeSeparately: 'yes' }), /routeSeparately must be true or false/)
})

// ---- route cache and locks ----

const wide = (name, ...kids) => h(PCB, { name }, edge(40, 20), ...kids)
const cacheParts = () => [smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('X1', 10, 5, 'B', 3), route('J1.1', 'J2.1').width(0.25)]

test('route cache: an unrelated edit reuses every leg, an edit near a leg reroutes it', () => {
  const first = compileBoard(wide('Cache', ...cacheParts()))
  const legs = first.routing.legs
  assert.equal(legs, 1)
  const silk = compileBoard(wide('Cache', ...cacheParts(), h('text', { layer: 'F.SilkS', at: '30 18', size: 1 }, 'rev 2')))
  assert.equal(silk.routing.cached, legs, 'a silk edit keeps the route')
  const far = compileBoard(wide('Cache', ...cacheParts(), smd('K1', 35, 17, 'C')))
  assert.equal(far.routing.cached, legs, 'a part far away keeps the route')
  assert.deepEqual(tracks(far, 'A').map(t => t.pts), tracks(first, 'A').map(t => t.pts))
  const close = compileBoard(wide('Cache', ...cacheParts(), smd('K1', 10, 2.2, 'C', 1)))
  assert.equal(close.routing.cached, 0, 'a part in the corridor reroutes')
  clean(close)
  const off = compileBoard(wide('Cache', ...cacheParts()), { routeCache: false })
  assert.equal(off.routing.cached, 0)
})

test('route lock: a locked route keeps its legs until its ends or its path change, and survives on disk', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { clearRouteCache } = await import('@pcbjs/compile/route-cache')
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-routes-'))
  try {
    const opts = { routeCache: { dir } }
    const ends = (j2 = smd('J2', 17, 5, 'A')) => [smd('J1', 3, 5, 'A'), j2]
    const bent = compileBoard(wide('Lock', ...ends(), smd('X1', 10, 5, 'B', 3), route('J1.1', 'J2.1').width(0.25).lock()), opts)
    const pts = tracks(bent, 'A').map(t => t.pts)
    assert.ok(pts.flat().length > 2)
    const file = JSON.parse(readFileSync(join(dir, 'Lock.json'), 'utf8'))
    assert.equal(Object.keys(file.groups[''].locks).length, 1)
    clearRouteCache()
    // X1 is gone: an unlocked route would now run straight, the locked one keeps its bend, read back from the file
    const kept = compileBoard(wide('Lock', ...ends(), route('J1.1', 'J2.1').width(0.25).lock()), opts)
    assert.equal(kept.routing.locked, 1)
    assert.deepEqual(tracks(kept, 'A').map(t => t.pts), pts)
    // moving an end releases it
    const moved = compileBoard(wide('Lock', ...ends(smd('J2', 17, 6, 'A')), route('J1.1', 'J2.1').width(0.25).lock()), opts)
    assert.equal(moved.routing.locked, 0)
    clean(moved)
    // and so does a different route path
    const path = compileBoard(wide('Lock', ...ends(), route('J1.1', 'J2.1', 'X 10 8 XZ').width(0.25).lock()), opts)
    assert.equal(path.routing.locked, 0)
    const r = route('J1.1', 'J2.1').lock()
    assert.equal(r.props.lock, true)
    r.lock(false)
    assert.equal(r.props.lock, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ---- negotiation ----

// A runs straight across the board between pads too close to the edges to pass, so routed first it walls B1 off from B2. B
// can only route through A; A can go round B1 once B is there.
const ripParts = (lock = false) => {
  const a = route('A1.1', 'A2.1').width(0.25).layers(['F.Cu'])
  return [smd('A1', 0.9, 5, 'A'), smd('A2', 19.1, 5, 'A'), smd('B1', 10, 1.6, 'B'), smd('B2', 10, 8.4, 'B'),
    lock ? a.lock() : a, route('B1.1', 'B2.1').width(0.25).layers(['F.Cu'])]
}
const ripBoard = (autoroute, lock) => h(PCB, { name: 'Rip', ...(autoroute ? { autoroute } : {}) }, edge(), ...ripParts(lock))
const geometry = b => b.items.filter(i => i.kind === 'track' || i.kind === 'via').map(i => [i.kind, i.net, i.layer, i.pts ?? i.at])
/** Every pair of tracks and vias of different nets keeps the clearance, measured here rather than trusted to DRC. */
const segDist = (a, b, c, d) => {
  const ps = (p, u, v) => { const dx = v[0] - u[0], dy = v[1] - u[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l)) : 0; return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy) }
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  if (o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0) return 0
  return Math.min(ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b))
}
const copperClear = (b, gap = BASE.clearance) => {
  const ts = tracks(b)
  for (const x of ts) for (const y of ts) {
    if (x.id >= y.id || x.net === y.net || x.layer !== y.layer) continue
    for (let i = 1; i < x.pts.length; i++) for (let j = 1; j < y.pts.length; j++)
      assert.ok(segDist(x.pts[i - 1], x.pts[i], y.pts[j - 1], y.pts[j]) >= gap + (x.width + y.width) / 2 - 1e-6, `${x.net} and ${y.net} keep the clearance on ${x.layer}`)
  }
}

test('negotiation: two routes that block each other in declaration order both route, and ripup 0 brings the failure back', async () => {
  const { clearRouteCache } = await import('@pcbjs/compile/route-cache')
  clearRouteCache()
  const old = compileBoard(ripBoard({ ripup: 0 }))
  const [f] = failedOf(old)
  assert.equal(failedOf(old).length, 1)
  assert.equal(f.route.net, 'B')
  assert.equal(old.routing.ripped, 0)
  assert.equal(old.routing.rounds, undefined)
  clearRouteCache()
  const b = compileBoard(ripBoard())
  assert.deepEqual(failedOf(b), [])
  clean(b)
  copperClear(b)
  assert.ok(b.routing.ripped >= 1)
  assert.ok(b.routing.rounds >= 1)
  assert.equal(b.routing.legs, 2)
  assert.equal(b.routing.routed, 2)
  assert.equal(b.routing.failed, 0)
  // B runs straight, A goes round one of B's pads
  assert.deepEqual(tracks(b, 'B').map(t => t.pts), [[[10, 1.6], [10, 8.4]]])
  assert.ok(tracks(b, 'A').some(t => t.pts.length > 2))
})

// Two routes across the board and three down it, every one between pads at the edges, on one layer: routed in order the two
// across wall off the three down, which only fit once the two across go round the ends of the others.
const tangle = (autoroute, name = 'Tangle') => h(PCB, { name, ...(autoroute ? { autoroute } : {}) }, edge(),
  smd('A1', 0.9, 4.5, 'A'), smd('A2', 19.1, 4.5, 'A'), smd('E1', 0.9, 6, 'E'), smd('E2', 19.1, 6, 'E'),
  ...[5, 10, 15].flatMap((x, i) => { const n = 'BCD'[i]; return [smd(`${n}1`, x, 1.6, n), smd(`${n}2`, x, 8.4, n)] }),
  ...['A', 'E', 'B', 'C', 'D'].map(n => route(`${n}1.1`, `${n}2.1`).width(0.25).layers(['F.Cu'])))

test('negotiation: a tangle that no order routes on one layer routes clean, with the copper of every net clear of the others', () => {
  const plain = compileBoard(tangle({ ripup: 0 }), { routeCache: false })
  assert.equal(plain.routing.failed, 3)
  const b = compileBoard(tangle(), { routeCache: false })
  assert.deepEqual(failedOf(b), [])
  clean(b)
  copperClear(b)
  assert.equal(b.routing.routed, 5)
  for (const n of ['B', 'C', 'D']) assert.equal(tracks(b, n).length, 1, `${n} runs straight`)
})

test('negotiation: deterministic, and the next compile takes every leg from the cache and gives the same items, from memory and from disk', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { clearRouteCache } = await import('@pcbjs/compile/route-cache')
  clearRouteCache()
  const one = compileBoard(tangle(), { routeCache: false })
  const two = compileBoard(tangle(), { routeCache: false })
  assert.deepEqual(two.items, one.items, 'the same items, ids included')
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-rip-'))
  try {
    const opts = { routeCache: { dir } }
    const cold = compileBoard(tangle(), opts)
    assert.ok(cold.routing.ripped >= 1)
    assert.deepEqual(cold.items, one.items)
    const warm = compileBoard(tangle(), opts)
    assert.equal(warm.routing.cached, 5, 'every leg, the negotiated ones included')
    assert.equal(warm.routing.ripped, 0)
    assert.deepEqual(warm.items, cold.items, 'the same items, ids included')
    const file = JSON.parse(readFileSync(join(dir, 'Tangle.json'), 'utf8'))
    assert.equal(file.groups[''].order, undefined, 'no stored order')
    clearRouteCache()
    const disk = compileBoard(tangle(), opts)
    assert.equal(disk.routing.cached, 5)
    assert.deepEqual(disk.items, cold.items)
    // a priority edit takes effect with the file in place: the route and the legs around it route again
    const kids = [smd('A1', 0.9, 5, 'A'), smd('A2', 19.1, 5, 'A'), smd('B1', 10, 1.6, 'B'), smd('B2', 10, 8.4, 'B')]
    const pri = p => h(PCB, { name: 'Pri' }, edge(), ...kids, route('A1.1', 'A2.1').width(0.25).layers(['F.Cu']), route('B1.1', 'B2.1').width(0.25).layers(['F.Cu']).priority(p))
    const low = compileBoard(pri(0), opts)
    const high = compileBoard(pri(1), opts)
    assert.ok(high.routing.cached < 2, 'the edited route routes again')
    assert.equal(high.routing.ripped, 0, 'B routes first now, A goes round it in order')
    assert.deepEqual(tracks(high, 'B').map(t => t.pts), [[[10, 1.6], [10, 8.4]]])
    assert.deepEqual(tracks(low, 'B').map(t => t.pts), [[[10, 1.6], [10, 8.4]]])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('negotiation: a failed leg is cached as failed and not tried again until the board changes', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-fail-'))
  try {
    const opts = { routeCache: { dir } }
    const cold = compileBoard(ripBoard({ ripup: 0 }), opts)
    const warm = compileBoard(ripBoard({ ripup: 0 }), opts)
    assert.equal(warm.routing.cached, 1)
    assert.equal(warm.routing.failed, 1)
    assert.deepEqual(failedOf(warm).map(f => f.message), failedOf(cold).map(f => f.message))
    assert.deepEqual(warm.items, cold.items)
    // another ripup bound tries it again
    const neg = compileBoard(ripBoard(), opts)
    assert.deepEqual(failedOf(neg), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('negotiation: a lock pins a stored result only; a locked route with none negotiates like any other', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-lock-'))
  try {
    const opts = { routeCache: { dir } }
    // a fresh route file: A has no stored result, so it moves for B, and the lock then holds what negotiation found
    const fresh = compileBoard(ripBoard(undefined, true), opts)
    assert.deepEqual(failedOf(fresh), [])
    clean(fresh)
    const again = compileBoard(ripBoard(undefined, true), opts)
    assert.equal(again.routing.locked, 1)
    assert.deepEqual(geometry(again), geometry(fresh))
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const dir2 = mkdtempSync(join(tmpdir(), 'pcbjs-lock-'))
  try {
    const opts = { routeCache: { dir: dir2 } }
    // A locked straight across, stored by a compile without negotiation: the lock holds, B cannot pass and fails
    const plain = compileBoard(ripBoard({ ripup: 0 }, true), opts)
    const b = compileBoard(ripBoard(undefined, true), opts)
    assert.equal(b.routing.locked, 1)
    assert.deepEqual(tracks(b, 'A').map(t => t.pts), tracks(plain, 'A').map(t => t.pts))
    assert.equal(failedOf(b).length, 1)
    assert.equal(failedOf(b)[0].route.net, 'B')
  } finally { rmSync(dir2, { recursive: true, force: true }) }
})

test('negotiation: ripup must be a whole number, maxDetour a ratio or { ratio, floor }', () => {
  assert.throws(() => compileBoard(ripBoard({ ripup: -1 })), /ripup must be a whole number/)
  assert.throws(() => compileBoard(ripBoard({ ripup: 1.5 })), /ripup must be a whole number/)
  assert.throws(() => compileBoard(ripBoard({ maxDetour: -1 })), /maxDetour must be/)
  assert.throws(() => compileBoard(ripBoard({ maxDetour: { ratio: 2, span: 3 } })), /maxDetour must be/)
})

test('negotiation: two routes that cannot both exist stop at the ripup bound, and the failure names the route it collides with', () => {
  // B's pads sit at the edges too, so neither route can go round the other
  const kids = [smd('A1', 0.9, 5, 'A'), smd('A2', 19.1, 5, 'A'), smd('B1', 10, 0.9, 'B'), smd('B2', 10, 9.1, 'B'),
    route('A1.1', 'A2.1').width(0.25).layers(['F.Cu']), route('B1.1', 'B2.1').width(0.25).layers(['F.Cu'])]
  const b = compileBoard(h(PCB, { name: 'Stuck', autoroute: { ripup: 3 } }, edge(), ...kids), { routeCache: false })
  assert.equal(b.routing.rounds, 3)
  assert.equal(b.routing.legs, 2)
  assert.equal(b.routing.routed, 1)
  assert.equal(b.routing.failed, 1)
  const [f] = failedOf(b)
  assert.equal(failedOf(b).length, 1)
  assert.match(f.message, /no path found that keeps clear of the route of net [AB]; negotiation stopped after 3 rounds, the ripup bound/)
  clean({ ...b, drc: b.drc.filter(d => d.rule !== 'route-failed' && d.rule !== 'unconnected'), unconnected: 0 })
  copperClear(b)
})

test('autoroute: a waypoint end may not sit inside the clearance of other copper; only a pad end may', () => {
  // a drawn track of net B runs through y = 5; the waypoint of A sits 0.2 mm from its centre line
  const wall = h('track', { net: 'B', layer: 'F.Cu', width: 0.25, d: 'M2 5 L18 5' })
  const b = compileBoard(board(smd('J1', 3, 2, 'A'), smd('J2', 17, 2, 'A'), wall, route('J1.1', 'J2.1', 'X 10 5.2 XZ').width(0.25).layers(['F.Cu'])), { routeCache: false })
  assert.equal(b.drc.filter(d => d.rule === 'clearance' || d.rule === 'short').length, 0)
  const [f] = failedOf(b)
  assert.match(f.message, /leg 1 of 2 .*the end at \(10, 5\.2\) is inside the clearance of other copper/)
  // an autorouted track over the waypoint moves for it
  const over = compileBoard(h(PCB, { name: 'Way' }, edge(), smd('B1', 10, 1.6, 'B'), smd('B2', 10, 8.4, 'B'), smd('J1', 3, 8, 'A'), smd('J2', 17, 8, 'A'),
    route('B1.1', 'B2.1').width(0.25).layers(['F.Cu']), route('J1.1', 'J2.1', 'X 10 5 XZ').width(0.25)), { routeCache: false })
  assert.deepEqual(failedOf(over), [])
  clean(over)
  copperClear(over)
})

test('autoroute: maxDetour bounds how far a leg may wander, and says so when it fails', () => {
  // a wall of net W from the top edge leaves a gap at the bottom only: the way round is about 2.6 times the straight line
  const kids = [smd('J1', 6, 2, 'A'), smd('J2', 14, 2, 'A'), h('track', { net: 'W', layer: 'F.Cu', width: 0.25, d: 'M10 0.5 L10 8.5' })]
  const r = () => route('J1.1', 'J2.1').width(0.25).layers(['F.Cu'])
  const ok = compileBoard(board(...kids, r()), { routeCache: false })
  assert.deepEqual(failedOf(ok), [])
  const tight = compileBoard(h(PCB, { name: 'Route', autoroute: { maxDetour: { ratio: 1.5, floor: 0 } } }, edge(), ...kids, r()), { routeCache: false })
  const [f] = failedOf(tight)
  assert.match(f.message, /no path found within maxDetour, at most 12 mm for 8 mm between its ends/)
  const off = compileBoard(h(PCB, { name: 'Route', autoroute: { maxDetour: 0 } }, edge(), ...kids, r()), { routeCache: false })
  assert.deepEqual(failedOf(off), [])
})

test('autoroute: a pair whose centre line routes but whose pair cannot be laid out counts its legs as failed, not routed', () => {
  const two = (ref, x, y, a, b) => h('footprint', { ref, at: [x, y], nets: { 1: a, 2: b } },
    h('pad', { num: 1, at: [-0.25, 0], size: [0.3, 1], type: 'smd' }), h('pad', { num: 2, at: [0.25, 0], size: [0.3, 1], type: 'smd' }))
  const b = compileBoard(h(PCB, { name: 'Pair' }, edge(20, 20), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DN', 'DP'),
    route(['J1.1', 'J1.2'], ['J2.2', 'J2.1'], 'XZ').width(0.2).gap(0.2)), { routeCache: false })
  assert.equal(failedOf(b).length, 1)
  assert.equal(b.routing.legs, 1)
  assert.equal(b.routing.routed, 0)
  assert.equal(b.routing.failed, 1)
})
