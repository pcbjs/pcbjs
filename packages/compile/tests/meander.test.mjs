import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meander, meanderCapacity, runPitch, uExtra, uAmplitude, smallestBump, bumpRadius, U_LOSS } from '../dist/meander.js'
import { primsLength, arcRadius } from '../dist/round.js'
import { near } from './helpers.mjs'

const shape = { amplitude: 1, spacing: 0.2, width: 0.2, clearance: 0.15 }
const GAP = Math.max(shape.spacing, shape.width + shape.clearance)

/** Local coordinates: s along a to b, t toward the requested side. */
function local(a, b, side) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
  const n = side === 'left' ? [u[1], -u[0]] : [-u[1], u[0]]
  return p => [(p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]]
}
const len = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

/**
 * A U meander: it runs from a to b, stays in its corridor, every line runs along or square to the segment, every arc turns by
 * 90 degrees at a radius of at least the track width, lines and arcs meet tangent, and parallel runs keep the gap.
 */
function assertU(r, a, b, side, o) {
  assert.deepEqual(r.pts[0], a)
  assert.deepEqual(r.pts.at(-1), b)
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), loc = local(a, b, side)
  near(r.added, primsLength(r.prims) - L, 1e-9)
  for (const [s, t] of r.pts.map(loc)) {
    assert.ok(s >= -1e-9 && s <= L + 1e-9, `s ${s} leaves the segment`)
    assert.ok(t >= -1e-9 && t <= o.amplitude + 1e-9, `t ${t} leaves the corridor`)
  }
  for (const p of r.prims) {
    if (p.kind === 'line') {
      const [s0, t0] = loc(p.from), [s1, t1] = loc(p.to)
      assert.ok(Math.abs(s1 - s0) < 1e-9 || Math.abs(t1 - t0) < 1e-9, 'a line along or square to the segment')
    } else {
      assert.ok(arcRadius(p) >= o.width - 1e-9, `arc radius ${arcRadius(p)} below the width`)
      const [s0, t0] = loc(p.from), [s1, t1] = loc(p.to)
      near(Math.abs(s1 - s0), arcRadius(p), 1e-9); near(Math.abs(t1 - t0), arcRadius(p), 1e-9)
    }
  }
  for (let i = 1; i < r.prims.length; i++) near(Math.hypot(r.prims[i].from[0] - r.prims[i - 1].to[0], r.prims[i].from[1] - r.prims[i - 1].to[1]), 0, 1e-9, 'the primitives join end to end')
  // the legs, square to the segment, keep the run pitch apart
  const legs = r.prims.filter(p => p.kind === 'line').map(p => [loc(p.from), loc(p.to)]).filter(([p, q]) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) > 1e-9).map(([p]) => p[0]).sort((x, y) => x - y)
  for (let i = 1; i < legs.length; i++) assert.ok(legs[i] - legs[i - 1] - o.width >= GAP - 1e-9, `legs ${legs[i - 1]} and ${legs[i]} too close`)
}

test('a U bump adds 2A less (8 - 2 pi) r: uExtra and uAmplitude are inverse, the smallest bump has legs of no length', () => {
  near(U_LOSS, 8 - 2 * Math.PI, 1e-15)
  for (const [A, r] of [[1, 0.3], [2, 0.5], [0.6, 0.3]]) near(uAmplitude(uExtra(A, r), r), A, 1e-12)
  near(smallestBump(0.2), uExtra(0.4, 0.2), 1e-12)
  near(smallestBump(0.2), (2 * Math.PI - 4) * 0.2, 1e-12)
  // a single track's radius is half the run pitch, never below the width
  near(bumpRadius(shape), runPitch(shape) / 2, 1e-12)
  near(bumpRadius({ ...shape, radius: 0.1 }), 0.2, 1e-12)
})

test('U meanders: a sweep of extras on three segments hits the target, every corner an arc of the radius, the arcs measured as arcs', () => {
  const cases = [[[1, 2], [13, 2], 'left'], [[0, 0], [8, 8], 'right'], [[5, 5], [5, -7], 'left']]
  for (const [a, b, side] of cases) {
    for (let extra = smallestBump(0.2) + 0.01; extra <= 12; extra = +(extra * 1.17 + 0.013).toFixed(6)) {
      const r = meander(a, b, side, { ...shape, extra })
      assert.ok(r && !r.why, `nothing for extra ${extra}: ${r?.why}`)
      assertU(r, a, b, side, shape)
      assert.ok(Math.abs(r.added - extra) <= 0.01 || r.added < extra, `extra ${extra} added ${r.added}`)
      if (meanderCapacity(Math.hypot(b[0] - a[0], b[1] - a[1]), shape) >= extra) near(r.added, extra, 0.01, `extra ${extra} added ${r.added}`)
      // the polyline is the arcs flattened, a little shorter than the arcs
      assert.ok(len(r.pts) <= primsLength(r.prims) + 1e-9 && len(r.pts) > primsLength(r.prims) - 0.01)
    }
  }
})

test('one U bump: its geometry and length by hand', () => {
  // the run pitch, 0.55, widens to twice the radius so the top holds both arcs
  const o = { ...shape, radius: 0.3 }, D = Math.max(runPitch(o), 0.6), extra = uExtra(0.8, 0.3)
  const r = meander([0, 0], [10, 0], 'right', { ...o, extra })
  assert.equal(r.bumps, 1)
  near(r.added, extra, 1e-9)
  assert.equal(r.prims.filter(p => p.kind === 'arc').length, 4)
  // right of travel along +x on the y-down screen is +y: the bump reaches 0.8 down, its legs D apart, centred
  const ys = r.pts.map(p => p[1])
  near(Math.max(...ys), 0.8, 1e-9)
  const legs = r.corners.pts.slice(1, -1).map(p => p[0])
  near(legs[2] - legs[0], D, 1e-9)
  near((legs[0] + legs[2]) / 2, 5, 1e-9)
  assert.deepEqual(r.corners.radii, [0, 0.3, 0.3, 0.3, 0.3, 0])
})

test('the radius shrinks to the width where the amplitude or the stretch is short; below the smallest bump nothing is placed', () => {
  // amplitude 0.5 is below twice the 0.375 default radius: the bump takes a radius of 0.25
  const r = meander([0, 0], [10, 0], 'left', { ...shape, amplitude: 0.5, extra: 0.6 })
  assert.ok(!r.why)
  assert.ok(r.prims.filter(p => p.kind === 'arc').every(p => arcRadius(p) <= 0.25 + 1e-9 && arcRadius(p) >= 0.2 - 1e-9))
  const miss = meander([0, 0], [10, 0], 'left', { ...shape, extra: 0.4 })
  assert.match(miss.why, /below the smallest U bump, 0\.46 mm at the 0\.20 mm radius/)
  assert.match(meander([0, 0], [0.5, 0], 'left', { ...shape, extra: 3 }).why, /too short for a U bump/)
})

test('a room below twice the width takes 45 degree chamfers, the legs between them still a width long', () => {
  const o = { ...shape, amplitude: 0.35 }
  const r = meander([0, 0], [10, 0], 'left', { ...o, extra: 0.5 })
  assert.ok(r && !r.why, r?.why)
  assert.equal(r.prims.filter(p => p.kind === 'arc').length, 0)
  const loc = local([0, 0], [10, 0], 'left')
  const legs = r.prims.filter(p => { const [s0, t0] = loc(p.from), [s1, t1] = loc(p.to); return Math.abs(s1 - s0) < 1e-9 && Math.abs(t1 - t0) > 1e-9 })
  assert.ok(legs.length >= 2 && legs.every(p => Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]) >= o.width - 1e-9))
})

test('a floor keeps a bump from running lower, and impossible requests say why; zero extra returns the segment', () => {
  const r = meander([0, 0], [10, 0], 'left', { ...shape, extra: 2, minAmplitude: 0.9 })
  assert.ok(r.corners.pts.every(p => Math.abs(p[1]) < 1e-9 || Math.abs(p[1]) >= 0.9 - 1e-9))
  assert.match(meander([0, 0], [10, 0], 'left', { ...shape, amplitude: 0.5, minAmplitude: 0.9, extra: 2 }).why, /below the lowest bump/)
  assert.equal(meander([0, 0], [10, 0], 'left', { ...shape, extra: -1 }), null)
  const z = meander([0, 0], [10, 0], 'left', { ...shape, extra: 0 })
  assert.deepEqual([z.pts, z.added, z.bumps], [[[0, 0], [10, 0]], 0, 0])
})

test('more extra than the segment holds gives as many full bumps as fit', () => {
  const r = meander([0, 0], [3, 0], 'left', { ...shape, extra: 20 })
  assertU(r, [0, 0], [3, 0], 'left', shape)
  assert.ok(r.added < 20)
  near(r.added, meanderCapacity(3, shape), 1e-9)
})
