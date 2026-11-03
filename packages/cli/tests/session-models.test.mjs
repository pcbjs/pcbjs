import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { meshFromBinary } from '@pcbjs/step/binary'
import { board } from './fixtures/workspace.mjs'
import { resolveConfig } from '../dist/project/config.js'
import { compileServer } from '../dist/project/compile.js'
import { viteLoader } from '../dist/project/loader.js'
import { compileEntry } from '../dist/project/project.js'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const BIN = join(REPO, 'packages/pcbjs/bin/pcbjs.js')

for (const workspace of [false, true]) {
  test(`a ${workspace ? 'workspace' : 'single-project'} session serves the STEP meshes of its loaded runtimes`, { timeout: 120000 }, async () => {
    const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-session-models-')))
    mkdirSync(join(top, 'node_modules'))
    symlinkSync(join(REPO, 'node_modules/@pcbjs'), join(top, 'node_modules/@pcbjs'), 'dir')
    const projects = workspace ? ['alpha', 'beta'].map(n => join(top, n)) : [join(top, 'alpha')]
    const lib = join(top, 'lib')
    mkdirSync(lib)
    copyFileSync(join(REPO, 'packages/step/tests/fixtures/pin.step'), join(lib, 'pin.step'))
    const source = board('Shared')
    const from = source.indexOf('const TestPad =')
    const to = source.indexOf('const { V }')
    writeFileSync(join(lib, 'parts.tsx'), `import { defineFootprint, type FootprintProps } from '@pcbjs/core'\n${source.slice(from, to).replace('const TestPad =', 'export const TestPad =').replace('<footprint value="V"', '<footprint model={{ file: "./pin.step" }} value="V"')}`)
    const expected = []
    for (const [i, root] of projects.entries()) {
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
      writeFileSync(join(root, 'pcb.tsx'), board(`Model${i}`).replace(source.slice(from, to), "import { TestPad } from '../lib/parts'\n"))
      const cfg = await resolveConfig([], 'build', undefined, root, () => {})
      const server = await compileServer(cfg)
      try {
        const [c] = await compileEntry(viteLoader(server), cfg, cfg.entries[0], { draft: true })
        assert.equal(c.board.footprints[0].model.path, join(lib, 'pin.step'))
        expected.push(c.site.footprints.find(f => f.step?.mesh).step.mesh)
      } finally { await server.close() }
    }
    assert.ok(expected.every(hash => hash === expected[0]), 'shared model content has one hash across projects')
    const args = ['session', 'serve', '-p', '0', '--host', '127.0.0.1', ...(workspace ? ['--workspace', top] : [])]
    const env = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? '/tmp/pcbjs-5252', PCBJS_CACHE_DIR: join(top, '.user-cache') }
    const child = spawn(process.execPath, [BIN, ...args], { cwd: workspace ? top : projects[0], env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stdout.on('data', d => log += d)
    child.stderr.on('data', d => log += d)
    try {
      const sessionRoot = workspace ? top : projects[0]
      const until = Date.now() + 60000
      while (!existsSync(join(sessionRoot, '.pcbjs/dev.json'))) {
        if (child.exitCode !== null || Date.now() > until) throw new Error(log || 'session did not start')
        await new Promise(r => setTimeout(r, 50))
      }
      const info = JSON.parse(readFileSync(join(sessionRoot, '.pcbjs/dev.json'), 'utf8'))
      const origin = new URL(info.url).origin
      const meshes = []
      for (const [i, root] of projects.entries()) {
        if (workspace) assert.equal((await fetch(`${origin}/__pcbjs/scope/${i ? 'beta' : 'alpha'}`)).status, 200, log)
        const res = await fetch(`${origin}/__pcbjs/Model${i}/board.json`)
        assert.equal(res.status, 200, log)
        const site = await res.json()
        const step = site.footprints.find(f => f.step?.mesh)?.step
        assert.ok(step?.mesh, JSON.stringify(site.footprints))
        assert.equal(step.mesh, expected[i])
        meshes.push(step.mesh)
      }
      for (const mesh of meshes) {
        const res = await fetch(`${origin}/__pcbjs/model/${mesh}`)
        assert.equal(res.status, 200, await res.clone().text())
        assert.equal(res.headers.get('content-type'), 'application/octet-stream')
        assert.match(res.headers.get('cache-control'), /immutable/)
        assert.ok(meshFromBinary(await res.arrayBuffer()).meshes[0].indices.length > 0)
      }
      assert.equal((await fetch(`${origin}/__pcbjs/model/${'0'.repeat(64)}`)).status, 404)
    } finally {
      await stop(child)
      rmSync(top, { recursive: true, force: true })
    }
  })
}
