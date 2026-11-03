// The amber outline the 3D view draws around a model the cli found off its courtyard, imported straight from the client
// TypeScript: twelve edges of the model's box in its own frame, so the model's matrix places them with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { issueOutline, ISSUE_COLOR } from '../src/models/outline.ts'
import { placementIssue } from '../src/scene/step-place.ts'

test('the outline is the twelve edges of the model box, amber, and no mesh, so picking skips it', () => {
  const line = issueOutline({ min: [-1, -2, 0], max: [3, 2, 1.5] })
  assert.ok(line.isLineSegments)
  assert.ok(!line.isMesh)
  assert.equal(line.name, 'model-issue')
  assert.equal(line.material.color.getHex(), ISSUE_COLOR)
  const p = line.geometry.getAttribute('position')
  assert.equal(p.count, 24)
  const box = new THREE.Box3().setFromBufferAttribute(p)
  assert.deepEqual(box.min.toArray(), [-1, -2, 0])
  assert.deepEqual(box.max.toArray(), [3, 2, 1.5])
  // every edge runs along one axis
  for (let i = 0; i < 24; i += 2) {
    const d = [p.getX(i + 1) - p.getX(i), p.getY(i + 1) - p.getY(i), p.getZ(i + 1) - p.getZ(i)].filter(v => v !== 0)
    assert.equal(d.length, 1)
  }
})

test('the outline follows the model: a child of the placed group moves with its matrix', () => {
  const g = new THREE.Group()
  g.add(issueOutline({ min: [0, 0, 0], max: [1, 1, 1] }))
  g.matrixAutoUpdate = false
  g.matrix.makeTranslation(10, -5, 1.6)
  g.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(g)
  assert.deepEqual(b.min.toArray(), [10, -5, 1.6])
})

test('the view and the cli judge a placement with the same check', () => {
  assert.equal(typeof placementIssue, 'function')
  assert.match(
    placementIssue({ min: [0, 0, 0], max: [1, 1, 1] }, { offset: [5, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }, { x0: -1, y0: -1, x1: 1, y1: 1 }),
    /past the courtyard at \+x/,
  )
})
