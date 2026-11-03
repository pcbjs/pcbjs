// Docs in hover: the token under the cursor and the excerpt the build-time index gives for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docTokenAt, docsExcerpt, docsIndex } from '../dist/docs.js'
import { docOf, parse } from '../dist/doc.js'

const SRC = `export default <PCB name="X" rev="A">{route(U1[1], R1[2]).Z()}</PCB>`
const at = word => SRC.indexOf(word) + 1

test('the index is built into dist with every topic', () => {
  const i = docsIndex()
  assert.ok(i && i.topics.board && i.topics.routing, 'run the build: it writes dist/docs-index.json')
})

test('the token under the cursor: a prop of its element, the element, a call, a method', () => {
  assert.deepEqual(docTokenAt(parse(SRC, 'a.tsx'), at('rev')), { kind: 'prop', name: 'rev', owner: 'PCB' })
  assert.deepEqual(docTokenAt(parse(SRC, 'a.tsx'), at('PCB')), { kind: 'element', name: 'PCB' })
  assert.deepEqual(docTokenAt(parse(SRC, 'a.tsx'), at('route')), { kind: 'call', name: 'route' })
  assert.deepEqual(docTokenAt(parse(SRC, 'a.tsx'), SRC.indexOf('Z()')), { kind: 'method', name: 'Z' })
  assert.equal(docTokenAt(parse(SRC, 'a.tsx'), at('"A"') + 1), null)
})

test('<PCB rev>: the row of the PCB prop table in board.md', () => {
  const x = docsExcerpt(parse(SRC, 'a.tsx'), at('rev'))
  assert.equal(x.topic, 'board')
  assert.match(x.text, /^`rev` · `""` · the revision/)
  assert.equal(x.url, 'https://pcbjs.dev/docs/board')
})

test('route(): the paragraph of routing.md that defines it', () => {
  const x = docsExcerpt(parse(SRC, 'a.tsx'), at('route'))
  assert.equal(x.topic, 'routing')
  assert.match(x.text, /^`route\(a, b, …\)`: the first end is the root/)
})

test('<PCB>: the paragraph under its heading; .Z(): its row of the chain commands', () => {
  assert.match(docsExcerpt(parse(SRC, 'a.tsx'), at('PCB')).text, /^The root, once per entry/)
  const z = docsExcerpt(parse(SRC, 'a.tsx'), SRC.indexOf('Z()'))
  assert.equal(z.topic, 'routing')
  assert.match(z.text, /^`\.Z\(\)` · straight manual track/)
})
