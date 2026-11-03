// The route end assist writes each handle through the identifier in scope at the cursor: a Blinky whose channels are bound as `ch1`
// and `ch2` offers `ch2.R[1]` and `ch2.vccTrunk.end`, never the instance name `CH2`, and CH3, whose `ch3` lives in a function the
// cursor is not in, is left out of the slot with the note `CH3 is not in scope here`.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dev } from './fixtures/dev.mjs'
import { initParams, posOf, sessionClient } from './fixtures/client.mjs'
import { viewerClient } from '../../cli/tests/fixtures/viewer.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-end-names-')))
const FILE = join(ROOT, 'blinky.pcb.tsx')
const SLOT = '{route(J1[2], )}'

/** Replace each `[from, to]` once, asserting it is there. */
const edit = (text, ...pairs) => pairs.reduce((t, [a, b]) => (assert.ok(t.includes(a), a), t.replace(a, b)), text)
const lower = t => t.replace(/(?<!')\bCH([12])\b(?!')/g, 'ch$1')

let server, client, TEXT
before(async () => {
  const demo = join(REPO, 'examples', 'demo')
  for (const f of ['tsconfig.json', 'package.json']) cpSync(join(demo, f), join(ROOT, f))
  cpSync(join(demo, 'lib'), join(ROOT, 'lib'), { recursive: true })
  mkdirSync(join(ROOT, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(ROOT, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(
    join(ROOT, 'pcb.config.ts'),
    "import { defineConfig, defineDefaultBoard } from '@pcbjs/core'\nimport { JLCPCB } from '@pcbjs/lib/rules'\ndefineDefaultBoard({ rules: JLCPCB })\nexport default defineConfig({ entries: ['blinky.pcb.tsx'], vite: { logLevel: 'silent' } })\n",
  )
  // the channel binds its supply track as vccTrunk, which the row layout places
  const sch = join(ROOT, 'lib', 'led-channel.sch.ts')
  writeFileSync(
    sch,
    edit(
      readFileSync(sch, 'utf8'),
      ["import { circuit, type Ports } from '@pcbjs/core'", "import { circuit, route, type Ports } from '@pcbjs/core'"],
      ['=> ({\n', "=> {\n  const vccTrunk = route('-7 0').net(VCC).width(0.3).H(-4.825)\n  return {\n    vccTrunk,\n"],
      ['}),\n}))', '}),\n  }\n})'],
    ),
  )
  const row = join(ROOT, 'lib', 'led-channel.layout.tsx')
  writeFileSync(row, edit(readFileSync(row, 'utf8'), ["{route('-7 0').net(g.ports.VCC).width(0.3).H(-4.825)}", '{g.vccTrunk}']))
  const show = f => execFileSync('git', ['show', `HEAD:examples/demo/${f}`], { cwd: REPO, encoding: 'utf8' })
  writeFileSync(
    join(ROOT, 'blinky.sch.tsx'),
    edit(
      lower(show('blinky.sch.tsx')),
      [
        "export const CH3 = ledChannel({ VCC, SW }, 'CH3')",
        "const third = () => {\n  const ch3 = ledChannel({ VCC, SW }, 'CH3')\n  return ch3\n}\nexport const channels = [third()]",
      ],
      ['{channel(CH3, 19)}', '{channel(channels[0], 19)}'],
      ['.Z(CH3.D.K)', '.Z(channels[0].D.K)'],
    ),
  )
  writeFileSync(join(ROOT, 'blinky.sourcing.ts'), edit(lower(show('blinky.sourcing.ts')), ['ch2, CH3 }', 'ch2, channels }'], ['ch2, CH3]', 'ch2, ...channels]']))
  // J1/2 loses its track to the VCC bus, so every other VCC end is open from it
  const board = edit(lower(show('blinky.pcb.tsx')), ["    {route('3 10').net(VCC).width(0.3).H(9)}\n", ''], ['g={CH3}', 'g={channels[0]}'])
  writeFileSync(FILE, board)
  TEXT = edit(board, ['    <Brand', `    ${SLOT}\n    <Brand`])
  server = await dev({ root: ROOT, port: 0, host: '127.0.0.1' })
  server.config.logger.info = () => {}
  const port = server.httpServer.address().port
  const site = await (await fetch(`http://127.0.0.1:${port}/__pcbjs/Blinky/board.json`)).json()
  assert.ok(
    site.routes.some(r => r.id === 'CH2/route:vccTrunk'),
    'the trunk is bound',
  )
  client = await sessionClient(port)
  await client.conn.sendRequest('initialize', initParams(ROOT))
  await client.conn.sendNotification('initialized', {})
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: pathToFileURL(FILE).href, languageId: 'typescriptreact', version: 1, text: TEXT } })
})
after(async () => {
  client?.close()
  await server?.close()
  rmSync(ROOT, { recursive: true, force: true })
})

const slot = () => posOf(TEXT, SLOT, 'route(J1[2], '.length + 1)

test('completion names the channels by their variables: ch2.R[1] and ch2.vccTrunk.end, never CH2, and nothing of CH3', async () => {
  const r = await client.conn.sendRequest('textDocument/completion', { textDocument: { uri: pathToFileURL(FILE).href }, position: slot() })
  const labels = r.items.map(i => i.label)
  for (const h of ['ch1.R[1]', 'ch2.R[1]', 'ch2.vccTrunk.end', 'ch2.vccTrunk.start', 'C1[1]']) assert.ok(labels.includes(h), `${h} in ${labels.join(' ')}`)
  assert.ok(!labels.some(h => /^CH\d/.test(h)), labels.join(' '))
  assert.ok(!labels.some(h => h.startsWith('ch3') || h.startsWith('channels')), labels.join(' '))
  assert.equal(r.items.find(i => i.label === 'ch2.R[1]').detail, '1 · VCC')
})

test('the views get the same handles and the note for CH3, whose variable is in a function the cursor is not in', async () => {
  const port = server.httpServer.address().port
  const view = await viewerClient(port)
  const got = []
  view.on((event, d) => event === 'pcbjs:assist' && d.assist?.ends && got.push(d.assist))
  await view.observe('Blinky')
  await new Promise(r => setTimeout(r, 300))
  await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri: pathToFileURL(FILE).href }, position: slot(), selections: [] })
  for (let t = 0; !got.length && t < 200; t++) await new Promise(ok => setTimeout(ok, 50))
  view.close()
  const ends = got[0].ends
  assert.deepEqual(ends.notes, ['CH3 is not in scope here'])
  const handles = ends.candidates.map(c => c.handle)
  assert.ok(handles.includes('ch2.R[1]') && handles.includes('ch2.vccTrunk.end'), handles.join(' '))
  assert.ok(!ends.candidates.some(c => c.ref.startsWith('R3/') || c.ref.startsWith('CH3/')), handles.join(' '))
})

test('in the layout, the render parameter g names every instance it lays out: the definition offers g.R[1], never ch1 or CH1', async () => {
  const row = join(ROOT, 'lib', 'led-channel.layout.tsx')
  const SLOT2 = '{route()}'
  const text = edit(readFileSync(row, 'utf8'), ['      {g.vccTrunk}', `      {g.vccTrunk}\n      ${SLOT2}`])
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri: pathToFileURL(row).href, languageId: 'typescriptreact', version: 1, text } })
  const r = await client.conn.sendRequest('textDocument/completion', {
    textDocument: { uri: pathToFileURL(row).href },
    position: posOf(text, SLOT2, '{route('.length),
  })
  const labels = r.items.map(i => i.label)
  assert.ok(labels.includes('g.R[1]'), labels.join(' '))
  assert.ok(!labels.some(h => /^(ch|CH)\d/.test(h)), labels.join(' '))
})
