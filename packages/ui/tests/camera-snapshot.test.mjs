import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { snapshotCamera, restoreCamera } from '../src/scene/camera-snapshot.ts'

const near = (a, b) => assert.ok(a.distanceTo(b) < 1e-10, `${a.toArray()} equals ${b.toArray()}`)
test('camera rollback restores the original pose after successive fits and manual orbit, cancelling pending movement', () => {
  const camera = new PerspectiveCamera(35, 1.6, 0.1, 5000)
  camera.up.set(0, 0, 1)
  camera.position.set(40, -70, 60)
  const controls = new OrbitControls(camera, null)
  controls.target.set(7, -4, 2)
  controls.cursor.set(3, 2, 1)
  controls.enableDamping = true
  controls.update()
  const base = snapshotCamera(camera, controls, 43)
  // Finding A, then B, then the user pans/orbits while still focused.
  for (const [x, y, z] of [
    [2, 4, 12],
    [18, -3, 20],
    [22, -8, 9],
  ]) {
    camera.position.set(x, y, z)
    controls.target.set(x / 3, y / 3, 0)
    controls.update()
  }
  camera.near = 0.01
  camera.far = 300
  camera.zoom = 2
  camera.fov = 50
  // Residual inertia from a real OrbitControls interaction must not survive rollback.
  controls._sphericalDelta.theta = 0.4
  controls._panOffset.set(2, -1, 4)
  let springActive = true,
    stackActive = true,
    pendingNearFar = [0.01, 300]
  const radius = restoreCamera(camera, controls, base, () => {
    springActive = stackActive = false
    pendingNearFar = null
  })
  assert.equal(springActive, false)
  assert.equal(stackActive, false)
  assert.equal(pendingNearFar, null)
  assert.equal(radius, 43)
  for (let i = 0; i < 20; i++) controls.update()
  near(camera.position, base.position)
  near(controls.target, base.target)
  near(controls.cursor, base.cursor)
  near(camera.up, base.up)
  assert.ok(1 - Math.abs(camera.quaternion.dot(base.quaternion)) < 1e-12)
  for (const key of ['near', 'far', 'zoom', 'fov']) assert.equal(camera[key], base[key])
  assert.equal(controls.enableDamping, true)
})

test('snapshots own their vectors and cannot follow later camera or controls mutations', () => {
  const camera = new PerspectiveCamera()
  camera.position.set(3, 4, 5)
  const controls = new OrbitControls(camera, null)
  const original = camera.position.clone()
  const base = snapshotCamera(camera, controls, 10)
  camera.position.set(50, 60, 70)
  controls.target.set(4, 5, 6)
  controls.cursor.set(7, 8, 9)
  near(base.position, original)
  assert.deepEqual(base.target.toArray(), [0, 0, 0])
  assert.deepEqual(base.cursor.toArray(), [0, 0, 0])
})
