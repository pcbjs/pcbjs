import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancelFocus, focusTransaction } from '../src/focus-transaction.ts'

const pose = (x, scale = 1) => ({ centre: [x, x + 1], scale })

test('finding A to B and manual motion retain the original camera checkpoint', () => {
  const slots = new Map()
  const tx = focusTransaction(slots, 'board:target', '2d')
  const original = pose(1, 4),
    a = pose(10),
    b = pose(20),
    manual = pose(30, 0.5)
  tx.save(original)
  tx.begin('finding', original)
  tx.save(a)
  tx.begin('finding', a)
  tx.save(b)
  tx.begin('finding', b)
  tx.save(manual)
  tx.cancel(['finding'])
  assert.equal(tx.takeRestore(), undefined, 'changing a finding is not a cancellation')
  assert.deepEqual(tx.current(), manual)
  tx.cancel([])
  assert.deepEqual(tx.takeRestore(), original)
  assert.deepEqual(tx.current(), original)
  assert.equal(tx.takeRestore(), undefined, 'a checkpoint is consumed once')
})

test('nested frame and finding cancellation restores the frame, then the original camera', () => {
  const slots = new Map()
  const tx = focusTransaction(slots, 'board:target', '3d')
  const original = pose(1, 4),
    isolated = pose(10, 2),
    finding = pose(20)
  tx.begin('frame', original)
  tx.save(isolated)
  tx.begin('finding', isolated)
  tx.save(finding)
  tx.cancel(['frame'])
  assert.deepEqual(tx.takeRestore(), isolated)
  tx.cancel(['frame'])
  assert.equal(tx.takeRestore(), undefined, 'the underlying frame stays active')
  tx.cancel([])
  assert.deepEqual(tx.takeRestore(), original)
  assert.deepEqual(tx.current(), original)
})

test('consecutive offscreen cancellations queue the outermost rollback for remount', () => {
  const slots = new Map()
  let tx = focusTransaction(slots, 'board:target', 'sch')
  const original = pose(1, 4),
    framed = pose(10, 2),
    finding = pose(20)
  tx.begin('frame', original)
  tx.save(framed)
  tx.begin('finding', framed)
  tx.save(finding)
  cancelFocus(slots, ['frame'])
  cancelFocus(slots, [])
  cancelFocus(slots, [])
  tx = focusTransaction(slots, 'board:target', 'sch')
  assert.deepEqual(tx.current(), finding, 'saved display state remains until queued rollback is consumed')
  assert.deepEqual(tx.takeRestore(), original, 'canceling the frame supersedes the queued finding rollback')
  assert.deepEqual(tx.current(), original)
  assert.equal(tx.takeRestore(), undefined)
})

test('a queued offscreen finding rollback can be consumed before another finding begins', () => {
  const slots = new Map()
  let tx = focusTransaction(slots, 'board:target', '2d')
  const original = pose(1, 4),
    a = pose(10),
    b = pose(20)
  tx.begin('finding', original)
  tx.save(a)
  cancelFocus(slots, [])
  tx = focusTransaction(slots, 'board:target', '2d')
  const restored = tx.takeRestore()
  assert.deepEqual(restored, original)
  tx.begin('finding', restored)
  tx.save(b)
  tx.cancel([])
  assert.deepEqual(tx.takeRestore(), original)
})

test('target, view and pane scopes keep independent checkpoints and displayed state', () => {
  const slots = new Map()
  const specifications = [
    ['board:target-a', '2d'],
    ['board:target-b', '2d'],
    ['board:target-a', '3d'],
    ['board:target-a', 'sch'],
  ]
  const views = specifications.map(([scope, view], i) => {
    const tx = focusTransaction(slots, scope, view)
    const original = pose(i + 1, 4),
      focused = pose(i + 10)
    tx.begin('finding', original)
    tx.save(focused)
    return { tx, original, focused }
  })
  views[0].tx.cancel([])
  assert.deepEqual(views[0].tx.takeRestore(), views[0].original)
  for (const { tx, focused } of views.slice(1)) {
    assert.equal(tx.takeRestore(), undefined)
    assert.deepEqual(tx.current(), focused)
  }
  const otherPane = focusTransaction(new Map(), 'board:target-a', '2d')
  assert.equal(otherPane.current(), undefined)
  assert.equal(otherPane.takeRestore(), undefined)
  for (const { tx, original } of views.slice(1)) {
    tx.cancel([])
    assert.deepEqual(tx.takeRestore(), original)
  }
})

test('canceling an outer frame rebases a still-active finding onto the original camera', () => {
  const slots = new Map()
  const tx = focusTransaction(slots, 'board:target', '3d')
  const original = pose(1, 4),
    frame = pose(10, 2),
    finding = pose(20)
  tx.begin('frame', original)
  tx.save(frame)
  tx.begin('finding', frame)
  tx.save(finding)
  tx.cancel(['finding'])
  const restored = tx.takeRestore()
  assert.deepEqual(restored, original, 'an inner checkpoint cannot survive removal of its coordinate frame')
  tx.begin('finding', restored)
  tx.save(pose(30))
  tx.cancel([])
  assert.deepEqual(tx.takeRestore(), original)
})
