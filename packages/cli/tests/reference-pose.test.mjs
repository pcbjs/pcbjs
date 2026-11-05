import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveConfig } from '../dist/project/config.js'
import { compileServer } from '../dist/project/compile.js'
import { viteLoader } from '../dist/project/loader.js'
import { compileEntry } from '../dist/project/project.js'
import { inspectReferences, referenceStats } from '../dist/project/references.js'
import { readGlb } from '@pcbjs/export/compose'
import { apply4 } from '@pcbjs/compile/internal/reference'
import { boardView } from '../dist/render/flat.js'

const repo = resolve(import.meta.dirname, '../../..')
const wire = value => JSON.parse(JSON.stringify(value))
const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-7, `${a} != ${b}`))

test('native quaternion references survive cached builds, source edits and GLB/fabrication export', { timeout: 120000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-pose-')))
  for (const file of ['pcb.config.ts', 'tsconfig.json', 'dimensions.ts', 'carrier.pcb.tsx', 'camera.pcb.tsx'])
    copyFileSync(join(repo, 'examples/board-poses', file), join(root, file))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir')
  const run = async (file = 'carrier.pcb.tsx') => {
    const cfg = await resolveConfig([file], 'build', undefined, root, () => {})
    const server = await compileServer(cfg)
    try {
      return (await compileEntry(viteLoader(server), cfg, cfg.entries[0]))[0]
    } finally {
      await server.close()
    }
  }
  try {
    const spawned = referenceStats().spawned
    const cold = await run()
    assert.equal(referenceStats().spawned, spawned + 1, 'one source compile serves all three cameras')
    const warm = await run()
    assert.equal(referenceStats().spawned, spawned + 1, 'warm references reuse source and mesh caches')
    assert.deepEqual(wire(warm.board.references), wire(cold.board.references))
    assert.deepEqual(warm.board.drc, cold.board.drc)
    const flat = { board: cold.board, spec: { view: '2d' }, frame: null, highlight: [], marks: [], theme: 'light', size: [600, 400] }
    assert.equal((boardView(flat).match(/data-kind="reference"/g) ?? []).length, 3, 'default 2D shots show all reference projections')
    assert.ok(!boardView({ ...flat, spec: { view: '2d', layers: ['F.Cu'] } }).includes('data-kind="reference"'), 'explicit layer selection still hides reference drawings')
    assert.equal((cold.svg.match(/data-kind="reference"/g) ?? []).length, 3, 'standalone SVG shares the same projections')
    assert.ok(cold.board.references.every(r => r.mesh === cold.board.references[0].mesh))
    const report = inspectReferences(cold.board, root)
    assert.match(report.text.join('\n'), /quaternion/)
    assert.match(report.text.join('\n'), /bounds/)
    for (const row of report.json.references) {
      close(row.normal, [0, 1, 0])
      close(row.z, [11.6, 31.6])
      close(row.pose.orientation, [Math.SQRT1_2, 0, 0, Math.SQRT1_2])
      assert.equal(row.heights.there.find(b => b.ref === 'CAM1').height, 5)
    }
    const { json } = readGlb(cold.glb)
    const refs = json.nodes.filter(n => n.name === 'reference:Camera')
    assert.equal(refs.length, 3)
    for (const [i, n] of refs.entries()) {
      assert.ok(json.meshes[n.mesh].primitives.length > 0, 'native board mesh reaches the export')
      const [x, y] = [
        [10, 0],
        [110, 0],
        [60, 62],
      ][i]
      close(apply4(n.matrix, [0, 0, 0]), [x / 1000, 0.0216, y / 1000])
      close(apply4(n.matrix, [0, 10, 0]), [x / 1000, 0.0316, y / 1000])
      close(apply4(n.matrix, [0, 0, 1]), [x / 1000, 0.0216, (y + 1) / 1000])
    }
    assert.deepEqual(cold.board.footprints, [])
    assert.ok(!cold.fab.files['bom.csv'].includes('R1'))
    assert.ok(!cold.fab.files['cpl.csv'].includes('R1'))
    assert.ok(!Object.keys(cold.fab.files).some(f => f.endsWith('.drl')))
    const camera = await run('camera.pcb.tsx')
    assert.ok(camera.fab.files['bom.csv'].includes('R1'), 'camera keeps its own parts')
    assert.ok(
      Object.keys(camera.fab.files).some(f => f.endsWith('.drl')),
      'camera keeps its own holes',
    )
    const dims = join(root, 'dimensions.ts')
    writeFileSync(dims, readFileSync(dims, 'utf8').replace('cameraSize = 20', 'cameraSize = 24'))
    const edited = await run()
    assert.equal(referenceStats().spawned, spawned + 2, 'an imported source edit recompiles the shared camera once')
    for (const [i, r] of edited.board.references.entries()) {
      assert.notEqual(r.hash, cold.board.references[i].hash)
      assert.notEqual(r.mesh, cold.board.references[i].mesh)
      close(r.z, [9.6, 33.6])
      assert.ok(r.files.some(f => f.endsWith('dimensions.ts')))
    }
    assert.deepEqual(wire((await run()).board.references), wire(edited.board.references), 'updated results persist in stage and reference caches')
    const source = join(root, 'camera.pcb.tsx')
    writeFileSync(source, readFileSync(source, 'utf8').replace('<PCB name="Camera"', '<PCB name="Camera" title="Revised camera"'))
    const revised = await run()
    assert.ok(
      revised.board.references.every(r => r.title === 'Revised camera' && r.mesh !== edited.board.references[0].mesh),
      'a child-only source edit invalidates all references',
    )
    rmSync(join(root, '.pcbjs/cache'), { recursive: true, force: true })
    globalThis[Symbol.for('pcbjs.cli.references')].clear()
    assert.deepEqual(wire((await run()).board.references), wire(revised.board.references), 'a cold rebuild agrees with the updated cache')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
