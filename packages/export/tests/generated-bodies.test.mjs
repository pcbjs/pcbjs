// A generated body is a mesh under a hash like a model file's: the model facet names it, the GLB places it by the body, and only a part without a model is a body box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { siteData } from '../dist/site-data.js'
import { boardGlb } from '../dist/board-glb.js'
import { modelHash } from '../dist/models.js'
import { fp } from './parts.mjs'

const EDGE = h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const CHIP = { kind: 'chip', part: 'R', body: [1.6, 0.8], cap: 0.3, height: 0.6 }
const part = (ref, x, extra) =>
  fp(
    { ref, value: '1k', id: 'pcbjs:T', at: `${x}mm 10mm`, bom: false, ...extra },
    h('pad', { num: 1, at: '-0.8 0', size: [0.9, 1] }),
    h('pad', { num: 2, at: '0.8 0', size: [0.9, 1] }),
  )
const site = (...parts) => {
  resetDefaults()
  const b = compileBoard(h(PCB, { name: 'Bodies' }, EDGE, ...parts))
  return siteData(b, { root: '/', dev: false, fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', bom: [] })
}
/** One red triangle, as a mesh the cli would give for every hash it is asked. */
const triangle = {
  meshes: [
    { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), color: [1, 0, 0] },
  ],
}
const glbJson = (s, asked = [], model = triangle) => {
  const g = boardGlb(s, { mesh: hash => (asked.push(hash), model), reference: () => null, raster: svgs => svgs.map(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47])) })
  const len = new DataView(g.buffer, g.byteOffset).getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(g.subarray(20, 20 + len)))
}

test('model facet: a generated body names its mesh hash, from its spec, its height and the board thickness; a part without a model names none', () => {
  const s = site(part('R1', 5, { height: 0.6, model: CHIP }), part('U1', 15, { height: 1 }))
  const r1 = s.footprints.find(f => f.ref === 'R1'),
    u1 = s.footprints.find(f => f.ref === 'U1')
  assert.equal(r1.mesh, modelHash(CHIP, { height: 0.6, thickness: s.thickness }))
  assert.match(r1.mesh, /^[0-9a-f]{64}$/)
  assert.equal(u1.mesh, undefined)
  assert.equal(modelHash({ ...CHIP, marking: '102' }, { height: 0.6, thickness: s.thickness }), r1.mesh, 'a printed marking is no geometry')
  assert.notEqual(modelHash({ ...CHIP, body: [2, 1.25] }, { height: 0.6, thickness: s.thickness }), r1.mesh)
})

test('glb: a generated body is its mesh placed on the body centre, and a board without a part lacking a model has no body material', () => {
  const s = site(part('R1', 5, { height: 0.6, model: CHIP }), part('R2', 15, { height: 0.6, model: CHIP, side: 'B' }))
  const asked = []
  const json = glbJson(s, asked)
  const r1 = s.footprints.find(f => f.ref === 'R1')
  assert.deepEqual([...new Set(asked)], [r1.mesh])
  assert.ok(!json.materials.some(m => m.name === 'body'), json.materials.map(m => m.name).join())
  const node = json.nodes.find(n => n.name === 'part:R1')
  assert.equal(json.meshes[node.mesh].name, `model:${r1.mesh.slice(0, 12)}`)
  // metres, y up: the body centre at board (5, 10) sits at x 0.005 and z 0.010
  assert.ok(Math.abs(node.matrix[12] - 0.005) < 1e-9 && Math.abs(node.matrix[14] - 0.01) < 1e-9, JSON.stringify(node.matrix))
  const back = json.nodes.find(n => n.name === 'part:R2')
  assert.equal(json.meshes[back.mesh].name, json.meshes[node.mesh].name)
  assert.ok(back.matrix[13] < 0, 'under the board')
})

test('glb: a part without a model is still its body box', () => {
  const json = glbJson(site(part('R1', 5, { height: 0.6, model: CHIP }), part('U1', 15, { height: 1 })))
  const u1 = json.nodes.find(n => n.name === 'part:U1')
  assert.equal(json.meshes[u1.mesh].name, 'body:U1')
  assert.ok(json.materials.some(m => m.name === 'body'))
})

test('glb: file and generated meshes retain distinct PBR materials even with identical RGB', () => {
  const model = {
    meshes: [
      { ...triangle.meshes[0], color: [0.8, 0.8, 0.8], material: { name: 'plastic', metalness: 0, roughness: 0.95 } },
      {
        ...triangle.meshes[0],
        color: [0.8, 0.8, 0.8],
        material: { name: 'metal', metalness: 1, roughness: 0.2, alphaMode: 'MASK', alphaCutoff: 0.4, opacity: 0.6, doubleSided: true, emissive: [0.1, 0.2, 0.3] },
      },
    ],
  }
  for (const source of ['file', 'generated']) {
    const s = site(part('R1', 5, { height: 0.6, model: CHIP }))
    if (source === 'file') s.footprints[0].step = { mesh: 'file-model', transform: { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] } }
    const json = glbJson(s, [], model)
    const node = json.nodes.find(n => n.name === 'part:R1')
    const materials = json.meshes[node.mesh].primitives.map(p => json.materials[p.material])
    assert.equal(materials.length, 2)
    assert.deepEqual(
      materials.map(m => m.pbrMetallicRoughness.metallicFactor),
      [0, 1],
      source,
    )
    assert.deepEqual(
      materials.map(m => m.pbrMetallicRoughness.roughnessFactor),
      [0.95, 0.2],
      source,
    )
    assert.equal(materials[1].alphaMode, 'MASK')
    assert.equal(materials[1].alphaCutoff, 0.4)
    assert.equal(materials[1].pbrMetallicRoughness.baseColorFactor[3], 0.6)
    assert.equal(materials[1].doubleSided, true)
    assert.deepEqual(materials[1].emissiveFactor, [0.1, 0.2, 0.3])
  }
})

test('glb: reference ghost styling retains sidedness and PBR without inheriting source alpha cutoff', () => {
  const s = site()
  s.references = [
    { name: 'module', entry: 'module.pcb.tsx', mesh: 'module', bodies: true, color: '#888', opacity: 0.35, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  ]
  const model = {
    meshes: [{ ...triangle.meshes[0], material: { metalness: 0.9, roughness: 0.2, doubleSided: true, emissive: [0.1, 0.2, 0.3], alphaMode: 'MASK', alphaCutoff: 0.8 } }],
  }
  const bytes = boardGlb(s, { mesh: () => null, reference: () => model, raster: svgs => svgs.map(() => new Uint8Array([0x89, 0x50, 0x4e, 0x47])) })
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)))
  const mat = json.materials.find(m => m.name === 'reference:module:0')
  assert.equal(mat.pbrMetallicRoughness.metallicFactor, 0.9)
  assert.equal(mat.pbrMetallicRoughness.roughnessFactor, 0.2)
  assert.equal(mat.pbrMetallicRoughness.baseColorFactor[3], 0.35)
  assert.equal(mat.doubleSided, true)
  assert.deepEqual(mat.emissiveFactor, [0.1, 0.2, 0.3])
  assert.equal(mat.alphaMode, 'BLEND')
  assert.equal(mat.alphaCutoff, undefined)
})
