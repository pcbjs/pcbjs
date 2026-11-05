import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerCompiler } from '../dist/session/worker-client.js'
import { queryMethods } from '../dist/session/queries.js'
import { snapshotOf } from '../dist/project/report.js'

const fixture = `import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
const { SIG, GND } = nets()
const R1 = R0603('1k').connect({ 1: SIG, 2: GND })
const R2 = R0603('2k').connect({ 1: SIG, 2: GND })
export default <PCB name="Replay" autoroute={{}}><rect layer="Edge.Cuts" x={0} y={0} w={20} h={12} /><R1 at="5 6" /><R2 at="15 6" />{route(R1[1], R2[1]).width(0.25).X()}{route(R1[2], R2[2]).width(0.25).X()}</PCB>
`

test('worker cold/warm replay isolates caches, retains overlay geometry and closes its namespaces', { timeout: 120000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-rebuild-test-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(fileURLToPath(new URL('../../../node_modules/@pcbjs', import.meta.url)), join(root, 'node_modules/@pcbjs'), 'dir')
  const configFile = join(root, 'pcb.config.ts'),
    file = join(root, 'pcb.tsx'),
    entry = { file, rel: 'pcb.tsx' }
  writeFileSync(configFile, "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(file, fixture)
  const c = workerCompiler({ root, configFile, log: line => assert.doesNotMatch(line, /failed|stopped/) })
  const previous = new Set(readdirSync(tmpdir()).filter(n => n.startsWith('pcbjs-rebuild-')))
  let cacheRoot
  try {
    await assert.rejects(c.compile(entry, { draft: false, rebuild: 'warm' }), /no prepared rebuild cache/)
    await c.compile(entry, { draft: false })
    const index = join(root, '.pcbjs/cache/index/Replay.json')
    const before = readFileSync(index, 'utf8')
    const [cold] = await c.compile(entry, { draft: false, rebuild: 'all' })
    const [warm] = await c.compile(entry, { draft: false, rebuild: 'warm' })
    assert.equal(snapshotOf(cold.board), snapshotOf(warm.board))
    assert.equal(cold.board.routing.cached, 0)
    assert.equal(cold.cacheNamespace, warm.cacheNamespace)
    assert.notEqual(cold.cacheNamespace, 'project')
    assert.equal(readFileSync(index, 'utf8'), before, 'rebuild never mutates default index')
    const overlay = fixture.replace('at="5 6"', 'at="6 6"')
    c.draft(file, { code: overlay, limit: null })
    const [draftCold] = await c.compile(entry, { draft: true, rebuild: 'all' })
    const [draftWarm] = await c.compile(entry, { draft: true, rebuild: 'warm' })
    assert.equal(draftCold.board.footprints.find(f => f.ref === 'R1').at[0], 6)
    assert.equal(snapshotOf(draftCold.board), snapshotOf(draftWarm.board))
    const verified = { id: 'verified', project: root, slots: [{ entry, compiled: [draftWarm] }], overlay: new Map([[file, 'overlay']]), findings: new Map() }
    let current = verified,
      drift = false
    const seen = []
    const prj = {
      root,
      settle: async () => ({ snap: current, stale: null }),
      current: () => current,
      snapshotStale: () => null,
      artifact: (compiled, kind) => {
        if (drift) current = { ...verified, id: 'later' }
        return c.artifact(compiled.run, compiled.board.name, null, kind)
      },
    }
    const methods = queryMethods({
      api: () => ({ find: async () => prj }),
      renderer: () => ({
        shot: async (scene, frame, options) => {
          seen.push(scene.snapshot)
          return { rgba: new Uint8Array(16 * 16 * 4).fill(255), width: 16, height: 16 }
        },
      }),
    })
    for (const camera of ['top', 'bottom', 'front']) {
      const image = await methods['session/render']({ project: root, expectedSnapshot: 'verified', spec: { entry: 'pcb.tsx', view: '3d', camera, size: [16, 16] } }, {})
      assert.equal(image.snapshot, 'verified')
      assert.deepEqual(image.overlay, ['pcb.tsx'])
      assert.equal(image.stale, null)
    }
    assert.deepEqual(seen, ['verified', 'verified', 'verified'])
    drift = true
    await assert.rejects(
      methods['session/render']({ project: root, expectedSnapshot: 'verified', spec: { entry: 'pcb.tsx', view: '3d', size: [16, 16] } }, {}),
      /snapshot changed or stale/,
    )
    current = verified
    const changed = await methods['session/render']({ project: root, spec: { entry: 'pcb.tsx', view: '3d', size: [16, 16] } }, {})
    assert.equal(changed.snapshot, 'verified')
    assert.deepEqual(changed.stale, { reason: 'changed', current: 'later' })
    assert.equal(readFileSync(file, 'utf8'), fixture)
    assert.equal(readFileSync(index, 'utf8'), before, 'editor replay never mutates saved cache')
    cacheRoot = readdirSync(tmpdir())
      .filter(n => n.startsWith('pcbjs-rebuild-'))
      .find(n => !previous.has(n))
  } finally {
    await c.close()
    if (cacheRoot) assert.equal(existsSync(join(tmpdir(), cacheRoot)), false)
    rmSync(root, { recursive: true, force: true })
  }
})
