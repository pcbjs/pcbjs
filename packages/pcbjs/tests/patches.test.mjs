// Patches, for copper with no source of its own: each operation, the three sources in order, and the target hash going stale when the target changes but not when its neighbours do.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { patch, pour, route, resetDefaults, via } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { clearRouteCache } from '@pcbjs/compile/internal/route-cache'
import { targetHash } from '@pcbjs/compile/internal/patches'
import { itemRev } from '@pcbjs/core/ref'
import { fp, handle, netOf } from './parts.mjs'

afterEach(() => resetDefaults())

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const smd = (ref, x, y, net, size = 1) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
const board = (props, ...kids) => h(PCB, { name: 'Patch', ...props }, edge(), ...kids)
const opts = { cache: false }
const stale = b => b.drc.filter(d => d.rule === 'patch-stale')
const hashOf = (b, ref, kind) => targetHash(b, [], ref, kind)

test('width: the tuned tracks of a route take the width; the hash is the geometry, not the width', () => {
  const kids = () => [smd('J1', 3, 5, 'A'), smd('J2', 25, 5, 'A'), route(handle('J1.1'), handle('J2.1')).width(0.25)]
  const plain = compileBoard(board({}, ...kids()), opts)
  const hash = hashOf(plain, 'route:1', 'width')
  const b = compileBoard(board({ patches: [patch('route:1', { width: 0.4 }, hash)] }, ...kids()), opts)
  assert.deepEqual(stale(b), [])
  assert.deepEqual(
    b.items.filter(i => i.kind === 'track').map(t => t.width),
    [0.4],
  )
  // the same route made it: a width patch keeps its uid and changes its rev
  const [was, now] = [plain, b].map(x => x.items.find(i => i.kind === 'track'))
  assert.equal(now.uid, was.uid)
  assert.notEqual(itemRev(now), itemRev(was))
})

test('via: a via added on a net, a route and a plane, a via on a plane being a stitching via', () => {
  const kids = () => [smd('J1', 3, 5, 'A'), smd('J2', 25, 5, 'A'), route(handle('J1.1'), handle('J2.1')).width(0.25), pour(netOf('GND'), 'B.Cu', 'M 0 10 H 30 V 20 H 0 Z')]
  const plain = compileBoard(board({}, ...kids()), opts)
  const patches = [
    patch('net:A', { via: { at: '10 5' } }, hashOf(plain, 'net:A', 'via')),
    patch('route:1', { via: { at: '14 5', drill: 0.3, size: 0.6 } }, hashOf(plain, 'route:1', 'via')),
    patch('plane:B.Cu:GND', { via: { at: '20 15' } }, hashOf(plain, 'plane:B.Cu:GND', 'via')),
  ]
  const b = compileBoard(board({ patches }, ...kids()), opts)
  assert.deepEqual(stale(b), [])
  const vias = b.items.filter(i => i.kind === 'via')
  assert.deepEqual(
    vias.map(v => [v.net, v.at, v.layers, v.route]),
    [
      ['A', [10, 5], ['F.Cu', 'B.Cu'], undefined],
      ['A', [14, 5], ['F.Cu', 'B.Cu'], 'route:1'],
      ['GND', [20, 15], ['F.Cu', 'B.Cu'], undefined],
    ],
  )
  assert.equal(vias[1].drill, 0.3)
  assert.ok(vias.every(v => v.uid))
  const none = compileBoard(board({ patches: [patch('net:Q', { via: { at: '1 1' } }, hashOf(plain, 'net:A', 'via'))] }, ...kids()), opts)
  assert.match(stale(none)[0].message, /nothing is there/)
})

test('reroute: a leg through waypoints, and one past the route memo', () => {
  const kids = () => [smd('J1', 3, 5, 'A'), smd('J2', 25, 5, 'A'), route(handle('J1.1'), handle('J2.1')).width(0.25)]
  const plain = compileBoard(board({}, ...kids()), opts)
  const hash = plain.routes[0].hash
  assert.match(hash, /^[0-9a-f]{12}$/)
  const b = compileBoard(board({ patches: [patch('route:1/leg:1', { reroute: { through: ['14 12'] } }, hash)] }, ...kids()), opts)
  assert.deepEqual(stale(b), [])
  assert.equal(b.routing.legs, 2)
  assert.ok(b.items.some(i => i.kind === 'track' && i.pts.some(p => Math.hypot(p[0] - 14, p[1] - 12) < 1e-6)))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-reroute-'))
  try {
    clearRouteCache()
    compileBoard(board({}, ...kids()), { cache: { dir } })
    const fresh = compileBoard(board({ patches: [patch('route:1/leg:1', { reroute: {} }, hash)] }, ...kids()), { cache: { dir } })
    assert.equal(fresh.routing.cached, 0)
    assert.deepEqual(stale(fresh), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
    clearRouteCache()
  }
})

test('sources: <PCB patches>, then inline patches anywhere in the tree, then the .patches.ts file, applied in that order', () => {
  const kids = () => [smd('J1', 3, 5, 'A'), smd('J2', 25, 5, 'A'), route(handle('J1.1'), handle('J2.1')).width(0.25)]
  const plain = compileBoard(board({}, ...kids()), opts)
  const hash = hashOf(plain, 'route:1', 'width')
  const width = b => b.items.find(i => i.kind === 'track').width
  const own = [patch('route:1', { width: 0.3 }, hash)]
  const inline = h('g', {}, patch('route:1', { width: 0.35 }, hash))
  assert.equal(width(compileBoard(board({ patches: own }, ...kids()), opts)), 0.3)
  assert.equal(width(compileBoard(board({ patches: own }, ...kids(), inline), opts)), 0.35)
  assert.equal(width(compileBoard(board({ patches: own }, ...kids(), inline), { ...opts, patches: [patch('route:1', { width: 0.45 }, hash)] })), 0.45)
  assert.throws(() => compileBoard(board({ patches: [{ ref: 'R1' }] }, ...kids()), opts), /patches: entry 1 is not a patch\(\) call/)
  assert.throws(() => patch('R1', { spin: 1 }, hash), /a patch operation is one of/)
  // a part or a via is moved where it is written, never by a patch
  for (const op of [{ move: '1 2' }, { nudge: [1, 0] }]) assert.throws(() => patch('R1', op, hash), /one of \{ via \}, \{ reroute \}, \{ width \}, \{ hold \}/)
  assert.throws(() => patch('R1', { width: 1 }, 'abc'), /12 hex/)
})
