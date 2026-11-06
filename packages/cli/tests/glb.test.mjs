// A representative GLB export preserves the board stack, part nodes and schematic asset.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../dist/project/config.js'

import { compileServer } from '../dist/project/compile.js'
import { viteLoader } from '../dist/project/loader.js'
import { compileEntry } from '../dist/project/project.js'

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
