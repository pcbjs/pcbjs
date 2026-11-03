// The 3D view's model choice: a part's own model, none for `none`, else a box of its body when it has a height.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelChoice } from '../src/models/choice.ts'

const body = { w: 3, h: 2 }
test('model choice: box by height, nothing at height 0 as a bare hole comes, own model and none win', () => {
  assert.deepEqual(modelChoice({ body, height: 1.2 }), { kind: 'box', w: 3, h: 2, height: 1.2 })
  assert.equal(modelChoice({ body, height: 0 }), null)
  assert.equal(modelChoice({ body, height: 1, model: { kind: 'none' } }), null)
  assert.deepEqual(modelChoice({ body, height: 0, model: { kind: 'sot23', pins: 3 } }), { kind: 'sot23', pins: 3 })
})
