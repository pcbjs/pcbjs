// The viewer's tools through the session: move, rotate and layer write the placement's own `at` and `side`, a grid position its units, a
// computed `at` a literal, a layout's shared placement an own placement for one instance; a control point rewrites its chain call, an
// automatic leg gets `.X(p)` in a literal chain and a reroute patch otherwise; through a fake editor's workspace/applyEdit when one is
// attached, else on disk; a stale begin and a changed literal refused.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'
import { textDoc } from '@pcbjs/core/internal/textdoc'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const BOARD = `import PCB, { defineFootprint, defineGrid, nets, route, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="t:pad" bom={false} {...props}><pad num={1} size={1} shape="circle" /><pad num={2} at="2 0" size={1} shape="circle" /></footprint>
}, { pins: ['1', '2'], prefix: 'TP' })
const { V, W } = nets()
const TP1 = TestPad().connect({ 1: V, 2: W })
const TP2 = TestPad().connect({ 1: V, 2: W })
const TP3 = TestPad().connect({ 1: V, 2: W })
const x = 30
const G = defineGrid('g', { pitch: 2.54 })
const link = (a: any, b: any) => route(a, b).width(0.3)

export default (
  <PCB name="Edit">
    <rect layer="Edge.Cuts" x={0} y={0} w={60} h={40} />
    <TP1 at="5 10" />
    <TP2 at={\`\${x} 10\`} />
    <g grid={G} at="0 20">
      <TP3 at="2 2" />
    </g>
    {route(TP1[1], TP2[1]).width(0.3).V(14).H(20).X()}
    {link(TP2[2], TP3[2])}
    {link(TP1[2], TP3[2])}
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-edit-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n")
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

async function serve(root, ...extra) {
  const env = { ...process.env, XDG_RUNTIME_DIR: join(root, '.run') }
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1', ...extra], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
  return { info, log: () => out, stop: () => stop(child) }
}

/** A session client; as an editor it answers workspace/applyEdit by applying the edit to its own text and keeping it. */
async function client(info, role, root) {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const waits = new Map()
  const applied = []
  const notes = []
  const docs = new Map()
  const versions = new Map()
  let id = 0
  const send = m => ws.send(JSON.stringify(m))
  // as an editor does: the edited document is open and its text synced
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
      applied.push(m.params.edit)
      for (const [uri, edits] of Object.entries(m.params.edit.changes ?? {})) {
        const file = fileURLToPath(uri)
        docs.set(file, textDoc(docs.get(file) ?? readFileSync(file, 'utf8')).apply(edits))
        sync(file)
      }
      for (const ch of m.params.edit.documentChanges ?? [])
        if (ch.textDocument) {
          const file = fileURLToPath(ch.textDocument.uri)
          docs.set(file, textDoc('').apply(ch.edits))
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
  /** the editor's text of a file, opened or changed, and its cursor at an offset of it */
  const type = (file, text) => {
    docs.set(file, text)
    sync(file)
  }
  const focus = (file, offset) => {
    const before = docs.get(file).slice(0, offset).split('\n')
    const position = { line: before.length - 1, character: before[before.length - 1].length }
    send({ jsonrpc: '2.0', method: 'pcbjs/focus', params: { textDocument: { uri: pathToFileURL(file).href }, position } })
  }
  return { request, applied, notes, docs, type, focus, close: () => ws.close() }
}

/** One drag: begin, the updates in order, commit; the last plan and the commit's result. */
async function drag(c, begin, ...updates) {
  await c.request('session/check')
  const { txn, tools } = await c.request('session/edit/begin', { board: 'Edit', ...begin })
  let plan = null
  for (const u of updates) plan = await c.request('session/edit/update', { txn, ...u })
  const done = await c.request('session/edit/commit', { txn })
  return { tools, plan, done }
}

const line = (text, re) =>
  text
    .split('\n')
    .find(l => re.test(l))
    ?.trim()

test('toolbar locks use source checks, editor writes and ordinary undo history', { timeout: 120000 }, async () => {
  const root = project(),
    file = join(root, 'pcb.tsx'),
    s = await serve(root)
  let c
  try {
    c = await client(s.info, 'editor', root)
    c.type(file, BOARD)
    await c.request('session/check')
    const query = { board: 'Edit', ref: 'TP1' }
    assert.deepEqual(await c.request('session/edit/lock', query), { locked: false, reason: null })
    const { done } = await drag(c, { tool: 'lock', refs: ['TP1'], anchor: 'TP1' }, { locked: true })
    assert.match(c.docs.get(file), /<TP1 at="5 10" locked \/>/)
    assert.equal(done.written[0].via, 'editor')
    await c.request('session/check')
    assert.deepEqual(await c.request('session/edit/lock', query), { locked: true, reason: null })
    await c.request('session/edit/undo', { txn: done.txn })
    assert.equal(c.docs.get(file), BOARD)
    await c.request('session/edit/redo', { txn: done.txn })
    assert.match(c.docs.get(file), /<TP1 at="5 10" locked \/>/)
    await drag(c, { tool: 'lock', refs: ['TP1'], anchor: 'TP1' }, { locked: false })
    assert.equal(c.docs.get(file), BOARD)
    c.type(file, BOARD.replace('<TP1 at="5 10" />', '<TP1 at="5 10" locked={false} />'))
    await c.request('session/check')
    assert.match((await c.request('session/edit/lock', query)).reason, /derived from an expression/)
    await assert.rejects(drag(c, { tool: 'lock', refs: ['TP1'], anchor: 'TP1' }, { locked: true }), /expression/)
    assert.match(c.docs.get(file), /locked=\{false\}/)
  } finally {
    c?.close()
    await s.stop()
  }
})

test(
  'the tools through a fake editor: at, rotation, side, grid units, a computed at, a control point moved, deleted and inserted, X(p) and a reroute',
  { timeout: 180000 },
  async () => {
    const root = project()
    const s = await serve(root)
    const file = join(root, 'pcb.tsx')
    try {
      const ed = await client(s.info, 'editor', root)
      await ed.request('session/check')
      const text = () => ed.docs.get(file) ?? readFileSync(file, 'utf8')

      const move = await drag(ed, { tool: 'move', refs: ['TP1'], anchor: 'TP1' }, { delta: [1, 0] }, { delta: [2, 0] })
      assert.deepEqual(
        move.tools.map(t => t.id),
        ['move', 'rotate', 'layer'],
      )
      assert.deepEqual(move.plan.notes, ['writes pcb.tsx:17'])
      assert.equal(move.done.written[0].via, 'editor')
      assert.equal(line(text(), /<TP1 /), '<TP1 at="7 10" />')
      assert.equal(readFileSync(file, 'utf8'), BOARD, 'the editor holds the change, disk is as it was')

      await drag(ed, { tool: 'rotate', refs: ['TP1'], anchor: 'TP1' }, { angle: 90 })
      assert.equal(line(text(), /<TP1 /), '<TP1 at="7 10 90" />')
      await drag(ed, { tool: 'layer', refs: ['TP1'], anchor: 'TP1' }, { side: 'B' })
      assert.equal(line(text(), /<TP1 /), '<TP1 at="7 10 90" side="B" />')
      await drag(ed, { tool: 'layer', refs: ['TP1'], anchor: 'TP1' }, { side: 'F' })
      assert.equal(line(text(), /<TP1 /), '<TP1 at="7 10 90" />')
      assert.equal(ed.applied.length, 4, 'one applyEdit per commit')

      const grid = await drag(ed, { tool: 'move', refs: ['TP3'], anchor: 'TP3' }, { delta: [2.54, -2.54] })
      assert.equal(grid.done.written.length, 1)
      assert.equal(line(text(), /<TP3 /), '<TP3 at="3 1" />')
      await drag(ed, { tool: 'move', refs: ['TP3'], anchor: 'TP3' }, { delta: [0.123, 0], free: true })
      assert.equal(line(text(), /<TP3 /), '<TP3 at="7.743mm 2.54mm" />')

      const computed = await drag(ed, { tool: 'move', refs: ['TP2'], anchor: 'TP2' }, { delta: [0.5, 0] })
      assert.deepEqual(computed.plan.notes, ['writes pcb.tsx:18'])
      assert.equal(line(text(), /<TP2 /), '<TP2 at="30.5 10" />')
      assert.ok(!ed.docs.has(join(root, 'pcb.patches.ts')), 'no patch')

      await drag(ed, { tool: 'point', refs: ['route:1'], anchor: 'route:1/pt:1' }, { point: { at: [5, 16] } })
      assert.match(text(), /\.V\(16\)\.H\(20\)\.X\(\)/)
      const leg = await drag(ed, { tool: 'point', refs: ['route:1'], anchor: 'route:1/leg:1' }, { point: { at: [25, 15] } })
      assert.deepEqual(leg.plan.notes, ['writes pcb.tsx:22'])
      assert.match(text(), /\.H\(20\)\.X\('25 15'\)\.X\(\)/)
      await drag(ed, { tool: 'point', refs: ['route:1'], anchor: 'route:1/pt:2' }, { remove: true })
      assert.match(text(), /\.V\(16\)\.X\('25 15'\)\.X\(\)/)
      await drag(ed, { tool: 'point', refs: ['route:1'], anchor: 'route:1/pt:1' }, { point: { at: [12, 16] }, insert: true })
      assert.match(text(), /\.V\(16\)\.L\('12 16'\)\.X\('25 15'\)\.X\(\)/)
      const helper = await drag(ed, { tool: 'point', refs: ['route:2'], anchor: 'route:2/leg:1' }, { point: { at: [20, 25] } })
      assert.deepEqual(helper.plan.notes, ['writes a patch: the chain is shared or not a literal of this project'])
      assert.match(ed.docs.get(join(root, 'pcb.patches.ts')), /patch\('route:2\/leg:1', \{ reroute: \{ through: \['20 25'\] \} \}, '[0-9a-f]{12}'\)/)
      const refs = ['TP1', 'TP2', 'net:V']
      await drag(ed, { tool: 'move', refs, anchor: 'TP1' }, { delta: [1, 2] })
      assert.equal(line(text(), /<TP1 /), '<TP1 at="8 12 90" />')
      assert.equal(line(text(), /<TP2 /), '<TP2 at="31.5 12" />')
      await drag(ed, { tool: 'rotate', refs, anchor: 'TP1' }, { angle: 90 })
      assert.equal(line(text(), /<TP1 /), '<TP1 at="19.75 23.75 180" />')
      assert.equal(line(text(), /<TP2 /), '<TP2 at="19.75 0.25 90" />')
      await drag(ed, { tool: 'layer', refs, anchor: 'TP1' }, { side: 'B' })
      assert.equal(line(text(), /<TP1 /), '<TP1 at="19.75 23.75 180" side="B" />')
      assert.equal(line(text(), /<TP2 /), '<TP2 at="19.75 0.25 90" side="B" />')
      assert.match(text(), /const \{ V, W \} = nets\(\)/, 'the non-placement net does not become a source edit')
      await drag(ed, { tool: 'rotate', refs: ['TP2'], anchor: 'TP2' }, { angle: 90 })
      assert.equal(line(text(), /<TP2 /), '<TP2 at="19.75 0.25 180" side="B" />', 'a single eligible member rotates at its own origin, not an excluded selection anchor')
      assert.equal(line(text(), /<TP1 /), '<TP1 at="19.75 23.75 180" side="B" />', 'excluded placement remains unchanged')
      ed.close()
    } finally {
      await s.stop()
    }
  },
)

test('the tools on disk with no editor, a tool the anchor lacks, a stale begin and a literal changed under a drag', { timeout: 180000 }, async () => {
  const root = project()
  const s = await serve(root)
  const file = join(root, 'pcb.tsx')
  try {
    const cli = await client(s.info, 'cli', root)
    await cli.request('session/check')
    const moved = await drag(cli, { tool: 'move', refs: ['TP1'], anchor: 'TP1' }, { delta: [-1, 0.5] })
    assert.deepEqual(moved.done.written, [{ file, via: 'disk', applied: true }])
    assert.equal(line(readFileSync(file, 'utf8'), /<TP1 /), '<TP1 at="4 10.5" />')
    await assert.rejects(cli.request('session/edit/begin', { board: 'Edit', tool: 'move', refs: ['TP1'], anchor: 'TP1', run: 1e6 }), /changed since the view drew it/)
    await assert.rejects(cli.request('session/edit/begin', { board: 'Edit', tool: 'point', refs: ['TP1'], anchor: 'TP1' }), /takes no point tool/)
    const { txn } = await cli.request('session/edit/begin', { board: 'Edit', tool: 'move', refs: ['TP1'], anchor: 'TP1' })
    await cli.request('session/edit/update', { txn, delta: [1, 0] })
    writeFileSync(file, readFileSync(file, 'utf8').replace('at="4 10.5"', 'at="4 11"'))
    const refused = await cli.request('session/edit/commit', { txn })
    assert.match(refused.error, /source changed since the drag began/)
    assert.equal(line(readFileSync(file, 'utf8'), /<TP1 /), '<TP1 at="4 11" />')
    assert.ok(!existsSync(join(root, 'pcb.patches.ts')))
    cli.close()
  } finally {
    await s.stop()
  }
})

test('a read-only session refuses the tools and writes nothing', { timeout: 120000 }, async () => {
  const root = project()
  const s = await serve(root, '--edit', 'none')
  try {
    const c = await client(s.info, 'cli', root)
    await c.request('session/check')
    await assert.rejects(c.request('session/edit/begin', { board: 'Edit', tool: 'move', refs: ['TP1'], anchor: 'TP1' }), /read-only/)
    assert.equal(readFileSync(join(root, 'pcb.tsx'), 'utf8'), BOARD)
    c.close()
  } finally {
    await s.stop()
  }
})

test(
  'an assist pick: the editor cursor in an empty .H() previews the trace and its clearance finding, and a pick writes the argument and moves the cursor on',
  { timeout: 180000 },
  async () => {
    const root = project()
    const s = await serve(root)
    const file = join(root, 'pcb.tsx')
    try {
      const ed = await client(s.info, 'editor', root)
      const typed = BOARD.replace('  </PCB>', '    {route(TP1[1], TP2[1]).H()}\n  </PCB>')
      ed.type(file, typed)
      await ed.request('session/check')
      const at = typed.indexOf('.H()') + 3
      ed.focus(file, at)
      let begun = null
      await until(async () => {
        begun = await ed.request('session/edit/begin', { board: 'Edit', tool: 'assist', refs: [], anchor: 'assist' }).catch(() => null)
        return !!begun
      })
      // shift: the straight l would cross TP1/2, so the pick is an automatic leg routed around it against the current copper
      const auto = await ed.request('session/edit/update', { txn: begun.txn, point: { at: [20, 10] }, pick: true })
      assert.equal(auto.preview.command, 'X')
      assert.ok(auto.preview.tracks.length && !auto.findings.length, JSON.stringify(auto.preview))
      const plan = await ed.request('session/edit/update', { txn: begun.txn, point: { at: [20, 12] } })
      assert.deepEqual(plan.preview.tracks, [
        {
          layer: 'F.Cu',
          pts: [
            [5, 10],
            [20, 10],
          ],
        },
      ])
      assert.ok(
        plan.findings.some(f => /^clearance: 0 mm to pad TP1\/2 \(W\) on F\.Cu/.test(f)),
        plan.findings.join('; '),
      )
      const done = await ed.request('session/edit/commit', { txn: begun.txn })
      assert.equal(done.written[0].via, 'editor')
      assert.match(ed.docs.get(file), /\{route\(TP1\[1\], TP2\[1\]\)\.H\(20\)\}/)
      const after = ed.docs.get(file).lastIndexOf('.H(20)') + '.H(20)'.length
      const line = ed.docs.get(file).slice(0, after).split('\n')
      const cursor = { line: line.length - 1, character: line[line.length - 1].length }
      const moved = ed.notes.filter(n => n.method === 'pcbjs/select').map(n => n.params.items[0].ranges[0])
      assert.ok(
        moved.some(r => JSON.stringify(r) === JSON.stringify({ start: cursor, end: cursor })),
        JSON.stringify(moved),
      )
      ed.close()
    } finally {
      await s.stop()
    }
  },
)

/** The demo's Blinky alone in a project of its own. */
function blinky() {
  const root = project()
  const demo = join(REPO, 'examples', 'demo')
  for (const f of ['blinky.pcb.tsx', 'blinky.sch.tsx', 'blinky.sourcing.ts', 'lib/led-channel.tsx', 'lib/MyPart.tsx']) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), readFileSync(join(demo, f), 'utf8'))
  }
  writeFileSync(
    join(root, 'pcb.config.ts'),
    "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['blinky.pcb.tsx'], vite: { logLevel: 'silent' } })\n",
  )
  return root
}

const OWN = '<LedChannelRow g={CH1} at="16 5" label="LED1">\n      <CH1.R at="-3mm 0" />\n    </LedChannelRow>'

for (const via of ['editor', 'disk'])
  test(
    `a drag of R1 in Blinky, placed by the layout's shared <g.R at="-4mm 0">, gives R1 its own placement through the ${via}; R2 and R3 keep the shared one`,
    { timeout: 180000 },
    async () => {
      const root = blinky()
      const s = await serve(root)
      const board = join(root, 'blinky.pcb.tsx'),
        layout = join(root, 'lib', 'led-channel.tsx')
      try {
        const c = await client(s.info, via === 'editor' ? 'editor' : 'cli', root)
        await c.request('session/check')
        const at = async ref => (await c.request('session/q', { reference: ref })).value.record.at
        const [r2, r3] = [await at('R2'), await at('R3')]
        const moved = await drag(c, { board: 'Blinky', tool: 'move', refs: ['R1'], anchor: 'R1' }, { delta: [1, 0] })
        assert.deepEqual(moved.plan.notes, ['writes blinky.pcb.tsx:23, an own placement of R1 in CH1'])
        assert.deepEqual(
          moved.done.written.map(w => [w.file, w.via]),
          [[board, via]],
        )
        const text = via === 'editor' ? c.docs.get(board) : readFileSync(board, 'utf8')
        assert.ok(text.includes(OWN), text)
        assert.ok(!c.docs.has(layout) && readFileSync(layout, 'utf8').includes('<g.R at="-4mm 0" />'), 'the shared placement stays')
        assert.ok(!existsSync(join(root, 'blinky.pcb.patches.ts')) && !c.docs.has(join(root, 'blinky.pcb.patches.ts')), 'no patch')
        if (via === 'disk') {
          await c.request('session/check')
          assert.deepEqual((await at('R1')).slice(0, 2), [13, 5])
          assert.deepEqual([await at('R2'), await at('R3')], [r2, r3])
          const again = await drag(c, { board: 'Blinky', tool: 'move', refs: ['R1'], anchor: 'R1' }, { delta: [0, 1] })
          assert.deepEqual(again.plan.notes, ['writes blinky.pcb.tsx:24'])
          assert.ok(readFileSync(board, 'utf8').includes('<CH1.R at="-3mm 1" />'))
        }
        c.close()
      } finally {
        await s.stop()
      }
    },
  )

// ---- isolation: every edit writes the definition, all instances follow ----

const LAYOUT = 'lib/led-channel.tsx'
const layoutLine = needle =>
  readFileSync(join(REPO, 'examples/demo', LAYOUT), 'utf8')
    .split('\n')
    .findIndex(line => line.includes(needle)) + 1

test('in isolation a part with an own placement in its instance says so and the definition is not written; undo takes a definition write back', { timeout: 180000 }, async () => {
  const root = blinky()
  const board = join(root, 'blinky.pcb.tsx'),
    layout = join(root, LAYOUT)
  writeFileSync(board, readFileSync(board, 'utf8').replace('<LedChannelRow g={CH1} at="16 5" label="LED1" />', OWN))
  const s = await serve(root)
  try {
    const c = await client(s.info, 'cli', root)
    await c.request('session/check')
    const own = await drag(c, { board: 'Blinky', tool: 'move', refs: ['R1'], anchor: 'R1', isolate: 'CH1' }, { delta: [1, 0] })
    assert.deepEqual(own.plan.notes, ['R1: its own placement in CH1 keeps it; the definition is not written'])
    assert.deepEqual(own.done.written, [])
    assert.ok(readFileSync(layout, 'utf8').includes('<g.R at="-4mm 0" />'))
    const shared = await drag(c, { board: 'Blinky', tool: 'move', refs: ['R2'], anchor: 'R2', isolate: 'CH2' }, { delta: [1, 0] })
    assert.deepEqual(shared.plan.notes, [`writes ${LAYOUT}:${layoutLine('<g.R at=')}, 2 instances follow`], 'CH1 keeps its own, the two others follow')
    assert.ok(readFileSync(layout, 'utf8').includes('<g.R at="-3mm 0" />'))
    // undo inside the isolation takes the definition's write back
    const { txn } = await c.request('session/edit/undo')
    assert.ok(txn)
    assert.ok(readFileSync(layout, 'utf8').includes('<g.R at="-4mm 0" />'), 'the layout restored')
    c.close()
  } finally {
    await s.stop()
  }
})

test('library layout edits shared placement under an overridden instance without changing its own placement', { timeout: 180000 }, async () => {
  const root = blinky(),
    board = join(root, 'blinky.pcb.tsx'),
    layout = join(root, LAYOUT)
  writeFileSync(board, readFileSync(board, 'utf8').replace('<LedChannelRow g={CH1} at="16 5" label="LED1" />', OWN))
  const originalBoard = readFileSync(board, 'utf8')
  const s = await serve(root)
  try {
    const c = await client(s.info, 'cli', root)
    await c.request('session/check')
    await c.request('session/select', {
      board: 'Blinky',
      selection: {
        board: 'Blinky',
        target: null,
        snapshot: '',
        refs: ['R1'],
        anchor: 'R1',
        level: 'CH1',
        isolate: { ref: 'CH1', context: 'CH1', instances: ['CH1', 'CH2', 'CH3'], preview: false, mode: 'library' },
        finding: null,
        by: 'viewer',
        client: null,
        seq: 0,
      },
    })
    const before = await c.request('session/layout', { board: 'Blinky', target: null, ref: 'CH1' })
    const at = before.footprints.find(f => f.ref === 'R1').at
    const moved = await drag(c, { board: 'Blinky', tool: 'move', refs: ['R1'], anchor: 'R1', isolate: 'CH1' }, { delta: [2, 0] })
    assert.equal(moved.done.written[0].file, layout)
    assert.equal(readFileSync(board, 'utf8'), originalBoard, 'the instance own placement remains unchanged')
    assert.ok(readFileSync(layout, 'utf8').includes('<g.R at="-2mm 0" />'))
    await c.request('session/check')
    const after = await c.request('session/layout', { board: 'Blinky', target: null, ref: 'CH1' })
    assert.equal(after.footprints.find(f => f.ref === 'R1').at[0], at[0] + 2)
    const rotated = await drag(c, { board: 'Blinky', tool: 'rotate', refs: ['R1'], anchor: 'R1', isolate: 'CH1' }, { angle: 90 })
    assert.equal(rotated.done.written[0].file, layout)
    assert.equal(readFileSync(board, 'utf8'), originalBoard)
    assert.match(readFileSync(layout, 'utf8'), /<g.R at="-2mm 0 90" \/>/)
    c.close()
  } finally {
    await s.stop()
  }
})

test('one preview gesture spanning source files is refused before either file changes', { timeout: 120000 }, async () => {
  const root = project(),
    file = join(root, 'pcb.tsx'),
    other = join(root, 'second.tsx')
  const original = BOARD.replace('const TP2 =', 'export const TP2 =').replace('<TP2 at={`${x} 10`} />', '<Second />')
  writeFileSync(file, "import { Second } from './second'\n" + original)
  writeFileSync(other, 'import { TP2 } from \'./pcb\'\nexport function Second() { return <TP2 at="30 10" /> }\n')
  const before = [readFileSync(file, 'utf8'), readFileSync(other, 'utf8')]
  const s = await serve(root)
  const c = await client(s.info, 'cli', root)
  try {
    const { plan, done } = await drag(c, { tool: 'move', refs: ['TP1', 'TP2'], anchor: 'TP1' }, { delta: [1, 2] })
    assert.equal(new Set(plan.files.map(f => f.file)).size, 2)
    assert.match(done.error, /only one source document/)
    assert.deepEqual(done.written, [])
    assert.deepEqual([readFileSync(file, 'utf8'), readFileSync(other, 'utf8')], before)
  } finally {
    c.close()
    await s.stop()
  }
})
