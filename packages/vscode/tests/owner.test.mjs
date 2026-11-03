// Which session owns a file, and the wiring the extension runs over two attached sessions: the document handoff, the cursor sync and
// requests about a file go to the deepest session, and move to the one that covers the file when it closes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mockSession, until } from './fake.mjs'

const require = createRequire(import.meta.url)
const { ownerOf } = require('../dist/owner.cjs')
const { Wiring } = require('../dist/wiring.cjs')
const { PROTOCOL, MAJOR } = require('@pcbjs/core/protocol')

const ROOT = '/work/w'
const EXAMPLE = `${ROOT}/examples/x`

test('ownerOf: the deepest root holding the file, a root itself included, nothing outside the folders', () => {
  const outer = { name: 'outer', roots: [ROOT, `${ROOT}/lib`] }
  const inner = { name: 'inner', roots: [EXAMPLE] }
  const of = (file, links = [outer, inner]) => ownerOf(file, [ROOT], links)
  assert.deepEqual(of(`${EXAMPLE}/pcb.tsx`), { link: inner, root: EXAMPLE })
  assert.deepEqual(of(`${ROOT}/pcb.tsx`), { link: outer, root: ROOT })
  assert.deepEqual(of(`${ROOT}/lib/part.tsx`), { link: outer, root: `${ROOT}/lib` })
  assert.deepEqual(of(EXAMPLE), { link: inner, root: EXAMPLE }, 'a project root is its own')
  assert.deepEqual(of(`${ROOT}/examples/xy/pcb.tsx`), { link: outer, root: ROOT }, 'a sibling with a common prefix is not inside')
  assert.equal(of('/elsewhere/pcb.tsx'), undefined)
  assert.equal(of(`${EXAMPLE}/pcb.tsx`, []), undefined)
  assert.equal(ownerOf(`${EXAMPLE}/pcb.tsx`, [], [inner]), undefined, 'no folder, no owner')
})

/** A session at `root` that offers a language server and answers every request with its own id. */
async function session(id, root) {
  const ready = {
    port: 5301,
    host: '127.0.0.1',
    urls: ['http://127.0.0.1:5301/'],
    root,
    pid: process.pid,
    version: '0.0.1',
    protocol: PROTOCOL,
    major: MAJOR,
    capabilities: ['lsp'],
    session: id,
    mode: 'rw',
    projects: [],
  }
  const s = await mockSession(ready, (m, send) => {
    if (typeof m.id === 'string' && m.method) send({ jsonrpc: '2.0', id: m.id, result: { session: id } })
  })
  return { ...s, dev: { ...s.dev, session: id, root } }
}

test('two sessions attached: the deeper one owns its files until it closes, then the one that covers them takes them over', async () => {
  const outer = await session('own00001', ROOT)
  const inner = await session('ex000001', EXAMPLE)
  const live = new Map([outer, inner].map(s => [s.dev.root, s.dev]))
  const FILE = `${EXAMPLE}/pcb.tsx`
  const TOP = `${ROOT}/pcb.tsx`
  const docs = [FILE, TOP].map(f => ({ uri: pathToFileURL(f).href, languageId: 'typescriptreact', version: 1, text: '' }))
  /** what each session's language client was sent: the document handoff and the cursor */
  const sent = []
  const w = new Wiring({
    folders: () => [ROOT],
    candidates: () => [EXAMPLE],
    devInfo: root => live.get(root),
    docs: () => docs,
    language: async link => {
      const lsp = {
        session: { focus: async at => sent.push([link.session, 'focus', at.file]) },
        peer: { alive: () => link.open && link.lsp === lsp, notify: (m, p) => sent.push([link.session, m, p.textDocument.uri]) },
        dispose: async () => {},
      }
      return lsp
    },
  })
  /** the documents a session holds now: opened and not closed since */
  const holds = id => {
    const on = new Set()
    for (const [s, m, uri] of sent) if (s === id) m === 'textDocument/didOpen' ? on.add(uri) : m === 'textDocument/didClose' && on.delete(uri)
    return [...on].sort()
  }
  try {
    await w.server.start()
    await until(() => w.server.links.length === 2 && w.server.links.every(l => l.lsp))
    assert.equal(w.server.client.session, 'own00001')
    await until(() => holds('ex000001').length === 1)
    assert.deepEqual(holds('ex000001'), [docs[0].uri])
    assert.deepEqual(holds('own00001'), [docs[1].uri])
    assert.equal(w.server.owner(FILE).link.session, 'ex000001')
    assert.equal(w.sessionOf(FILE), w.server.owner(FILE).link.lsp.session)

    assert.ok(w.sync.focus(FILE))
    assert.deepEqual(sent.at(-1), ['ex000001', 'focus', FILE])
    assert.deepEqual(await w.server.request('session/clients', undefined, FILE), { session: 'ex000001' })
    assert.deepEqual(await w.server.request('session/clients', undefined, TOP), { session: 'own00001' })

    live.delete(EXAMPLE)
    inner.send({ event: 'pcbjs:ide:bye', data: { reason: 'session stop' } })
    await inner.close()
    await until(() => w.server.links.length === 1 && holds('own00001').length === 2)
    assert.deepEqual(holds('own00001'), [docs[0].uri, docs[1].uri].sort(), 'the file moved to the covering session')
    assert.equal(w.server.owner(FILE).link.session, 'own00001')
    assert.ok(w.sync.focus(FILE), 'the next focus of the file goes to its new owner')
    assert.deepEqual(sent.at(-1), ['own00001', 'focus', FILE])
    assert.deepEqual(await w.server.request('session/clients', undefined, FILE), { session: 'own00001' })
    assert.equal(w.server.state.kind, 'running')
  } finally {
    await w.dispose()
    await outer.close()
    await inner.close()
  }
})
