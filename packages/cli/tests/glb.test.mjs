// The per-compile GLB of Blinky read back: the nodes, their extras and stack order, the selection accessors against the board data by uid, and a render through @pcbjs/renderer when its checkout sits beside this one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveConfig } from '../dist/project/config.js'
import { pluginState } from '../dist/server/site.js'
import { compileServer } from '../dist/project/compile.js'
import { viteLoader } from '../dist/project/loader.js'
import { compileEntry } from '../dist/project/project.js'
import { shapeOf } from '@pcbjs/core/site-shapes'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')

/** The JSON and binary chunks of a GLB. */
function parseGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(dv.getUint32(0, true), 0x46546c67, 'magic')
  assert.equal(dv.getUint32(4, true), 2, 'version')
  assert.equal(dv.getUint32(8, true), bytes.byteLength, 'length')
  const jsonLen = dv.getUint32(12, true)
  assert.equal(dv.getUint32(16, true), 0x4e4f534a)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
  const at = 20 + jsonLen
  assert.equal(dv.getUint32(at + 4, true), 0x004e4942)
  const bin = bytes.subarray(at + 8, at + 8 + dv.getUint32(at, true))
  return { json, bin }
}

/** An accessor's floats; VEC3 only. */
function floats({ json, bin }, index) {
  const a = json.accessors[index]
  const v = json.bufferViews[a.bufferView]
  assert.equal(a.componentType, 5126)
  assert.equal(a.type, 'VEC3')
  return new Float32Array(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + a.count * 12))
}

/** The renderer's dist from a pcbjs-renderer checkout beside an ancestor of this file, or PCBJS_RENDERER; null when there is none. */
function rendererDist() {
  if (process.env.PCBJS_RENDERER) return join(process.env.PCBJS_RENDERER, 'dist', 'index.mjs')
  for (let d = HERE; d !== dirname(d); d = dirname(d)) {
    const f = join(d, 'pcbjs-renderer', 'dist', 'index.mjs')
    if (existsSync(f)) return f
  }
  return null
}

let compiled
async function blinky() {
  if (compiled) return compiled
  const dir = join(REPO, 'examples', 'demo')
  const cfg = await resolveConfig(['blinky.pcb.tsx'], 'build', undefined, dir, () => {})
  const server = await compileServer(cfg)
  try {
    ;[compiled] = await compileEntry(viteLoader(server), cfg, cfg.entries[0], { draft: true })
  } finally {
    await server.close()
  }
  return compiled
}

test('glb: the board, the stack groups in the viewer order with explode vectors in metres, a part node per footprint, the schematic SVG beside it', async () => {
  const c = await blinky()
  assert.ok(c.glb instanceof Uint8Array && c.glb.length > 1000)
  assert.match(c.sch, /^<\?xml|^<svg/)
  const { json } = parseGlb(c.glb)
  const nodes = json.nodes
  const roots = json.scenes[0].nodes.map(i => nodes[i])
  const stack = ['bodies:B', 'B.SilkS', 'B.Mask', 'copper:B.Cu', 'copper:F.Cu', 'F.Mask', 'F.SilkS', 'bodies:F']
  assert.deepEqual(
    roots.map(n => n.name),
    ['board', ...stack, 'barrels'],
  )
  for (const n of nodes) {
    assert.ok(n.extras?.pcbjs?.kind, `${n.name} has a kind`)
    assert.equal(n.extras.pcbjs.explode.length, 3)
  }
  const board = roots[0]
  assert.deepEqual(
    board.children.map(i => nodes[i].name),
    ['diel:0'],
  )
  // one step of 4 mm per group from the middle of the copper, along y
  const y = name => (name === 'diel:0' ? nodes[board.children[0]] : roots.find(n => n.name === name)).extras.pcbjs.explode
  assert.deepEqual(y('copper:F.Cu'), [0, 0.004, 0])
  assert.deepEqual(y('copper:B.Cu'), [0, -0.004, 0])
  assert.deepEqual(y('diel:0'), [0, 0, 0])
  assert.deepEqual(y('bodies:F'), [0, 0.016, 0])
  const ys = stack.map(n => y(n)[1])
  assert.deepEqual(
    ys,
    [...ys].sort((a, b) => a - b),
  )
  const parts = [...roots.find(n => n.name === 'bodies:F').children, ...roots.find(n => n.name === 'bodies:B').children].map(i => nodes[i])
  assert.deepEqual(parts.map(n => n.name).sort(), c.site.footprints.map(f => `part:${f.ref}`).sort())
  for (const p of parts) assert.equal(p.extras.pcbjs.ref, p.name.slice(5))
  const fcu = roots.find(n => n.name === 'copper:F.Cu')
  assert.ok(fcu.children.map(i => nodes[i].name).includes('net:GND'), 'a mesh per net')
  for (const i of fcu.children) assert.equal(nodes[i].extras.pcbjs.layer, 'F.Cu')
  // the face raster: mipmapped and at most 4096 square
  assert.equal(json.samplers[0].minFilter, 9987)
  assert.equal(json.images.length, 2)
})

test('glb: every part is its generated mesh, an LED with an opaque lens in its colour, no body box, and only the mask blends', async () => {
  const { json } = parseGlb((await blinky()).glb)
  assert.ok(!json.materials.some(m => m.name === 'body'), 'Blinky has no part without a model')
  for (const ref of ['J1', 'Q1', 'R1', 'C1']) assert.match(json.meshes[json.nodes.find(n => n.name === `part:${ref}`).mesh].name, /^model:[0-9a-f]{12}$/, ref)
  for (const ref of ['D1', 'D2', 'D3']) {
    const mesh = json.meshes[json.nodes.find(n => n.name === `part:${ref}`).mesh]
    const clear = [239, 235, 217].map(c => ((c / 255 + 0.055) / 1.055) ** 2.4)
    const lenses = mesh.primitives.map(p => json.materials[p.material]).filter(m => clear.every((c, i) => Math.abs(m.pbrMetallicRoughness.baseColorFactor[i] - c) < 1e-6))
    assert.equal(lenses.length, 1, 'no color option: one clear #efebd9 lens')
    const [mat] = lenses
    assert.equal(mat.pbrMetallicRoughness.baseColorFactor[3], 1)
    assert.equal(mat.alphaMode ?? 'OPAQUE', 'OPAQUE')
    assert.equal(mat.pbrMetallicRoughness.roughnessFactor, 0.25)
    assert.equal(mat.pbrMetallicRoughness.metallicFactor, 0)
    assert.ok(
      mat.emissiveFactor.every((v, i) => Math.abs(v - clear[i] * 0.06) < 1e-6),
      'the clear lens keeps its mild glow',
    )
  }
  const blended = json.materials.filter(m => m.alphaMode === 'BLEND').map(m => m.name)
  assert.deepEqual(blended.sort(), ['mask', 'mask:copper'])
})

test('glb: the selection accessors of each copper layer decode to the items of the board data by uid, inside their copper', async () => {
  const c = await blinky()
  const g = parseGlb(c.glb)
  const t = c.site.thickness
  for (const layer of ['F.Cu', 'B.Cu']) {
    const node = g.json.nodes.find(n => n.name === `copper:${layer}`)
    const items = node.extras.pcbjs.items
    const want = c.site.items.filter(it => it.layers.includes(layer))
    assert.deepEqual(items.map(i => i.uid).sort(), want.map(it => it.uid).sort(), layer)
    const byUid = new Map(want.map(it => [it.uid, it]))
    for (const s of items) {
      const it = byUid.get(s.uid)
      assert.equal(s.kind, it.kind)
      assert.equal(s.net, it.net)
      assert.ok(!g.json.nodes.some(n => n.mesh !== undefined && g.json.meshes[n.mesh].primitives.some(p => p.attributes.POSITION === s.accessor)), 'never a visible node')
      const p = floats(g, s.accessor)
      assert.ok(p.length >= 9 && p.length % 9 === 0)
      const xs = shapeOf(c.site, it.id)
          .flat()
          .map(q => q[0]),
        zs = shapeOf(c.site, it.id)
          .flat()
          .map(q => q[1])
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity
      for (let i = 0; i < p.length; i += 3) {
        x0 = Math.min(x0, p[i])
        x1 = Math.max(x1, p[i])
        y0 = Math.min(y0, p[i + 1])
        y1 = Math.max(y1, p[i + 1])
        z0 = Math.min(z0, p[i + 2])
        z1 = Math.max(z1, p[i + 2])
      }
      const near = (a, b) => Math.abs(a - b) < 1e-6
      assert.ok(near(x0, Math.min(...xs) / 1000) && near(x1, Math.max(...xs) / 1000), `${s.uid} x`)
      // board y runs down the page and becomes +z, toward the viewer of the top
      assert.ok(near(z0, Math.min(...zs) / 1000) && near(z1, Math.max(...zs) / 1000), `${s.uid} z`)
      // the lid away from the board: the top of front copper, the underside of back copper
      assert.ok(near(y0, y1) && (layer === 'F.Cu' ? y0 > t / 1000 : y0 < 0), `${s.uid} on its outer face`)
    }
  }
})

const dist = rendererDist()
test(
  'glb: @pcbjs/renderer draws Blinky at 640 by 480, a fit on part:Q1 frames its pads, and an item stays selectable inside merged copper',
  { skip: dist ? false : 'no pcbjs-renderer checkout with a dist beside this repository' },
  async () => {
    const { createRenderer, encodePng } = await import(pathToFileURL(dist).href)
    const c = await blinky()
    const g = parseGlb(c.glb)
    const fcu = g.json.nodes.find(n => n.name === 'copper:F.Cu')
    const pad = fcu.extras.pcbjs.items.find(i => i.kind === 'pad' && i.net === 'GND')
    const positions = floats(g, pad.accessor)
    const selection = { id: pad.uid, positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) }
    const r = await createRenderer(c.glb, { selectionGeometry: [selection] })
    try {
      assert.deepEqual(r.info.diagnostics, [])
      const img = await r.render({ width: 640, height: 480, camera: { type: 'fit', direction: [0.55, 0.9, 0.95] }, supersample: 1 })
      assert.equal(img.rgba.length, 640 * 480 * 4)
      const bg = [img.rgba[0], img.rgba[1], img.rgba[2]]
      let drawn = 0
      for (let i = 0; i < img.rgba.length; i += 4) if (Math.abs(img.rgba[i] - bg[0]) + Math.abs(img.rgba[i + 1] - bg[1]) + Math.abs(img.rgba[i + 2] - bg[2]) > 24) drawn++
      assert.ok(drawn > 640 * 480 * 0.1, `the board covers ${drawn} pixels`)
      const png = await encodePng(img.rgba, img.width, img.height)
      assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

      const frame = r.prepare({ width: 640, height: 480, camera: { type: 'fit', nodes: ['part:Q1'], direction: [0.55, 0.9, 0.95] } })
      const q1 = c.site.footprints.find(f => f.ref === 'Q1')
      const top = (t => t + 0.035)(c.site.thickness)
      const pts = r.project(
        frame,
        q1.pads.map(p => [p.at[0] / 1000, top / 1000, p.at[1] / 1000]),
      )
      for (const p of pts) assert.ok(!p.clipped && p.x > 0 && p.x < 640 && p.y > 0 && p.y < 480, `pad at ${p.x}, ${p.y} inside the frame`)
      const box = r.bounds({ selections: [pad.uid] })
      assert.ok(box && box.max[0] > box.min[0], 'the GND pad has its own bounds inside the merged GND copper')
    } finally {
      r.dispose()
    }
  },
)

test('glb: a board stacked under the controller explodes with the parts of the back side, the mate gap kept, its side in the extras', { timeout: 240000 }, async () => {
  const dir = join(REPO, 'examples', 'motor-stack', 'controller')
  const cfg = await resolveConfig([], 'build', undefined, dir, () => {})
  const server = await compileServer(cfg)
  let c
  try {
    ;[c] = await compileEntry(viteLoader(server), cfg, cfg.entries[0], { draft: true })
  } finally {
    await server.close()
  }
  const [ref] = c.site.references
  assert.equal(ref.side, 'B', 'the driver mates the controller from below')
  const { json } = parseGlb(c.glb)
  const roots = json.scenes[0].nodes.map(i => json.nodes[i])
  const node = roots.find(n => n.name === `reference:${ref.name}`)
  const back = roots.find(n => n.name === 'bodies:B').extras.pcbjs.explode
  assert.deepEqual(node.extras.pcbjs.explode, back)
  assert.ok(back[1] < 0)
  assert.equal(node.extras.pcbjs.side, 'B')
})
