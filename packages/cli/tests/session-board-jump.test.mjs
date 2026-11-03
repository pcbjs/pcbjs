// `session/select` with a board reference alone opens the board's entry in every editor with the cursor on its `<PCB`, focus kept
// for the viewer's selector and given for the extension's tree, and leaves the board's selection as it was.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'
import { stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-jump-')))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(
  join(root, 'pcb.config.ts'),
  "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['a.pcb.tsx', 'b.pcb.tsx'], vite: { logLevel: 'silent' } })\n",
)
writeFileSync(join(root, 'a.pcb.tsx'), board('Alpha'))
writeFileSync(join(root, 'b.pcb.tsx'), board('Beta', '// the board below\n'))
let child
after(async () => {
  await stop(child)
  rmSync(root, { recursive: true, force: true })
})

async function until(fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

/** A session connection, an editor when `editor`, keeping every notification it gets. */
async function connect(url, editor) {
  const ws = new WebSocket(url)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const notes = []
  const waits = new Map()
  let id = 0
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.method && m.id === undefined) notes.push(m)
    if (m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  const send = m => ws.send(JSON.stringify(m))
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(++id, { ok, fail })
      send({ jsonrpc: '2.0', id, method, params })
    })
  send({ event: 'pcbjs:ide:hello', data: { name: 'test', version: '0', protocol: 3, major: 1, capabilities: [], role: editor ? 'editor' : 'agent', project: root } })
  if (editor) {
    await request('initialize', {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {},
      initializationOptions: { pcbjs: { protocol: 3, major: 1, capabilities: [] } },
    })
    send({ jsonrpc: '2.0', method: 'initialized', params: {} })
  }
  return { ws, notes, request }
}

const selects = ed => ed.notes.filter(n => n.method === 'pcbjs/select').map(n => n.params)
const lineOf = (file, re) =>
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .findIndex(l => re.test(l))

test('a board reference alone jumps the editor to its entry’s <PCB, focus given only when asked, the selection unchanged', { timeout: 180000 }, async () => {
  child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, XDG_RUNTIME_DIR: join(root, '.run'), NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  const port = new URL(info.url).port
  const url = `ws://127.0.0.1:${port}/__pcbjs/session`
  const ed = await connect(url, true)
  const agent = await connect(url, false)
  await agent.request('session/check')
  const set = await agent.request('session/select', { board: 'Beta', refs: ['TP1'] })
  assert.deepEqual(set.refs, ['TP1'])
  await until(() => selects(ed).length)
  ed.notes.length = 0

  const kept = await agent.request('session/select', { board: 'Beta', refs: ['board:Beta'], focus: true })
  assert.deepEqual([kept.refs, kept.seq], [['TP1'], set.seq], 'the selection stays')
  const [tree] = await until(() => selects(ed).length && selects(ed))
  const pcb = lineOf('b.pcb.tsx', /<PCB /)
  assert.deepEqual(tree.items, [{ uri: pathToFileURL(join(root, 'b.pcb.tsx')).href, ranges: [{ start: { line: pcb, character: 2 }, end: { line: pcb, character: 6 } }] }])
  assert.equal(tree.reveal, true)
  assert.equal(tree.focus, true)

  ed.notes.length = 0
  const page = await viewerClient(port, { board: 'Alpha' })
  await page.request('session/select', { board: 'Alpha', refs: ['board:Alpha'] })
  const [chosen] = await until(() => selects(ed).length && selects(ed))
  assert.equal(chosen.items[0].uri, pathToFileURL(join(root, 'a.pcb.tsx')).href)
  assert.equal(chosen.items[0].ranges[0].start.line, lineOf('a.pcb.tsx', /<PCB /))
  assert.equal(chosen.focus, undefined, 'the preview keeps focus')
  await new Promise(r => setTimeout(r, 300))
  assert.equal(selects(ed).length, 1, 'one jump')

  await assert.rejects(agent.request('session/select', { board: 'Nope', refs: ['board:Nope'] }), /no board Nope/)
  for (const c of [ed, agent, page]) c.ws.close()
})
