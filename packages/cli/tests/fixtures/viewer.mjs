// A viewer page as the session sees one: a client of /__pcbjs/session with a viewer's hello, its requests answered by id, and every
// event it got as `{ event, seq, ...data }`.
import WebSocket from 'ws'
import { MAJOR, PROTOCOL } from '@pcbjs/core/protocol'

/** A viewer of the session on `port`; with `board` it observes that board's `facets` at once. */
export async function viewerClient(port, { board, facets = ['meta', 'layers', 'findings'], ...more } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/__pcbjs/session`)
  await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)))
  const got = []
  const listeners = []
  const waits = new Map()
  let id = 0
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.event) got.push({ event: m.event, seq: m.seq, ...m.data })
    if (m.event) for (const fn of listeners) fn(m.event, m.data)
    const w = m.id !== undefined && waits.get(m.id)
    if (!w) return
    waits.delete(m.id)
    if (m.error) w.fail(Object.assign(new Error(m.error.message), { code: m.error.code }))
    else w.ok(m.result)
  })
  ws.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'test viewer', version: '0', protocol: PROTOCOL, major: MAJOR, capabilities: [], role: 'viewer' } }))
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(++id, { ok, fail })
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  const notify = (method, params) => ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  const observe = (b, f = facets, extra = {}) => request('session/observe', { board: b, target: null, facets: f, ...extra })
  /** The first event named `event` from `from` on that `pred` accepts, waited for up to `ms`; null when none came. */
  const next = async (event, { from = 0, pred = () => true, ms = 30000 } = {}) => {
    const end = Date.now() + ms
    for (;;) {
      const e = got.slice(from).find(x => x.event === event && pred(x))
      if (e) return e
      if (Date.now() > end) return null
      await new Promise(r => setTimeout(r, 20))
    }
  }
  if (board !== undefined) await observe(board, facets, more)
  /** `fn(event, data)` for every event from now on, as it comes */
  const on = fn => listeners.push(fn)
  return { ws, got, request, notify, observe, next, on, close: () => ws.close() }
}
