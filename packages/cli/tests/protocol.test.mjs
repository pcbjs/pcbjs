// @pcbjs/core/protocol against its two sides: a running session answers every method it declares, and every event it declares has
// a receiver, read from the sources of ui, viewer, vscode and the CLI's own clients.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SESSION_METHODS, WRITE } from '@pcbjs/core/protocol'
import { connectSession } from '../dist/session/client.js'
import { serveSession } from './fixtures/proc.mjs'
import { board } from './fixtures/workspace.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROTOCOL_SRC = readFileSync(join(REPO, 'packages', 'core', 'src', 'protocol.ts'), 'utf8')

/** The keys of an interface of protocol.ts, read from its source. */
function keysOf(name) {
  const start = PROTOCOL_SRC.indexOf(`export interface ${name} {`)
  assert.ok(start >= 0, `protocol.ts declares ${name}`)
  const body = PROTOCOL_SRC.slice(start, PROTOCOL_SRC.indexOf('\n}\n', start))
  return [...body.matchAll(/^ {2}'([^']+)':/gm)].map(m => m[1])
}

/** Every .ts and .vue source under a package's src. */
function sources(pkg) {
  const out = []
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (/\.(ts|vue)$/.test(e.name)) out.push({ file: f, text: readFileSync(f, 'utf8') })
    }
  }
  walk(join(REPO, 'packages', pkg, 'src'))
  return out
}

let root, session, conn

before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-protocol-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
  writeFileSync(join(root, 'pcb.tsx'), board('Protocol'))
  session = await serveSession(root)
  conn = await connectSession(session.info.socket, { name: 'protocol test', role: 'cli', project: root })
})

after(async () => {
  conn?.close()
  await session?.stop()
  if (root) rmSync(root, { recursive: true, force: true })
})

test('Methods and SESSION_METHODS name the same methods, and WRITE is the ones that write', () => {
  assert.deepEqual([...SESSION_METHODS].sort(), keysOf('Methods').sort())
  for (const m of WRITE) assert.ok(SESSION_METHODS.includes(m), m)
})

test('a running session answers every method of Methods', async () => {
  // params that fail each method fast at its own checks, so none compiles, renders or writes; stop goes last
  const nowhere = {
    project: join(root, 'nowhere'),
    file: join(root, 'nowhere.tsx'),
    folders: [],
    txn: 'none',
    reference: 'nothing',
    entry: 'nowhere.tsx',
    facets: [],
    code: '0',
    spec: {},
  }
  const missing = []
  for (const m of SESSION_METHODS.filter(m => m !== 'session/stop')) {
    const err = await conn.request(m, nowhere, 30_000).then(
      () => null,
      e => e,
    )
    if (err?.code === -32601) missing.push(m)
  }
  assert.deepEqual(missing, [], 'methods the session does not answer')
  assert.deepEqual(await conn.request('session/stop'), { stopping: session.info.session })
})

test('every event the session sends has a receiver in ui, viewer, vscode or a CLI client', () => {
  const clients = [...sources('ui'), ...sources('viewer'), ...sources('vscode'), ...sources('cli').filter(s => s.text.includes('onEvent('))]
  const none = keysOf('Events').filter(e => !clients.some(s => s.text.includes(`'${e}'`)))
  assert.deepEqual(none, [], 'events no client takes')
})

test('every event a client sends has a receiver in the session', () => {
  const cli = sources('cli').filter(s => !s.text.includes('onEvent('))
  const none = keysOf('Sends').filter(e => !cli.some(s => s.text.includes(`'${e}'`)))
  assert.deepEqual(none, [], 'events the session never takes')
})
