import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateMesh } from '../dist/validate.js'

const triangle = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  color: [0.5, 0.5, 0.5],
})
const codes = m => Object.fromEntries(validateMesh({ meshes: [m] }).issues.map(i => [i.code, i.count]))

test('detects the baked coordinate reflection without repairing input', () => {
  const m = triangle()
  assert.deepEqual(validateMesh({ meshes: [m] }), { triangles: 1, issues: [] })
  for (const a of [m.positions, m.normals]) for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]]
  const before = structuredClone(m)
  assert.deepEqual(codes(m), { winding: 1 })
  assert.deepEqual(m, before)
  m.indices.set([0, 2, 1])
  assert.deepEqual(codes(m), {})
})

test('reports invalid positions, normals, indices and array sizes without throwing', () => {
  const m = triangle()
  m.positions[0] = NaN
  m.normals[3] = Infinity
  m.indices[2] = 99
  assert.deepEqual(codes(m), { 'nonfinite-position': 1, 'nonfinite-normal': 1, 'index-range': 1 })
  m.positions = new Float32Array([0, 0, 0, 1])
  m.normals = new Float32Array(3)
  m.indices = new Uint32Array([0])
  assert.deepEqual(codes(m), { 'array-length': 1, 'zero-normal': 1 })
})

test('counts degenerate triangles separately and permits near-tangent smooth normals', () => {
  const m = triangle()
  m.indices = new Uint32Array([0, 0, 2, 0, 1, 2])
  m.normals.set([1, 0, -0.00001, 1, 0, 0, 1, 0, 0.00001])
  assert.deepEqual(codes(m), { degenerate: 1 })
  assert.equal(validateMesh({ meshes: [m] }).triangles, 2)
})

test('reports empty models and meshes', () => {
  assert.deepEqual(validateMesh({ meshes: [] }), { triangles: 0, issues: [{ mesh: -1, code: 'empty', count: 1 }] })
  assert.deepEqual(codes({ ...triangle(), indices: new Uint32Array() }), { empty: 1 })
})
