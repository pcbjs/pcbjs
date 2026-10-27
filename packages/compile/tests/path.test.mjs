import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePath, chainRings, padRing, roundedRect } from '../dist/path.js'
import { bbox } from '../dist/geom.js'
import { near, nearPt } from './helpers.mjs'

test('parsePath: absolute M H V Z gives one closed subpath', () => {
  const sp = parsePath('M0 0 H10 V5 Z')
  assert.equal(sp.length, 1)
  assert.equal(sp[0].closed, true)
  assert.deepEqual(sp[0].pts, [[0, 0], [10, 0], [10, 5]])
})

test('parsePath: relative commands', () => {
  const sp = parsePath('m1 1 l2 0 v3 h-2 z')
  assert.equal(sp.length, 1)
  assert.equal(sp[0].closed, true)
  assert.deepEqual(sp[0].pts, [[1, 1], [3, 1], [3, 4], [1, 4]])
})

test('parsePath: implicit lineto after m, and an open subpath', () => {
  const sp = parsePath('m0 0 1 1 1 1')
  assert.equal(sp.length, 1)
  assert.equal(sp[0].closed, false)
  assert.deepEqual(sp[0].pts, [[0, 0], [1, 1], [2, 2]])
})

test('parsePath: a second M starts a new subpath', () => {
  const sp = parsePath('M0 0 L1 0 M5 5 L6 5')
  assert.equal(sp.length, 2)
  assert.deepEqual(sp[1].pts, [[5, 5], [6, 5]])
})

test('parsePath: arc with sweep=1 from (0,0) to (2,0) bulges to y<0 (upward on the y-down screen, clockwise on screen)', () => {
  const [sp] = parsePath('M0 0 A1 1 0 0 1 2 0')
  const end = sp.pts[sp.pts.length - 1]
  nearPt(end, [2, 0], 1e-9)
  // the point closest to x = 1 is the midpoint of the half circle around (1, 0)
  const mid = sp.pts.reduce((a, b) => (Math.abs(b[0] - 1) < Math.abs(a[0] - 1) ? b : a))
  near(mid[0], 1, 0.05)
  near(mid[1], -1, 0.01)
  for (const [x, y] of sp.pts) near(Math.hypot(x - 1, y), 1, 1e-9, `point (${x}, ${y}) is off the unit circle around (1, 0)`)
})

test('parsePath: arc with sweep=0 bulges to y>0', () => {
  const [sp] = parsePath('M0 0 A1 1 0 0 0 2 0')
  const mid = sp.pts.reduce((a, b) => (Math.abs(b[0] - 1) < Math.abs(a[0] - 1) ? b : a))
  near(mid[1], 1, 0.01)
})

test('parsePath: errors on a missing number', () => {
  assert.throws(() => parsePath('M0'), /expected a number/)
})

test('chainRings: joins four open segments, one reversed, into one ring', () => {
  const segs = [
    [[0, 0], [10, 0]],
    [[10, 0], [10, 10]],
    [[0, 10], [10, 10]], // reversed relative to the walk
    [[0, 10], [0, 0]],
  ]
  const { rings, open } = chainRings(segs, [false, false, false, false])
  assert.equal(open.length, 0)
  assert.equal(rings.length, 1)
  assert.equal(rings[0].length, 4)
  assert.deepEqual(bbox(rings), { x: 0, y: 0, w: 10, h: 10 })
})

test('chainRings: an unclosed chain stays open, closed paths pass through', () => {
  const { rings, open } = chainRings([[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[5, 5], [6, 5], [6, 6]]], [false, false, true])
  assert.equal(rings.length, 1)
  assert.equal(open.length, 1)
  assert.deepEqual(open[0], [[0, 0], [1, 0], [1, 1]])
})

test('padRing: rect, circle, oval and roundrect bboxes', () => {
  assert.deepEqual(bbox([padRing('rect', 2, 1)]), { x: -1, y: -0.5, w: 2, h: 1 })
  const c = bbox([padRing('circle', 2, 2)])
  near(c.w, 2, 1e-9); near(c.x, -1, 1e-9)
  near(c.h, 2, 0.01)
  const o = bbox([padRing('oval', 3, 1)])
  near(o.w, 3, 1e-9); near(o.h, 1, 1e-9)
  const rr = bbox([padRing('roundrect', 2, 1)])
  near(rr.w, 2, 1e-9); near(rr.h, 1, 1e-9)
})

test('roundedRect: bbox matches w by h, centred', () => {
  const b = bbox([roundedRect(4, 2, 0.5)])
  near(b.x, -2, 1e-9); near(b.y, -1, 1e-9); near(b.w, 4, 1e-9); near(b.h, 2, 1e-9)
  assert.equal(roundedRect(4, 2, 0).length, 4)
})
