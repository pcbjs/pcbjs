// One TypeScript program per session: three connections holding the store's text of usb3-hub cost about what one does, and the hold's
// type check asks that program.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { lspHub } from '../dist/session/lsp.js'

setFlagsFromString('--expose_gc')
const gc = runInNewContext('gc')
const FILE = fileURLToPath(new URL('../../../examples/usb3-hub/pcb.tsx', import.meta.url))
const TEXT = readFileSync(FILE, 'utf8')
const URI = pathToFileURL(FILE).href

/** A connection on the hub: requests answered by id, notifications sent as they are. */
function client(hub, key) {
  let id = 0
  const waits = new Map()
  const send = m => {
    if (m.id !== undefined && !m.method) waits.get(m.id)?.(m.result)
  }
  const request = (method, params) =>
    new Promise(res => {
      const n = `${key}-${++id}`
      waits.set(n, res)
      hub.message(key, { jsonrpc: '2.0', id: n, method, params }, send)
    })
  const notify = (method, params) => hub.message(key, { jsonrpc: '2.0', method, params }, send)
  return { request, notify }
}

async function attach(hub, key) {
  const c = client(hub, key)
  await c.request('initialize', { processId: null, rootUri: null, capabilities: {} })
  c.notify('initialized', {})
  c.notify('textDocument/didOpen', { textDocument: { uri: URI, languageId: 'typescriptreact', version: 1, text: TEXT } })
  const o = TEXT.indexOf('ESS[1], ESS[10]')
  const line = TEXT.slice(0, o).split('\n').length - 1
  await c.request('textDocument/hover', { textDocument: { uri: URI }, position: { line, character: o - TEXT.lastIndexOf('\n', o - 1) - 1 } })
  return c
}

const heap = () => {
  gc()
  gc()
  return process.memoryUsage().heapUsed
}

test('three connections on the store text hold one program: the heap grows by about one', async () => {
  const hub = lspHub({ version: '0.0.0', source: { boards: () => [] } })
  const h0 = heap()
  await attach(hub, 'a')
  const one = heap() - h0
  await attach(hub, 'b')
  await attach(hub, 'c')
  const three = heap() - h0
  hub.dispose()
  console.log(`heap: one connection +${(one / 1e6).toFixed(0)} MB, three +${(three / 1e6).toFixed(0)} MB`)
  assert.ok(one > 30e6, `the program was built: +${(one / 1e6).toFixed(0)} MB`)
  assert.ok(three < one * 1.4, `three connections +${(three / 1e6).toFixed(0)} MB against one +${(one / 1e6).toFixed(0)} MB`)
})

test("the hold's type check asks the session's program for the store's text, and no program for another", async () => {
  const hub = lspHub({ version: '0.0.0', source: { boards: () => [] } })
  await attach(hub, 'a')
  const bad = TEXT.replace('const drop = (', 'const drop: number = (')
  const c = client(hub, 'a')
  c.notify('textDocument/didChange', { textDocument: { uri: URI, version: 2 }, contentChanges: [{ text: bad }] })
  await hub.flush('a')
  const at = bad.indexOf('drop: number')
  assert.equal(hub.typeError(FILE, bad, at - 20, at + 200), at)
  assert.equal(hub.typeError(FILE, TEXT, 0, TEXT.length), null, 'a text no program reads')
  hub.dispose()
})
