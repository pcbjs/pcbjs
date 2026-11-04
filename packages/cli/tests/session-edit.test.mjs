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

test('trace primitive case conversions preserve world endpoints and layer changes update the initial route stage', { timeout: 120000 }, async () => {
  const root = project(),
    s = await serve(root),
    file = join(root, 'pcb.tsx')
  try {
    const c = await client(s.info, 'editor', root)
    c.type(file, readFileSync(file, 'utf8'))
    const begin = { tool: 'point', refs: ['route:1'], anchor: 'route:1/pt:2' }
    const points = async () => (await c.request('session/q', { reference: 'route:1' })).value.record.points.map(p => p.at)
    await c.request('session/check')
    const before = await points()
    await assert.rejects(drag(c, { ...begin, anchor: 'route:1/pt:1' }, { command: 'Z' }), /final trace primitive/)
    assert.equal(c.docs.get(file), readFileSync(file, 'utf8'), 'a terminal primitive cannot discard the following chain')
    await drag(c, begin, { command: 'h' })
    assert.match(c.docs.get(file), /\.V\(14\)\.h\(15\)\.X\(\)/)
    await c.request('session/check')
    assert.deepEqual(await points(), before)
    await drag(c, begin, { command: 'H' })
    assert.match(c.docs.get(file), /\.V\(14\)\.H\(20\)\.X\(\)/)
    await c.request('session/check')
    assert.deepEqual(await points(), before)
    await drag(c, begin, { layer: 'B.Cu' })
    assert.match(c.docs.get(file), /route\(TP1\[1\], TP2\[1\]\)\.layer\("B.Cu"\)/)
    const start = c.docs.get(file)
    await assert.rejects(drag(c, begin, { command: 'eval' }), /cannot be converted/)
    assert.equal(c.docs.get(file), start)
    c.close()
  } finally {
    await s.stop()
  }
})

test('segment deletion and insertion preserve downstream relative endpoints through a rotated frame and via boundary', { timeout: 120000 }, async () => {
  const root = project(),
    file = join(root, 'pcb.tsx')
  const initial = BOARD.replace(
    '    {route(TP1[1], TP2[1]).width(0.3).V(14).H(20).X()}',
    "    <g at=\"10 20 90\">{route('0 0').net(V).width(0.3).h(5).via('B.Cu').width(0.4).v(4).l(3, 2)}</g>",
  )
  writeFileSync(file, initial)
  const s = await serve(root)
  try {
    const c = await client(s.info, 'editor', root)
    c.type(file, initial)
    const points = async () => (await c.request('session/q', { reference: 'route:1' })).value.record.points.map(p => p.at)
    await c.request('session/check')
    const before = await points()
    const edit = (anchor, update) => drag(c, { tool: 'point', refs: ['route:1'], anchor }, update)
    await edit('route:1/pt:1', { remove: true })
    assert.match(c.docs.get(file), /\.via\('B.Cu'\)\.width\(0\.4\)\.l\(5, 4\)\.l\(3, 2\)/)
    await c.request('session/check')
    assert.deepEqual((await points()).slice(-2), before.slice(-2), 'surviving endpoints remain fixed in world coordinates')
    const boundary = c.docs.get(file)
    const zero = await edit('route:1/pt:0', { remove: true })
    assert.deepEqual(zero.done.written, [])
    assert.equal(c.docs.get(file), boundary, 'the route start is not a deletable primitive')
    await edit('route:1/pt:4', { remove: true })
    assert.doesNotMatch(c.docs.get(file), /\.l\(3, 2\)/, 'the final primitive can be deleted')
    c.type(file, initial)
    await edit('route:1/pt:0', { point: { at: [12, 18] }, insert: true })
    assert.match(c.docs.get(file), /\.L\('2 2'\)\.l\(3, -2\)\.via\('B.Cu'\)/)
    await c.request('session/check')
    assert.deepEqual((await points()).slice(-2), before.slice(-2), 'insertion compensates the following relative axis without moving later endpoints')
    c.type(file, initial)
    await edit('route:1/pt:1', { point: { at: [11, 14] }, insert: true })
    assert.match(c.docs.get(file), /\.h\(5\)\.L\('6 1'\)\.via\('B.Cu'\)\.width\(0\.4\)\.l\(-1, 3\)/)
    await c.request('session/check')
    assert.deepEqual((await points()).slice(-2), before.slice(-2), 'insertion scans across via and width modifiers')
    const absolute = initial.replace(".h(5).via('B.Cu').width(0.4).v(4)", '.V(5).H(10)')
    c.type(file, absolute)
    await c.request('session/check')
    const absoluteBefore = await points()
    await edit('route:1/pt:1', { remove: true })
    assert.match(c.docs.get(file), /\.L\(10, 5\)/)
    await c.request('session/check')
    assert.deepEqual((await points()).slice(-2), absoluteBefore.slice(-2), 'absolute axis endpoint is retained after deleting its orthogonal predecessor')
    c.close()
  } finally {
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
      assert.ok(auto.preview.ms < 1000, `${auto.preview.ms} ms`)
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

const ROW = /<LedChannelRow g=\{CH1\}[^\n]*\/>/

test('CH1 in Blinky, placed by <LedChannelRow g={CH1} at="16 5">: a drag, a turn and a flip write that element, its parts follow', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  const board = join(root, 'blinky.pcb.tsx')
  try {
    const c = await client(s.info, 'editor', root)
    c.type(board, readFileSync(board, 'utf8'))
    const at = async ref => (await c.request('session/q', { reference: ref })).value.record.at
    const moved = await drag(c, { board: 'Blinky', tool: 'move', refs: ['CH1'], anchor: 'CH1' }, { delta: [2, 0] })
    assert.deepEqual(
      moved.tools.map(t => t.id),
      ['move', 'rotate', 'layer'],
    )
    assert.deepEqual(moved.plan.notes, ['writes blinky.pcb.tsx:23'])
    assert.equal(c.applied.length, 1)
    assert.equal(line(c.docs.get(board), ROW), '<LedChannelRow g={CH1} at="18 5" label="LED1" />')
    await c.request('session/check')
    assert.deepEqual((await at('R1')).slice(0, 2), [14, 5], 'R1 follows in the instance frame')
    assert.deepEqual((await at('R2')).slice(0, 2), [12, 10], 'CH2 stays')
    await drag(c, { board: 'Blinky', tool: 'rotate', refs: ['CH1'], anchor: 'CH1' }, { angle: 90 })
    assert.equal(line(c.docs.get(board), ROW), '<LedChannelRow g={CH1} at="18 5 90" label="LED1" />')
    await c.request('session/check')
    assert.deepEqual((await at('R1')).slice(0, 2), [18, 9], 'R1 turns about the centered channel origin')
    assert.deepEqual((await at('D1')).slice(0, 2), [18, 1], 'D1 turns about the same centered origin')
    await drag(c, { board: 'Blinky', tool: 'layer', refs: ['CH1'], anchor: 'CH1' }, { side: 'B' })
    assert.equal(line(c.docs.get(board), ROW), '<LedChannelRow g={CH1} at="18 5 90" label="LED1" side="B" />')
    assert.equal(c.applied.length, 3, 'one applyEdit per gesture')
    assert.ok(readFileSync(join(root, 'lib', 'led-channel.tsx'), 'utf8').includes('<g.R at="-4mm 0" />'), 'the layout is untouched')
    c.close()
  } finally {
    await s.stop()
  }
})

test('a text of the board moves through its own <text at>, and a text a layout draws for each instance takes no tools', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  const board = join(root, 'blinky.pcb.tsx')
  try {
    const c = await client(s.info, 'editor', root)
    c.type(board, readFileSync(board, 'utf8'))
    await c.request('session/check')
    const { facets } = await c.request('session/facets', { entry: 'blinky.pcb.tsx', facets: ['meta'] })
    const edit = facets[0].data.edit
    const text = edit.find(e => e.ref.startsWith('item:') && e.src.at.line === 27)
    assert.deepEqual(text.caps, ['placed'], 'move and rotate, no side')
    assert.ok(!edit.some(e => e.src.at?.file === 'lib/led-channel.tsx' && e.ref.startsWith('item:')), 'the LED labels have no element of their own')
    const moved = await drag(c, { board: 'Blinky', tool: 'move', refs: [text.ref], anchor: text.ref }, { delta: [1, 0] })
    assert.deepEqual(moved.plan.notes, ['writes blinky.pcb.tsx:27'])
    assert.equal(line(c.docs.get(board), /<text layer="B\.SilkS"/), '<text layer="B.SilkS" at="16 8.3" size={0.8}>')
    c.close()
  } finally {
    await s.stop()
  }
})

const NEST = `import PCB, { nets, circuit, layout } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

const chan = circuit('chan', ({ VCC, SW }, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  return { R01, D01 }
})
const pair = circuit('pair', ({ VCC, SW }) => {
  const A1 = chan({ VCC, SW }, 'A1')
  const B2 = chan({ VCC, SW }, 'B2')
  return { A1, B2 }
})
const Row = layout(chan, (g, { at }) => <g at={at}><g.R01 at="2 0" /><g.D01 at="6 0" /></g>, 'Row')
const Pair = layout(pair, (g, { at }) => <g at={at}><Row g={g.A1} at="0 0 90" /><g at="10 0"><Row g={g.B2} /></g></g>, 'Pair')

export const { VCC, SW } = nets()
const P1 = pair({ VCC, SW }, 'P1')

export default (
  <PCB name="Nest">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <Pair g={P1} at="5 5" />
  </PCB>
)
`

test('an instance in an instance: a drag of P1/A1 writes its <Row at> in the parent layout, P1/B2 with no at takes no tools', { timeout: 180000 }, async () => {
  const root = project()
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, NEST)
  const s = await serve(root)
  try {
    const c = await client(s.info, 'editor', root)
    c.type(file, NEST)
    await c.request('session/check')
    const { done } = await drag(c, { board: 'Nest', tool: 'move', refs: ['P1/A1'], anchor: 'P1/A1' }, { delta: [1, 0] })
    assert.equal(done.written[0].via, 'editor')
    assert.match(c.docs.get(file), /<Row g=\{g\.A1\} at="1 0 90" \/>/)
    await assert.rejects(c.request('session/edit/begin', { board: 'Nest', tool: 'move', refs: ['P1/B2'], anchor: 'P1/B2' }), /P1\/B2 takes no move tool/)
    c.close()
  } finally {
    await s.stop()
  }
})

test('a nested element two pairs share: refused on the board, written in the isolation of its definition with 2 following', { timeout: 180000 }, async () => {
  const root = project()
  const file = join(root, 'pcb.tsx')
  const text = NEST.replace("const P1 = pair({ VCC, SW }, 'P1')", "const P1 = pair({ VCC, SW }, 'P1')\nconst P2 = pair({ VCC, SW }, 'P2')").replace(
    '<Pair g={P1} at="5 5" />',
    '<Pair g={P1} at="5 5" />\n    <Pair g={P2} at="5 12" />',
  )
  writeFileSync(file, text)
  const s = await serve(root)
  try {
    const c = await client(s.info, 'editor', root)
    c.type(file, text)
    const board = await drag(c, { board: 'Nest', tool: 'move', refs: ['P1/A1'], anchor: 'P1/A1' }, { delta: [1, 0] })
    assert.match(board.plan.notes[0], /P1\/A1: its element places 2 instances or groups/)
    assert.equal(board.done.written.length, 0)
    const iso = await drag(c, { board: 'Nest', tool: 'move', refs: ['P1/A1'], anchor: 'P1/A1', isolate: 'P1' }, { delta: [1, 0] })
    assert.deepEqual(iso.plan.notes, ['writes pcb.tsx:15, 2 instances follow'])
    assert.match(c.docs.get(file), /<Row g=\{g\.A1\} at="1 0 90" \/>/)
    c.close()
  } finally {
    await s.stop()
  }
})

// ---- isolation: every edit writes the definition, all instances follow ----

const LAYOUT = 'lib/led-channel.tsx'
const layoutLine = needle =>
  readFileSync(join(REPO, 'examples/demo', LAYOUT), 'utf8')
    .split('\n')
    .findIndex(line => line.includes(needle)) + 1
const x = async (c, ref) => (await c.request('session/q', { reference: ref })).value.record.at

test('in isolation of CH1 a drag and a turn of R1 write <g.R at> in the layout, no own placement, and the three channels follow', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  const board = join(root, 'blinky.pcb.tsx'),
    layout = join(root, LAYOUT)
  const before = readFileSync(board, 'utf8')
  try {
    const c = await client(s.info, 'editor', root)
    c.type(layout, readFileSync(layout, 'utf8'))
    const moved = await drag(c, { board: 'Blinky', tool: 'move', refs: ['R1'], anchor: 'R1', isolate: 'CH1' }, { delta: [1, 0] })
    assert.deepEqual(moved.plan.notes, [`writes ${LAYOUT}:${layoutLine('<g.R at=')}, 3 instances follow`])
    assert.deepEqual(
      moved.done.written.map(w => w.file),
      [layout],
    )
    assert.equal(line(c.docs.get(layout), /<g\.R /), '<g.R at="-3mm 0" />')
    assert.ok(!c.docs.has(board) && readFileSync(board, 'utf8') === before, 'no own placement in blinky.pcb.tsx')
    await c.request('session/check')
    for (const [r, y] of [
      ['R1', 5],
      ['R2', 10],
      ['R3', 15],
    ])
      assert.deepEqual((await x(c, r)).slice(0, 2), [13, y], `${r} follows the definition`)
    const turned = await drag(c, { board: 'Blinky', tool: 'rotate', refs: ['R1'], anchor: 'R1', isolate: 'CH1' }, { angle: 90 })
    assert.deepEqual(turned.plan.notes, [`writes ${LAYOUT}:${layoutLine('<g.R at=')}, 3 instances follow`])
    assert.match(line(c.docs.get(layout), /<g\.R /), /^<g\.R at="-3mm 0 90(deg)?" \/>$/)
    await c.request('session/check')
    for (const r of ['R1', 'R2', 'R3']) assert.equal((await c.request('session/q', { reference: r })).value.record.rot, 90, `${r} turns`)
    assert.ok(!c.docs.has(board), 'the board file is never written')
    c.close()
  } finally {
    await s.stop()
  }
})

test('in isolation a trace edit writes the layout route call and a dot pick through CH2 writes the definition in its frame', { timeout: 180000 }, async () => {
  const root = blinky()
  const s = await serve(root)
  const board = join(root, 'blinky.pcb.tsx'),
    layout = join(root, LAYOUT)
  try {
    const c = await client(s.info, 'editor', root)
    c.type(layout, readFileSync(layout, 'utf8'))
    await c.request('session/check')
    const { facets } = await c.request('session/facets', { entry: 'blinky.pcb.tsx', facets: ['meta'] })
    const ch1 = facets[0].data.edit.find(e => e.ref === 'CH1')
    assert.deepEqual(ch1.frames, [{ inst: 'CH1', m: [1, 0, 0, 1, 16, 5] }], "CH1's definition frame")
    const led = facets[0].data.edit.find(e => e.src.chain?.file === LAYOUT && e.src.chain.line === layoutLine("route('-3.175 0')") && e.m[5] === 5)
    const traced = await drag(c, { board: 'Blinky', tool: 'point', refs: [led.ref], anchor: `${led.ref}/pt:1`, isolate: 'CH1' }, { point: { at: [18.5, 5] } })
    assert.deepEqual(traced.plan.notes, [`writes ${LAYOUT}:${layoutLine("route('-3.175 0')")}, 3 instances follow`])
    assert.match(c.docs.get(layout), /route\('-3\.175 0'\)\.net\(g\.nets\.led\)\.width\(0\.3\)\.H\(2\.5\)/)
    // the editor waits in an empty .L() of the switch track; the pick lands in CH2's frame, 10 mm down
    const text = c.docs.get(layout).replace('.H(6.2)}', '.L()}')
    c.type(layout, text)
    await c.request('session/check')
    c.focus(layout, text.indexOf('.L()') + 3)
    let begun = null
    await until(async () => {
      begun = await c.request('session/edit/begin', { board: 'Blinky', tool: 'assist', refs: [], anchor: 'assist', isolate: 'CH2' }).catch(() => null)
      return !!begun
    })
    await c.request('session/edit/update', { txn: begun.txn, point: { at: [22.2, 10.5] } })
    const done = await c.request('session/edit/commit', { txn: begun.txn })
    assert.equal(done.written[0].file, layout)
    assert.match(c.docs.get(layout), /\.net\(g\.ports\.SW\)\.width\(0\.3\)\.L\(6\.2, 0\.5\)\}/)
    await c.request('session/check')
    const after = await c.request('session/facets', { entry: 'blinky.pcb.tsx', facets: ['meta'] })
    const leds = after.facets[0].data.edit.filter(e => e.src.chain?.file === LAYOUT && e.src.chain.line === layoutLine("route('-3.175 0')"))
    const ends = []
    for (const e of leds) ends.push((await c.request('session/q', { reference: e.ref })).value.record.points[1].at)
    assert.deepEqual(
      ends.sort((a, b) => a[1] - b[1]),
      [
        [18.5, 5],
        [18.5, 10],
        [18.5, 15],
      ],
      'every led track follows',
    )
    assert.ok(!c.docs.has(board))
    c.close()
  } finally {
    await s.stop()
  }
})

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

test('a named group rotation writes a pose about its translated internal grid origin', { timeout: 180000 }, async () => {
  const root = project()
  const file = join(root, 'pcb.tsx')
  writeFileSync(
    file,
    BOARD.replace("const G = defineGrid('g', { pitch: 2.54 })", "const G = defineGrid('g', { pitch: 2.54, origin: '2 3' })").replace(
      '<g grid={G} at="0 20">',
      '<g name="Group" grid={G} at="10 20 0">',
    ),
  )
  const s = await serve(root)
  try {
    const cli = await client(s.info, 'cli', root)
    const rotated = await drag(cli, { tool: 'rotate', refs: ['Group'], anchor: 'Group' }, { angle: 90 })
    assert.equal(rotated.done.written.length, 1)
    assert.equal(line(readFileSync(file, 'utf8'), /<g name=/), '<g name="Group" grid={G} at="9 25 90">')
    await drag(cli, { tool: 'rotate', refs: ['Group'], anchor: 'Group' }, { angle: -90 })
    assert.equal(line(readFileSync(file, 'utf8'), /<g name=/), '<g name="Group" grid={G} at="10 20 0">')
    cli.close()
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

test('placement grid edits persist through the editor without moving parts or named group contents', { timeout: 180000 }, async () => {
  const root = project(),
    file = join(root, 'pcb.tsx')
  writeFileSync(file, BOARD.replace('<g grid={G}', '<g name="Bank" grid={G}'))
  const s = await serve(root)
  try {
    const ed = await client(s.info, 'editor', root)
    ed.type(file, readFileSync(file, 'utf8'))
    const meta = async () => (await ed.request('session/facets', { entry: file, facets: ['meta'] })).facets[0].data
    const before = await meta()
    const result = await drag(ed, { tool: 'move', refs: ['TP3'], anchor: 'TP3' }, { grid: 0.25 })
    assert.equal(result.done.written[0].via, 'editor')
    assert.match(ed.docs.get(file), /<TP3 at="2 2" grid=\{\{ snap: 0\.25 \}\} \/>/)
    await drag(ed, { tool: 'move', refs: ['Bank'], anchor: 'Bank' }, { grid: 0.5 })
    assert.match(ed.docs.get(file), /grid=\{\{ \.\.\.\(G\), snap: 0\.5 \}\}/)
    const after = await meta()
    assert.deepEqual(after.edit.find(n => n.ref === 'TP3').snap, { pitch: 0.25 })
    assert.deepEqual(after.edit.find(n => n.ref === 'Bank').snap, { pitch: 0.5 })
    assert.deepEqual(
      after.footprints.map(f => [f.ref, f.at, f.rot]),
      before.footprints.map(f => [f.ref, f.at, f.rot]),
    )
    assert.equal(after.grids.find(g => g.name === 'g').pitch, 2.54)
    assert.equal(readFileSync(file, 'utf8').includes('snap:'), false, 'unsaved editor ownership is preserved')
    const { txn } = await ed.request('session/edit/begin', { board: 'Edit', tool: 'move', refs: ['TP1'], anchor: 'TP1' })
    await assert.rejects(ed.request('session/edit/update', { txn, grid: 0 }), /positive/)
    await ed.request('session/edit/cancel', { txn })
    ed.close()
  } finally {
    await s.stop()
  }
})

test('placement grid ownership distinguishes an instance part, its library and the layout component', { timeout: 180000 }, async () => {
  const root = blinky(),
    s = await serve(root)
  const file = join(root, 'blinky.pcb.tsx'),
    layout = join(root, 'lib/led-channel.tsx')
  try {
    const c = await client(s.info, 'cli', root)
    const meta = async () => (await c.request('session/facets', { entry: file, facets: ['meta'] })).facets[0].data
    const before = await meta()
    await drag(c, { board: 'Blinky', tool: 'move', refs: ['R1'], anchor: 'R1' }, { grid: 0.25 })
    assert.match(readFileSync(file, 'utf8'), /<CH1.R at="-4mm 0" grid=\{\{ snap: 0\.25 \}\} \/>/)
    assert.doesNotMatch(readFileSync(layout, 'utf8'), /snap:/)
    await drag(c, { board: 'Blinky', tool: 'move', refs: ['R2'], anchor: 'R2', isolate: 'CH2' }, { grid: 0.5 })
    assert.match(readFileSync(layout, 'utf8'), /<g.R at="-4mm 0" grid=\{\{ snap: 0\.5 \}\} \/>/)
    await drag(c, { board: 'Blinky', tool: 'move', refs: ['CH3'], anchor: 'CH3' }, { grid: 0.1 })
    const after = await meta()
    assert.deepEqual(after.edit.find(n => n.ref === 'CH3').snap, { pitch: 0.1 })
    assert.deepEqual(after.edit.find(n => n.ref === 'R1').snap, { pitch: 0.25 })
    assert.deepEqual(after.edit.find(n => n.ref === 'R2').snap, { pitch: 0.5 })
    assert.deepEqual(after.edit.find(n => n.ref === 'R3').snap, { pitch: 0.5 })
    assert.deepEqual(
      after.footprints.map(f => [f.ref, f.at, f.rot]),
      before.footprints.map(f => [f.ref, f.at, f.rot]),
    )
    await c.request('session/edit/undo')
    assert.equal((await meta()).edit.find(n => n.ref === 'CH3').snap, undefined)
    await c.request('session/edit/redo')
    assert.deepEqual((await meta()).edit.find(n => n.ref === 'CH3').snap, { pitch: 0.1 })
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
