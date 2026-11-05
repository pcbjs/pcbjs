// A generated body is meshes from its spec in Node, the live view draws those same meshes, and a reference places them by hash as the GLB does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { modelMeshes, generatedModel } = await import('../src/models/index.ts')
const { referenceMesh, referenceGroup } = await import('../src/scene/reference.ts')
const { bounds } = await import('@pcbjs/step/internal/mesh')
const { meshToBinary } = await import('@pcbjs/step/binary')
const { DoubleSide } = await import('three')
const { stepMaterial } = await import('../src/models/materials.ts')

const CHIP = { kind: 'chip', part: 'R', body: [1.6, 0.8], cap: 0.3, height: 0.6 }
const CTX = { height: 0.6, thickness: 1.6 }
const near = (a, b, tol = 0.05) => a.every((v, i) => Math.abs(v - b[i]) < tol)

test('modelMeshes: a chip is its spec body, length by width by height, in Node; one mesh per colour', () => {
  const m = modelMeshes(CHIP, CTX)
  const b = bounds(m)
  assert.ok(near(b.min, [-0.8, -0.415, 0]) && near(b.max, [0.8, 0.415, 0.6]), JSON.stringify(b))
  const colors = m.meshes.map(q => q.color.map(c => c.toFixed(3)).join())
  assert.equal(new Set(colors).size, colors.length)
  assert.equal(modelMeshes(CHIP, CTX), m, 'made once per spec and context')
  const big = bounds(modelMeshes({ ...CHIP, body: [3.2, 1.6], cap: 0.5, height: 0.7 }, { ...CTX, height: 0.7 }))
  assert.ok(near(big.max, [1.6, 0.815, 0.7]), JSON.stringify(big))
})

test('modelMeshes: a header reaches through the board by its thickness, a PLCC LED is its body square', () => {
  const header = bounds(modelMeshes({ kind: 'header', pins: 3, rows: 1, pitch: 2.54 }, { height: 8.5, thickness: 1.6 }))
  assert.ok(header.min[2] < -1.6 && header.max[2] > 8, JSON.stringify(header))
  const plcc = bounds(modelMeshes({ kind: 'led', body: [5, 5], height: 1.6, window: 4.2, lead: [0.6, 1] }, { height: 1.6, thickness: 1.6 }))
  assert.ok(near(plcc.min, [-2.5, -2.5, 0]) && near(plcc.max, [2.5, 2.5, 1.6]), JSON.stringify(plcc))
})

test('generatedModel: the live view draws the meshes of modelMeshes, in the materials the body was built with', () => {
  const g = generatedModel(CHIP, CTX, '')
  const drawn = g.children.map(m => [...m.geometry.getAttribute('position').array].join())
  assert.deepEqual(
    drawn,
    modelMeshes(CHIP, CTX).meshes.map(q => [...q.positions].join()),
  )
  const metal = g.children.find(m => m.material.metalness > 0.8)
  assert.ok(metal, 'the tin caps keep their metal')
})

test('referenceMesh: a generated body is the mesh of its hash placed on the body; a part with no mesh draws nothing', () => {
  const site = {
    outline: [],
    drills: [],
    items: [],
    copper: 2,
    thickness: 1.6,
    footprints: [
      { ref: 'R1', side: 'F', body: { x: 10, y: 5, w: 1.6, h: 0.8, rot: 0 }, height: 0.6, model: CHIP, mesh: 'r1' },
      { ref: 'U1', side: 'F', body: { x: 20, y: 5, w: 4, h: 4, rot: 0 }, height: 1 },
    ],
  }
  const asked = []
  const out = referenceMesh(site, hash => (asked.push(hash), hash === 'r1' ? modelMeshes(CHIP, CTX) : null))
  assert.deepEqual(asked, ['r1'])
  assert.equal(out.board, 0)
  const b = bounds({ meshes: out.meshes })
  // x board x, y board -y, z up from the bottom face: the body centre at (10, -5) on the top copper at 1.635
  assert.ok(near(b.min, [9.2, -5.415, 1.635]) && near(b.max, [10.8, -4.585, 2.235]), JSON.stringify(b))
  assert.deepEqual(
    out.meshes.map(m => m.material),
    modelMeshes(CHIP, CTX).meshes.map(m => m.material),
  )
})

test('referenceGroup retains surface PBR and sidedness beneath reference tint/opacity', async t => {
  const model = modelMeshes(CHIP, CTX)
  const bytes = meshToBinary({
    meshes: [{ ...model.meshes[0], material: { metalness: 0.9, roughness: 0.2, emissive: [0.1, 0.2, 0.3], doubleSided: true, alphaMode: 'MASK', alphaCutoff: 0.8 } }],
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  const ref = { name: 'custom', bodies: true, color: '#888', opacity: 0.35, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
  const group = await referenceGroup(ref, 'test:material-reference')
  const mat = group.children[0].material
  assert.equal(mat.metalness, 0.9)
  assert.equal(mat.roughness, 0.2)
  assert.equal(mat.side, DoubleSide)
  assert.deepEqual(mat.emissive.toArray(), [0.1, 0.2, 0.3])
  assert.equal(mat.opacity, 0.35)
  assert.equal(mat.alphaTest, 0, 'reference opacity does not trigger the source mask cutoff')
})

test('file materials honor explicit PBR, alpha mode and sidedness instead of colour guesses', () => {
  const color = [0.8, 0.8, 0.8]
  const opaque = stepMaterial(color, { metalness: 0, roughness: 0.95, opacity: 0.2, alphaMode: 'OPAQUE' })
  assert.equal(opaque.metalness, 0)
  assert.equal(opaque.roughness, 0.95)
  assert.equal(opaque.opacity, 1)
  assert.equal(opaque.transparent, false)
  const blend = stepMaterial(color, { metalness: 0.8, roughness: 0.2, opacity: 0.3, alphaMode: 'BLEND', doubleSided: true })
  assert.notEqual(opaque, blend)
  assert.equal(blend.opacity, 0.3)
  assert.equal(blend.transparent, true)
  assert.equal(blend.side, DoubleSide)
  assert.equal(stepMaterial(color).metalness, 0.7, 'legacy colour-only material keeps its heuristic')
})
