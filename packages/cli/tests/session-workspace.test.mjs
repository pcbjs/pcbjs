// Two example projects served by one workspace session, as the editor opens a repository: each answers check, facets and the
// language server's diagnostics, and its viewer gets the edit mode and a board whose parts carry their tools.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const EXAMPLES = ['highspeed', 'usbc-led']

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

async function until(fn, ms = 60000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

/** A socket that keeps every message it got, with a wait for the first one matching. */
async function socket(url, protocol) {
  const ws = new WebSocket(url, protocol)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const got = []
  ws.on('message', raw => got.push(JSON.parse(raw.toString())))
  return { ws, got, send: m => ws.send(JSON.stringify(m)), next: async pred => (await until(() => got.find(pred)), got.find(pred)) }
}

/** The session's JSON-RPC socket as the extension's language client holds it. */
async function editor(info, project) {
  const s = await socket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  let id = 0
  const request = (method, params = {}) => {
    const n = ++id
    s.send({ jsonrpc: '2.0', id: n, method, params })
    return s.next(m => m.jsonrpc && m.id === n && !m.method).then(m => (m.error ? Promise.reject(new Error(m.error.message)) : m.result))
  }
  s.send({ event: 'pcbjs:ide:hello', data: { name: 'test editor', version: '0', protocol: 2, major: 1, capabilities: [], role: 'editor', project } })
  await s.next(m => m.event === 'pcbjs:ide:ready')
  return { ...s, request, notify: (method, params) => s.send({ jsonrpc: '2.0', method, params }) }
}

test('two example projects in one workspace session: check, facets, diagnostics and the viewer edit mode of each', { timeout: 240000 }, async () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-ws-')))
  dirs.push(top)
  mkdirSync(join(top, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(top, 'node_modules', '@pcbjs'), 'dir')
  for (const name of EXAMPLES) cpSync(join(REPO, 'examples', name), join(top, name), { recursive: true, filter: s => !s.includes('/.pcbjs') })
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--workspace', top, '--port', '0', '--host', '127.0.0.1'], { cwd: top, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  try {
    await until(() => EXAMPLES.every(n => existsSync(join(top, n, '.pcbjs', 'dev.json'))))
    for (const name of EXAMPLES) {
      const root = join(top, name)
      const file = join(root, 'pcb.tsx')
      const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
      const ed = await editor(info, root)
      await ed.request('initialize', { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
      ed.notify('initialized', {})
      ed.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: 'typescriptreact', version: 1, text: readFileSync(file, 'utf8') } })
      // an edit compiles again, which publishes the open document's diagnostics
      ed.notify('textDocument/didChange', { textDocument: { uri: pathToFileURL(file).href, version: 2 }, contentChanges: [{ text: readFileSync(file, 'utf8') + '\n' }] })
      const check = await ed.request('session/check', { project: root })
      assert.match(check.value.stdout, /DRC ok\s+ERC ok/, `check of ${name}:\n${check.value.stdout}\n${out}`)
      const f = await ed.request('session/facets', { entry: file, facets: ['meta', 'findings'] })
      assert.deepEqual(f.facets.map(x => x.facet).sort(), ['findings', 'meta'], name)
      // the board the tools read: compiled for dev, its parts movable
      const meta = f.facets.find(x => x.facet === 'meta').data
      assert.ok(meta.dev && meta.edit?.some(e => e.caps.includes('placed')), `${name} has movable parts`)
      const diag = await ed.next(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === pathToFileURL(file).href)
      assert.deepEqual(
        diag.params.diagnostics.filter(d => d.severity === 1),
        [],
        name,
      )
      const view = await viewerClient(new URL(info.url).port, { board: meta.name })
      const ready = await view.next('pcbjs:ide:ready')
      assert.equal(ready.mode, 'rw', name)
      view.close()
      ed.ws.close()
    }
    assert.doesNotMatch(out, /EBADF|could not load its config/)
  } finally {
    await stop(child)
  }
})
