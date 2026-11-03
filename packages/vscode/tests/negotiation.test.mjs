// Version negotiation from the extension's side: mock sessions of older, current and future protocols answer the link's hello.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mockSession, until, sleep } from './fake.mjs'

const require = createRequire(import.meta.url)
const { SessionLink } = require('../dist/link.cjs')
const { CAPABILITIES, offers, mismatch } = require('../dist/protocol.cjs')
const { PROTOCOL, MAJOR } = await import('@pcbjs/core/protocol')
const { initializationOptions } = require('../dist/lsp-client.cjs')

const ready = (over = {}) => ({
  port: 5301,
  host: '127.0.0.1',
  urls: ['http://127.0.0.1:5301/'],
  root: '/work/p',
  pid: 1,
  version: '0.0.1',
  protocol: PROTOCOL,
  major: MAJOR,
  capabilities: ['bye', 'lsp'],
  session: 'mock0001',
  mode: 'rw',
  projects: [],
  ...over,
})

function connect(s, extra = {}) {
  const got = { notices: [], readies: [], events: [] }
  const link = SessionLink.connect(s.dev, {
    name: 'vscode-pcbjs',
    version: '0.1.0',
    project: '/work/p',
    onReady: info => got.readies.push(info),
    onMismatch: text => got.notices.push(text),
    onEvent: (e, d) => got.events.push([e, d]),
    ...extra,
  })
  return { link, got }
}

test('the hello states the protocol, the major, the capabilities, the editor role and the project; the language client options too', async () => {
  const s = await mockSession(ready())
  const { link } = connect(s)
  const l = await link
  const hello = s.frames.find(f => f.event === 'pcbjs:ide:hello')
  assert.deepEqual(hello.data, { name: 'vscode-pcbjs', version: '0.1.0', protocol: PROTOCOL, major: MAJOR, capabilities: [...CAPABILITIES], role: 'editor', project: '/work/p' })
  assert.ok(CAPABILITIES.includes('lsp') && CAPABILITIES.includes('boards'))
  assert.equal(l.session, 'mock0001')
  const o = initializationOptions('0.1.0').pcbjs
  assert.deepEqual([o.protocol, o.major, o.capabilities], [PROTOCOL, MAJOR, ['tokens']])
  l.close()
  await s.close()
})

test('a ready without protocol, major and capabilities is ignored; the next one connects', async () => {
  const s = await mockSession(null, (m, send) => {
    if (m.event !== 'pcbjs:ide:hello') return
    const { protocol, major, capabilities, ...old } = ready()
    send({ event: 'pcbjs:ide:ready', data: old })
    send({ event: 'pcbjs:ide:ready', data: ready() })
  })
  const { link, got } = connect(s)
  const l = await link
  await sleep(20)
  assert.equal(got.readies.length, 1)
  assert.ok(offers(got.readies[0], 'lsp'))
  assert.equal(got.notices.length, 0)
  l.close()
  await s.close()
})

test('an older extension against a newer session: one notice with the fix, unknown events reach no handler of theirs', async () => {
  const info = ready({ version: '2.0.0', protocol: PROTOCOL + 3, major: MAJOR + 1, capabilities: ['cursor', 'focus', 'hologram'] })
  const s = await mockSession(info, (m, send) => {
    if (m.event !== 'pcbjs:ide:hello') return
    send({ event: 'pcbjs:ide:hologram', data: { depth: 3 } })
    send({ event: 'pcbjs:ide:ready', data: info })
  })
  const { link, got } = connect(s)
  const l = await link
  await until(() => got.readies.length === 2)
  assert.equal(got.notices.length, 1, 'once per connection')
  assert.match(got.notices[0], /speaks IDE protocol 2, this extension 1/)
  assert.match(got.notices[0], /pcbjs ide install/)
  assert.ok(!offers(got.readies[0], 'lsp'), 'a session that lists no lsp gets no language client')
  assert.deepEqual(got.events, [['pcbjs:ide:hologram', { depth: 3 }]])
  assert.equal(mismatch(ready()), undefined)
  l.close()
  await s.close()
})

test('a session older than the extension says so once: restart it', async () => {
  const s = await mockSession(null, (m, send) => {
    if (m.event === 'pcbjs:ide:hello') send({ event: 'pcbjs:ide:ready', data: ready({ protocol: PROTOCOL - 1, version: '0.0.1-beta.1' }) })
  })
  const { link, got } = connect(s)
  const l = await link
  await sleep(20)
  assert.deepEqual(got.notices, ['session 0.0.1-beta.1 in /work/p is older than the extension, restart it: pcbjs session stop, then pcbjs dev.'])
  assert.equal(mismatch(ready({ protocol: PROTOCOL + 1 })), undefined, 'a newer protocol of the same major is fine')
  l.close()
  await s.close()
})

test('a session request and the language client share the connection, replies routed by id', async () => {
  const s = await mockSession(ready(), (m, send) => {
    if (m.method === 'session/clients') send({ jsonrpc: '2.0', id: m.id, result: [{ client: 'c1', name: 'vscode-pcbjs', role: 'editor' }] })
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { capabilities: {} } })
  })
  const { link } = connect(s)
  const l = await link
  const rpc = []
  l.onRpc(m => rpc.push(m))
  assert.ok(l.sendRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
  const clients = await l.request('session/clients')
  assert.deepEqual(clients, [{ client: 'c1', name: 'vscode-pcbjs', role: 'editor' }])
  await until(() => rpc.length === 1)
  assert.equal(rpc[0].id, 1, "the language client's reply reaches it alone")
  let closed = false
  l.onClose(() => (closed = true))
  l.close()
  await until(() => closed)
  assert.equal(s.frames.filter(f => f.event === 'pcbjs:ide:bye').length, 0, 'a disconnect, no bye')
  await s.close()
})
