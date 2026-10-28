// A real dev server dials a mock editor host; editors of older, current and future protocols negotiate with it.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { dev } from '@pcbjs/cli/server'
import { IDE_MAJOR, IDE_PROTOCOL } from '@pcbjs/cli/host-client'
import { MAJOR, PROTOCOL, KINDS } from '../dist/protocol.js'
import { makeProject } from './fixtures/project.mjs'
import { ALL_KINDS, initParams } from './fixtures/client.mjs'

let project, server, wss, sock, uri, text
const frames = []
let nextId = 1

const until = async (pred, ms = 20000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = pred()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}
const event = name => frames.find(f => f.event === name)
const send = (event, data) => sock.send(JSON.stringify({ event, data }))
async function request(method, params) {
  const id = nextId++
  sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  const res = await until(() => frames.find(f => f.jsonrpc && f.id === id))
  if (res.error) throw new Error(res.error.message)
  return res.result
}
const notify = (method, params) => sock.send(JSON.stringify({ jsonrpc: '2.0', method, params }))

before(async () => {
  project = makeProject()
  uri = pathToFileURL(project.main).href
  text = readFileSync(project.main, 'utf8')
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/tok' })
  await new Promise(r => wss.once('listening', r))
  wss.on('connection', ws => {
    sock = ws
    ws.on('message', raw => frames.push(JSON.parse(String(raw))))
  })
  server = await dev({ root: project.root, port: 0, host: '127.0.0.1', ide: `ws://127.0.0.1:${wss.address().port}/tok` })
  await until(() => event('pcbjs:ide:ready'))
})

after(async () => {
  // closing during the first compile leaves Vite's esbuild service running
  await until(() => event('pcbjs:ide:boards'), 60000).catch(() => {})
  await server?.close()
  for (const ws of wss?.clients ?? []) ws.terminate()
  await new Promise(r => (wss ? wss.close(() => r()) : r()))
  if (project) rmSync(project.root, { recursive: true, force: true })
})

test('the CLI and the language server agree on the protocol numbers', () => {
  assert.equal(IDE_PROTOCOL, PROTOCOL)
  assert.equal(IDE_MAJOR, MAJOR)
})

test('ready names the protocol, the major and the capabilities, the language server among them', () => {
  const ready = event('pcbjs:ide:ready').data
  assert.equal(ready.protocol, PROTOCOL)
  assert.equal(ready.major, MAJOR)
  assert.deepEqual(ready.capabilities, ['cursor', 'focus', 'close', 'bye', 'lsp'])
  const devJson = JSON.parse(readFileSync(`${project.root}/.pcbjs/dev.json`, 'utf8'))
  assert.equal(devJson.major, MAJOR)
  assert.equal(devJson.protocol, PROTOCOL)
})

test('an older extension: a hello without protocol and protocol 1 options keep the protocol 1 behaviour, and no warning', async () => {
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.0.1' })
  const res = await request('initialize', initParams(project.root, { protocol: 1, kinds: ['position', 'length', 'enum'], name: 'old', version: '0.0.1' }))
  const p = res.capabilities.experimental.pcbjs
  assert.equal(p.protocol, 1)
  assert.deepEqual(p.capabilities, [])
  assert.deepEqual(p.kinds, ['position', 'length', 'enum'])
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  const segs = await request('pcbjs/segments', { textDocument: { uri } })
  assert.ok(segs.length && segs.every(s => ['position', 'length', 'enum'].includes(s.kind)))
  assert.ok(!frames.some(f => f.event === 'pcbjs:ide:log' && /ide install/.test(f.data?.text)))
})

test('an extension of an older major is told the fix in the log it shows', async () => {
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.0.1', protocol: 1, major: MAJOR - 1, capabilities: [] })
  const log = await until(() => frames.find(f => f.event === 'pcbjs:ide:log' && /ide install/.test(f.data?.text)))
  assert.equal(log.data.level, 'warn')
  assert.match(log.data.text, new RegExp(`major ${MAJOR - 1}, this pcbjs needs ${MAJOR}`))
})

test('a current extension with widget gets every kind, each segment with its widget', async () => {
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.1.0', protocol: PROTOCOL, major: MAJOR, capabilities: ['ready', 'lsp', 'widget'] })
  const res = await request(
    'initialize',
    initParams(project.root, { protocol: PROTOCOL, major: MAJOR, kinds: ['length'], capabilities: ['widget', 'unknown'], name: 'new', version: '0.1.0' }),
  )
  const p = res.capabilities.experimental.pcbjs
  assert.equal(p.protocol, PROTOCOL)
  assert.deepEqual(p.capabilities, ['widget'])
  assert.deepEqual(p.kinds, [...KINDS])
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  const segs = await request('pcbjs/segments', { textDocument: { uri } })
  assert.ok(
    segs.some(s => s.kind === 'pathCommand'),
    'kinds outside the listed ones arrive as they are',
  )
  for (const s of segs) {
    assert.equal(typeof s.widget?.input, 'string', JSON.stringify(s))
    assert.equal(typeof s.widget.typed, 'boolean')
  }
  const pos = segs.find(s => s.kind === 'position')
  assert.deepEqual([pos.widget.input, pos.widget.typed], ['position', true])
})

test("a future extension is answered with this server's protocol", async () => {
  const res = await request('initialize', initParams(project.root, { protocol: PROTOCOL + 5, major: MAJOR, kinds: ALL_KINDS, capabilities: ['widget', 'sliders'] }))
  assert.equal(res.capabilities.experimental.pcbjs.protocol, PROTOCOL)
  assert.deepEqual(res.capabilities.experimental.pcbjs.capabilities, ['widget'])
})
