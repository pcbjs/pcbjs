import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localRequest } from '../dist/server/access.js'
import { requestMode } from '../dist/session/access.js'
import { ideBridge } from '../dist/server/bridge.js'
import { clientsOf } from '../dist/session/clients.js'
import { MAJOR, PROTOCOL, WRITE } from '@pcbjs/core/protocol'

const request = (headers = {}, address = '127.0.0.1', url = '/') => ({ headers: { host: 'localhost:5173', ...headers }, socket: { remoteAddress: address }, url })

test('local privileges require a direct loopback peer and loopback host', () => {
  assert.equal(localRequest(request()), true)
  assert.equal(localRequest(request({ host: '[::1]:5173' }, '::1')), true)
  assert.equal(localRequest(request({}, '::ffff:127.0.0.1')), true)
  assert.equal(localRequest(request({}, '192.168.1.10')), false)
  assert.equal(localRequest(request({ host: 'dev.example.test' })), false)
  for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'cf-connecting-ip', 'x-real-ip']) {
    assert.equal(localRequest(request({ [header]: '127.0.0.1' })), false, header)
  }
})

test('remote editing requires both explicit all policy and the session token', () => {
  const req = request({ 'x-forwarded-for': '192.168.1.10' })
  assert.equal(requestMode(req, { edit: 'localhost', token: 'secret' }), 'ro')
  assert.equal(requestMode({ ...req, url: '/?token=secret' }, { edit: 'localhost', token: 'secret' }), 'ro')
  assert.equal(requestMode({ ...req, url: '/?token=secret' }, { edit: 'all', token: 'secret' }), 'rw')
  assert.equal(requestMode({ ...req, url: '/?token=wrong' }, { edit: 'all', token: 'secret' }), 'ro')
  assert.equal(requestMode(request({ authorization: 'Bearer secret', host: 'dev.example.test' }), { edit: 'all', token: 'secret' }), 'rw')
  assert.equal(requestMode(request(), { edit: 'none' }), 'ro')
})

test('editor HTTP endpoints reject remote, cross-origin and disabled access before opening files', async () => {
  const bridge = ideBridge({ config: { server: { fs: { allow: [] } } } }, () => '/tmp', {
    canOpen: req => requestMode(req, { edit: 'localhost' }) === 'rw',
    lsp: { keys: () => ['editor'], select: () => assert.fail('must not open editor') },
  })
  for (const path of ['/__pcbjs/open?file=private.ts', '/__open-in-editor?file=private.ts', '/__open-in-editor/nested?file=private.ts']) {
    for (const headers of [{ 'x-forwarded-for': 'remote' }, { host: 'dev.example.test' }, { origin: 'https://other.test' }, { 'sec-fetch-site': 'cross-site' }]) {
      const res = { statusCode: 200, end() {} }
      await bridge.middleware(request(headers, '127.0.0.1', path), res, () => assert.fail('must not reach Vite'))
      assert.equal(res.statusCode, 403)
    }
  }
})

test('server rejects every write method for read-only clients, independently of viewer controls', async () => {
  let called = 0,
    attached = 0
  const methods = Object.fromEntries(
    [...WRITE].map(method => [
      method,
      () => {
        called++
        return null
      },
    ]),
  )
  const frames = []
  const clients = clientsOf({
    info: () => ({ session: 'test', edit: 'localhost' }),
    ready: () => ({ protocol: PROTOCOL, major: MAJOR, version: 'test' }),
    hub: () => null,
    methods: () => methods,
    attach: () => {
      attached++
    },
    log() {},
  })
  const client = clients.add({
    kind: 'tcp',
    loopback: false,
    send: frame => {
      frames.push(JSON.parse(frame))
      return true
    },
    close() {},
  })
  client.receive({ event: 'pcbjs:ide:hello', data: { protocol: PROTOCOL, major: MAJOR, capabilities: [], role: 'viewer', project: '/unconfigured' } })
  assert.equal(attached, 0, 'read-only hello cannot attach another project')
  assert.equal(frames.find(f => f.event === 'pcbjs:ide:ready').data.mode, 'ro')
  for (const [id, method] of [...WRITE].entries()) {
    client.receive({ jsonrpc: '2.0', id, method, params: {} })
    assert.equal(frames.find(f => f.id === id).error.code, -32001, method)
  }
  assert.equal(called, 0)
  clients.close()
})

test('WebSocket and component proxies preserve remote read-only access and explicit token grants', { timeout: 15000 }, async () => {
  const { createServer } = await import('node:http')
  const { default: WebSocket } = await import('ws')
  const { sessionEndpoint, proxySession } = await import('../dist/session/endpoint.js')
  let edit = 'localhost',
    writes = 0
  const clients = clientsOf({
    info: () => ({ session: 'test', edit, token: 'secret' }),
    ready: () => ({ protocol: PROTOCOL, major: MAJOR, version: 'test' }),
    hub: () => null,
    methods: () => ({
      'session/write': () => {
        writes++
        return null
      },
    }),
    log() {},
  })
  const server = createServer(),
    proxy = createServer()
  server.on('upgrade', sessionEndpoint(clients))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  proxy.on('upgrade', (req, socket, head) => proxySession(req, socket, head, base))
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const check = (port, headers, token) =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/__pcbjs/session${token ? '?token=' + token : ''}`, { headers })
      let mode
      socket.on('error', reject)
      socket.on('open', () => socket.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { protocol: PROTOCOL, major: MAJOR, capabilities: [], role: 'viewer' } })))
      socket.on('message', raw => {
        const msg = JSON.parse(raw)
        if (msg.event === 'pcbjs:ide:ready') {
          mode = msg.data.mode
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/write', params: {} }))
        }
        if (msg.id === 1) {
          socket.close()
          resolve({ mode, code: msg.error?.code })
        }
      })
    })
  try {
    for (const port of [server.address().port, proxy.address().port]) {
      assert.deepEqual(await check(port, { 'x-forwarded-for': '192.168.1.2' }), { mode: 'ro', code: -32001 })
      assert.deepEqual(await check(port, { host: 'dev.example.test' }), { mode: 'ro', code: -32001 })
      assert.deepEqual(await check(port, {}), { mode: 'rw', code: undefined })
    }
    assert.equal(writes, 2)
    edit = 'all'
    assert.deepEqual(await check(proxy.address().port, { 'x-forwarded-for': '192.168.1.2' }, 'secret'), { mode: 'rw', code: undefined })
    edit = 'none'
    assert.deepEqual(await check(server.address().port, {}, 'secret'), { mode: 'ro', code: -32001 })
  } finally {
    clients.close()
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => server.close(resolve))])
  }
})
