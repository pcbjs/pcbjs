// The rotation ring: 24 ticks, a major every 90 degrees from the grid's angle across the band, minors on its outer half, all in
// proportion to the ring and never under a pixel, the heading triangle outside the band pointing at the centre at the rotation,
// and a radius whose band clears every corner of the parts about the origin, an instance's own included.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { polyPath, ringRadius, ringShape } from '../src/ring.ts'

const dist = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1])
/** the angle of p about c, degrees counter-clockwise on screen, y down, in [0, 360) */
const angle = (p, c) => ((((-Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI) % 360) + 360) % 360
const mid = q => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4]

test('ring: ticks every 15 degrees from the grid angle, majors every 90 across the band, minors on its outer half', () => {
  const c = [10, 5]
  const s = ringShape(c, 10, 0, 30, 0.04)
  assert.ok(Math.abs(s.band - 0.8) < 1e-9)
  assert.equal(s.ticks.length, 72)
  assert.deepEqual(
    s.ticks.filter(t => t.major).map(t => Math.round(angle(mid(t.quad), c))),
    [30, 120, 210, 300],
  )
  s.ticks.forEach((t, k) =>
    assert.ok(Math.abs((((angle(mid(t.quad), c) - 30 - 5 * k) % 360) + 360) % 360) < 1e-6 || Math.abs(((((angle(mid(t.quad), c) - 30 - 5 * k) % 360) + 360) % 360) - 360) < 1e-6),
  )
  const major = s.ticks[0].quad,
    minor = s.ticks[3].quad
  assert.ok(Math.abs(dist(major[0], c) - dist(major[1], c) + 0.8) < 1e-3, 'a major spans the band')
  assert.ok(
    Math.abs(dist(minor[1], c) - 10.4) < 1e-3 && Math.abs(Math.hypot(minor[0][0] - minor[3][0], minor[0][1] - minor[3][1]) - 0.048) < 1e-6,
    'a minor its outer half, 6% of the band wide',
  )
  assert.ok(Math.abs(Math.hypot(major[0][0] - major[3][0], major[0][1] - major[3][1]) - 0.096) < 1e-6, 'a major 12% of the band wide')
  // proportional: a ring a fifth larger, every length a fifth larger
  const big = ringShape(c, 12, 0, 30, 0.04)
  assert.ok(Math.abs(big.band - 0.96) < 1e-9)
  assert.ok(Math.abs(Math.hypot(big.ticks[0].quad[0][0] - big.ticks[0].quad[3][0], big.ticks[0].quad[0][1] - big.ticks[0].quad[3][1]) - 0.1152) < 1e-6)
  // a huge ring keeps its band at two dozen pixels
  assert.ok(Math.abs(ringShape(c, 100, 0, 30, 0.04).band - 0.96) < 1e-9)
})

test('ring: never thinner than a few pixels when zoomed out, nor thicker than two dozen zoomed in', () => {
  const s = ringShape([0, 0], 1, 0, 0, 0.1)
  assert.ok(Math.abs(s.band - 0.6) < 1e-9, 'six pixels of band')
  const q = s.ticks[1].quad
  assert.ok(Math.abs(Math.hypot(q[0][0] - q[3][0], q[0][1] - q[3][1]) - 0.1) < 1e-9, 'a minor a pixel wide')
})

test('ring: the heading triangle sits outside the band at the rotation, pointing inward', () => {
  const c = [3, 4]
  for (const rot of [0, 90, 135, 270]) {
    const s = ringShape(c, 10, rot, 0, 0.01)
    const [apex, b1, b2] = s.tri
    const outer = 10 + s.band / 2
    assert.ok(dist(apex, c) > outer, 'outside the band')
    assert.ok(dist(b1, c) > dist(apex, c) && Math.abs(dist(b1, c) - dist(b2, c)) < 1e-9, 'its base further out, square to the radius')
    assert.ok(Math.abs(angle(apex, c) - rot) < 1e-6, `the apex at ${rot} degrees`)
    const base = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2]
    assert.ok(Math.abs(angle(base, c) - rot) < 1e-6, 'pointing at the centre')
  }
  assert.match(polyPath([ringShape(c, 10, 0, 0, 0.01).tri]), /^M[\d. -]+L[\d. -]+L[\d. -]+Z$/)
})

test('ring: its band clears every corner of the parts about the origin, an instance whose origin is off its parts included', () => {
  // CH1 of Blinky: the frame's origin at 0 5, its parts from x 10.4 to 21.6
  const box = [10.4, 4.4, 11.2, 1.2]
  const r = ringRadius([0, 5], box, 0.05)
  const s = ringShape([0, 5], r, 0, 0, 0.05)
  const far = Math.hypot(21.6, 0.6)
  assert.ok(r - s.band / 2 > far, 'the band clears the farthest corner')
  assert.ok(r - s.band / 2 - far <= 8 * 0.05 + 1e-9, 'by eight pixels')
})

test('compact compasses retain fifteen degree ticks instead of crowded fine marks', () => {
  assert.equal(ringShape([0, 0], 2, 0, 0, 0.1).ticks.length, 24)
  assert.equal(ringShape([0, 0], 20, 0, 0, 0.1).ticks.length, 72)
})
