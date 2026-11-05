import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, reference } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { apply4, referencePose } from '@pcbjs/compile/internal/reference'
import { area } from '@pcbjs/compile/internal/geom'
import { siteData } from '@pcbjs/export'
import { placement } from '@pcbjs/export/compose'
import { near } from './helpers.mjs'

const T = 1.6
const upright = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
const camera = {
  entry: '/microx/camera.pcb.tsx',
  name: 'Camera',
  title: 'Camera',
  rev: '1',
  thickness: 0.8,
  outline: [
    [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
  ],
  drills: [
    { x: 0, y: 0, d: 2 },
    { x: 5, y: 0, d: 1, len: 3, a: 0 },
  ],
  footprints: [{ ref: 'U1', at: [0, 0], rot: 0, side: 'F', height: 5, body: { x: 0, y: 0, w: 6, h: 6, rot: 0 }, pads: [] }],
  hash: 'a'.repeat(64),
  mesh: 'a'.repeat(64),
  split: 1,
  files: ['/microx/camera.pcb.tsx'],
  graph: {},
  status: 'ok',
}
const compile = (...children) =>
  compileBoard(h(PCB, { name: 'Carrier' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 120, h: 80 }), ...children), {
    references: { resolve: () => camera },
    cache: false,
  })
const pose = (x, y, z = T + 20, orientation = upright) => ({ translation: [x, -y, z], orientation })
const ref = p => reference('./camera.pcb.tsx', { pose: p })
const land = (r, [x, y, z]) => {
  const q = apply4(r.transform, [x, -y, z])
  return [q[0], -q[1], q[2]]
}
const close = (a, b) => a.forEach((v, i) => near(v, b[i], 1e-7))

test('quaternion references place three upright cameras at carrier-top optical height', () => {
  const anchors = [
    [10, 0],
    [110, 0],
    [60, 62],
  ]
  const b = compile(...anchors.map(([x, y]) => ref(pose(x, y))))
  assert.equal(b.references.length, 3)
  for (const [i, r] of b.references.entries()) {
    const [x, y] = anchors[i]
    close(land(r, [0, 0, 0]), [x, y, T + 20])
    close(land(r, [0, -10, 0]), [x, y, T + 30])
    close(land(r, [0, 10, 0]), [x, y, T + 10])
    close(
      land(r, [0, 0, 1]).map((v, k) => v - land(r, [0, 0, 0])[k]),
      [0, 1, 0],
    )
    close(r.z, [T + 10, T + 30])
    close(r.bounds.min, [x - 10, y, T + 10])
    close(r.bounds.max, [x + 10, y + 5.8, T + 30])
    near(Math.abs(area(r.outline)), 16, 1e-6)
    near(Math.abs(area([r.bodies[0].ring])), 30, 1e-6)
    assert.equal(r.bodies[0].height, 5)
    close(r.bodies[0].z, [T + 17, T + 23])
    assert.deepEqual(r.holes, [], 'tilted drills must not be drawn as planar circles')
    near(Math.abs(area([r.holeOutlines[0]])), 1.6, 1e-6)
    near(Math.abs(area([r.holeOutlines[1]])), 2.4, 1e-6)
  }
  assert.deepEqual(
    b.drc.filter(d => d.rule === 'reference-collision'),
    [],
  )
  assert.deepEqual(b.items, compile().items, 'reference copper, holes and bodies never enter carrier fabrication items')
  assert.deepEqual(b.footprints, [])
  const site = siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: [] })
  const svg = site.layers.find(l => l.id === 'Dwgs.User').svg
  assert.equal((svg.match(/data-kind="reference"/g) ?? []).length, 3)
  assert.ok(!svg.includes('<circle'), 'drill projections use paths')
  assert.deepEqual(
    site.references.map(r => r.transform),
    b.references.map(r => r.transform),
  )
})

test('tilted slab and body collision prisms catch carrier and reference intersections', () => {
  const collisions = b => b.drc.filter(d => d.rule === 'reference-collision')
  assert.ok(collisions(compile(ref(pose(30, 20, 5)))).some(d => d.message.includes("this board's slab")))
  const overlap = collisions(compile(ref(pose(30, 20)), ref(pose(30, 20.4))))
  assert.ok(overlap.some(d => d.message.includes("Camera #2's board") && d.message.includes("Camera #1's board")))
  assert.deepEqual(collisions(compile(ref(pose(30, 20)), ref(pose(70, 20)))), [])
  const bodyOnly = collisions(compile(ref(pose(30, 20)), ref(pose(30, 22))))
  assert.ok(
    bodyOnly.some(d => d.message.includes('U1 body')),
    'bodies must use all transformed corners, not one face',
  )
})

test('general quaternion rotation matches independent vector rotation and library composition', () => {
  const orientation = [1, 2, 3, 4]
  const p = pose(17, 23, 31, orientation)
  const [r] = compile(ref(p)).references
  const norm = Math.hypot(...orientation),
    [x, y, z, w] = orientation.map(v => v / norm)
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  for (const v of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [3, -7, 11],
  ]) {
    const uv = cross([x, y, z], v),
      uuv = cross([x, y, z], uv)
    close(
      apply4(r.transform, v),
      v.map((c, i) => c + 2 * (w * uv[i] + uuv[i]) + p.translation[i]),
    )
  }
  assert.deepEqual(placement(camera, camera, { pose: p }), r.transform)
  close(r.anchor.pose.orientation, [x, y, z, w])
  assert.deepEqual(referencePose({ ...p, orientation: orientation.map(v => -v) }), r.anchor.pose)
  const group = compile(h('g', { at: '10 20 90deg' }, ref(pose(2, 3, 4, [0, 0, 0, 1])))).references[0]
  close(land(group, [0, 0, 0]), [13, 18, 4])
})

test('collision checks include every disconnected projected slab region', () => {
  const remote = {
    ...camera,
    footprints: [],
    drills: [],
    outline: [
      [
        [-100, -20],
        [-60, -20],
        [-60, 20],
        [-100, 20],
      ],
      [
        [20, -10],
        [40, -10],
        [40, 10],
        [20, 10],
      ],
    ],
  }
  const b = compileBoard(h(PCB, { name: 'Carrier' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 120, h: 80 }), ref(pose(0, 20, 5))), {
    references: { resolve: () => remote },
    cache: false,
  })
  assert.ok(
    b.drc.some(d => d.rule === 'reference-collision'),
    'the smaller in-board region collides even when the largest region is outside the carrier',
  )
})

test('pose equals legacy scalar rotation and flip without changing their anchor datum', () => {
  const simple = compile(reference('./camera.pcb.tsx', { at: [10, 20, 30], rotate: 90 })).references[0]
  const explicit = compile(ref(pose(10, 20, 30, [0, 0, Math.SQRT1_2, Math.SQRT1_2]))).references[0]
  assert.deepEqual(simple.transform, explicit.transform)
  const flipped = compile(reference('./camera.pcb.tsx', { at: [10, 20, 30], flip: true })).references[0]
  const flippedPose = compile(ref(pose(10, 20, 30.8, [0, 1, 0, 0]))).references[0]
  assert.deepEqual(flipped.transform, flippedPose.transform)
  close(land(flipped, [0, 0, 0.8]), [10, 20, 30])
})

test('pose rejects ambiguous or invalid transforms and normalizes non-unit quaternions', () => {
  const valid = pose(10, 20)
  for (const orientation of [[0, 0, 0, 0], [1, 0, 0], [0, 0, NaN, 1], [0, Infinity, 0, 1], ['0', 0, 0, 1], new Array(4)])
    assert.throws(() => compile(ref({ ...valid, orientation })), /pose: orientation/)
  for (const translation of [[0, 0], [0, 0, Infinity], [0, 0, 'bad'], new Array(3)])
    assert.throws(() => compile(ref({ ...valid, translation })), /pose[.:]translation|pose: translation/)
  assert.throws(() => compile(ref({ ...valid, scale: 2 })), /unknown field "scale"/)
  for (const [key, value] of Object.entries({ at: [0, 0, 0], rotate: 0, flip: false, offset: [0, 0, 0], side: 'F', stack: 'coplanar', gap: 0, mate: {} })) {
    assert.throws(() => compile(reference('./camera.pcb.tsx', { pose: valid, [key]: value })), /pose is a complete placement/)
    assert.throws(() => placement(camera, camera, { pose: valid, [key]: value }), /pose is a complete placement/)
  }
  assert.deepEqual(referencePose({ translation: ['1mm', '2mm', '3mm'], orientation: [0, 0, 0, -1e300] }), {
    translation: [1, 2, 3],
    orientation: [0, 0, 0, 1],
  })
})
