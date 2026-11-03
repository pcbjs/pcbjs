// One parse per document text: the unit pass on a large board stays fast, and a hover with the publish around it parses its text once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { docOf, parse, parseCount } from '../dist/doc.js'
import { unitsOf } from '../dist/units.js'
import { documentStore } from '../dist/documents.js'
import { startLanguageServer } from '../dist/server.js'
import { sessionProjects } from '../dist/project.js'
import { inproc, host } from './fixtures/inproc.mjs'

const FILE = fileURLToPath(new URL('../../../examples/usb3-hub/pcb.tsx', import.meta.url))
const TEXT = readFileSync(FILE, 'utf8')

test('unitsOf on usb3-hub, its parse included, takes under 10 ms, where it reparsed per chain call in 130 ms', () => {
  const run = () => unitsOf(parse(TEXT, FILE))
  for (let i = 0; i < 3; i++) run()
  const times = []
  for (let i = 0; i < 15; i++) {
    const t = performance.now()
    run()
    times.push(performance.now() - t)
  }
  // the best run, since the suite's other files share the cores
  const best = Math.min(...times)
  assert.ok(best < 10, `best ${best.toFixed(1)} ms of ${times.map(t => t.toFixed(1)).join(', ')}`)
})

test('the model of a text is one, and a new text gets a new one', () => {
  const a = docOf(FILE, TEXT)
  assert.equal(docOf(FILE, TEXT), a)
  assert.equal(a.sf(), a.sf())
  const b = docOf(FILE, TEXT + ' ')
  assert.notEqual(b, a)
  assert.deepEqual(a.pos(a.offset({ line: 300, character: 4 })), { line: 300, character: 4 })
})

test('a hover parses its document once, the publish of the edit included', async () => {
  const store = documentStore()
  const c = await inproc(ch => startLanguageServer(ch, host(), store, sessionProjects(store)))
  const uri = pathToFileURL(FILE).href
  c.open(FILE, TEXT)
  await c.request('pcbjs/flush')
  const text = `${TEXT}\n`
  const before = parseCount()
  c.change(FILE, text, 2)
  for (const at of ['route(ESS[1]', 'width(T)']) {
    const o = text.indexOf(at) + 2
    const line = text.slice(0, o).split('\n').length - 1
    const hover = await c.request('textDocument/hover', { textDocument: { uri }, position: { line, character: o - text.lastIndexOf('\n', o - 1) - 1 } })
    assert.ok(hover, at)
  }
  await c.request('textDocument/inlayHint', { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 600, character: 0 } } })
  await c.request('pcbjs/tokens', { textDocument: { uri } })
  assert.equal(parseCount() - before, 1)
  c.server.dispose()
})
