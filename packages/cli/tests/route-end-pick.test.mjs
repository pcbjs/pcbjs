// The route end assist through the session and a fake editor: the cursor in `route(|)` posts the candidates to the viewers, a pick of
// J1[2] writes it with `, ` and moves the cursor into the second slot, a pick there writes the second end, and one after it adds a
// third with the comma; a handle the slot does not offer is refused; and each completion item the editor resolves reaches a viewer as
// the focus, cleared a second after the item is accepted.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'
import { textDoc } from '@pcbjs/core/internal/textdoc'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const BOARD = `import PCB, { defineFootprint, nets, route, type FootprintProps } from '@pcbjs/core'

const two = (props: FootprintProps) => <footprint value="V" id="t:two" bom={false} {...props}><pad num={1} size={1} shape="circle" /><pad num={2} at="2 0" size={1} shape="circle" /></footprint>
const Hdr = defineFootprint(function Hdr(props: FootprintProps) { return two(props) }, { pins: ['1', '2'], prefix: 'J' })
const Res = defineFootprint(function Res(props: FootprintProps) { return two(props) }, { pins: ['1', '2'], prefix: 'R' })
const { V, W } = nets()
const J1 = Hdr().connect({ 1: V, 2: W })
const R1 = Res().connect({ 1: W, 2: V })
const R2 = Res().connect({ 1: W, 2: V })

export default (
  <PCB name="Ends">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={30} />
    <J1 at="5 10" />
    <R1 at="20 10" />
    <R2 at="20 20" />
    {route()}
  </PCB>
)
`

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

/** A session client that, as an editor, applies workspace/applyEdit to its own text and keeps the cursor it is told. */
async function editor(info, root) {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const waits = new Map()
  const notes = []
  const docs = new Map()
  // an edit loads the document and changes it, so it opens at version 2 as in VS Code
  let version = 1,
    id = 0
  const send = m => ws.send(JSON.stringify(m))
  const sync = file => {
    const uri = pathToFileURL(file).href
    if (++version === 2) send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version, text: docs.get(file) } } })
    else send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version }, contentChanges: [{ text: docs.get(file) }] } })
  }
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.method === 'workspace/applyEdit' && m.id !== undefined) {
      for (const [uri, edits] of Object.entries(m.params.edit.changes ?? {})) {
        const file = fileURLToPath(uri)
        docs.set(file, textDoc(docs.get(file)).apply(edits))
        sync(file)
      }
      send({ jsonrpc: '2.0', id: m.id, result: { applied: true } })
      return
    }
    if (m.method && m.id === undefined) notes.push(m)
    if (m.jsonrpc && m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  send({ event: 'pcbjs:ide:hello', data: { name: 'test editor', version: '0', protocol: 3, major: 1, capabilities: [], role: 'editor', project: root } })
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(`t${++id}`, { ok, fail })
      send({ jsonrpc: '2.0', id: `t${id}`, method, params })
    })
  await request('initialize', {
    processId: null,
    rootUri: pathToFileURL(root).href,
    capabilities: { workspace: { applyEdit: true } },
    initializationOptions: { pcbjs: { protocol: 3, major: 1, capabilities: [] } },
  })
  send({ jsonrpc: '2.0', method: 'initialized', params: {} })
  const type = (file, text) => {
    docs.set(file, text)
    sync(file)
  }
  const focus = (file, position) => send({ jsonrpc: '2.0', method: 'pcbjs/focus', params: { textDocument: { uri: pathToFileURL(file).href }, position } })
  /** where the session last moved the cursor */
  const cursor = () => notes.filter(n => n.method === 'pcbjs/select').at(-1)?.params.items[0].ranges[0].start
  return { request, notes, docs, type, focus, cursor, close: () => ws.close() }
}

/** A click on a candidate as the viewer makes it: begin an assist pick, name the handle, commit. */
async function pick(ed, handle) {
  let begun = null
  await until(async () => {
    begun = await ed.request('session/edit/begin', { board: 'Ends', tool: 'assist', refs: [], anchor: 'assist' }).catch(() => null)
    return !!begun
  })
  const plan = await ed.request('session/edit/update', { txn: begun.txn, end: handle })
  return { plan, done: await ed.request('session/edit/commit', { txn: begun.txn }) }
}

/** A project of BOARD with a session serving it. */
async function start() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-ends-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
  writeFileSync(join(root, 'pcb.tsx'), BOARD.replace('    {route()}\n', ''))
  const env = { ...process.env, XDG_RUNTIME_DIR: join(root, '.run') }
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  return { root, info, child, file: join(root, 'pcb.tsx') }
}
const lines = BOARD.split('\n')
const row = lines.findIndex(l => l.includes('{route()}'))

test('a click on J1/2 fills route(|) with J1[2] through the editor and moves the cursor on; the next fills the slot and one more appends', { timeout: 180000 }, async () => {
  const { root, info, child, file } = await start()
  try {
    const ed = await editor(info, root)
    await ed.request('session/check')
    ed.type(file, BOARD)
    ed.focus(file, { line: row, character: lines[row].indexOf('()') + 1 })

    await assert.rejects(
      (async () => {
        const r = await pick(ed, 'Q9[1]')
        if (r.done.error) throw new Error(r.done.error)
      })(),
      /Q9\[1\] is no end this slot offers/,
    )
    const first = await pick(ed, 'J1[2]')
    assert.equal(first.done.written[0].via, 'editor')
    assert.deepEqual(first.plan.notes, [`writes pcb.tsx:${row + 1}`])
    assert.equal(ed.docs.get(file).split('\n')[row].trim(), '{route(J1[2], )}')
    const at = ed.cursor()
    assert.deepEqual(at, { line: row, character: lines[row].indexOf('(') + 'J1[2], '.length + 1 })

    ed.focus(file, at)
    await pick(ed, 'R1[1]')
    assert.equal(ed.docs.get(file).split('\n')[row].trim(), '{route(J1[2], R1[1])}')
    ed.focus(file, ed.cursor())
    await pick(ed, 'R2[1]')
    assert.equal(ed.docs.get(file).split('\n')[row].trim(), '{route(J1[2], R1[1], R2[1])}')
    ed.close()
  } finally {
    await stop(child)
  }
})

test('the completion item in focus reaches the views as pcbjs:assist:focus, follows the list, and lapses a second after the item is accepted', { timeout: 180000 }, async () => {
  const { root, info, child, file } = await start()
  try {
    const ed = await editor(info, root)
    await ed.request('session/check')
    const view = await viewerClient(new URL(info.url).port, { board: 'Ends' })
    const got = []
    view.on((event, d) => event === 'pcbjs:assist:focus' && got.push({ handle: d.handle, at: Date.now() }))
    ed.type(file, BOARD)
    const position = { line: row, character: lines[row].indexOf('()') + 1 }
    ed.focus(file, position)
    const uri = pathToFileURL(file).href
    let list = null
    await until(async () => (list = await ed.request('textDocument/completion', { textDocument: { uri }, position }))?.items?.length > 0)
    assert.ok(list.items.some(i => i.label === 'J1[2]'))
    for (const item of list.items.slice(0, 3)) await ed.request('completionItem/resolve', item)
    await until(() => got.length >= 3)
    assert.deepEqual(
      got.map(g => g.handle),
      list.items.slice(0, 3).map(i => i.label),
    )
    const before = got.length
    const accepted = Date.now()
    ed.type(file, BOARD.replace('{route()}', `{route(${list.items[2].label})}`))
    await until(() => got.length > before)
    assert.equal(got.at(-1).handle, null)
    assert.ok(got.at(-1).at - accepted >= 900, `cleared after ${got.at(-1).at - accepted} ms`)
    view.close()
    ed.close()
  } finally {
    await stop(child)
  }
})
