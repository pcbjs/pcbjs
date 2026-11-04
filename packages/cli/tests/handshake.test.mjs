import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientsOf } from '../dist/session/clients.js'
import { serverCapabilities } from '../dist/session/ide-protocol.js'

test('session methods require compatible hello; local status and stop remain available for recovery', async () => {
  let calls = 0,
    attached = 0
  const clients = clientsOf({
    info: () => ({ session: 'test', edit: 'localhost' }),
    ready: () => ({ protocol: 6, major: 1, capabilities: [] }),
    hub: () => null,
    methods: () => Object.fromEntries(['session/write', 'session/status', 'session/stop'].map(m => [m, () => (++calls, { ok: true })])),
    attach: () => {
      attached++
    },
    log() {},
  })
  const open = kind => {
    const frames = []
    const c = clients.add({ kind, loopback: true, send: text => (frames.push(JSON.parse(text)), true), close() {} })
    let id = 0
    return {
      c,
      async request(method) {
        c.receive({ jsonrpc: '2.0', id: ++id, method })
        await new Promise(r => setImmediate(r))
        return frames.find(f => f.id === id)
      },
    }
  }
  const local = open('socket')
  assert.match((await local.request('session/write')).error.message, /compatible.*hello/)
  assert.equal(calls, 0)
  assert.equal((await local.request('session/status')).result.ok, true)
  assert.equal((await local.request('session/stop')).result.ok, true)
  const hello = major => ({ name: 'test', version: '1', role: 'cli', protocol: 3, major, capabilities: [], project: '/mock' })
  local.c.receive({ event: 'pcbjs:ide:hello', data: hello(99) })
  assert.match((await local.request('session/write')).error.message, /compatible/)
  assert.equal(attached, 0)
  local.c.receive({ event: 'pcbjs:ide:hello', data: hello(1) })
  assert.equal((await local.request('session/write')).result.ok, true, 'same-major older protocol remains supported')
  assert.equal(attached, 1)
  const remote = open('tcp')
  assert.ok((await remote.request('session/stop')).error)
  local.c.closed()
  remote.c.closed()
})

test('the server advertises optional library layout support', () => {
  assert.ok(serverCapabilities().includes('layout'))
})
