import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridChoices, lengthValue, localPose, worldDelta, segmentIndices } from '../src/edit-toolbar.ts'

test('placement fields use their translated, rotated or mirrored source frame', () => {
  assert.deepEqual(localPose({ at: [12, 5, 0], m: [1, 0, 0, 1, 16, 5] }), [-4, 0, 0])
  assert.deepEqual(localPose({ at: [10, 9, 90], m: [0, -1, 1, 0, 10, 5] }), [-4, 0, 0])
  assert.deepEqual(worldDelta({ m: [0, -1, 1, 0, 10, 5] }, [1, 0]), [0, -1])
  assert.deepEqual(worldDelta({ m: [-1, 0, 0, 1, 10, 5] }, [1, 0]), [-1, 0])
})

test('placement inputs accept lengths and custom grids retain their subdivisions', () => {
  assert.equal(lengthValue('100mil'), 2.54)
  assert.equal(lengthValue('-3mm'), -3)
  assert.equal(lengthValue('bad'), null)
  assert.equal(lengthValue('4deg'), null)
  assert.ok([0.8, 0.4, 0.2, 0.08].every(p => gridChoices(0.8).includes(p)))
})

test('trace navigation skips width and via boundaries and retains first and last geometric indices', () => {
  assert.deepEqual(segmentIndices([{op:'H'}, {op:'width'}, {op:'via'}, {op:'v'}, {op:'X'}, {op:'Z'}]), [0, 3, 4, 5])
  assert.deepEqual(segmentIndices([]), [])
})
