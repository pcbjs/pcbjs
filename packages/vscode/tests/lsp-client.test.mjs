import { resolve as fixturePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// The language client side against a mock language server: a mock session answers the link's hello and JSON-RPC on the same
// socket. The client is a vscode-jsonrpc connection over the extension's transports, standing in for
// vscode-languageclient, with a fake editor: the handshake options, the focus, a segment edit round trip, the
// preview following pcbjs/preview and a selection from the viewer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createMessageConnection, AbstractMessageReader, AbstractMessageWriter } from 'vscode-jsonrpc'
import { PROTOCOL } from '@pcbjs/core/protocol'
import { mockSession, sleep, until } from './fake.mjs'

const require = createRequire(import.meta.url)
const { SessionLink } = require('../dist/link.cjs')
const { Sync } = require('../dist/sync.cjs')
const { PcbjsSession, transports, initializationOptions } = require('../dist/lsp-client.cjs')

const FILE = fixturePath('/work/p/pcb.tsx')
const URI = pathToFileURL(FILE).href
const TEXT = `route(a, b, 'V 14 Z')\n<J1 at="3 7" />\n`

/** The mock session: says ready on hello and runs a JSON-RPC server on the same socket, one message per line. */
async function mockServer() {
  let cb
  const events = []
  const s = await mockSession(
    {
      port: 5273,
      host: '127.0.0.1',
      urls: ['http://127.0.0.1:5273/'],
      root: fixturePath('/work/p'),
      pid: 7,
      version: '0.1.0',
      protocol: 2,
      major: 1,
      capabilities: ['bye', 'lsp'],
      session: 'mock0001',
    },
    m => (m.jsonrpc ? cb?.(m) : events.push(m)),
  )
  const reader = new (class extends AbstractMessageReader {
    listen(c) {
      cb = c
      return { dispose() {} }
    }
  })()
  const writer = new (class extends AbstractMessageWriter {
    async write(m) {
      s.send(m)
    }
    end() {}
  })()
  const conn = createMessageConnection(reader, writer)
  const seen = { init: null, focus: [] }
  conn.onRequest('initialize', p => {
    seen.init = p
    return { capabilities: { experimental: { pcbjs: { protocol: 2, major: 1, capabilities: [], methods: [], version: '0.1.0' } } } }
  })
  conn.onNotification('pcbjs/focus', p => seen.focus.push(p))
  // the segments of TEXT: the V command of the path, with one presentation and an answer for a typed value
  conn.onRequest('pcbjs/segments', p => {
    const range = { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } }
    const seg = {
      range,
      kind: 'pathCommand',
      value: 'V 14',
      label: 'route path, command 1',
      constraints: { grammar: 'route', index: 0 },
      widget: { input: 'text', typed: true },
      presentations: [{ label: 'H 14', edit: { range, newText: 'H 14' } }],
    }
    if (typeof p.value === 'string')
      return p.value.startsWith('C') ? [{ ...seg, presentations: [], error: 'a curve' }] : [{ ...seg, presentations: [{ label: p.value, edit: { range, newText: p.value } }] }]
    return [seg]
  })
  conn.listen()
  return { session: s, conn, seen, events, close: () => s.close() }
}

/** A fake editor: one document, edits applied to its text. */
function fakeEditor() {
  const ed = { text: TEXT, selects: [], previews: [] }
  ed.port = {
    select: p => ed.selects.push(p),
    preview: (url, scope) => ed.previews.push({ url, scope }),
    applyEdit: async (uri, edits) => {
      assert.equal(uri, URI)
      const lines = ed.text.split('\n')
      const off = p => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
      for (const e of [...edits].sort((a, b) => off(b.range.start) - off(a.range.start)))
        ed.text = ed.text.slice(0, off(e.range.start)) + e.newText + ed.text.slice(off(e.range.end))
      return true
    },
    uri: file => pathToFileURL(file).href,
  }
  return ed
}

async function setup() {
  const server = await mockServer()
  const client = await SessionLink.connect(server.session.dev, { name: 'vscode-pcbjs', version: '0.4.0' })
  const conn = createMessageConnection(...Object.values(transports(client)))
  conn.listen()
  const ed = fakeEditor()
  const session = new PcbjsSession(conn, ed.port)
  return {
    server,
    client,
    conn,
    ed,
    session,
    close: async () => {
      conn.dispose()
      client.close()
      await server.close()
    },
  }
}

test('handshake: the client states its protocol, major and capabilities', async () => {
  const t = await setup()
  try {
    const res = await t.conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') })
    assert.deepEqual(t.server.seen.init.initializationOptions, {
      pcbjs: { protocol: PROTOCOL, major: 1, capabilities: ['tokens'], name: 'vscode-pcbjs', version: '0.4.0' },
    })
    assert.equal(res.capabilities.experimental.pcbjs.protocol, 2)
    // JSON-RPC frames never reach the envelope handlers, and envelopes still work beside them
    assert.equal(t.client.info.root, fixturePath('/work/p'))
  } finally {
    await t.close()
  }
})

test('focus: the active file and the cursor go as pcbjs/focus', async () => {
  const t = await setup()
  try {
    await t.conn.sendRequest('initialize', { processId: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') })
    const sync = new Sync({ frameMs: 10, route: () => ({ root: fixturePath('/work/p'), focus: at => (void t.session.focus(at), true) }) })
    // the first move at once, the last of the frame after it
    sync.cursor(FILE, 2, 5)
    sync.cursor(FILE, 2, 6)
    await until(() => t.server.seen.focus.length >= 2)
    assert.deepEqual(
      t.server.seen.focus.map(f => f.position),
      [
        { line: 1, character: 4 },
        { line: 1, character: 5 },
      ],
    )
    assert.deepEqual(t.server.seen.focus.at(-1).textDocument, { uri: URI })
    assert.ok(sync.focus(FILE))
    await until(() => t.server.seen.focus.length >= 3)
    // a focus carries the last cursor in that file
    assert.deepEqual(t.server.seen.focus.at(-1).position, { line: 1, character: 5 })
    // leaving the design files: the file's start, which no range holds
    assert.ok(sync.leave())
    await until(() => t.server.seen.focus.length >= 4)
    const zero = { line: 0, character: 0 }
    assert.deepEqual(t.server.seen.focus.at(-1), { textDocument: { uri: URI }, position: zero, selections: [{ start: zero, end: zero }] })
    // every selection of the editor goes, the primary first
    const two = [
      { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } },
      { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    ]
    sync.cursor(FILE, 2, 3, two)
    await until(() => t.server.seen.focus.length >= 5)
    assert.deepEqual(t.server.seen.focus.at(-1).selections, two)
    sync.dispose()
  } finally {
    await t.close()
  }
})

test('segment edit round trip: a presentation and a typed value applied through the editor', async () => {
  const t = await setup()
  try {
    await t.conn.sendRequest('initialize', { processId: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') })
    const seg = await t.session.segmentAt(URI, { line: 0, character: 14 })
    assert.equal(seg.kind, 'pathCommand')
    assert.ok(await t.session.apply(URI, seg.presentations[0]))
    assert.equal(t.ed.text.split('\n')[0], "route(a, b, 'H 14 Z')")
    const typed = await t.session.typed(URI, seg.range.start, 'V 20')
    await t.session.apply(URI, typed.presentations[0])
    assert.equal(t.ed.text.split('\n')[0], "route(a, b, 'V 20 Z')")
    const bad = await t.session.typed(URI, seg.range.start, 'C 1 2')
    assert.equal(bad.error, 'a curve')
    assert.equal((await t.session.segments(URI)).length, 1)
  } finally {
    await t.close()
  }
})

test('the preview follows pcbjs/preview and a session selection arrives as pcbjs/select with its ranges', async () => {
  const t = await setup()
  try {
    await t.conn.sendRequest('initialize', { processId: null, capabilities: {}, initializationOptions: initializationOptions('0.4.0') })
    await t.server.conn.sendNotification('pcbjs/preview', { url: 'http://127.0.0.1:5273/alpha/', scope: 'alpha' })
    const p = {
      items: [
        {
          uri: URI,
          ranges: [
            { start: { line: 1, character: 0 }, end: { line: 1, character: 15 } },
            { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          ],
        },
      ],
      primary: { uri: URI, index: 1 },
      reveal: false,
    }
    await t.server.conn.sendNotification('pcbjs/select', p)
    await t.server.conn.sendNotification('pcbjs/select', { uri: URI, range: p.items[0].ranges[0] })
    await until(() => t.ed.previews.length && t.ed.selects.length)
    assert.deepEqual(t.ed.previews, [{ url: 'http://127.0.0.1:5273/alpha/', scope: 'alpha' }])
    await sleep(30)
    assert.deepEqual(t.ed.selects, [p], 'the one-range form of protocol 2 is ignored')
    // malformed notifications are ignored
    await t.server.conn.sendNotification('pcbjs/preview', { nope: 1 })
    await sleep(30)
    assert.equal(t.ed.previews.length, 1)
  } finally {
    await t.close()
  }
})

test('a closed connection closes the client transport', async () => {
  const t = await setup()
  let closed = false
  t.conn.onClose(() => (closed = true))
  t.server.session.drop()
  await until(() => closed)
  await t.close()
})

/** A session whose language server answers one `mm` hint per number of each document opened on it since its last initialize, and nothing for others. */
async function hintSession(id, root) {
  const docs = new Map()
  const opened = []
  const s = await mockSession(
    { port: 5273, host: '127.0.0.1', urls: ['http://127.0.0.1:5273/'], root, pid: 7, version: '0.1.0', protocol: 2, major: 1, capabilities: ['bye', 'lsp'], session: id },
    (m, send) => {
      if (m.method === 'initialize') docs.clear()
      if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { capabilities: { inlayHintProvider: true } } })
      if (m.method === 'session/stop') send({ jsonrpc: '2.0', id: m.id, result: null })
      if (m.method === 'textDocument/didOpen') {
        docs.set(m.params.textDocument.uri, m.params.textDocument.text)
        opened.push(m.params.textDocument.uri)
      }
      if (m.method === 'textDocument/inlayHint') {
        const text = docs.get(m.params.textDocument.uri) ?? ''
        send({ jsonrpc: '2.0', id: m.id, result: [...text.matchAll(/\d+/g)].map(n => ({ position: { line: 0, character: n.index + n[0].length }, label: 'mm' })) })
      }
    },
  )
  return { ...s, dev: { ...s.dev, session: id }, opened }
}

test('several sessions attached, through restarts and reattaches: one hint per number, from the session that serves the file', async () => {
  const { PcbjsServer } = require('../dist/server.cjs')
  const { ownedMiddleware } = require('../dist/lsp-client.cjs')
  const ROOT = fixturePath('/work/w')
  const WORKTREE = fixturePath(ROOT, '.claude/worktrees/a')
  const EXAMPLE = fixturePath(ROOT, 'examples/x')
  const sessions = [await hintSession('own00001', ROOT), await hintSession('wt000001', WORKTREE), await hintSession('ex000001', EXAMPLE)]
  const live = new Map(sessions.map(s => [s.dev.root, s.dev]))
  /** the extension's language clients: one per link, disposed when its link closes */
  const clients = new Set()
  const server = new PcbjsServer({
    folders: () => [ROOT],
    candidates: () => [WORKTREE, EXAMPLE],
    devInfo: root => live.get(root),
    onLink: link => {
      const conn = createMessageConnection(transports(link).reader, transports(link).writer)
      conn.listen()
      const client = { conn, link, mw: ownedMiddleware(uri => server.owner(fileURLToPath(uri))?.link === link) }
      clients.add(client)
      link.onClose(() => (clients.delete(client), conn.dispose()))
      void conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {} })
    },
  })
  const doc = file => ({ uri: { toString: () => pathToFileURL(file).href } })
  const files = [fixturePath(ROOT, 'pcb.tsx'), fixturePath(WORKTREE, 'pcb.tsx'), fixturePath(EXAMPLE, 'pcb.tsx')]
  const TEXT = `route('3 10')`
  /** every client opens the files and answers an inlay hint request through its middleware, as vscode-languageclient calls it */
  const hints = async (gated = true) => {
    const out = new Map(files.map(f => [f, 0]))
    for (const c of clients) {
      const open = d => c.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: d.uri.toString(), languageId: 'typescriptreact', version: 1, text: TEXT } })
      const ask = d =>
        c.conn.sendRequest('textDocument/inlayHint', { textDocument: { uri: d.uri.toString() }, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } })
      for (const f of files) {
        await (gated ? c.mw.didOpen(doc(f), open) : open(doc(f)))
        const got = (await (gated ? c.mw.provideInlayHints(doc(f), {}, {}, ask) : ask(doc(f)))) ?? []
        out.set(f, out.get(f) + got.length)
      }
    }
    return [...out.values()]
  }
  try {
    await server.start()
    await until(() => clients.size === 3)
    assert.deepEqual(await hints(false), [6, 6, 6], 'ungated, each of the three sessions answers every file: the repeated hints')
    for (const s of sessions) s.opened.length = 0
    for (let round = 0; round < 3; round++) {
      await server.restartServer()
      await until(() => server.state.kind === 'running' && clients.size === 3)
      assert.deepEqual(await hints(), [2, 2, 2], `round ${round}: one hint per number after restarting the session`)
      await server.stop()
      assert.equal(clients.size, 0, 'a detach disposes every client')
      await server.start()
      await until(() => clients.size === 3)
      assert.deepEqual(await hints(), [2, 2, 2], `round ${round}: one hint per number after attaching again`)
      assert.equal(new Set([...clients].map(c => c.link)).size, server.links.length, 'one client per link')
    }
    for (const [i, s] of sessions.entries()) assert.deepEqual([...new Set(s.opened)], [pathToFileURL(files[i]).href], 'each session is sent only the files it serves')
  } finally {
    await server.stop()
    for (const s of sessions) await s.close()
  }
})

test('the session serving a file closes while another covers it: the file moves to the remaining one, which answers its hints', async () => {
  const { PcbjsServer } = require('../dist/server.cjs')
  const { ownedMiddleware, Holders } = require('../dist/lsp-client.cjs')
  const ROOT = fixturePath('/work/w')
  const EXAMPLE = fixturePath(ROOT, 'examples/x')
  const own = await hintSession('own00001', ROOT)
  const inner = await hintSession('ex000001', EXAMPLE)
  const live = new Map([own, inner].map(s => [s.dev.root, s.dev]))
  const holders = new Holders()
  /** the extension's language clients by link, as `links` holds them */
  const clients = new Map()
  const owner = uri => {
    const c = clients.get(server.owner(fileURLToPath(uri))?.link)
    return c?.peer
  }
  const server = new PcbjsServer({
    folders: () => [ROOT],
    candidates: () => [...live.keys()].filter(r => r !== ROOT),
    devInfo: root => live.get(root),
    onLink: link => {
      const conn = createMessageConnection(transports(link).reader, transports(link).writer)
      conn.listen()
      const peer = { alive: () => clients.has(link), notify: (m, p) => void conn.sendNotification(m, p) }
      const client = { conn, peer, mw: ownedMiddleware(uri => server.owner(fileURLToPath(uri))?.link === link, { holders, peer }) }
      clients.set(link, client)
      link.onClose(() => {
        clients.delete(link)
        conn.dispose()
        holders.move(docs, owner)
      })
      void conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {} })
    },
  })
  const FILE = fixturePath(EXAMPLE, 'pcb.tsx')
  const docs = [{ uri: pathToFileURL(FILE).href, languageId: 'typescriptreact', version: 1, text: `route('3 10')` }]
  const doc = { uri: { toString: () => docs[0].uri } }
  const ask = c => () =>
    c.conn.sendRequest('textDocument/inlayHint', { textDocument: { uri: docs[0].uri }, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } })
  /** the hints of the file per session, each client asked through its middleware */
  const hints = async () => {
    const out = {}
    for (const [link, c] of clients) out[link.session] = ((await c.mw.provideInlayHints(doc, {}, {}, ask(c))) ?? []).length
    return out
  }
  try {
    await server.start()
    await until(() => clients.size === 2)
    for (const c of clients.values()) await c.mw.didOpen(doc, d => c.conn.sendNotification('textDocument/didOpen', { textDocument: docs[0] }))
    await until(() => inner.opened.length === 1)
    assert.deepEqual(await hints(), { own00001: 0, ex000001: 2 }, 'the deepest session serves the file')
    assert.deepEqual(own.opened, [], 'the outer session was never sent it')
    live.delete(EXAMPLE)
    inner.send({ event: 'pcbjs:ide:bye', data: { reason: 'session stop' } })
    await inner.close()
    await until(() => clients.size === 1 && own.opened.length === 1)
    assert.deepEqual(own.opened, [docs[0].uri], 'the remaining session was sent the document')
    assert.deepEqual(await hints(), { own00001: 2 }, 'the hints come from the remaining session, without reopening the file')
  } finally {
    await server.stop()
    await own.close()
    await inner.close()
  }
})
