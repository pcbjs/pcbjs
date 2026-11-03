// The viewer's tools in a workspace session over two projects: a move in each writes the project's own file, as in a session of
// the project alone, and the selection's editor range names that file.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const board = name => `import PCB, { defineFootprint, nets } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: { at?: string }) {
  return <footprint value="V" id="t:pad" bom={false} {...props}><pad num={1} size={1} shape="circle" /><pad num={2} at="2 0" size={1} shape="circle" /></footprint>
}, { pins: ['1', '2'], prefix: 'TP' })
const { V, W } = nets()
const TP1 = TestPad().connect({ 1: V, 2: W })
const TP2 = TestPad().connect({ 1: V, 2: W })

export default (
  <PCB name="${name}">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={30} />
    <TP1 at="5 10" />
    <TP2 at="20 10" />
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

/** A session client of one project, as the cli or an editor: requests, and the notifications it got. */
async function client(info, project, role = 'cli') {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const waits = new Map()
  const notes = []
  let id = 0
  const send = m => ws.send(JSON.stringify(m))
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.method && m.id === undefined) notes.push(m)
    if (m.jsonrpc && m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  send({ event: 'pcbjs:ide:hello', data: { name: `test ${role}`, version: '0', protocol: 3, major: 1, capabilities: [], role, project } })
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(`t${++id}`, { ok, fail })
      send({ jsonrpc: '2.0', id: `t${id}`, method, params })
    })
  if (role === 'editor') {
    await request('initialize', {
      processId: null,
      rootUri: pathToFileURL(project).href,
      capabilities: {},
      initializationOptions: { pcbjs: { protocol: 3, major: 1, capabilities: [] } },
    })
    send({ jsonrpc: '2.0', method: 'initialized', params: {} })
  }
  return { request, notes, close: () => ws.close() }
}

test('a workspace session over two projects moves a part in each, writing the project file', { timeout: 240000 }, async () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-wsedit-')))
  dirs.push(top)
  mkdirSync(join(top, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(top, 'node_modules', '@pcbjs'), 'dir')
  const projects = { Alpha: join(top, 'alpha'), Beta: join(top, 'beta') }
  for (const [name, root] of Object.entries(projects)) {
    mkdirSync(root)
    writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
    writeFileSync(join(root, 'pcb.tsx'), board(name))
  }
  const env = { ...process.env, XDG_RUNTIME_DIR: join(top, '.run') }
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--workspace', top, '--port', '0', '--host', '127.0.0.1'], { cwd: top, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  try {
    await until(() => Object.values(projects).every(r => existsSync(join(r, '.pcbjs', 'dev.json'))))
    for (const [name, root] of Object.entries(projects)) {
      const file = join(root, 'pcb.tsx')
      const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
      // the preview shows the project, as the viewer does on its route
      const shown = await fetch(`http://127.0.0.1:${new URL(info.url).port}/__pcbjs/scope/${basename(root)}`)
      assert.equal(shown.status, 200, name)
      const c = await client(info, root)
      await c.request('session/check', { project: root })
      const { txn } = await c.request('session/edit/begin', { board: name, tool: 'move', refs: ['TP1'], anchor: 'TP1' })
      const plan = await c.request('session/edit/update', { txn, delta: [1, 0] })
      assert.deepEqual(plan.notes, ['writes pcb.tsx:13'], `${name}\n${out}`)
      const done = await c.request('session/edit/commit', { txn })
      assert.deepEqual(done.written, [{ file, via: 'disk', applied: true }], name)
      assert.match(readFileSync(file, 'utf8'), /<TP1 at="6 10" \/>/, name)
      assert.ok(!existsSync(join(root, 'pcb.patches.ts')) && !existsSync(join(top, 'pcb.tsx')), name)
      c.close()
      // A preview selection highlights the complete placement expression in this project's file.
      const ed = await client(info, root, 'editor')
      await ed.request('session/select', { board: name, refs: ['TP2'], anchor: 'TP2' })
      await until(() => ed.notes.some(n => n.method === 'pcbjs/select'))
      const jump = ed.notes.find(n => n.method === 'pcbjs/select').params
      assert.equal(jump.items[0].uri, pathToFileURL(file).href, name)
      assert.deepEqual(jump.items[0].ranges[0], { start: { line: 13, character: 4 }, end: { line: 13, character: 22 } }, name)
      ed.close()
    }
    const info = JSON.parse(readFileSync(join(top, '.pcbjs', 'dev.json'), 'utf8'))
    const sidebar = await client(info, top, 'editor')
    await sidebar.request('session/select', { board: 'Beta', refs: ['TP1'], anchor: 'TP1' })
    await until(() => sidebar.notes.some(n => n.method === 'pcbjs/select'))
    const jump = sidebar.notes.find(n => n.method === 'pcbjs/select').params
    assert.equal(jump.items[0].uri, pathToFileURL(join(projects.Beta, 'pcb.tsx')).href, 'a registered workspace-root editor follows the displayed project')
    sidebar.close()
    assert.doesNotMatch(out, /in no file of this project/)
  } finally {
    await stop(child)
  }
})
