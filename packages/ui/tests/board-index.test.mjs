// The board index answers by id, part, net and route from the rows, once per layers facet: a new facet's rows make a new index.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixture-board.mjs'
import { boardIndex } from '../src/scene/index.ts'

test('an item, a part, a net, a route and a pad number from the rows', () => {
  const b = fixture()
  const ix = boardIndex(b)
  assert.equal(ix.item(9).kind, 'track')
  assert.equal(ix.item(99), undefined)
  assert.deepEqual(ix.byRef('R1'), [1, 2])
  assert.deepEqual(ix.byNet('GND'), [4, 6, 8, 11])
  assert.deepEqual(ix.byRoute('route:1'), [9])
  assert.deepEqual(ix.byRef('nope'), [])
  assert.equal(ix.padNo(3), '1')
  assert.equal(ix.padNo(9), null)
})

test('memoized on the rows: the same board keeps its index, new rows make a new one', () => {
  const b = fixture()
  assert.equal(boardIndex(b), boardIndex({ ...b }))
  assert.notEqual(boardIndex(b), boardIndex({ ...b, items: [...b.items] }))
  assert.deepEqual(boardIndex({}).byNet('GND'), [])
})
