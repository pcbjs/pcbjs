// A selected pad knows its number from its item row, so opening its placement asks for its key in the connect call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openQuery, padOf } from '../src/source.ts'

const board = {
  name: 'B',
  items: [
    { id: 1, kind: 'pad', ref: 'D1', pad: '2', layers: ['F.Cu'] },
    { id: 2, kind: 'pad', ref: 'D1', pad: '1', layers: ['F.Cu'] },
    { id: 3, kind: 'track', layers: ['F.Cu'] },
  ],
}

test('a clicked pad: its number from its row, and the open query asks for its key', () => {
  assert.equal(padOf(board, 1), '2')
  assert.equal(padOf(board, 2), '1')
  assert.equal(padOf(board, 3), null)
  const q = new URLSearchParams(openQuery('main.tsx', { start: [8, 5], pad: 'D1/1', board: 'B' }))
  assert.equal(q.get('pad'), 'D1/1')
  assert.equal(q.get('board'), 'B')
})
