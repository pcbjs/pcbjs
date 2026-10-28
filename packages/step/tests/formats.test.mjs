// The model formats besides STEP: detection by name and content, the glTF and GLB reader, the VRML 2 reader, against small
// boxes written by hand in tests/fixtures, and the dispatch of modelToMesh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { modelFormat, formatOfName, formatOfContent, modelToMesh, gltfToMesh, wrlToMesh, bounds, meshToBinary, meshFromBinary } from '../dist/index.js'

const fx = name => new URL(`./fixtures/${name}`, import.meta.url).pathname
const bytes = name => new Uint8Array(readFileSync(fx(name)))
const near = (a, b, tol, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${msg ?? ''} got ${a}, want ${b}`))

test('the format comes from the extension, any case, else from the first bytes', () => {
  for (const [n, f] of [
    ['a.step', 'step'],
    ['A.STP', 'step'],
    ['x.gltf', 'gltf'],
    ['x.GLB', 'glb'],
    ['R_0603.wrl', 'wrl'],
    ['https://h/x.stp?dl=1', 'step'],
  ])
    assert.equal(formatOfName(n), f, n)
  assert.equal(formatOfName('x.zip'), null)
  assert.equal(formatOfContent(bytes('pin.step')), 'step')
  assert.equal(formatOfContent(bytes('box.glb')), 'glb')
  assert.equal(formatOfContent(bytes('box.gltf')), 'gltf')
  assert.equal(formatOfContent(bytes('box.wrl')), 'wrl')
  assert.equal(formatOfContent(gzipSync(bytes('box.wrl'))), 'wrl')
  assert.equal(formatOfContent(new TextEncoder().encode('hello')), null)
  // the name wins over the content, the content answers for a name without an extension
  assert.equal(modelFormat('download', bytes('box.glb')), 'glb')
  assert.equal(modelFormat('x.wrl', bytes('box.glb')), 'wrl')
})

test('glTF: metres and y up become millimetres and z up, with the node transform and the base colour', () => {
  for (const name of ['box.gltf', 'box.glb']) {
    const m = gltfToMesh(bytes(name))
    assert.equal(m.meshes.length, 1, name)
    const b = bounds(m)
    // 4 mm along x, 2 mm along the file's z which is -y here, 1 mm tall standing on z 0
    near(b.min, [-2, -1, 0], 1e-4, name)
    near(b.max, [2, 1, 1], 1e-4, name)
    near(m.meshes[0].color, [0.2, 0.4, 0.6], 1e-6, name)
    assert.equal(m.meshes[0].indices.length, 36)
    // every normal points out of the box: the top faces up
    const { positions: p, normals: n } = m.meshes[0]
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2] - 1) < 1e-4 && Math.abs(n[i + 2]) > 0.9) assert.ok(n[i + 2] > 0, `${name} top normal ${n[i + 2]}`)
    for (let i = 0; i < p.length; i += 3) {
      const c = [p[i], p[i + 1], p[i + 2] - 0.5]
      assert.ok(c[0] * n[i] + c[1] * n[i + 1] + c[2] * n[i + 2] > 0, `${name} normal inward at ${c}`)
    }
  }
})

test('glTF: a buffer in a file beside it needs the path, and compressed meshes are refused with the reason', () => {
  const doc = JSON.parse(readFileSync(fx('box.gltf'), 'utf8'))
  const data = doc.buffers[0].uri
  doc.buffers[0].uri = 'box.bin'
  const external = new TextEncoder().encode(JSON.stringify(doc))
  assert.throws(() => gltfToMesh(external), /separate file/)
  const bin = Buffer.from(data.split(',')[1], 'base64')
  assert.equal(gltfToMesh(external, { readFile: uri => (assert.equal(uri, 'box.bin'), new Uint8Array(bin)) }).meshes.length, 1)
  const draco = new TextEncoder().encode(JSON.stringify({ ...doc, extensionsRequired: ['KHR_draco_mesh_compression'] }))
  assert.throws(() => gltfToMesh(draco), /KHR_draco_mesh_compression.*without mesh compression/)
})

test('VRML 2: KiCad tenths of an inch become millimetres, DEF and USE are followed, colours are linear', () => {
  const m = wrlToMesh(bytes('box.wrl'))
  assert.equal(m.meshes.length, 1, 'two shapes of one material merge')
  const b = bounds(m)
  near(b.min, [-2.54, -1.27, 1.27], 1e-4)
  near(b.max, [2.54, 1.27, 3.81], 1e-4)
  // six quads as twelve triangles, the bottom one from the shape that reuses the points
  assert.equal(m.meshes[0].indices.length, 36)
  const c = m.meshes[0].color
  assert.ok(c[0] < 0.8 && c[0] > c[1] && c[1] > c[2], `colour ${c}`)
  // a box keeps sharp edges: every normal is along one axis
  const n = m.meshes[0].normals
  for (let i = 0; i < n.length; i += 3) assert.ok(Math.max(Math.abs(n[i]), Math.abs(n[i + 1]), Math.abs(n[i + 2])) > 0.999, `normal ${n.slice(i, i + 3)}`)
  // gzipped, as a .wrz is
  assert.deepEqual(bounds(wrlToMesh(gzipSync(bytes('box.wrl')))), b)
  assert.throws(() => wrlToMesh(new TextEncoder().encode('#VRML V1.0 ascii\nSeparator {}')), /VRML 1 is not read/)
  assert.throws(() => wrlToMesh(new TextEncoder().encode('#VRML V2.0 utf8\nWorldInfo { title "x" }')), /no IndexedFaceSet/)
})

test('modelToMesh reads each format by path or by bytes, and its meshes round trip through the binary', async () => {
  for (const name of ['box.gltf', 'box.glb', 'box.wrl']) {
    const a = await modelToMesh(fx(name)),
      b = await modelToMesh(bytes(name))
    assert.deepEqual(bounds(a), bounds(b), name)
    assert.deepEqual(bounds(meshFromBinary(meshToBinary(a))), bounds(a))
  }
  assert.equal((await modelToMesh(fx('pin.step'))).meshes.length, 1)
  await assert.rejects(modelToMesh(new TextEncoder().encode('hello')), /cannot tell the format/)
  await assert.rejects(modelToMesh(new TextEncoder().encode('{"asset":{}, "meshes": 3'), { path: 'x.gltf' }), /cannot read GLTF x\.gltf/)
})
