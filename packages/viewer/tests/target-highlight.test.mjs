// The highlight of a target the language server resolved under the editor cursor: a pad is its own item and nothing of its
// part, a group its parts, a net its copper, each tinted by area as any source highlight; a clicked pad knows its number.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openQuery, padOf, targetHighlight } from '../src/source.ts'
import { hlStrength, ringsArea } from '../src/scene/intensity.ts'

const square = (x, y, s) => [[[x, y], [x + s, y], [x + s, y + s], [x, y + s]]]
const items = [
  { id: 1, kind: 'pad', ref: 'D1', net: 'SIG', layers: ['F.Cu'], rings: square(0, 0, 1) },
  { id: 2, kind: 'pad', ref: 'D1', net: 'GND', layers: ['F.Cu'], rings: square(2, 0, 1) },
  { id: 3, kind: 'zone', net: 'GND', layers: ['B.Cu'], rings: square(0, 0, 40) },
]
const board = { name: 'B', items, layers: [{ id: 'F.Cu', svg: '<g><path data-id="1" data-kind="pad" data-ref="D1" data-pad="2" d="M0 0"/><path data-id="2" data-kind="pad" data-ref="D1" data-pad="1" d="M2 0"/></g>' }] }
const target = (kind, b) => ({ kind, boards: [{ board: 'B', ids: [], refs: [], ...b }] })

test('a pad target highlights that pad alone, at full strength for its area', () => {
  const h = targetHighlight(target('pad', { ids: [2], name: 'D1.1' }), 'B')
  assert.deepEqual(h, { ids: [2], refs: [], label: 'pad D1.1' })
  assert.equal(hlStrength(ringsArea(items[1].rings)), 1)
})

test('a group target highlights its parts by ref', () => {
  const h = targetHighlight(target('group', { refs: ['R1', 'C1'], name: 'CH1' }), 'B')
  assert.deepEqual(h, { ids: [], refs: ['R1', 'C1'], label: 'group CH1' })
})

test('a net target tints a pour by its area like any other highlight', () => {
  const h = targetHighlight(target('net', { ids: [2, 3], name: 'GND' }), 'B')
  assert.deepEqual(h.ids, [2, 3])
  assert.ok(hlStrength(ringsArea(items[2].rings)) < 0.2)
})

test('points and a reference; another board or an empty target gives nothing', () => {
  assert.deepEqual(targetHighlight(target('point', { points: [[5, 15]], name: '5 15' }), 'B').points, [[5, 15]])
  assert.equal(targetHighlight(target('reference', { reference: 'Other', name: 'Other' }), 'B').reference, 'Other')
  assert.equal(targetHighlight(target('pad', { ids: [2], name: 'D1.1' }), 'A'), null)
  assert.equal(targetHighlight(target('pad', { name: 'D1.1' }), 'B'), null)
  assert.equal(targetHighlight(undefined, 'B'), null)
})

test('a clicked pad: its number from the markup, and the open query asks for its key', () => {
  assert.equal(padOf(board, 1), '2')
  assert.equal(padOf(board, 2), '1')
  assert.equal(padOf(board, 3), null)
  const q = new URLSearchParams(openQuery('main.tsx', { start: [8, 5], pad: 'D1.1', board: 'B' }))
  assert.equal(q.get('pad'), 'D1.1')
  assert.equal(q.get('board'), 'B')
})
