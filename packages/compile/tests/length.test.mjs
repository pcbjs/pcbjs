import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeLength, viaLength, segmentLengths, longestFreeSegment, spliceSegment } from '../dist/length.js'
import { near } from './helpers.mjs'

const stackup = {
  thickness: 1.6,
  layers: [
    { type: 'mask', side: 'F', thickness: 0.01 },
    { type: 'copper', name: 'F.Cu', thickness: 0.035 },
    { type: 'prepreg', thickness: 0.2 },
    { type: 'copper', name: 'In1.Cu', thickness: 0.0152 },
    { type: 'core', thickness: 1.0 },
    { type: 'copper', name: 'In2.Cu', thickness: 0.0152 },
    { type: 'prepreg', thickness: 0.2 },
    { type: 'copper', name: 'B.Cu', thickness: 0.035 },
    { type: 'mask', side: 'B' },
  ],
}

test('segmentLengths', () => {
  assert.deepEqual(segmentLengths([[0, 0], [3, 4], [3, 10]]), [5, 6])
  assert.deepEqual(segmentLengths([[1, 1]]), [])
})

test('viaLength sums the stackup between the two copper layers', () => {
  near(viaLength(['F.Cu', 'B.Cu'], stackup), 0.2 + 0.0152 + 1.0 + 0.0152 + 0.2, 1e-12)
  near(viaLength(['F.Cu', 'In1.Cu'], stackup), 0.2, 1e-12)
  near(viaLength(['In2.Cu', 'In1.Cu'], stackup), 1.0, 1e-12)
  assert.equal(viaLength(['F.Cu', 'F.Cu'], stackup), 0)
  assert.equal(viaLength(['F.Cu', 'In7.Cu'], stackup), 1.6)
  assert.equal(viaLength(['F.Cu', 'B.Cu'], 1.6), 1.6)
})

test('routeLength adds tracks and vias', () => {
  const tracks = [{ pts: [[0, 0], [3, 4]] }, { pts: [[3, 4], [3, 10]] }]
  const vias = [{ layers: ['F.Cu', 'In1.Cu'] }, { layers: ['In1.Cu', 'B.Cu'] }]
  near(routeLength(tracks, vias, stackup), 11 + 0.2 + 1.2152, 1e-12)
  near(routeLength(tracks, [{ layers: ['F.Cu', 'B.Cu'] }], 0.8), 11.8, 1e-12)
  assert.equal(routeLength([], [], stackup), 0)
})

test('longestFreeSegment picks the long segment on its free side, kept clear of the next segment', () => {
  const pts = [[0, 0], [10, 0], [10, 2]]
  const calls = []
  const isFree = (layer, x, y, net, width) => { calls.push([layer, net, width]); return y >= -1e-9 }
  const f = longestFreeSegment(pts, isFree, 0.2, 1, { layer: 'F.Cu', net: 'CLK', step: 0.05 })
  assert.deepEqual(calls[0], ['F.Cu', 'CLK', 0.2])
  assert.equal(f.index, 0)
  assert.equal(f.side, 'right')
  near(f.from, 0, 1e-9)
  near(f.to, 9.6, 0.05 + 1e-9)
  near(f.length, f.to - f.from, 1e-12)
  assert.deepEqual(f.a, [0, 0])
  near(f.b[0], f.to, 1e-12)
})

test('longestFreeSegment finds a gap between obstacles and returns null when blocked everywhere', () => {
  const blockedOutside = (l, x, y) => x > 3 && x < 7
  const f = longestFreeSegment([[0, 0], [10, 0]], blockedOutside, 0.2, 1, { layer: 'F.Cu', step: 0.1 })
  assert.equal(f.side, 'left')
  near(f.from, 3.1, 1e-9); near(f.to, 6.9, 1e-9)
  assert.equal(longestFreeSegment([[0, 0], [10, 0]], () => false, 0.2, 1, { layer: 'F.Cu' }), null)
})

test('spliceSegment inserts a replacement inside a segment', () => {
  const out = spliceSegment([[0, 0], [10, 0], [10, 5]], 0, [[2, 0], [2, 1], [3, 1], [3, 0]])
  assert.deepEqual(out, [[0, 0], [2, 0], [2, 1], [3, 1], [3, 0], [10, 0], [10, 5]])
})
