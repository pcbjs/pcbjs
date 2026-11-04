import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arcHit, arcPoint, chainArc, splitArc } from '../dist/trace-arc.js'

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const pointClose = (a, b) => a.forEach((v, i) => close(v, b[i]))

for (const angle of [30, 90, 180, 270, -30, -90, -180, -270]) {
  test(`splitting an exact ${angle} degree arc preserves its circle and total sweep`, () => {
    const from = [-2, 4],
      to = [13, -1],
      original = chainArc(from, to, angle)
    for (const fraction of [0.1, 0.35, 0.5, 0.8]) {
      const point = arcPoint(from, to, angle, fraction),
        hit = arcHit(from, to, angle, point),
        split = splitArc(from, to, angle, point)
      close(hit.distance, 0)
      close(hit.fraction, fraction)
      close(split.first + split.second, angle)
      pointClose(split.projected, point)
      const first = chainArc(from, point, split.first),
        second = chainArc(point, to, split.second)
      pointClose(first.center, original.center)
      pointClose(second.center, original.center)
      close(first.radius, original.radius)
      close(second.radius, original.radius)
      pointClose(arcPoint(from, point, split.first, 0.5), arcPoint(from, to, angle, fraction / 2))
      pointClose(arcPoint(point, to, split.second, 0.5), arcPoint(from, to, angle, (1 + fraction) / 2))
    }
  })
}

test('arc hit follows the curve rather than its chord and clamps outside the swept portion', () => {
  const middle = arcPoint([0, 0], [10, 0], 180, 0.5)
  pointClose(middle, [5, 5])
  close(arcHit([0, 0], [10, 0], 180, middle).distance, 0)
  assert.ok(Math.abs(middle[1]) > 4, 'the curve is far from the endpoint chord')
  const outside = arcHit([0, 0], [10, 0], 90, [-1, -5])
  assert.equal(outside.fraction, 0)
  pointClose(outside.point, [0, 0])
})

test('snapping may change the shared point but retains final endpoint and total signed sweep', () => {
  const split = splitArc([0, 0], [10, 0], -180, [5, -4])
  pointClose(split.point, [5, -4])
  pointClose(split.projected, [5, -5])
  close(split.first + split.second, -180)
  assert.ok(chainArc([0, 0], split.point, split.first))
  pointClose(arcPoint(split.point, [10, 0], split.second, 1), [10, 0])
})

test('local arc fractions are unchanged by rotating or mirroring the surrounding route frame', () => {
  const from = [1, 2],
    to = [8, 6],
    angle = 120,
    point = arcPoint(from, to, angle, 0.4)
  for (const m of [
    [0, -1, 1, 0, 20, 30],
    [-1, 0, 0, 1, 15, -3],
    [0, -1, -1, 0, 50, 20],
  ]) {
    const world = p => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
    const det = m[0] * m[3] - m[1] * m[2]
    const local = p => [(m[3] * (p[0] - m[4]) - m[2] * (p[1] - m[5])) / det, (-m[1] * (p[0] - m[4]) + m[0] * (p[1] - m[5])) / det]
    close(arcHit(local(world(from)), local(world(to)), angle, local(world(point))).fraction, 0.4)
  }
})

test('degenerate arcs and endpoint splits are refused', () => {
  for (const angle of [0, 360, -360, Infinity, NaN]) assert.equal(chainArc([0, 0], [10, 0], angle), null)
  assert.equal(chainArc([0, 0], [0, 0], 90), null)
  assert.equal(splitArc([0, 0], [10, 0], 90, [0, 0]), null)
  assert.equal(splitArc([0, 0], [10, 0], 90, [10, 0]), null)
  assert.equal(arcHit([0, 0], [10, 0], 90, [NaN, 0]), null)
})
