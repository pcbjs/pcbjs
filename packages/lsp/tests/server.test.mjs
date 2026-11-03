// The language server inside a real dev server, over a real socket: the standard methods on a fixture board, segments for a
// chain commands and a position with their edits applied and the board recompiled, viewer selection and the preview URL.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PROTOCOL } from '@pcbjs/core/protocol'
import { dev } from './fixtures/dev.mjs'
import { makeProject } from './fixtures/project.mjs'
import { applyEdits, initParams, posOf, sessionClient, waitFor } from './fixtures/client.mjs'

let PORT
let project, server, client, uri, text
const diagnostics = []
let previewMsg = null,
  selectMsg = null

before(async () => {
  project = makeProject()
  server = await dev({ root: project.root, port: 0, host: '127.0.0.1' })
  PORT = server.httpServer.address().port
  client = await sessionClient(PORT)
  uri = pathToFileURL(project.main).href
  text = readFileSync(project.main, 'utf8')
  client.conn.onNotification('textDocument/publishDiagnostics', p => diagnostics.push(p))
  client.conn.onNotification('pcbjs/preview', p => {
    previewMsg = p
  })
  client.conn.onNotification('pcbjs/select', p => {
    selectMsg = p
  })
})

after(async () => {
  client?.close()
  await server?.close()
  if (project) rmSync(project.root, { recursive: true, force: true })
})

test('initialize: the handshake names the protocol and the methods', async () => {
  const res = await client.conn.sendRequest('initialize', initParams(project.root))
  const p = res.capabilities.experimental.pcbjs
  assert.equal(p.protocol, 5)
  assert.equal(p.major, 1)
  assert.deepEqual(p.methods.sort(), ['pcbjs/flush', 'pcbjs/focus', 'pcbjs/preview', 'pcbjs/segments', 'pcbjs/select', 'pcbjs/tokens'])
  assert.deepEqual(res.capabilities.semanticTokensProvider.legend.tokenTypes, ['number', 'unit', 'layer'], 'a client that does not colour pcbjs/tokens itself gets semantic tokens')
  assert.equal(res.serverInfo.name, 'pcbjs')
  assert.deepEqual(res.capabilities.signatureHelpProvider.triggerCharacters, ['[', "'", '"'])
  for (const c of ['hoverProvider', 'definitionProvider', 'documentHighlightProvider', 'codeLensProvider', 'inlayHintProvider']) assert.ok(res.capabilities[c], c)
  const got = waitFor(h => {
    const t = setInterval(() => {
      if (diagnostics.some(d => d.uri === uri)) {
        clearInterval(t)
        h(true)
      }
    }, 50)
  })
  await client.conn.sendNotification('initialized', {})
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  // the first compile may finish after initialized: a focus waits for it
  await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: posOf(text, 'route(') })
  await got
  assert.ok(previewMsg && new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}/`).test(previewMsg.url), JSON.stringify(previewMsg))
})

test('publishDiagnostics: the DRC finding of the thin track, at the track', () => {
  const d = diagnostics.filter(x => x.uri === uri).at(-1).diagnostics
  const thin = d.find(x => x.source === 'pcbjs DRC' && /width/i.test(String(x.code)))
  assert.ok(thin, JSON.stringify(d))
  assert.equal(thin.severity, 1)
  assert.equal(thin.range.start.line, posOf(text, "route('5 3'").line)
})

test('documentHighlight: the route call under the cursor', async () => {
  const hs = await client.conn.sendRequest('textDocument/documentHighlight', { textDocument: { uri }, position: posOf(text, 'route(TP1', 2) })
  assert.ok(hs.length >= 1)
  const line = posOf(text, 'route(').line
  assert.equal(hs[0].range.start.line, line)
  assert.equal(hs[0].range.start.character, posOf(text, 'route(').character)
})

test('hover: the literal and what the call drew', async () => {
  const h = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri }, position: posOf(text, 'V(14)', 1) })
  assert.match(h.contents.value, /pcbjs chainCommand/)
  assert.match(h.contents.value, /vertical to 14/)
  assert.match(h.contents.value, /Drew 1 track/)
  // the route call itself: what the whole chain drew and its length
  const r = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri }, position: posOf(text, 'route(TP1', 2) })
  assert.match(r.contents.value, /route V: \*\*28 mm\*\*/)
})

test('hover: the docs excerpt of route() last, below what the call drew, with its topic link', async () => {
  const r = await client.conn.sendRequest('textDocument/hover', { textDocument: { uri }, position: posOf(text, 'route(TP1', 2) })
  const v = r.contents.value
  assert.match(v, /`route\(a, b, …\)`: the first end is the root/)
  assert.match(v, /\[routing\.md\]\(https:\/\/pcbjs\.dev\/docs\/routing\)$/)
  assert.ok(v.indexOf('route V: **28 mm**') < v.indexOf('the first end is the root'), v)
})

test('codeLens: the route length, and the findings of the track', async () => {
  const lenses = await client.conn.sendRequest('textDocument/codeLens', { textDocument: { uri } })
  const titles = lenses.map(l => l.command.title)
  assert.ok(
    titles.some(t => t === 'route V: 28 mm'),
    JSON.stringify(titles),
  )
  assert.ok(
    titles.some(t => t === 'route V: 34 mm'),
    JSON.stringify(titles),
  )
  assert.ok(
    titles.some(t => /^1 error: /.test(t)),
    JSON.stringify(titles),
  )
})

test('inlayHint: the net of a pad reference and the width the rules gave the route', async () => {
  const hints = await client.conn.sendRequest('textDocument/inlayHint', { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 40, character: 0 } } })
  const labels = hints.map(h => h.label)
  assert.ok(labels.includes('net V'), JSON.stringify(labels))
  assert.ok(
    labels.some(l => /^width [\d.]+ mm$/.test(l)),
    JSON.stringify(labels),
  )
  const tp1 = hints.filter(h => h.position.line === posOf(text, '<TP1 at').line).map(h => [h.position.character, h.label])
  assert.deepEqual(tp1, [
    [posOf(text, '<TP1 at="5', 10).character, 'mm'],
    [posOf(text, '<TP1 at="5 10', 13).character, 'mm'],
  ])
})

test('pcbjs/tokens and semantic tokens: numbers and layers inside the coordinate strings', async () => {
  const { tokens } = await client.conn.sendRequest('pcbjs/tokens', { textDocument: { uri } })
  const line = posOf(text, "route('5 3')").line
  assert.deepEqual(
    tokens.filter(t => t.range.start.line === line).map(t => t.type),
    ['number', 'number'],
  )
  const sem = await client.conn.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri } })
  assert.equal(sem.data.length, tokens.length * 5)
})

test("definition: a pad reference goes to its part's placement", async () => {
  const locs = await client.conn.sendRequest('textDocument/definition', { textDocument: { uri }, position: posOf(text, 'TP2[1]', 4) })
  assert.equal(locs.length, 1)
  assert.equal(locs[0].uri, uri)
  assert.equal(locs[0].range.start.line, posOf(text, '<TP2 at').line)
})

test('segments: chain commands and a position, edited, saved and recompiled', async () => {
  const all = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri } })
  const kinds = new Set(all.map(s => s.kind))
  for (const k of ['position', 'pathCommand', 'pinRef', 'length', 'layer']) assert.ok(kinds.has(k), k)
  const cmds = all.filter(s => s.kind === 'pathCommand' && s.constraints.grammar === 'chain').map(s => s.value)
  assert.deepEqual(cmds, ['H(15)', 'V(14)', 'H(25)', 'Z()', 'V(17)', 'H(25)', 'Z()', 'H(10)'])
  const z = all.find(s => s.kind === 'pathCommand' && s.value === 'Z()')
  assert.ok(z.presentations.some(p => p.edit.newText === 'X()'))
  const pin = all.find(s => s.kind === 'pinRef' && s.value === '1')
  assert.deepEqual(pin.constraints.choices, ['1'])

  // the position of TP1: the server's own presentation, x +1 mm
  const at = all.find(s => s.kind === 'position' && s.value === '5 10')
  const plus = at.presentations.find(p => p.detail === 'x +1 mm')
  assert.equal(plus.edit.newText, '6 10')
  // a typed value for the V command, as colorPresentation takes a colour
  const [v] = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri }, position: posOf(text, 'V(14)', 1), value: 'V 16' })
  assert.equal(v.kind, 'pathCommand')
  assert.equal(v.presentations.length, 1)
  // a value the chain refuses: an error, no edit
  const [bad] = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri }, position: posOf(text, 'V(14)', 1), value: 'C 1 2 3 4 5 6' })
  assert.ok(bad.error && bad.presentations.length === 0)

  // the second route's .V(17), typed the same way
  const [cv] = await client.conn.sendRequest('pcbjs/segments', { textDocument: { uri }, position: posOf(text, 'V(17)', 1), value: 'V 18' })
  assert.equal(cv.presentations[0].edit.newText, 'V(18)')

  const next = applyEdits(text, [plus.edit, v.presentations[0].edit, cv.presentations[0].edit])
  assert.match(next, /at="6 10"/)
  assert.match(next, /\.H\(15\)\.V\(16\)\.H\(25\)\.Z\(\)/)
  const refreshed = waitFor(h =>
    client.conn.onRequest('workspace/codeLens/refresh', () => {
      h(true)
      return null
    }),
  )
  writeFileSync(project.main, next)
  await client.conn.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: next }] })
  await refreshed
  text = next
  const lenses = await client.conn.sendRequest('textDocument/codeLens', { textDocument: { uri } })
  // .H(15).V(16).H(25).Z() from (5+1, 10): 9 + 6 + 10 + 6
  assert.ok(
    lenses.some(l => l.command.title === 'route V: 31 mm'),
    JSON.stringify(lenses.map(l => l.command.title)),
  )
  // .V(18).H(25).Z from (6, 10): 8 + 19 + 8
  assert.ok(
    lenses.some(l => l.command.title === 'route V: 35 mm'),
    JSON.stringify(lenses.map(l => l.command.title)),
  )
  const board = await (await fetch(`http://127.0.0.1:${PORT}/__pcbjs/Fix/board.json`)).json()
  assert.deepEqual(board.footprints.find(f => f.ref === 'TP1').at, [6, 10])
})

test('pcbjs/select: a viewer opening a range selects it through the language client, once, revealed and focused', async () => {
  const line = posOf(text, "route('5 3'").line + 1
  const res = await fetch(`http://127.0.0.1:${PORT}/__pcbjs/open?file=main.tsx&line=${line}&col=5&endLine=${line}&endCol=60`)
  assert.equal(res.headers.get('x-pcbjs-opened'), 'ide')
  await waitFor(h => {
    const t = setInterval(() => {
      if (selectMsg) {
        clearInterval(t)
        h(true)
      }
    }, 20)
  })
  assert.deepEqual(selectMsg, {
    items: [{ uri, ranges: [{ start: { line: line - 1, character: 4 }, end: { line: line - 1, character: 60 } }] }],
    primary: { uri, index: 0 },
    reveal: true,
    focus: true,
  })
})

test('handshake: pcbjs options without protocol, major and capabilities get standard LSP only; a newer protocol is answered with ours', async () => {
  const old = await sessionClient(PORT)
  try {
    const res = await old.conn.sendRequest('initialize', initParams(project.root, { protocol: 1, kinds: ['position', 'length', 'enum'] }))
    assert.equal(res.capabilities.experimental, undefined)
    await old.conn.sendNotification('initialized', {})
    await old.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
    assert.deepEqual(await old.conn.sendRequest('pcbjs/segments', { textDocument: { uri } }), [])
    const fut = await sessionClient(PORT)
    const r2 = await fut.conn.sendRequest('initialize', initParams(project.root, { protocol: 7, major: 1, capabilities: ['sliders'] }))
    assert.equal(r2.capabilities.experimental.pcbjs.protocol, PROTOCOL)
    assert.deepEqual(r2.capabilities.experimental.pcbjs.capabilities, [])
    fut.close()
    // a client without the pcbjs options gets the standard methods and no pcbjs messages
    const plain = await sessionClient(PORT)
    const r3 = await plain.conn.sendRequest('initialize', initParams(project.root, null))
    assert.ok(r3.capabilities.hoverProvider)
    plain.close()
  } finally {
    old.close()
  }
})

test('standard signatureHelp shows the numbered footprint when the caret enters an existing pad accessor', async () => {
  const result = await client.conn.sendRequest('textDocument/signatureHelp', { textDocument: { uri }, position: posOf(text, 'TP1[1]', 4) })
  assert.equal(result.activeParameter, 0)
  assert.equal(result.signatures[0].label, 'TP1[pad]')
  assert.match(result.signatures[0].documentation.value, /^!\[Footprint pads\]\(data:image\/svg\+xml;base64,/)
  assert.equal(await client.conn.sendRequest('textDocument/signatureHelp', { textDocument: { uri }, position: posOf(text, 'TP1[1]', 6) }), null)
})
