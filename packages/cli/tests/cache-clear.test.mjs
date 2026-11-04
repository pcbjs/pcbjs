// pcbjs cache clear: the caches of every project under a folder, refused while a live session serves one unless --force.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { socketOf } from '../dist/session/paths.js'

const bin = fileURLToPath(new URL('../../pcbjs/bin/pcbjs.js', import.meta.url))
const run = (cwd, ...args) => spawnSync(process.execPath, [bin, 'cache', 'clear', ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })

function project(root) {
  mkdirSync(join(root, '.pcbjs', 'cache', 'route'), { recursive: true })
  mkdirSync(join(root, '.pcbjs', 'models', 'boards'), { recursive: true })
  mkdirSync(join(root, '.pcbjs', 'log'), { recursive: true })
  writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['pcb.tsx'] }\n")
  writeFileSync(join(root, '.pcbjs', 'cache', 'route', 'Board.json'), 'x'.repeat(2000))
  writeFileSync(join(root, '.pcbjs', 'typecheck.json'), '{}')
  writeFileSync(join(root, '.pcbjs', 'models', 'boards', 'a.bin'), 'mesh')
  writeFileSync(join(root, '.pcbjs', 'log', 'session.log'), 'kept')
}

test('cache clear: refuses while a live session serves a project, --force clears it, the log and dev.json stay', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'pcbjs-cc-'))
  const a = join(ws, 'a')
  project(a)
  const socket = socketOf(a)
  if (process.platform !== 'win32') rmSync(socket, { force: true })
  const server = createServer(c => c.end())
  await new Promise(ok => server.listen(socket, ok))
  writeFileSync(join(a, '.pcbjs', 'dev.json'), JSON.stringify({ session: 'fake', socket, pid: process.pid }))
  try {
    const refused = run(ws)
    assert.equal(refused.status, 1, refused.stdout + refused.stderr)
    assert.match(refused.stdout, /session fake, pid \d+, serves .*a: stop it with pcbjs session stop, or pass --force/)
    assert.ok(existsSync(join(a, '.pcbjs', 'cache')))
    const forced = run(ws, '--force')
    assert.equal(forced.status, 0, forced.stdout + forced.stderr)
    assert.match(forced.stdout, /removed .*cache {2}2\.0 kB/)
    assert.ok(!existsSync(join(a, '.pcbjs', 'cache')))
    assert.ok(!existsSync(join(a, '.pcbjs', 'typecheck.json')))
    assert.ok(existsSync(join(a, '.pcbjs', 'models', 'boards', 'a.bin')), 'models stay without --models')
    assert.ok(existsSync(join(a, '.pcbjs', 'log', 'session.log')))
    assert.ok(existsSync(join(a, '.pcbjs', 'dev.json')))
  } finally {
    await new Promise(ok => server.close(ok))
    if (process.platform !== 'win32') rmSync(socket, { force: true })
  }
  const models = run(a, '--models')
  assert.equal(models.status, 0, models.stdout + models.stderr)
  assert.ok(!existsSync(join(a, '.pcbjs', 'models')))
  assert.match(models.stdout, /removed 1 path, 0\.0 kB, from 1 folder/)
  rmSync(ws, { recursive: true, force: true })
})
