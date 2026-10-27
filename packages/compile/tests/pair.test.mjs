import { test } from 'node:test'
import assert from 'node:assert/strict'
import { offsetPair, pairEnds, pairVias, pairLengths, fitCentre, offsetPolyline, turn, PairGeometryError } from '../dist/pair.js'
import { near, nearPt } from './helpers.mjs'

const W = 0.2, G = 0.15, PITCH = W + G, H = PITCH / 2

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const unit = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l] }
function segDist(p, a, b) {
  const d = sub(b, a), l2 = d[0] ** 2 + d[1] ** 2
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1])
}
const polyDist = (p, pts) => Math.min(...pts.slice(1).map((q, i) => segDist(p, pts[i], q)))
function segsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign(cross(sub(q, p), sub(r, p)))
  const on = (p, q, r) => Math.min(p[0], q[0]) - 1e-12 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-12 && Math.min(p[1], q[1]) - 1e-12 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-12
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b)
  if (o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4) return true
  return (!o1 && on(a, b, c)) || (!o2 && on(a, b, d)) || (!o3 && on(c, d, a)) || (!o4 && on(c, d, b))
}
function assertSimple(pts, name) {
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 2; j < pts.length - 1; j++)
      assert.ok(!segsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1]), `${name} crosses itself at segments ${i} and ${j}`)
}
function assertDisjoint(a, b) {
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++)
      assert.ok(!segsIntersect(a[i], a[i + 1], b[j], b[j + 1]), `P segment ${i} touches N segment ${j}`)
}
/** Samples every coupled centre segment where both offsets exist and checks P sits at +h and N at -h, so the gap is the pitch. */
function assertGap(r) {
  let samples = 0
  for (const c of r.centre) {
    for (let i = 0; i < c.length - 1; i++) {
      const d = unit(sub(c[i + 1], c[i])), n = [d[1], -d[0]], L = Math.hypot(...sub(c[i + 1], c[i]))
      const tr = k => (k <= 0 || k >= c.length - 1 ? 0 : Math.abs(Math.tan(turn(unit(sub(c[k], c[k - 1])), unit(sub(c[k + 1], c[k]))) / 2)) * H)
      const s0 = tr(i), s1 = L - tr(i + 1)
      for (let k = 0; k <= 20; k++) {
        const s = s0 + ((s1 - s0) * k) / 20, p = [c[i][0] + d[0] * s, c[i][1] + d[1] * s]
        const pp = [p[0] + n[0] * H, p[1] + n[1] * H], pn = [p[0] - n[0] * H, p[1] - n[1] * H]
        near(polyDist(pp, r.P), 0, 1e-6, `P is off its offset at ${pp}`)
        near(polyDist(pn, r.N), 0, 1e-6, `N is off its offset at ${pn}`)
        near(Math.hypot(...sub(pp, pn)), PITCH, 1e-6)
        samples++
      }
    }
  }
  assert.ok(samples > 0)
}
/** No point of the coupled P track comes closer than the pitch to N. `skip` fan segments at each end are left out. */
function assertNoCloser(r, skip = 0) {
  for (let i = skip; i < r.P.length - 1 - skip; i++)
    for (let k = 0; k <= 20; k++) {
      const a = r.P[i], b = r.P[i + 1], p = [a[0] + (b[0] - a[0]) * k / 20, a[1] + (b[1] - a[1]) * k / 20]
      assert.ok(polyDist(p, r.N) >= PITCH - 1e-6, `P at ${p} is ${polyDist(p, r.N)} from N`)
    }
}
const check = (r, skip = 0) => { assertSimple(r.P, 'P'); assertSimple(r.N, 'N'); assertDisjoint(r.P, r.N); assertGap(r); assertNoCloser(r, skip) }

test('straight pair: P on the left of travel, N on the right, equal lengths', () => {
  const r = offsetPair([[0, 0], [10, 0]], W, G)
  assert.deepEqual(r.P, [[0, -H], [10, -H]])
  assert.deepEqual(r.N, [[0, H], [10, H]])
  check(r)
  near(r.skew, 0, 1e-9)
  assert.equal(r.uncoupled, 0)
  assert.deepEqual(r.viasP, [])
})

test('one 90 degree bend: constant gap, the outer track 4h longer', () => {
  const r = offsetPair([[0, 0], [10, 0], [10, 10]], W, G)
  check(r)
  nearPt(r.P[1], [10 + H, -H], 1e-12)
  nearPt(r.N[1], [10 - H, H], 1e-12)
  near(r.lengthP - r.lengthN, 4 * H, 1e-9)
  near(r.skew, 4 * H, 1e-9)
})

test('one 45 degree bend: constant gap and no crossing', () => {
  const r = offsetPair([[0, 0], [10, 0], [17, 7]], W, G)
  check(r)
  near(r.skew, 4 * H * Math.tan(Math.PI / 8), 1e-9)
})

test('an S curve of two opposite 45 degree bends keeps P and N equal', () => {
  const r = offsetPair([[0, 0], [5, 0], [8, 3], [13, 3]], W, G)
  check(r)
  near(r.lengthP, r.lengthN, 1e-6)
})

test('a U turn wider than the pitch offsets cleanly; a tighter one throws', () => {
  const r = offsetPair([[0, 0], [10, 0], [10, 3], [0, 3]], W, G)
  check(r)
  assert.throws(() => offsetPair([[0, 0], [10, 0], [10, 0.2], [0, 0.2]], W, G), PairGeometryError)
})

test('two 45 degree bends too close for the inner track merge into one bend', () => {
  const c = [[0, 0], [10, 0], [10.1, 0.1], [10.1, 10]]
  assert.ok(offsetPolyline(c, -H).length === 4)
  const f = fitCentre(c, H)
  assert.equal(f.length, 3)
  nearPt(f[1], [10.1, 0], 1e-12)
  check(offsetPair(c, W, G))
})

test('a first segment shorter than the bend trim is dropped for both tracks', () => {
  const r = offsetPair([[0, 0], [0.05, 0], [0.05, 10]], W, G)
  check(r)
  assert.equal(r.P.length, 2)
  near(r.lengthP, r.lengthN, 1e-9)
})

test('a via pair in a straight run flares out and back at 45 degrees and keeps P and N equal', () => {
  const r = offsetPair([[0, 0], [5, 0], [10, 0]], W, G, { vias: [1], viaSize: 0.6, clearance: 0.2 })
  check(r)
  nearPt(r.viasP[0], [5, -0.4], 1e-12)
  nearPt(r.viasN[0], [5, 0.4], 1e-12)
  assert.equal(r.runsP.length, 2)
  nearPt(r.runsP[0].at(-1), r.viasP[0], 0)
  nearPt(r.runsP[1][0], r.viasP[0], 0)
  const e = (0.8 - PITCH) / 2
  nearPt(r.runsP[0].at(-2), [5 - e, -H], 1e-12)
  nearPt(r.runsN[1][1], [5 + e, H], 1e-12)
  near(r.lengthP, r.lengthN, 1e-6)
  near(r.viaUncoupled, 0, 0)
})

test('vias no wider than the pitch sit on the tracks', () => {
  const v = pairVias([5, 0], [1, 0], [1, 0], PITCH, 0.2, 0.1)
  near(v.spacing, PITCH, 1e-12)
  nearPt(v.P, [5, -H], 1e-12)
  near(v.before.uncoupled + v.after.uncoupled, 0, 1e-12)
})

test('a via pair at a bend sits across the bisector, each track fanning in and out symmetrically, no crossing', () => {
  for (const end of [[5, 5], [5, -5], [10, 5]]) {
    const r = offsetPair([[0, 0], [5, 0], end], W, G, { vias: [1], viaSize: 0.6, clearance: 0.2 })
    check(r)
    near(Math.hypot(...sub(r.viasP[0], r.viasN[0])), 0.8, 1e-12)
    for (const runs of [r.runsP, r.runsN]) {
      const a = runs[0], b = runs[1]
      near(Math.hypot(...sub(a.at(-1), a.at(-2))), Math.hypot(...sub(b[1], b[0])), 1e-12)
    }
    assert.ok(r.viaUncoupled > 0)
    // each track clears the other's via by more than the via radius plus half the width
    for (const [pts, via] of [[r.P, r.viasN[0]], [r.N, r.viasP[0]]]) assert.ok(polyDist(via, pts) > 0.3 + W / 2, `${polyDist(via, pts)}`)
  }
  const v = pairVias([5, 0], [1, 0], [0, 1], PITCH, 0.6, 0.2)
  nearPt(v.P, [5 + 0.4 / Math.SQRT2, -0.4 / Math.SQRT2], 1e-12)
})

test('pads wider than the pitch fan in at 45 degrees', () => {
  const e = pairEnds([0, -1], [0, 1], [1, 0], PITCH)
  near(e.advance, (2 - PITCH) / 2, 1e-12)
  nearPt(e.P, [e.advance, -H], 1e-12)
  near(e.uncoupled, 2 * Math.SQRT2 * e.advance, 1e-12)
  assert.equal(e.crossed, false)
  const r = offsetPair([[0, 0], [10, 0]], W, G, { startPads: [[0, -1], [0, 1]], endPads: [[10, -1], [10, 1]] })
  check(r, 1)
  const d = sub(r.P[1], r.P[0])
  near(Math.abs(d[0]), Math.abs(d[1]), 1e-12)
  near(r.uncoupled, 2 * e.uncoupled, 1e-9)
  near(r.lengthP, r.lengthN, 1e-9)
})

test('pads closer than the pitch fan out at 45 degrees', () => {
  const e = pairEnds([0, -0.1], [0, 0.1], [1, 0], PITCH)
  near(e.advance, (PITCH - 0.2) / 2, 1e-12)
  const r = offsetPair([[0, 0], [10, 0], [10, 10]], W, G, { startPads: [[0, -0.1], [0, 0.1]], endPads: [[10.1, 10], [9.9, 10]] })
  assertSimple(r.P, 'P'); assertSimple(r.N, 'N'); assertDisjoint(r.P, r.N); assertGap(r)
  const d = sub(r.N[1], r.N[0])
  near(Math.abs(d[0]), Math.abs(d[1]), 1e-12)
  near(r.uncoupled, 4 * Math.SQRT2 * e.advance, 1e-9)
})

test('pairEnds at the far end and swapped pads', () => {
  const e = pairEnds([10, -1], [10, 1], [1, 0], PITCH, 'end')
  nearPt(e.coupled, [10 - e.advance, 0], 1e-12)
  nearPt(e.P, [10 - e.advance, -H], 1e-12)
  assert.equal(pairEnds([0, 1], [0, -1], [1, 0], PITCH).crossed, true)
})

test('pairLengths', () => {
  const l = pairLengths([[0, 0], [3, 4]], [[0, 0], [1, 0]])
  assert.deepEqual(l, { P: 5, N: 1, skew: 4 })
})

// ---- the layout of a routed centre line, src/compile/pair-lay.ts ----

const job = (o) => ({ id: 'pair:1', nets: ['P', 'N'], w: 0.29, g: 0.29, via: { drill: 0.2, size: 0.45 }, clearance: 0.2, copper: 0.127, holeClearance: 0.2, minWidth: 0.1, copperLayers: ['F.Cu', 'B.Cu'], pads: [null, null, null, null], vias: [], layers: ['F.Cu'], ...o })

test('pair layout: a via pair the maze put at a jog right past the fan moves onto the jog, P and N keep their clearance', async () => {
  const { layCentre, layPairJob, pairClash } = await import('../dist/pair-lay.js')
  // the lvds-camera review: a stub, a 0.1 mm knee the maze left, a via 0.4 mm past the fan at a bend
  const j = job({ centre: [[6.4, 7.25], [7.63, 7.25], [7.7, 7.18], [7.7, 7], [8.2, 6.5], [20, 6.5]], vias: [3], layers: ['F.Cu', 'B.Cu'], autoVias: [0],
    auto: [false, true, true, true, true, false], startPads: [[6.4, 7.5], [6.4, 7]], endPads: [[20, 6.79], [20, 6.21]] })
  // the fans join their tracks where they meet them, so even as routed neither track crosses to the other's via
  assert.equal(pairClash(layCentre(j)), null)
  const laid = layPairJob(j)
  assert.equal(pairClash(laid), null)
  assert.deepEqual(laid.job.centre, [[6.4, 7.25], [7.63, 7.25], [8.2, 6.5], [20, 6.5]])
  assert.deepEqual(laid.job.vias, [1])
  // the centre line still starts at the midpoint of the pads, so the two fans mirror each other
  const P = laid.tracks.find(t => t.role === 'P'), N = laid.tracks.find(t => t.role === 'N')
  near(P.pts[1][1] - 7.25, 7.25 - N.pts[1][1], 1e-9)
})

test('pair layout: a turn over 135 degrees the maze left is cut instead of failing the pair', async () => {
  const { layCentre, layPairJob, pairClash } = await import('../dist/pair-lay.js')
  const j = job({ centre: [[0, 0], [5, 0], [4.9, 0.05], [10, 0.05]], auto: [false, true, true, false], startPads: [[0, -0.29], [0, 0.29]], endPads: [[10, -0.24], [10, 0.34]] })
  assert.throws(() => layCentre(j), /turns by more than 135 degrees/)
  const laid = layPairJob(j)
  assert.deepEqual(laid.job.centre, [[0, 0], [4.9, 0.05], [10, 0.05]])
  assert.equal(pairClash(laid), null)
  // a hand drawn vertex is never cut: the same line from the path fails with the reason
  assert.throws(() => layPairJob({ ...j, auto: [false, false, false, false] }), /135 degrees/)
})

test('pair layout: a centre line that reaches coordinate ends at 45 degrees gets a square approach, no pinch between P and N', async () => {
  const { layCentre, layPairJob, pairClash } = await import('../dist/pair-lay.js')
  // the eth-phy review: ends 0.29 mm apart on a vertical line, the last leg arriving diagonally
  for (const a of [[17.4, 9.975], [17.4, 11.975], [17.9, 9.975]]) {
    const j = job({ w: 0.14, g: 0.15, centre: [[10, a[1]], a, [18.4, 10.975]], auto: [false, true, false], startPads: [[10, a[1] - 0.145], [10, a[1] + 0.145]], endPads: [[18.4, 10.83], [18.4, 11.12]] })
    assert.ok(pairClash(layCentre(j)), `as routed from ${a} the tracks pinch`)
    const laid = layPairJob(j)
    assert.equal(pairClash(laid), null)
    const c = laid.job.centre
    near(c[c.length - 2][1], 10.975, 1e-9, 'the last segment is square to the two ends')
  }
})

test('pair layout: in staggered rows each track runs to the far edge of both pads before it fans', async () => {
  const { edges } = await import('../dist/pair-lay.js')
  const pad = (x, y) => ({ kind: 'pad', at: [x, y], size: [1.3, 1.3], rot: 0, poly: [[x - 0.65, y - 0.65], [x + 0.65, y - 0.65], [x + 0.65, y + 0.65], [x - 0.65, y + 0.65]] })
  const [p, n] = edges([pad(16.78, 10.43), pad(15, 11.45)], [[16.78, 10.43], [15, 11.45]], [1, 0])
  nearPt(p, [17.43, 10.43], 1e-9)
  nearPt(n, [17.43, 11.45], 1e-9)
  // a coordinate end fans from the point itself
  assert.deepEqual(edges([null, null], [[1, 2], [1, 3]], [1, 0]), [[1, 2], [1, 3]])
})

test('pair tune: tunePairCentre meanders the centre line, both tracks grow alike and stay a pitch apart', async () => {
  const { tunePairCentre } = await import('../dist/pair-tune.js')
  const { pairClash } = await import('../dist/pair-lay.js')
  const j = job({ centre: [[0, 5], [30, 5]], auto: [false, false], startPads: [[0, 4.71], [0, 5.29]], endPads: [[30, 4.71], [30, 5.29]] })
  const measure = l => Math.max(l.lengthP, l.lengthN)
  for (const extra of [3, 0.8]) {
    const t = tunePairCentre(j, extra, { pair: { free: () => true }, measure, tolerance: 0.01 })
    near(t.added, extra, 0.01)
    near(t.laid.lengthP, t.laid.lengthN, 1e-6)
    near(t.laid.lengthP, 30 + extra, 0.01)
    assert.equal(pairClash(t.laid), null)
    assert.equal(t.note, undefined)
    // U bumps: square corners in the centre line with their radius, laid out as concentric arcs on both tracks
    assert.ok(t.laid.job.radii.filter(r => r > 0).length >= 4)
    const arcs = t.laid.tracks.flatMap(tr => tr.prims.filter(p => p.kind === 'arc'))
    const P = arcs.filter((_, i) => i < arcs.length / 2), N = arcs.filter((_, i) => i >= arcs.length / 2)
    assert.equal(P.length, N.length)
    P.forEach((a, i) => near(Math.hypot(a.center[0] - N[i].center[0], a.center[1] - N[i].center[1]), 0, 1e-9))
  }
  // less than the smallest U bump, (2 pi - 4) times the track width here, is not placed, and the note says so
  const small = tunePairCentre(j, 0.2, { pair: { free: () => true }, measure, tolerance: 0.01 })
  assert.equal(small.added, 0)
  assert.match(small.note, /below the smallest U bump of 0\.66 mm/)
  // no room: the pair stays as it was and says why
  const none = tunePairCentre(j, 2, { pair: { free: () => false }, measure })
  assert.equal(none.added, 0)
  assert.match(none.note, /had no room/)
})

test('neck: the pieces of a track necked at both ends, and the neck length found by stepping out of the pad', async () => {
  const { neckPieces, neckLength, neckOf } = await import('../dist/neck.js')
  const parts = neckPieces([[0, 0], [10, 0]], 0.6, { width: 0.25, length: 1 }, { width: 0.3, length: 2 })
  assert.deepEqual(parts.map(p => [p.width, p.pts]), [[0.25, [[0, 0], [1, 0]]], [0.6, [[1, 0], [8, 0]]], [0.3, [[8, 0], [10, 0]]]])
  // blocked within 0.6 mm of the start: the neck runs past it by a step and a clearance
  const free = (_l, x) => x > 0.6
  near(neckLength(free, 'F.Cu', [[0, 0], [10, 0]], 'S', 0.6, 2, 0.1), 0.75, 1e-9)
  near(neckLength(() => true, 'F.Cu', [[0, 0], [10, 0]], 'S', 0.6, 2, 0.1), 0, 1e-9)
  near(neckLength(() => false, 'F.Cu', [[0, 0], [10, 0]], 'S', 0.6, 2, 0.1), 2, 1e-9)
  const pad = { size: [1.3, 0.3] }
  assert.deepEqual(neckOf(pad, 0.6, 0.1), { width: 0.3, length: 2 })
  assert.deepEqual(neckOf(pad, 0.6, 0.1, { width: 0.2, length: 1 }), { width: 0.2, length: 1 })
  assert.equal(neckOf(pad, 0.25, 0.1), null, 'no narrower than the route')
  assert.equal(neckOf(pad, 0.6, 0.1, { length: 0 }), null, 'length 0 turns it off')
  assert.deepEqual(neckOf(pad, 0.6, 0.35), { width: 0.35, length: 2 }, 'never below minTrackWidth')
})
