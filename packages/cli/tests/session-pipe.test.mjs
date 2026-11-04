// Windows only, in CI's Windows job: the session binds its named pipe, answers hello with ready over it, and a second session
// on the same root exits.
import { stop } from './fixtures/proc.mjs'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { board } from './fixtures/workspace.mjs'

const WIN = process.platform === 'win32'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const ARGS = ['session', 'serve', '--port', '0', '--host', '127.0.0.1', '--grace', '60']

const root = WIN ? realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-pipe-'))) : ''
const children = []
let owned
const { alive } = await import('../dist/session/start.js')
after(async () => {
  await Promise.all(children.map(c => stop(c)))
  if (owned) {
    const { connectSession } = await import('../dist/session/client.js')
    const client = await connectSession(owned.socket, { name: 'pipe cleanup', role: 'agent' }).catch(() => null)
    if (client) {
      await client.request('session/stop').catch(() => {})
      await client.done
    }
    for (let i = 0; i < 200 && alive(owned.pid); i++) await new Promise(r => setTimeout(r, 100))
    assert.equal(alive(owned.pid), false, 'the owned session exited before removing its working directory')
  }
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

test('the named pipe: bound, hello and ready exchanged, a second session on the root exits', { skip: !WIN && 'Windows only', timeout: 120000 }, async () => {
  const { ensureSession, liveSession } = await import('../dist/session/start.js')
  const { connectSession } = await import('../dist/session/client.js')
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'junction')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board('Pipe'))
  const { info } = await ensureSession(root, { args: ARGS.slice(2) })
  owned = info
  assert.match(info.socket, /^\\\\\.\\pipe\\pcbjs-[a-z0-9]+-[0-9a-f]{16}$/)
  const c = await connectSession(info.socket, { name: 'pipe test', role: 'agent' })
  assert.equal(c.ready.session, info.session)
  assert.equal(c.ready.mode, 'rw')
  assert.equal(c.ready.projects[0].root, root)
  const st = await c.request('session/status')
  assert.equal(st.pid, info.pid)

  const second = spawn(process.execPath, [BIN, ...ARGS], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(second)
  let out = ''
  second.stdout.on('data', d => (out += d))
  assert.equal(await new Promise(r => second.once('exit', r)), 0)
  assert.match(out, new RegExp(`session ${info.session}, pid ${info.pid}, already serves`))

  await c.request('session/stop').catch(() => {})
  await c.done
  for (let i = 0; i < 100 && (await liveSession(root)); i++) await new Promise(r => setTimeout(r, 100))
  assert.equal(await liveSession(root), null)
})
