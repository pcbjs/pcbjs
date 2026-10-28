import { test } from 'node:test'
import assert from 'node:assert/strict'
import { union, difference, offset, strokeOpen, area, overlaps, polysToRings, placement, apply, rotationOf, isMirrored } from '../dist/geom.js'
import { near, nearPt } from './helpers.mjs'

const sq = (x, y, s) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
]
const polyArea = p => Math.abs(area([p.outer])) - p.holes.reduce((s, h) => s + Math.abs(area([h])), 0)

test('union of two overlapping 2x2 squares offset by 1 has area 7', () => {
  const u = union([sq(0, 0, 2), sq(1, 1, 2)])
  assert.equal(u.length, 1)
  assert.equal(u[0].holes.length, 0)
  near(polyArea(u[0]), 7, 1e-9)
})

test('difference of a small square inside a big one leaves a hole', () => {
  const d = difference([sq(0, 0, 10)], [sq(4, 4, 2)])
  assert.equal(d.length, 1)
  assert.equal(d[0].holes.length, 1)
  near(polyArea(d[0]), 96, 1e-9)
})

test('offset of a 2x2 square by 0.5 with round joins', () => {
  const o = offset([sq(0, 0, 2)], 0.5)
  assert.equal(o.length, 1)
  // round joins are polygons inscribed within Clipper's 0.005 mm arc tolerance, so slightly under the exact area
  const a = Math.abs(area(polysToRings(o))),
    exact = 4 + 4 * 1 + Math.PI * 0.25
  assert.ok(a <= exact + 1e-9, `${a} should not exceed ${exact}`)
  near(a, exact, 0.02)
})

test('negative offset shrinks', () => {
  const o = offset([sq(0, 0, 2)], -0.5)
  near(Math.abs(area(polysToRings(o))), 1, 1e-9)
})

test('strokeOpen of a 10 mm line, width 1, round caps', () => {
  const s = strokeOpen(
    [
      [0, 0],
      [10, 0],
    ],
    1,
  )
  assert.equal(s.length, 1)
  const a = Math.abs(area(polysToRings(s))),
    exact = 10 + Math.PI * 0.25
  assert.ok(a <= exact + 1e-9, `${a} should not exceed ${exact}`)
  near(a, exact, 0.02)
})

test('overlaps', () => {
  assert.equal(overlaps([sq(0, 0, 2)], [sq(1, 1, 2)]), true)
  assert.equal(overlaps([sq(0, 0, 2)], [sq(3, 3, 2)]), false)
  assert.equal(overlaps([sq(0, 0, 2)], [sq(2, 0, 2)]), false) // touching edges have no area in common
})

test('placement: rotation 90 is counter-clockwise on screen (y-down): (1,0) -> (0,-1)', () => {
  nearPt(apply(placement(0, 0, 90, false), [1, 0]), [0, -1], 1e-12)
  nearPt(apply(placement(5, 5, 90, false), [1, 0]), [5, 4], 1e-12)
})

test('placement: flip mirrors x before rotating and translating', () => {
  nearPt(apply(placement(0, 0, 0, true), [1, 2]), [-1, 2], 1e-12)
  nearPt(apply(placement(3, 0, 0, true), [1, 0]), [2, 0], 1e-12)
})

test('rotationOf and isMirrored', () => {
  near(rotationOf(placement(5, 5, 37, false)), 37, 1e-9)
  near(rotationOf(placement(0, 0, 30, true)), 30, 1e-9)
  near(rotationOf(placement(0, 0, -90, false)), 270, 1e-9)
  assert.equal(isMirrored(placement(5, 5, 37, false)), false)
  assert.equal(isMirrored(placement(5, 5, 37, true)), true)
})
