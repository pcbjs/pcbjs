// The language server inside a real dev server, over a real socket: the standard methods on a fixture board, segments for a
// route path and a position with their edits applied and the board recompiled, viewer selection and the preview URL.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dev } from '@pcbjs/cli/server'
import { makeProject } from './fixtures/project.mjs'
import { applyEdits, initParams, posOf, viteClient, waitFor } from './fixtures/client.mjs'

const PORT = 5271
let project, server, client, uri, text
const diagnostics = []
let previewMsg = null, selectMsg = null

before(async () => {
  project = makeProject()
  server = await dev({ root: project.root, port: PORT, host: '127.0.0.1' })
  client = await viteClient(PORT)
  uri = pathToFileURL(project.main).href
  text = readFileSync(project.main, 'utf8')
  client.conn.onNotification('textDocument/publishDiagnostics', p => diagnostics.push(p))
  client.conn.onNotification('pcbjs/preview', p => { previewMsg = p })
  client.conn.onNotification('pcbjs/select', p => { selectMsg = p })
})

after(async () => {
  client?.close()
  await server?.close()
  if (project) rmSync(project.root, { recursive: true, force: true })
})

test('initialize: the handshake names the protocol, the kinds and the methods', async () => {
  const res = await client.conn.sendRequest('initialize', initParams(project.root))
  const p = res.capabilities.experimental.pcbjs
  assert.equal(p.protocol, 1)
  assert.deepEqual(p.kinds, ['number', 'length', 'angle', 'position', 'layer', 'enum', 'pathCommand', 'pinRef'])
  assert.deepEqual(p.methods.sort(), ['pcbjs/focus', 'pcbjs/preview', 'pcbjs/segments', 'pcbjs/select'])
  assert.equal(res.serverInfo.name, 'pcbjs')
  for (const c of ['hoverProvider', 'definitionProvider', 'documentHighlightProvider', 'codeLensProvider', 'inlayHintProvider']) assert.ok(res.capabilities[c], c)
  const got = waitFor(h => { const t = setInterval(() => { if (diagnostics.some(d => d.uri === uri)) { clearInterval(t); h(true) } }, 50) })
  await client.conn.sendNotification('initialized', {})
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  // the first compile may finish after initialized: a focus waits for it
  await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: posOf(text, "route(") })
  await got
  assert.ok(previewMsg && /^http:\/\/(127\.0\.0\.1|localhost):5271\//.test(previewMsg.url), JSON.stringify(previewMsg))
})

test('publishDiagnostics: the DRC finding of the thin track, at the track', () => {
  const d = diagnostics.filter(x => x.uri === uri).at(-1).diagnostics
  const thin = d.find(x => x.source === 'pcbjs DRC' && /width/i.test(String(x.code)))
  assert.ok(thin, JSON.stringify(d))
  assert.equal(thin.severity, 1)
  assert.equal(thin.range.start.line, posOf(text, '<track').line)
})

test('documentHighlight: the route call under the cursor', async () => {
  const hs = await client.conn.sendRequest('textDocument/documentHighlight', { textDocument: { uri }, position: posOf(text, "route('TP1", 2) })
  assert.ok(hs.length >= 1)
  const line = posOf(text, 'route(').line
  assert.equal(hs[0].range.start.line, line)
  assert.equal(hs[0].range.start.character, posOf(text, 'route(').character)
})

test('hover: the literal and what the call drew', async () => {
  const h = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri }, position: posOf(text, 'V 14', 1) })
  assert.match(h.contents.value, /pcbjs routePath/)
  assert.match(h.contents.value, /4 commands/)
  assert.match(h.contents.value, /Drew .*track/)
  assert.match(h.contents.value, /route V: \*\*28 mm\*\*/)
})

test('codeLens: the route length, and the findings of the track', async () => {
  const lenses = await client.conn.sendRequest('textDocument/codeLens', { textDocument: { uri } })
  const titles = lenses.map(l => l.command.title)
  assert.ok(titles.some(t => t === 'route V: 28 mm'), JSON.stringify(titles))
  assert.ok(titles.some(t => t === 'route V: 34 mm'), JSON.stringify(titles))
  assert.ok(titles.some(t => /^1 error: /.test(t)), JSON.stringify(titles))
})

test('inlayHint: the net of a pad reference and the width the rules gave the route', async () => {
  const hints = await client.conn.sendRequest('textDocument/inlayHint', { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } } })
  const labels = hints.map(h => h.label)
  assert.ok(labels.includes('net V'), JSON.stringify(labels))
  assert.ok(labels.some(l => /^width [\d.]+ mm$/.test(l)), JSON.stringify(labels))
})

test('definition: a pad reference goes to its part\'s placement', async () => {
  const locs = await client.conn.sendRequest('textDocument/definition', { textDocument: { uri }, position: posOf(text, "'TP2.1'", 2) })
  assert.equal(locs.length, 1)
  assert.equal(locs[0].uri, uri)
  assert.equal(locs[0].range.start.line, posOf(text, 'ref="TP2"').line)
})

test('segments: a route path command and a position, edited, saved and recompiled', async () => {
  const all = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri } })
  const kinds = new Set(all.map(s => s.kind))
  for (const k of ['position', 'pathCommand', 'pinRef', 'length', 'layer']) assert.ok(kinds.has(k), k)
  const cmds = all.filter(s => s.kind === 'pathCommand' && s.constraints.grammar === 'route').map(s => s.value)
  assert.deepEqual(cmds, ['H 15', 'V 14', 'H 25', 'Z'])
  const z = all.find(s => s.kind === 'pathCommand' && s.constraints.grammar === 'route' && s.value === 'Z')
  assert.ok(z.presentations.some(p => p.edit.newText === 'XZ'))
  const pin = all.find(s => s.kind === 'pinRef' && s.value === 'TP1.1')
  assert.deepEqual(pin.constraints.choices, ['1'])

  // the position of TP1: the server's own presentation, x +1 mm
  const at = all.find(s => s.kind === 'position' && s.value === '5 10')
  const plus = at.presentations.find(p => p.detail === 'x +1 mm')
  assert.equal(plus.edit.newText, '6 10')
  // a typed value for the V command, as colorPresentation takes a colour
  const [v] = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri }, position: posOf(text, 'V 14', 1), value: 'V 16' })
  assert.equal(v.kind, 'pathCommand')
  assert.equal(v.presentations.length, 1)
  // a value the grammar refuses: an error, no edit
  const [bad] = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri }, position: posOf(text, 'V 14', 1), value: 'C 1 2 3 4 5 6' })
  assert.ok(bad.error && bad.presentations.length === 0)

  // the chain form: .V(17) is a command like V 17, typed the same way
  const chain = all.filter(s => s.constraints.grammar === 'chain').map(s => s.value)
  assert.deepEqual(chain, ['V(17)', 'H(25)', "Z('TP2.1')"])
  const [cv] = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri }, position: posOf(text, 'V(17)', 1), value: 'V 18' })
  assert.equal(cv.presentations[0].edit.newText, 'V(18)')

  const next = applyEdits(text, [plus.edit, v.presentations[0].edit, cv.presentations[0].edit])
  assert.match(next, /at="6 10"/)
  assert.match(next, /'H 15 V 16 H 25 Z'/)
  const refreshed = waitFor(h => client.conn.onRequest('workspace/codeLens/refresh', () => { h(true); return null }))
  writeFileSync(project.main, next)
  await client.conn.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: next }] })
  await refreshed
  text = next
  const lenses = await client.conn.sendRequest('textDocument/codeLens', { textDocument: { uri } })
  // H 15 V 16 H 25 Z from (5+1, 10): 9 + 6 + 10 + 6
  assert.ok(lenses.some(l => l.command.title === 'route V: 31 mm'), JSON.stringify(lenses.map(l => l.command.title)))
  // .V(18).H(25).Z from (6, 10): 8 + 19 + 8
  assert.ok(lenses.some(l => l.command.title === 'route V: 35 mm'), JSON.stringify(lenses.map(l => l.command.title)))
  const board = await (await fetch(`http://127.0.0.1:${PORT}/__pcbjs/Fix/board.json`)).json()
  assert.deepEqual(board.footprints.find(f => f.ref === 'TP1').at, [6, 10])
})

test('pcbjs/select: a viewer click selects through the language client, once', async () => {
  const line = posOf(text, '<track').line + 1
  const res = await fetch(`http://127.0.0.1:${PORT}/__pcbjs/open?file=main.tsx&line=${line}&col=5&endLine=${line}&endCol=60`)
  assert.equal(res.headers.get('x-pcbjs-opened'), 'ide')
  await waitFor(h => { const t = setInterval(() => { if (selectMsg) { clearInterval(t); h(true) } }, 20) })
  assert.equal(selectMsg.uri, uri)
  assert.deepEqual(selectMsg.range, { start: { line: line - 1, character: 4 }, end: { line: line - 1, character: 60 } })
})

test('handshake: an older client keeps the kinds it knows, the rest come as enum or not at all', async () => {
  const old = await viteClient(PORT)
  try {
    const res = await old.conn.sendRequest('initialize', initParams(project.root, { protocol: 1, kinds: ['position', 'length', 'enum'] }))
    assert.deepEqual(res.capabilities.experimental.pcbjs.kinds, ['position', 'length', 'enum'])
    await old.conn.sendNotification('initialized', {})
    await old.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
    const segs = await old.conn.sendRequest('pcbjs/segments', { textDocument: { uri } })
    assert.ok(segs.every(s => ['position', 'length', 'enum'].includes(s.kind)))
    // the path commands arrive as enum, their presentations intact
    const cmds = segs.filter(s => s.kind === 'enum' && s.label.startsWith('route path'))
    assert.equal(cmds.length, 4)
    assert.ok(cmds.every(s => s.presentations.length))
    // a future client: protocol 7 is answered with 2, kinds it lists that the server does not know are left out
    const fut = await viteClient(PORT)
    const r2 = await fut.conn.sendRequest('initialize', initParams(project.root, { protocol: 7, kinds: ['length', 'colour'] }))
    assert.equal(r2.capabilities.experimental.pcbjs.protocol, 2)
    assert.deepEqual(r2.capabilities.experimental.pcbjs.kinds, ['length'])
    fut.close()
    // a client without the pcbjs options gets the standard methods and no pcbjs messages
    const plain = await viteClient(PORT)
    const r3 = await plain.conn.sendRequest('initialize', initParams(project.root, null))
    assert.ok(r3.capabilities.hoverProvider)
    plain.close()
  } finally {
    old.close()
  }
})
