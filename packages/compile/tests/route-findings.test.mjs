import { fp, P, net } from './parts.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { nets, route, keepout, pour, pour as pourFn, via } from '@pcbjs/core'
import { compileBoard, CompileError } from '../dist/index.js'
import { area, intersection, polysToRings } from '../dist/geom.js'

const errors = b => b.drc.filter(d => d.severity === 'error')
const rule = (b, r) => b.drc.filter(d => d.rule === r)
const tracks = (b, net) => b.items.filter(i => i.kind === 'track' && (net === undefined || i.net === net))
const vias = b => b.items.filter(i => i.kind === 'via')
const edge = (w = 20, hh = 10) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const smd = (ref, x, y, net, size = 1) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const board = (...children) => h(PCB, { name: 'Findings' }, edge(), ...children)
const opts = { cache: false }
const src = { file: 'main.tsx', line: 12, col: 5, endLine: 12, endCol: 40 }
const insideRect = ([x, y], x0, y0, x1, y1) => x > x0 && x < x1 && y > y0 && y < y1

test('route: one pad as both ends is a compile error naming the pad', () => {
  assert.throws(
    () => compileBoard(board(smd('J1', 5, 5, 'SIG'), route(P('J1.1'), P('J1.1')).width(0.25)), opts),
    e => e instanceof CompileError && /J1\/1 is both ends/.test(e.message),
  )
})

// ---- route-failed ----

test('route-failed: a leg that cannot be routed is a finding with its source, leg, ends, layers and blockers, and the compile goes on', () => {
  const ring = route('3 3').net(net('B')).width(0.5).L(7, 3).L(7, 7).L(3, 7).L(3, 3)
  const b = compileBoard(
    board(
      smd('J1', 5, 5, 'SIG'),
      smd('J2', 15, 5, 'SIG'),
      ring,
      route(P('J1.1'), P('J2.1'), { __src: src }).layers(['F.Cu']),
      smd('K1', 10, 1.5, 'OK'),
      smd('K2', 17, 1.5, 'OK'),
      route(P('K1.1'), P('K2.1')),
    ),
    opts,
  )
  const [f] = rule(b, 'route-failed')
  assert.equal(rule(b, 'route-failed').length, 1)
  assert.equal(f.severity, 'error')
  assert.deepEqual(f.src, src)
  // the leg's ends are its witness, the layers tried its args, the route and net its refs
  assert.deepEqual(f.args.layers, ['F.Cu'])
  assert.deepEqual([f.args.leg, f.args.fromLayer, f.args.toLayer], ['', 'F.Cu', 'F.Cu'])
  assert.deepEqual(f.witness.segments, [
    [
      [5, 5],
      [15, 5],
    ],
  ])
  assert.deepEqual(f.refs.slice(0, 2), ['route:2', 'net:SIG'], 'the route that failed and its net, then the blockers')
  assert.ok(f.items.length >= 1 && f.items.length <= 5)
  const byId = new Map(b.items.map(i => [i.id, i]))
  for (const id of f.items) assert.notEqual(byId.get(id).net, 'SIG', 'blockers are items of other nets')
  assert.equal(byId.get(f.items[0]).net, 'B', 'the enclosing ring is the nearest blocker')
  assert.match(f.message, /cannot route net SIG from \(5, 5\) on F\.Cu to \(15, 5\) on F\.Cu, layers F\.Cu: no path found; nearest obstacles: track \(B\)/)
  assert.ok(
    b.ratsnest.some(r => r.net === 'SIG'),
    'the ratsnest keeps the connection',
  )
  assert.equal(tracks(b, 'OK').length >= 1, true, 'the other route is placed')
  assert.equal(b.routing.failed, 1)
  assert.equal(b.routing.legs, 2)
})

test('route-failed: a keepout that cuts the line on every layer tried is named with its source before the pads', () => {
  const wall = { file: 'main.tsx', line: 9, col: 3, endLine: 9, endCol: 30 }
  const parts = [smd('J1', 5, 5, 'SIG'), smd('J2', 15, 5, 'SIG'), smd('N1', 10, 2, 'X'), smd('N2', 10, 8, 'X')]
  const cut = 'M 9 0 H 11 V 10 H 9 Z'
  const b = compileBoard(board(...parts, keepout(cut, { layers: ['F.Cu'], __src: wall }), route(P('J1.1'), P('J2.1'), { __src: src }).layers(['F.Cu'])), opts)
  const [f] = rule(b, 'route-failed')
  assert.match(f.message, /: no path found[^;]*; blocked by the keepout \(main\.tsx:9:3\) on F\.Cu(; nearest obstacles: |$)/, f.message)
  // a keepout on one layer of two does not explain a failure the other layer could route round
  const both = compileBoard(
    board(
      ...parts,
      keepout(cut, { layers: ['F.Cu'], __src: wall }),
      route('3 3').net(net('B')).layer('B.Cu').width(0.5).L(7, 3).L(7, 7).L(3, 7).L(3, 3),
      route('3 3').net(net('B')).width(0.5).L(7, 3).L(7, 7).L(3, 7).L(3, 3),
      route(P('J1.1'), P('J2.1'), { __src: src }).layers(['F.Cu', 'B.Cu']),
    ),
    opts,
  )
  const [g] = rule(both, 'route-failed')
  assert.ok(g, 'the ring still blocks J1')
  assert.doesNotMatch(g.message, /blocked by the keepout/)
  // an excepted net passes
  const ok = compileBoard(board(...parts, keepout(cut, { layers: ['F.Cu'], except: [net('SIG')] }), route(P('J1.1'), P('J2.1')).layers(['F.Cu'])), opts)
  assert.equal(rule(ok, 'route-failed').length, 0)
})

test('route-failed: strict turns the finding back into a CompileError pointing at the route', () => {
  const ring = route('3 3').net(net('B')).width(0.5).L(7, 3).L(7, 7).L(3, 7).L(3, 3)
  assert.throws(
    () =>
      compileBoard(
        h(PCB, { name: 'Findings', strict: true }, edge(), smd('J1', 5, 5, 'SIG'), smd('J2', 15, 5, 'SIG'), ring, route(P('J1.1'), P('J2.1'), { __src: src }).layers(['F.Cu'])),
        opts,
      ),
    e => e instanceof CompileError && /cannot route net SIG/.test(e.message) && e.src?.line === 12,
  )
  assert.throws(() => compileBoard(h(PCB, { name: 'Findings', strict: 'yes' }, edge()), opts), /strict must be true or false/)
})

test('route-failed: route(NET) reports the leg it cannot route and connects the rest', () => {
  const { A } = nets()
  const ring = route('13 3').net(net('B')).width(0.5).L(17, 3).L(17, 7).L(13, 7).L(13, 3)
  const b = compileBoard(board(smd('J1', 3, 5, A), smd('J2', 8, 5, A), smd('J3', 15, 5, A), ring, route(A).width(0.2).layers(['F.Cu'])), opts)
  assert.equal(rule(b, 'route-failed').length, 1)
  assert.equal(b.unconnected, 1)
  assert.ok(tracks(b, 'A').length >= 1, 'J1 and J2 are joined')
})

// ---- keepout ----

test('keepout: the router keeps tracks out on the keepout layers and goes straight on the others', () => {
  const area0 = 'M8 2 H12 V8 H8 Z'
  const parts = [smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A')]
  const b = compileBoard(board(...parts, keepout(area0, { layers: ['F.Cu'] }), route(P('J1.1'), P('J2.1')).width(0.2).layers(['F.Cu'])), opts)
  const pts = tracks(b, 'A').flatMap(t => t.pts)
  assert.ok(pts.length > 2 && pts.every(p => !insideRect(p, 8, 2, 12, 8)), 'goes around the keepout')
  assert.deepEqual(errors(b), [])
  const other = compileBoard(board(...parts, keepout(area0, { layers: ['B.Cu'] }), route(P('J1.1'), P('J2.1')).width(0.2).layers(['F.Cu'])), opts)
  assert.equal(tracks(other, 'A')[0].pts.length, 2, 'a B.Cu keepout leaves F.Cu alone')
  assert.deepEqual(
    other.keepouts.map(k => k.layers),
    [['B.Cu']],
  )
  const all = compileBoard(board(...parts, keepout(area0)), opts)
  assert.deepEqual(all.keepouts[0].layers, ['F.Cu', 'B.Cu'])
  assert.deepEqual([all.keepouts[0].tracks, all.keepouts[0].vias, all.keepouts[0].pours], [true, true, true])
})

test('keepout: vias stay out of a vias keepout, tracks may cross it when it allows them', () => {
  const b = compileBoard(board(smd('J1', 3, 5, 'A'), keepout('M13 0 H20 V10 H13 Z', { layers: ['F.Cu', 'B.Cu'], tracks: false }), route(P('J1.1'), '17 5 B.Cu').width(0.2)), opts)
  assert.equal(vias(b).length, 1)
  for (const v of vias(b)) assert.ok(v.at[0] + v.size / 2 <= 13, `via at ${v.at} is in the keepout`)
  assert.deepEqual(errors(b), [])
})

test('keepout: a pour is cut by a keepout on its layer unless the keepout allows pours', () => {
  const cut = 'M5 2 H10 V6 H5 Z',
    box = [
      [5, 2],
      [10, 2],
      [10, 6],
      [5, 6],
    ]
  const filled = b => b.items.find(i => i.kind === 'zone')
  const inBox = z => area(polysToRings(intersection(polysToRings(z.fill), [box])))
  const pour = (net, layer, d) => pourFn(net, layer, d, { islands: 'keep' })
  const kept = compileBoard(board(pour(net('GND'), 'B.Cu', 'M0 0 H20 V10 H0 Z'), keepout(cut, { layers: ['B.Cu'] })), opts)
  assert.ok(Math.abs(inBox(filled(kept))) < 1e-3, 'no fill inside the keepout, up to the rounding of the min-width regrow')
  assert.deepEqual(rule(kept, 'keepout'), [])
  const open = compileBoard(board(pour(net('GND'), 'B.Cu', 'M0 0 H20 V10 H0 Z'), keepout(cut, { layers: ['B.Cu'], pours: false })), opts)
  assert.ok(inBox(filled(open)) > 10, 'pours: false leaves the fill')
  const front = compileBoard(board(pour(net('GND'), 'B.Cu', 'M0 0 H20 V10 H0 Z'), keepout(cut, { layers: ['F.Cu'] })), opts)
  assert.ok(inBox(filled(front)) > 10, 'a keepout on another layer leaves the fill')
})

test('keepout: a pour the keepout leaves with no fill is a pour-in-keepout warning naming both', () => {
  const pour = (net, layer, d) => pourFn(net, layer, d, { islands: 'keep', __src: src })
  const b = compileBoard(board(pour(net('GND'), 'B.Cu', 'M6 3 H9 V5 H6 Z'), keepout('M5 2 H10 V6 H5 Z', { layers: ['B.Cu'], __src: { ...src, line: 20 } })), opts)
  const w = rule(b, 'pour-in-keepout')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /^pour of GND \(main\.tsx:12:5\) on B\.Cu has no fill: the keepout \(main\.tsx:20:5\) forbids pours there$/)
  assert.deepEqual(
    rule(compileBoard(board(pour(net('GND'), 'B.Cu', 'M6 3 H9 V5 H6 Z'), keepout('M5 2 H10 V6 H5 Z', { layers: ['B.Cu'], pours: false })), opts), 'pour-in-keepout'),
    [],
  )
  assert.deepEqual(
    rule(compileBoard(board(pour(net('GND'), 'B.Cu', 'M0 0 H20 V10 H0 Z'), keepout('M5 2 H10 V6 H5 Z', { layers: ['B.Cu'] })), opts), 'pour-in-keepout'),
    [],
    'a pour the keepout only cuts',
  )
})

test('keepout: the DRC flags tracks and vias drawn inside a keepout of their kind', () => {
  const zone = 'M8 2 H12 V8 H8 Z'
  const track = route('2 5').net(net('A')).width(0.2).L(18, 5)
  const b = compileBoard(board(track, keepout(zone, { layers: ['F.Cu'], __src: src })), opts)
  const [k] = rule(b, 'keepout')
  assert.equal(rule(b, 'keepout').length, 1)
  assert.equal(k.severity, 'error')
  assert.deepEqual(k.items, [tracks(b, 'A')[0].id])
  assert.match(k.message, /inside the keepout \(main\.tsx:12:5\) on F\.Cu/)
  assert.deepEqual(rule(compileBoard(board(track, keepout(zone, { layers: ['F.Cu'], tracks: false })), opts), 'keepout'), [])
  const v = via(net('A'), '10 5')
  assert.equal(rule(compileBoard(board(v, keepout(zone, { layers: ['B.Cu'] })), opts), 'keepout').length, 1, 'a through via is on B.Cu too')
  assert.deepEqual(rule(compileBoard(board(v, keepout(zone, { layers: ['B.Cu'], vias: false })), opts), 'keepout'), [])
})

test('keepout: it checks its layers and area, and a keepout in a back-side footprint flips', () => {
  assert.throws(() => keepout('M0 0 H1 V1 Z', { layers: 'F.Cu' }), /layers is a list of copper layer names/)
  assert.throws(() => h('keepout', { d: 'M0 0 H1 V1 Z' }), /<keepout> is no element; write keepout\(area, opts\)/)
  assert.throws(() => compileBoard(board(keepout('M0 0 H1 V1 Z', { layers: ['F.SilkS'] })), opts), /not a copper layer/)
  assert.throws(() => compileBoard(board(keepout('M0 0 L1 1')), opts), /no closed area/)
  const all = compileBoard(board(keepout('M0 0 H1 V1 H0 Z')), opts)
  assert.deepEqual(all.keepouts[0].layers, ['F.Cu', 'B.Cu'], 'every copper layer when layers is left out')
  const u1 = fp({ ref: 'U1', at: '10 5', side: 'B' }, keepout('M-1 -1 H1 V1 H-1 Z', { layers: ['F.Cu'], pours: false }))
  const b = compileBoard(board(u1), opts)
  assert.deepEqual(b.keepouts[0].layers, ['B.Cu'])
  assert.equal(b.keepouts[0].ref, 'U1')
  assert.equal(b.keepouts[0].pours, false)
})

test('keepout: except lets the listed nets in, in the DRC, the pours and the router, and keeps every other net out', () => {
  // a wall across the whole board on both layers: only an exempt net can cross it
  const wall = 'M9 0 H11 V10 H9 Z'
  const parts = [smd('J1', 3, 5, 'A'), smd('J2', 17, 5, 'A'), smd('K1', 3, 2, 'B'), smd('K2', 17, 2, 'B')]
  const b = compileBoard(board(...parts, keepout(wall, { except: [net('A')] }), route(P('J1.1'), P('J2.1')).width(0.2), route(P('K1.1'), P('K2.1')).width(0.2)), opts)
  assert.deepEqual(b.keepouts[0].except, ['A'])
  assert.ok(tracks(b, 'A').length >= 1, 'A crosses the wall')
  assert.equal(rule(b, 'route-failed').length, 1, 'B cannot')
  assert.ok(rule(b, 'route-failed')[0].refs.includes('net:B'))
  assert.deepEqual(rule(b, 'keepout'), [])
  // drawn copper: A inside is fine, B is a finding
  const drawn = net => route('2 5').net(net).width(0.2).L(18, 5)
  assert.deepEqual(rule(compileBoard(board(drawn(net('A')), keepout(wall, { layers: ['F.Cu'], except: [net('A')] })), opts), 'keepout'), [])
  assert.equal(rule(compileBoard(board(drawn(net('B')), keepout(wall, { layers: ['F.Cu'], except: [net('A')] })), opts), 'keepout').length, 1)
  // a pour of an exempt net fills the keepout
  const box = [
    [9, 0],
    [11, 0],
    [11, 10],
    [9, 10],
  ]
  const inBox = z => area(polysToRings(intersection(polysToRings(z.fill), [box])))
  const zoneOf = c => c.items.find(i => i.kind === 'zone')
  const gnd = compileBoard(board(pourFn(net('GND'), 'B.Cu', 'M0 0 H20 V10 H0 Z', { islands: 'keep' }), keepout(wall, { layers: ['B.Cu'], except: [net('GND')] })), opts)
  assert.ok(inBox(zoneOf(gnd)) > 10, 'the exempt pour fills the keepout')
  // except takes nets, and checks the list
  const el = compileBoard(board(keepout(wall, { layers: ['F.Cu'], except: [net('A'), net('A')] })), opts)
  assert.deepEqual(el.keepouts[0].except, ['A'])
  assert.throws(() => compileBoard(board(keepout(wall, { layers: ['F.Cu'], except: net('A') })), opts), /except must be a list of nets/)
})
