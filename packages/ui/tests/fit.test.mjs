// The 3D fit frames the board, its parts and references, and the exploded stack, never the ground grid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { fitBox, fitDistance, fitSphere } from '../src/scene/fit.ts'

const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `${a} near ${b}`))
const slab = (w, h, t, name) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t))
  m.name = name
  return m
}

function scene() {
  const s = new THREE.Scene(),
    board = new THREE.Group()
  const core = new THREE.Group()
  core.name = 'core'
  core.add(slab(40, 30, 1.6))
  core.position.z = 0.8
  const parts = new THREE.Group()
  parts.name = 'bodies:F'
  parts.add(slab(5, 5, 2))
  parts.position.set(10, 0, 2.6)
  board.add(core, parts)
  const grid = new THREE.Group()
  grid.name = 'grid'
  grid.add(slab(400, 400, 0.01))
  grid.position.z = -1
  s.add(board, grid)
  return { board, parts }
}

test('the fit is the board group alone: a grid ten times its size changes nothing', () => {
  const { board } = scene()
  const b = fitBox(board)
  near(b.min.toArray(), [-20, -15, 0])
  near(b.max.toArray(), [20, 15, 3.6])
  assert.ok(Math.abs(fitSphere(b).radius - Math.hypot(40, 30, 3.6) / 2) < 1e-9)
})

test('a referenced board in the group widens the fit', () => {
  const { board } = scene()
  const ref = new THREE.Group()
  ref.name = 'References'
  ref.add(slab(10, 10, 1))
  ref.position.set(30, 0, 0)
  board.add(ref)
  near([fitBox(board).max.x], [35])
})

test('the exploded stack: each group moved to where the explode is heading', () => {
  const { board, parts } = scene()
  const b = fitBox(board, c => (c === parts ? 12 : 0))
  near([b.max.z], [15.6])
  assert.equal(fitSphere(new THREE.Box3()), null)
})

test('the camera distance puts every corner of the box on screen, and only just', () => {
  const box = new THREE.Box3(new THREE.Vector3(-20, -10, 0), new THREE.Vector3(20, 10, 2))
  const up = new THREE.Vector3(0, 0, 1),
    vfov = Math.PI / 4
  // from above on a square screen the 40 mm side decides: 20 / tan(22.5 deg) past the top face
  assert.ok(Math.abs(fitDistance(box, new THREE.Vector3(0, -1e-3, 1), up, vfov, 1, 1) - (1 + 20 / Math.tan(vfov / 2))) < 0.05)
  // a tall exploded stack seen from the side needs more room than its footprint
  const tall = box.clone().expandByPoint(new THREE.Vector3(0, 0, 60))
  assert.ok(fitDistance(tall, new THREE.Vector3(1, -1, 0.6), up, vfov, 1.6) > fitDistance(box, new THREE.Vector3(1, -1, 0.6), up, vfov, 1.6) * 1.5)
})
