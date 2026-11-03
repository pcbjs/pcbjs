// Copper of one net on one layer is drawn as one region: the union of its items less the drills, and a point on it names the item under it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ItemPicker, unionRings } from '../dist/scene/merge.js'
import { signedArea } from '../dist/scene/shapes.js'
import { flatten, runJob } from '../dist/scene/geometry.js'

// an outer ring as the items export gives it, positive by signedArea
const rect = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]
const circle = (cx, cy, r, n = 32) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)])
const hole = r => [...r].reverse()
const total = rings => rings.reduce((s, r) => s + signedArea(r), 0)
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} is not ${b}`)

test('the outer rings are positive, as the union expects them', () => {
  assert.ok(signedArea(rect(0, 0, 2, 1)) > 0)
  assert.ok(signedArea(circle(0, 0, 1)) > 0)
})

test('two overlapping tracks are one ring of their union', () => {
  const out = unionRings([rect(0, 0, 4, 1), rect(3, 0, 1, 4)])
  assert.equal(out.length, 1)
  near(signedArea(out[0]), 4 + 4 - 1)
})

test('items apart stay apart, and the union is deterministic', () => {
  const rings = [rect(0, 0, 1, 1), rect(3, 0, 1, 1), rect(0.5, 0, 1, 1)]
  const out = unionRings(rings)
  assert.equal(out.length, 2)
  near(total(out), 1.5 + 1)
  assert.deepEqual(unionRings(rings), out)
})

test('an item keeps its own hole; a track over a via fills it until the drill cuts it again', () => {
  const via = [circle(0, 0, 0.3), hole(circle(0, 0, 0.15))]
  near(total(unionRings(via)), total(via), 1e-6)
  const track = rect(-2, -0.2, 4, 0.4)
  const filled = unionRings([...via, track])
  assert.equal(filled.length, 1, 'the track fills the annulus hole')
  const cut = unionRings([...via, track], [circle(0, 0, 0.15)])
  assert.ok(
    cut.some(r => signedArea(r) < 0),
    'the drill is a hole again',
  )
  near(total(cut), total(filled) - signedArea(circle(0, 0, 0.15)), 1e-6)
})

test('a merged unit job extrudes the union: one top face where the items overlap', () => {
  const rings = [rect(0, 0, 4, 1), rect(3, 0, 1, 4)]
  const top = r => {
    let a = 0
    const p = r.position
    for (let i = 0; i < p.length; i += 9) {
      if (p[i + 2] !== 1 || p[i + 5] !== 1 || p[i + 8] !== 1) continue
      a += Math.abs((p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 6] - p[i]) * (p[i + 4] - p[i + 1])) / 2
    }
    return a
  }
  const stacked = runJob({ kind: 'unit', key: 'a', rings: flatten(rings) })
  const merged = runJob({ kind: 'unit', key: 'b', rings: flatten(rings), merge: flatten([]) })
  near(top(stacked), 8)
  near(top(merged), 7)
})

test('the picker names the item under a point: a pad over its pour, the later of two tracks', () => {
  // document order: a pour, a track, a pad, a second track over the first, a via with its hole
  const rings = [[rect(0, 0, 10, 10)], [rect(1, 1, 6, 0.4)], [rect(5, 0.8, 1, 0.8)], [rect(2, 1, 0.4, 6)], [circle(8, 8, 0.3), hole(circle(8, 8, 0.15))]]
  const rank = [6, 3, 1, 3, 2]
  const p = new ItemPicker(rings, rank)
  assert.equal(p.at([0.5, 9]), 0, 'only the pour')
  assert.equal(p.at([4, 1.2]), 1, 'the track over the pour')
  assert.equal(p.at([5.5, 1.2]), 2, 'the pad over the track')
  assert.equal(p.at([2.2, 1.2]), 3, 'the later of two tracks')
  assert.equal(p.at([8.2, 8]), 4, 'the via ring')
  assert.equal(p.at([8, 8]), 0, 'the drill of the via is the pour')
})

test('a point just off every item, on a wall or the mask flare, names the nearest; one far off none', () => {
  const p = new ItemPicker([[rect(0, 0, 4, 0.4)], [rect(5, 0, 4, 0.4)]], [3, 3])
  assert.equal(p.at([2, 0.43]), 0)
  assert.equal(p.at([5.2, -0.02]), 1)
  assert.equal(p.at([4.5, 0.2]), -1)
  assert.equal(p.at([4.6, 0.2], 0.6), 1, 'a wider tolerance, the nearer of the two')
})
