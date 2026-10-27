// STEP conversion and the binary round trip, against a pin 2 mm across and 5 mm tall written by hand in tests/fixtures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stepToMesh, meshToBinary, meshFromBinary, meshKey, bounds, DEFAULT_OPTIONS } from '../dist/index.js'

const PIN = new URL('./fixtures/pin.step', import.meta.url)

test('a STEP pin converts to millimetres with its colour, normals and indices', async () => {
  const model = await stepToMesh(PIN.pathname)
  assert.equal(model.meshes.length, 1)
  const m = model.meshes[0]
  assert.equal(m.positions.length % 3, 0)
  assert.equal(m.normals.length, m.positions.length)
  assert.equal(m.indices.length % 3, 0)
  for (const i of m.indices) assert.ok(i < m.positions.length / 3)
  const b = bounds(model)
  for (const [k, want] of [[0, -1], [1, -1], [2, 0]]) assert.ok(Math.abs(b.min[k] - want) < 0.02, `min ${k} ${b.min[k]}`)
  for (const [k, want] of [[0, 1], [1, 1], [2, 5]]) assert.ok(Math.abs(b.max[k] - want) < 0.02, `max ${k} ${b.max[k]}`)
  // COLOUR_RGB 0.8 0.6 0.2 in the file, linear in the mesh
  assert.ok(m.color[0] > m.color[1] && m.color[1] > m.color[2] && m.color[0] < 0.8, `colour ${m.color}`)
})

test('the default deflection keeps a 2 mm pin round', async () => {
  const m = (await stepToMesh(new Uint8Array(readFileSync(PIN)))).meshes[0]
  const angles = new Set()
  for (let i = 0; i < m.positions.length; i += 3) {
    const [x, y, z] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]
    if (Math.abs(z) < 1e-6) { assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-4 || Math.hypot(x, y) < 1); if (Math.hypot(x, y) > 0.999) angles.add(Math.round(Math.atan2(y, x) * 1000)) }
  }
  assert.ok(angles.size >= 16, `${angles.size} sides`)
  // the largest gap between neighbouring rim points stays below 0.4 mm on a 1 mm radius
  const a = [...angles].map(v => v / 1000).sort((p, q) => p - q)
  const gap = Math.max(...a.map((v, i) => (i ? v - a[i - 1] : v + 2 * Math.PI - a[a.length - 1])))
  assert.ok(2 * Math.sin(gap / 2) < 0.4, `chord ${2 * Math.sin(gap / 2)}`)
  assert.equal(DEFAULT_OPTIONS.linearDeflection, 0.02)
})

test('the binary round trip keeps positions and indices exactly and normals to a byte', async () => {
  const model = await stepToMesh(PIN.pathname)
  const bin = meshToBinary(model)
  const back = meshFromBinary(bin)
  assert.equal(back.meshes.length, model.meshes.length)
  const [a, b] = [model.meshes[0], back.meshes[0]]
  assert.deepEqual([...b.positions], [...a.positions])
  assert.deepEqual([...b.indices], [...a.indices])
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(b.color[i] - a.color[i]) < 1e-6)
  for (let i = 0; i < a.normals.length; i++) assert.ok(Math.abs(b.normals[i] - a.normals[i]) < 0.02)
  // smaller than three float arrays of the same mesh
  assert.ok(bin.byteLength < a.positions.byteLength + a.normals.byteLength + a.indices.byteLength)
  // a Node Buffer at an odd offset decodes too
  const shifted = Buffer.alloc(bin.byteLength + 1); shifted.set(bin, 1)
  assert.deepEqual([...meshFromBinary(shifted.subarray(1)).meshes[0].indices], [...a.indices])
})

test('a mesh with more than 65535 vertices keeps 32-bit indices', () => {
  const n = 70000
  const positions = new Float32Array(n * 3).map((_, i) => i * 0.001), normals = new Float32Array(n * 3).fill(0)
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1
  const indices = new Uint32Array([0, 1, n - 1])
  const back = meshFromBinary(meshToBinary({ meshes: [{ positions, normals, indices, color: [1, 0, 0] }] }))
  assert.deepEqual([...back.meshes[0].indices], [0, 1, n - 1])
  assert.equal(back.meshes[0].normals[2], 1)
})

test('meshFromBinary rejects other data', () => {
  assert.throws(() => meshFromBinary(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), /not a pcbjs mesh/)
  const bin = meshToBinary({ meshes: [{ positions: new Float32Array(9), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), color: [0, 0, 0] }] })
  assert.throws(() => meshFromBinary(bin.subarray(0, bin.byteLength - 8)), /truncated/)
})

test('the key changes with the content and the options, not with anything else', () => {
  const a = new TextEncoder().encode('ISO-10303-21; a'), b = new TextEncoder().encode('ISO-10303-21; b')
  assert.match(meshKey(a), /^[0-9a-f]{64}$/)
  assert.equal(meshKey(a), meshKey(a, {}))
  assert.equal(meshKey(a), meshKey(a, { linearDeflection: 0.02 }))
  assert.notEqual(meshKey(a), meshKey(b))
  assert.notEqual(meshKey(a), meshKey(a, { linearDeflection: 0.05 }))
})

test('a file OpenCascade cannot read throws', async () => {
  await assert.rejects(stepToMesh(new TextEncoder().encode('not a step file')), /cannot read STEP/)
})
