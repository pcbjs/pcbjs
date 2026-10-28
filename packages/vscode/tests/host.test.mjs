import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { WebSocket } from 'ws'
import { fakeSpawn, sleep, until } from './fake.mjs'

const require = createRequire(import.meta.url)
const { IdeHost } = require('../dist/host.cjs')
const { PcbjsServer } = require('../dist/server.cjs')
const { parseEnvelope, encode, devUrl, viewerUrl, themeName } = require('../dist/protocol.cjs')

/** A mock dev server: dials the host like `pcbjs dev --ide=<url>` would and records what it receives. */
async function dial(url) {
  const ws = new WebSocket(url)
  const received = []
  ws.on('message', raw => received.push(JSON.parse(String(raw))))
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  return {
    ws,
    received,
    events: name => received.filter(m => m.event === name).map(m => m.data),
    send: (event, data) => ws.send(JSON.stringify({ event, data })),
    close: () => new Promise(r => (ws.readyState === WebSocket.CLOSED ? r() : (ws.once('close', r), ws.close()))),
  }
}

function makeHost(extra = {}) {
  const selects = []
  const logs = []
  const host = new IdeHost({
    name: 'vscode-pcbjs',
    version: '9.9.9',
    editor: { select: req => selects.push(req), log: m => logs.push(m) },
    ...extra,
  })
  return { host, selects, logs }
}

const ready = (over = {}) => ({ port: 5301, host: '127.0.0.1', urls: ['http://127.0.0.1:5301/'], root: '/work/p', pid: 1, version: '0.0.1', ...over })

test('envelope parsing and the viewer URL helpers', () => {
  assert.deepEqual(parseEnvelope('{"event":"pcbjs:ide:log","data":{"level":"info","text":"x"}}'), { event: 'pcbjs:ide:log', data: { level: 'info', text: 'x' } })
  assert.deepEqual(parseEnvelope(Buffer.from('{"event":"pcbjs:ide:bye"}')), { event: 'pcbjs:ide:bye', data: undefined })
  for (const bad of ['', 'nope', '[]', 'null', '{"type":"custom","event":""}', '{"data":1}', '{"event":3}']) assert.equal(parseEnvelope(bad), undefined, bad)
  assert.equal(encode('pcbjs:ide:hello', { name: 'n' }), '{"event":"pcbjs:ide:hello","data":{"name":"n"}}')
  assert.equal(devUrl(ready({ urls: ['http://192.168.1.2:5301/', 'http://localhost:5301/'] })), 'http://localhost:5301/')
  assert.equal(devUrl(ready({ urls: [], host: '0.0.0.0' })), 'http://127.0.0.1:5301/')
  assert.equal(viewerUrl('http://127.0.0.1:5301/', 'dark'), 'http://127.0.0.1:5301/?ide=1&theme=dark')
  assert.deepEqual([1, 2, 3, 4].map(themeName), ['light', 'dark', 'hc', 'hc'])
})

test('only the token path is accepted, on 127.0.0.1', async () => {
  const { host } = makeHost()
  const url = await host.listen()
  assert.match(url, /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{20,}$/)
  const base = url.slice(0, url.lastIndexOf('/'))
  for (const wrong of [`${base}/`, `${base}/nope`, `${url}x`, `${url}/`, `${base}/${host.token.slice(1)}`]) {
    await assert.rejects(dial(wrong), /403/, wrong)
  }
  assert.equal(host.clients.size, 0)
  const ok = await dial(`${url}?retry=1`)
  await until(() => ok.received.length)
  assert.equal(host.clients.size, 1)
  await ok.close()
  await host.close()
})

test('hello on connect, select routed to the editor, malformed traffic ignored, bye on close', async () => {
  const { host, selects, logs } = makeHost()
  const c = await dial(await host.listen())
  await until(() => c.events('pcbjs:ide:hello').length)
  assert.equal(c.received[0].event, 'pcbjs:ide:hello')
  assert.deepEqual([c.received[0].data.name, c.received[0].data.version], ['vscode-pcbjs', '9.9.9'])

  c.ws.send('not json')
  c.ws.send(JSON.stringify({ type: 'custom', event: 'pcbjs:ide:select', data: {} }))
  c.send('pcbjs:ide:select', { file: '/work/p/main.tsx', line: 0, col: 1, endLine: 1, endCol: 1 })
  c.send('pcbjs:something:else', { x: 1 })
  const req = { file: '/work/p/main.tsx', line: 12, col: 5, endLine: 14, endCol: 9 }
  c.send('pcbjs:ide:select', req)
  await until(() => selects.length === 1)
  assert.deepEqual(selects[0], req)
  assert.ok(logs.some(l => /malformed select/.test(l)))
  assert.ok(logs.some(l => /malformed ide message/.test(l)))

  await host.close()
  await until(() => c.ws.readyState === WebSocket.CLOSED)
  assert.equal(c.events('pcbjs:ide:bye').length, 1)
})

test('ready and boards update the state of the server that spawned the client', async () => {
  const { spawn, calls } = fakeSpawn()
  let server
  const { host } = makeHost({ target: info => (server.owns(info) ? server : undefined) })
  const url = await host.listen()
  server = new PcbjsServer({
    folders: () => ['/work/p'],
    ideUrl: () => url,
    exists: p => p === '/work/p/node_modules/@pcbjs/pcbjs/bin/pcbjs.js',
    spawn,
  })
  await server.start()
  assert.equal(server.state.kind, 'starting')
  assert.ok(calls[0].args.includes(`--ide=${url}`))
  const whenReady = server.whenReady()

  // The mock dev server dials the URL it was given.
  const c = await dial(calls[0].args.find(a => a.startsWith('--ide=')).slice('--ide='.length))
  c.send('pcbjs:ide:boards', { boards: [{ name: 'Early', title: 'Early', entry: 'main.tsx', targets: [], status: 'ok' }], single: true, errors: [] })
  c.send('pcbjs:ide:ready', ready({ root: '/elsewhere', pid: calls[0].child.pid }))
  assert.equal(await whenReady, 'http://127.0.0.1:5301/')
  assert.equal(server.state.kind, 'running')
  assert.equal(server.boards.boards[0].name, 'Early', 'boards sent before ready reach the server')
  assert.equal(server.client?.root, '/elsewhere')

  const boards = {
    boards: [
      { name: 'Blinky', title: 'Blinky', entry: 'main.tsx', targets: ['jlcpcb'], status: 'ok' },
      { name: 'Coin', title: 'Coin', entry: 'coin.tsx', targets: [], status: 'error' },
    ],
    single: false,
    errors: ['x'],
  }
  c.send('pcbjs:ide:boards', boards)
  await until(() => server.boards?.boards.length === 2)
  assert.deepEqual(server.boards, boards)

  c.send('pcbjs:ide:scopes', { scopes: [{ slug: 'p', root: '/work/p', route: '/', boards: [] }], displayed: null, single: true })
  c.send('pcbjs:ide:scope', { scope: 'p', root: '/work/p', route: '/', url: 'http://127.0.0.1:5301/' })
  await until(() => server.scope?.scope === 'p' && server.scopes?.scopes.length === 1)

  c.send('pcbjs:ide:log', { level: 'warn', text: 'DRC: 1 warning' })
  await until(() => server.logs.some(l => l.level === 'warn' && l.text === 'DRC: 1 warning'))

  c.send('pcbjs:ide:ready', ready({ root: '/elsewhere', pid: calls[0].child.pid, port: 5302, urls: ['http://127.0.0.1:5302/'] }))
  await until(() => server.url === 'http://127.0.0.1:5302/')

  assert.ok(server.send('pcbjs:ide:focus', { file: '/work/p/main.tsx' }))
  await until(() => c.events('pcbjs:ide:focus').length)
  assert.deepEqual(c.events('pcbjs:ide:focus')[0], { file: '/work/p/main.tsx' })

  assert.ok(server.send('pcbjs:ide:close', { file: '/work/p/lib/Part.tsx' }))
  await until(() => c.events('pcbjs:ide:close').length)
  assert.deepEqual(c.events('pcbjs:ide:close')[0], { file: '/work/p/lib/Part.tsx' })

  await server.stop()
  await c.close()
  await host.close()
})

test('a client that drops and dials again is picked up, and routing prefers the deepest root', async () => {
  const { spawn, calls } = fakeSpawn()
  let server
  let connects = 0
  const { host } = makeHost({ target: info => (server.owns(info) ? server : undefined), onConnect: () => connects++ })
  const url = await host.listen()
  server = new PcbjsServer({
    folders: () => ['/work/p'],
    ideUrl: () => url,
    exists: () => true,
    spawn,
  })
  await server.start()
  const pid = calls[0].child.pid

  let c = await dial(url)
  c.send('pcbjs:ide:ready', ready({ root: '/work/p', pid }))
  await until(() => server.state.kind === 'running' && server.client)
  c.ws.terminate()
  await until(() => !server.client)
  assert.equal(server.state.kind, 'running', 'the child still runs, so the state stays running while it reconnects')
  assert.equal(host.route('/work/p/main.tsx'), undefined)

  c = await dial(url)
  await until(() => c.events('pcbjs:ide:hello').length === 1)
  c.send('pcbjs:ide:ready', ready({ root: '/work/p', pid }))
  await until(() => server.client)
  assert.equal(host.route('/work/p/main.tsx'), server.client)
  assert.equal(connects, 4, 'onConnect after hello and after the first ready, for each connection')

  const other = await dial(url)
  other.send('pcbjs:ide:ready', ready({ root: '/work/p/nested', pid: 99 }))
  await until(() => [...host.clients].some(k => k.root === '/work/p/nested'))
  assert.equal(host.route('/work/p/nested/a.tsx').root, '/work/p/nested')
  assert.equal(host.route('/work/p/main.tsx').root, '/work/p')
  assert.equal(host.route('/work/pq/main.tsx'), undefined)
  // a workspace server routes the files of every folder it was given
  const ws = await dial(url)
  ws.send('pcbjs:ide:ready', ready({ root: '/work/w1', folders: ['/work/w1', '/work/w2'], pid: 98 }))
  await until(() => [...host.clients].some(k => k.root === '/work/w1'))
  assert.equal(host.route('/work/w2/x/pcb.tsx').root, '/work/w1')
  await ws.close()
  assert.equal(server.client.root, '/work/p', 'a ready for another root does not steal the server')

  await server.stop()
  await other.close()
  await c.close()
  await host.close()
  await sleep(10)
})
