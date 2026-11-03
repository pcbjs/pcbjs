import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bubbleAt } from '../src/bubble.ts'

test('bubbles follow the pointer, flip near edges, and stay inside an inset viewport', () => {
  assert.deepEqual(bubbleAt(50, 50, 100, 40, [0, 0, 400, 300]), [62, 62])
  assert.deepEqual(bubbleAt(390, 290, 100, 40, [0, 0, 400, 300]), [278, 238])
  assert.deepEqual(bubbleAt(30, 75, 100, 40, [20, 30, 180, 100]), [42, 38])
})
