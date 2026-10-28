// Drafts through a mock editor host: the language client's didChange compiles the unsaved text, repaired when it is broken,
// the board says draft and the skipped span comes back as a hint; text past repair keeps the last good board; a close
// drops the draft and the file on disk compiles again.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { createMessageConnection } from 'vscode-jsonrpc'
import { messageChannel } from '@pcbjs/lsp/channel'
import { dev } from '../dist/server.js'
import { board } from './fixtures/workspace.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PORT = 5263
const HOST_PORT = 5273

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-drafts-')))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
const file = join(root, 'pcb.tsx')
const saved = board('Draft')
writeFileSync(file, saved)
const uri = pathToFileURL(file).href

/** The editor host: takes the dev server's connection, records its events and runs a language client on the same socket. */
function mockHost() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: HOST_PORT })
  const events = []
  const waiters = []
  const connected = new Promise(ok =>
    wss.on('connection', (sock, req) => {
      if (req.url !== '/tok') {
        sock.close()
        return
      }
      const ch = messageChannel(m => sock.send(JSON.stringify(m)))
      sock.on('message', raw => {
        const m = JSON.parse(raw.toString())
        if (m.jsonrpc === '2.0') {
          ch.push(m)
          return
        }
        events.push(m)
        for (const w of waiters.slice())
          if (w.pred(m)) {
            waiters.splice(waiters.indexOf(w), 1)
            w.ok(m)
          }
      })
      sock.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'mock', version: '0', protocol: 2, major: 1, capabilities: ['boards', 'lsp'] } }))
      const conn = createMessageConnection(ch.reader, ch.writer)
      conn.listen()
      ok(conn)
    }),
  )
  const next = (pred, ms = 30000) =>
    new Promise((ok, fail) => {
      const hit = events.find(pred)
      if (hit) {
        events.splice(events.indexOf(hit), 1)
        return ok(hit)
      }
      const t = setTimeout(() => fail(new Error('timed out')), ms)
      waiters.push({
        pred,
        ok: m => {
          clearTimeout(t)
          ok(m)
        },
      })
    })
  return { wss, connected, next, events }
}

const host = mockHost()
const server = await dev({ root, port: PORT, host: '127.0.0.1', ide: `ws://127.0.0.1:${HOST_PORT}/tok` })
after(async () => {
  await server.close()
  host.wss.close()
  rmSync(root, { recursive: true, force: true })
})

const boards = pred => host.next(m => m.event === 'pcbjs:ide:boards' && pred(m.data)).then(m => m.data)
const draftBoard = d => d.boards[0]

test('drafts: broken unsaved text previews repaired, marked draft, its skipped span a hint; past repair the last good board stays', async () => {
  const conn = await host.connected
  const diags = []
  conn.onNotification('textDocument/publishDiagnostics', p => diags.push(p))
  await boards(d => draftBoard(d)?.status === 'ok')
  const init = await conn.sendRequest('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
    initializationOptions: { pcbjs: { protocol: 2, major: 1, capabilities: ['widget'] } },
  })
  assert.deepEqual(init.capabilities.textDocumentSync, { openClose: true, change: 1, save: { includeText: false } })
  await conn.sendNotification('initialized', {})
  await conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: saved } })

  // an open tag mid-typing: the repair skips it
  const typing = '    <footprint ref="TP3" value="V" at='
  const broken = saved.replace('  </PCB>', `${typing}\n  </PCB>`)
  await conn.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: broken }] })
  const d1 = await boards(d => draftBoard(d)?.draft === true)
  assert.equal(draftBoard(d1).status, 'ok')
  assert.equal(draftBoard(d1).skipped, 1)
  const line = broken.split('\n').findIndex(l => l.startsWith(typing))
  const hint = () =>
    diags
      .filter(p => p.uri === uri)
      .flatMap(p => p.diagnostics)
      .find(x => x.source === 'pcbjs draft')
  for (let i = 0; i < 100 && !hint(); i++) await new Promise(r => setTimeout(r, 50))
  assert.equal(hint().severity, 4)
  assert.deepEqual(hint().tags, [1])
  assert.equal(hint().range.start.line, line)
  assert.equal(readFileSync(file, 'utf8'), saved)

  // more broken statements than the repair takes: the last good board stays, its entry in error
  const hopeless = saved + Array.from({ length: 6 }, (_, i) => `const v${i} = (\n;`).join('\n')
  await conn.sendNotification('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: hopeless }] })
  const d2 = await boards(d => draftBoard(d)?.status === 'error')
  assert.equal(draftBoard(d2).name, 'Draft')
  assert.ok(d2.errors['pcb.tsx'])

  // closing the file drops the draft: the file on disk compiles again
  await conn.sendNotification('textDocument/didClose', { textDocument: { uri } })
  const d3 = await boards(d => draftBoard(d)?.status === 'ok')
  assert.equal(draftBoard(d3).draft, undefined)
})
