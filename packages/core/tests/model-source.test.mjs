// Where a part's 3D body comes from: a box or no model at all is `missing`, never a generated body.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countModels, modelSource } from '../dist/model-source.js'

test('model source: file, generated, no body and no model', () => {
  assert.equal(modelSource({ file: './x.step' }, 1), 'file')
  assert.equal(modelSource({ kind: 'chip', part: 'R', size: '0603' }, 0.5), 'generated')
  assert.equal(modelSource({ kind: 'ic', w: 5, h: 4, height: 1.5 }, 1.5), 'generated')
  assert.equal(modelSource({ kind: 'box', w: 4, h: 3, height: 2 }, 2), 'missing')
  assert.equal(modelSource(undefined, 1), 'missing')
  assert.equal(modelSource(undefined, 0), 'none', 'a bare hole has no body')
  assert.equal(modelSource({ kind: 'box', w: 1, h: 1, height: 0 }, 0), 'none')
  assert.equal(modelSource({ kind: 'none' }, 1), 'none')
  assert.deepEqual(countModels([{ height: 1 }, { height: 1, step: {} }, { height: 1, model: { kind: 'sot23', pins: 3 } }]), { file: 1, generated: 1, none: 0, missing: 1 })
})
