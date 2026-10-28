// The hosted IDE mode: the dev server dials an editor host. A mock host here stands in for the VS Code extension.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { connectHost, parseIdeUrl, redactUrl } from '../dist/host-client.js'

/** A host on a free loopback port that records every frame and hands out the sockets of the dev servers that dial it. */
async function mockHost() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(wss, 'listening')
  const frames = []
  const waiters = []
  const sockets = []
  wss.on('connection', ws => {
    sockets.push(ws)
    ws.on('message', raw => {
      const f = JSON.parse(raw.toString())
      frames.push(f)
      for (const w of [...waiters])
        if (w.match(f)) {
          waiters.splice(waiters.indexOf(w), 1)
          w.done(f)
        }
    })
  })
  return {
    url: `ws://127.0.0.1:${wss.address().port}/tok3n`,
    frames,
    sockets,
    wss,
    /** the next frame of this event, or one already received after `from` */
    next(event, from = 0) {
      const had = frames.slice(from).find(f => f.event === event)
      if (had) return Promise.resolve(had)
      return new Promise((done, fail) => {
        const t = setTimeout(() => fail(new Error(`no ${event} within 3 s`)), 3000)
        waiters.push({
          match: f => f.event === event,
          done: f => {
            clearTimeout(t)
            done(f)
          },
        })
      })
    },
    connection: () => once(wss, 'connection').then(([ws]) => ws),
    close: () =>
      new Promise(done => {
        for (const s of wss.clients) s.terminate()
        wss.close(() => done())
      }),
  }
}

const ready = { port: 5219, host: 'localhost', urls: ['http://localhost:5219/'], root: '/p', pid: 1, version: '0.0.1' }

test('host client: --ide takes ws or wss on loopback, a remote host only with the flag', () => {
  assert.equal(parseIdeUrl('ws://127.0.0.1:5220/abc').pathname, '/abc')
  assert.equal(parseIdeUrl('wss://localhost:5220/abc').protocol, 'wss:')
  assert.throws(() => parseIdeUrl('http://127.0.0.1:5220/abc'), /ws:\/\/ or wss:\/\//)
  assert.throws(() => parseIdeUrl('not a url'), /WebSocket URL/)
  assert.throws(() => parseIdeUrl('ws://192.168.1.4:5220/abc'), /--ide-allow-remote/)
  assert.throws(() => parseIdeUrl('ws://example.com/abc'), /--ide-allow-remote/)
  assert.equal(parseIdeUrl('ws://192.168.1.4:5220/abc', true).hostname, '192.168.1.4')
  assert.equal(redactUrl('ws://127.0.0.1:5220/secret-token'), 'ws://127.0.0.1:5220')
})

test('host client: sends ready on connect and again, with the last boards, after a drop', async () => {
  const host = await mockHost()
  const client = connectHost({ url: host.url, minDelay: 50, maxDelay: 200 })
  try {
    // ready is known before the socket opens, as when the dev server listens first
    client.send('pcbjs:ide:ready', ready)
    const first = await host.next('pcbjs:ide:ready')
    assert.deepEqual(first.data, ready)
    const boards = { boards: [{ name: 'Blinky', title: 'Blinky', entry: 'main.tsx', targets: [], status: 'ok' }], single: true, errors: { 'main.tsx': null } }
    assert.equal(client.send('pcbjs:ide:boards', boards), true)
    await host.next('pcbjs:ide:boards')
    // the host drops the socket: the client dials again and repeats ready and boards, in that order
    const mark = host.frames.length
    const again = host.connection()
    host.sockets[0].terminate()
    await again
    const r2 = await host.next('pcbjs:ide:ready', mark)
    const b2 = await host.next('pcbjs:ide:boards', mark)
    assert.deepEqual(r2.data, ready)
    assert.deepEqual(b2.data, boards)
    assert.ok(host.frames.indexOf(r2) < host.frames.indexOf(b2))
  } finally {
    client.close()
    await host.close()
  }
})

test('host client: keeps dialling a host that is not up yet', async () => {
  // a port that is free now; the host starts there later
  const probe = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(d => probe.close(d))
  const statuses = []
  const client = connectHost({ url: `ws://127.0.0.1:${port}/t`, minDelay: 30, maxDelay: 60, onStatus: s => statuses.push(s) })
  client.send('pcbjs:ide:ready', ready)
  try {
    await new Promise(d => setTimeout(d, 150))
    assert.equal(client.connected(), false)
    assert.deepEqual(statuses, ['unreachable'], 'one note for a run of failed attempts')
    const late = new WebSocketServer({ host: '127.0.0.1', port })
    const [ws] = await once(late, 'connection')
    const [raw] = await once(ws, 'message')
    assert.equal(JSON.parse(raw.toString()).event, 'pcbjs:ide:ready')
    assert.equal(client.connected(), true)
    client.close()
    await new Promise(d => {
      for (const s of late.clients) s.terminate()
      late.close(d)
    })
  } finally {
    client.close()
  }
})

test('host client: hello, cursor, focus and close reach the callbacks; select goes to the host', async () => {
  const host = await mockHost()
  const got = []
  const client = connectHost({
    url: host.url,
    onHello: h => got.push(['hello', h]),
    onCursor: c => got.push(['cursor', c]),
    onFocus: f => got.push(['focus', f]),
    onClose: f => got.push(['close', f]),
    onBye: () => got.push(['bye']),
  })
  try {
    const ws = await host.connection()
    const send = (event, data) => ws.send(JSON.stringify({ event, data }))
    send('pcbjs:ide:hello', { name: 'vscode-pcbjs', version: '0.2.0' })
    send('pcbjs:ide:cursor', { file: '/p/main.tsx', line: 25, col: 10 })
    ws.send('not json')
    send('pcbjs:ide:cursor', { line: 1 }) // no file: dropped
    send('pcbjs:ide:focus', { file: '/p/lib/MyGroup.tsx' })
    send('pcbjs:ide:close', { file: '/p/scratch.tsx' })
    send('pcbjs:ide:close', {}) // no file: dropped
    send('pcbjs:ide:unknown', {})
    send('pcbjs:ide:bye', {})
    await new Promise(d => setTimeout(d, 100))
    assert.deepEqual(got, [
      ['hello', { name: 'vscode-pcbjs', version: '0.2.0', protocol: 1, major: 1, capabilities: null }],
      ['cursor', { file: '/p/main.tsx', line: 25, col: 10 }],
      ['focus', { file: '/p/lib/MyGroup.tsx' }],
      ['close', { file: '/p/scratch.tsx' }],
      ['bye'],
    ])
    assert.equal(client.hello(), null, 'bye forgets the hello')
    const sel = { file: '/p/main.tsx', line: 25, col: 5, endLine: 25, endCol: 120 }
    assert.equal(client.send('pcbjs:ide:select', sel), true)
    assert.deepEqual((await host.next('pcbjs:ide:select')).data, sel)
    // nothing sticky about a select: a reconnect does not repeat it
    const mark = host.frames.length
    const again = host.connection()
    ws.terminate()
    await again
    await new Promise(d => setTimeout(d, 100))
    assert.equal(
      host.frames.slice(mark).some(f => f.event === 'pcbjs:ide:select'),
      false,
    )
  } finally {
    client.close()
    await host.close()
  }
})

test('host client: send while disconnected is dropped and reported, close stops the dialling', async () => {
  const host = await mockHost()
  const client = connectHost({ url: host.url, minDelay: 20, maxDelay: 40 })
  await host.connection()
  client.close()
  assert.equal(client.connected(), false)
  assert.equal(client.send('pcbjs:ide:log', { level: 'info', text: 'x' }), false)
  let dialled = false
  host.wss.on('connection', () => {
    dialled = true
  })
  await new Promise(d => setTimeout(d, 150))
  assert.equal(dialled, false)
  await host.close()
})

test('JSON-RPC frames ride the same socket: onRpc takes them, sendRpc sends them unremembered', async () => {
  const host = await mockHost()
  const rpc = []
  const conn = host.connection()
  const c = connectHost({ url: host.url, onRpc: m => rpc.push(m) })
  try {
    const ws = await conn
    while (!c.connected()) await new Promise(r => setTimeout(r, 5))
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    while (!rpc.length) await new Promise(r => setTimeout(r, 5))
    assert.deepEqual(rpc, [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }])
    assert.equal(c.sendRpc({ jsonrpc: '2.0', id: 1, result: {} }), true)
    while (!host.frames.some(f => f.jsonrpc)) await new Promise(r => setTimeout(r, 5))
    assert.deepEqual(
      host.frames.find(f => f.jsonrpc),
      { jsonrpc: '2.0', id: 1, result: {} },
    )
  } finally {
    c.close()
    await host.close()
  }
  assert.equal(c.sendRpc({ jsonrpc: '2.0', method: 'x' }), false)
})
