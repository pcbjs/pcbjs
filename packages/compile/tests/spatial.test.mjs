import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Grid, RingIndex, EMPTY, overlapsNear, contactNear } from '../dist/spatial.js'
import { bbox, bboxOverlap, overlaps, contactPoint, polysToRings, difference } from '../dist/geom.js'
import { circleRing } from '../dist/path.js'

// a small deterministic generator, so a failure reproduces
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
function randomBoxes(n, size, span, seed) {
  const r = rng(seed)
  return Array.from({ length: n }, () => ({ x: r() * span, y: r() * span, w: r() * size, h: r() * size }))
}
const brute = (boxes, q, pad = 0) => boxes.flatMap((b, i) => (bboxOverlap(b, q, pad) ? [i] : []))

test('spatial: a query returns exactly the overlapping boxes, ascending', () => {
  const boxes = randomBoxes(500, 3, 100, 1)
  const grid = new Grid(boxes)
  const qs = randomBoxes(200, 10, 110, 2)
  for (const q of qs) for (const pad of [0, 0.5, 4]) assert.deepEqual(grid.query(q, pad), brute(boxes, q, pad))
})

test('spatial: boxes that only touch count as overlapping, as bboxOverlap has it', () => {
  const grid = new Grid([{ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }])
  assert.deepEqual(grid.query({ x: 1, y: 0, w: 0, h: 0 }), [0])
  assert.deepEqual(grid.query({ x: 1, y: 0, w: 1, h: 1 }), [0, 1])
  assert.deepEqual(grid.query({ x: 1.5, y: 0, w: 0, h: 1 }, 0.5), [0, 1])
})

test('spatial: empty results, an empty grid and empty boxes', () => {
  const grid = new Grid(randomBoxes(100, 1, 10, 3))
  assert.deepEqual(grid.query({ x: 50, y: 50, w: 1, h: 1 }), [])
  assert.deepEqual(grid.query({ x: -20, y: -20, w: 1, h: 1 }, 2), [])
  assert.deepEqual(new Grid([]).query({ x: 0, y: 0, w: 5, h: 5 }), [])
  const withEmpty = new Grid([EMPTY, { x: 0, y: 0, w: 1, h: 1 }, EMPTY])
  assert.deepEqual(withEmpty.query({ x: -1, y: -1, w: 3, h: 3 }), [1])
})

test('spatial: a box much larger than the rest is still found', () => {
  const boxes = [...randomBoxes(300, 0.5, 50, 4), { x: -5, y: -5, w: 60, h: 60 }]
  const grid = new Grid(boxes)
  for (const q of randomBoxes(50, 2, 50, 5)) {
    const got = grid.query(q)
    assert.deepEqual(got, brute(boxes, q))
    assert.ok(got.includes(300))
  }
})

test('spatial: a large board, 50 000 boxes, answers like the brute force and in linear time', () => {
  const boxes = randomBoxes(50000, 1, 1000, 6)
  const t = performance.now()
  const grid = new Grid(boxes)
  let found = 0
  for (let i = 0; i < boxes.length; i++) found += grid.query(boxes[i], 0.2).length
  const ms = performance.now() - t
  assert.ok(found >= boxes.length)
  assert.ok(ms < 5000, `50 000 queries took ${ms | 0} ms`)
  for (const i of [0, 777, 12345, 49999]) assert.deepEqual(grid.query(boxes[i], 0.2), brute(boxes, boxes[i], 0.2))
})

test('spatial: a ring index keeps the rings near a box in their order, and clipping against them matches clipping against all', () => {
  // a pour with a grid of round holes, and small shapes over it
  const holes = []
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) holes.push(circleRing(2 + i * 3, 2 + j * 3, 0.8))
  const pour = polysToRings(difference([[[0, 0], [37, 0], [37, 37], [0, 37]]], holes))
  const idx = new RingIndex(pour)
  assert.ok(pour.length > 100)
  const near = idx.near({ x: 4, y: 4, w: 1, h: 1 })
  assert.ok(near.length < 10 && near.length >= 1)
  assert.deepEqual(near, pour.filter(r => bboxOverlap(bbox([r]), { x: 4, y: 4, w: 1, h: 1 })))
  const r = rng(7)
  for (let k = 0; k < 60; k++) {
    const x = r() * 37, y = r() * 37
    const shape = [circleRing(x, y, 0.3 + r() * 1.2)]
    const s = new RingIndex(shape)
    assert.equal(overlapsNear(s, idx), overlaps(shape, pour), `shape at ${x}, ${y}`)
    if (overlaps(shape, pour)) assert.deepEqual(contactNear(s, idx), contactPoint(shape, pour))
  }
})
