import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { offset, overlaps, polysToRings } from '@pcbjs/compile/geom'
import { baseBoard, compiledBase, outline, PCB, h, PinHeader } from './fixtures.mjs'
import { near, nearPt } from './helpers.mjs'
import { jsxDEV } from '@pcbjs/core/jsx-dev-runtime'
import { flatten } from '@pcbjs/compile/flatten'
import { route, pour, via } from '@pcbjs/core'

const pads = (board, ref) => board.items.filter(i => i.kind === 'pad' && (ref === undefined || i.ref === ref))
const padOf = (board, ref, num) => pads(board, ref).find(p => p.num === String(num))

test('compile: footprints, pads and nets from net:N attributes', () => {
  const b = compiledBase()
  assert.equal(b.footprints.length, 2)
  assert.deepEqual(
    b.footprints.map(f => f.ref),
    ['J1', 'J2'],
  )
  assert.equal(pads(b, 'J1').length, 2)
  assert.equal(padOf(b, 'J1', 1).net, 'A')
  assert.equal(padOf(b, 'J1', 2).net, 'B')
  nearPt(padOf(b, 'J1', 1).at, [2, 2], 1e-12)
  nearPt(padOf(b, 'J1', 2).at, [2, 4.54], 1e-12)
  assert.deepEqual(
    b.nets.map(n => n.name),
    ['A', 'B'],
  )
  assert.deepEqual(b.stats, { tracks: 1, vias: 0, pads: 4, zones: 0, footprints: 2, nets: 2 })
})

test('compile: tht pads are on both copper layers, pin 1 is square', () => {
  const p1 = padOf(compiledBase(), 'J1', 1)
  assert.deepEqual(p1.layers, ['F.Cu', 'B.Cu'])
  assert.equal(p1.shape, 'rect')
  assert.deepEqual(p1.drill, [1, 1])
})

test('compile: the Edge.Cuts rect becomes one outline ring and sets the bbox', () => {
  const b = compiledBase()
  assert.equal(b.outline.length, 1)
  assert.deepEqual(b.bbox, { x: 0, y: 0, w: 10, h: 10 })
})

test('compile: a pad in a group at (5,5) rotated 90 lands at (5,4)', () => {
  const b = compileBoard(h(PCB, { name: 'G' }, outline(), h('g', { at: '5 5 90deg' }, h('pad', { num: 1, at: [1, 0], size: [0.6, 0.4], net: 'C' }))))
  const [p] = pads(b)
  nearPt(p.at, [5, 4], 1e-12)
  near(p.rot, 90, 1e-9)
  assert.equal(p.mirrored, false)
})

test('compile: a footprint on side B puts smd pads on B.Cu and mirrors x', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'Back' },
      outline(),
      h('footprint', { ref: 'U1', at: '5 5', side: 'B' }, h('pad', { num: 1, at: [1, 0.5], size: [0.6, 0.4] }), h('rect', { layer: 'F.SilkS', x: -1, y: -1, w: 2, h: 2 })),
    ),
  )
  assert.equal(b.footprints[0].side, 'B')
  const [p] = pads(b)
  assert.deepEqual(p.layers, ['B.Cu'])
  assert.equal(p.layer, 'B.Cu')
  nearPt(p.at, [4, 5.5], 1e-12)
  assert.equal(p.mirrored, true)
  const silk = b.items.find(i => i.kind === 'graphic' && i.ref === 'U1')
  assert.equal(silk.layer, 'B.SilkS')
})

test('compile: DRC reports unconnected for net B (two pads, no track) and nothing for routed net A', () => {
  const b = compiledBase()
  const unconnected = b.drc.filter(d => d.rule === 'unconnected')
  assert.equal(unconnected.length, 1)
  assert.match(unconnected[0].message, /net B /)
  assert.equal(b.unconnected, 1)
  assert.deepEqual(
    b.ratsnest.map(r => r.net),
    ['B'],
  )
  const aErrors = b.drc.filter(d => d.severity === 'error' && / A[ )]|net A/.test(d.message))
  assert.deepEqual(aErrors, [])
  assert.deepEqual(
    b.drc.filter(d => d.rule !== 'unconnected'),
    [],
    'no other DRC markers',
  )
})

test('compile: a B.Cu zone on net A fills, keeps clear of the B pad, and connects the A pads', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'Zone' },
      outline(),
      h(PinHeader, { ref: 'J1', pins: 2, at: '2 2', 'net:1': 'A', 'net:2': 'B' }),
      h(PinHeader, { ref: 'J2', pins: 2, at: '7 2', 'net:1': 'A', 'net:2': 'B' }),
      h('zone', { net: 'A', layer: 'B.Cu', d: 'M0 0 H10 V10 H0 Z' }),
    ),
  )
  const z = b.items.find(i => i.kind === 'zone')
  assert.ok(z.fill.length > 0, 'zone has a fill')
  const fill = polysToRings(z.fill)
  const padB = padOf(b, 'J1', 2)
  // the B pad grown by slightly less than the clearance must not touch the fill
  const keepout = polysToRings(offset([padB.poly], b.rules.clearance - 0.01))
  assert.equal(overlaps(fill, keepout), false)
  // same-net pads are poured over
  assert.equal(overlaps(fill, [padOf(b, 'J1', 1).poly]), true)
  // net A is connected through the zone, B is not
  assert.deepEqual(
    b.ratsnest.map(r => r.net),
    ['B'],
  )
})

test('compile: CompileError for a duplicate ref', () => {
  assert.throws(
    () => compileBoard(h(PCB, { name: 'Dup' }, outline(), h(PinHeader, { ref: 'J1', pins: 2, at: '2 2' }), h(PinHeader, { ref: 'J1', pins: 2, at: '7 2' }))),
    err => err instanceof CompileError && /duplicate ref J1/.test(err.message),
  )
})

test('compile: CompileError for net:9 naming a pad that does not exist', () => {
  assert.throws(
    () => compileBoard(h(PCB, { name: 'Bad' }, outline(), h(PinHeader, { ref: 'J1', pins: 2, at: '2 2', 'net:9': 'X' }))),
    err => err instanceof CompileError && /J1: no pad named "9"/.test(err.message),
  )
})

test('compile: net:padN maps to pad number N, next to net:N and nets={{...}}', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'Alias' },
      outline(),
      h(PinHeader, { ref: 'J1', pins: 2, at: '2 2', 'net:pad1': 'A', 'net:pad2': 'B' }),
      h(PinHeader, { ref: 'J2', pins: 2, at: '7 2', 'net:pad1': 'A', nets: { 2: 'B' } }),
    ),
  )
  assert.equal(padOf(b, 'J1', 1).net, 'A')
  assert.equal(padOf(b, 'J1', 2).net, 'B')
  assert.equal(padOf(b, 'J2', 1).net, 'A')
  assert.equal(padOf(b, 'J2', 2).net, 'B')
})

test('compile: a pad literally named padN keeps priority over the net:padN alias', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'Literal' },
      outline(),
      h('footprint', { ref: 'U1', at: '5 5', 'net:pad1': 'X' }, h('pad', { num: 1, at: [0, 0], size: 0.6 }), h('pad', { num: 2, name: 'pad1', at: [1, 0], size: 0.6 })),
    ),
  )
  assert.equal(padOf(b, 'U1', 1).net, undefined)
  assert.equal(padOf(b, 'U1', 2).net, 'X')
})

test('compile: CompileError for net:pad9 on a 2-pin part names both spellings', () => {
  assert.throws(
    () => compileBoard(h(PCB, { name: 'Bad' }, outline(), h(PinHeader, { ref: 'J1', pins: 2, at: '2 2', 'net:pad9': 'X' }))),
    err => err instanceof CompileError && /J1: no pad numbered 9 or named "pad9"/.test(err.message),
  )
})

test('compile: CompileError for a root that is not a board, and an unknown layer', () => {
  assert.throws(() => compileBoard(h('g', {})), CompileError)
  assert.throws(
    () => compileBoard(h(PCB, { name: 'L' }, h('line', { layer: 'Nope', x1: 0, y1: 0, x2: 1, y2: 1 }))),
    err => err instanceof CompileError && /unknown layer "Nope"/.test(err.message),
  )
})

test('compile: baseBoard is deterministic', () => {
  assert.deepEqual(compileBoard(baseBoard()), compileBoard(baseBoard()))
})

test('compile: a footprint records where the design placed its component, not the <footprint> inside it', () => {
  const at = (file, line) => ({ fileName: file, lineNumber: line, columnNumber: 5 })
  const Part = props =>
    jsxDEV('footprint', { ...props, children: jsxDEV('pad', { num: 1, size: [1, 1] }, undefined, false, at('lib/Part.tsx', 8)) }, undefined, false, at('lib/Part.tsx', 7))
  const Group = () => jsxDEV(Part, { ref: 'U1', at: '5 5' }, undefined, false, at('lib/Group.tsx', 3))
  const b = compileBoard(h(PCB, { name: 'S' }, outline(), jsxDEV(Group, {}, undefined, false, at('main.tsx', 12))))
  assert.deepEqual(b.footprints[0].src, { file: 'main.tsx', line: 12, col: 5 })
  assert.deepEqual(pads(b, 'U1')[0].src, { file: 'lib/Part.tsx', line: 8, col: 5 })
})

// ---- autorouting jobs: flatten() records them, it does not route ----
const flattenWith = track => flatten(baseBoard([h('track', track)]))

test('flatten: a track with an AutoRoute d becomes one job from start to end with no algorithm of its own', () => {
  const spec = { start: 'J1.1', end: 'J2.1' }
  const flat = flattenWith({ net: 'A', layer: 'F.Cu', width: '0.25mm', d: spec, layers: ['F.Cu', 'B.Cu'], via: { drill: '0.3mm', size: 0.6 } })
  assert.equal(flat.autoRoutes.length, 1)
  const job = flat.autoRoutes[0]
  assert.equal(job.from, 'J1.1', 'REF.PAD positions stay as written')
  assert.equal(job.to, 'J2.1')
  assert.equal(job.params.algorithm, undefined)
  assert.equal(job.net, 'A')
  assert.equal(job.layer, 'F.Cu')
  assert.equal(job.width, 0.25)
  assert.deepEqual(job.params.layers, ['F.Cu', 'B.Cu'])
  assert.deepEqual(job.params.via, { drill: 0.3, size: 0.6 })
  assert.equal(flat.items.filter(i => i.kind === 'track').length, 1, 'only the explicit base track is an item')
})

test('flatten: a track with a function d becomes a whole-net job with that algorithm', () => {
  const fn = () => ({ tracks: [], vias: [] })
  const flat = flattenWith({ net: 'B', layer: 'B.Cu', width: 0.3, d: fn })
  assert.equal(flat.autoRoutes.length, 1)
  assert.equal(flat.autoRoutes[0].params.algorithm, fn)
  assert.equal(flat.autoRoutes[0].from, undefined)
  assert.equal(flat.autoRoutes[0].layer, 'B.Cu')
})

test('flatten: a track without d but with a net becomes a whole-net job with the default algorithm', () => {
  const flat = flattenWith({ net: 'B', layer: 'F.Cu', width: 0.3 })
  assert.equal(flat.autoRoutes.length, 1)
  assert.equal(flat.autoRoutes[0].from, undefined)
  assert.equal(flat.autoRoutes[0].params.algorithm, undefined)
  assert.equal(flat.autoRoutes[0].net, 'B')
})

test('flatten: a track without d and without a net is a CompileError', () => {
  assert.throws(
    () => flattenWith({ layer: 'F.Cu', width: 0.3 }),
    e => e instanceof CompileError && /without d needs a net/.test(e.message),
  )
})

test('flatten: explicit d strings and points stay tracks and make no jobs', () => {
  const flat = flattenWith({
    net: 'B',
    layer: 'F.Cu',
    width: 0.3,
    points: [
      [2, 4.54],
      [7, 4.54],
    ],
  })
  assert.equal(flat.autoRoutes.length, 0)
  assert.equal(flat.items.filter(i => i.kind === 'track').length, 2)
})

test('helpers: route, pour and via take one props object and return the intrinsic node', () => {
  const tp = { net: 'A', layer: 'F.Cu', width: 0.3, d: { start: 'J1.1', end: 'J2.1' } }
  const zp = { net: 'GND', layer: 'B.Cu', d: 'M0 0 H10 V10 H0 Z', priority: 1 }
  const vp = { net: 'A', at: '5mm 5mm', drill: 0.3, size: 0.6 }
  const t = route(tp),
    z = pour(zp),
    v = via(vp)
  assert.equal(t.type, 'track')
  assert.deepEqual(t.props, tp)
  assert.equal(z.type, 'zone')
  assert.deepEqual(z.props, zp)
  assert.equal(v.type, 'via')
  assert.deepEqual(v.props, vp)
})

test('flatten: AutoRoute coordinate positions are in the group frame and come out in board mm', () => {
  const d = { start: { at: [1, 0] }, end: [0, 2, 'B.Cu'] }
  const flat = flatten(baseBoard([h('g', { at: '10 10 90deg' }, h('track', { net: 'A', layer: 'F.Cu', width: 0.3, d }))]))
  const { from, to } = flat.autoRoutes[0]
  nearPt(from.at, [10, 9], 1e-12)
  assert.equal(from.layer, undefined)
  nearPt(to.at, [12, 10], 1e-12)
  assert.equal(to.layer, 'B.Cu')
  const back = flatten(baseBoard([h('g', { side: 'B' }, h('track', { net: 'A', layer: 'F.Cu', width: 0.3, d: { start: 'J1.1', end: { at: '1 1', layer: 'F.Cu' } } }))]))
  const job = back.autoRoutes[0]
  assert.equal(job.layer, 'B.Cu')
  assert.equal(job.from, 'J1.1')
  assert.equal(job.to.layer, 'B.Cu')
  nearPt(job.to.at, [-1, 1], 1e-12)
})
