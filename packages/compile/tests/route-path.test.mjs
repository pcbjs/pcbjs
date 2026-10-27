import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutePath } from '../dist/route-path.js'
import { coordString } from '@pcbjs/core/units'

// the steps without the character ranges, which tests/segments.test.mjs checks
const steps = (src, layer) => parseRoutePath(src, layer).map(({ at: _, ...st }) => st)
const bad = (src, re) => assert.throws(() => parseRoutePath(src), e => re.test(e.message), `${src} should fail with ${re}`)

test('route path: the cursor starts at a, so line commands come first and M is refused', () => {
  assert.deepEqual(steps('V 14 L 5 16 Z'), [{ op: 'V', y: 14, rel: false }, { op: 'L', x: 5, y: 16, rel: false }, { op: 'Z' }])
  bad('M 0 0 L 1 1 Z', /starts at a, leave out the M/)
  bad('m 1 1 Z', /leave out the m/)
})

test('route path: relative commands, repeated arguments and SVG number syntax', () => {
  assert.deepEqual(steps('l 1 2 3 4 h -1.5 v.5 x 2,2 z'), [
    { op: 'L', x: 1, y: 2, rel: true }, { op: 'L', x: 3, y: 4, rel: true }, { op: 'H', x: -1.5, rel: true },
    { op: 'V', y: 0.5, rel: true }, { op: 'X', x: 2, y: 2, rel: true }, { op: 'Z' },
  ])
})

test('route path: @ changes layer, X autoroutes to a point, XZ and X Z autoroute to b', () => {
  assert.deepEqual(steps('X 3 4 @B.Cu XZ'), [{ op: 'X', x: 3, y: 4, rel: false }, { op: 'U', layer: 'B.Cu' }, { op: 'XZ' }])
  assert.deepEqual(steps('H 2 X Z'), [{ op: 'H', x: 2, rel: false }, { op: 'XZ' }])
})

test('route path: @<layer> places a via, with or without a space, through the layer aliases', () => {
  const alias = l => (l === 'bottom' ? 'B.Cu' : l === 'top' ? 'F.Cu' : l)
  const via = layer => ({ op: 'U', layer })
  assert.deepEqual(steps('@B.Cu XZ'), [via('B.Cu'), { op: 'XZ' }])
  assert.deepEqual(steps('@ B.Cu XZ'), [via('B.Cu'), { op: 'XZ' }])
  assert.deepEqual(steps('@bottom XZ', alias), [via('B.Cu'), { op: 'XZ' }])
  assert.deepEqual(steps('H 2 @In1.Cu H 4 @top Z', alias), [{ op: 'H', x: 2, rel: false }, via('In1.Cu'), { op: 'H', x: 4, rel: false }, via('F.Cu'), { op: 'Z' }])
  assert.deepEqual(steps('V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ'), steps('V 14 L 5 16 U B.Cu H 24 V 7.5 U F.Cu XZ'))
  bad('@', /@ needs a layer, for example @B\.Cu/)
  bad('H 2 @ , Z', /@ needs a layer, for example @B\.Cu/)
  bad('H 2 @ XZ', /@ needs a layer/)
  bad('@ Z', /@ needs a layer/)
})

test('route path: U <layer> is still accepted for compatibility', () => {
  assert.deepEqual(steps('X 3 4 U B.Cu XZ'), [{ op: 'X', x: 3, y: 4, rel: false }, { op: 'U', layer: 'B.Cu' }, { op: 'XZ' }])
  assert.deepEqual(steps('u In2.Cu Z'), [{ op: 'U', layer: 'In2.Cu' }, { op: 'Z' }])
  assert.deepEqual(steps('U bottom XZ', l => (l === 'bottom' ? 'B.Cu' : l)), [{ op: 'U', layer: 'B.Cu' }, { op: 'XZ' }])
  bad('U', /U needs a layer/)
})

test('route path: omitted or empty is XZ', () => {
  assert.deepEqual(steps(''), [{ op: 'XZ' }])
  assert.deepEqual(steps('  '), [{ op: 'XZ' }])
})

test('route path: every path ends at b with Z or XZ, and nothing follows them', () => {
  bad('V 14 L 5 16', /must end at b/)
  bad('X 1 1', /must end at b/)
  bad('Z H 1', /Z ends the route at b/)
  bad('XZ Z', /XZ ends the route at b/)
})

test('route path: curves and unknown commands are refused', () => {
  for (const c of ['A 1 1 0 0 1 2 2 Z', 'C 1 1 2 2 3 3 Z', 'Q 1 1 2 2 Z', 'S 1 1 2 2 Z', 'T 1 1 Z', 'c 1 1 2 2 3 3 Z']) bad(c, /is a curve/)
  bad('K 1 Z', /unknown command K/)
  bad('L 1 Z', /expected a number/)
  bad('3 4 Z', /expected a command/)
})

test('coordinate strings: a first token that is a number is a coordinate, a dot followed by letters is a pad reference', () => {
  assert.deepEqual(coordString('5 16 B.Cu'), { x: 5, y: 16, layer: 'B.Cu' })
  assert.deepEqual(coordString('24 7.5'), { x: 24, y: 7.5 })
  assert.deepEqual(coordString(' .5  -1mm '), { x: 0.5, y: -1 })
  assert.equal(coordString('J1.3'), null)
  assert.equal(coordString('D1.K'), null)
  assert.equal(coordString('B.Cu'), null)
  assert.throws(() => coordString('5'), /expected "x y" or "x y layer"/)
  assert.throws(() => coordString('5 6 B.Cu extra'), /expected "x y" or "x y layer"/)
})
