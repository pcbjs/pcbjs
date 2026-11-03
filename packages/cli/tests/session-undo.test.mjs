// Click to source and undo from the preview, with a fake editor and a real session: a viewer's click reveals the placement in the editor
// with focus kept, an Open gives the editor focus; a viewer's edit is undone and redone through the session, on disk with no editor, a
// computed at made literal and back, through the editor's applyEdit with one; each client undoes only its own edits.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'
import { textDoc } from '@pcbjs/core/internal/textdoc'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const BOARD = `import PCB, { defineFootprint, nets, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="t:pad" bom={false} {...props}><pad num={1} size={1} shape="circle" /><pad num={2} at="2 0" size={1} shape="circle" /></footprint>
}, { pins: ['1', '2'], prefix: 'TP' })
const { V, W } = nets()
const TP1 = TestPad().connect({ 1: V, 2: W })
const TP2 = TestPad().connect({ 1: V, 2: W })
const x = 30

export default (
  <PCB name="Undo">
    <rect layer="Edge.Cuts" x={0} y={0} w={60} h={40} />
    <TP1 at="5 10" />
    <TP2 at={\`\${x} 10\`} />
  </PCB>
)
`

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-undo-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
  writeFileSync(join(root, 'pcb.tsx'), BOARD)
  return root
}

async function until(fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

async function serve(root) {
  const env = { ...process.env, XDG_RUNTIME_DIR: join(root, '.run') }
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  return { port: new URL(info.url).port, stop: () => stop(child) }
}

/** A session client; as an editor it keeps the text of what it was sent by applyEdit and records each `pcbjs/select`. */
async function client(port, role, root) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const waits = new Map()
  const selects = []
  const docs = new Map()
  const versions = new Map()
  let id = 0
  const send = m => ws.send(JSON.stringify(m))
  const sync = file => {
    const uri = pathToFileURL(file).href
    // an edit loads the document and changes it, so it opens at version 2 as in VS Code
    const v = (versions.get(file) ?? 1) + 1
    versions.set(file, v)
    if (v === 2) send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version: v, text: docs.get(file) } } })
    else send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: v }, contentChanges: [{ text: docs.get(file) }] } })
  }
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.method === 'workspace/applyEdit' && m.id !== undefined) {
      for (const [uri, edits] of Object.entries(m.params.edit.changes ?? {})) {
        const file = fileURLToPath(uri)
        docs.set(file, textDoc(docs.get(file) ?? readFileSync(file, 'utf8')).apply(edits))
        sync(file)
      }
      send({ jsonrpc: '2.0', id: m.id, result: { applied: true } })
      return
    }
    if (m.method === 'pcbjs/select') selects.push(m.params)
    if (m.jsonrpc && m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  send({ event: 'pcbjs:ide:hello', data: { name: `test ${role}`, version: '0', protocol: 3, major: 1, capabilities: [], role, project: root } })
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(`t${++id}`, { ok, fail })
      send({ jsonrpc: '2.0', id: `t${id}`, method, params })
    })
  if (role === 'editor') {
    await request('initialize', {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: { workspace: { applyEdit: true } },
      initializationOptions: { pcbjs: { protocol: 3, major: 1, capabilities: [] } },
    })
    send({ jsonrpc: '2.0', method: 'initialized', params: {} })
  }
  return { request, selects, docs, close: () => ws.close() }
}

/** A viewer page of the session: its selection, and its tools' requests. */
async function viewer(port, board) {
  const v = await viewerClient(port, { board })
  const drag = async (ref, update) => {
    const { txn } = await v.request('session/edit/begin', { board, tool: 'move', refs: [ref], anchor: ref })
    await v.request('session/edit/update', { txn, ...update })
    return v.request('session/edit/commit', { txn })
  }
  let base = 0
  const select = (refs, view = '2d') =>
    v.request('session/select', {
      board,
      selection: { board, target: null, snapshot: '', refs, anchor: refs[0], level: null, isolate: null, by: 'viewer', client: null, seq: 0 },
      base: base++,
      view,
    })
  return { request: v.request, drag, select, close: v.close }
}

const line = (text, re) =>
  text
    .split('\n')
    .find(l => re.test(l))
    ?.trim()

test('with no editor a viewer undoes and redoes its own edits through the session, on disk', { timeout: 180000 }, async () => {
  const root = project()
  const s = await serve(root)
  const file = join(root, 'pcb.tsx')
  const patches = join(root, 'pcb.patches.ts')
  try {
    const cli = await client(s.port, 'cli', root)
    await cli.request('session/check')
    const v = await viewer(s.port, 'Undo')
    const moved = await v.drag('TP1', { delta: [1, 0] })
    assert.deepEqual(moved.written, [{ file, via: 'disk', applied: true }])
    assert.equal(line(readFileSync(file, 'utf8'), /<TP1 /), '<TP1 at="6 10" />')
    const nudged = await v.drag('TP2', { delta: [0.5, 0] })
    assert.equal(line(readFileSync(file, 'utf8'), /<TP2 /), '<TP2 at="30.5 10" />', 'a computed at becomes the literal')
    assert.ok(!existsSync(patches), 'a drag writes no patch')

    assert.match((await cli.request('session/edit/undo')).error, /nothing to undo/, 'another client has nothing of its own to undo')
    const back = await v.request('session/edit/undo', { txn: nudged.txn })
    assert.equal(back.txn, nudged.txn)
    assert.equal(line(readFileSync(file, 'utf8'), /<TP2 /), '<TP2 at={`${x} 10`} />', 'undo restores the expression')
    await v.request('session/edit/undo', { txn: moved.txn })
    assert.equal(readFileSync(file, 'utf8'), BOARD, 'disk restored')
    await v.request('session/edit/redo', { txn: moved.txn })
    assert.equal(line(readFileSync(file, 'utf8'), /<TP1 /), '<TP1 at="6 10" />')
    await v.request('session/edit/redo')
    assert.equal(line(readFileSync(file, 'utf8'), /<TP2 /), '<TP2 at="30.5 10" />')

    writeFileSync(file, readFileSync(file, 'utf8').replace('at="6 10"', 'at="6 11"'))
    const refused = await v.request('session/edit/undo', { txn: moved.txn })
    assert.match(refused.error, /pcb\.tsx changed since the edit; nothing was undone/)
    assert.equal(line(readFileSync(file, 'utf8'), /<TP1 /), '<TP1 at="6 11" />')
    v.close()
    cli.close()
  } finally {
    await s.stop()
  }
})

test('a click reveals the placement in the editor with focus kept, an Open gives it focus, and an undo goes back through applyEdit', { timeout: 180000 }, async () => {
  const root = project()
  const s = await serve(root)
  const file = join(root, 'pcb.tsx')
  try {
    const ed = await client(s.port, 'editor', root)
    await ed.request('session/check')
    const v = await viewer(s.port, 'Undo')
    await new Promise(r => setTimeout(r, 200))

    v.select(['TP1'])
    const click = await until(() => ed.selects.shift())
    assert.equal(click.reveal, true)
    assert.equal(click.focus, undefined, 'a click keeps focus in the preview')
    assert.equal(click.primary.uri, pathToFileURL(file).href)
    assert.deepEqual(click.items[0].ranges[0], { start: { line: 13, character: 4 }, end: { line: 13, character: 21 } }, 'the complete <TP1 at="5 10" /> expression')

    // Open definition: the chip asks the bridge for the factory's range
    const res = await fetch(`http://127.0.0.1:${s.port}/__pcbjs/open?file=pcb.tsx&line=3&col=17&endLine=3&endCol=30`)
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('x-pcbjs-opened'), 'ide')
    const open = await until(() => ed.selects.shift())
    assert.equal(open.focus, true)
    assert.deepEqual(open.items[0].ranges[0], { start: { line: 2, character: 16 }, end: { line: 2, character: 30 } })

    const moved = await v.drag('TP1', { delta: [2, 0] })
    assert.equal(moved.written[0].via, 'editor')
    assert.equal(line(ed.docs.get(file), /<TP1 /), '<TP1 at="7 10" />')
    await until(async () => !(await v.request('session/edit/undo', { txn: moved.txn })).error)
    assert.equal(ed.docs.get(file), BOARD, 'the editor holds the text before the edit')
    assert.equal(readFileSync(file, 'utf8'), BOARD, 'disk untouched')
    await v.request('session/edit/redo', { txn: moved.txn })
    assert.equal(line(ed.docs.get(file), /<TP1 /), '<TP1 at="7 10" />')
    v.close()
    ed.close()
  } finally {
    await s.stop()
  }
})

/** The 0-based LSP range of the first match's group 1 in a file. */
function rangeIn(file, re) {
  const text = readFileSync(file, 'utf8')
  const m = re.exec(text)
  const at = m.index + m[0].lastIndexOf(m[1])
  const pos = o => {
    const lines = text.slice(0, o).split('\n')
    return { line: lines.length - 1, character: lines[lines.length - 1].length }
  }
  return { start: pos(at), end: pos(at + m[1].length) }
}

test('on Blinky entity clicks select their complete PCB or schematic expression, and a net click selects its declaration', { timeout: 180000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-blinky-')))
  dirs.push(root)
  const demo = join(REPO, 'examples', 'demo')
  cpSync(demo, root, { recursive: true, filter: f => !/\/(\.pcbjs|node_modules)(\/|$)/.test(f.slice(demo.length)) })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const config = join(root, 'pcb.config.ts')
  writeFileSync(config, readFileSync(config, 'utf8').replace(/entries: \[[^\]]*\]/, "entries: ['blinky.pcb.tsx'], vite: { logLevel: 'silent' }"))
  const pcb = join(root, 'blinky.pcb.tsx'),
    sch = join(root, 'blinky.sch.tsx')
  const placedJ1 = /<Schematic>[\s\S]*?<J1 at="([^"]*)"/
  const s = await serve(root)
  try {
    const ed = await client(s.port, 'editor', root)
    await ed.request('session/check')
    const v = await viewer(s.port, 'Blinky')
    await new Promise(r => setTimeout(r, 200))

    v.select(['J1'], '2d')
    const board = await until(() => ed.selects.shift())
    assert.equal(board.primary.uri, pathToFileURL(pcb).href)
    assert.deepEqual(board.items[0].ranges[0], rangeIn(pcb, /(<J1\b[^>]*\/>)/), 'the complete PCB placement expression')

    v.select(['net:VCC'], 'sch')
    const net = await until(() => ed.selects.shift())
    assert.equal(net.primary.uri, pathToFileURL(sch).href)
    assert.deepEqual(net.items[0].ranges[0], rangeIn(sch, /export const \{[^}]*\b(VCC)\b/), 'the net where it is declared')

    v.select(['J1'], 'sch')
    const symbol = await until(() => ed.selects.shift())
    assert.equal(symbol.primary.uri, pathToFileURL(sch).href)
    assert.deepEqual(symbol.items[0].ranges[0], rangeIn(sch, /<Schematic>[\s\S]*?(<J1\b[^>]*\/>)/), 'the complete expression inside <Schematic>, never the layout')

    // The explicit at=1 API remains available for opening just a coordinate value.
    const el = rangeIn(sch, /<Schematic>[\s\S]*?(<J1) at=/).start
    const res = await fetch(`http://127.0.0.1:${s.port}/__pcbjs/open?file=blinky.sch.tsx&line=${el.line + 1}&col=${el.character + 1}&at=1`)
    assert.equal(res.status, 204)
    const open = await until(() => ed.selects.shift())
    assert.equal(open.focus, true)
    assert.deepEqual(open.items[0].ranges[0], rangeIn(sch, placedJ1))
    v.close()
    ed.close()
  } finally {
    await s.stop()
  }
})
