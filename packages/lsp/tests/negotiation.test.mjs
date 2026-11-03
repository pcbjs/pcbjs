// A mock editor connects to a real dev server at /__pcbjs/session; editors of older, current and future protocols are answered or told the fix.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { dev } from './fixtures/dev.mjs'
import { MAJOR, PROTOCOL, KINDS } from '@pcbjs/core/protocol'
import { makeProject } from './fixtures/project.mjs'
import { initParams } from './fixtures/client.mjs'

let project, server, sock, uri, text
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
  server = await dev({ root: project.root, port: 0, host: '127.0.0.1' })
  sock = new WebSocket(`ws://127.0.0.1:${server.httpServer.address().port}/__pcbjs/session`)
  sock.on('message', raw => frames.push(JSON.parse(String(raw))))
  await new Promise((ok, fail) => (sock.once('open', ok), sock.once('error', fail)))
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.1.0', protocol: PROTOCOL, major: MAJOR, capabilities: ['boards', 'lsp'], role: 'editor' })
  await until(() => event('pcbjs:ide:ready'))
})

after(async () => {
  // closing during the first compile leaves Vite's esbuild service running
  await until(() => event('pcbjs:ide:boards'), 60000).catch(() => {})
  sock?.terminate()
  await server?.close()
  if (project) rmSync(project.root, { recursive: true, force: true })
})

test('ready names the protocol, the major and the capabilities, the language server among them', () => {
  const ready = event('pcbjs:ide:ready').data
  assert.equal(ready.protocol, PROTOCOL)
  assert.equal(ready.major, MAJOR)
  assert.deepEqual(ready.capabilities, ['bye', 'lsp'])
  const devJson = JSON.parse(readFileSync(`${project.root}/.pcbjs/dev.json`, 'utf8'))
  assert.deepEqual(Object.keys(devJson), ['pid', 'tiers', 'version', 'protocol', 'major', 'startedAt', 'root', 'url', 'session', 'socket', 'edit', 'checkout'])
  assert.deepEqual(devJson.tiers, { keystroke: 30, quiet: 300 })
  assert.equal(devJson.major, MAJOR)
  assert.equal(devJson.protocol, PROTOCOL)
  assert.equal(devJson.url, `http://127.0.0.1:${ready.port}/`)
})

test('a hello without protocol, major and capabilities is told the fix in the log it shows', async () => {
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.0.1' })
  const log = await until(() => frames.find(f => f.event === 'pcbjs:ide:log' && /lacks protocol/.test(f.data?.text)))
  assert.equal(log.data.level, 'warn')
  assert.match(log.data.text, /pcbjs ide install/)
})

test('an extension of an older major is told the fix in the log it shows', async () => {
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.0.1', protocol: 1, major: MAJOR - 1, capabilities: [] })
  const log = await until(() => frames.find(f => f.event === 'pcbjs:ide:log' && /major \d+, this pcbjs/.test(f.data?.text)))
  assert.equal(log.data.level, 'warn')
  assert.match(log.data.text, new RegExp(`major ${MAJOR - 1}, this pcbjs needs ${MAJOR}`))
})

test('a current extension gets every kind, each segment with its widget', async () => {
  send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.1.0', protocol: PROTOCOL, major: MAJOR, capabilities: ['ready', 'lsp'] })
  const res = await request('initialize', initParams(project.root, { protocol: PROTOCOL, major: MAJOR, capabilities: ['unknown'], name: 'new', version: '0.1.0' }))
  const p = res.capabilities.experimental.pcbjs
  assert.equal(p.protocol, PROTOCOL)
  assert.deepEqual(p.capabilities, [])
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  const segs = await request('pcbjs/segments', { textDocument: { uri } })
  for (const s of segs) assert.ok(KINDS.includes(s.kind), s.kind)
  assert.ok(segs.some(s => s.kind === 'pathCommand'))
  for (const s of segs) {
    assert.equal(typeof s.widget?.input, 'string', JSON.stringify(s))
    assert.equal(typeof s.widget.typed, 'boolean')
  }
  const pos = segs.find(s => s.kind === 'position')
  assert.deepEqual([pos.widget.input, pos.widget.typed], ['position', true])
})

test("a future extension is answered with this server's protocol", async () => {
  const res = await request('initialize', initParams(project.root, { protocol: PROTOCOL + 5, major: MAJOR, capabilities: ['sliders'] }))
  assert.equal(res.capabilities.experimental.pcbjs.protocol, PROTOCOL)
  assert.deepEqual(res.capabilities.experimental.pcbjs.capabilities, [])
})
