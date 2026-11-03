// The edge predicates of src/compile/spatial.ts against the Clipper booleans they replace as yes or no tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EdgeSet, distance, gap, overlap, overlapsNear, ringsGap, within } from '../dist/spatial.js'
import { difference, offset, overlaps, polysToRings, strokeOpen } from '../dist/geom.js'
import { circleRing } from '../dist/path.js'

function rng(seed) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

/** A star-shaped ring about x, y, convex or not, either winding, its points on the 10 nm grid half the time. */
function ring(r, x, y, size) {
  const n = 3 + Math.floor(r() * 9),
    concave = r() < 0.5,
    snap = r() < 0.5
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n + r() * 0.3,
      d = size * (concave && i % 2 ? 0.35 + r() * 0.3 : 0.8 + r() * 0.4)
    const p = [x + d * Math.cos(a), y + d * Math.sin(a)]
    return snap ? p.map(v => Math.round(v * 1e5) / 1e5) : p
  })
  return r() < 0.5 ? pts : pts.reverse()
}
const square = (x, y, w, h = w) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]
const set = rings => new EdgeSet(rings)

test('overlap: random rings answer as overlaps(), near, far and inside one another', () => {
  const r = rng(11)
  for (let k = 0; k < 4000; k++) {
    const a = [ring(r, 0, 0, 1)],
      b = [ring(r, (r() - 0.5) * 4, (r() - 0.5) * 4, 0.2 + r() * 1.5)]
    assert.equal(overlap(set(a), set(b)), overlaps(a, b), JSON.stringify({ a, b }))
  }
})

test('overlap: rings touching along an edge or at a point do not overlap, as overlaps() has it, down to its 10 nm grid', () => {
  const cases = []
  for (const e of [0, 1e-5, -1e-5, 4e-6, -4e-6, 6e-6, -6e-6, 2e-5, -2e-5]) {
    cases.push([square(0, 0, 1), square(1 + e, 0, 1)]) // side by side
    cases.push([square(0, 0, 1), square(1 + e, 0.25, 0.5)]) // part of an edge
    cases.push([square(0, 0, 1), square(1 + e, 1 + e, 1)]) // corner to corner
    cases.push([square(0, 0, 1), square(0, 0, 1 + e)]) // one in the other, edges shared
    cases.push([square(0, 0, 1), square(0.25, e, 0.5)]) // inside, on its bottom edge
    cases.push([
      square(0, 0, 1),
      [
        [0.5, 1 + e],
        [1, 2],
        [0, 2],
      ],
    ]) // a vertex on an edge
    cases.push([
      square(0, 0, 1),
      [
        [1 + e, 0.5],
        [2, 0],
        [2, 1],
      ],
    ])
    cases.push([
      square(0, 0, 1),
      [
        [0.5, 1 - 1e-5 + e],
        [0.5 + 2e-5, 2],
        [0.5 - 2e-5, 2],
      ],
    ]) // a needle 10 nm deep
  }
  cases.push([square(0, 0, 1), square(0, 0, 1)])
  cases.push([square(0, 0, 1), square(0, 0, 1).reverse()])
  for (const [a, b] of cases) {
    assert.equal(overlap(set([a]), set([b])), overlaps([a], [b]), JSON.stringify({ a, b }))
    assert.equal(overlap(set([b]), set([a])), overlaps([b], [a]), JSON.stringify({ b, a }))
  }
})

test('overlap: a carved pour with holes against shapes in its holes, across its edges and on them', () => {
  const holes = []
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) holes.push(circleRing(2 + i * 3, 2 + j * 3, 0.8))
  const slots = Array.from({ length: 40 }, (_, i) => polysToRings(offset([square(0.9 * i, 0, 0.1, 15 + (i % 7))], 0.15))).flat()
  const pour = polysToRings(difference([square(0, 0, 37)], [...holes, ...slots]))
  const p = set(pour)
  const r = rng(5)
  for (let k = 0; k < 240; k++) {
    const x = r() * 37,
      y = r() * 37
    const shape = k % 3 ? [ring(r, x, y, 0.1 + r() * 1.2)] : [circleRing(2 + 3 * Math.floor(r() * 12), 2 + 3 * Math.floor(r() * 12), 0.3 + r() * 0.6)]
    assert.equal(overlap(set(shape), p), overlaps(shape, pour), `shape at ${x}, ${y}`)
    assert.equal(overlap(p, set(shape)), overlaps(shape, pour), `shape at ${x}, ${y}`)
  }
  // a ring of the pour itself and the pour, and the pour against itself shifted by a grid step
  assert.equal(overlap(p, set([pour[0]])), overlaps(pour, [pour[0]]))
  const moved = pour.map(q => q.map(([x, y]) => [x + 1e-5, y]))
  assert.equal(overlap(p, set(moved)), overlaps(pour, moved))
})

test('distance: the edge gap of random rings, 0 when they overlap, as measured edge to edge', () => {
  const r = rng(3)
  for (let k = 0; k < 2000; k++) {
    const a = [ring(r, 0, 0, 1)],
      b = [ring(r, (r() - 0.5) * 5, (r() - 0.5) * 5, 0.2 + r() * 1.5)]
    const want = overlaps(a, b) ? 0 : ringsGap(a, b)
    const got = distance(set(a), set(b), 10)
    assert.ok(Math.abs(got - want) < 2e-5, `${got} against ${want} for ${JSON.stringify({ a, b })}`)
    assert.equal(within(set(a), set(b), want + 1e-4), true)
    if (want > 1e-4) assert.equal(within(set(a), set(b), want - 1e-4), false)
  }
})

test('within: agrees with grown-then-intersected outside the band its round chords leave', () => {
  // the DRC's clearance test before: each side grown by half the clearance less half a micron, then overlaps()
  const r = rng(17)
  let decided = 0
  for (let k = 0; k < 1500; k++) {
    const a = [ring(r, 0, 0, 1)],
      b = [ring(r, 1.5 + r() * 1.5, (r() - 0.5) * 3, 0.2 + r() * 1.2)]
    if (overlaps(a, b)) continue
    const c = 0.05 + r() * 0.5,
      g = c / 2 - 0.0005
    const grown = overlaps(polysToRings(offset(a, g)), polysToRings(offset(b, g)))
    if (within(set(a), set(b), 2 * g - 0.03)) assert.equal(grown, true, JSON.stringify({ a, b, c }))
    if (!within(set(a), set(b), 2 * g + 1e-4)) assert.equal(grown, false, JSON.stringify({ a, b, c }))
    decided++
  }
  assert.ok(decided > 1000)
})

test('within: a hole capsule as a two point ring, against strokeOpen of its axis', () => {
  const r = rng(23)
  for (let k = 0; k < 800; k++) {
    const a = [r() * 2, r() * 2],
      b = r() < 0.5 ? a : [a[0] + r() * 1.5, a[1] + r() * 1.5]
    const R = 0.2 + r() * 0.6
    const copper = [ring(r, (r() - 0.5) * 5, (r() - 0.5) * 5, 0.2 + r() * 1)]
    const keep = polysToRings(strokeOpen([a, b], 2 * R))
    const axis = set([[a, b]])
    if (within(axis, set(copper), R - 0.03)) assert.equal(overlaps(keep, copper), true)
    if (!within(axis, set(copper), R + 1e-4)) assert.equal(overlaps(keep, copper), false)
  }
})

test('gap: the witness pair and the measured gap edge to edge', () => {
  const a = [square(0, 0, 1)],
    b = [square(1.5, 0.25, 0.5)]
  assert.deepEqual(gap(set(a), set(b)), {
    d: 0.5,
    pts: [
      [1, 0.25],
      [1.5, 0.25],
    ],
  })
  assert.equal(gap(set(a), set([square(0.25, 0.25, 0.5)])).d, 0)
})

test('overlapsNear: the Clipper answer on the nearby rings, which the predicates leave a contact to', () => {
  const a = [square(0, 0, 1)],
    b = [square(0.5, 0.5, 1)]
  assert.equal(overlapsNear(set(a), set(b)), true)
  assert.equal(overlapsNear(set(a), set([square(1, 0, 1)])), false)
})
