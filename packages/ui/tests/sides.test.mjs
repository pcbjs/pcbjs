// The 2D view's active side on top and its mirror: the draw order and the URL, imported straight from the client TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layerTable } from '@pcbjs/core/internal/layers'
import { drawOrder } from '../src/sides.ts'
import { parseViewQuery, sideSearch } from '../src/query.ts'

const sideOf = id => layerTable(4).find(l => l.id === id).side

test('draw order: the active side last, under only the layers of both sides', () => {
  const layers = layerTable(4)
  for (const side of ['F', 'B']) {
    const order = drawOrder(layers, side).map(l => l.id)
    assert.equal(order.length, layers.length)
    const near = side === 'F' ? 'front' : 'back'
    const first = order.findIndex(id => sideOf(id) === near)
    const tail = order.slice(first).map(sideOf)
    assert.ok(
      tail.every(s => s === near || s === 'both'),
      `${side}: nothing of the far side or inside over the active side`,
    )
    assert.ok(order.indexOf(`${side}.SilkS`) > order.indexOf(`${side}.Cu`), `${side}: silk over its copper`)
    assert.ok(order.indexOf(`${side}.Cu`) > order.indexOf('In1.Cu'), `${side}: copper over the inner layers`)
    assert.equal(order.at(-1), layers.at(-1).id, 'the layers of both sides stay on top')
  }
  assert.deepEqual(
    drawOrder(layers, 'B')
      .filter(l => l.side !== 'both')
      .map(l => l.id),
    drawOrder(layers, 'F')
      .filter(l => l.side !== 'both')
      .map(l => l.id)
      .reverse(),
    'B is the stack of F turned over',
  )
})

test('side and mirror round-trip through the URL, the defaults left out', () => {
  for (const side of ['F', 'B'])
    for (const mirror of [false, true]) {
      const search = sideSearch('?view=2d&select=U1', side, mirror)
      const q = parseViewQuery(search)
      assert.equal(q.side ?? 'F', side)
      assert.equal(q.mirror ?? false, mirror)
      assert.equal(q.view, '2d', 'the rest of the query is kept')
      assert.equal(q.select, 'U1')
    }
  assert.equal(sideSearch('?side=B&mirror=1', 'F', false), '')
  assert.equal(sideSearch('', 'B', true), '?side=B&mirror=1')
  assert.equal(parseViewQuery('?side=b').side, 'B')
  assert.equal(parseViewQuery('?mirror=0').mirror, false)
})
