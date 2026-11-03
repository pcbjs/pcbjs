// Connection indicators: the selection's unrouted connections with their layers, an arc clearing the tallest part, a cross-side
// connection ending above the far pad with a stem through the board, two back ends under it, an inner layer's stem, and the 2D marks.
import { test } from 'node:test'
import { shaped } from './shaped.mjs'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { connections, curve3, line2, CLEAR } = await import('../src/indicators.ts')

const sq = (x, y) => [
  [
    [x - 0.5, y - 0.5],
    [x + 0.5, y - 0.5],
    [x + 0.5, y + 0.5],
    [x - 0.5, y + 0.5],
  ],
]
/** U1 on the front at 2 2 and C1 on the back at 10 2, both on net A, unrouted; a 3 mm tall K1 on the front between them; R1 on the back. */
const board = shaped({
  footprints: [
    { ref: 'U1', side: 'F', height: 1, bbox: { x: 1, y: 1, w: 2, h: 2 }, pads: [{ num: '1', net: 'A', at: [2, 2] }] },
    { ref: 'C1', side: 'B', height: 0.5, bbox: { x: 9, y: 1, w: 2, h: 2 }, pads: [{ num: '1', net: 'A', at: [10, 2] }] },
    { ref: 'K1', side: 'F', height: 3, bbox: { x: 5, y: 0, w: 2, h: 4 }, pads: [] },
    { ref: 'R1', side: 'B', height: 0.4, bbox: { x: 9, y: 5, w: 2, h: 2 }, pads: [{ num: '1', net: 'B', at: [10, 6] }] },
  ],
  items: [
    { id: 1, kind: 'pad', net: 'A', ref: 'U1', layers: ['F.Cu'], rings: sq(2, 2) },
    { id: 2, kind: 'pad', net: 'A', ref: 'C1', layers: ['B.Cu'], rings: sq(10, 2) },
    { id: 3, kind: 'pad', net: 'B', ref: 'R1', layers: ['B.Cu'], rings: sq(10, 6) },
    { id: 4, kind: 'via', net: 'B', layers: ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'], rings: sq(2, 6) },
    { id: 5, kind: 'track', net: 'C', layers: ['In2.Cu'], rings: sq(2, 9) },
    { id: 6, kind: 'pad', net: 'C', layers: ['B.Cu'], rings: sq(10, 9) },
  ],
  ratsnest: [
    { net: 'A', from: [2, 2], to: [10, 2] },
    { net: 'B', from: [10, 6], to: [12, 6] },
    { net: 'C', from: [2, 9], to: [10, 9] },
  ],
})
const stack = { z: l => ({ 'F.Cu': 1.6, 'In1.Cu': 1.1, 'In2.Cu': 0.5, 'B.Cu': 0 })[l], top: 1.6, bottom: 0 }
const sel = parts => ({ parts: new Set(parts), ids: new Set(), nets: new Set() })

test('indicators: only the selection’s connections, each end with its copper layer', () => {
  assert.deepEqual(connections(board, null), [])
  const cs = connections(board, sel(['U1']))
  assert.equal(cs.length, 1)
  assert.equal(cs[0].a.layer, 'F.Cu')
  assert.equal(cs[0].b.layer, 'B.Cu')
})

test('indicators: a cross-side connection arcs over the front, clearing K1, ends above C1 and drops a stem through the board to it', () => {
  const [c] = connections(board, sel(['U1']))
  const k = curve3(board, c, stack)
  assert.deepEqual(k.arc[0], [2, 2, 1.6])
  assert.deepEqual(k.arc[k.arc.length - 1], [10, 2, 1.6])
  const mid = k.arc[(k.arc.length / 2) | 0]
  assert.ok(Math.abs(mid[2] - (1.6 + 3 + CLEAR)) < 1e-9, `apex ${mid[2]}`)
  assert.deepEqual(k.stem, [
    [10, 2, 1.6],
    [10, 2, 0],
  ])
  assert.deepEqual(k.ring, [10, 2, 1.6])
  assert.equal(k.under, false)
})

test('indicators: two ends on the back put the arc under the board; an inner layer end gets a stem to its z inside the slab', () => {
  const r = { net: 'B', a: { at: [10, 6], layer: 'B.Cu', layers: ['B.Cu'] }, b: { at: [12, 6], layer: 'B.Cu', layers: ['B.Cu'] } }
  const under = curve3(board, r, stack)
  assert.equal(under.under, true)
  assert.ok(under.arc.every(p => p[2] <= 0) && under.arc[12][2] < -CLEAR + 1e-9)
  assert.equal(under.stem, null)
  const [c] = connections(board, { parts: new Set(), ids: new Set([5]), nets: new Set() })
  assert.equal(c.a.layer, 'In2.Cu')
  const inner = curve3(board, { ...c, a: c.b, b: c.a }, stack)
  assert.deepEqual(inner.stem, [
    [2, 9, 0],
    [2, 9, 0.5],
  ])
})

test('indicators: in 2D a dot on the active side, a ring on the far side, a ring with the index on an inner layer', () => {
  const [c] = connections(board, sel(['U1']))
  const f = line2(c, 'F')
  assert.deepEqual(
    f.marks.map(m => m.kind),
    ['dot', 'ring'],
  )
  assert.equal(f.fromLayer, 'F.Cu')
  assert.equal(f.toLayer, 'B.Cu')
  assert.deepEqual(
    line2(c, 'B').marks.map(m => m.kind),
    ['ring', 'dot'],
  )
  const [inner] = connections(board, { parts: new Set(), ids: new Set([5]), nets: new Set() })
  assert.deepEqual(line2(inner, 'F').marks[0], { at: [2, 9], kind: 'inner', index: 2, layer: 'In2.Cu' })
})
