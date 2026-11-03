// The route end assist on Blinky with two of its tracks taken out, so VCC and SIG are open: `route(|)` gives the terminals with an
// open ratsnest line, `route(A, |)` and the ends list `route(A, B, |)` the terminals of A's net on another island than A's, nothing
// on another net and nothing already joined; bound route points by their handles; the completion lists the same set, and each item
// the editor resolves lights in the views until the cursor leaves the slot.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dev } from './fixtures/dev.mjs'
import { assistSpot, assistContexts, endEdit } from '../dist/assist.js'
import { initParams, posOf, sessionClient } from './fixtures/client.mjs'
import { docOf, parse } from '../dist/doc.js'
import { viewerClient } from '../../cli/tests/fixtures/viewer.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-ends-')))
const FILE = join(ROOT, 'blinky.pcb.tsx')
// J1/2 loses its track to the VCC bus and J1/3 its route to Q1/1
const OPEN = ["    {route('3 10').net(VCC).width(0.3).H(9)}\n", "    {route(J1[3], Q1[1]).width(0.25).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu')}\n"]

let server, site, client, TEXT
before(async () => {
  const library = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'examples/demo/lib'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n')
  // Keep the committed board and all of its geometry dependencies in the same snapshot.
  for (const file of [...['blinky.sch.tsx', 'blinky.sourcing.ts', 'tsconfig.json', 'package.json'].map(f => `examples/demo/${f}`), ...library]) {
    const target = join(ROOT, file.slice('examples/demo/'.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, execFileSync('git', ['show', `HEAD:${file}`], { cwd: REPO }))
  }
  mkdirSync(join(ROOT, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(ROOT, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(
    join(ROOT, 'pcb.config.ts'),
    "import { defineConfig, defineDefaultBoard } from '@pcbjs/core'\nimport { JLCPCB } from '@pcbjs/lib/rules'\ndefineDefaultBoard({ rules: JLCPCB })\nexport default defineConfig({ entries: ['blinky.pcb.tsx'], vite: { logLevel: 'silent' } })\n",
  )
  // HEAD's Blinky, since the working copy may carry the owner's edits
  const blinky = execFileSync('git', ['show', 'HEAD:examples/demo/blinky.pcb.tsx'], { cwd: REPO, encoding: 'utf8' })
  TEXT = OPEN.reduce((t, l) => (assert.ok(t.includes(l), l), t.replace(l, '')), blinky)
  writeFileSync(FILE, TEXT)
  server = await dev({ root: ROOT, port: 0, host: '127.0.0.1' })
  server.config.logger.info = () => {}
  const port = server.httpServer.address().port
  site = await (await fetch(`http://127.0.0.1:${port}/__pcbjs/Blinky/board.json`)).json()
  client = await sessionClient(port)
  await client.conn.sendRequest('initialize', initParams(ROOT))
  await client.conn.sendNotification('initialized', {})
})
after(async () => {
  client?.close()
  await server?.close()
  rmSync(ROOT, { recursive: true, force: true })
})

/** Blinky with one more line, the cursor at its `|`. */
function marked(line) {
  const body = TEXT.replace('    <Brand', `    ${line}\n    <Brand`)
  return { text: body.replace('|', ''), offset: body.indexOf('|') }
}
function context(line, s = site) {
  const { text, offset } = marked(line)
  const spot = assistSpot(parse(text, FILE), offset)
  if (!spot) return null
  const [c] = assistContexts(spot, docOf(FILE, text), [{ root: ROOT, site: s }])
  return { ...c, text }
}
const handles = c => c.ends.candidates.map(k => k.handle)
const padsOn = net => site.footprints.flatMap(f => f.pads.filter(p => p.net === net).map(p => `${f.ref}/${p.num}`))

test('route(|): the terminals with an open ratsnest line, VCC and SIG, with ref, number, name, net and position', () => {
  assert.deepEqual([...new Set(site.ratsnest.map(r => r.net))].sort(), ['SIG', 'VCC'])
  const c = context('{route(|)}')
  assert.equal(c.command, 'end')
  assert.equal(c.ends.slot, 0)
  assert.equal(c.ends.append, false)
  assert.equal(c.ends.net, null)
  assert.deepEqual(c.ends.candidates.map(k => k.ref).sort(), [...padsOn('SIG'), ...padsOn('VCC')].sort())
  const j1 = site.footprints.find(f => f.ref === 'J1').pads.find(p => p.num === '2')
  assert.deepEqual(
    c.ends.candidates.find(k => k.handle === 'J1[2]'),
    { handle: 'J1[2]', label: '2 · VCC', kind: 'pad', ref: 'J1/2', num: '2', name: '2', net: 'VCC', at: j1.at, side: 'F' },
  )
  assert.equal(c.ends.candidates.find(k => k.ref === 'R2/1').handle, 'CH2.R[1]')
  assert.equal(endEdit(c.text, c, 'J1[2]', true).newText, 'J1[2], ')
})

test('route(A, |): only the terminals of A’s net on another island, nothing joined to A and nothing of another net', () => {
  const j = context('{route(J1[2], |)}')
  assert.equal(j.ends.slot, 1)
  assert.equal(j.ends.net, 'VCC')
  assert.equal(j.pad, 'J1/2')
  assert.deepEqual(
    j.ends.candidates.map(k => k.ref).sort(),
    padsOn('VCC')
      .filter(r => r !== 'J1/2')
      .sort(),
  )
  // CH1's resistor sits on the bus with every other VCC pad, so the header is its one open end
  assert.deepEqual(handles(context('{route(CH1.R[1], |)}')), ['J1[2]'])
  assert.deepEqual(handles(context('{route(J1[3], |)}')), ['Q1[1]'])
  assert.deepEqual(handles(context('{route(J1[1], |)}')), [], 'GND is whole through its pour')
  const at = endEdit(j.text, j, 'C1[1]', true)
  assert.equal(j.text.slice(0, at.start) + at.newText + j.text.slice(at.end), marked('{route(J1[2], C1[1])}').text)
})

test('the ends list and the cursor after a written end: the open ends left, which a pick appends to with a comma', () => {
  const list = context('{route(J1[2], CH1.R[1], |)}')
  assert.equal(list.ends.slot, 2)
  assert.equal(list.ends.net, 'VCC')
  assert.deepEqual(
    list.ends.candidates.map(k => k.ref).sort(),
    padsOn('VCC')
      .filter(r => r !== 'J1/2' && r !== 'R1/1')
      .sort(),
  )
  const tail = context('{route(J1[2], CH1.R[1]|)}')
  assert.equal(tail.ends.append, true)
  assert.equal(endEdit(tail.text, tail, 'C1[1]').newText, ', C1[1]')
  const typing = context('{route(J1[2], C1|)}')
  assert.equal(typing.ends.append, false)
  assert.equal(typing.text.slice(typing.start0, typing.end0), 'C1')
  assert.equal(context('{route(J1[2], C1[1]).H(|)}').command, 'H')
  assert.equal(context('{route([a, b], |)}'), null)
})

test('bound route points: .start, .pt(k) and .end by the instance path of the route id, on the island of the route’s copper', () => {
  const track = site.items.find(it => it.kind === 'track' && it.net === 'VCC')
  const s = {
    ...site,
    items: site.items.map(it => (it === track ? { ...it, route: 'CH2/route:vccTrunk' } : it)),
    routes: [
      ...(site.routes ?? []),
      {
        id: 'CH2/route:vccTrunk',
        path: 'H(11)',
        net: 'VCC',
        length: 4,
        pts: [
          [9, 10],
          [9, 12],
          [11, 12],
        ],
      },
    ],
  }
  assert.deepEqual(
    context('{route(J1[2], |)}', s)
      .ends.candidates.filter(k => k.kind === 'point')
      .map(k => [k.handle, k.label]),
    [
      ['CH2.vccTrunk.end', 'end · VCC'],
      ['CH2.vccTrunk.pt(1)', 'pt 1 · VCC'],
      ['CH2.vccTrunk.start', 'start · VCC'],
    ],
  )
  assert.equal(context('{route(J1[2], |)}', s).ends.candidates.find(k => k.handle === 'CH2.vccTrunk.end').ref, 'CH2/route:vccTrunk/pt:2', 'the reference P1 names it by')
  assert.ok(!handles(context('{route(CH1.R[1], |)}', s)).some(h => h.startsWith('CH2.vccTrunk')), 'on the bus, so joined to CH1.R[1]')
  const from = context('{route(CH2.vccTrunk.end, |)}', s)
  assert.equal(from.ends.net, 'VCC')
  assert.deepEqual(from.start, [11, 12])
  assert.deepEqual(handles(from), ['J1[2]'])
})

test('completion in the slot: the same candidates and labels, each replacing the slot', async () => {
  const { text } = marked('{route(J1[2], |)}')
  const uri = pathToFileURL(FILE).href
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  const r = await client.conn.sendRequest('textDocument/completion', { textDocument: { uri }, position: posOf(text, 'route(J1[2], ', 'route(J1[2], '.length) })
  const c = context('{route(J1[2], |)}')
  assert.ok(c.ends.candidates.length >= 4)
  assert.deepEqual(
    r.items.map(i => [i.label, i.labelDetails.description]),
    c.ends.candidates.map(k => [k.handle, k.label]),
  )
  assert.equal(r.items[0].textEdit.newText, c.ends.candidates[0].handle)
  assert.ok(r.items.every(i => / · VCC$/.test(i.detail)))
  const none = await client.conn.sendRequest('textDocument/completion', { textDocument: { uri }, position: posOf(text, 'W = 30') })
  assert.equal(none, null)
})

test('completion focus: each resolved item lights in the views as pcbjs:assist:focus, following the list, and clears when the cursor leaves the slot', async () => {
  const port = server.httpServer.address().port
  const view = await viewerClient(port)
  const got = []
  view.on((event, d) => event === 'pcbjs:assist:focus' && got.push({ board: d.board, handle: d.handle }))
  await view.observe('Blinky')
  await new Promise(r => setTimeout(r, 300))
  const { text } = marked('{route(J1[2], |)}')
  const uri = pathToFileURL(FILE).href
  await client.conn.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text }] })
  const r = await client.conn.sendRequest('textDocument/completion', { textDocument: { uri }, position: posOf(text, 'route(J1[2], ', 'route(J1[2], '.length) })
  const seen = async n => {
    for (let t = 0; got.length < n && t < 100; t++) await new Promise(ok => setTimeout(ok, 50))
  }
  for (const item of r.items.slice(0, 2)) assert.equal((await client.conn.sendRequest('completionItem/resolve', item)).label, item.label)
  await seen(2)
  assert.deepEqual(got, [
    { board: 'Blinky', handle: r.items[0].label },
    { board: 'Blinky', handle: r.items[1].label },
  ])
  await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: posOf(text, 'W = 30'), selections: [] })
  await seen(3)
  assert.deepEqual(got[2], { board: 'Blinky', handle: null })
  view.close()
})
