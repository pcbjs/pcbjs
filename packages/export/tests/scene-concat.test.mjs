// Geometries laid end to end for one draw: each keeps its triangles in order, and a triangle names the geometry it came from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { concat, flatten, partOf, runJob } from '../dist/scene/geometry.js'

const square = (x, s) =>
  runJob({
    kind: 'unit',
    key: `u:${x}`,
    rings: flatten([
      [
        [x, 0],
        [x + s, 0],
        [x + s, s],
        [x, s],
      ],
    ]),
  })

test('pieces concatenate in order with the first triangle of each, an empty one taking none', () => {
  const a = square(0, 1),
    b = square(5, 2)
  const { position, normal, starts } = concat([a, null, b])
  const ta = a.position.length / 9,
    tb = b.position.length / 9
  assert.deepEqual([...starts], [0, ta, ta, ta + tb])
  assert.equal(position.length, (ta + tb) * 9)
  assert.deepEqual(position.subarray(ta * 9), b.position)
  assert.deepEqual(normal.subarray(0, ta * 9), a.normal)
})

test('a triangle names its piece, never an empty one, and none past the end', () => {
  const starts = new Uint32Array([0, 0, 12, 12, 30])
  assert.equal(partOf(starts, 0), 1)
  assert.equal(partOf(starts, 11), 1)
  assert.equal(partOf(starts, 12), 3)
  assert.equal(partOf(starts, 29), 3)
  assert.equal(partOf(starts, 30), -1)
  assert.equal(partOf(starts, -1), -1)
  assert.equal(partOf(new Uint32Array([0]), 0), -1)
})
