// The board API of @pcbjs/compile/query: frozen views whose toJSON is their record, references resolved, distances edge to edge, the
// clearance with where it came from, items near a point and on a layer, and a reference that names several.
import { fp, net } from './parts.mjs'
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults, route } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { boardApi } from '../dist/query.js'

afterEach(() => resetDefaults())

const pad = (ref, at, n, size = 1) => fp({ ref, at, nets: { 1: n } }, h('pad', { num: 1, size: [size, size], type: 'smd' }))

function api() {
  const V = net('V')
  const b = compileBoard(
    h(
      PCB,
      { name: 'Q' },
      h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }),
      pad('R1', '5 10', V),
      pad('R2', '15 10', V),
      pad('C1', '15 14', net('W')),
      route('5 10').net(V).width(0.4).H(15),
    ),
    { cache: false },
  )
  return boardApi({ board: b, findings: [], snapshot: 's.1', root: '' })
}

test('views are frozen, carry their record, and toJSON is the record', () => {
  const b = api()
  const r1 = b.part('R1')
  assert.ok(Object.isFrozen(r1))
  assert.equal(r1.kind, 'part')
  assert.deepEqual(r1.at, [5, 10])
  assert.deepEqual(
    r1.pads.map(p => [p.ref, p.net]),
    [['R1/1', 'V']],
  )
  assert.deepEqual(JSON.parse(JSON.stringify(r1)).ref, 'R1')
  assert.throws(() => {
    'use strict'
    r1.at = [0, 0]
  })
  assert.equal(b.part('R9'), null)
  assert.deepEqual(b.net('V').pads, ['R1/1', 'R2/1'])
  assert.deepEqual(b.net('net:V').ref, 'net:V')
  const route = b.routes()[0]
  assert.equal(route.ref, 'route:1')
  assert.equal(route.status, 'ok')
  assert.equal(route.length, 10)
  assert.deepEqual(route.ends, ['R1/1', 'R2/1'])
  assert.deepEqual(
    route.points.map(p => p.ref),
    ['route:1/pt:0', 'route:1/pt:1'],
  )
  assert.equal(b.resolve('route:1/pt:1').kind, 'pt')
  assert.equal(b.resolve('R2/1').kind, 'pad')
})

test('distance is edge to edge, clearance says what holds and from where', () => {
  const b = api()
  // pads 1 mm square at y 10 and 14: 4 mm apart centre to centre
  const d = b.distance('R2', 'C1')
  assert.equal(d.d, 3)
  assert.deepEqual([d.a[1], d.b[1]], [10.5, 13.5])
  assert.equal(b.distance([15, 12], 'C1').d, 1.5)
  const c = b.clearance('R2/1', 'C1/1')
  assert.deepEqual([c.actual, c.rule, c.from], [3, 'clearance', 'rules'])
  assert.equal(c.required, b.rulesAt([15, 12], 'F.Cu').clearance)
  assert.deepEqual(b.bbox('C1'), { x: 14.5, y: 13.5, w: 1, h: 1 })
})

test('items near a target and on a layer, filtered by kind and net', () => {
  const b = api()
  const near = b.items.near('C1', 3.2, { kinds: ['pad'] })
  assert.deepEqual(
    near.map(i => i.part),
    ['R2'],
  )
  assert.equal(b.items.near('C1', 3.2, { kinds: ['track'] }).length, 0, 'the track edge is 3.3 mm off')
  assert.equal(b.items.near('C1', 3.4, { kinds: ['track'] }).length, 1)
  const tracks = b.items.on('F.Cu', { net: 'V', kinds: ['track'] })
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].type, 'track')
  assert.equal(tracks[0].width, 0.4)
  assert.equal(b.items.on('B.Cu', { kinds: ['pad'] }).length, 0)
})
