// The language server on examples/motor-stack/driver, the board of the motor-stack review: routes made through the chain()
// helper of ../lib/wire.ts, outside the project, and the half bridge layout placed three times.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dev } from '@pcbjs/cli/server'
import { initParams, posOf, viteClient } from './fixtures/client.mjs'

const DRIVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'motor-stack', 'driver')
const PORT = 5293
let server, client, pcb, wire, lay

const open = async file => {
  const text = readFileSync(file, 'utf8'),
    uri = pathToFileURL(file).href
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  return { text, uri }
}
const at = (d, needle, delta = 0, n = 0) => ({ textDocument: { uri: d.uri }, position: posOf(d.text, needle, delta, n) })
// the text of a hover, after the preview image it starts with, see hover-preview.test.mjs
const hover = async (d, needle, delta, n) =>
  ((await client.conn.sendRequest('textDocument/hover', at(d, needle, delta, n)))?.contents.value ?? '').replace(/^!\[[^\]]*\]\([^)]*\)\n\n/, '')
const lenses = async d =>
  (await client.conn.sendRequest('textDocument/codeLens', { textDocument: { uri: d.uri } })).map(l => ({ line: l.range.start.line, title: l.command.title }))
const hints = async d =>
  (await client.conn.sendRequest('textDocument/inlayHint', { textDocument: { uri: d.uri }, range: { start: { line: 0, character: 0 }, end: { line: 9999, character: 0 } } })).map(
    h => ({ line: h.position.line, label: h.label }),
  )
const lineOf = (d, needle) => posOf(d.text, needle).line

before(async () => {
  server = await dev({ root: DRIVER, port: PORT, host: '127.0.0.1' })
  server.config.logger.info = () => {}
  await fetch(`http://127.0.0.1:${PORT}/__pcbjs/board.json`)
  client = await viteClient(PORT)
  await client.conn.sendRequest('initialize', initParams(DRIVER))
  await client.conn.sendNotification('initialized', {})
  pcb = await open(join(DRIVER, 'pcb.tsx'))
  wire = await open(join(DRIVER, '..', 'lib', 'wire.ts'))
  lay = await open(join(DRIVER, 'halfbridge.layout.tsx'))
})
after(async () => {
  client?.close()
  await server?.close()
})

test('helper routes: the call site in the entry hovers and lenses with the routes the helper made there', async () => {
  assert.match(await hover(pcb, 'chain(PWR, J_VM[1]', 2), /^made by this call: route VM: \*\*[\d.]+ mm\*\*$/)
  // a .map around the call: every route its calls made
  assert.match(await hover(pcb, '.map(([net, pin]) => chain', 3), /^made by this call: 8 routes\n- route nHA: /)
  const ls = await lenses(pcb)
  assert.ok(
    ls.some(l => l.line === lineOf(pcb, 'chain(PWR, J_VM[1]') && /^route VM: [\d.]+ mm$/.test(l.title)),
    JSON.stringify(ls),
  )
  assert.ok(
    ls.some(l => /^8 routes: nHA [\d.]+ mm · nHB /.test(l.title)),
    JSON.stringify(ls),
  )
})

test('helper routes: the route call inside the helper, in a file outside the project, has its range, hover and lens', async () => {
  const h = await hover(wire, 'route(ends', 2)
  assert.match(h, /^Drew \d+ tracks/)
  assert.match(h, /\n(\d+) routes\n- route nHA: /)
  const ls = await lenses(wire)
  assert.equal(ls.length, 1, JSON.stringify(ls))
  assert.equal(ls[0].line, lineOf(wire, 'route(ends'))
  assert.match(ls[0].title, /^\d+ routes: nHA [\d.]+ mm · /)
})

test('helper routes: the pad arguments of a helper call are pad references, with nets and the other pads as edits', async () => {
  const hs = await hints(pcb)
  const line = lineOf(pcb, 'chain(SIG, R_VT[2], R_VB[1])')
  assert.deepEqual(
    hs.filter(x => x.line === line).map(x => x.label),
    ['net VSNS', 'net VSNS'],
  )
  // R_VT is the variable the part was declared as in driver.sch.ts, not its ref
  const [seg] = await client.conn.sendRequest('pcbjs/segments', at(pcb, 'R_VT[2]', 5))
  assert.equal(seg.kind, 'pinRef')
  assert.deepEqual(
    seg.presentations.map(p => [p.label, p.detail, p.edit.newText]),
    [['R_VT.1', 'VM', '1']],
  )
})

test('layouts placed three times: hover and lens list every instance with its path', async () => {
  const h = await hover(lay, 'route(g.RS[2])', 2)
  assert.match(h, /\n3 routes\n- route A\/sl: \*\*[\d.]+ mm\*\*\n- route B\/sl: .*\n- route C\/sl: /)
  const ls = await lenses(lay)
  const route = ls.find(l => l.line === lineOf(lay, 'route(g.RS[2])'))
  assert.match(route.title, /^3 routes: A\/sl [\d.]+ mm · B\/sl [\d.]+ mm · C\/sl [\d.]+ mm$/)
  const isense = ls.find(l => l.line === lineOf(lay, 'route(g.RF[1])'))
  assert.match(isense.title, /^3 routes: A: ISA [\d.]+ mm · B: ISB [\d.]+ mm · C: ISC [\d.]+ mm$/)
  const qh = ls.find(l => l.line === lineOf(lay, '<g.QH'))
  assert.match(qh.title, /^3 instances: Q\d+ \(A\/QH\) · Q\d+ \(B\/QH\) · Q\d+ \(C\/QH\)$/)
  assert.match(await hover(lay, '<g.QH', 2), /parts Q\d+ \(A\/QH\), Q\d+ \(B\/QH\), Q\d+ \(C\/QH\)/)
})

test("layouts placed three times: a pad reference has every instance's net, its edits, and goes to each placement", async () => {
  const hs = await hints(lay)
  assert.ok(
    hs.some(x => x.line === lineOf(lay, 'route(g.RS[2])') && x.label === 'nets A/sl, B/sl, C/sl'),
    JSON.stringify(hs),
  )
  const [seg] = await client.conn.sendRequest('pcbjs/segments', at(lay, 'g.RS[2]', 5))
  assert.deepEqual(
    seg.presentations.map(p => [p.label, p.edit.newText]),
    [['g.RS.1', '1']],
  )
  const defs = await client.conn.sendRequest('textDocument/definition', at(lay, 'g.RS[2]', 5))
  assert.deepEqual(
    defs.map(d => [d.uri.split('/').pop(), d.range.start.line]),
    ['A', 'B', 'C'].map(g => ['pcb.tsx', lineOf(pcb, `<HalfBridgeColumn g={${g}}`)]),
  )
  const one = await client.conn.sendRequest('textDocument/definition', at(pcb, 'A.CF[2]', 5))
  assert.deepEqual(
    one.map(d => d.range.start.line),
    [lineOf(pcb, '<HalfBridgeColumn g={A}')],
  )
})
