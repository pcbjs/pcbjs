// Outline rings oriented by containment: outlines positive, cutouts negative, islands in cutouts positive, however drawn.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, pour, resetDefaults } from '@pcbjs/core'
import { PinHeader, rect } from '@pcbjs/lib'
import { compileBoard } from '../dist/index.js'
import { area, orientRings, polysToRings, union } from '../dist/geom.js'

const sq = (x, y, s) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
]
const sign = r => Math.sign(area([r]))

test('orientRings: three depths, every combination of drawing directions', () => {
  const rings = [sq(0, 0, 40), sq(5, 5, 30), sq(10, 10, 20), sq(15, 15, 10)]
  for (let mask = 0; mask < 16; mask++) {
    const drawn = rings.map((r, i) => (mask & (1 << i) ? r.slice().reverse() : r))
    const o = orientRings(drawn)
    assert.deepEqual(o.map(sign), [1, -1, 1, -1], `mask ${mask}`)
    // the region is board, cutout, island, cutout in it, whatever the drawing
    assert.equal(Math.round(Math.abs(area(polysToRings(union(o))))), 1600 - 900 + 400 - 100)
  }
})

test('orientRings: rings already right are returned as they are', () => {
  const rings = [sq(0, 0, 40), sq(5, 5, 30).reverse()]
  const o = orientRings(rings)
  assert.equal(o[0], rings[0])
  assert.equal(o[1], rings[1])
})

function cutBoard(sweep) {
  const { GND } = nets()
  const J1 = PinHeader(1).connect(GND)
  return compileBoard(
    h(
      PCB,
      { name: 'Cut' },
      h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }),
      h('path', { layer: 'Edge.Cuts', d: `M 7 10 A 3 3 0 0 ${sweep} 13 10 A 3 3 0 0 ${sweep} 7 10 Z` }),
      h(J1, { at: '3 3' }),
      pour(GND, 'F.Cu', rect(20, 20)),
    ),
  )
}

test('cutouts: a cutout drawn either way gives the same outline and the same fill', () => {
  resetDefaults()
  const a = cutBoard(0),
    b = cutBoard(1)
  for (const x of [a, b]) {
    assert.equal(x.outline.length, 2)
    assert.deepEqual(x.outline.map(sign).sort(), [-1, 1])
    assert.equal(x.drc.filter(d => d.severity === 'error').length, 0)
  }
  const fill = x => Math.abs(area(polysToRings(x.items.find(i => i.kind === 'zone').fill)))
  assert.ok(Math.abs(fill(a) - fill(b)) < 1e-6, `${fill(a)} vs ${fill(b)}`)
  // the pour keeps clear of the hole: 400 mm² less the edge band and a hole grown by the clearance
  assert.ok(fill(a) < 400 - Math.PI * 9, `fill ${fill(a)}`)
})

test('cutouts: a cutout outside the outline is a cutout-outside error', () => {
  resetDefaults()
  const b = compileBoard(h(PCB, { name: 'Off' }, h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }), h('path', { layer: 'Edge.Cuts', d: rect(4, 4, 30, 30) })))
  const e = b.drc.filter(d => d.rule === 'cutout-outside')
  assert.equal(e.length, 1)
  assert.match(e[0].message, /lies outside the board outline, 16 mm²/)
  assert.deepEqual(e[0].at, [32, 32])
})
