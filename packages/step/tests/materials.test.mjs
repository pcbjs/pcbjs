import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gltfToMesh, meshToBinary, meshFromBinary, normalizeMaterial, CONVERTER_VERSION } from '../dist/index.js'

const encode = value => new TextEncoder().encode(JSON.stringify(value))
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

function triangle() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1])
  const normals = new Float32Array([0, -Math.SQRT1_2, Math.SQRT1_2, 0, -Math.SQRT1_2, Math.SQRT1_2, 0, -Math.SQRT1_2, Math.SQRT1_2])
  return { positions, normals, indices: new Uint32Array([0, 1, 2]), color: [0.5, 0.5, 0.5] }
}

function document() {
  const { positions, normals } = triangle()
  const bytes = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer)])
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
    ],
    accessors: [0, 1].map(bufferView => ({ bufferView, componentType: 5126, type: 'VEC3', count: 3 })),
  }
}

function alignment(mesh) {
  const [a, b, c] = Array.from(mesh.indices.slice(0, 3), i => Array.from(mesh.positions.slice(i * 3, i * 3 + 3)))
  const u = b.map((v, i) => v - a[i]),
    v = c.map((v, i) => v - a[i])
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const n = mesh.normals.slice(mesh.indices[0] * 3, mesh.indices[0] * 3 + 3)
  return cross.reduce((sum, x, i) => sum + x * n[i], 0) / Math.hypot(...cross)
}

test('glTF retains scalar materials and keeps equal colours with different surfaces separate', () => {
  const doc = document()
  doc.materials = [
    {
      name: 'plastic',
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 0.6], metallicFactor: 0, roughnessFactor: 0.8 },
      alphaMode: 'BLEND',
      doubleSided: true,
      emissiveFactor: [0.1, 0.2, 0.3],
    },
    { name: 'metal', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 1], metallicFactor: 0.9, roughnessFactor: 0.2 }, alphaMode: 'MASK', alphaCutoff: 0.25 },
  ]
  const primitive = doc.meshes[0].primitives[0]
  doc.meshes[0].primitives = [0, 1, 0].map(material => ({ ...primitive, material }))
  const { meshes } = gltfToMesh(encode(doc))
  assert.equal(meshes.length, 2)
  assert.equal(meshes[0].indices.length, 6, 'same material merges')
  assert.deepEqual(meshes[0].material, {
    metalness: 0,
    roughness: 0.8,
    opacity: 0.6,
    alphaCutoff: 0.5,
    alphaMode: 'BLEND',
    doubleSided: true,
    emissive: [0.1, 0.2, 0.3],
    name: 'plastic',
  })
  assert.equal(meshes[1].material.alphaCutoff, 0.25)
  assert.equal(meshes[1].material.metalness, 0.9)
  assert.deepEqual(
    meshes.map(m => m.color),
    [
      [0.2, 0.3, 0.4],
      [0.2, 0.3, 0.4],
    ],
  )
})

test('glTF defaults are white and metallic, distinct from legacy colour-only surfaces', () => {
  const m = gltfToMesh(encode(document())).meshes[0]
  assert.deepEqual(m.color, [1, 1, 1])
  assert.deepEqual(m.material, { metalness: 1, roughness: 1, opacity: 1, alphaCutoff: 0.5, alphaMode: 'OPAQUE', doubleSided: false, emissive: [0, 0, 0] })
})

test('glTF rejects invalid material factors rather than producing invalid shaders', () => {
  for (const material of [
    { pbrMetallicRoughness: { metallicFactor: 2 } },
    { pbrMetallicRoughness: { roughnessFactor: -1 } },
    { pbrMetallicRoughness: { baseColorFactor: [0, 0, 0] } },
    { emissiveFactor: [0, null, 0] },
    { emissiveFactor: [0, 1.1, 0] },
    { doubleSided: 'yes' },
    { alphaMode: 'UNKNOWN' },
  ]) {
    const doc = document()
    doc.materials = [material]
    doc.meshes[0].primitives[0].material = 0
    assert.throws(() => gltfToMesh(encode(doc)), /material/)
  }
})

test('glTF normals stay perpendicular under nonuniform scale, shear and reflected nodes', () => {
  for (const transform of [
    { scale: [1, 2, 3] },
    { scale: [-1, 2, 3] },
    { rotation: [0, 0, Math.sin(0.3), Math.cos(0.3)], scale: [2, 3, 4] },
    { matrix: [1, 0.5, 0.2, 0, 0.3, 2, 0.1, 0, 0.7, 0.2, 3, 0, 0, 0, 0, 1] },
  ]) {
    const doc = document()
    Object.assign(doc.nodes[0], transform)
    const mesh = gltfToMesh(encode(doc)).meshes[0]
    near(alignment(mesh), 1)
  }
})

test('glTF does not silently repair winding baked into vertex data', () => {
  const doc = document()
  const bytes = Buffer.from(doc.buffers[0].uri.split(',')[1], 'base64')
  for (let i = 0; i < 3; i++) bytes.writeFloatLE(-bytes.readFloatLE(i * 12), i * 12)
  doc.buffers[0].uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`
  near(alignment(gltfToMesh(encode(doc)).meshes[0]), -1)
})

test('PCBM v2 preserves material identity and legacy surfaces in a mixed model', () => {
  const material = { name: 'lens 🟢', opacity: 0.25, alphaMode: 'BLEND', roughness: 0.12, metalness: 0, doubleSided: true, emissive: [0, 0.2, 0], alphaCutoff: 0.4 }
  const bin = meshToBinary({ meshes: [triangle(), { ...triangle(), material }, { ...triangle(), material: {} }] })
  assert.equal(new DataView(bin.buffer).getUint16(4, true), 2)
  const back = meshFromBinary(bin)
  assert.equal(back.meshes[0].material, undefined)
  assert.deepEqual(back.meshes[1].material, material)
  assert.deepEqual(back.meshes[2].material, {})
  for (const m of back.meshes) assert.deepEqual(m.positions, triangle().positions)
  assert.equal(CONVERTER_VERSION, 2)
})

test('PCBM v1 remains readable without inventing material metadata', () => {
  const v2 = meshToBinary({ meshes: [triangle()] })
  const v1 = new Uint8Array(v2.length - 4)
  v1.set(v2.subarray(0, 36))
  v1.set(v2.subarray(40), 36)
  new DataView(v1.buffer).setUint16(4, 1, true)
  const m = meshFromBinary(v1).meshes[0]
  assert.deepEqual(m.positions, triangle().positions)
  assert.deepEqual(m.indices, triangle().indices)
  assert.equal(m.material, undefined)
})

test('PCBM rejects truncated and malformed material metadata', () => {
  const bytes = meshToBinary({ meshes: [{ ...triangle(), material: { roughness: 0.5 } }] })
  assert.throws(() => meshFromBinary(bytes.subarray(0, 41)), /truncated/)
  const broken = bytes.slice()
  broken[40] = 0xff
  assert.throws(() => meshFromBinary(broken), /invalid material/)
  const huge = bytes.slice()
  new DataView(huge.buffer).setUint32(36, 0xffffffff, true)
  assert.throws(() => meshFromBinary(huge), /truncated/)
  assert.throws(() => meshToBinary({ meshes: [{ ...triangle(), material: { opacity: NaN } }] }), /opacity/)
})

test('material serialization is canonical and rejects sparse emissive values', () => {
  const a = { ...triangle(), material: { roughness: 0.5, metalness: 0.2 } }
  const b = { ...triangle(), material: { metalness: 0.2, roughness: 0.5 } }
  assert.deepEqual(meshToBinary({ meshes: [a] }), meshToBinary({ meshes: [b] }))
  assert.throws(() => normalizeMaterial({ emissive: new Array(3) }), /emissive/)
  assert.throws(() => normalizeMaterial({ emissive: [2, 0, 0] }), /emissive/)
})
