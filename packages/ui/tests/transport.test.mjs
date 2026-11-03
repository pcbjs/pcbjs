// The page's one socket to its session, opened once every handler is on: the viewer's hello first, frames sent before it opens kept until it does, requests answered
// by id, events to their handlers after the frame watchers, and every request failing once the socket closes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionSocket, sessionUrl } from '../src/transport.ts'

/** A socket that opens when told to, keeping what the page sent. */
function fakeSocket() {
  const ws = { readyState: 0, sent: [], urls: [], send: t => ws.sent.push(JSON.parse(t)) }
  const open = url => (ws.urls.push(url), ws)
  const recv = m => ws.onmessage({ data: JSON.stringify(m) })
  return { ws, open, recv }
}

test('one socket: the hello first, then what waited for it to open', () => {
  const { ws, open } = fakeSocket()
  const t = sessionSocket('ws://h/__pcbjs/session', open)
  t.notify('session/hover', { board: 'B', hover: null })
  assert.deepEqual(ws.urls, [], 'nothing opens before every handler is on')
  t.open()
  t.open()
  assert.deepEqual(ws.sent, [])
  ws.readyState = 1
  ws.onopen()
  assert.deepEqual(ws.urls, ['ws://h/__pcbjs/session'])
  assert.deepEqual(
    ws.sent.map(m => m.event ?? m.method),
    ['pcbjs:ide:hello', 'session/hover'],
  )
  assert.equal(ws.sent[0].data.role, 'viewer')
  assert.equal(ws.sent[1].id, undefined, 'a notification has no id')
})

test('a request is answered by its id; an event reaches its handlers after the frame watchers; a close fails what waits', async () => {
  const { ws, open, recv } = fakeSocket()
  const t = sessionSocket('ws://h/__pcbjs/session', open)
  t.open()
  ws.readyState = 1
  ws.onopen()
  const order = []
  t.frames(f => order.push(['frame', f.seq]))
  t.on('pcbjs:status', d => order.push(['status', d.phase]))
  const a = t.request('session/observe', { board: 'B', target: null, facets: ['meta'] })
  const b = t.request('session/select', { board: 'B', refs: ['R1'] })
  const [ra, rb] = ws.sent.slice(1)
  recv({ seq: 1, event: 'pcbjs:status', data: { phase: 'idle' } })
  recv({ seq: 2, jsonrpc: '2.0', id: rb.id, error: { code: -32000, message: 'no board B' } })
  recv({ seq: 3, jsonrpc: '2.0', id: ra.id, result: null })
  assert.equal(await a, null)
  await assert.rejects(b, /no board B/)
  assert.deepEqual(order, [
    ['frame', 1],
    ['status', 'idle'],
    ['frame', 2],
    ['frame', 3],
  ])
  const c = t.request('session/resync', { condition: 'seq', board: 'B', target: null, held: {}, timeline: [] })
  let closed = false
  t.closed(() => (closed = true))
  ws.onclose()
  await assert.rejects(c, /the session closed/)
  assert.ok(closed)
})

test('the session socket of the page’s own server', () => {
  assert.equal(sessionUrl({ protocol: 'http:', host: '127.0.0.1:5173' }), 'ws://127.0.0.1:5173/__pcbjs/session')
  assert.equal(sessionUrl({ protocol: 'https:', host: 'x.dev' }), 'wss://x.dev/__pcbjs/session')
})
