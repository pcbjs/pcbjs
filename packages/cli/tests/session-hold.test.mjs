// The compile hold through a real session and a fake editor: a block left with an error holds with its line named, completing it,
// moving the cursor out, a save, an edit in another block and a check each compile, the check saying it repaired the held draft.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const BOARD = `import PCB, { defineFootprint, nets, route, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="pcbjs:TestPad-2mm" bom={false} {...props}><pad num={1} size={1} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
const { V } = nets()
const J1 = TestPad().connect({ 1: V })
const R1 = TestPad().connect({ 1: V })

export default (
  <PCB name="Hold">
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <J1 at="5mm 10mm" />
    <R1 at="15mm 10mm" />
    {route('5 10').net(V).width(0.5).H(15)}
  </PCB>
)
`
const BROKEN = '    {route(J1[1], R1[1]).H(}\n'
const LINE = BOARD.split('\n').findIndex(l => l.includes('<R1 at=')) + 2

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-hold-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), BOARD)
  return root
}

async function until(fn, ms = 60000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

async function serve(root) {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  return { info: JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8')), stop: () => stop(child) }
}

/** An editor on the session's WebSocket: its text of one file, typed, its cursor, saves, and every frame it got. */
async function editor(info, root, file) {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const frames = []
  const waits = new Map()
  let id = 0
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    frames.push(m)
    if (m.jsonrpc && m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  const send = m => ws.send(JSON.stringify(m))
  const uri = pathToFileURL(file).href
  let version = 1
  let text = BOARD
  send({ event: 'pcbjs:ide:hello', data: { name: 'test editor', version: '0', protocol: 2, major: 1, capabilities: [], role: 'editor', project: root } })
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(++id, { ok, fail })
      send({ jsonrpc: '2.0', id, method, params })
    })
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params })
  await until(() => frames.some(m => m.event === 'pcbjs:ide:ready'))
  await request('initialize', { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version, text } })
  const cursor = (line, character) => notify('pcbjs/focus', { textDocument: { uri }, position: { line: line - 1, character } })
  // the editor focuses the file it opened
  cursor(1, 0)
  return {
    frames,
    request,
    /** the new text, then the cursor at the end of the 1-based line holding `at` */
    type(next, at) {
      text = next
      notify('textDocument/didChange', { textDocument: { uri, version: ++version }, contentChanges: [{ text }] })
      const lines = text.split('\n')
      const i = lines.findIndex(l => l.includes(at))
      cursor(i + 1, lines[i].length)
    },
    edit(from, to, at) {
      this.type(text.replace(from, to), at)
    },
    cursor,
    save() {
      writeFileSync(file, text)
      notify('textDocument/didSave', { textDocument: { uri } })
    },
    close: () => ws.close(),
  }
}

const insert = (text, s) => text.replace('    {route(', s + '    {route(')
const quiet = ms => new Promise(r => setTimeout(r, ms))

test('a block left with an error holds its compile until it is clean, the cursor leaves it, a save, another block or a check', { timeout: 180000 }, async () => {
  const root = project()
  const file = join(root, 'pcb.tsx')
  const s = await serve(root)
  try {
    const ed = await editor(s.info, root, file)
    await ed.request('session/check')
    let since = (await ed.request('session/events', {})).next
    const events = async () => {
      const r = await ed.request('session/events', { since })
      since = r.next
      return r.events
    }
    const next = async pred => {
      let hit
      const seen = []
      await until(async () => {
        seen.push(...(await events()))
        return (hit = seen.find(pred))
      })
      return { hit, seen }
    }
    const held = e => e.kind === 'compile' && e.data.state === 'held'
    const compiled = e => e.kind === 'compile' && 'stage' in e.data
    const broken = insert(BOARD, BROKEN)

    // typing the call holds, naming the line, and nothing compiles meanwhile
    ed.type(broken, '.H(}')
    const h = (await next(held)).hit
    assert.deepEqual([h.data.file, h.data.line], ['pcb.tsx', LINE])
    await until(() => ed.frames.some(m => m.event === 'session/state' && m.data.hold?.line === LINE))
    await quiet(600)
    assert.ok(!(await events()).some(compiled), 'a held edit compiles nothing')

    // completing it compiles at once
    ed.edit('.H(}', '.H(5).Z()}', '.Z()')
    const done = await next(compiled)
    assert.ok(!done.seen.some(held))
    await until(() => ed.frames.some(m => m.event === 'session/state' && m.data.hold === null))

    // a type error in a block that parses holds too; fixing it back to the compiled text ends the hold with nothing to compile
    ed.edit('.H(5)', '.H(true)', '.H(true)')
    assert.equal((await next(held)).hit.data.line, LINE)
    const from = ed.frames.length
    ed.edit('.H(true)', '.H(5)', '.H(5)')
    await until(() => ed.frames.slice(from).some(m => m.event === 'session/state' && m.data.hold === null))

    // the cursor leaving a broken block compiles the draft as the repair makes it
    ed.edit('.H(5).Z()}', '.H(}', '.H(}')
    await next(held)
    ed.cursor(1, 0)
    await next(compiled)
    const r1 = await ed.request('session/check')
    assert.deepEqual(r1.overlay, ['pcb.tsx'])
    assert.equal(r1.value.exitCode, 0, r1.value.stdout)
    assert.doesNotMatch(r1.value.stdout, /^held/m)

    // an edit in another block while one is held compiles that block
    ed.edit('.H(}', '.H(} ', '.H(}')
    await next(held)
    ed.edit('<J1 at="5mm', '<J1 at="4mm', '<J1 at=')
    await next(compiled)

    // a save compiles
    ed.edit('.H(} ', '.H(}  ', '.H(}')
    await next(held)
    ed.save()
    await next(compiled)

    // a check through the session compiles the held draft as the repair makes it, and says so
    ed.edit('.H(}  ', '.H(}', '.H(}')
    await next(held)
    const r2 = await ed.request('session/check')
    assert.match(r2.value.stdout, new RegExp(`held {7}pcb\\.tsx:${LINE} has an error; checked the draft as the repair makes it`))
    assert.deepEqual(r2.overlay, ['pcb.tsx'], JSON.stringify(r2))
    assert.equal(r2.stale, null)
    ed.close()
  } finally {
    await s.stop()
  }
})
