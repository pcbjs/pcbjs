import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeModel, generatedModel, modelMeshes } from '@pcbjs/ui/models'
import { modelGlb } from '@pcbjs/export'
import { gltfToMesh, bounds } from '@pcbjs/step'

const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `${a} != ${b}`))
const parts = [
  { shape: 'box', size: [10, 8, 1], radius: 0.15, material: 'mould' },
  { shape: 'box', size: [8, 6, 0.3], radius: 0.1, translation: [0, 0, 1], material: 'tin' },
  ...[-1, 1].map(x => ({ shape: 'box', size: [0.5, 2, 0.2], translation: [x * 5, 0, 0], material: 'gold' })),
]

function consistent(model) {
  for (const m of model.meshes)
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = Array.from(m.indices.slice(i, i + 3)).map(v => Array.from(m.positions.slice(v * 3, v * 3 + 3)))
      const u = b.map((v, k) => v - a[k]),
        v = c.map((v, k) => v - a[k])
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const normal = m.normals.slice(m.indices[i] * 3, m.indices[i] * 3 + 3)
      assert.ok(n.reduce((s, x, k) => s + x * normal[k], 0) >= -1e-8, 'winding agrees with outward normals')
    }
}

test('public authoring composes a package and writes a deterministic, material-preserving GLB', () => {
  const model = composeModel(parts)
  const bytes = modelGlb(model, 'custom-package')
  assert.deepEqual(bytes, modelGlb(composeModel(parts), 'custom-package'))
  const imported = gltfToMesh(bytes)
  close(bounds(imported).min, [-5.25, -4, 0])
  close(bounds(imported).max, [5.25, 4, 1.3])
  assert.equal(imported.meshes.length, 3)
  assert.deepEqual(
    imported.meshes.map(m => m.material.metalness),
    [0, 0.9, 1],
  )
  assert.deepEqual(
    imported.meshes.map(m => m.material.roughness),
    [0.45, 0.28, 0.25],
  )
  consistent(imported)
})

test('primitives apply normalized quaternion rotation before translation without changing handedness', () => {
  const q = [Math.SQRT1_2 * 5, 0, 0, Math.SQRT1_2 * 5]
  const model = composeModel([{ shape: 'box', size: [2, 4, 6], orientation: q, translation: [10, 20, 30] }])
  close(bounds(model).min, [9, 14, 28])
  close(bounds(model).max, [11, 20, 32])
  consistent(model)
  consistent(
    composeModel([
      { shape: 'sphere', radius: 2 },
      { shape: 'cylinder', radius: 1, height: 3, translation: [5, 0, 0] },
    ]),
  )
})

test('same-colour parts retain distinct material properties through composition and GLB import', () => {
  const model = composeModel([
    { shape: 'box', size: [1, 1, 1], material: { color: '#888', metalness: 0, roughness: 0.9 } },
    {
      shape: 'box',
      size: [1, 1, 1],
      translation: [2, 0, 0],
      material: { color: '#888', metalness: 1, roughness: 0.1, doubleSided: true, alphaMode: 'MASK', opacity: 0.7, alphaCutoff: 0.4 },
    },
  ])
  const imported = gltfToMesh(modelGlb(model))
  assert.equal(imported.meshes.length, 2)
  assert.deepEqual(imported.meshes[0].color, imported.meshes[1].color)
  assert.equal(imported.meshes[1].material.alphaMode, 'MASK')
  assert.equal(imported.meshes[1].material.alphaCutoff, 0.4)
  assert.equal(imported.meshes[1].material.doubleSided, true)
  assert.equal(imported.meshes[1].material.opacity, 0.7)
  const zeroCutoff = composeModel([{ shape: 'box', size: [1, 1, 1], material: { color: '#888', alphaMode: 'MASK', alphaCutoff: 0 } }])
  assert.equal(gltfToMesh(modelGlb(zeroCutoff)).meshes[0].material.alphaMode, 'MASK')
  assert.equal(gltfToMesh(modelGlb(zeroCutoff)).meshes[0].material.alphaCutoff, 0)
})

test('generated descriptors reuse stdlib geometry and explicit materials in assemblies and live view', () => {
  const spec = { kind: 'chip', part: 'C', body: [1.6, 0.8], cap: 0.3, height: 0.8 }
  const context = { height: 0.8, thickness: 1.6 }
  const composed = composeModel([{ shape: 'generated', spec, context }])
  const original = modelMeshes(spec, context)
  assert.deepEqual(
    composed.meshes.map(m => m.material),
    original.meshes.map(m => m.material),
  )
  const live = generatedModel(spec, context, '')
  assert.deepEqual(
    live.children.map(m => [m.material.metalness, m.material.roughness]),
    original.meshes.map(m => [m.material.metalness, m.material.roughness]),
  )
})

test('invalid dimensions, subdivision and orientation fail before producing assets', () => {
  for (const size of [
    [0, 1, 1],
    [-1, 1, 1],
    [1, NaN, 1],
    [1, Infinity, 1],
  ])
    assert.throws(() => composeModel([{ shape: 'box', size }]), /finite/)
  for (const orientation of [[0, 0, 0, 0], [NaN, 0, 0, 1], [0, 0, 1], new Array(4)])
    assert.throws(() => composeModel([{ shape: 'box', size: [1, 1, 1], orientation }]), /orientation/)
  assert.throws(() => composeModel([{ shape: 'sphere', radius: 1, segments: 2 }]), /segments/)
  assert.throws(() => composeModel([{ shape: 'box', size: [1, 1, 1], material: { color: '#888', metalness: 2 } }]), /metalness/)
  assert.throws(() => composeModel([{ shape: 'generated', spec: { kind: 'ic', w: -1, h: 1, height: 1 }, context: { height: 1, thickness: 1.6 } }]), /positive finite/)
  assert.throws(() => composeModel([{ shape: 'generated', spec: { kind: 'sot23', pins: 4 }, context: { height: 1, thickness: 1.6 } }]), /SOT-23 pins/)
  const model = composeModel(parts)
  model.meshes[0].material.emissive = [2, 0, 0]
  assert.throws(() => modelGlb(model), /emissive/)
})
